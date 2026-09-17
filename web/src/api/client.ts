import type {
  AddMembersResult,
  AnalyzeOneInput,
  AnalyzeOneResult,
  AnalyzeOptions,
  AnalyzePreviewParams,
  ApiErrorBody,
  BulkStatusInput,
  BulkStatusResult,
  CompanyFromUrlInput,
  CompanyFromUrlResult,
  CompanyInput,
  CompanyWithRefs,
  E2EFixture,
  EnrichOptions,
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
  ReferenceCompany,
  ReferenceOutcome,
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
 * `duplicate` con `body.existing_id`, `not_enriched`, `refusal`…).
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
    /** Upsert del riferimento (default esito `riferimento`). */
    setReference: (icpId: number, companyId: number, body: { outcome?: ReferenceOutcome; notes?: string | null } = {}) =>
      put<ReferenceCompany>(`/api/icps/${icpId}/reference-companies/${companyId}`, body),
    removeReference: (icpId: number, companyId: number) =>
      del<{ ok: true }>(`/api/icps/${icpId}/reference-companies/${companyId}`),
  },

  companies: {
    list: (params: { q?: string } = {}) => get<Items<CompanyWithRefs>>(`/api/companies${qs(params)}`),
    get: (id: number) => get<CompanyWithRefs>(`/api/companies/${id}`),
    /** 409 `duplicate` con `existing_id`; 400 `invalid_company_url`. */
    create: (body: CompanyInput & { linkedin_url: string }) => post<CompanyWithRefs>('/api/companies', body),
    update: (id: number, body: CompanyInput) => patch<CompanyWithRefs>(`/api/companies/${id}`, body),
    /** "Incolla e vai": crea o ritorna l'esistente (`created`), riferimento ICP opzionale. */
    fromUrl: (body: CompanyFromUrlInput) => post<CompanyFromUrlResult>('/api/companies/from-url', body),
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

  enrich: {
    preview: (params: EnrichPreviewParams) => get<JobPreview>(`/api/enrich/preview${qs({ ...params })}`),
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
 * A fine job il `JobBanner` invalida **tutto** il cache.
 */
export const queryKeys = {
  settings: ['settings'] as const,
  icps: ['icps'] as const,
  icpsIndex: ['icps', 'index'] as const,
  icp: (id: number) => ['icps', 'detail', id] as const,
  companies: ['companies'] as const,
  companiesIndex: (q = '') => ['companies', 'index', q] as const,
  company: (id: number) => ['companies', 'detail', id] as const,
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
