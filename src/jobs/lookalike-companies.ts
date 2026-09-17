import { ApolloRateLimitError, createApolloClient, type ApolloClient } from '../apollo/client.js';
import { mapOrganization, mapOrganizations, type ApolloOrganization } from '../apollo/mappers/organizations.js';
import {
  APOLLO_BULK_MAX,
  enrichOrganizationsRequest,
  matchPeopleRequest,
  searchOrganizationsRequest,
  searchPeopleRequest,
  type OrganizationSearchFilters,
} from '../apollo/requests.js';
import {
  APOLLO_EMPLOYEE_RANGES,
  deriveFilters,
  filtersEqual,
  filtersHash,
  normalizeRange,
  normalizeTag,
  scoreCandidate,
  SCORING_VERSION,
  type FilterOrigins,
  type SearchFilters,
  type SimilarityCompany,
} from '../apollo/similarity.js';
import { APOLLO_KEY_BLOCKER, config } from '../config.js';
import { knownCompanyIdsForIcp, lastLookalikeRun, upsertCandidate } from '../db/candidates.js';
import { getCompany, upsertCompany, type Company, type CompanyKey, type CompanyKeyConflict } from '../db/companies.js';
import { getIcp, getIcpDetail, listReferenceCompanies } from '../db/icps.js';
import { db } from '../db/index.js';
import {
  ApolloPeopleError,
  contactsEstimate,
  listBlockers,
  planContacts,
  resolveContactsOptions,
  runApolloPeople,
  type Deps as ApolloPeopleDeps,
  type ContactsInput,
} from './apollo-people.js';
import { enrichCompanies, organizationFields, type EnrichCompaniesRun } from './enrich-companies.js';
import type {
  ApolloPeopleCounts,
  ContactsOptions,
  JobHandler,
  JobPreview,
  JobResult,
  LookalikeContactsCounts,
  LookalikeCounts,
  LookalikeParams,
  LookalikePerPage,
} from './types.js';

/*
 * Job `lookalike_companies` — ricerca aziende simili alle referenze, con pipeline opzionale verso i
 * contatti (apollo-lookalike SPEC D/H; PLAN T7a preview, T7b handler, T9 pipeline). T7a: piano della
 * ricerca (`planLookalike`: referenze, filtri derivati, ripartenza, stima, warning e blocker di
 * configurazione) usato dalla preview e dall'avvio in `src/server/routes/lookalike.ts`. T7b: esecuzione
 * (`runLookalike`: pagine, aziende, arricchimento delle nuove S-7, punteggio, candidate, esito). T9:
 * con `params.autoContacts` l'handler esegue dopo la ricerca il passo contatti (`runApolloPeople`) sulle
 * candidate create da questo job, che restano `proposta` (SPEC H2). Contratto `params`/`result.counts`:
 * `types.ts`.
 */

export type {
  LookalikeContactsCounts,
  LookalikeCounts,
  LookalikeParams,
  LookalikePerPage,
  LookalikeResultCounts,
} from './types.js';

/** Dipendenze iniettabili del job (convenzione Apollo in `types.ts`: JSON grezzo, mapper nell'handler). */
export type Deps = ApolloPeopleDeps & {
  /**
   * `POST mixed_companies/search` di una pagina (`searchOrganizationsRequest`, `perPage` ≤ 100): risposta
   * grezza da leggere con `mapOrganizations` (dichiarate vs riconosciute). 1 credito a pagina.
   */
  searchOrganizations: (filters: OrganizationSearchFilters, page: number, perPage: number) => Promise<unknown>;
  /**
   * `POST organizations/bulk_enrich` per al massimo 10 domini (`enrichOrganizationsRequest`): arricchimento
   * delle aziende nuove prima del punteggio (S-7; la ricerca non restituisce settore, parole chiave,
   * dipendenti né sede). Risposta grezza da leggere con `mapOrganizations`; 1 credito per organizzazione.
   */
  enrichOrganizations: (domains: string[]) => Promise<unknown>;
};

// ---------------------------------------------------------------------------
// Costanti e testi (FLOW A.2: sono superficie di accettazione)
// ---------------------------------------------------------------------------

/** Aziende per pagina ammesse nel dialog (S-7). */
export const LOOKALIKE_PER_PAGE: readonly LookalikePerPage[] = [25, 50, 100];
export const DEFAULT_PER_PAGE: LookalikePerPage = 25;
/** Pagine proposte dal dialog (SPEC D3). */
export const DEFAULT_PAGES = 1;

/** Alias di `APOLLO_KEY_BLOCKER` (`config.ts`) per gli import esistenti in `tests/jobs.test.ts`. */
export const APOLLO_KEY_MISSING = APOLLO_KEY_BLOCKER;
export const EMPTY_FILTERS = 'Tutti i filtri sono vuoti: aggiungi almeno una parola chiave, una fascia o una località.';
/** Pipeline senza liste attive per l'ICP (SPEC H4, FLOW E.1: motivo della spunta disabilitata). */
export const PIPELINE_NO_ACTIVE_LIST = 'Crea una lista per questo ICP per usare questa opzione.';
/** Warning della pipeline attiva (FLOW E.2). */
export const PIPELINE_WARNING =
  'Le persone entreranno in lista anche da aziende che poi scarterai: puoi rimuoverle dalla lista, ma non torna indietro da solo.';

/** `true` se il valore è una dimensione di pagina ammessa. */
export function isLookalikePerPage(value: unknown): value is LookalikePerPage {
  return (LOOKALIKE_PER_PAGE as readonly unknown[]).includes(value);
}

/** Dimensione di pagina di `params` salvati: i job anteriori a S-7 non la hanno → default. */
export function perPageOf(value: unknown): LookalikePerPage {
  return isLookalikePerPage(value) ? value : DEFAULT_PER_PAGE;
}

/** Data breve italiana per i testi ("16 set"). */
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ---------------------------------------------------------------------------
// Filtri
// ---------------------------------------------------------------------------

function displayText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.trim().replace(/\s+/g, ' ');
  return t === '' ? undefined : t;
}

/**
 * Forma salvata nei `params` dei filtri confermati: parole chiave normalizzate (minuscolo, spazi ridotti)
 * nell'ordine dato, fasce riconosciute in ordine canonico Apollo (le sconosciute si scartano: la route le
 * rifiuta prima), località ripulite nella prima grafia vista; vuoti e doppioni tolti.
 */
