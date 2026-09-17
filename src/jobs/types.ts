/**
 * Tipi condivisi dei job asincroni (PLAN crm-foundation §6 `jobs`, P7).
 * Ogni kind vive in `jobs/<kind>.ts` (handler + deps) ed è registrato in `jobs/handlers.ts`.
 */

export const JOB_KINDS = ['sync_interactions', 'source_company', 'enrich', 'analyze'] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export const JOB_STATES = ['running', 'succeeded', 'failed'] as const;
export type JobState = (typeof JOB_STATES)[number];

/**
 * Anteprima uniforme mostrata prima di ogni avvio: `blockers` non vuoti = il job
 * non parte; `est_cost_usd` è `null` quando la stima non è disponibile (mai inventata).
 */
export interface JobPreview {
  counts: Record<string, number>;
  est_cost_usd: number | null;
  warnings: string[];
  blockers: string[];
}

/** Esito terminale scritto nella colonna `jobs.result`. */
export interface JobResult {
  summary: string;
  counts: Record<string, number>;
  warnings?: string[];
}

/**
 * Handler di un kind: riceve i `params` salvati sul job e le deps iniettate
 * (reali o fake). Ogni `jobs/<kind>.ts` tipizza i propri `P`/`D`; il registry
 * usa i default larghi così resta un `Record<JobKind, JobHandler>`.
 */
export type JobHandler<P = any, D = any> = (params: P, deps: D) => Promise<JobResult>;

/** Lanciata dagli stub di T3 finché il task proprietario non implementa il pezzo. */
export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`Non ancora implementato: ${what}`);
    this.name = 'NotImplementedError';
  }
}
