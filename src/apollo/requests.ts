/**
 * Richieste Apollo (apollo-lookalike T3): UNICO punto del codice in cui si costruiscono path, querystring e
 * body delle chiamate Apollo (SPEC Constraints "Test e validazione"). Funzioni pure: nessuna chiamata, nessun
 * accesso a config o DB. Il client (`client.ts`) le esegue così come sono.
 *
 * Riferimento: Apollo API docs (PLAN §7), `bulk_enrich` riconfermato il 2026-09-17.
 */

/** Operazioni Apollo usate dal CRM: sono anche il prefisso degli errori `actor:apollo:<op>:`. */
export type ApolloOp = 'organizations/bulk_enrich' | 'mixed_companies/search' | 'mixed_people/api_search' | 'people/bulk_match';

export type ApolloQueryValue = string | number | boolean | readonly string[];

export interface ApolloRequest {
  op: ApolloOp;
  /** Path relativo a `https://api.apollo.io/api/v1/`, senza slash iniziale. */
  path: string;
  /** Corpo JSON; assente = POST senza corpo. */
  body?: Record<string, unknown>;
  /** Querystring; le liste diventano `chiave[]=v1&chiave[]=v2`. */
  query?: Record<string, ApolloQueryValue>;
}

/** Seniority accettate da `person_seniorities` (SPEC Open Question 1: tutte e 9 offerte nel dialog). */
export const APOLLO_SENIORITIES = ['owner', 'founder', 'c_suite', 'vp', 'head', 'director', 'manager', 'senior', 'entry'] as const;
export type ApolloSeniority = (typeof APOLLO_SENIORITIES)[number];

/** Massimo di elementi per le chiamate bulk (`bulk_enrich`, `bulk_match`). */
export const APOLLO_BULK_MAX = 10;
/** Massimo di risultati per pagina nelle ricerche. */
export const APOLLO_PER_PAGE_MAX = 100;
/**
 * Limite superiore usato per la fascia aperta `N+` (es. `10001+` → `"10001,1000000"`): Apollo vuole sempre
 * due numeri separati da virgola e non documenta un valore "senza limite".
 */
export const APOLLO_OPEN_RANGE_MAX = 1_000_000;

