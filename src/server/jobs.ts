import type { Context } from 'hono';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { ROOT } from '../config.js';
import {
  failIfRunning,
  findJob,
  findJobs,
  findLatestJob,
  findRunningJobs,
  insertJob,
  setJobPid,
  type Job,
} from '../db/jobs.js';
import type { JobKind } from '../jobs/types.js';
import { httpError } from './http.js';
import type { AppOptions } from './types.js';

export type { Job } from '../db/jobs.js';

/*
 * Controller generico dei job (PLAN crm-foundation T6, P7): una riga `jobs` per
 * esecuzione, un processo figlio `tsx src/server/job-entry.ts <jobId>` che scrive lui
 * l'esito terminale (così sopravvive a un restart del server), **un solo job alla volta**.
 */

/**
 * Override del processo figlio (test/smoke), da `AppOptions.jobs`. L'id del job arriva
 * al comando in due modi: **ultimo argomento** (appeso dopo `args`) e env `JOB_ID`.
 */
export interface SpawnOptions {
  command?: string;
  args?: string[];
}

/** Figli avviati da questo processo e non ancora usciti: il loro esito lo gestisce l'handler di uscita. */
const inFlight = new Set<number>();

/** Nome leggibile del kind, per blocker e messaggi (FLOW: "Sync interazioni, avviato 2 min fa"). */
export const JOB_KIND_LABELS: Record<JobKind, string> = {
  sync_interactions: 'Sync interazioni',
  source_company: 'Sourcing da azienda',
  enrich: 'Arricchimento',
  analyze: 'Analisi',
};

/** C'è già un job `running`: chi avvia ne riceve la riga (per `job_id` e testo). */
export class JobRunningError extends Error {
  constructor(readonly job: Job) {
    super(runningText(job));
    this.name = 'JobRunningError';
  }
}

export class JobNotFoundError extends Error {
  constructor(readonly jobId: number) {
    super('Job inesistente.');
    this.name = 'JobNotFoundError';
  }
}

