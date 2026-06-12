import { spawn } from 'node:child_process';
import path from 'node:path';
import { ROOT } from '../config.js';
import { nowIso, today } from '../db/index.js';
import { kvGet, kvSet } from '../db/kv.js';

export const JOB_KV_KEY = 'ui_job:daily';

export type JobState = 'idle' | 'running' | 'succeeded' | 'failed';

export interface JobStatus {
  state: JobState;
  started_at?: string;
  finished_at?: string;
  pid?: number;
  run_date?: string;
  error?: string;
}

export interface StartOptions {
  /** Override del comando per test/smoke: mai la pipeline reale nei test. */
  command?: string;
  args?: string[];
}

export class RunInProgressError extends Error {
  constructor() {
    super('Un run è già in corso.');
    this.name = 'RunInProgressError';
  }
}

function readStatus(): JobStatus {
  const raw = kvGet(JOB_KV_KEY);
  if (!raw) return { state: 'idle' };
  try {
    return JSON.parse(raw) as JobStatus;
  } catch {
    return { state: 'idle' };
  }
}

function writeStatus(status: JobStatus): void {
  kvSet(JOB_KV_KEY, JSON.stringify(status));
}

/** Scrive l'esito terminale preservando i campi del record corrente (usato dal wrapper). */
export function writeTerminalStatus(
  patch: Partial<JobStatus> & { state: 'succeeded' | 'failed' },
): void {
  writeStatus({ ...readStatus(), finished_at: nowIso(), ...patch });
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

/**
 * Stato effettivo del job: `idle` se mai lanciato. Un record `running` con
 * pid morto e nessuno stato terminale (es. figlio killato durante un restart
 * del server) viene riscritto come `failed`.
 */
export function getJobStatus(): JobStatus {
  const status = readStatus();
  if (status.state === 'running' && status.pid !== undefined && !isAlive(status.pid)) {
    const failed: JobStatus = {
      ...status,
      state: 'failed',
      finished_at: nowIso(),
      error: 'Run interrotto (processo non più attivo).',
    };
    writeStatus(failed);
    return failed;
  }
  return status;
}

/**
 * Avvia il run daily come processo figlio (wrapper tsx). Lo stato vive in kv:
 * il wrapper scrive lui stesso l'esito terminale, così sopravvive a un
 * restart del server.
 */
export function startDailyRun(opts: StartOptions = {}): JobStatus {
  if (getJobStatus().state === 'running') throw new RunInProgressError();

  const running: JobStatus = { state: 'running', started_at: nowIso(), run_date: today() };
  writeStatus(running);

  const command = opts.command ?? path.join(ROOT, 'node_modules', '.bin', 'tsx');
  const args = opts.args ?? [path.join(ROOT, 'src', 'server', 'run-daily-job.ts')];
  const child = spawn(command, args, {
    cwd: ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderrTail = '';
  child.stdout.on('data', (d: Buffer) => process.stdout.write(d));
  child.stderr.on('data', (d: Buffer) => {
    process.stderr.write(d);
    stderrTail = (stderrTail + d.toString()).slice(-2000);
  });

  // Fallback per crash duri: se il figlio esce senza aver scritto lo stato
  // terminale (in condizioni normali lo scrive il wrapper), lo marca failed.
  const markCrashed = (detail: string): void => {
    const status = readStatus();
    if (status.state !== 'running') return; // l'esito del wrapper vince sempre
    if (status.pid !== undefined && status.pid !== child.pid) return;
    writeStatus({ ...status, state: 'failed', finished_at: nowIso(), error: detail });
  };
  child.on('exit', (code, signal) => {
    markCrashed(
      stderrTail.trim() ||
        `Run interrotto inaspettatamente (exit ${code ?? `segnale ${signal}`}).`,
    );
  });
  child.on('error', (err) => markCrashed(`Impossibile avviare il run: ${err.message}`));

  // Il record running è già scritto: aggiungiamo il pid solo se il figlio non
  // ha già scritto il suo stato terminale (figli istantanei nei test).
  const current = readStatus();
  if (current.state !== 'running') return current;
  const withPid = { ...current, pid: child.pid };
  writeStatus(withPid);
  return withPid;
}
