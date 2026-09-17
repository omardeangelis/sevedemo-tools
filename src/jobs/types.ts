/**
 * Tipi condivisi dei job asincroni (PLAN crm-foundation §6 `jobs`, P7).
 * Ogni kind vive in `jobs/<kind>.ts` (handler + deps) ed è registrato in `jobs/handlers.ts`.
 *
 * Nota: questo file è importato da `db/schema.ts` (CHECK di `jobs.kind`): niente import a runtime
 * da `db/` o da moduli con effetti collaterali, solo tipi.
 */

export const JOB_KINDS = [
  'sync_interactions',
  'source_company',
  'enrich',
  'analyze',
  // apollo-lookalike (T5): arricchimento aziende, ricerca aziende simili (+ pipeline), contatti Apollo.
  'enrich_companies',
  'lookalike_companies',
  'apollo_people',
] as const;
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

/** Lanciata dagli stub finché il task proprietario non implementa il pezzo. */
export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`Non ancora implementato: ${what}`);
    this.name = 'NotImplementedError';
  }
}

// ===========================================================================
// Contratto JSON dei job Apollo (apollo-lookalike T5, PLAN §12 aggiornato con S-6)
// ===========================================================================
//
// `jobs.params` e `jobs.result.counts` dei kind Apollo sono letti da preview, card "Aziende simili",
// "Ricerche precedenti", "Riusa questi filtri", "Riprova" (stessi `params`) e dal frontend
// (`web/src/api/types.ts` li rispecchia). I `params` li **congela la route** all'avvio (valori già
// validati e risolti: nessun default lasciato all'handler); `result.counts` contiene **sempre tutte**
// le chiavi del kind (0 quando non applicabile), anche negli esiti parziali (S-4, P-12).
//
// Convenzione delle `Deps` dei tre kind Apollo (T5): ogni funzione esegue **una** richiesta Apollo
// costruita con i builder di `src/apollo/requests.ts` e ritorna il **JSON grezzo** della risposta
// (`Promise<unknown>`); l'handler lo legge con i mapper tolleranti di `src/apollo/mappers/*`
// (`mapOrganizations`, `mapPeople`). Così le deps fake del server e2e (T16) restituiscono le fixture
// JSON così come sono e i mapper girano davvero anche negli scenari e2e. Gli errori sono quelli del
// client (`ApolloConfigError` `config:`, `ApolloRateLimitError`/`ApolloProviderError` `actor:apollo:<op>:`).
// Lotti: `enrichOrganizations` e `matchPeople` ricevono al massimo `APOLLO_BULK_MAX` (10) elementi
// per chiamata: è l'handler a dividere con `chunk()`.
//
// Crediti: `credits_used` è contato dall'handler sugli esiti (1 per organizzazione arricchita trovata,
// 1 per pagina di ricerca aziende letta, 1 per persona rivelata dal match); le preview dichiarano
// `est_credits` come tetto e `est_cost_usd = est_credits × APOLLO_CREDIT_USD` oppure `null`.

/** Opzioni del passo contatti: comuni a `apollo_people` e alla pipeline `autoContacts` (SPEC F1, H1). */
export interface ContactsOptions {
  /** Lista di destinazione (attiva) in cui entrano i prospect. */
  listId: number;
  /** Titoli Apollo (`person_titles`): default `target_roles` dell'ICP; `[]` = persone qualunque (warning F3). */
  roles: string[];
  /** Seniority Apollo (`APOLLO_SENIORITIES`); `[]` = nessun filtro. */
  seniorities: string[];
  /** Località delle persone (`person_locations`): default `target_locations` dell'ICP; `[]` = ovunque. */
  locations: string[];
  /** Tetto di persone per azienda (1–100, default `APOLLO_PEOPLE_PER_COMPANY`). */
  perCompany: number;
}

// ---------------------------------------------------------------------------
// enrich_companies — arricchimento Apollo delle aziende (SPEC C, PLAN T7c)
// ---------------------------------------------------------------------------
// Route: `POST /api/icps/:id/enrich-companies {retryNotFound?}` (referenze dell'ICP) e
// `POST /api/companies/:id/enrich-apollo` (singola azienda, `icpId` assente).
// Preview `counts`: {references, with_domain, to_enrich, skipped_fresh, est_credits}.

