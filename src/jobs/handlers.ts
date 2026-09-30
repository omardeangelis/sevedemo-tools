import * as analyze from './analyze.js';
import * as apolloPeople from './apollo-people.js';
import * as enrichCompanies from './enrich-companies.js';
import * as enrich from './enrich.js';
import * as generateProfile from './generate-profile.js';
import * as lookalikeCompanies from './lookalike-companies.js';
import * as sourceCompany from './source-company.js';
import * as syncInteractions from './sync-interactions.js';
import type { ToolId } from '../runs/tools.js';
import type { JobHandler, JobKind, JobPreview } from './types.js';

/*
 * Registry dei job, pre-cablato da crm-foundation T3, da apollo-lookalike T5 e da own-profile-services T1
 * (`generate_profile`, stub fino a M4) — regola anti co-edit, PLAN §8: la logica sta nei `jobs/<kind>.ts`
 * (`Deps`/`handler`/`realDeps`/`configBlockers`/`previewFromParams`/`toolsOf`), qui solo le voci.
 * `RETRY_PREVIEWS` l'ha aggiunto people-first-crm T17, `RUN_TOOLS` il T30.
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
  generate_profile: generateProfile.handler,
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
  generate_profile: generateProfile.Deps;
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
  generate_profile: generateProfile.realDeps,
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
  generate_profile: generateProfile.configBlockers,
};

/**
 * Preview del kind dai `params` salvati di un job (people-first-crm T17, SPEC J12): "Riprova…" apre
 * questa preview (`GET /api/jobs/:id/retry-preview`) con conteggi, stima e blocchi ricalcolati adesso,
 * uguale a quella della route del kind con gli stessi parametri. Senza il blocker "job in corso", che
 * aggiunge il server (`withRunningBlocker`).
 */
export const RETRY_PREVIEWS: Record<JobKind, (params: any) => JobPreview> = {
  sync_interactions: syncInteractions.previewFromParams,
  source_company: sourceCompany.previewFromParams,
  enrich: enrich.previewFromParams,
  analyze: analyze.previewFromParams,
  enrich_companies: enrichCompanies.previewFromParams,
  lookalike_companies: lookalikeCompanies.previewFromParams,
  apollo_people: apolloPeople.previewFromParams,
  generate_profile: generateProfile.previewFromParams,
};

/**
 * Strumenti esterni usati da un run del kind (people-first-crm SPEC J3, T30), calcolati dai `params`
 * all'avvio e salvati in `jobs.tools`: da lì in poi sono un fatto del run, non uno stato derivato
 * (P-12). I run creati prima li ricevono da `fillMissingRunTools` (P-28).
 */
export const RUN_TOOLS: Record<JobKind, (params: any) => ToolId[]> = {
  sync_interactions: syncInteractions.toolsOf,
  source_company: sourceCompany.toolsOf,
  enrich: enrich.toolsOf,
  analyze: analyze.toolsOf,
  enrich_companies: enrichCompanies.toolsOf,
  lookalike_companies: lookalikeCompanies.toolsOf,
  apollo_people: apolloPeople.toolsOf,
  generate_profile: generateProfile.toolsOf,
};
