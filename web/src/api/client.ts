import type {
  AddMembersResult,
  AnalyzeOneInput,
  AnalyzeOneResult,
  AnalyzeOptions,
  AnalyzePreviewParams,
  ApiErrorBody,
  BulkStatusInput,
  BulkStatusResult,
  Candidate,
  CandidateBulkInput,
  CandidateBulkResult,
  CandidateOf,
  CandidatesResponse,
  CandidateStatus,
  CompanyContactsAt,
  CompanyExistsErrorBody,
  CompanyFromUrlInput,
  CompanyFromUrlResult,
  CompanyInput,
  CompanyMergePreview,
  CompanyMergeResult,
  CompanyWithRefs,
  ContactsBody,
  ContactsOptionsInput,
  ContactsPreview,
  ContactsPreviewParams,
  E2EFixture,
  EnrichCompaniesOptions,
  EnrichCompaniesPreview,
  EnrichOptions,
  EnrichPreview,
  EnrichPreviewParams,
  ExportCreated,
  ExportInput,
  ExportPreview,
  ExportRecord,
  IcpDetail,
  IcpInput,
  IcpListItem,
  IdsResult,
  Job,
  JobPreview,
  JobStarted,
  ListCreateInput,
  LookalikePreview,
  LookalikePreviewInput,
  LookalikeRun,
  LookalikeStartInput,
  ListPatchInput,
  NoteInput,
  Activity,
  Paginated,
  Post,
  ProspectAnalyses,
  ProspectDetail,
  ProspectList,
  ProspectPatch,
  ProspectQuery,
  ProspectRow,
  ReferenceOutcome,
  ReferenceSetResult,
  RemoveMembersResult,
  Settings,
  SettingsPatch,
  SourcePreviewParams,
  SourceStartInput,
  StatusChangeInput,
  SyncOptions,
  TouchpointInput,
} from './types';

/**
 * Errore che preserva lo status HTTP, così i chiamanti possono distinguere i casi
 * (es. 409 conflitto vs 404) oltre al messaggio.
 *
 * Estende `Error`, quindi i controlli `error instanceof Error` continuano a funzionare.
 * `code` e `body` riportano il body JSON del server (`{error, code?, ...extra}`): le pagine
 * ramificano su `code` (`blocked` con `body.blockers`, `job_running` con `body.job_id`,
 * `company_exists` con `body.company_id/company_name/key`, `not_enriched`, `refusal`…).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly body?: ApiErrorBody;
  constructor(status: number, message: string, body?: ApiErrorBody) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.code = body?.code;
  }
}

/** True se `err` è un `ApiError` con quel `code` (es. `isApiError(err, 'job_running')`). */
export function isApiError(err: unknown, code?: string): err is ApiError {
  return err instanceof ApiError && (code === undefined || err.code === code);
}

/**
 * Body del 409 `company_exists` (crea/modifica azienda) o `null`: `error` è il testo inline, `company_id` il
 * link "apri" e il bersaglio di "Unisci in <company_name>" (SPEC B4/B5).
 */
export function companyExistsOf(err: unknown): CompanyExistsErrorBody | null {
  if (!isApiError(err, 'company_exists') || typeof err.body?.company_id !== 'number') return null;
  return err.body as CompanyExistsErrorBody;
}

/** Blocker di un 400 `blocked` (avvio o "Riprova"), `null` se l'errore è un altro. */
export function blockersOf(err: unknown): string[] | null {
  if (!isApiError(err, 'blocked')) return null;
  return Array.isArray(err.body?.blockers) ? err.body.blockers : [err.message];
}

/** Fetch JSON: su risposta non-ok lancia `ApiError` con il campo `error` del body se presente. */
export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    const valid = body && typeof body === 'object' && typeof body.error === 'string' ? body : undefined;
    throw new ApiError(res.status, valid?.error ?? `Errore ${res.status}`, valid);
  }
  return res.json() as Promise<T>;
}

export type QsValue = string | number | boolean | null | undefined | ReadonlyArray<string | number>;

/**
 * Query string dai parametri valorizzati (salta `undefined`, `null`, stringhe e array vuoti).
 * Gli array diventano valori separati da virgola (`status=nuovo,contattato`), i booleani
 * `true`/`false` (il server li accetta entrambi). Accetta anche interfacce (es. `ProspectQuery`).
 */
export function qs<T extends { [K in keyof T]: QsValue }>(params: T): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length > 0) sp.set(k, v.join(','));
      continue;
    }
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