/** `params` di `enrich_companies`. */
export interface EnrichCompaniesParams {
  /** Aziende da arricchire già filtrate dalla preview (con dominio, non arricchite di recente). */
  companyIds: number[];
  /** ICP delle referenze; assente per l'arricchimento della singola azienda dal dettaglio. */
  icpId?: number;
  /** `true`: ritenta anche le aziende "non trovate" entro `FRESHNESS_DAYS` (SPEC C2). */
  retryNotFound: boolean;
}

/** `result.counts` di `enrich_companies`. */
export interface EnrichCompaniesCounts {
  /** Organizzazioni trovate e salvate (`apollo_org_id` valorizzato). */
  enriched: number;
  /** Aziende senza esito Apollo: `apollo_enriched_at = now`, `apollo_org_id = null`. */
  not_found: number;
  /** Unioni automatiche fatte da `upsertCompany` (Regole di unione, B6). */
  merged: number;
  /** Aziende che hanno acquisito l'URL LinkedIn dall'esito Apollo (B7). */
  linkedin_acquired: number;
  /** Esiti saltati per chiavi in conflitto (marcati `{outcome:'key_conflict'}` in `apollo_json`). */
  key_conflicts: number;
  credits_used: number;
}

// ---------------------------------------------------------------------------
// lookalike_companies — ricerca aziende simili, con pipeline opzionale (SPEC D, H; PLAN T7a/T7b/T9)
// ---------------------------------------------------------------------------
// Route (T7a): `POST /api/icps/:id/lookalike {pages, perPage?, keywords, ranges, locations, restart?,
// autoContacts?}`; preview `GET /api/icps/:id/lookalike/preview` (formato della query in
// `src/server/routes/lookalike.ts`).
// Preview `counts`: {pages, per_page, start_page, est_credits, requests} con (S-7) `est_credits` =
// pagine + pagine × `perPage` (tetto: ricerca + arricchimento delle aziende nuove) e `requests` =
// pagine + ⌈pagine × `perPage` / 10⌉ (+ con `autoContacts` le stime del passo contatti, T9).
// "Ultima ricerca" / "continua dalla pagina N" (D6, P-4) = ultimo job `succeeded` con lo stesso
// `params.icpId` (`lastLookalikeRun` in `src/db/candidates.ts`): stessi filtri (`filtersEqual`) **e**
// stesso `params.perPage` → `result.counts.last_page + 1` se `last_page_declared === perPage`
// (pagina piena), altrimenti ricerca esaurita.

/** Aziende per pagina ammesse nella ricerca (S-7): default 25. */
export type LookalikePerPage = 25 | 50 | 100;

/** `params` di `lookalike_companies`. */
export interface LookalikeParams {
  icpId: number;
  /** Pagine da leggere (1 – `APOLLO_MAX_COMPANY_PAGES`), `perPage` aziende l'una. */
  pages: number;
  /** Aziende per pagina (S-7): 25 · 50 · 100. Assente nei job anteriori a S-7 (letto come 25). */
  perPage: LookalikePerPage;
  /** Prima pagina da leggere: 1, oppure `last_page + 1` della ricerca precedente con gli stessi filtri. */
  startPage: number;
  /** Filtri confermati (etichette normalizzate: parole chiave, fasce `A-B`/`N+`, località). */
  keywords: string[];
  ranges: string[];
  locations: string[];
  /** `filtersHash({keywords, ranges, locations})` di `src/apollo/similarity.ts` (confronto D6). */
  filtersHash: string;
  /** "Ricomincia dalla pagina 1" scelto esplicitamente (sempre scritto dalla route). */
  restart?: boolean;
  /** Pipeline opt-in (SPEC H): `null` = solo ricerca aziende. */
  autoContacts: ContactsOptions | null;
}

/** `result.counts` di `lookalike_companies` (passo aziende). */
export interface LookalikeCounts {
  /** Aziende riconosciute nelle pagine lette. */
  read: number;
  new_candidates: number;
  /** Già candidate (qualunque stato) o referenze dell'ICP: nessuna candidata nuova. */
  known: number;
  /** Candidate nuove senza URL LinkedIn. */
  without_linkedin: number;
  /** Candidate nuove con `score_parts.location === null` (sede non disponibile). */
  without_location: number;
  merged: number;
  /** Referenze dell'ICP ritrovate con l'altra chiave e completate (D8). */
  references_completed: number;
  key_conflicts: number;
  /** Aziende senza dominio né URL LinkedIn, saltate (D9). */
  no_keys: number;
  /** Aziende nuove arricchite nello stesso job prima del punteggio (S-7, 1 credito ciascuna). */
  enriched: number;
  pages_read: number;
  /** Ultima pagina letta con successo (0 se nessuna). */
  last_page: number;
  /** Aziende dichiarate da Apollo nell'ultima pagina letta: < `perPage` = ricerca esaurita (D6). */
  last_page_declared: number;
  /** Pagine lette + aziende arricchite. */
  credits_used: number;
  requests: number;
}

