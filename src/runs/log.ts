import { AsyncLocalStorage } from 'node:async_hooks';
import { appendRunLog, type LogLevel, type NewRunLogLine } from '../db/runs.js';
import { nowIso } from '../db/index.js';
import { redactSecrets } from './tools.js';
import { truncate } from '../util/fields.js';

/*
 * Logger ambientale dei run (people-first-crm SPEC J8–J11, PLAN P-10, T28): dentro `withRunLog(runId, fn)`
 * ogni `runLog.info|warn|error(...)` finisce nel log di quel run, senza passare il run di mano in mano
 * fino alle funzioni che lavorano. Fuori dal contesto le righe si scartano (le stesse funzioni girano
 * anche nei test e nelle azioni manuali).
 *
 * Regole (P-10): scritture a lotti (≤ 50 righe o ≤ 500 ms) in transazioni `.immediate()`; un errore di
 * scrittura **non** fa fallire il run (una riga su stderr e basta); messaggi lunghi troncati; valori delle
 * chiavi configurate sempre oscurati (J10 vale anche se un messaggio d'errore di terzi se li porta dietro).
 */

/** Lunghezza massima di un messaggio, "…" compreso (tetto di spazio per run, P-10). */
const MAX_MESSAGE = 2000;
const FLUSH_LINES = 50;
const FLUSH_MS = 500;

/**
 * Run il cui id arriva **dopo** l'avvio: l'analisi singola crea la riga solo se chiama davvero uno
 * strumento (P-13), ma intanto ha già righe da scrivere. Finché `jobId` è `null` restano in coda; se non
 * arriva mai, si buttano con la fine del contesto.
 */
export interface LazyRun {
  jobId: number | null;
}

interface RunLogContext {
  run: LazyRun;
  buffer: NewRunLogLine[];
  timer: NodeJS.Timeout | null;
  /** Un solo avviso su stderr per run: un log che non si scrive non deve riempire l'output. */
  reported: boolean;
}

const context = new AsyncLocalStorage<RunLogContext>();

function flush(ctx: RunLogContext): void {
  if (ctx.timer) {
    clearTimeout(ctx.timer);
    ctx.timer = null;
  }
  const jobId = ctx.run.jobId;
  if (jobId === null || ctx.buffer.length === 0) return;
  const lines = ctx.buffer.splice(0);
  try {
    appendRunLog(jobId, lines);
  } catch (err) {
    if (ctx.reported) return;
    ctx.reported = true;
    console.error(`Log del run ${jobId} non scritto: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function add(level: LogLevel, message: string): void {
  const ctx = context.getStore();
  if (!ctx) return;
  ctx.buffer.push({ at: nowIso(), level, message: truncate(redactSecrets(message), MAX_MESSAGE - 1) });
  if (ctx.buffer.length >= FLUSH_LINES) flush(ctx);
  // `unref`: un log in attesa non tiene vivo il processo del job.
  else ctx.timer ??= setTimeout(() => flush(ctx), FLUSH_MS).unref();
}

/**
 * Scrive **subito** una riga sul log di un run, fuori dal suo contesto: la usa il server quando è lui a
 * chiudere un run che il suo processo ha lasciato a metà. Stessa regola del logger: un log che non si
 * scrive non fa fallire niente.
 */
export function writeRunLine(jobId: number, level: LogLevel, message: string): void {
  try {
    appendRunLog(jobId, [{ at: nowIso(), level, message: truncate(redactSecrets(message), MAX_MESSAGE - 1) }]);
  } catch (err) {
    console.error(`Log del run ${jobId} non scritto: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Id del run in corso (`null` fuori da `withRunLog` o finché un `LazyRun` non ha la sua riga). */
export function currentRunId(): number | null {
  return context.getStore()?.run.jobId ?? null;
}

/** Righe del run in corso (J8). Fuori da `withRunLog` non fanno nulla. */
export const runLog = {
  info: (message: string) => add('info', message),
  warn: (message: string) => add('warn', message),
  error: (message: string) => add('error', message),
};

/**
 * Esegue `fn` con il log attivo sul run: le righe rimaste in coda si scrivono comunque alla fine. `run`
 * può essere un id o un `LazyRun` il cui id arriva durante l'esecuzione (analisi singola).
 */
export async function withRunLog<T>(run: number | LazyRun, fn: () => Promise<T>): Promise<T> {
  const ctx: RunLogContext = { run: typeof run === 'number' ? { jobId: run } : run, buffer: [], timer: null, reported: false };
  try {
    return await context.run(ctx, fn);
  } finally {
    flush(ctx);
  }
}