function send<T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, body?: unknown): Promise<T> {
  return request<T>(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const get = <T>(url: string) => request<T>(url);
const post = <T>(url: string, body?: unknown) => send<T>('POST', url, body);
const put = <T>(url: string, body?: unknown) => send<T>('PUT', url, body);
const patch = <T>(url: string, body?: unknown) => send<T>('PATCH', url, body);
const del = <T>(url: string, body?: unknown) => send<T>('DELETE', url, body);

type Items<T> = { items: T[] };

const withQuery = (sp: URLSearchParams) => {
  const text = sp.toString();
  return text ? `?${text}` : '';
};

/**
 * Opzioni del passo contatti nella query (PLAN §12-bis, formato di `src/server/routes/contacts.ts`), con un
 * prefisso opzionale (`contacts` nella preview della pipeline → `contactsListId`, `contactsRoles`…):
 * - `roles`/`locations` **solo chiavi ripetute** (un valore può contenere virgole); `undefined` = chiave
 *   assente = default dell'ICP; `[]` = chiave vuota (`roles=`) = nessun ruolo / ovunque;
 * - `seniorities` a virgola, omesse se vuote (= nessun filtro); `listId`/`perCompany` valori singoli.
 */
function appendContactsOptions(sp: URLSearchParams, opts: ContactsOptionsInput, prefix = ''): void {
  const key = (name: string) => (prefix ? `${prefix}${name.charAt(0).toUpperCase()}${name.slice(1)}` : name);
  if (opts.listId !== undefined) sp.set(key('listId'), String(opts.listId));
  for (const name of ['roles', 'locations'] as const) {
    const values = opts[name];
    if (values === undefined) continue;
    if (values.length === 0) sp.append(key(name), '');
    for (const value of values) sp.append(key(name), value);
  }
  if (opts.seniorities?.length) sp.set(key('seniorities'), opts.seniorities.join(','));
  if (opts.perCompany !== undefined) sp.set(key('perCompany'), String(opts.perCompany));
}

/**
 * Query della preview lookalike (PLAN §12-bis): filtri derivati senza `custom`; con `custom=1` valgono
 * esattamente i valori ripetuti (`keywords=a&keywords=b`, mai a virgola: una località può contenerne).
 * `pages`/`perPage`/`restart` solo se diversi dal default del server. `contacts` = pipeline attiva
 * (`contacts=1&contactsListId=…&contactsRoles=…`, stesse regole della preview dei contatti).
 */
function lookalikeQuery({ pages, perPage, restart, filters, contacts }: LookalikePreviewInput): string {
  const sp = new URLSearchParams();
  if (pages !== undefined) sp.set('pages', String(pages));
  if (perPage !== undefined) sp.set('perPage', String(perPage));
  if (restart) sp.set('restart', '1');
  if (filters) {
    sp.set('custom', '1');
    for (const key of ['keywords', 'ranges', 'locations'] as const) {
      for (const value of filters[key]) sp.append(key, value);
    }
  }
  if (contacts) {
    sp.set('contacts', '1');
    appendContactsOptions(sp, contacts, 'contacts');
  }
  return withQuery(sp);
}

/** Query della preview di "Trova contatti": `companyIds=1,2` + opzioni (`appendContactsOptions`). */
function contactsQuery({ companyIds, ...opts }: Omit<ContactsPreviewParams, 'icpId'>): string {
  const sp = new URLSearchParams();
  if (companyIds.length > 0) sp.set('companyIds', companyIds.join(','));
  appendContactsOptions(sp, opts);
  return withQuery(sp);
}

/**
 * Tutte le chiamate dell'API del CRM, raggruppate per risorsa. Ogni funzione ritorna il payload
 * tipizzato (`./types`) o lancia `ApiError`. Gli avvii di job ritornano `{job}` (202); con
 * configurazione mancante 400 `blocked`, con un job già in corso 409 `job_running`.
 */
export const api = {
  settings: {
    /** `GET /api/settings` → impostazioni + `readiness`. */
    get: () => get<Settings>('/api/settings'),
    /** `PUT /api/settings` parziale; URL profilo non valido → 400 `invalid_profile_url`. */
    update: (body: SettingsPatch) => put<Settings>('/api/settings', body),
  },

  icps: {
    list: () => get<Items<IcpListItem>>('/api/icps'),
    get: (id: number) => get<IcpDetail>(`/api/icps/${id}`),
    create: (body: IcpInput & { name: string }) => post<IcpDetail>('/api/icps', body),
    update: (id: number, body: IcpInput) => patch<IcpDetail>(`/api/icps/${id}`, body),
    /** 409 `icp_has_lists` (con `lists_count`) se l'ICP ha liste, anche archiviate. */
    remove: (id: number) => del<{ ok: true }>(`/api/icps/${id}`),
    /**
     * Upsert del riferimento (default esito `riferimento`); `candidate_removed` = l'azienda era candidata di
     * questo ICP ed è uscita dalle candidate (toast "uscita dalle candidate di <ICP>", SPEC E4).
     */
    setReference: (icpId: number, companyId: number, body: { outcome?: ReferenceOutcome; notes?: string | null } = {}) =>
      put<ReferenceSetResult>(`/api/icps/${icpId}/reference-companies/${companyId}`, body),
    removeReference: (icpId: number, companyId: number) =>
      del<{ ok: true }>(`/api/icps/${icpId}/reference-companies/${companyId}`),
  },

  companies: {
    /** `q` cerca per nome, URL LinkedIn o dominio. */
    list: (params: { q?: string } = {}) => get<Items<CompanyWithRefs>>(`/api/companies${qs(params)}`),
    get: (id: number) => get<CompanyWithRefs>(`/api/companies/${id}`),
    /**
     * 201 da URL LinkedIn e/o sito (`linkedin_url: null` = solo dominio) · 400 `company_keys_missing` · 400
     * `invalid_company_url` · 409 `company_exists` (`companyExistsOf(err)`).
     */
    create: (body: CompanyInput) => post<CompanyWithRefs>('/api/companies', body),
    /** `''`/`null` toglie una chiave (mai entrambe: 400 `company_keys_missing`); 409 `company_exists`. */
    update: (id: number, body: CompanyInput) => patch<CompanyWithRefs>(`/api/companies/${id}`, body),
    /** "Incolla e vai": URL LinkedIn o sito; crea o ritorna l'esistente (`created`, mai 409), riferimento ICP opzionale. */
    fromUrl: (body: CompanyFromUrlInput) => post<CompanyFromUrlResult>('/api/companies/from-url', body),
    /** Cosa comporta unire `id` in `into` (sola lettura): chiavi e note perse, righe assorbite. 400/404. */
    mergePreview: (id: number, into: number) =>
      get<CompanyMergePreview>(`/api/companies/${id}/merge/preview${qs({ into })}`),
    /** Unione esplicita e irreversibile: resta `into`, `id` sparisce → `{company}` · 400 `merge_same_company` · 404. */
    merge: (id: number, into: number) => post<CompanyMergeResult>(`/api/companies/${id}/merge`, { into }),
    /** ICP di cui l'azienda è candidata (card "Candidata per ICP"). */
    candidateOf: (id: number) => get<Items<CandidateOf>>(`/api/companies/${id}/candidate-of`),
    /** "Contatti cercati il <data>": fonte `apollo_people` più recente (con `listId` solo sui membri della lista). */
    contactsAt: (id: number, listId?: number) => get<CompanyContactsAt>(`/api/companies/${id}/contacts-at${qs({ listId })}`),
    /** "Arricchisci con Apollo" della singola azienda (SPEC C4): stessa preview/avvio di `enrichCompanies`. */
    enrichApollo: {
      preview: (id: number, opts: EnrichCompaniesOptions = {}) =>
        get<EnrichCompaniesPreview>(`/api/companies/${id}/enrich-apollo/preview${qs({ ...opts })}`),
      /** 202 · 400 `blocked` (chiave, serve il sito, già arricchita) · 404 · 409 `job_running`. */
      start: (id: number, opts: EnrichCompaniesOptions = {}) => post<JobStarted>(`/api/companies/${id}/enrich-apollo`, opts),
    },
    /** Preview del sourcing. `roles: []` = nessun ruolo; omesso = ruoli dell'ICP della lista. */
    sourcePreview: ({ companyId, roles, ...rest }: SourcePreviewParams) => {
      const base = qs(rest);
      const rolesParam = roles === undefined ? '' : `roles=${encodeURIComponent(roles.join(','))}`;
      const query = rolesParam ? (base ? `${base}&${rolesParam}` : `?${rolesParam}`) : base;
      return get<JobPreview>(`/api/companies/${companyId}/source/preview${query}`);
    },
    startSourcing: (companyId: number, body: SourceStartInput) =>
      post<JobStarted>(`/api/companies/${companyId}/source`, body),
  },

  lists: {
    list: (params: { includeArchived?: boolean } = {}) => get<Items<ProspectList>>(`/api/lists${qs(params)}`),
    get: (id: number) => get<ProspectList>(`/api/lists/${id}`),
    create: (body: ListCreateInput) => post<ProspectList>('/api/lists', body),
    /** Nome, descrizione, `archived: true|false`. */
    update: (id: number, body: ListPatchInput) => patch<ProspectList>(`/api/lists/${id}`, body),
    /** Id dei membri filtrati (cap 500). */
    memberIds: (id: number, query: Omit<ProspectQuery, 'listId'> = {}) =>
      get<IdsResult>(`/api/lists/${id}/members/ids${qs(query)}`),
    /** Idempotente: `{added, skipped, not_found}`. */
    addMembers: (id: number, prospectIds: number[]) =>
      post<AddMembersResult>(`/api/lists/${id}/members`, { prospectIds }),
    removeMembers: (id: number, prospectIds: number[]) =>
      del<RemoveMembersResult>(`/api/lists/${id}/members`, { prospectIds }),
  },

  prospects: {
    /** Inbox = senza lista e non scartati (salvo `includeDiscarded` o `status=scartato`). */
    inbox: (query: ProspectQuery = {}) => get<Paginated<ProspectRow>>(`/api/inbox${qs(query)}`),
    inboxIds: (query: ProspectQuery = {}) => get<IdsResult>(`/api/inbox/ids${qs(query)}`),
    /** Ricerca generale (membri di una lista con `listId`, prospect di un'azienda con `companyId`). */
    search: (query: ProspectQuery = {}) => get<Paginated<ProspectRow>>(`/api/prospects${qs(query)}`),
    searchIds: (query: ProspectQuery = {}) => get<IdsResult>(`/api/prospects/ids${qs(query)}`),
    get: (id: number) => get<ProspectDetail>(`/api/prospects/${id}`),
    update: (id: number, body: ProspectPatch) => patch<ProspectDetail>(`/api/prospects/${id}`, body),
    /** Cambio stato manuale (logga `status_change`) → dettaglio aggiornato. */
    changeStatus: (id: number, body: StatusChangeInput) => post<ProspectDetail>(`/api/prospects/${id}/status`, body),
    bulkStatus: (body: BulkStatusInput) => post<BulkStatusResult>('/api/prospects/bulk/status', body),
    /** 201 con l'attività `touchpoint` (+ `status_change` se `newStatus`). */
    addTouchpoint: (id: number, body: TouchpointInput) => post<Activity>(`/api/prospects/${id}/touchpoints`, body),
    addNote: (id: number, body: NoteInput) => post<Activity>(`/api/prospects/${id}/notes`, body),
    /** Solo `touchpoint`/`note`; altrimenti 409 `activity_not_deletable`. */
    deleteActivity: (activityId: number) => del<{ ok: true }>(`/api/activities/${activityId}`),
  },

  jobs: {
    /** Il job in corso o, se nessuno gira, l'ultimo terminato (`null` se mai lanciato). */
    current: () => get<{ job: Job | null }>('/api/jobs/current'),
    list: (limit = 20) => get<Items<Job>>(`/api/jobs${qs({ limit })}`),
    get: (id: number) => get<Job>(`/api/jobs/${id}`),
    /** Solo job `failed`: 409 `job_not_failed` altrimenti, 409 `job_running` se ne gira uno. */
    retry: (id: number) => post<JobStarted>(`/api/jobs/${id}/retry`),
  },

  sync: {
    preview: (opts: SyncOptions = {}) => get<JobPreview>(`/api/sync/preview${qs({ ...opts })}`),
    start: (body: SyncOptions & E2EFixture = {}) => post<JobStarted>('/api/sync/interactions', body),
    posts: () => get<Items<Post>>('/api/posts'),
  },

  /** Arricchimento prospect; `provider: 'apollo'` = solo email di lavoro (SPEC G): 0 target → 400 `blocked`. */
  enrich: {
    /** `counts` Apify `{selected, targets, skipped_enriched, …}` o Apollo `{…, skipped_with_email, est_credits}`. */
    preview: (params: EnrichPreviewParams) => get<EnrichPreview>(`/api/enrich/preview${qs({ ...params })}`),
    startProspect: (id: number, opts: EnrichOptions = {}) => post<JobStarted>(`/api/prospects/${id}/enrich`, opts),
    startSelection: (prospectIds: number[], opts: EnrichOptions = {}) =>
      post<JobStarted>('/api/enrich', { prospectIds, ...opts }),
    startList: (listId: number, opts: EnrichOptions = {}) => post<JobStarted>(`/api/lists/${listId}/enrich`, opts),
  },

  analyze: {
    /** Preview (+ `model`): `counts.to_enrich`, `to_analyze`, `skipped_same_input`… */
    preview: (params: AnalyzePreviewParams) => get<JobPreview>(`/api/analyze/preview${qs({ ...params })}`),
    startSelection: (body: { prospectIds: number[]; icpId: number } & AnalyzeOptions & E2EFixture) =>
      post<JobStarted>('/api/analyze', body),
    startList: (listId: number, opts: AnalyzeOptions & E2EFixture = {}) =>
      post<JobStarted>(`/api/lists/${listId}/analyze`, opts),
    /**
     * Analisi singola **sincrona** (non un job, fino a ~3 min con `enrichFirst`): 409
     * `not_enriched`/`not_enrichable`, 502 `refusal`/`invalid_output`/`max_tokens`/`analysis_failed`.
     */
    one: (prospectId: number, body: AnalyzeOneInput) =>
      post<AnalyzeOneResult>(`/api/prospects/${prospectId}/analyze`, body),
    /** Ultima analisi per ICP con `stale`, storico e ultimo errore. */
    ofProspect: (prospectId: number, icpId: number) =>
      get<ProspectAnalyses>(`/api/prospects/${prospectId}/analyses${qs({ icpId })}`),
  },

  /** Arricchimento Apollo delle referenze di un ICP (apollo-lookalike T7c, SPEC C). */
  enrichCompanies: {
    /** `counts {references, with_domain, to_enrich, skipped_fresh, enriched, est_credits}` + `items[]`. */
    preview: (icpId: number, opts: EnrichCompaniesOptions = {}) =>
      get<EnrichCompaniesPreview>(`/api/icps/${icpId}/enrich-companies/preview${qs({ ...opts })}`),
    /** 202 · 400 `blocked` (chiave mancante, nessuna referenza da arricchire) · 404 · 409 `job_running`. */
    start: (icpId: number, opts: EnrichCompaniesOptions = {}) =>
      post<JobStarted>(`/api/icps/${icpId}/enrich-companies`, opts),
  },

  /** Ricerca aziende simili (apollo-lookalike T7a, SPEC D). */
  lookalike: {
    /** Preview con filtri (derivati o `custom`), ripartenza e referenze; pagine fuori range → 400 `issues[path=pages]`. */
    preview: (icpId: number, input: LookalikePreviewInput = {}) =>
      get<LookalikePreview>(`/api/icps/${icpId}/lookalike/preview${lookalikeQuery(input)}`),
    /** Ultime 5 ricerche riuscite con le statistiche per fascia × stato (SPEC D14). */
    runs: (icpId: number) => get<Items<LookalikeRun>>(`/api/icps/${icpId}/lookalike/runs`),
    /** 202 · 400 `blocked` (chiave, filtri vuoti, lista della pipeline) · 404 · 409 `job_running`. */
    start: (icpId: number, body: LookalikeStartInput) => post<JobStarted>(`/api/icps/${icpId}/lookalike`, body),
  },

  /** Candidate di un ICP e triage (apollo-lookalike T11, SPEC E). */
  candidates: {
    /** Candidate dell'ICP nello stato (tutte senza `status`; cap 500) + `counts` per stato e `last_run`. */
    list: (icpId: number, status?: CandidateStatus) =>
      get<CandidatesResponse>(`/api/icps/${icpId}/candidates${qs({ status })}`),
    /** Cambio stato per riga, idempotente (aggiorna sempre `decided_at`) → candidata · 404 se non è candidata. */
    update: (icpId: number, companyId: number, status: CandidateStatus) =>
      patch<Candidate>(`/api/icps/${icpId}/candidates/${companyId}`, { status }),
    /** Cambio stato in bulk **per item**: `{updated, failed: [{company_id, error}]}`, mai tutto-o-niente. */
    bulk: (icpId: number, body: CandidateBulkInput) => post<CandidateBulkResult>(`/api/icps/${icpId}/candidates/bulk`, body),
  },

  /**
   * "Trova contatti" nelle aziende scelte (apollo-lookalike T8, SPEC F). Dal dettaglio azienda (F12): `icpId` =
   * ICP della lista scelta, `companyIds: [id]`.
   */
  contacts: {
    /** `counts {companies, with_domain, without_domain, per_company, requests, est_credits}` + warning/blocker. */
    preview: ({ icpId, ...params }: ContactsPreviewParams) =>
      get<ContactsPreview>(`/api/icps/${icpId}/contacts/preview${contactsQuery(params)}`),
    /** 202 · 400 `blocked` (chiave, aziende senza sito, lista) · 404 · 409 `job_running`. */
    start: (icpId: number, body: ContactsBody) => post<JobStarted>(`/api/icps/${icpId}/contacts`, body),
  },

  exports: {
    /** 201 `{id, count, download_url, …}`; 0 prospect → 400 `empty_export`. */
    create: (listId: number, body: ExportInput) => post<ExportCreated>(`/api/lists/${listId}/exports`, body),
    history: (listId: number) => get<Items<ExportRecord>>(`/api/lists/${listId}/exports`),
    /** Conteggio vivo del dialog di export, nessuna scrittura. */
    preview: (listId: number, params: ExportInput) =>
      get<ExportPreview>(`/api/lists/${listId}/exports/preview${qs({ ...params })}`),
    /** URL del CSV da scaricare (`<a href download>` o `window.location`). */
    csvUrl: (exportId: number) => `/api/exports/${exportId}.csv`,
  },
} as const;

/**
 * Query key condivise (TanStack Query): usarle ovunque così gli `invalidateQueries` dopo le
 * scritture e a fine job raggiungono tutte le pagine. Le chiavi "radice" (`icps`, `lists`,
 * `prospects`…) sono prefissi da invalidare; le funzioni danno la chiave della singola query.
 * A fine job il `JobBanner` invalida **tutto** il cache tranne il job corrente (`invalidateAfterJob` in
 * `lib/jobs.ts`): così i job Apollo aggiornano dettaglio ICP, `lookalikeRuns`, `candidates` (ogni stato),
 * liste e membri, prospect, aziende, `companyCandidateOf`/`companyContactsAt` e le preview senza reload.
 * Una nuova query deve stare sotto uno di questi prefissi (mai sotto `['jobs', 'current']`).
 */
export const queryKeys = {
  settings: ['settings'] as const,
  icps: ['icps'] as const,
  icpsIndex: ['icps', 'index'] as const,
  icp: (id: number) => ['icps', 'detail', id] as const,
  /** Ricerche precedenti della card "Aziende simili" (sotto il prefisso `icps`). */
  lookalikeRuns: (icpId: number) => ['icps', 'lookalike-runs', icpId] as const,
  /** Candidate dell'ICP per stato (`all` = senza filtro). */
  candidates: (icpId: number, status?: CandidateStatus) => ['icps', 'candidates', icpId, status ?? 'all'] as const,
  /** Prefisso di tutte le candidate di un ICP (ogni stato): da invalidare dopo un cambio stato. */
  candidatesOfIcp: (icpId: number) => ['icps', 'candidates', icpId] as const,
  companies: ['companies'] as const,
  companiesIndex: (q = '') => ['companies', 'index', q] as const,
  company: (id: number) => ['companies', 'detail', id] as const,
  /** Card "Candidata per ICP" del dettaglio azienda (prefisso `companies`). */
  companyCandidateOf: (id: number) => ['companies', 'candidate-of', id] as const,
  /** "Contatti cercati il <data>" (`all` = qualunque lista). */
  companyContactsAt: (id: number, listId?: number) => ['companies', 'contacts-at', id, listId ?? 'all'] as const,
  /** Dialog di conferma di "Unisci in" (sola lettura, da ricaricare a ogni apertura). */
  companyMergePreview: (id: number, into: number) => ['companies', 'merge-preview', id, into] as const,
  lists: ['lists'] as const,
  listsIndex: (includeArchived = false) => ['lists', 'index', includeArchived] as const,
  list: (id: number) => ['lists', 'detail', id] as const,
  exports: (listId: number) => ['lists', 'exports', listId] as const,
  prospects: ['prospects'] as const,
  prospectsSearch: (query: ProspectQuery) => ['prospects', 'search', query] as const,
  prospect: (id: number) => ['prospects', 'detail', id] as const,
  analyses: (prospectId: number, icpId: number) => ['prospects', 'analyses', prospectId, icpId] as const,
  inbox: ['inbox'] as const,
  inboxPage: (query: ProspectQuery) => ['inbox', query] as const,
  posts: ['posts'] as const,
  jobs: ['jobs'] as const,
  jobsIndex: (limit = 20) => ['jobs', 'index', limit] as const,
  currentJob: ['jobs', 'current'] as const,
  jobPreviews: ['jobs', 'preview'] as const,
};
