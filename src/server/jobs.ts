import { spawn } from 'node:child_process';
import path from 'node:path';
import { ROOT } from '../config.js';
import { nowIso, today } from '../db/index.js';
import { kvGet, kvSet } from '../db/kv.js';
import type { EnrichSummary } from '../pipeline/enrich-selection.js';

export const JOB_KV_KEY = 'ui_job:daily';
export const ENRICHMENT_JOB_KV_KEY = 'ui_job:enrichment';

export type JobState = 'idle' | 'running' | 'succeeded' | 'failed';

export interface JobStatus {
  state: JobState;
  started_at?: string;
  finished_at?: string;
  pid?: number;
  run_date?: string;
  /** Cosa stava arricchendo il job enrichment (informativo per la UI). */
  target?: { date: string; bucket?: string; contactId?: number };
  /** Esito aggregato del job enrichment. */
  result?: EnrichSummary;
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

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: il processo esiste ma non è nostro.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

interface StartParams {
  command?: string;
  args?: string[];
  /** Argv di default (script + parametri) quando non c'è override. */
  defaultArgs: string[];
  /** Campi extra sul record `running` iniziale (es. run_date, target). */
  initial?: Partial<JobStatus>;
  /** Guard aggiuntiva: se ritorna true il run è rifiutato (es. un altro job in corso). */
  alsoBlockedBy?: () => boolean;
}

/**
 * Crea un controller di job basato su una chiave kv. Lo stato vive in kv così da
 * sopravvivere a un restart del server (il wrapper figlio scrive lui l'esito
 * terminale). Daily ed enrichment sono due istanze indipendenti dello stesso meccanismo.
 */
function createJobController(kvKey: string) {
  function readStatus(): JobStatus {
    const raw = kvGet(kvKey);
    if (!raw) return { state: 'idle' };
    try {
      return JSON.parse(raw) as JobStatus;
    } catch {
      return { state: 'idle' };
    }
  }

  function writeStatus(status: JobStatus): void {
    kvSet(kvKey, JSON.stringify(status));
  }

  /** Scrive l'esito terminale preservando i campi del record corrente (usato dal wrapper). */
  function writeTerminalStatus(patch: Partial<JobStatus> & { state: 'succeeded' | 'failed' }): void {
    writeStatus({ ...readStatus(), finished_at: nowIso(), ...patch });
  }

  /**
   * Stato effettivo del job: `idle` se mai lanciato. Un record `running` con pid
   * morto e nessuno stato terminale (es. figlio killato durante un restart del
   * server) viene riscritto come `failed`.
   */
  function getJobStatus(): JobStatus {
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

  function start(opts: StartParams): JobStatus {
    if (getJobStatus().state === 'running') throw new RunInProgressError();
    if (opts.alsoBlockedBy?.()) throw new RunInProgressError();

    const running: JobStatus = { state: 'running', started_at: nowIso(), ...opts.initial };
    writeStatus(running);

    const command = opts.command ?? path.join(ROOT, 'node_modules', '.bin', 'tsx');
    const args = opts.args ?? opts.defaultArgs;
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

  return { kvKey, readStatus, writeStatus, writeTerminalStatus, getJobStatus, start };
}

const daily = createJobController(JOB_KV_KEY);
const enrichment = createJobController(ENRICHMENT_JOB_KV_KEY);

// ── Controller daily (export retro-compatibili: app.ts, run-daily-job.ts, test) ──

export const writeTerminalStatus = daily.writeTerminalStatus;
export const getJobStatus = daily.getJobStatus;

/** Avvia il run daily come processo figlio (wrapper tsx). */
export function startDailyRun(opts: StartOptions = {}): JobStatus {
  return daily.start({
    command: opts.command,
    args: opts.args,
    defaultArgs: [path.join(ROOT, 'src', 'server', 'run-daily-job.ts')],
    initial: { run_date: today() },
  });
}

// ── Controller enrichment (nuovo) ──

export interface EnrichmentParams {
  date: string;
  bucket?: string;
  contactId?: number;
}

export const writeEnrichmentTerminalStatus = enrichment.writeTerminalStatus;
export const getEnrichmentJobStatus = enrichment.getJobStatus;

/**
 * Avvia l'enrichment progressivo come processo figlio. Rifiuta se è già in corso
 * un enrichment **o** un run daily (entrambi scrivono sul DB).
 */
export function startEnrichmentRun(params: EnrichmentParams, opts: StartOptions = {}): JobStatus {
  return enrichment.start({
    command: opts.command,
    args: opts.args,
    defaultArgs: [
      path.join(ROOT, 'src', 'server', 'run-enrichment-job.ts'),
      params.date,
      params.bucket ?? '',
      params.contactId != null ? String(params.contactId) : '',
    ],
    initial: {
      target: {
        date: params.date,
        bucket: params.bucket,
        contactId: params.contactId,
      },
    },
    alsoBlockedBy: () => daily.getJobStatus().state === 'running',
  });
}
