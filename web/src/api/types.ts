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

/** Tipi di fonte (specchio di `SOURCE_KINDS` in `src/db/schema.ts`); `apollo_people` = "Trova contatti" (apollo-lookalike). */
export const SOURCE_KINDS = ['post_reaction', 'post_comment', 'company_employees', 'manual', 'apollo_people'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  post_reaction: 'reazione',
  post_comment: 'commento',
  company_employees: 'dipendente',
  manual: 'manuale',
  apollo_people: 'Apollo',
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

export const JOB_KINDS = [
  'sync_interactions',
  'source_company',
  'enrich',
  'analyze',
  // apollo-lookalike (T5): etichette P-16 in `lib/jobs.ts`.
  'enrich_companies',
  'lookalike_companies',
  'apollo_people',
] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export const JOB_STATES = ['running', 'succeeded', 'failed'] as const;
export type JobState = (typeof JOB_STATES)[number];

export const EMPLOYEES_MODES = ['Short', 'Full', 'Full+email'] as const;
export type EmployeesMode = (typeof EMPLOYEES_MODES)[number];

// ---------------------------------------------------------------------------
// Errori
// ---------------------------------------------------------------------------

/**
 * Body di errore del server: `{error, code?, ...extra}`. Codici noti: `blocked` (400, `blockers`; anche
 * da "Riprova"), `job_running` (409, `job_id`), `job_not_failed` (409), `company_exists` (409,
 * `company_id`, `company_name`, `key`: vedi `CompanyExistsErrorBody`), `company_keys_missing` (400),
 * `merge_same_company`/`merge_target_missing` (400), `not_enriched`/`not_enrichable` (409),
 * `refusal`/`invalid_output`/`max_tokens`/`analysis_failed`/`enrich_failed` (502, `activity_id`),
 * `invalid_profile_url`/`invalid_company_url` (400), `icp_has_lists` (409, `lists_count`),
 * `activity_not_deletable` (409), `icp_required`, `invalid_scope`, `fit_requires_icp`,
 * `icp_not_found`, `list_not_found`, `config`, `selection_with_filters`, `empty_export` (400);
 * validazione zod → `issues[]` (`path` = campo o parametro, es. `pages`, `contactsPerCompany`).
 */
export interface ApiErrorBody {
  error: string;
  code?: string;
  blockers?: string[];
  job_id?: number;
  /** `company_exists`: azienda che possiede già la chiave. */
  company_id?: number;
  company_name?: string;
  key?: CompanyKeyName;
  lists_count?: number;
  activity_id?: number | null;
  issues?: Array<{ path: string; message: string }>;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Impostazioni (T4)
// ---------------------------------------------------------------------------

/**
 * Cosa è pronto: token (`apify`, `anthropic`, `apollo`), profilo salvato, descrizione azienda non vuota
 * (`company`), almeno un ICP (`icp`) e almeno un prospect (`prospects`).
 */
export interface Readiness {
  apify: boolean;
  anthropic: boolean;
  /** `APOLLO_API_KEY` presente (i permessi della chiave si verificano al primo job, non qui). */
  apollo: boolean;
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

/** `PUT /api/icps/:id/reference-companies/:companyId`: `candidate_removed` = era candidata di questo ICP ed è uscita (SPEC E4). */
export interface ReferenceSetResult extends ReferenceCompany {
  candidate_removed: boolean;
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

/**
 * Azienda (apollo-lookalike T4a/T4b): identità a doppia chiave `linkedin_url` | `domain`, almeno una.
 * Le risposte non includono `apollo_json` (resta sul server).
 */
export interface Company {
  id: number;
  /** `https://www.linkedin.com/company/<slug>`; `null` = "Senza pagina LinkedIn" (solo dominio). */
  linkedin_url: string | null;
  /** Dominio normalizzato derivato dal sito (`acme.it`); `null` se ignoto. Cambia quando cambia `website`. */
  domain: string | null;
  name: string | null;
  website: string | null;
  industry: string | null;
  size: string | null;
  location: string | null;
  notes: string | null;
  /** Id dell'organizzazione Apollo: valorizzato solo se l'arricchimento l'ha trovata. */
  apollo_org_id: string | null;
  /** Data dell'ultimo esito Apollo (trovata, non trovata o in conflitto); `null` = mai tentata. */
  apollo_enriched_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Chiave d'identità contesa da un 409 `company_exists`. */
export type CompanyKeyName = 'linkedin_url' | 'domain';

/**
 * 409 `company_exists` su `POST /api/companies` e `PATCH /api/companies/:id` (SPEC B4): nessuna scrittura;
 * `error` è già il testo inline ("Questo URL LinkedIn è già di 'Acme'." / "Il dominio acme.it è già di 'Acme'.").
 * `company_id` serve al link "apri" e a "Unisci in <company_name>" (SPEC B5). Lettura: `companyExistsOf(err)`.
 */
export interface CompanyExistsErrorBody extends ApiErrorBody {
  code: 'company_exists';
  company_id: number;
  company_name: string;
  key: CompanyKeyName;
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

/**
 * Body di `POST /api/companies` (almeno uno tra `linkedin_url` e `website`, altrimenti 400
 * `company_keys_missing`) e `PATCH /api/companies/:id` (`''`/`null` toglie la chiave, mai entrambe).
 */
export interface CompanyInput {
  linkedin_url?: string | null;
  name?: string | null;
  website?: string | null;
  industry?: string | null;
  size?: string | null;
  location?: string | null;
  notes?: string | null;
}

/** `GET /api/companies/:id/merge/preview?into=`: cosa comporta unire `:id` in `into` (SPEC B5). */
export interface CompanyMergePreview {
  /** Chiavi scartate dell'assorbita (la superstite ne ha già una diversa) e sue note accodate. */
  loses: { domain?: string; linkedin_url?: string; notes?: string };
  /** Righe che passano alla superstite (esclusi i doppioni che l'unione scarta). */
  absorbed: { references: number; candidates: number; prospects: number; sources: number };
}

/** `POST /api/companies/:id/merge {into}` → la superstite (`into`); `:id` non esiste più. */
export interface CompanyMergeResult {
  company: CompanyWithRefs;
}

/** `GET /api/companies/:id/contacts-at?listId=`: fonte `apollo_people` più recente ("contatti cercati il <data>"). */
export interface CompanyContactsAt {
  last_contacts_at: string | null;
}

/** `POST /api/companies/from-url`: 201 creata / 200 esistente. */
export interface CompanyFromUrlResult extends CompanyWithRefs {
  created: boolean;
}

export interface CompanyFromUrlInput {
  /** URL LinkedIn `…/company/<slug>` **o** sito/dominio (`acme.it`): trova-o-crea, mai 409. */
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
  /** Ultimo esito del match Apollo (SPEC G6): senza email = "email non disponibile" (FLOW D.3). */
  apollo_matched_at: string | null;
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
  /** Id persona Apollo (chiave secondaria, mai identità). */
  apollo_person_id: string | null;
  /** Ultimo esito del match Apollo (email trovata o non disponibile, SPEC G6); non tocca `enriched_at`. */
  apollo_matched_at: string | null;
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

/** Provider dell'arricchimento (SPEC G1): `apify` profilo completo (default), `apollo` solo email di lavoro. */
export const ENRICH_PROVIDERS = ['apify', 'apollo'] as const;
export type EnrichProvider = (typeof ENRICH_PROVIDERS)[number];

export interface EnrichOptions {
  /** Assente = `apify` (comportamento di crm-foundation). */
  provider?: EnrichProvider;
  /** Default `true` lato server; con `apollo` è ignorato (chi ha un'email non si cerca mai). */
  onlyMissing?: boolean;
  /** Riprova anche i tentati di recente senza esito (con `apollo`: su `apollo_matched_at`). */
  retryFailed?: boolean;
}

/** Preview `counts` con `provider=apify` (crm-foundation). */
export interface ApifyEnrichPreviewCounts {
  selected: number;
  targets: number;
  skipped_enriched: number;
  skipped_fresh: number;
  not_found: number;
}

/** Preview `counts` con `provider=apollo` (SPEC G2/G3): `est_credits` = `targets`; 0 target = blocker. */
export interface ApolloEnrichPreviewCounts {
  selected: number;
  targets: number;
  skipped_with_email: number;
  skipped_fresh: number;
  not_found: number;
  est_credits: number;
}

/** `GET /api/enrich/preview`: `counts` secondo il provider richiesto. */
export interface EnrichPreview extends JobPreview {
  counts: Record<string, number> & (Partial<ApifyEnrichPreviewCounts> | Partial<ApolloEnrichPreviewCounts>);
  /** Prezzo a persona per provider (`PRICE_PROFILE_DETAIL_USD`, `APOLLO_CREDIT_USD`); `null` = non configurato. */
  unit_prices: Record<EnrichProvider, number | null>;
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

// ---------------------------------------------------------------------------
// Apollo: arricchimento aziende, aziende simili (+ pipeline), candidate, contatti
// (apollo-lookalike T12a/T12, PLAN §12-bis; server: `src/jobs/types.ts`, route `src/server/routes/*`)
// ---------------------------------------------------------------------------

/** Fasce fisse di dipendenti di Apollo (specchio di `APOLLO_EMPLOYEE_RANGES` in `src/apollo/similarity.ts`). */
export const APOLLO_EMPLOYEE_RANGES = [
  '1-10',
  '11-20',
  '21-50',
  '51-100',
  '101-200',
  '201-500',
  '501-1000',
  '1001-2000',
  '2001-5000',
  '5001-10000',
  '10001+',
] as const;

/** Aziende per pagina della ricerca (S-7), default 25. */
export const LOOKALIKE_PER_PAGE = [25, 50, 100] as const;
export type LookalikePerPage = (typeof LOOKALIKE_PER_PAGE)[number];

/** Origine "ICP" nei filtri derivati (`filters.origins`); gli altri valori sono nomi di referenze. */
export const ICP_ORIGIN = 'ICP';

/** Stato di una candidata (specchio di `CANDIDATE_STATUSES` in `src/db/schema.ts`). */
export const CANDIDATE_STATUSES = ['proposta', 'accettata', 'scartata'] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

/** Label degli stati come badge ("proposta", singolare). */
export const CANDIDATE_STATUS_LABELS: Record<CandidateStatus, string> = {
  proposta: 'Proposta',
  accettata: 'Accettata',
  scartata: 'Scartata',
};

/** Label dei filtri di stato della sezione Candidate ("Proposte 61 · Accettate 18 · Scartate 5", FLOW B.1). */
export const CANDIDATE_STATUS_FILTER_LABELS: Record<CandidateStatus, string> = {
  proposta: 'Proposte',
  accettata: 'Accettate',
  scartata: 'Scartate',
};

/** Participio del cambio di stato, singolare e plurale ("accettata", "3 candidate riproposte"). */
export const CANDIDATE_STATUS_VERBS: Record<CandidateStatus, [string, string]> = {
  proposta: ['riproposta', 'riproposte'],
  accettata: ['accettata', 'accettate'],
  scartata: ['scartata', 'scartate'],
};

/** Azioni su una candidata per stato (FLOW B.2, tabella e card "Candidata per ICP"): mai quella dello stato corrente. */
export const CANDIDATE_ACTIONS: Record<CandidateStatus, Array<{ to: CandidateStatus; label: string }>> = {
  proposta: [
    { to: 'accettata', label: 'Accetta' },
    { to: 'scartata', label: 'Scarta' },
  ],
  accettata: [
    { to: 'scartata', label: 'Scarta' },
    { to: 'proposta', label: 'Riproponi' },
  ],
  scartata: [
    { to: 'accettata', label: 'Accetta' },
    { to: 'proposta', label: 'Riproponi' },
  ],
};

/** Fasce di lettura del punteggio (SPEC D14: basso < 0,34, medio 0,34–0,66, alto ≥ 0,67). */
export const SCORE_BUCKETS = ['basso', 'medio', 'alto'] as const;
export type ScoreBucket = (typeof SCORE_BUCKETS)[number];

/** Fascia di un punteggio 0–1 (specchio di `bucketOf` in `src/apollo/similarity.ts`). */
export function scoreBucketOf(score: number): ScoreBucket {
  if (score >= 0.67 - 1e-9) return 'alto';
  if (score >= 0.34 - 1e-9) return 'medio';
  return 'basso';
}

/** Seniority di Apollo (specchio di `APOLLO_SENIORITIES` in `src/apollo/requests.ts`): nessuna selezionata = tutte. */
export const APOLLO_SENIORITIES = ['owner', 'founder', 'c_suite', 'vp', 'head', 'director', 'manager', 'senior', 'entry'] as const;
export type ApolloSeniority = (typeof APOLLO_SENIORITIES)[number];
export const APOLLO_SENIORITY_LABELS: Record<ApolloSeniority, string> = {
  owner: 'Owner',
  founder: 'Founder',
  c_suite: 'C-suite',
  vp: 'VP',
  head: 'Head',
  director: 'Director',
  manager: 'Manager',
  senior: 'Senior',
  entry: 'Entry',
};

/** Tetto di persone per azienda accettato dal server (default `APOLLO_PEOPLE_PER_COMPANY`, 10). */
export const APOLLO_PEOPLE_PER_COMPANY_MAX = 100;

/** Stato Apollo di un'azienda nel dialog "Arricchisci le referenze con Apollo" (FLOW A.1b). */
export type EnrichCompanyState = 'da_arricchire' | 'arricchita' | 'non_trovata' | 'in_conflitto' | 'senza_sito';

export interface EnrichCompaniesPreviewItem {
  company_id: number;
  name: string | null;
  domain: string | null;
  state: EnrichCompanyState;
  /** Data dell'ultimo esito Apollo (trovata o no); `null` se mai tentata. */
  apollo_enriched_at: string | null;
  /** Nell'ambito del job (1 credito se Apollo la trova). */
  to_enrich: boolean;
  /** Testo pronto del server: "da arricchire", "arricchita il 10 set", "senza sito (ignorata)"… */
  label: string;
}

/** `GET /api/icps/:id/enrich-companies/preview`. */
export interface EnrichCompaniesPreview extends JobPreview {
  counts: Record<string, number> & {
    references: number;
    with_domain: number;
    to_enrich: number;
    skipped_fresh: number;
    enriched: number;
    /** = `to_enrich` (tetto: 1 credito per organizzazione trovata). */
    est_credits: number;
  };
  items: EnrichCompaniesPreviewItem[];
}

export interface EnrichCompaniesOptions {
  /** "Ritenta anche le non trovate (o in conflitto) di recente". */
  retryNotFound?: boolean;
}

/**
 * Ambito della preview di arricchimento aziende: referenze dell'ICP (`/api/icps/:id/enrich-companies/preview`)
 * oppure singola azienda dal dettaglio (`/api/companies/:id/enrich-apollo/preview`, SPEC C4). Stessa forma di risposta.
 */
export type EnrichCompaniesPreviewParams = (
  | { icpId: number; companyId?: never }
  | { companyId: number; icpId?: never }
) &
  EnrichCompaniesOptions;

/** Filtri della ricerca aziende simili (insiemi di valori, vuoto = nessun filtro su quel campo). */
export interface LookalikeFilterValues {
  keywords: string[];
  ranges: string[];
  locations: string[];
}

export interface LookalikeFilters extends LookalikeFilterValues {
  /** Per valore effettivo: nomi delle referenze e/o `ICP`; `[]` = aggiunto a mano. */
  origins: Record<keyof LookalikeFilterValues, Record<string, string[]>>;
  /** Note della derivazione (es. dimensione dell'ICP non riconoscibile). */
  notes: string[];
  /** `true` = filtri passati dall'utente (`custom=1`), `false` = derivati. */
  custom: boolean;
  /** Filtri derivati da referenze arricchite + ICP ("Ripristina i filtri derivati"). */
  derived: LookalikeFilterValues;
}

/** Ripartenza dall'ultima ricerca riuscita con gli stessi filtri e la stessa dimensione di pagina (SPEC D6). */
export interface LookalikeResume {
  run_id: number;
  last_run_at: string;
  per_page: LookalikePerPage;
  last_page: number;
  last_page_declared: number;
  /** `null` = ricerca esaurita. */
  next_page: number | null;
  exhausted: boolean;
  restart: boolean;
}

export type LookalikeReferenceStatus = 'enriched' | 'to_enrich' | 'not_found' | 'key_conflict' | 'no_domain';

export interface LookalikeReference {
  company_id: number;
  name: string | null;
  domain: string | null;
  linkedin_url: string | null;
  status: LookalikeReferenceStatus;
  /** Data dell'arricchimento riuscito. */
  enriched_at: string | null;
  /** Data dell'ultimo esito Apollo, anche negativo. */
  attempted_at: string | null;
}

/**
 * `counts` della preview ricerca. Con la pipeline (`contacts` nell'input) `est_credits`/`requests` (e
 * `est_cost_usd`) sono i **totali** ricerca + contatti e compaiono le chiavi `search_*`/`contacts_*`.
 */
export interface LookalikePreviewCounts {
  pages: number;
  per_page: number;
  start_page: number;
  est_credits: number;
  requests: number;
  /** Pipeline: pagine + pagine × dimensione (ricerca + arricchimento delle nuove). */
  search_est_credits?: number;
  search_requests?: number;
  /** Pipeline: fino a pagine × dimensione aziende in cui cercare. */
  contacts_companies?: number;
  contacts_per_company?: number;
  /** Pipeline: fino a aziende × tetto persone (1 credito a persona rivelata). */
  contacts_est_credits?: number;
  /** Pipeline: una ricerca per azienda + i match a lotti da 10. */
  contacts_requests?: number;
}

/** Opzioni del passo contatti risolte dal server per il dialog (pipeline attiva). */
export interface LookalikeContactsPlan {
  /** `null` = lista non scelta (c'è il blocker). */
  list_id: number | null;
  roles: string[];
  seniorities: ApolloSeniority[];
  locations: string[];
  per_company: number;
}

/** `GET /api/icps/:id/lookalike/preview`. */
export interface LookalikePreview extends JobPreview {
  counts: Record<string, number> & LookalikePreviewCounts;
  filters: LookalikeFilters;
  resume: LookalikeResume | null;
  references: LookalikeReference[];
  /** `null` = pipeline spenta. */
  contacts: LookalikeContactsPlan | null;
}

/**
 * Opzioni del passo contatti in ingresso (preview di "Trova contatti", pipeline): **chiave assente = default
 * dell'ICP** (ruoli/località) o della config (tetto); `roles: []` = nessun ruolo (warning "prime N persone
 * qualunque"), `locations: []` = ovunque, `seniorities` assenti o `[]` = nessun filtro.
 */
export interface ContactsOptionsInput {
  listId?: number;
  roles?: string[];
  seniorities?: ApolloSeniority[];
  locations?: string[];
  /** 1–100 (`APOLLO_PEOPLE_PER_COMPANY_MAX`); fuori range → 400 `issues`. */
  perCompany?: number;
}

/**
 * Input della preview: `filters` `null`/assente = derivati; valorizzato = `custom=1` con i valori ripetuti.
 * `contacts` valorizzato = pipeline attiva (`contacts=1&contactsListId=…`), `null`/assente = spenta.
 */
export interface LookalikePreviewInput {
  pages?: number;
  perPage?: LookalikePerPage;
  restart?: boolean;
  filters?: LookalikeFilterValues | null;
  contacts?: ContactsOptionsInput | null;
}

export interface LookalikePreviewParams extends LookalikePreviewInput {
  icpId: number;
}

/** Pipeline nel body dell'avvio: le opzioni di "Trova contatti" con la lista obbligatoria (SPEC H1). */
export interface LookalikeAutoContactsInput extends ContactsOptionsInput {
  listId: number;
}

/**
 * Body di `POST /api/icps/:id/lookalike` (filtri sempre quelli confermati nel dialog). → 202 · 400 `blocked`
 * (chiave, filtri vuoti, lista della pipeline) · 404 · 409 `job_running`.
 */
export interface LookalikeStartInput extends LookalikeFilterValues {
  pages: number;
  perPage?: LookalikePerPage;
  restart?: boolean;
  /** Pipeline opt-in (SPEC H): `null`/assente = solo ricerca aziende. */
  autoContacts?: LookalikeAutoContactsInput | null;
}

/** Statistiche di una ricerca dalle candidate che ha proposto (SPEC D14). */
export interface LookalikeRunStats {
  proposed: number;
  without_location: number;
  buckets: Record<ScoreBucket, Record<CandidateStatus, number>>;
}

/** Riga di `GET /api/icps/:id/lookalike/runs` (ultime 5 riuscite, dalla più recente). */
export interface LookalikeRun {
  id: number;
  at: string;
  state: JobState;
  pages: number;
  per_page: LookalikePerPage;
  start_page: number;
  filters: LookalikeFilterValues;
  /** `result.counts` del job (`LookalikeJobCounts`): `read`, `new_candidates`, `pages_read`, `credits_used`… */
  counts: Record<string, number> & Partial<LookalikeJobCounts>;
  warnings: string[];
  stats: LookalikeRunStats;
}

// --- Candidate (T11) --------------------------------------------------------

/** Componenti del punteggio 0–1; `location: null` = sede non disponibile, componente esclusa e pesi rinormalizzati. */
export interface CandidateScoreParts {
  keywords: number;
  size: number;
  location: number | null;
}

/** Riga di `GET /api/icps/:id/candidates` (e risposta del `PATCH`): candidata + campi dell'azienda. */
export interface Candidate {
  icp_id: number;
  company_id: number;
  name: string | null;
  domain: string | null;
  /** `null` = "Senza pagina LinkedIn". */
  linkedin_url: string | null;
  website: string | null;
  industry: string | null;
  size: string | null;
  location: string | null;
  /** Dall'ultima risposta Apollo salvata sull'azienda. */
  apollo_city: string | null;
  apollo_state: string | null;
  apollo_country: string | null;
  apollo_employees: number | null;
  /** 0–1 a 2 decimali; in UI "82 %" (P-8). Fascia: `scoreBucketOf`. */
  score: number;
  score_parts: CandidateScoreParts;
  scoring_version: string;
  /** "Perché simile", in italiano. */
  reasons: string[];
  status: CandidateStatus;
  /** Ricerca che l'ha proposta per prima (`null` fuori da un job). */
  job_id: number | null;
  created_at: string;
  /** Ultimo cambio di stato (anche "Riproponi"); `null` = mai decisa. */
  decided_at: string | null;
  /** Fonte `apollo_people` più recente dell'azienda: badge "già cercata il <data>" (SPEC E5). */
  last_contacts_at: string | null;
}

/** Ultima ricerca riuscita (anche parziale) dell'ICP. */
export interface CandidatesLastRun {
  at: string;
  read: number;
  new_candidates: number;
}

/**
 * `GET /api/icps/:id/candidates?status=`: righe dello stato (tutte senza `status`), al massimo 500, ordinate per
 * punteggio desc poi nome; `total` = candidate nello stato **senza** il tetto (paginazione lato client, P-17).
 */
export interface CandidatesResponse {
  items: Candidate[];
  total: number;
  counts: Record<CandidateStatus, number>;
  last_run: CandidatesLastRun | null;
}

/** Body di `POST /api/icps/:id/candidates/bulk` (1–500 id). */
export interface CandidateBulkInput {
  company_ids: number[];
  status: CandidateStatus;
}

/** Esito per item del bulk (SPEC E3): gli id che non sono candidate dell'ICP finiscono in `failed`. */
export interface CandidateBulkResult {
  updated: number;
  failed: Array<{ company_id: number; error: string }>;
}

/** Riga di `GET /api/companies/:id/candidate-of` (card "Candidata per ICP", SPEC E5). */
export interface CandidateOf {
  icp_id: number;
  icp_name: string;
  status: CandidateStatus;
  score: number;
  decided_at: string | null;
}

// --- Contatti (T8, S-6) -----------------------------------------------------

/** Preview di "Trova contatti": ICP della lista (dal dettaglio azienda, SPEC F12) + aziende scelte. */
export interface ContactsPreviewParams extends ContactsOptionsInput {
  icpId: number;
  companyIds: number[];
}

export interface ContactsPreviewCounts {
  companies: number;
  with_domain: number;
  without_domain: number;
  per_company: number;
  /** Aziende con dominio + ⌈aziende × tetto / 10⌉ (tetto). */
  requests: number;
  /** Aziende con dominio × tetto (tetto: 1 credito a persona rivelata). */
  est_credits: number;
}

/** `GET /api/icps/:id/contacts/preview`. */
export interface ContactsPreview extends JobPreview {
  counts: Record<string, number> & ContactsPreviewCounts;
}

/**
 * Body di `POST /api/icps/:id/contacts` → 202 · 400 `blocked` · 404 · 409 `job_running`. Campi assenti = stessi
 * default della preview (`ContactsOptionsInput`).
 */
export interface ContactsBody extends ContactsOptionsInput {
  companyIds: number[];
  listId: number;
}

// --- Params e conteggi dei job Apollo (specchio di `src/jobs/types.ts`) ------

/** Opzioni del passo contatti congelate nei `params` (valori risolti dalla route). */
export interface ContactsJobOptions {
  listId: number;
  roles: string[];
  seniorities: ApolloSeniority[];
  locations: string[];
  perCompany: number;
}

/** `params` di `apollo_people`. */
export interface ApolloPeopleJobParams extends ContactsJobOptions {
  icpId: number;
  companyIds: number[];
}

/** `result.counts` del passo aziende di `lookalike_companies`. */
export interface LookalikeJobCounts {
  read: number;
  new_candidates: number;
  known: number;
  without_linkedin: number;
  without_location: number;
  merged: number;
  references_completed: number;
  key_conflicts: number;
  no_keys: number;
  enriched: number;
  pages_read: number;
  last_page: number;
  last_page_declared: number;
  credits_used: number;
  requests: number;
}