/** `result.counts` del passo contatti in pipeline: le chiavi di `ApolloPeopleCounts` con prefisso `contacts_`. */
export type LookalikeContactsCounts = { [K in keyof ApolloPeopleCounts as `contacts_${K}`]: number };

/** `result.counts` completo di `lookalike_companies`: le chiavi `contacts_*` ci sono solo con `autoContacts`. */
export type LookalikeResultCounts = LookalikeCounts & Partial<LookalikeContactsCounts>;

// ---------------------------------------------------------------------------
// apollo_people — trova contatti nelle aziende scelte (SPEC F, S-6; PLAN T8)
// ---------------------------------------------------------------------------
// Route: `POST /api/icps/:id/contacts {companyIds, listId, roles, seniorities, locations, perCompany}`
// (anche dal dettaglio azienda, SPEC F12: `:id` = ICP della lista scelta, `companyIds=[id]`).
// Flusso S-6: una ricerca gratuita per azienda (`mixed_people/api_search`, `per_page = perCompany`) +
// `people/bulk_match` per id delle persone trovate (lotti da 10, 1 credito a persona rivelata).
// Preview `counts`: {companies, with_domain, without_domain, per_company, requests, est_credits}
// con `requests` = aziende con dominio + ⌈aziende con dominio × perCompany / 10⌉ (tetto) ed
// `est_credits` = aziende con dominio × perCompany (tetto, F2).

/** `params` di `apollo_people`. */
export interface ApolloPeopleParams extends ContactsOptions {
  /** ICP della lista (fornisce i default e l'attribuzione). */
  icpId: number;
  /** Aziende scelte dal triage (o la singola azienda del dettaglio); quelle senza dominio si contano. */
  companyIds: number[];
}

/** `result.counts` di `apollo_people` (e, con prefisso `contacts_`, del passo contatti in pipeline). */
export interface ApolloPeopleCounts {
  /** Persone restituite dalle ricerche. */
  people_read: number;
  /** Persone rivelate dal match (con dati). */
  people_matched: number;
  /** Aziende elaborate fino in fondo (ricerca + match + scritture). */
  companies_done: number;
  /** Aziende dei `params` ancora esistenti (un id sparito dopo un'unione è escluso con warning). */
  companies: number;
  /** Aziende escluse perché senza dominio. */
  without_domain: number;
  /** Prospect aggiunti alla lista (nuove membership). */
  added: number;
  prospects_new: number;
  prospects_seen: number;
  already_in_list: number;
  /** Persone rivelate senza URL LinkedIn: nessun prospect (F8). */
  skipped_no_url: number;
  /** `apolloPersonId` già di un altro prospect: il prospect resta senza id Apollo (F6). */
  apollo_id_taken: number;
  /** Prospect elaborati (con URL) che hanno un'email dopo il match (trovata ora o già presente). */
  with_email: number;
  credits_used: number;
  /** Richieste Apollo fatte (ricerche + match). */
  requests: number;
}

// ---------------------------------------------------------------------------
// enrich — provider (SPEC G, PLAN T10; il kind esiste da crm-foundation)
// ---------------------------------------------------------------------------
// `EnrichParams` (in `src/jobs/enrich.ts`) acquisisce `provider: 'apify' | 'apollo'`, **sempre
// esplicito** nei `params` salvati dalle route (default `apify` per i job lanciati prima di T10).
// Con `provider: 'apollo'` (T10): `Deps.matchPeople(details) → Promise<unknown>` (bulk da 10) e
// `result.counts` = {selected, targets, with_email, unavailable, already_had_email, skipped_fresh,
// not_found, not_searched, apollo_id_taken, credits_used} (`ApolloEnrichCounts` in `enrich.ts`); preview
// `counts` = {selected, targets, skipped_with_email, skipped_fresh, not_found, est_credits}. Con `apify`
// preview e `result.counts` restano quelli di crm-foundation.

export const ENRICH_PROVIDERS = ['apify', 'apollo'] as const;
export type EnrichProvider = (typeof ENRICH_PROVIDERS)[number];
