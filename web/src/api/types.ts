/*
 * Tipi dell'API del CRM di prospecting (crm-foundation T13), specchio dei payload reali del
 * server (`src/db/*`, `src/server/routes/*`, log dei task T4–T12 nel PLAN). Convenzioni: campi
 * delle righe DB in snake_case come salvati (colonne JSON già parsate), body e query nei nomi del
 * PLAN (`prospectIds`, `listId`, `icpId`…), collezioni `{items}`, paginate `+ total/page/pageSize`,
 * avvio job `202 {job}`, preview `JobPreview`. Gli enum ricalcano `src/db/schema.ts`: se il server
 * li cambia, vanno aggiornati qui.
 */

// ---------------------------------------------------------------------------
// Enum condivisi (runtime + tipo) e label italiane
// ---------------------------------------------------------------------------

/** I 9 stati del prospect (D6), nell'ordine dell'outreach. */
export const PROSPECT_STATUSES = [
  'nuovo',
  'qualificato',
  'da_contattare',
  'contattato',
  'risposto',
  'in_conversazione',
  'chiuso_vinto',
  'chiuso_perso',
  'scartato',
] as const;
export type ProspectStatus = (typeof PROSPECT_STATUSES)[number];

/** Label italiane degli stati (specchio di `STATUS_LABELS` in `src/domain/status.ts`). */
export const STATUS_LABELS: Record<ProspectStatus, string> = {
  nuovo: 'Nuovo',
  qualificato: 'Qualificato',
  da_contattare: 'Da contattare',
  contattato: 'Contattato',
  risposto: 'Risposto',
  in_conversazione: 'In conversazione',
  chiuso_vinto: 'Chiuso vinto',
  chiuso_perso: 'Chiuso perso',
  scartato: 'Scartato',
};

export const REFERENCE_OUTCOMES = ['vinta', 'in_trattativa', 'persa', 'riferimento'] as const;
export type ReferenceOutcome = (typeof REFERENCE_OUTCOMES)[number];
export const REFERENCE_OUTCOME_LABELS: Record<ReferenceOutcome, string> = {
  vinta: 'Vinta',
  in_trattativa: 'In trattativa',
  persa: 'Persa',
  riferimento: 'Riferimento',
};

export const SOURCE_KINDS = ['post_reaction', 'post_comment', 'company_employees', 'manual'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  post_reaction: 'reazione',
  post_comment: 'commento',
  company_employees: 'dipendente',
  manual: 'manuale',
};

