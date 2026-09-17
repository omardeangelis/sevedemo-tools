/**
 * Wrapper eseguito come processo figlio del server (`tsx src/server/job-entry.ts <jobId>`,
 * crm-foundation T6): legge la riga `jobs`, chiama `HANDLERS[kind](params, deps)` e scrive
 * LUI l'esito terminale, così l'esito sopravvive a un restart del server durante il job.
 * Importabile senza effetti collaterali: `runJob` si testa in-process.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { completeJob, findJob, type Job } from '../db/jobs.js';
import { resolveDeps } from '../jobs/deps.js';
import { HANDLERS } from '../jobs/handlers.js';
import type { JobHandler, JobKind } from '../jobs/types.js';

export interface RunJobOptions {
  /** Handler per kind al posto del registry (test); i kind assenti usano `HANDLERS`. */
  handlers?: Partial<Record<JobKind, JobHandler>>;
  /** Risoluzione delle deps al posto di `resolveDeps` (test). */
  resolveDeps?: (kind: JobKind) => unknown;
}

/**
 * Attribuzione dell'errore per l'utente (FLOW: actor / configurazione / processo): i
 * messaggi già prefissati `actor:`/`config:`/`process:` restano, il resto è `process:`.
 */
export function attributeError(err: unknown): string {
  const message = (err instanceof Error ? err.message : String(err)).trim() || 'errore sconosciuto';
  return /^(actor|config|process):/.test(message) ? message : `process: ${message}`;
}

/** Esegue il job `jobId` e ne scrive l'esito. Ritorna la riga finale. */
export async function runJob(jobId: number, opts: RunJobOptions = {}): Promise<Job> {
  const job = findJob(jobId);
  if (!job) throw new Error(`process: job ${jobId} inesistente`);
  // Già terminato (es. marcato failed dal server): non si riesegue un job pagato.
  if (job.state !== 'running') return job;

  try {
    const deps = (opts.resolveDeps ?? resolveDeps)(job.kind);
    const handler = opts.handlers?.[job.kind] ?? HANDLERS[job.kind];
    const result = await handler(job.params, deps);
    completeJob(job.id, { state: 'succeeded', result });
  } catch (err) {
    console.error(err);
    completeJob(job.id, { state: 'failed', error: attributeError(err) });
  }
  return findJob(job.id)!;
}

const isEntry = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntry) {
  const jobId = Number(process.argv[2] ?? process.env.JOB_ID);
  try {
    const done = await runJob(jobId);
    process.exitCode = done.state === 'succeeded' ? 0 : 1;
  } catch (err) {
    // Riga inesistente: nessun esito da scrivere, il parent vede l'uscita.
    console.error(err);
    process.exitCode = 1;
  }
  // Esito già scritto: handle rimasti aperti (client HTTP, timer) non devono tenere vivo il figlio.
  setTimeout(() => process.exit(), 500).unref();
}