export function normalizeSearchFilters(filters: Partial<SearchFilters> | null | undefined): SearchFilters {
  const keywords: string[] = [];
  for (const k of filters?.keywords ?? []) {
    const n = normalizeTag(k);
    if (n !== undefined && !keywords.includes(n)) keywords.push(n);
  }
  const ranges = new Set((filters?.ranges ?? []).map(normalizeRange));
  const locations: string[] = [];
  const seen = new Set<string>();
  for (const l of filters?.locations ?? []) {
    const shown = displayText(l);
    const key = normalizeTag(l);
    if (shown === undefined || key === undefined || seen.has(key)) continue;
    seen.add(key);
    locations.push(shown);
  }
  return { keywords, ranges: APOLLO_EMPLOYEE_RANGES.filter((r) => ranges.has(r)), locations };
}

function filtersEmpty(filters: Partial<SearchFilters>): boolean {
  return !filters.keywords?.length && !filters.ranges?.length && !filters.locations?.length;
}

/** Origini dei valori effettivi: quelle dei derivati uguali (confronto normalizzato), `[]` se aggiunti a mano. */
function originsFor(effective: SearchFilters, derived: FilterOrigins): FilterOrigins {
  const pick = (values: string[], origins: Record<string, string[]>, key: (v: string) => string | undefined) => {
    const byKey = new Map(Object.entries(origins).map(([value, from]) => [key(value), from]));
    return Object.fromEntries(values.map((v) => [v, [...(byKey.get(key(v)) ?? [])]]));
  };
  return {
    keywords: pick(effective.keywords, derived.keywords, normalizeTag),
    ranges: pick(effective.ranges, derived.ranges, normalizeRange),
    locations: pick(effective.locations, derived.locations, normalizeTag),
  };
}

// ---------------------------------------------------------------------------
// Referenze
// ---------------------------------------------------------------------------

/**
 * Stato Apollo di una referenza: `enriched` = `apollo_org_id` e `apollo_enriched_at` presenti (entra nei
 * filtri); `no_domain` = senza sito (ignorata); `to_enrich` = con dominio, mai tentata; `not_found` /
 * `key_conflict` = tentata senza esito (marcatura `apollo_json.outcome` di T7c).
 */
export type LookalikeReferenceStatus = 'enriched' | 'to_enrich' | 'not_found' | 'key_conflict' | 'no_domain';

export interface LookalikeReference {
  company_id: number;
  name: string | null;
  domain: string | null;
  linkedin_url: string | null;
  status: LookalikeReferenceStatus;
  /** Data dell'arricchimento riuscito, `null` se non arricchita. */
  enriched_at: string | null;
  /** Data dell'ultimo esito Apollo (anche negativo), `null` se mai tentata. */
  attempted_at: string | null;
}

