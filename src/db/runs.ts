import { operationLabel, runOutcome, type RunOutcome } from '../runs/outcome.js';
import {
  failedTools,
  redactResult,
  redactSecrets,
  redactToolErrors,
  TOOL_IDS,
  toolErrors,
  TOOLS,
  toolsOfRun,
  type ToolId,
} from '../runs/tools.js';
import { countRunsOfTool, findRunsOfTool, type Job } from './jobs.js';
import { db } from './index.js';

/*
 * Righe di log dei run (people-first-crm SPEC J8–J11, PLAN P-10, T28). Solo accesso ai dati: chi le
 * produce è il logger ambientale di `src/runs/log.ts`, che gira nel processo che esegue il run (il figlio
 * per i job, il server per la riga finale dei run interrotti e per l'analisi singola).
 * I log restano finché esiste il run (`run_logs.job_id` è ON DELETE CASCADE).
 */

export const LOG_LEVELS = ['info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Riga di log già scritta, con il suo numero d'ordine dentro il run. */
export interface RunLogLine {
  seq: number;
  at: string;
  level: LogLevel;
  message: string;
}

/** Riga da scrivere: il `seq` lo assegna `appendRunLog`. */
export type NewRunLogLine = Omit<RunLogLine, 'seq'>;

/**
 * Righe conservate per run (J11): oltre questo tetto il log si taglia **al centro**, così avvio, esito ed
 * errore finale restano sempre visibili. Con messaggi da 2.000 caratteri un run occupa al più ~10 MB.
 */
export const RUN_LOG_MAX_LINES = 5000;
const KEEP_HEAD = RUN_LOG_MAX_LINES / 2;

/**
 * Accoda righe al log del run, numerandole da `MAX(seq) + 1`, e applica il troncamento centrale.
 * Una sola transazione `.immediate()` per lotto (P-10, TD-30: il server scrive mentre il job gira).
 */
export function appendRunLog(jobId: number, lines: readonly NewRunLogLine[]): void {
  if (lines.length === 0) return;
  db.transaction(() => {
    const insert = db.prepare('INSERT INTO run_logs (job_id, seq, at, level, message) VALUES (?, ?, ?, ?, ?)');
    let seq = (db.prepare('SELECT MAX(seq) FROM run_logs WHERE job_id = ?').pluck().get(jobId) as number | null) ?? 0;
    for (const line of lines) {
      seq += 1;
      insert.run(jobId, seq, line.at, line.level, line.message);
    }
    // Tiene le prime `KEEP_HEAD` e le ultime `RUN_LOG_MAX_LINES - KEEP_HEAD`: le omesse restano
    // implicite nel salto dei `seq` (omitted = MAX(seq) − COUNT(*)).
    if (seq > RUN_LOG_MAX_LINES) {
      db.prepare('DELETE FROM run_logs WHERE job_id = ? AND seq > ? AND seq <= ?').run(
        jobId,
        KEEP_HEAD,
        seq - (RUN_LOG_MAX_LINES - KEEP_HEAD),
      );
    }
  }).immediate();
}

/**
 * Log di un run: le righe con `seq > after` (polling a run in corso) e quante ne sono state omesse dal
 * troncamento (sempre il totale del run, anche con `after`).
 */
export function readRunLog(jobId: number, after = 0): { lines: RunLogLine[]; omitted: number } {
  const lines = db
    .prepare('SELECT seq, at, level, message FROM run_logs WHERE job_id = ? AND seq > ? ORDER BY seq')
    .all(jobId, after) as RunLogLine[];
  // `omitted` esiste solo dopo il troncamento: sotto il tetto basta l'ultimo `seq` (una seek sulla PK).
  const last = (db.prepare('SELECT MAX(seq) FROM run_logs WHERE job_id = ?').pluck().get(jobId) as number | null) ?? 0;
  if (last <= RUN_LOG_MAX_LINES) return { lines, omitted: 0 };
  const kept = db.prepare('SELECT COUNT(*) FROM run_logs WHERE job_id = ?').pluck().get(jobId) as number;
  return { lines, omitted: Math.max(0, last - kept) };
}

// ---------------------------------------------------------------------------
// Connessioni e viste dei run (J2–J7, T30)
// ---------------------------------------------------------------------------

/**
 * Riga di un run nelle liste (J6) e in Oggi (H5). I testi passano di nuovo da `redactSecrets` anche se
 * `completeJob` li salva già ripuliti: le righe scritte prima di questa versione no (J10 vale anche per loro).
 */
export interface RunView {
  id: number;
  kind: Job['kind'];
  /** Operazione in italiano (FLOW G.3): "Arricchimento (Apollo)", "Analisi singola", … */
  operation: string;
  state: Job['state'];
  outcome: RunOutcome;
  detached: number;
  started_at: string | null;
  finished_at: string | null;
  /** Durata in millisecondi; `null` finché il run non è finito. */
  duration_ms: number | null;
  summary: string | null;
  error: string | null;
  tools: ToolId[];
  /** Strumenti per cui questo run conta come fallito (J4), anche se è riuscito (own-profile-services P-26). */
  failed_tools: ToolId[];
  /**
   * Il motivo per ciascuno di `failed_tools`: l'errore del run se è fallito, quello della fonte se il run è riuscito.
   * Card, dettaglio e avvisi di Oggi lo mostrano al posto di `error`, che per un run riuscito è `null`.
   */
  tool_errors: Partial<Record<ToolId, string>>;
}

function durationMs(job: Job): number | null {
  if (!job.started_at || !job.finished_at) return null;
  const ms = Date.parse(job.finished_at) - Date.parse(job.started_at);
  return Number.isFinite(ms) ? Math.max(0, ms) : null;
}

export function runView(job: Job): RunView {
  const failures = toolErrors(job);
  return {
    id: job.id,
    kind: job.kind,
    operation: operationLabel(job.kind, job.params, job.detached === 1),
    state: job.state,
    outcome: runOutcome(job),
    detached: job.detached,
    started_at: job.started_at,
    finished_at: job.finished_at,
    duration_ms: durationMs(job),
    summary: job.result ? redactSecrets(job.result.summary) : null,
    error: job.error === null ? null : redactSecrets(job.error),
    tools: toolsOfRun(job.tools),
    failed_tools: Object.keys(failures) as ToolId[],
    tool_errors: redactToolErrors(failures),
  };
}

/** Dettaglio di un run (J7): la vista più parametri, esito completo e presenza del log. */
export function runDetail(job: Job): RunView & Pick<Job, 'params' | 'created_at'> & { result: Job['result']; logged: boolean } {
  return {
    ...runView(job),
    params: job.params,
    created_at: job.created_at,
    result: job.result && redactResult(job.result),
    logged: job.logged === 1,
  };
}

/** Stato di uno strumento in Connessioni (J2, J5). */
export interface Connection {
  tool: ToolId;
  label: string;
  enables: string;
  /** Variabili del `.env` dello strumento (P-13) e quelle che mancano, nello stesso ordine (A4). */
  env_vars: readonly string[];
  missing_env_vars: string[];
  /** Tutte le variabili sono nel `.env`: non dice che sono valide (per quello c'è `health`). */
  configured: boolean;
  runs_count: number;
  last_run: RunView | null;
  /** `failing` se l'ultimo run dello strumento è fallito **per lui** (J5); `unknown` = nessun run. */
  health: 'ok' | 'failing' | 'unknown';
}

/**
 * Ultimo run di ogni strumento (J5, H5): la base sia della salute in Connessioni sia degli avvisi di Oggi,
 * che devono dire la stessa cosa. `failing` = quel run conta come fallito **per quello strumento** (J4), anche
 * quando è riuscito ma la fonte di quello strumento no (own-profile-services P-26).
 */
export function lastRunPerTool(): Array<{ tool: ToolId; run: Job; failing: boolean }> {
  return TOOL_IDS.flatMap((tool) => {
    const run = findRunsOfTool(tool, { limit: 1, offset: 0 })[0];
    return run ? [{ tool, run, failing: failedTools(run).includes(tool) }] : [];
  });
}

export function connections(): Connection[] {
  const last = new Map(lastRunPerTool().map((r) => [r.tool, r]));
  return TOOL_IDS.map((id) => {
    const tool = TOOLS[id];
    const latest = last.get(id);
    const missing = tool.missing();
    return {
      tool: id,
      label: tool.label,
      enables: tool.enables,
      env_vars: tool.env_vars,
      missing_env_vars: missing,
      configured: missing.length === 0,
      runs_count: countRunsOfTool(id),
      last_run: latest ? runView(latest.run) : null,
      health: latest === undefined ? 'unknown' : latest.failing ? 'failing' : 'ok',
    };
  });
}

/** Run che usano lo strumento, paginati dal più recente (J6). */
export function runsOfTool(tool: ToolId, opts: { failedOnly?: boolean; page: number; pageSize: number }) {
  const offset = (opts.page - 1) * opts.pageSize;
  return {
    items: findRunsOfTool(tool, { failedOnly: opts.failedOnly, limit: opts.pageSize, offset }).map(runView),
    total: countRunsOfTool(tool, opts.failedOnly),
    page: opts.page,
    pageSize: opts.pageSize,
  };
}