/** Divide una lista in blocchi consecutivi da `size` elementi (l'ultimo può essere più corto). */
export function chunk<T>(list: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error(`chunk: dimensione del blocco non valida (${size})`);
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function assertBulkSize(name: string, count: number, what: string): void {
  if (count === 0) throw new Error(`${name}: serve almeno un ${what}`);
  if (count > APOLLO_BULK_MAX) {
    throw new Error(`${name}: al massimo ${APOLLO_BULK_MAX} elementi per richiesta (ricevuti ${count}): usa chunk()`);
  }
}

function assertPage(name: string, page: number, perPage: number): void {
  if (!Number.isInteger(page) || page < 1) throw new Error(`${name}: pagina non valida (${page})`);
  if (!Number.isInteger(perPage) || perPage < 1 || perPage > APOLLO_PER_PAGE_MAX) {
    throw new Error(`${name}: per_page deve essere tra 1 e ${APOLLO_PER_PAGE_MAX} (ricevuto ${perPage})`);
  }
}

/** Aggiunge `key: list` al body solo se la lista non è vuota (Apollo tratta `[]` come filtro, non come "nessun filtro"). */
function putList(body: Record<string, unknown>, key: string, list: readonly string[] | undefined): void {
  if (list && list.length > 0) body[key] = [...list];
}

/**
 * Arricchimento di al massimo 10 organizzazioni per dominio: 1 credito per organizzazione trovata.
 * Documentato come parametro di query `domains[]` (un body `details: [{domain}]` avrebbe la precedenza):
 * si usa la query, senza body.
 */
export function enrichOrganizationsRequest(domains: readonly string[]): ApolloRequest {
  assertBulkSize('enrichOrganizationsRequest', domains.length, 'dominio');
  return { op: 'organizations/bulk_enrich', path: 'organizations/bulk_enrich', query: { domains: [...domains] } };
}

export interface OrganizationSearchFilters {
  keywords: readonly string[];
  /** Fasce di dipendenti come etichette `A-B` o `N+` (fasce fisse Apollo, SPEC "Regole di somiglianza"). */
  ranges: readonly string[];
  locations: readonly string[];
}

/**
 * Converte un'etichetta di fascia nel formato Apollo `"min,max"`: `1-10` → `"1,10"`,
 * `10001+` → `"10001,1000000"` (vedi `APOLLO_OPEN_RANGE_MAX`). Etichetta non riconosciuta → errore.
 */
export function employeeRangeParam(label: string): string {
  const closed = label.trim().match(/^(\d+)\s*-\s*(\d+)$/);
  if (closed) {
    const [min, max] = [Number(closed[1]), Number(closed[2])];
    if (min <= max) return `${min},${max}`;
  }
  const open = label.trim().match(/^(\d+)\s*\+$/);
  if (open && Number(open[1]) < APOLLO_OPEN_RANGE_MAX) return `${Number(open[1])},${APOLLO_OPEN_RANGE_MAX}`;
  throw new Error(`fascia di dipendenti non valida: "${label}" (attesa "A-B" o "N+")`);
}

/** Una pagina di ricerca aziende: 1 credito per pagina. Le liste vuote sono omesse. */
export function searchOrganizationsRequest(filters: OrganizationSearchFilters, page: number, perPage: number): ApolloRequest {
  assertPage('searchOrganizationsRequest', page, perPage);
  const body: Record<string, unknown> = {};
  putList(body, 'q_organization_keyword_tags', filters.keywords);
  putList(body, 'organization_num_employees_ranges', filters.ranges.map(employeeRangeParam));
  putList(body, 'organization_locations', filters.locations);
  body.page = page;
  body.per_page = perPage;
  return { op: 'mixed_companies/search', path: 'mixed_companies/search', body };
}

export interface PeopleSearchParams {
  /** Dominio dell'azienda: una sola azienda per richiesta (P-6), così il tetto per azienda è osservabile. */
  domain: string;
  titles?: readonly string[];
  seniorities?: readonly string[];
  locations?: readonly string[];
  perPage: number;
  /** Default 1. */
  page?: number;
}

function isSeniority(value: string): value is ApolloSeniority {
  return (APOLLO_SENIORITIES as readonly string[]).includes(value);
}

/**
 * Ricerca persone via API di UNA azienda: 0 crediti, richiede master key o il permesso di ricerca persone.
 * Seniority fuori da `APOLLO_SENIORITIES` → errore. Le liste vuote sono omesse.
 */
export function searchPeopleRequest(params: PeopleSearchParams): ApolloRequest {
  const page = params.page ?? 1;
  assertPage('searchPeopleRequest', page, params.perPage);
  const domain = params.domain.trim();
  if (domain === '') throw new Error('searchPeopleRequest: dominio mancante');
  const invalid = (params.seniorities ?? []).filter((s) => !isSeniority(s));
  if (invalid.length > 0) {
    throw new Error(`searchPeopleRequest: seniority Apollo non valide: ${invalid.map((s) => `"${s}"`).join(', ')}`);
  }
  const body: Record<string, unknown> = { q_organization_domains_list: [domain] };
  putList(body, 'person_titles', params.titles);
  putList(body, 'person_seniorities', params.seniorities);
  putList(body, 'person_locations', params.locations);
  body.page = page;
  body.per_page = params.perPage;
  return { op: 'mixed_people/api_search', path: 'mixed_people/api_search', body };
}

/**
 * Persona da abbinare: per id Apollo (persone trovate dalla ricerca gratuita, che non riporta l'URL
 * LinkedIn) o per URL LinkedIn (email dei prospect già nel CRM).
 */
export type PeopleMatchDetail = { id: string; linkedin_url?: undefined } | { linkedin_url: string; id?: undefined };

/**
 * Abbinamento di al massimo 10 persone: 1 credito per persona. Mai email personali né telefoni.
 * Ogni dettaglio è ricostruito con la sola chiave usata (nessun altro campo finisce nel body); se per errore
 * arrivano entrambe, vince `id`. Dettaglio senza chiave → errore.
 */
export function matchPeopleRequest(details: readonly PeopleMatchDetail[]): ApolloRequest {
  assertBulkSize('matchPeopleRequest', details.length, 'dettaglio');
  const clean = details.map((detail, index) => {
    const id = typeof detail.id === 'string' ? detail.id.trim() : '';
    if (id !== '') return { id };
    const url = typeof detail.linkedin_url === 'string' ? detail.linkedin_url.trim() : '';
    if (url !== '') return { linkedin_url: url };
    throw new Error(`matchPeopleRequest: il dettaglio ${index + 1} non ha né id né linkedin_url`);
  });
  return {
    op: 'people/bulk_match',
    path: 'people/bulk_match',
    body: { details: clean, reveal_personal_emails: false, reveal_phone_number: false },
  };
}