function parseJson(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function referenceStatus(company: Company): LookalikeReferenceStatus {
  if (company.apollo_org_id !== null && company.apollo_enriched_at !== null) return 'enriched';
  if (company.domain === null) return 'no_domain';
  if (company.apollo_enriched_at === null) return 'to_enrich';
  const json = parseJson(company.apollo_json);
  return isRecord(json) && json.outcome === 'key_conflict' ? 'key_conflict' : 'not_found';
}

function companyName(company: Company): string {
  return company.name ?? company.domain ?? company.linkedin_url ?? `Azienda #${company.id}`;
}

/** Referenza arricchita → input delle Regole di somiglianza, dai dati Apollo salvati (`mapOrganization`). */
function similarityOf(company: Company): SimilarityCompany {
  const json = parseJson(company.apollo_json);
  const item = isRecord(json) && isRecord(json.organization) ? json.organization : json;
  const org = isRecord(item) ? mapOrganization({ id: company.apollo_org_id, ...item }) : null;
  return {
    name: companyName(company),
    keywords: org?.keywords ?? [],
    industry: org?.industry ?? null,
    employees: org?.employees ?? null,
    city: org?.city ?? null,
    state: org?.state ?? null,
    country: org?.country ?? null,
  };
}

// ---------------------------------------------------------------------------
// Ripartenza (SPEC D6)
// ---------------------------------------------------------------------------

export interface LookalikeResume {
  /** Ultima ricerca riuscita dell'ICP con gli stessi filtri e la stessa dimensione di pagina. */
  run_id: number;
  last_run_at: string;
  per_page: LookalikePerPage;
  last_page: number;
  /** Aziende dichiarate da Apollo nell'ultima pagina letta. */
  last_page_declared: number;
  /** Pagina da cui continuerebbe; `null` se la ricerca è esaurita. */
  next_page: number | null;
  /** Ultima pagina non piena (`last_page_declared < per_page`): niente da continuare. */
  exhausted: boolean;
  /** "Ricomincia dalla pagina 1" scelto: si parte da 1 anche se `next_page` c'è. */
  restart: boolean;
}

function countOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function resumeOf(
  icpId: number,
  filters: SearchFilters,
  perPage: LookalikePerPage,
  restart: boolean,
): { resume: LookalikeResume | null; startPage: number; warnings: string[] } {
  const none = { resume: null, startPage: 1, warnings: [] };
  const run = lastLookalikeRun(icpId);
  if (!run || !filtersEqual(run.params, filters)) return none;
  const lastPage = countOf(run.result?.counts.last_page);
  if (lastPage === 0) return none;
  const date = shortDate(run.at);
  const runPerPage = perPageOf(run.params.perPage);
  if (runPerPage !== perPage) {
    return {
      ...none,
      warnings: [
        `Stessi filtri della ricerca del ${date} ma con ${runPerPage} aziende per pagina: la continuazione richiede la stessa dimensione, riparto dalla pagina 1.`,
      ],
    };
  }
  const declared = countOf(run.result?.counts.last_page_declared);
  const exhausted = declared < perPage;
  const nextPage = exhausted ? null : lastPage + 1;
  const resume: LookalikeResume = {
    run_id: run.id,
    last_run_at: run.at,
    per_page: runPerPage,
    last_page: lastPage,
    last_page_declared: declared,
    next_page: nextPage,
    exhausted,
    restart,
  };
  if (restart) {
    return {
      resume,
      startPage: 1,
      warnings: [`Ricomincio dalla pagina 1 con i filtri della ricerca del ${date}: ricominciare ripaga pagine già lette.`],
    };
  }
  if (nextPage === null) {
    return {
      resume,
      startPage: 1,
      warnings: [
        `Ricerca esaurita con questi filtri (ultima pagina: ${plural(declared, 'azienda', 'aziende')} su ${perPage}): ricomincia dalla pagina 1 o cambia i filtri.`,
      ],
    };
  }
  return {
    resume,
    startPage: nextPage,
    warnings: [`Stessi filtri della ricerca del ${date} (letta fino alla pagina ${lastPage}): continuo dalla pagina ${nextPage}.`],
  };
}

// ---------------------------------------------------------------------------
// Piano della ricerca (preview + avvio)
// ---------------------------------------------------------------------------

export interface LookalikeInput {
  /** Pagine da leggere (default 1); la route le valida tra 1 e `APOLLO_MAX_COMPANY_PAGES`. */
  pages?: number;
  /** Aziende per pagina (default 25). */
  perPage?: LookalikePerPage;
  /** Filtri confermati dall'utente; `null`/assente = filtri derivati (referenze arricchite + ICP). */
  filters?: Partial<SearchFilters> | null;
  /** "Ricomincia dalla pagina 1". */
  restart?: boolean;
  /**
   * Pipeline "Trova subito i contatti" (SPEC H1): opzioni del passo contatti come in "Trova contatti"
   * (campi assenti = default dell'ICP e della config, `resolveContactsOptions`); `null`/assente = spenta.
   */
  autoContacts?: LookalikeContactsInput | null;
}

/** Opzioni del passo contatti in ingresso alla pipeline: quelle di `ContactsInput` senza le aziende. */
export type LookalikeContactsInput = Omit<ContactsInput, 'companyIds'>;

/** Opzioni del passo contatti risolte, per il dialog (snake_case come le risposte API). */
export interface LookalikeContactsPlan {
  /** `null` = lista non scelta (blocker). */
  list_id: number | null;
  roles: string[];
  seniorities: string[];
  locations: string[];
  per_company: number;
}

/** Filtri della preview: gli effettivi (quelli che partono) con origini, note e i derivati a parte. */
export interface LookalikeFilters extends SearchFilters {
  /** Per valore effettivo: nomi delle referenze e/o `ICP`; `[]` = aggiunto dall'utente. */
  origins: FilterOrigins;
  /** Note della derivazione (es. dimensione dell'ICP non riconoscibile). */
  notes: string[];
  /** `true` = filtri indicati dall'utente, `false` = derivati. */
  custom: boolean;
  /** Filtri derivati da referenze arricchite + ICP (per "Ripristina i filtri derivati"). */
  derived: SearchFilters;
}

export interface LookalikePlan {
  /**
   * Preview uniforme: `counts {pages, per_page, start_page, est_credits, requests}` (con la pipeline anche
   * `search_*`/`contacts_*`, vedi `planLookalike`), costo, warning e blocker **di configurazione**
   * (`configBlockers`, più la lista della pipeline). Il blocker "job in corso" lo aggiunge la route
   * (`runningJobBlocker`): `jobs/` non dipende dal controller del server.
   */
  preview: JobPreview;
  /** `params` congelati per `launchJob` (e per "Riprova"). */
  params: LookalikeParams;
  filters: LookalikeFilters;
  resume: LookalikeResume | null;
  references: LookalikeReference[];
  /** Opzioni risolte del passo contatti; `null` = pipeline spenta. */
  contacts: LookalikeContactsPlan | null;
}

/** Crediti stimati (tetto, S-7): pagine di ricerca + fino a pagine × dimensione aziende nuove da arricchire. */
export function estimateLookalikeCredits(pages: number, perPage: number): number {
  return pages + pages * perPage;
}

/** Richieste Apollo stimate (tetto): pagine di ricerca + lotti da 10 dell'arricchimento. */
export function estimateLookalikeRequests(pages: number, perPage: number): number {
  return pages + Math.ceil((pages * perPage) / APOLLO_BULK_MAX);
}

function hasActiveList(icpId: number): boolean {
  return db.prepare('SELECT 1 FROM lists WHERE icp_id = ? AND archived_at IS NULL LIMIT 1').get(icpId) !== undefined;
}

/**
 * Blocker della lista della pipeline (SPEC H4 + F3): nessuna lista attiva per l'ICP → "Crea una lista…"
 * (con l'eventuale motivo della lista indicata); altrimenti quelli di "Trova contatti" (lista non scelta,
 * inesistente, di un altro ICP, archiviata).
 */
export function autoContactsBlockers(icpId: number, listId: number | undefined): string[] {
  const problems = listBlockers(icpId, listId);
  if (hasActiveList(icpId)) return problems;
  return listId === undefined ? [PIPELINE_NO_ACTIVE_LIST] : [PIPELINE_NO_ACTIVE_LIST, ...problems];
}

/**
 * Blocker di configurazione (SPEC D4, H4) dai `params`: chiave Apollo mancante, tutti i filtri vuoti e,
 * con `autoContacts`, la lista di destinazione (così "Riprova" si blocca se la lista è stata archiviata).
 * Usati dalla preview, dall'avvio (400 `blocked`), dal job in cima e dal registry `CONFIG_BLOCKERS` (T6).
 */
export function configBlockers(
  params: Pick<LookalikeParams, 'keywords' | 'ranges' | 'locations'> & Partial<Pick<LookalikeParams, 'icpId' | 'autoContacts'>>,
): string[] {
  const blockers: string[] = [];
  if (!config.apolloApiKey.trim()) blockers.push(APOLLO_KEY_BLOCKER);
  if (filtersEmpty(params ?? {})) blockers.push(EMPTY_FILTERS);
  const auto = params?.autoContacts;
  if (auto) {
    const icpId = typeof params.icpId === 'number' ? params.icpId : 0;
    blockers.push(...autoContactsBlockers(icpId, typeof auto.listId === 'number' ? auto.listId : undefined));
  }
  return blockers;
}

/**
 * Piano della ricerca aziende simili per l'ICP (SPEC D2–D6, FLOW A.2): referenze con stato Apollo,
 * filtri derivati dalle sole referenze arricchite + ICP (o quelli confermati dall'utente), ripartenza
 * dall'ultima ricerca riuscita con gli stessi filtri e la stessa dimensione di pagina, stima di crediti,
 * richieste e costo, warning e blocker di configurazione. `undefined` se l'ICP non esiste.
 *
 * Con `input.autoContacts` (pipeline, SPEC H1, FLOW E.2) la stima somma il passo contatti su fino a
 * pagine × dimensione aziende (`contactsEstimate`): `est_credits`/`requests` sono i totali e `counts`
 * aggiunge il dettaglio `search_est_credits`, `search_requests`, `contacts_companies`,
 * `contacts_per_company`, `contacts_est_credits`, `contacts_requests`; warning della pipeline e di "Trova
 * contatti" (ruoli), blocker della lista (`autoContactsBlockers`).
 */
export function planLookalike(icpId: number, input: LookalikeInput = {}): LookalikePlan | undefined {
  const detail = getIcpDetail(icpId);
  if (!detail) return undefined;
  const pages = input.pages ?? DEFAULT_PAGES;
  const perPage = input.perPage ?? DEFAULT_PER_PAGE;
  const restart = input.restart === true;

  // Referenze e filtri derivati.
  const references: LookalikeReference[] = detail.reference_companies.map(({ company }) => {
    const status = referenceStatus(company);
    return {
      company_id: company.id,
      name: company.name,
      domain: company.domain,
      linkedin_url: company.linkedin_url,
      status,
      enriched_at: status === 'enriched' ? company.apollo_enriched_at : null,
      attempted_at: company.apollo_enriched_at,
    };
  });
  const enriched = detail.reference_companies.filter(({ company }) => referenceStatus(company) === 'enriched');
  const derivation = deriveFilters(
    enriched.map(({ company }) => similarityOf(company)),
    detail,
  );
  const derived = normalizeSearchFilters(derivation);
  const custom = input.filters !== undefined && input.filters !== null;
  const effective = custom ? normalizeSearchFilters(input.filters) : derived;

  const { resume, startPage, warnings: resumeWarnings } = resumeOf(icpId, effective, perPage, restart);

  // Pipeline: opzioni del passo contatti con i default risolti (lista esclusa: la sceglie l'utente).
  const contactsInput = input.autoContacts ?? null;
  const contacts = contactsInput === null ? null : resolveContactsOptions(icpId, contactsInput);
  const autoContacts: ContactsOptions | null =
    contacts === null || contacts.listId === undefined ? null : { ...contacts, listId: contacts.listId };

  const params: LookalikeParams = {
    icpId,
    pages,
    perPage,
    startPage,
    ...effective,
    filtersHash: filtersHash(effective),
    restart,
    autoContacts,
  };

  const searchCredits = estimateLookalikeCredits(pages, perPage);
  const searchRequests = estimateLookalikeRequests(pages, perPage);
  // Passo contatti: fino a pagine × dimensione aziende trovate (tutte con dominio, tetto).
  const maxCompanies = pages * perPage;
  const contactsEst = contacts === null ? null : contactsEstimate(maxCompanies, contacts.perCompany);
  const estCredits = searchCredits + (contactsEst?.est_credits ?? 0);
  const requests = searchRequests + (contactsEst?.requests ?? 0);
  const price = config.prices.apolloCreditUsd;

  // Warning (SPEC D5, FLOW A.2), nell'ordine del dialog.
  const warnings: string[] = [];
  if (!detail.lists.some((l) => l.archived_at === null)) {
    warnings.push('Nessuna lista attiva per questo ICP: potrai trovare i contatti solo dopo aver creato una lista.');
  }
  for (const { company } of detail.reference_companies) {
    const name = companyName(company);
    const status = referenceStatus(company);
    if (status === 'to_enrich') {
      warnings.push(`${name} non è ancora arricchita: i suoi settori e dimensioni non entrano nei filtri. Arricchisci le referenze prima.`);
    } else if (status === 'not_found') {
      warnings.push(
        `${name} non è stata trovata su Apollo il ${shortDate(company.apollo_enriched_at!)}: i suoi settori e dimensioni non entrano nei filtri. Correggi il sito della referenza.`,
      );
    } else if (status === 'key_conflict') {
      warnings.push(
        `${name} ha chiavi in conflitto con Apollo (${shortDate(company.apollo_enriched_at!)}): i suoi settori e dimensioni non entrano nei filtri. Correggi l'URL LinkedIn o il sito in anagrafica.`,
      );
    }
  }
  for (const { company } of detail.reference_companies) {
    if (referenceStatus(company) !== 'no_domain') continue;
    const name = companyName(company);
    warnings.push(`${name} è senza sito: ignorata per la ricerca. Aggiungi il sito in Aziende → ${name} per usarla.`);
  }
  if (enriched.length === 0) warnings.push("Nessuna referenza arricchita: i filtri derivano solo dall'ICP.");
  if (effective.keywords.length === 0 && !filtersEmpty(effective)) {
    warnings.push('Nessuna parola chiave: la ricerca userà solo fasce e località, i risultati saranno poco simili.');
  }
  if (detail.target_industries.length === 0 && !detail.company_size && detail.target_locations.length === 0) {
    warnings.push("L'ICP non ha settori, dimensione né località.");
  }
  warnings.push(...resumeWarnings);
  if (contacts !== null) {
    warnings.push(PIPELINE_WARNING);
    // Warning di "Trova contatti" che non dipendono dalle aziende (oggi: nessun ruolo): stessi testi di C.2.
    warnings.push(...planContacts(icpId, { ...contacts, companyIds: [] }).preview.warnings);
  }
  if (requests > config.apolloRateLimitPerMinute) {
    warnings.push(
      `Fino a ${requests} richieste Apollo: più del limite di ${config.apolloRateLimitPerMinute} al minuto; il job rallenta e si ferma con esito parziale se Apollo limita.`,
    );
  }

  const blockers = configBlockers({ ...params, autoContacts: null });
  if (contacts !== null) blockers.push(...autoContactsBlockers(icpId, contacts.listId));

  return {
    preview: {
      counts: {
        pages,
        per_page: perPage,
        start_page: startPage,
        est_credits: estCredits,
        requests,
        ...(contactsEst === null
          ? {}
          : {
              search_est_credits: searchCredits,
              search_requests: searchRequests,
              contacts_companies: maxCompanies,
              contacts_per_company: contacts!.perCompany,
              contacts_est_credits: contactsEst.est_credits,
              contacts_requests: contactsEst.requests,
            }),
      },
      est_cost_usd: price === null ? null : Number((estCredits * price).toFixed(4)),
      warnings,
      blockers,
    },
    params,
    filters: {
      ...effective,
      origins: originsFor(effective, derivation.origins),
      notes: derivation.notes,
      custom,
      derived,
    },
    resume,
    references,
    contacts:
      contacts === null
        ? null
        : {
            list_id: contacts.listId ?? null,
            roles: contacts.roles,
            seniorities: contacts.seniorities,
            locations: contacts.locations,
            per_company: contacts.perCompany,
          },
  };
}

// ---------------------------------------------------------------------------
// Esecuzione della ricerca (T7b; SPEC D7–D14, S-7)
// ---------------------------------------------------------------------------

const SEARCH_OP = 'mixed_companies/search';
const ENRICH_OP = 'organizations/bulk_enrich';

/** Esito della ricerca: `result` del job + quanto serve al passo contatti della pipeline (T9). */
export interface LookalikeOutcome {
  summary: string;
  counts: LookalikeCounts;
  warnings: string[];
  /**
   * Aziende diventate candidate **in questo job** (`new_candidates`), come id superstiti dopo le unioni
   * fatte dal job stesso, senza doppioni e ancora esistenti: l'input di `runApolloPeople` in pipeline (T9).
   */
  candidateCompanyIds: number[];
  /** Arresto dopo ≥ 1 pagina salvata (limite Apollo, errore del provider, chiave): esito parziale (D12). */
  partial: boolean;
}

/** Id del job corrente dall'env del processo figlio (`JOB_ID`, come `fake-deps.ts`); `null` in process. */
function currentJobId(): number | null {
  const id = Number(process.env.JOB_ID);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

/** Messaggio attribuito (D13): i prefissi `actor:`/`config:`/`process:` restano, il resto è di `actor:apollo:<op>:`. */
function attributed(err: unknown, op: string): string {
  const message = (err instanceof Error ? err.message : String(err)).trim() || 'errore sconosciuto';
  return /^(actor|config|process):/.test(message) ? message : `actor:apollo:${op}: ${message}`;
}

function withTail(message: string, tail: string): string {
  return `${message}${/[.!?)]$/.test(message) ? ' ' : '. '}${tail}`;
}

function capitalize(text: string): string {
  return text.length === 0 ? text : `${text[0]!.toUpperCase()}${text.slice(1)}`;
}

/** Elenco di nomi leggibile, troncato dopo `max` ("A, B, C e altre 4"). */
function names(list: string[], max = 10): string {
  if (list.length <= max) return list.join('; ');
  return `${list.slice(0, max).join('; ')} e altre ${list.length - max}`;
}

const KEY_LABELS: Record<CompanyKey, string> = { linkedin_url: 'URL LinkedIn', domain: 'dominio', apollo_org_id: 'id Apollo' };

/** Valore di chiave accorciato per i messaggi (`https://www.linkedin.com/company/x` → `linkedin.com/company/x`). */
function shortKey(value: string): string {
  return value.replace(/^https?:\/\/(www\.)?/i, '');
}

/** Chiavi discordanti di un risultato saltato (FLOW: "Acme: Apollo indica linkedin.com/company/acme-robotics, in anagrafica …"). */
function describeConflict(org: ApolloOrganization, conflict: CompanyKeyConflict): string {
  const label = org.name ?? org.domain ?? (org.linkedinUrl ? shortKey(org.linkedinUrl) : 'azienda Apollo');
  if (conflict.reason === 'too_many_companies') {
    return `${label}: le chiavi di Apollo corrispondono a ${conflict.company_ids.length} aziende diverse`;
  }
  const parts = conflict.details.map(
    (d) =>
      `${d.company_name ?? `azienda #${d.company_id}`}: Apollo indica ${KEY_LABELS[d.key]} ${shortKey(d.input)}, ` +
      `in anagrafica ${shortKey(d.existing)}`,
  );
  return [...new Set(parts)].join(', ');
}

/**
 * Input del punteggio per un'azienda: dati Apollo salvati (`apollo_json`) se arricchita, altrimenti i campi
 * dell'anagrafica disponibili (settore; dipendenti se la dimensione è "N dipendenti"): sede esclusa.
 */
function candidateSimilarity(company: Company): SimilarityCompany {
  if (company.apollo_org_id !== null) return similarityOf(company);
  const employees = company.size?.match(/^\s*(\d+)\s+dipendenti\s*$/i);
  return {
    name: companyName(company),
    keywords: [],
    industry: company.industry,
    employees: employees ? Number(employees[1]) : null,
    city: null,
    state: null,
    country: null,
  };
}

function filtersText(filters: SearchFilters): string {
  const parts: string[] = [];
  if (filters.keywords.length > 0) parts.push(filters.keywords.join(', '));
  if (filters.ranges.length > 0) parts.push(`${filters.ranges.map((r) => r.replace('-', '–')).join(', ')} dipendenti`);
  if (filters.locations.length > 0) parts.push(filters.locations.join(', '));
  return parts.join(' · ');
}

function widenHint(filters: SearchFilters): string {
  const hints: string[] = [];
  if (filters.ranges.length > 0) hints.push('allarga le fasce');
  if (filters.locations.length > 0) hints.push('togli la località');
  if (hints.length === 0) hints.push('prova altre parole chiave');
  return `${capitalize(hints.join(' o '))}.`;
}

type Failure = { err: unknown; phase: 'search' } | { err: unknown; phase: 'enrich'; page: number; unenriched: number };

/** Esito leggibile (SPEC D11, FLOW A.3): successo, zero neutro con i filtri usati, parziale. */
function summarize(icpName: string, filters: SearchFilters, counts: LookalikeCounts, info: { partial: boolean; unrecognized: boolean; startPage: number }): string {
  if (counts.read === 0 && !info.partial && !info.unrecognized) {
    if (info.startPage > 1) {
      return (
        `Nessun'altra azienda trovata dalla pagina ${info.startPage} con: ${filtersText(filters)}. ` +
        'La ricerca è esaurita: ricomincia dalla pagina 1 o cambia i filtri.'
      );
    }
    return `Nessuna azienda trovata con: ${filtersText(filters)}. ${widenHint(filters)}`;
  }
  const n = (value: number, one: string, many: string) => `${value} ${value === 1 ? one : many}`;
  const parts = [n(counts.read, 'letta', 'lette'), n(counts.new_candidates, 'nuova candidata', 'nuove candidate')];
  if (counts.known > 0) parts.push(`${n(counts.known, 'già nota', 'già note')} (non ${counts.known === 1 ? 'riproposta' : 'riproposte'})`);
  if (counts.key_conflicts > 0) parts.push(`${counts.key_conflicts} con chiavi in conflitto (${counts.key_conflicts === 1 ? 'saltata' : 'saltate'})`);
  if (counts.no_keys > 0) parts.push(`${counts.no_keys} senza sito né pagina LinkedIn (${counts.no_keys === 1 ? 'saltata' : 'saltate'})`);
  if (counts.without_linkedin > 0) parts.push(`${counts.without_linkedin} senza pagina LinkedIn`);
  if (counts.merged > 0) parts.push(n(counts.merged, 'unione', 'unioni'));
  if (counts.references_completed > 0) parts.push(n(counts.references_completed, 'referenza completata', 'referenze completate'));
  if (counts.enriched > 0) parts.push(n(counts.enriched, 'azienda arricchita', 'aziende arricchite'));
  parts.push(n(counts.pages_read, 'pagina letta', 'pagine lette'));
  parts.push(n(counts.credits_used, 'credito usato', 'crediti usati'));
  return `Aziende simili per '${icpName}'${info.partial ? ' (esito parziale)' : ''}: ${parts.join(' · ')}.`;
}

/** Warning dell'esito parziale (D12, FLOW "Rate limit — A"): arresto dopo ≥ 1 pagina salvata. */
function partialWarning(failure: Failure, counts: LookalikeCounts, info: { pages: number; startPage: number; exhausted: boolean }): string {
  const verb = counts.pages_read === 1 ? 'letta' : 'lette';
  const read = `${verb} ${counts.pages_read} ${counts.pages_read === 1 ? 'pagina' : 'pagine'} su ${info.pages} (${counts.read} ${counts.read === 1 ? 'azienda' : 'aziende'})`;
  const saved =
    counts.pages_read === 1
      ? `le candidate della pagina ${counts.last_page} sono salvate`
      : `le candidate delle pagine ${info.startPage}–${counts.last_page} sono salvate`;
  const nextPage = counts.last_page + 1;
  const later = `rilancia più tardi${info.exhausted ? '' : `: continuo dalla pagina ${nextPage}`}`;
  const again = info.exhausted ? '' : `; rilancia per continuare dalla pagina ${nextPage}`;
  const rateLimited = failure.err instanceof ApolloRateLimitError;
  if (failure.phase === 'search') {
    if (rateLimited) return `Limite Apollo raggiunto: ${read}. ${capitalize(saved)}; ${later}.`;
    return `${attributed(failure.err, SEARCH_OP)} · ${read}. ${capitalize(saved)} e restano valide${again}.`;
  }
  const without =
    `${failure.unenriched} ${failure.unenriched === 1 ? 'azienda nuova' : 'aziende nuove'} della pagina ${failure.page} ` +
    'senza dati Apollo (punteggio parziale)';
  if (rateLimited) {
    return `Limite Apollo raggiunto durante l'arricchimento: ${without}. ${capitalize(read)}; ${saved}; ${later}.`;
  }
  return `${attributed(failure.err, ENRICH_OP)} · ${without} · ${read}. ${capitalize(saved)}${again}.`;
}

/** Stato condiviso dalle pagine di una ricerca. */
interface RunState {
  icpId: number;
  jobId: number | null;
  filters: SearchFilters;
  references: SimilarityCompany[];
  counts: LookalikeCounts;
  /** Candidate create da questo job (id aggiornati alle unioni fatte dal job). */
  candidateIds: Set<number>;
  conflicts: string[];
  warnings: Set<string>;
  /** Aziende lette che a fine pagina restano senza URL LinkedIn (warning D11). */
  readWithoutLinkedin: number;
}

/** Le unioni spostano le candidate già create sul superstite. */
function remapCandidates(state: RunState, dropIds: readonly number[], keepId: number): void {
  for (const id of dropIds) if (state.candidateIds.delete(id)) state.candidateIds.add(keepId);
}

/**
 * Una pagina già letta: (A) aziende in transazione, (arricchimento delle nuove, S-7), (B) candidate in
 * transazione. Ritorna l'errore che deve fermare la ricerca dopo questa pagina (limite o chiave durante
 * l'arricchimento), se c'è: le candidate della pagina sono comunque salvate con i dati disponibili.
 */
async function processPage(state: RunState, items: ApolloOrganization[], page: number, enrich: Pick<Deps, 'enrichOrganizations'>): Promise<Failure | undefined> {
  const { counts } = state;

  // (A) Aziende: chiavi, Regole di unione, esclusione di referenze e candidate già note (D7–D9). Dalla
  // ricerca si salvano solo chiavi, nome e sito: niente `apollo_org_id` (vuoto = "non arricchita").
  const read: Array<{ org: ApolloOrganization; id: number | null; completed: boolean }> = [];
  const newIds: number[] = [];
  db.transaction(() => {
    for (const org of items) {
      if (!org.domain && !org.linkedinUrl) {
        counts.no_keys += 1;
        read.push({ org, id: null, completed: false });
        continue;
      }
      const res = upsertCompany({ linkedinUrl: org.linkedinUrl, domain: org.domain, ...organizationFields(org) });
      if (res.keyConflict) {
        counts.key_conflicts += 1;
        state.conflicts.push(describeConflict(org, res.keyConflict));
        read.push({ org, id: null, completed: false });
        continue;
      }
      if (res.id === undefined) {
        counts.no_keys += 1;
        read.push({ org, id: null, completed: false });
        continue;
      }
      const id = res.id;
      counts.merged += res.mergedIds.length;
      remapCandidates(state, res.mergedIds, id);
      for (const r of read) if (r.id !== null && res.mergedIds.includes(r.id)) r.id = id;
      read.push({ org, id, completed: res.mergedIds.length > 0 || res.linkedinAcquired || res.domainAcquired });
    }

    const references = new Set(listReferenceCompanies(state.icpId).map((r) => r.company_id));
    const known = knownCompanyIdsForIcp(state.icpId);
    const seen = new Set<number>();
    for (const { id, completed } of read) {
      if (id === null) continue;
      if (seen.has(id)) {
        counts.known += 1;
        continue;
      }
      seen.add(id);
      if (references.has(id)) {
        // D8: referenza ritrovata; "completata" solo se ha acquisito una chiave o assorbito un doppione.
        if (completed) counts.references_completed += 1;
        else counts.known += 1;
      } else if (known.has(id)) {
        counts.known += 1;
      } else {
        newIds.push(id);
      }
    }
  })();

  // Arricchimento delle nuove (S-7): `enrichCompanies` salta già arricchite, senza dominio e tentate di recente.
  let run: EnrichCompaniesRun | undefined;
  if (newIds.length > 0) {
    run = await enrichCompanies(newIds, enrich);
    counts.enriched += run.counts.enriched;
    counts.credits_used += run.counts.credits_used;
    counts.merged += run.counts.merged;
    for (const w of run.warnings) state.warnings.add(w);
  }
  const finalOf = new Map<number, number | null>(run?.results.map((r) => [r.requestedId, r.companyId]) ?? []);
  const survivor = (id: number) => (finalOf.has(id) ? finalOf.get(id)! : id);
  const stop = run?.stoppedBy ?? run?.errors.find((e) => e instanceof ApolloRateLimitError);
  const unenriched = run?.results.filter((r) => r.outcome === 'failed').length ?? 0;
  if (run && !stop && unenriched > 0) {
    state.warnings.add(
      `Errore Apollo durante l'arricchimento (${attributed(run.errors[0], ENRICH_OP)}): ${unenriched} ` +
        `${unenriched === 1 ? 'azienda nuova' : 'aziende nuove'} senza dati Apollo, punteggio parziale.`,
    );
  }

  // (B) Candidate (D10, D14): punteggio con i dati disponibili, componenti e versione della regola.
  db.transaction(() => {
    const done = new Set<number>();
    for (const requested of newIds) {
      const id = survivor(requested);
      if (id === null) continue;
      if (done.has(id)) {
        counts.known += 1;
        continue;
      }
      done.add(id);
      const company = getCompany(id);
      if (!company) continue;
      const { score, parts, reasons } = scoreCandidate(candidateSimilarity(company), state.filters, state.references);
      const res = upsertCandidate({
        icpId: state.icpId,
        companyId: id,
        score,
        parts,
        reasons,
        jobId: state.jobId,
        scoringVersion: SCORING_VERSION,
      });
      if (res.reference) {
        // L'arricchimento l'ha unita a una referenza dell'ICP (D8).
        counts.references_completed += 1;
      } else if (!res.created) {
        counts.known += 1;
      } else {
        counts.new_candidates += 1;
        state.candidateIds.add(id);
        if (company.linkedin_url === null) counts.without_linkedin += 1;
        if (parts.location === null) counts.without_location += 1;
      }
    }
  })();

  for (const { org, id } of read) {
    const final = id === null ? null : survivor(id);
    const url = final === null ? org.linkedinUrl : (getCompany(final)?.linkedin_url ?? org.linkedinUrl);
    if (!url) state.readWithoutLinkedin += 1;
  }

  return stop ? { err: stop, phase: 'enrich', page, unenriched } : undefined;
}

/**
 * Ricerca aziende simili (SPEC D7–D14, S-7). Verifica la configurazione in cima (`config:`), poi pagina per
 * pagina da `startPage`: `searchOrganizations` → `mapOrganizations` → aziende (Regole di unione; referenze e
 * candidate già note escluse) → arricchimento delle nuove → candidate con punteggio. Si ferma quando una
 * pagina dichiara meno di `perPage` aziende (ricerca esaurita, D6). Qualunque errore Apollo prima della prima
 * pagina salvata → lancia (job fallito, messaggio attribuito); dopo → esito parziale con warning (D12).
 * Con `autoContacts` la verifica in cima include la lista (F4: nessuna chiamata se è archiviata); il passo
 * contatti lo esegue l'handler (T9).
 */
export async function runLookalike(params: LookalikeParams, deps: Deps): Promise<LookalikeOutcome> {
  const blockers = configBlockers(params);
  if (blockers.length > 0) throw new Error(`config: ${blockers.join(' ')}`);
  const icp = getIcp(params.icpId);
  if (!icp) throw new Error(`config: ICP non trovato (id ${params.icpId}): è stato eliminato? Nessun dato modificato.`);

  const filters = normalizeSearchFilters(params);
  const perPage = perPageOf(params.perPage);
  const pages = positiveInt(params.pages, DEFAULT_PAGES);
  const startPage = positiveInt(params.startPage, 1);
  const counts: LookalikeCounts = {
    read: 0,
    new_candidates: 0,
    known: 0,
    without_linkedin: 0,
    without_location: 0,
    merged: 0,
    references_completed: 0,
    key_conflicts: 0,
    no_keys: 0,
    enriched: 0,
    pages_read: 0,
    // Nessuna pagina letta: resta l'ultima della ricerca continuata, piena per costruzione (D6).
    last_page: startPage - 1,
    last_page_declared: startPage > 1 ? perPage : 0,
    credits_used: 0,
    requests: 0,
  };
  const state: RunState = {
    icpId: icp.id,
    jobId: currentJobId(),
    filters,
    // Referenze arricchite all'avvio: le stesse da cui derivano i filtri (Regole di somiglianza).
    references: listReferenceCompanies(icp.id)
      .filter(({ company }) => referenceStatus(company) === 'enriched')
      .map(({ company }) => similarityOf(company)),
    counts,
    candidateIds: new Set(),
    conflicts: [],
    warnings: new Set(),
    readWithoutLinkedin: 0,
  };
  const enrich: Pick<Deps, 'enrichOrganizations'> = {
    enrichOrganizations: (domains) => {
      counts.requests += 1;
      return deps.enrichOrganizations(domains);
    },
  };

  let failure: Failure | undefined;
  let exhausted = false;
  let unrecognized: { declared: number; page: number } | undefined;
  for (let page = startPage; page < startPage + pages; page++) {
    let response: unknown;
    counts.requests += 1;
    try {
      response = await deps.searchOrganizations(filters, page, perPage);
    } catch (err) {
      failure = { err, phase: 'search' };
      break;
    }
    counts.credits_used += 1;
    const { items, declared, recognized } = mapOrganizations(response);
    if (declared > 0 && recognized === 0) {
      // Schema inatteso: nessuna candidata, pagina non salvata (il rilancio la ripaga), inutile proseguire.
      unrecognized = { declared, page };
      break;
    }
    const stop = await processPage(state, items, page, enrich);
    counts.read += recognized;
    counts.pages_read += 1;
    counts.last_page = page;
    counts.last_page_declared = declared;
    exhausted = declared < perPage;
    if (stop) failure = stop;
    if (failure || exhausted) break;
  }

  if (failure && counts.pages_read === 0) {
    throw new Error(withTail(attributed(failure.err, SEARCH_OP), 'Nessun dato modificato.'));
  }

  const warnings: string[] = [];
  if (failure) warnings.push(partialWarning(failure, counts, { pages, startPage, exhausted }));
  if (unrecognized) {
    warnings.push(
      `Apollo ha risposto ma nessuna azienda è stata riconosciuta (${unrecognized.declared} dichiarate): verifica il provider. ` +
        `La pagina ${unrecognized.page} non è stata salvata: rilanciando si ripaga.`,
    );
  }
  if (state.conflicts.length > 0) {
    const one = state.conflicts.length === 1;
    warnings.push(
      `Chiavi in conflitto con l'anagrafica, ${one ? 'azienda saltata' : 'aziende saltate'}: ${names(state.conflicts)}. ` +
        "Correggi l'URL LinkedIn o il sito in Anagrafica (o unisci le aziende).",
    );
  }
  if (counts.read > 0 && state.readWithoutLinkedin * 2 > counts.read) {
    warnings.push(
      `Più della metà delle aziende lette è senza pagina LinkedIn (${state.readWithoutLinkedin} su ${counts.read}): ` +
        "per estrarne le persone con Apify serve prima l'URL (Anagrafica → URL LinkedIn).",
    );
  }
  warnings.push(...state.warnings);

  const partial = failure !== undefined;
  return {
    summary: summarize(icp.name, filters, counts, { partial, unrecognized: unrecognized !== undefined, startPage }),
    counts,
    warnings,
    candidateCompanyIds: [...state.candidateIds].filter((id) => getCompany(id) !== undefined),
    partial,
  };
}

// ---------------------------------------------------------------------------
// Handler e deps reali
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Pipeline: passo contatti (T9; SPEC H2/H3, FLOW E.3 e Error paths)
// ---------------------------------------------------------------------------

/** Tutte le chiavi di `ApolloPeopleCounts` a zero: il `satisfies` obbliga ad aggiornarle con il tipo. */
const NO_CONTACTS = {
  people_read: 0,
  people_matched: 0,
  companies_done: 0,
  companies: 0,
  without_domain: 0,
  added: 0,
  prospects_new: 0,
  prospects_seen: 0,
  already_in_list: 0,
  skipped_no_url: 0,
  apollo_id_taken: 0,
  with_email: 0,
  credits_used: 0,
  requests: 0,
} satisfies ApolloPeopleCounts;

/** Conteggi del passo contatti con prefisso `contacts_` (sempre tutte le chiavi, 0 se il passo non gira). */
function contactsCounts(counts: Partial<ApolloPeopleCounts> = {}): LookalikeContactsCounts {
  const out: Record<string, number> = {};
  for (const key of Object.keys(NO_CONTACTS) as Array<keyof ApolloPeopleCounts>) out[`contacts_${key}`] = counts[key] ?? 0;
  return out as LookalikeContactsCounts;
}

/**
 * Aziende del passo contatti: le candidate **create da questo job** (SPEC H2). Nel processo figlio si
 * leggono da `icp_company_candidates.job_id` (verità del DB anche dopo le unioni); in process (test) dagli
 * id tenuti dalla ricerca. Stesse regole in entrambi i casi: candidate ancora esistenti, punteggio più alto
 * prima (se il passo si ferma a metà, le più simili sono già fatte).
 */
function pipelineCompanyIds(icpId: number, fromSearch: readonly number[]): number[] {
  const jobId = currentJobId();
  const rows =
    jobId !== null
      ? db
          .prepare('SELECT company_id FROM icp_company_candidates WHERE icp_id = ? AND job_id = ? ORDER BY score DESC, company_id')
          .pluck()
          .all(icpId, jobId)
      : db
          .prepare(
            `SELECT company_id FROM icp_company_candidates
             WHERE icp_id = ? AND company_id IN (SELECT value FROM json_each(?))
             ORDER BY score DESC, company_id`,
          )
          .pluck()
          .all(icpId, JSON.stringify(fromSearch));
  return rows as number[];
}

/** Seconda riga dell'esito (FLOW E.3): sempre "Contatti Apollo: …", anche per l'esito zero di C.3. */
function contactsLine(summary: string): string {
  if (summary.startsWith('Contatti Apollo')) return summary;
  return `Contatti Apollo: ${summary.length === 0 ? summary : `${summary[0]!.toLowerCase()}${summary.slice(1)}`}`;
}

/**
 * Warning del passo contatti fallito (SPEC H3, FLOW Error paths "Passo contatti fallisce in pipeline"):
 * errore attribuito del passo contatti in testa (`config:`/`actor:`/`process:`), poi i crediti già spesi e
 * le persone già aggiunte se ci sono (AL-TD-5), poi il rimedio. Le code di `runApolloPeople` ("Nessun dato
 * modificato.", crediti) non si ripetono: con `ApolloPeopleError` si parte dall'errore d'origine.
 */
function contactsFailureWarning(err: unknown, counts: Partial<ApolloPeopleCounts>): string {
  let message = (err instanceof ApolloPeopleError ? err.detail : err instanceof Error ? err.message : String(err)).trim() || 'errore sconosciuto';
  if (!/^(actor|config|process):/.test(message)) message = `process: ${message}`;
  message = message.replace(/\s*Nessun dato modificato\.?$/, '').replace(/[.\s]+$/, '');
  const remedy = !message.startsWith('config:')
    ? "rilancia 'Trova contatti' sulle candidate più tardi"
    : /chiave|APOLLO_API_KEY/i.test(message)
      ? "usa 'Trova contatti' dopo aver sistemato la chiave"
      : "usa 'Trova contatti' dopo aver sistemato la lista";
  const n = (value: number, one: string, many: string) => `${value} ${value === 1 ? one : many}`;
  const parts = [message];
  const credits = counts.credits_used ?? 0;
  const added = counts.added ?? 0;
  if (credits > 0) parts.push(n(credits, 'credito usato', 'crediti usati'));
  parts.push(added > 0 ? `${n(added, 'persona aggiunta', 'persone aggiunte')} alla lista prima dell'errore` : 'Contatti non trovati');
  return `${parts.join(' · ')}. Le candidate sono salvate: ${remedy}.`;
}

/**
 * Passo contatti dopo la ricerca (SPEC H2/H3, FLOW E.3): gira solo se la ricerca ha letto aziende e creato
 * candidate (anche con esito parziale: le pagine salvate valgono); le candidate restano `proposta`. Un
 * errore del passo (403 `config:`, provider, limite prima della prima azienda) non fa fallire il job: la
 * ricerca resta valida e l'errore attribuito va nei warning. `result.counts` = conteggi della ricerca +
 * `contacts_*`; `summary` su due righe separate da `\n` (solo la prima se la ricerca non ha letto nulla).
 */
async function withContacts(params: LookalikeParams, options: ContactsOptions, search: LookalikeOutcome, deps: Deps): Promise<JobResult> {
  const warnings = [...search.warnings];
  const result = (line: string | null, counts: Partial<ApolloPeopleCounts> = {}): JobResult => ({
    summary: line === null ? search.summary : `${search.summary}\n${line}`,
    counts: { ...search.counts, ...contactsCounts(counts) },
    warnings,
  });

  // FLOW E.3: se la ricerca non trova aziende il secondo passo non parte e l'esito è il neutro di A.
  if (search.counts.read === 0) return result(null);
  const companyIds = pipelineCompanyIds(params.icpId, search.candidateCompanyIds);
  if (companyIds.length === 0) return result('Contatti Apollo: nessuna nuova candidata in cui cercare, nessuna richiesta fatta.');

  try {
    const contacts = await runApolloPeople({ icpId: params.icpId, companyIds, ...options }, deps);
    warnings.push(...contacts.warnings);
    return result(contactsLine(contacts.summary), contacts.counts);
  } catch (err) {
    // AL-TD-5: i conteggi parziali (crediti dei lotti di match già pagati) restano nei `contacts_*`.
    const partial = err instanceof ApolloPeopleError ? err.counts : {};
    warnings.push(contactsFailureWarning(err, partial));
    return result("Contatti Apollo: passo interrotto da un errore, vedi l'avviso.", partial);
  }
}

/** Handler registrato in `HANDLERS.lookalike_companies`: ricerca (T7b) + passo contatti opzionale (T9). */
export const handler: JobHandler<LookalikeParams, Deps> = async (params, deps): Promise<JobResult> => {
  const search = await runLookalike(params, deps);
  if (params.autoContacts) return withContacts(params, params.autoContacts, search, deps);
  const { summary, counts, warnings } = search;
  return { summary, counts: { ...counts }, warnings };
};

/** Deps reali: client Apollo creato alla prima chiamata (nessuna chiamata all'import né in `realDeps()`). */
export function realDeps(): Deps {
  let client: ApolloClient | undefined;
  const apollo = () => (client ??= createApolloClient({ apiKey: config.apolloApiKey }));
  return {
    searchOrganizations: (filters, page, perPage) => apollo().post(searchOrganizationsRequest(filters, page, perPage)),
    enrichOrganizations: (domains) => apollo().post(enrichOrganizationsRequest(domains)),
    searchPeople: (params) => apollo().post(searchPeopleRequest(params)),
    matchPeople: (details) => apollo().post(matchPeopleRequest(details)),
  };
}
