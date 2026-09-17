import * as analyze from './analyze.js';
import * as enrich from './enrich.js';
import * as sourceCompany from './source-company.js';
import * as syncInteractions from './sync-interactions.js';
import type { JobHandler, JobKind } from './types.js';

/*
 * Registry dei job, pre-cablato da crm-foundation T3 (regola anti co-edit, PLAN §8):
 * nessun task edita questo file. Ogni kind si implementa nel proprio `jobs/<kind>.ts`
 * sostituendo gli stub `Deps`/`handler`/`realDeps`, e il registry li vede da sé.
 */

/** Handler per kind: il wrapper del processo figlio (T6) chiama `HANDLERS[kind](params, deps)`. */
export const HANDLERS: Record<JobKind, JobHandler> = {
  sync_interactions: syncInteractions.handler,
  source_company: sourceCompany.handler,
  enrich: enrich.handler,
  analyze: analyze.handler,
};

/** Tipo delle deps di ogni kind (segue le definizioni nei file dei kind). */
export type DepsByKind = {
  sync_interactions: syncInteractions.Deps;
  source_company: sourceCompany.Deps;
  enrich: enrich.Deps;
  analyze: analyze.Deps;
};

/** Factory delle deps reali per kind: la usa il dispatcher `resolveDeps(kind)` (T6). */
export const REAL_DEPS: { [K in JobKind]: () => DepsByKind[K] } = {
  sync_interactions: syncInteractions.realDeps,
  source_company: sourceCompany.realDeps,
  enrich: enrich.realDeps,
  analyze: analyze.realDeps,
};