/** Retry consentito solo su un job `failed` (FLOW: "Riprova" nel banner rosso). */
export class JobNotRetryableError extends Error {
  constructor(readonly job: Job) {
    super('Si può riprovare solo un job fallito.');
    this.name = 'JobNotRetryableError';
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: il processo esiste ma non è nostro.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

const INTERRUPTED_TAIL = "I dati scritti fino all'interruzione restano validi.";

/**
 * Un job `running` il cui processo non esiste più (es. server riavviato mentre il
 * figlio moriva) diventa `failed`: altrimenti bloccherebbe per sempre i nuovi job.
 */
function reconcileRunning(): void {
  for (const job of findRunningJobs()) {
    if (inFlight.has(job.id)) continue;
    if (job.pid !== null && isAlive(job.pid)) continue;
    failIfRunning(job.id, `process: Job interrotto senza esito (processo non più attivo). ${INTERRUPTED_TAIL}`);
  }
}

/** Ultima riga di output utile del figlio, per dare un indizio nell'errore. */
function lastLine(text: string): string {
  const lines = text.trim().split('\n').map((l) => l.trim()).filter(Boolean);
  const last = lines.at(-1) ?? '';
  return last.length > 300 ? `${last.slice(0, 300)}…` : last;
}

function spawnChild(job: Job, opts: SpawnOptions): void {
  const command = opts.command ?? path.join(ROOT, 'node_modules', '.bin', 'tsx');
  const args = [...(opts.args ?? [path.join(ROOT, 'src', 'server', 'job-entry.ts')]), String(job.id)];
  // Env del parent: DB_PATH ed E2E_FAKE_JOBS arrivano al figlio.
  const child = spawn(command, args, {
    cwd: ROOT,
    env: { ...process.env, JOB_ID: String(job.id) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  inFlight.add(job.id);

  let stderrTail = '';
  child.stdout?.on('data', (d: Buffer) => process.stdout.write(d));
  child.stderr?.on('data', (d: Buffer) => {
    process.stderr.write(d);
    stderrTail = (stderrTail + d.toString()).slice(-2000);
  });

  // Fallback per le uscite senza esito: in condizioni normali l'esito lo scrive il
  // wrapper prima di uscire, e `failIfRunning` non lo sovrascrive.
  child.on('close', (code, signal) => {
    inFlight.delete(job.id);
    const how = code !== null ? `exit ${code}` : `segnale ${signal}`;
    const hint = lastLine(stderrTail);
    failIfRunning(
      job.id,
      `process: Job interrotto senza esito (${how}). ${INTERRUPTED_TAIL}${hint ? ` Ultimo output: ${hint}` : ''}`,
    );
  });
  child.on('error', (err) => {
    inFlight.delete(job.id);
    failIfRunning(job.id, `process: Impossibile avviare il processo del job (${err.message}).`);
  });

  if (child.pid !== undefined) setJobPid(job.id, child.pid);
}

/**
 * Avvia un job: inserisce la riga `running` e spawna il figlio. Nessun controllo di
 * configurazione qui: quelli sono `blockers` delle preview (T8–T11).
 */
export function startJob(kind: JobKind, params: object, spawnOpts: SpawnOptions = {}): Job {
  const running = runningJob();
  if (running) throw new JobRunningError(running);
  const job = insertJob(kind, params);
  spawnChild(job, spawnOpts);
  return findJob(job.id)!;
}

/** Il job in corso (pid vivo), dopo la riconciliazione. */
function runningJob(): Job | undefined {
  reconcileRunning();
  return findRunningJobs()[0];
}

function startedAgo(startedAt: string | null): string {
  const minutes = startedAt ? Math.floor((Date.now() - Date.parse(startedAt)) / 60_000) : 0;
  if (!(minutes >= 1)) return 'avviato meno di un minuto fa';
  if (minutes < 60) return `avviato ${minutes} min fa`;
  return `avviato ${Math.floor(minutes / 60)} h fa`;
}

function runningText(job: Job): string {
  return `C'è già un job in corso: ${JOB_KIND_LABELS[job.kind]}, ${startedAgo(job.started_at)}.`;
}

/**
 * Blocker "job in corso" per le preview (T8–T11): testo italiano da mettere in
 * `JobPreview.blockers`, `null` se nessun job gira.
 */
export function runningJobBlocker(): string | null {
  const running = runningJob();
  return running ? runningText(running) : null;
}

export function getJob(id: number): Job | undefined {
  reconcileRunning();
  return findJob(id);
}

/**
 * Job "corrente" per il banner: quello in corso se c'è, altrimenti l'ultimo terminato
 * (così l'esito arriva anche dopo un reload della pagina), `null` se mai lanciato.
 */
export function getCurrentJob(): Job | null {
  return runningJob() ?? findLatestJob() ?? null;
}

/** Storico dei job dal più recente; `limit` tra 1 e 100 (default 20). */
export function listJobs(limit = 20): Job[] {
  reconcileRunning();
  const n = Number.isFinite(limit) ? Math.trunc(limit) : 20;
  return findJobs(Math.min(Math.max(n, 1), 100));
}

/**
 * "Riprova": nuovo job con kind e `params` identici a quelli di un job `failed`.
 * Lancia `JobNotFoundError`, `JobRunningError` (un job gira già) o `JobNotRetryableError`.
 */
export function retryJob(id: number, spawnOpts: SpawnOptions = {}): Job {
  const source = findJob(id);
  if (!source) throw new JobNotFoundError(id);
  const running = runningJob();
  if (running) throw new JobRunningError(running);
  if (source.state !== 'failed') throw new JobNotRetryableError(source);
  return startJob(source.kind, source.params, spawnOpts);
}

/**
 * Errori del controller → risposta HTTP (`{error, code?, ...}`, convenzioni API):
 * 409 `job_running` con `job_id`, 409 `job_not_failed`, 404. Gli altri errori passano.
 */
export function jobHttpError(err: unknown): unknown {
  if (err instanceof JobRunningError) return httpError(409, err.message, { code: 'job_running', job_id: err.job.id });
  if (err instanceof JobNotRetryableError) return httpError(409, err.message, { code: 'job_not_failed', job_id: err.job.id });
  if (err instanceof JobNotFoundError) return httpError(404, err.message);
  return err;
}

/**
 * Avvio di un job da una route (T8–T11): usa l'override `opts.jobs` di `createApp`,
 * risponde `202 {job}` oppure lancia 409 `{error, code: 'job_running', job_id}`.
 * I `blockers` di configurazione vanno controllati dalla route **prima** di chiamarla.
 */
export function launchJob(c: Context<any>, kind: JobKind, params: object) {
  try {
    const job = startJob(kind, params, (c.get('opts') as AppOptions | undefined)?.jobs);
    return c.json({ job }, 202);
  } catch (err) {
    throw jobHttpError(err);
  }
}