export const ACTIVITY_KINDS = ['status_change', 'touchpoint', 'note', 'export', 'analysis', 'enrichment'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const CHANNELS = ['email', 'linkedin_dm', 'linkedin_comment', 'call', 'other'] as const;
export type Channel = (typeof CHANNELS)[number];
export const CHANNEL_LABELS: Record<Channel, string> = {
  email: 'Email',
  linkedin_dm: 'DM LinkedIn',
  linkedin_comment: 'Commento LinkedIn',
  call: 'Chiamata',
  other: 'Altro',
};

export const DIRECTIONS = ['outbound', 'inbound'] as const;
export type Direction = (typeof DIRECTIONS)[number];
export const DIRECTION_LABELS: Record<Direction, string> = { outbound: 'In uscita', inbound: 'In entrata' };

export const FIT_LEVELS = ['alto', 'medio', 'basso'] as const;
export type FitLevel = (typeof FIT_LEVELS)[number];

/**
 * Stato della colonna Fit per riga (FLOW E.4): fit dell'ultima analisi, oppure l'ultimo
 * tentativo fallito (`rifiutata`/`errore`) o l'arricchimento senza dati (`non_arricchibile`).
 */
export type AnalysisState = FitLevel | 'rifiutata' | 'errore' | 'non_arricchibile';

/** Valori del filtro `fit` (`none` = non analizzato). */
export const FIT_FILTERS = ['alto', 'medio', 'basso', 'none', 'rifiutata', 'errore', 'non_arricchibile'] as const;
export type FitFilter = (typeof FIT_FILTERS)[number];

export const PROSPECT_SORTS = ['recent', 'comments_first', 'most_interactions', 'fit'] as const;
export type ProspectSort = (typeof PROSPECT_SORTS)[number];

export const JOB_KINDS = ['sync_interactions', 'source_company', 'enrich', 'analyze'] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export const JOB_STATES = ['running', 'succeeded', 'failed'] as const;
export type JobState = (typeof JOB_STATES)[number];

export const EMPLOYEES_MODES = ['Short', 'Full', 'Full+email'] as const;
export type EmployeesMode = (typeof EMPLOYEES_MODES)[number];

// ---------------------------------------------------------------------------
// Errori
// ---------------------------------------------------------------------------

/**
 * Body di errore del server: `{error, code?, ...extra}`. Codici noti: `blocked` (400, `blockers`),
 * `job_running` (409, `job_id`), `job_not_failed` (409), `duplicate` (409, `existing_id`),
 * `not_enriched`/`not_enrichable` (409), `refusal`/`invalid_output`/`max_tokens`/`analysis_failed`/
 * `enrich_failed` (502, `activity_id`), `invalid_profile_url`/`invalid_company_url` (400),
 * `icp_has_lists` (409, `lists_count`), `activity_not_deletable` (409), `icp_required`,
 * `invalid_scope`, `fit_requires_icp`, `icp_not_found`, `list_not_found`, `config` (400);
 * validazione zod → `issues[]`.
 */
export interface ApiErrorBody {
  error: string;
  code?: string;
  blockers?: string[];
  job_id?: number;
  existing_id?: number;
  lists_count?: number;
  activity_id?: number | null;
  issues?: Array<{ path: string; message: string }>;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Impostazioni (T4)
// ---------------------------------------------------------------------------

/**
 * Cosa è pronto: token (`apify`, `anthropic`), profilo salvato, descrizione azienda non vuota
 * (`company`), almeno un ICP (`icp`) e almeno un prospect (`prospects`).
 */
export interface Readiness {
  apify: boolean;
  anthropic: boolean;
  profile: boolean;
  company: boolean;
  icp: boolean;
  prospects: boolean;
}

export interface Settings {
  own_profile_url: string | null;
  company_name: string | null;
  company_description: string | null;
  company_offering: string | null;
  readiness: Readiness;
}

/** PUT parziale: chiavi assenti invariate, `''`/`null` azzera. */
export type SettingsPatch = Partial<Omit<Settings, 'readiness'>>;

// ---------------------------------------------------------------------------
// ICP e aziende (T4, T9)
// ---------------------------------------------------------------------------

export interface Icp {
  id: number;
  name: string;
  description: string | null;
  target_roles: string[];
  target_industries: string[];
  target_locations: string[];
  company_size: string | null;
  pains: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Riga di `GET /api/icps` (`lists_count` conta anche le archiviate). */
export interface IcpListItem extends Icp {
  lists_count: number;
  reference_companies_count: number;
}

export interface ReferenceCompany {
  icp_id: number;
  company_id: number;
  outcome: ReferenceOutcome;
  notes: string | null;
  company: Company;
}

export interface IcpListRef {
  id: number;
  name: string;
  archived_at: string | null;
}

/** `GET|POST|PATCH /api/icps/:id`. */
export interface IcpDetail extends Icp {
  reference_companies: ReferenceCompany[];
  lists: IcpListRef[];
}

/** Body di `POST /api/icps` (nome obbligatorio) e `PATCH` (tutto facoltativo). */
export interface IcpInput {
  name?: string;
  description?: string | null;
  target_roles?: string[];
  target_industries?: string[];
  target_locations?: string[];
  company_size?: string | null;
  pains?: string | null;
  notes?: string | null;
}

export interface Company {
  id: number;
  linkedin_url: string;
  name: string | null;
  website: string | null;
  industry: string | null;
  size: string | null;
  location: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CompanyReferenceOf {
  icp_id: number;
  icp_name: string;
  outcome: ReferenceOutcome;
  notes: string | null;
}

/** Riga e dettaglio di `GET /api/companies[/:id]`. */
export interface CompanyWithRefs extends Company {
  reference_of: CompanyReferenceOf[];
  prospects_count: number;
}

export interface CompanyInput {
  linkedin_url?: string;
  name?: string | null;
  website?: string | null;
  industry?: string | null;
  size?: string | null;
  location?: string | null;
  notes?: string | null;
}

/** `POST /api/companies/from-url`: 201 creata / 200 esistente. */
export interface CompanyFromUrlResult extends CompanyWithRefs {
  created: boolean;
}

export interface CompanyFromUrlInput {
  url: string;
  icpId?: number;
  outcome?: ReferenceOutcome;
}

/** Preview del sourcing (`GET /api/companies/:id/source/preview`). `roles: []` = nessun ruolo; assente = ruoli dell'ICP. */
export interface SourcePreviewParams {
  companyId: number;
  listId?: number;
  mode?: EmployeesMode;
  maxItems?: number;
  roles?: string[];
}

export interface SourceStartInput {
  listId: number;
  roles?: string[];
  locations?: string[];
  maxItems?: number;
  mode?: EmployeesMode;
}

// ---------------------------------------------------------------------------
// Liste (T5)
// ---------------------------------------------------------------------------

/** Lista con ICP e conteggi (`GET /api/lists` e `GET /api/lists/:id`, stessa forma). */
export interface ProspectList {
  id: number;
  icp_id: number;
  name: string;
  description: string | null;
  created_at: string;
  /** Archiviata = nascosta da `/lists` e job disabilitati (lettura/export permessi). */
  archived_at: string | null;
  icp: { id: number; name: string };
  members_count: number;
  /** Tutti i 9 stati, anche a 0. */
  counts_by_status: Record<ProspectStatus, number>;
  enriched_count: number;
  with_email_count: number;
  analyzed_count: number;
}

export interface ListCreateInput {
  icpId: number;
  name: string;
  description?: string | null;
}

export interface ListPatchInput {
  name?: string;
  description?: string | null;
  archived?: boolean;
}

export interface AddMembersResult {
  added: number;
  skipped: number;
  not_found: number;
}

export interface RemoveMembersResult {
  ok: true;
  removed: number;
}

// ---------------------------------------------------------------------------
// Prospect, fonti, analisi, attività (T5, T11)
// ---------------------------------------------------------------------------

interface ProspectBase {
  id: number;
  linkedin_url: string;
  full_name: string | null;
  headline: string | null;
  location: string | null;
  email: string | null;
  phone: string | null;
  company_id: number | null;
  company_name: string | null;
  title: string | null;
  enriched_at: string | null;
  enrichment_attempted_at: string | null;
  status: ProspectStatus;
  status_changed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Fonte con post/azienda risolti (nelle righe di tabella excerpt ≤120 e commento ≤280). */
export interface Source {
  id: number;
  kind: SourceKind;
  post_id: number | null;
  post_url: string | null;
  post_excerpt: string | null;
  company_id: number | null;
  company_name: string | null;
  reaction_type: string | null;
  comment_text: string | null;
  captured_at: string;
}

export interface Membership {
  list_id: number;
  list_name: string;
  icp_id: number;
  icp_name: string;
  added_at: string;
  archived_at: string | null;
}

export interface AnalysisAngle {
  title: string;
  rationale: string;
}

/** Analisi salvata (grezza: `stale` lo calcola solo `GET /api/prospects/:id/analyses`). */
export interface Analysis {
  id: number;
  prospect_id: number;
  icp_id: number;
  icp_name: string;
  model: string;
  summary: string;
  angles: AnalysisAngle[];
  fit: FitLevel;
  fit_reason: string | null;
  input_hash: string;
  created_at: string;
}

/** Riga di tabella (Inbox, Lista, prospect di un'azienda): senza `about`/`raw_json`. */
export interface ProspectRow extends ProspectBase {
  has_email: boolean;
  sources_count: number;
  source_kinds: SourceKind[];
  source_counts: Partial<Record<SourceKind, number>>;
  sources: Source[];
  last_captured_at: string | null;
  last_touchpoint_at: string | null;
  latest_analysis: Omit<Analysis, 'angles' | 'model' | 'prospect_id'> | null;
  /** Colonna Fit per lo stesso ICP di `latest_analysis` (`null` = non analizzato). */
  analysis_state: AnalysisState | null;
  /** Messaggio dell'ultimo fallimento quando `analysis_state` è `rifiutata`/`errore`. */
  analysis_error: string | null;
  memberships: Membership[];
}

export interface Activity {
  id: number;
  prospect_id: number;
  list_id: number | null;
  list_name: string | null;
  kind: ActivityKind;
  channel: Channel | null;
  direction: Direction | null;
  from_status: ProspectStatus | null;
  to_status: ProspectStatus | null;
  body: string | null;
  meta: Record<string, unknown> | null;
  occurred_at: string;
  created_at: string;
  /** Solo `touchpoint` e `note` si eliminano. */
  deletable: boolean;
}

/** `GET /api/prospects/:id`. */
export interface ProspectDetail extends ProspectBase {
  member_urn: string | null;
  about: string | null;
  /** `raw_json` parsato (es. `{source, experience, education, certifications}` dopo l'enrichment). */
  raw: unknown;
  has_email: boolean;
  sources: Source[];
  memberships: Membership[];
  /** La più recente fra tutti gli ICP. */
  latest_analysis: Analysis | null;
  /** L'ultima per ciascun ICP, dalla più recente. */
  latest_analyses: Analysis[];
  last_touchpoint_at: string | null;
  timeline: Activity[];
}

/** Campi anagrafici modificabili (`PATCH /api/prospects/:id`, vuoto azzera). */
export type ProspectPatch = Partial<
  Record<'full_name' | 'headline' | 'email' | 'phone' | 'title' | 'company_name' | 'location' | 'about', string | null>
>;

/**
 * Filtri di `GET /api/inbox`, `/api/prospects` e dei relativi `/ids` (array → valori separati da
 * virgola). `fit` vale entro `icpId` (o l'ICP della lista / l'unico ICP, altrimenti 400
 * `fit_requires_icp`). `status=scartato` mostra solo gli scartati.
 */
export interface ProspectQuery {
  q?: string;
  status?: ProspectStatus[];
  listId?: number;
  companyId?: number;
  hasEmail?: boolean;
  enriched?: boolean;
  source?: SourceKind[];
  postId?: number;
  fit?: FitFilter[];
  icpId?: number;
  includeDiscarded?: boolean;
  sort?: ProspectSort;
  page?: number;
  /** Default 50, massimo 100. */
  pageSize?: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** "Seleziona tutti i filtrati": al più 500 id (`capped` se ce n'erano di più). */
export interface IdsResult {
  ids: number[];
  total: number;
  capped: boolean;
}

export interface StatusChangeInput {
  status: ProspectStatus;
  note?: string | null;
  listId?: number | null;
}

export interface BulkStatusInput extends StatusChangeInput {
  prospectIds: number[];
}

export interface BulkStatusResult {
  updated: number;
  unchanged: number;
  not_found: number;
}

export interface TouchpointInput {
  channel: Channel;
  direction: Direction;
  listId?: number | null;
  /** Qualunque data leggibile: il server la normalizza in ISO. Default adesso. */
  occurredAt?: string;
  body?: string | null;
  note?: string | null;
  /** Cambio stato nella stessa transazione (P8). */
  newStatus?: ProspectStatus | null;
}

export interface NoteInput {
  body: string;
  listId?: number | null;
  occurredAt?: string;
}

// ---------------------------------------------------------------------------
// Analisi AI (T11)
// ---------------------------------------------------------------------------

export interface AnalyzeOneInput {
  icpId: number;
  force?: boolean;
  /** Arricchisce inline prima di analizzare (sincrono, fino a ~3 min). */
  enrichFirst?: boolean;
}

/** `POST /api/prospects/:id/analyze` → 200 (errori: 409 `not_enriched`, 502 `refusal`…). */
export interface AnalyzeOneResult {
  outcome: 'analyzed' | 'skipped_same_input';
  enriched_first: boolean;
  stale: false;
  analysis: Analysis;
}

/** `GET /api/prospects/:id/analyses?icpId=`: unico punto che calcola `stale`. */
export interface ProspectAnalyses {
  icp_id: number;
  latest: Analysis | null;
  stale: boolean;
  history: Analysis[];
  state: AnalysisState | null;
  last_error: {
    kind: 'refusal' | 'invalid_output' | 'max_tokens' | 'error';
    message: string;
    occurred_at: string;
    activity_id: number;
  } | null;
  /** Il prospect ha dati di profilo sufficienti (arricchito o About compilato). */
  analyzable: boolean;
}

// ---------------------------------------------------------------------------
// Job (T6) e preview uniforme (P7)
// ---------------------------------------------------------------------------

/**
 * Anteprima mostrata prima di ogni avvio: `blockers` non vuoti = il job non parte;
 * `est_cost_usd` `null` = stima non disponibile (mai inventata). `model` solo per `analyze`.
 */
export interface JobPreview {
  counts: Record<string, number>;
  est_cost_usd: number | null;
  warnings: string[];
  blockers: string[];
  model?: string;
}

/** Esito di un job riuscito. Il sync aggiunge `errors[]` per post (`{post_url, error}`). */
export interface JobResult {
  summary: string;
  counts: Record<string, number>;
  warnings?: string[];
  errors?: Array<{ post_url?: string; error: string; [key: string]: unknown }>;
}

export interface Job {
  id: number;
  kind: JobKind;
  params: Record<string, unknown>;
  state: JobState;
  pid: number | null;
  started_at: string | null;
  finished_at: string | null;
  result: JobResult | null;
  /** Prefissato per attribuzione: `actor:<id>: …`, `config: …`, `process: …`. */
  error: string | null;
  created_at: string;
}

/** Risposta 202 di ogni avvio (e del retry). */
export interface JobStarted {
  job: Job;
}

/** `__fixture` pilota le deps fake del server e2e (T20: `EMPTY`, `FAIL`); le deps reali lo ignorano. */
export interface E2EFixture {
  __fixture?: string;
}

export interface SyncOptions {
  /** "Risincronizza tutto": rilegge anche i post già sincronizzati. */
  force?: boolean;
  /** "Aggiorna solo l'elenco dei post": nessuna interazione letta. */
  postsOnly?: boolean;
}

export interface EnrichOptions {
  /** Default `true` lato server. */
  onlyMissing?: boolean;
  /** Riprova anche i tentati di recente senza esito. */
  retryFailed?: boolean;
}

/** Ambito di enrichment/analisi: selezione (`prospectIds`) oppure lista (`listId`). */
export type JobScope = { prospectIds: number[]; listId?: never } | { listId: number; prospectIds?: never };

export type EnrichPreviewParams = JobScope & EnrichOptions;

export interface AnalyzeOptions {
  onlyMissing?: boolean;
  force?: boolean;
}

/** Su lista l'ICP è quello della lista; sulla selezione `icpId` è obbligatorio. */
export type AnalyzePreviewParams = ({ prospectIds: number[]; icpId: number; listId?: never } | { listId: number; prospectIds?: never; icpId?: never }) &
  AnalyzeOptions;

// ---------------------------------------------------------------------------
// Sync e post (T8)
// ---------------------------------------------------------------------------

export type PostSyncState = 'synced' | 'to_sync' | 'archived' | 'error';

/** Riga di `GET /api/posts` (ordinati per `posted_at` desc). */
export interface Post {
  id: number;
  post_url: string;
  activity_id: string | null;
  text_excerpt: string | null;
  posted_at: string | null;
  reactions_count: number | null;
  comments_count: number | null;
  last_synced_at: string | null;
  reactions_read: number;
  comments_read: number;
  prospects_count: number;
  sync_state: PostSyncState;
  sync_error: string | null;
}

// ---------------------------------------------------------------------------
// Export CSV (T12) — forme lette dal codice di T12 in corso: ricontrollare a T12 chiuso
// ---------------------------------------------------------------------------

/** Filtri della tabella Lista che definiscono l'ambito "lista filtrata" (vuoto = tutta la lista). */
export interface ExportScopeFilters {
  q?: string;
  status?: ProspectStatus[];
  enriched?: boolean;
  source?: SourceKind[];
  fit?: FitFilter[];
}

/**
 * Body di `POST /api/lists/:id/exports` (e query della preview): `prospectIds` (selezione) esclude i
 * filtri dell'ambito (400 `selection_with_filters`); `hasEmail` vale per entrambi;
 * `markContacted` default false. 0 prospect → 400 `empty_export`.
 */
export interface ExportInput extends ExportScopeFilters {
  hasEmail?: boolean;
  prospectIds?: number[];
  markContacted?: boolean;
}

export interface ExportCounts {
  /** Prospect nell'ambito prima di "solo con email". */
  in_scope: number;
  /** Esclusi dal filtro email ("6 senza email esclusi"). */
  excluded_email: number;
  not_found: number;
  not_member: number;
}

/** `GET /api/lists/:id/exports/preview`: conteggio vivo del dialog, nessuna scrittura. */
export interface ExportPreview {
  count: number;
  counts: ExportCounts & { to_mark_contacted: number };
}

/** Export nello storico (`GET /api/lists/:id/exports` → `{items}`). */
export interface ExportRecord {
  id: number;
  list_id: number;
  scope: 'filters' | 'selection';
  filters: ExportScopeFilters & { hasEmail?: boolean };
  /** Id richiesti nella selezione; `null` per la lista filtrata. */
  selected: number | null;
  mark_contacted: boolean;
  count: number;
  created_at: string;
  /** `/api/exports/<id>.csv`. */
  download_url: string;
}

/** Risposta 201 di `POST /api/lists/:id/exports` (`{id, count, download_url}` + dettagli). */
export interface ExportCreated extends ExportRecord {
  counts: ExportCounts & { marked_contacted: number; status_unchanged: number };
}
