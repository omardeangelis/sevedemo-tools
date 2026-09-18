import type { JobKind, JobResult, JobState } from '../jobs/types.js';
import { db, nowIso } from './index.js';

/*
 * Repository della tabella `jobs` (PLAN crm-foundation §6, P7). Solo accesso ai dati:
 * spawn, guard "un solo job" e riconciliazione dei pid morti stanno in `server/jobs.ts`;
 * l'esito terminale lo scrive il wrapper del processo figlio (`server/job-entry.ts`).
 */

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
}

interface JobRow extends Omit<Job, 'params' | 'result'> {
  params: string;
  result: string | null;
}

function toJob(row: JobRow): Job {
  return {
    ...row,
    params: JSON.parse(row.params) as Record<string, unknown>,
    result: row.result === null ? null : (JSON.parse(row.result) as JobResult),
  };
}

/** Inserisce un job già `running` (lo spawn segue subito dopo). */
export function insertJob(kind: JobKind, params: object): Job {
  const now = nowIso();
  const info = db
    .prepare(
      `INSERT INTO jobs (kind, params, state, started_at, created_at) VALUES (?, ?, 'running', ?, ?)`,
    )
    .run(kind, JSON.stringify(params), now, now);
  return findJob(Number(info.lastInsertRowid))!;
}

export function findJob(id: number): Job | undefined {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
  return row ? toJob(row) : undefined;
}

/** Il job più recente (qualsiasi stato), o `undefined` se non ne è mai partito uno. */
export function findLatestJob(): Job | undefined {
  const row = db.prepare('SELECT * FROM jobs ORDER BY id DESC LIMIT 1').get() as JobRow | undefined;
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

/** Storico, dal più recente. */
export function findJobs(limit: number): Job[] {
  const rows = db.prepare('SELECT * FROM jobs ORDER BY id DESC LIMIT ?').all(limit) as JobRow[];
  return rows.map(toJob);
}

export function setJobPid(id: number, pid: number): void {
  db.prepare('UPDATE jobs SET pid = ? WHERE id = ?').run(pid, id);
}

/** Esito del wrapper: vince sempre (è lui a sapere com'è andata). */
export function completeJob(
  id: number,
  outcome: { state: 'succeeded'; result: JobResult } | { state: 'failed'; error: string },
): void {
  db.prepare('UPDATE jobs SET state = ?, result = ?, error = ?, finished_at = ? WHERE id = ?').run(
    outcome.state,
    outcome.state === 'succeeded' ? JSON.stringify(outcome.result) : null,
    outcome.state === 'failed' ? outcome.error : null,
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
    .run(error, nowIso(), id);
  return info.changes > 0;
}
