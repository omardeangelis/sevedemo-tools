import { redactResult, redactSecrets } from '../runs/tools.js';
import type { JobKind, JobResult, JobState, RunOutcomeWrite } from '../jobs/types.js';
import { db, nowIso } from './index.js';

/*
 * Repository della tabella `jobs` (PLAN crm-foundation §6, P7). Solo accesso ai dati:
 * spawn, guard "un solo job" e riconciliazione dei pid morti stanno in `server/jobs.ts`;
 * l'esito terminale lo scrive il wrapper del processo figlio (`server/job-entry.ts`).
 */

/** Run che usa lo strumento: `jobs.tools` è un array JSON. */
const toolCondition = `EXISTS (SELECT 1 FROM json_each(jobs.tools) WHERE value = ?)`;

/** Riga `jobs` come esce dalle API: `params`/`result` già parsati. */
export interface Job {
  id: number;
  kind: JobKind;
  params: Record<string, unknown>;
  state: JobState;
  pid: number | null;
  started_at: string | null;
  finished_at: string | null;
  result: JobResult | null;
  error: string | null;
  created_at: string;
  /** Analisi singola dalla scheda (people-first-crm P-13): non blocca gli altri job e non è nel banner. */
  detached: number;
  /** 1 = run con log in `run_logs`; i run precedenti mostrano "Log non disponibile" (J11). */
  logged: number;
  /** Strumenti esterni usati dal run (J3), fissati all'avvio: `['apify']`, `['anthropic', 'apify']`, … */
  tools: string[];
}

interface JobRow extends Omit<Job, 'params' | 'result' | 'tools'> {
  params: string;
  result: string | null;
  tools: string;
}

function toJob(row: JobRow): Job {
  return {
    ...row,
    params: JSON.parse(row.params) as Record<string, unknown>,
    result: row.result === null ? null : (JSON.parse(row.result) as JobResult),
    tools: JSON.parse(row.tools) as string[],
  };
}

/**
 * Inserisce un job già `running` (lo spawn segue subito dopo); i run nuovi hanno sempre il log (J11).
 * `tools` = strumenti usati dal run (J3), che chi avvia calcola dai `params` con `RUN_TOOLS[kind]`:
 * da qui in poi sono un fatto del run. Omessi (test, righe vecchie) → li riempie `fillMissingRunTools`.
 */
export function insertJob(kind: JobKind, params: object, tools: readonly string[] = [], detached = false): Job {
  const now = nowIso();
  const info = db
    .prepare(
      `INSERT INTO jobs (kind, params, state, started_at, created_at, logged, tools, detached)
       VALUES (?, ?, 'running', ?, ?, 1, ?, ?)`,
    )
    .run(kind, JSON.stringify(params), now, now, JSON.stringify(tools), detached ? 1 : 0);
  return findJob(Number(info.lastInsertRowid))!;
}

export function findJob(id: number): Job | undefined {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
  return row ? toJob(row) : undefined;
}

/**
 * Il job più recente (qualsiasi stato), o `undefined` se non ne è mai partito uno. Le analisi singole
 * (`detached`) sono escluse: non sono job e non vanno nel banner (P-13).
 */
export function findLatestJob(): Job | undefined {
  const row = db.prepare('SELECT * FROM jobs WHERE detached = 0 ORDER BY id DESC LIMIT 1').get() as JobRow | undefined;
  return row ? toJob(row) : undefined;
}

export function findRunningJobs(): Job[] {
  const rows = db.prepare(`SELECT * FROM jobs WHERE state = 'running' ORDER BY id DESC`).all() as JobRow[];
  return rows.map(toJob);
}

/** Job `succeeded` di `kind` con `params.icpId` = `icpId`, dal più recente (ricerche lookalike, P-4). */
export function findSucceededJobsForIcp(kind: JobKind, icpId: number, limit: number): Job[] {
  const rows = db
    .prepare(
      `SELECT * FROM jobs WHERE kind = ? AND state = 'succeeded' AND json_extract(params, '$.icpId') = ?
       ORDER BY id DESC LIMIT ?`,
    )
    .all(kind, icpId, limit) as JobRow[];
  return rows.map(toJob);
}

/**
 * Run che usano uno strumento (J6), dal più recente **per data di avvio** (non per id: il seed e2e scrive
 * run di giorni diversi). `failedOnly` = filtro "Falliti" della pagina dello strumento (l'esito del run,
 * com'è nella colonna Esito). Include le analisi singole (`detached`, J15).
 */
export function findRunsOfTool(tool: string, opts: { failedOnly?: boolean; limit: number; offset: number }): Job[] {
  const rows = db
    .prepare(
      `SELECT * FROM jobs WHERE ${toolCondition}${opts.failedOnly ? ` AND state = 'failed'` : ''}
       ORDER BY COALESCE(started_at, created_at) DESC, id DESC LIMIT ? OFFSET ?`,
    )
    .all(tool, opts.limit, opts.offset) as JobRow[];
  return rows.map(toJob);
}

export function countRunsOfTool(tool: string, failedOnly = false): number {
  return db
    .prepare(`SELECT COUNT(*) FROM jobs WHERE ${toolCondition}${failedOnly ? ` AND state = 'failed'` : ''}`)
    .pluck()
    .get(tool) as number;
}

/** Storico, dal più recente. */
export function findJobs(limit: number): Job[] {
  const rows = db.prepare('SELECT * FROM jobs ORDER BY id DESC LIMIT ?').all(limit) as JobRow[];
  return rows.map(toJob);
}

export function setJobPid(id: number, pid: number): void {
  db.prepare('UPDATE jobs SET pid = ? WHERE id = ?').run(pid, id);
}

/**
 * Esito del wrapper: vince sempre (è lui a sapere com'è andata). I testi si salvano già **senza** i valori
 * delle chiavi (J10): un errore di terzi può portarseli dietro, e da qui finiscono in banner, toast e API.
 */
export function completeJob(id: number, outcome: RunOutcomeWrite): void {
  const result = outcome.state === 'succeeded' ? JSON.stringify(redactResult(outcome.result)) : null;
  db.prepare('UPDATE jobs SET state = ?, result = ?, error = ?, finished_at = ? WHERE id = ?').run(
    outcome.state,
    result,
    outcome.state === 'failed' ? redactSecrets(outcome.error) : null,
    nowIso(),
    id,
  );
}

/**
 * `failed` solo se il job è ancora `running`: usato dal parent (figlio uscito senza
 * esito, pid morto), non sovrascrive mai un esito già scritto dal wrapper.
 * Ritorna `true` se ha marcato il job ora.
 */
export function failIfRunning(id: number, error: string): boolean {
  const info = db
    .prepare(`UPDATE jobs SET state = 'failed', error = ?, finished_at = ? WHERE id = ? AND state = 'running'`)
    .run(redactSecrets(error), nowIso(), id);
  return info.changes > 0;
}
