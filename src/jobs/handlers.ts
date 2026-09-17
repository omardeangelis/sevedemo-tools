import * as analyze from './analyze.js';
import * as apolloPeople from './apollo-people.js';
import * as enrichCompanies from './enrich-companies.js';
import * as enrich from './enrich.js';
import * as lookalikeCompanies from './lookalike-companies.js';
import * as sourceCompany from './source-company.js';
import * as syncInteractions from './sync-interactions.js';
import type { JobHandler, JobKind } from './types.js';

/*
 * Registry dei job, pre-cablato da crm-foundation T3 e da apollo-lookalike T5 (regola anti co-edit,
 * PLAN §8): nessun task edita questo file, salvo T6 per completare `CONFIG_BLOCKERS`. Ogni kind si
 * implementa nel proprio `jobs/<kind>.ts` sostituendo gli stub `Deps`/`handler`/`realDeps`/
 * `configBlockers`, e il registry li vede da sé.
 */

/** Handler per kind: il wrapper del processo figlio (T6) chiama `HANDLERS[kind](params, deps)`. */
export const HANDLERS: Record<JobKind, JobHandler> = {
  sync_interactions: syncInteractions.handler,
  source_company: sourceCompany.handler,
  enrich: enrich.handler,
  analyze: analyze.handler,
  enrich_companies: enrichCompanies.handler,
  lookalike_companies: lookalikeCompanies.handler,
  apollo_people: apolloPeople.handler,
};

/** Tipo delle deps di ogni kind (segue le definizioni nei file dei kind). */
export type DepsByKind = {
  sync_interactions: syncInteractions.Deps;
  source_company: sourceCompany.Deps;
  enrich: enrich.Deps;
  analyze: analyze.Deps;
  enrich_companies: enrichCompanies.Deps;
  lookalike_companies: lookalikeCompanies.Deps;
  apollo_people: apolloPeople.Deps;
};

/** Factory delle deps reali per kind: la usa il dispatcher `resolveDeps(kind)` (T6). */
export const REAL_DEPS: { [K in JobKind]: () => DepsByKind[K] } = {
  sync_interactions: syncInteractions.realDeps,
  source_company: sourceCompany.realDeps,
  enrich: enrich.realDeps,
  analyze: analyze.realDeps,
  enrich_companies: enrichCompanies.realDeps,
  lookalike_companies: lookalikeCompanies.realDeps,
  apollo_people: apolloPeople.realDeps,
};

/**
 * Blocker di configurazione per kind, calcolati dai `params` salvati (chiave mancante, lista
 * archiviata o sparita, …): ogni kind esporta `configBlockers` dal proprio file, usato dalla sua
 * preview/avvio e da "Riprova" (`retryJob` → 400 `blocked`, apollo-lookalike T6). Stessi testi della
 * preview; niente blocker di dato né "job in corso".
 */
export const CONFIG_BLOCKERS: Record<JobKind, (params: any) => string[]> = {
  sync_interactions: syncInteractions.configBlockers,
  source_company: sourceCompany.configBlockers,
  enrich: enrich.configBlockers,
  analyze: analyze.configBlockers,
  enrich_companies: enrichCompanies.configBlockers,
  lookalike_companies: lookalikeCompanies.configBlockers,
  apollo_people: apolloPeople.configBlockers,
};
