import { truncate } from '../util/fields.js';
import { timeline, type Activity } from './activities.js';
import { applyIdentity, identityKeys, resolveProspect } from './identity.js';
import { db, nowIso } from './index.js';
import type { FitLevel, ProspectStatus, SourceKind } from './schema.js';

/*
 * Repo dei prospect (PLAN crm-foundation §6, P1/P4). Identità = `linkedin_url` normalizzato, con
 * `member_urn` (id membro `ACoAA…`) come seconda chiave: regole in `db/identity.ts`.
 * Derivati mai salvati: "Inbox" = senza `list_members` e `status <> 'scartato'`;
 * "arricchito" = `enriched_at IS NOT NULL`; "con email" = email non vuota dopo trim.
 */

// ---------------------------------------------------------------------------
// Scrittura: upsert, fonti, anagrafica
// ---------------------------------------------------------------------------

export interface ProspectInput {
  /** Qualunque forma di URL `/in/…` (slug o id membro): viene normalizzato (identità). */
  linkedinUrl: string;
  /** Id membro `ACoAA…` (nudo, URN o URL) quando la fonte lo espone: seconda chiave d'identità. */
  memberUrn?: string | null;
  fullName?: string | null;
  headline?: string | null;
  about?: string | null;
  location?: string | null;
  email?: string | null;
  phone?: string | null;
  companyId?: number | null;
  companyName?: string | null;
  title?: string | null;
  /** Item grezzo del provider, salvato come JSON in `raw_json`. */
  raw?: unknown;
  enrichedAt?: string | null;
  enrichmentAttemptedAt?: string | null;
  /**
   * Id persona Apollo (apollo-lookalike SPEC F6): chiave **secondaria**, mai usata per risolvere
   * l'identità. Scritto solo se il prospect non ne ha già uno e nessun altro prospect lo possiede;
   * se è di un altro prospect il risultato ha `apolloIdTaken: true`.
   */
  apolloPersonId?: string | null;
}

/** Colonne scrivibili da `upsertProspect`, nell'ordine dei parametri. */
const UPSERT_COLUMNS = [
  'full_name',
  'headline',
  'about',
  'location',
  'email',
  'phone',
  'company_id',
  'company_name',
  'title',
  'raw_json',
  'enriched_at',
  'enrichment_attempted_at',
] as const;

/** Stringhe vuote o di soli spazi valgono "assente" (non devono coprire un valore esistente). */
function clean<T>(value: T | null | undefined): T | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return (value.trim() === '' ? null : value.trim()) as T;
  return value;
}

function upsertValues(input: ProspectInput): unknown[] {
  return [
    clean(input.fullName),
    clean(input.headline),
    clean(input.about),
    clean(input.location),
    clean(input.email),
    clean(input.phone),
    clean(input.companyId),
    clean(input.companyName),
    clean(input.title),
    input.raw === undefined || input.raw === null ? null : JSON.stringify(input.raw),
    clean(input.enrichedAt),
    clean(input.enrichmentAttemptedAt),
  ];
}

export interface UpsertProspectOptions {
  /** I valori nuovi non vuoti vincono su quelli salvati (dati più ricchi: sourcing Full, enrichment). */
  refresh?: boolean;
  /**
   * Senza corrispondenza per URL o id membro, aggancia l'unico prospect nella forma opposta con
   * stesso nome e headline (reazione solo-id ↔ commento solo-slug). Per il sync delle interazioni.
   */
  linkByName?: boolean;
}

export interface UpsertProspectResult {
  id: number;
  created: boolean;
  /** Prospect duplicati uniti in `id` perché le chiavi dell'input li hanno rivelati (di solito vuoto). */
  mergedIds: number[];
  /** `apolloPersonId` dell'input già di un **altro** prospect: non scritto (conteggio `apollo_id_taken`). */
  apolloIdTaken: boolean;
}

/**
 * Crea o aggiorna il prospect che corrisponde all'input per `linkedin_url` o `member_urn`
 * (`db/identity.ts`: lo slug sostituisce la forma id membro, i duplicati rivelati si uniscono);
 * `created` distingue nuovo da già visto (T8 `prospects_new`/`prospects_seen`). Mai un valore
 * non nullo sovrascritto con null/vuoto. Default **backfill**: sul già esistente riempie solo i
 * campi vuoti (i dati modificati a mano restano); `{refresh: true}` fa vincere i valori nuovi.
 * Lancia se l'URL non è un URL LinkedIn.
 */
export function upsertProspect(input: ProspectInput, opts: UpsertProspectOptions = {}): UpsertProspectResult {
  const keys = identityKeys(input.linkedinUrl, input.memberUrn);
  if (!keys) throw new Error(`URL LinkedIn non valido: ${String(input.linkedinUrl)}`);
  const values = upsertValues(input);
  const apolloPersonId = clean(input.apolloPersonId);
  return db.transaction((): UpsertProspectResult => {
    const person = opts.linkByName ? { fullName: clean(input.fullName), headline: clean(input.headline) } : undefined;
    const { id: existing, mergedIds } = resolveProspect(keys, person);
    const now = nowIso();
    let id: number;
    if (existing === undefined) {
      const info = db
        .prepare(
          `INSERT INTO prospects (linkedin_url, member_urn, ${UPSERT_COLUMNS.join(', ')}, created_at, updated_at)
           VALUES (?, ?, ${UPSERT_COLUMNS.map(() => '?').join(', ')}, ?, ?)`,
        )
        .run(keys.url, keys.memberUrn ?? null, ...values, now, now);
      id = Number(info.lastInsertRowid);
    } else {
      const assign = UPSERT_COLUMNS.map((col) => (opts.refresh ? `${col} = COALESCE(?, ${col})` : `${col} = COALESCE(${col}, ?)`));
      db.prepare(`UPDATE prospects SET ${assign.join(', ')}, updated_at = ? WHERE id = ?`).run(...values, now, existing);
      applyIdentity(existing, keys);
      id = existing;
    }
    const apolloIdTaken = apolloPersonId !== null && !assignApolloPersonId(id, apolloPersonId);
    return { id, created: existing === undefined, mergedIds, apolloIdTaken };
  })();
}

/**
 * Scrive l'id persona Apollo sul prospect se è libero (SPEC F6): `false` solo se lo possiede un
 * **altro** prospect. Un id Apollo già presente sul prospect non si sovrascrive mai (nemmeno con
 * `refresh`): è una chiave, non un dato descrittivo.
 */
export function assignApolloPersonId(prospectId: number, apolloPersonId: string): boolean {
  const owner = db.prepare('SELECT id FROM prospects WHERE apollo_person_id = ?').pluck().get(apolloPersonId) as number | undefined;
  if (owner !== undefined) return owner === prospectId;
  db.prepare('UPDATE prospects SET apollo_person_id = ? WHERE id = ? AND apollo_person_id IS NULL').run(apolloPersonId, prospectId);
  return true;
}

export interface SourceInput {
  kind: SourceKind;
  /** Obbligatorio per `post_reaction`/`post_comment` (CHECK dello schema). */
  postId?: number | null;
  /**
   * Obbligatorio per le fonti da azienda (`company_employees`, `apollo_people`: `COMPANY_SOURCE_KINDS`,
   * CHECK dello schema; unicità `(prospect, kind, azienda)`). Mai insieme a `postId`.
   */
  companyId?: number | null;
  reactionType?: string | null;
  commentText?: string | null;
  raw?: unknown;
}

/**
 * Aggiunge una provenienza al prospect in modo idempotente (P4): la stessa
 * `(prospect, kind, post|company)` — o `(prospect, 'manual')` — non si duplica; al re-sync
 * aggiorna reazione/commento/raw (COALESCE) e conserva `captured_at` della prima cattura, salvo
 * `{refreshCapturedAt: true}`: allora `captured_at` diventa la data di quest'ultima cattura (fonti
 * `apollo_people`: "già cercata il <data>" = ricerca più recente, apollo-lookalike SPEC E5).
 * I conflict target ripetono la clausola `WHERE` degli indici unici parziali.
 */
export function addSource(
  prospectId: number,
  source: SourceInput,
  opts: { refreshCapturedAt?: boolean } = {},
): { id: number; created: boolean } {
  const postId = source.postId ?? null;
  const companyId = source.companyId ?? null;
  if (postId !== null && companyId !== null) throw new Error('Una fonte ha un post oppure un\'azienda, non entrambi.');

  let match: string;
  let conflict: string;
  let key: number | null = null;
  if (postId !== null) {
    match = 'post_id = ?';
    conflict = 'ON CONFLICT(prospect_id, kind, post_id) WHERE post_id IS NOT NULL';
    key = postId;
  } else if (companyId !== null) {
    match = 'company_id = ?';
    conflict = 'ON CONFLICT(prospect_id, kind, company_id) WHERE company_id IS NOT NULL';
    key = companyId;
  } else {
    match = 'post_id IS NULL AND company_id IS NULL';
    conflict = 'ON CONFLICT(prospect_id, kind) WHERE post_id IS NULL AND company_id IS NULL';
  }
  const matchParams = key === null ? [] : [key];

  return db.transaction(() => {
    const existing = db
      .prepare(`SELECT id FROM sources WHERE prospect_id = ? AND kind = ? AND ${match}`)
      .pluck()
      .get(prospectId, source.kind, ...matchParams) as number | undefined;
    const id = db
      .prepare(
        `INSERT INTO sources (prospect_id, kind, post_id, company_id, reaction_type, comment_text, raw_json, captured_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ${conflict} DO UPDATE SET
           reaction_type = COALESCE(excluded.reaction_type, reaction_type),
           comment_text  = COALESCE(excluded.comment_text, comment_text),
           raw_json      = COALESCE(excluded.raw_json, raw_json)${opts.refreshCapturedAt ? ',\n           captured_at   = excluded.captured_at' : ''}
         RETURNING id`,
      )
      .pluck()
      .get(
        prospectId,
        source.kind,
        postId,
        companyId,
        clean(source.reactionType),
        clean(source.commentText),
        source.raw === undefined || source.raw === null ? null : JSON.stringify(source.raw),
        nowIso(),
      ) as number;
    return { id, created: existing === undefined };
  })();
}

/** Campi anagrafici modificabili a mano (`PATCH /api/prospects/:id`). */
export const EDITABLE_PROSPECT_FIELDS = [
  'full_name',
  'headline',
  'email',
  'phone',
  'title',
  'company_name',
  'location',
  'about',
] as const;
export type ProspectPatch = Partial<Record<(typeof EDITABLE_PROSPECT_FIELDS)[number], string | null>>;

/**
 * Modifica manuale dell'anagrafica: qui un valore vuoto **azzera** il campo (è una scelta
 * dell'utente, a differenza degli upsert). `false` se il prospect non esiste.
 */
export function updateProspect(id: number, patch: ProspectPatch): boolean {
  if (!prospectExists(id)) return false;
  const entries = EDITABLE_PROSPECT_FIELDS.filter((f) => patch[f] !== undefined).map((f) => [f, clean(patch[f])] as const);
  if (entries.length === 0) return true;
  db.prepare(`UPDATE prospects SET ${entries.map(([f]) => `${f} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(
    ...entries.map(([, v]) => v),
    nowIso(),
    id,
  );
  return true;
}

/** True se il prospect esiste. */
export function prospectExists(id: number): boolean {
  return db.prepare('SELECT 1 FROM prospects WHERE id = ?').get(id) !== undefined;
}

// ---------------------------------------------------------------------------
// Lettura: forme condivise
// ---------------------------------------------------------------------------

/** Colonne di `prospects` restituite nelle righe di tabella (senza `about` e `raw_json`). */
const ROW_COLUMNS = [
  'id',
  'linkedin_url',
  'full_name',
  'headline',
  'location',
  'email',
  'phone',
  'company_id',
  'company_name',
  'title',
  'enriched_at',
  'enrichment_attempted_at',
  'status',
  'status_changed_at',
  'created_at',
  'updated_at',
] as const;

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

/** Fonte con post/azienda risolti (nelle righe di tabella i testi sono troncati). */
export interface SourceView {
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

/** Analisi grezza (T11 calcola `stale` confrontando `input_hash`). */
export interface AnalysisView {
  id: number;
  prospect_id: number;
  icp_id: number;
  icp_name: string;
  model: string;
  summary: string;
  angles: Array<{ title: string; rationale: string }>;
  fit: FitLevel;
  fit_reason: string | null;
  input_hash: string;
  created_at: string;
}

/**
 * Stato dell'analisi mostrato nella colonna Fit (FLOW E.4), per l'ICP della riga: il fit
 * dell'ultima analisi, `rifiutata`/`errore` se l'ultimo tentativo fallito è più recente
 * dell'ultima analisi salvata, `non_arricchibile` se l'arricchimento non ha trovato dati,
 * `null` = non analizzato.
 */
export type AnalysisState = FitLevel | 'rifiutata' | 'errore' | 'non_arricchibile';

/** Riga di tabella (Inbox, Lista, prospect collegati a un'azienda). */
export interface ProspectRow extends ProspectBase {
  /** Ultimo esito del match Apollo (SPEC G6): senza email = "email non disponibile" in tabella (FLOW D.3). */
  apollo_matched_at: string | null;
  has_email: boolean;
  sources_count: number;
  source_kinds: SourceKind[];
  source_counts: Partial<Record<SourceKind, number>>;
  sources: SourceView[];
  last_captured_at: string | null;
  last_touchpoint_at: string | null;
  latest_analysis: Omit<AnalysisView, 'angles' | 'model' | 'prospect_id'> | null;
  /** Stato della colonna Fit per lo stesso ICP di `latest_analysis` (T11). */
  analysis_state: AnalysisState | null;
  /** Messaggio dell'ultimo tentativo fallito quando `analysis_state` è `rifiutata`/`errore` (tooltip). */
  analysis_error: string | null;
  memberships: Membership[];
}

/** Dettaglio (`GET /api/prospects/:id`). */
export interface ProspectDetail extends ProspectBase {
  /** Id membro `ACoAA…` (seconda chiave d'identità), se noto. */
  member_urn: string | null;
  /** Id persona Apollo (chiave secondaria, mai identità), se noto. */
  apollo_person_id: string | null;
  /** Ultimo esito del match Apollo (email trovata o non disponibile, SPEC G6). */
  apollo_matched_at: string | null;
  about: string | null;
  raw: unknown;
  has_email: boolean;
  sources: SourceView[];
  memberships: Membership[];
  /** La più recente fra tutti gli ICP (o `null`). */
  latest_analysis: AnalysisView | null;
  /** L'ultima analisi per ciascun ICP, dalla più recente. */
  latest_analyses: AnalysisView[];
  last_touchpoint_at: string | null;
  timeline: Activity[];
}

function emailPresent(email: string | null): boolean {
  return typeof email === 'string' && email.trim() !== '';
}

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ');

type SourceRecord = SourceView & { prospect_id: number };

function loadSources(ids: number[]): SourceRecord[] {
  if (ids.length === 0) return [];
  return db
    .prepare(
      `SELECT s.prospect_id, s.id, s.kind, s.post_id, po.post_url, po.text_excerpt AS post_excerpt,
              s.company_id, c.name AS company_name, s.reaction_type, s.comment_text, s.captured_at
       FROM sources s
       LEFT JOIN posts po ON po.id = s.post_id
       LEFT JOIN companies c ON c.id = s.company_id
       WHERE s.prospect_id IN (${placeholders(ids.length)})
       ORDER BY s.captured_at DESC, s.id DESC`,
    )
    .all(...ids) as SourceRecord[];
}

function loadMemberships(ids: number[]): Array<Membership & { prospect_id: number }> {
  if (ids.length === 0) return [];
  return db
    .prepare(
      `SELECT lm.prospect_id, l.id AS list_id, l.name AS list_name, l.icp_id, i.name AS icp_name,
              lm.added_at, l.archived_at
       FROM list_members lm
       JOIN lists l ON l.id = lm.list_id
       JOIN icps i ON i.id = l.icp_id
       WHERE lm.prospect_id IN (${placeholders(ids.length)})
       ORDER BY lm.added_at, l.id`,
    )
    .all(...ids) as Array<Membership & { prospect_id: number }>;
}

function loadLastTouchpoints(ids: number[]): Map<number, string> {
  if (ids.length === 0) return new Map();
  const rows = db
    .prepare(
      `SELECT prospect_id, MAX(occurred_at) AS at FROM activities
       WHERE kind = 'touchpoint' AND prospect_id IN (${placeholders(ids.length)})
       GROUP BY prospect_id`,
    )
    .all(...ids) as Array<{ prospect_id: number; at: string }>;
  return new Map(rows.map((r) => [r.prospect_id, r.at]));
}

type AnalysisRecord = Omit<AnalysisView, 'angles'> & { angles: string };

/**
 * Ultima analisi per prospect: dell'`icpId` indicato, oppure (senza) la più recente di
 * qualunque ICP. Con `perIcp` ritorna l'ultima per ciascuna coppia (prospect, ICP).
 */
function loadLatestAnalyses(ids: number[], opts: { icpId?: number; perIcp?: boolean }): AnalysisView[] {
  if (ids.length === 0) return [];
  const partition = opts.perIcp ? 'a.prospect_id, a.icp_id' : 'a.prospect_id';
  const icpFilter = opts.icpId !== undefined ? 'AND a.icp_id = ?' : '';
  const params: unknown[] = [...ids];
  if (opts.icpId !== undefined) params.push(opts.icpId);
  const rows = db
    .prepare(
      `SELECT id, prospect_id, icp_id, icp_name, model, summary, angles, fit, fit_reason, input_hash, created_at
       FROM (
         SELECT a.*, i.name AS icp_name,
                ROW_NUMBER() OVER (PARTITION BY ${partition} ORDER BY a.created_at DESC, a.id DESC) AS rn
         FROM analyses a JOIN icps i ON i.id = a.icp_id
         WHERE a.prospect_id IN (${placeholders(ids.length)}) ${icpFilter}
       )
       WHERE rn = 1
       ORDER BY created_at DESC, id DESC`,
    )
    .all(...params) as AnalysisRecord[];
  return rows.map((r) => ({ ...r, angles: JSON.parse(r.angles) as AnalysisView['angles'] }));
}

/**
 * Espressione SQL dello stato analisi (`AnalysisState`, `'none'` se non analizzato) su `pp` =
 * prospects, entro l'ICP dato (senza: qualsiasi ICP). Una sola definizione per il valore della
 * riga e per il filtro `fit`, così la tabella mostra esattamente ciò che il filtro seleziona.
 * I fallimenti sono attività `analysis` con `meta.error` (T11: `meta.icp_id`, `meta.error_kind`).
 */
function analysisStateSql(icpId: number | undefined): { from: string; state: string; params: unknown[] } {
  const icpAnalysis = icpId !== undefined ? 'WHERE icp_id = ?' : '';
  const icpFailure = icpId !== undefined ? `AND json_extract(meta, '$.icp_id') = ?` : '';
  const from = `prospects pp
    LEFT JOIN (
      SELECT prospect_id, fit, created_at,
             ROW_NUMBER() OVER (PARTITION BY prospect_id ORDER BY created_at DESC, id DESC) AS rn
      FROM analyses ${icpAnalysis}
    ) an ON an.prospect_id = pp.id AND an.rn = 1
    LEFT JOIN (
      SELECT prospect_id, created_at, body, json_extract(meta, '$.error') AS error,
             json_extract(meta, '$.error_kind') AS error_kind,
             ROW_NUMBER() OVER (PARTITION BY prospect_id ORDER BY created_at DESC, id DESC) AS rn
      FROM activities
      WHERE kind = 'analysis' AND json_extract(meta, '$.error') IS NOT NULL ${icpFailure}
    ) fa ON fa.prospect_id = pp.id AND fa.rn = 1`;
  const state = `CASE
      WHEN fa.created_at IS NOT NULL AND (an.created_at IS NULL OR fa.created_at > an.created_at)
        THEN CASE WHEN fa.error_kind = 'refusal' THEN 'rifiutata' ELSE 'errore' END
      WHEN an.fit IS NOT NULL THEN an.fit
      WHEN pp.enrichment_attempted_at IS NOT NULL AND pp.enriched_at IS NULL THEN 'non_arricchibile'
      ELSE 'none'
    END`;
  return { from, state, params: icpId !== undefined ? [icpId, icpId] : [] };
}

/**
 * Stato analisi per prospect entro l'ICP (senza ICP: di qualsiasi ICP), con il messaggio
 * dell'ultimo fallimento quando lo stato è `rifiutata`/`errore`.
 */
export function analysisStates(
  ids: number[],
  icpId: number | undefined,
): Map<number, { state: AnalysisState | null; error: string | null }> {
  if (ids.length === 0) return new Map();
  const sql = analysisStateSql(icpId);
  const rows = db
    .prepare(`SELECT pp.id, ${sql.state} AS state, fa.error FROM ${sql.from} WHERE pp.id IN (${placeholders(ids.length)})`)
    .all(...sql.params, ...ids) as Array<{ id: number; state: AnalysisState | 'none'; error: string | null }>;
  return new Map(
    rows.map((r) => {
      const failed = r.state === 'rifiutata' || r.state === 'errore';
      return [r.id, { state: r.state === 'none' ? null : r.state, error: failed ? r.error : null }];
    }),
  );
}

function groupBy<T extends { prospect_id: number }>(rows: T[]): Map<number, Array<Omit<T, 'prospect_id'>>> {
  const map = new Map<number, Array<Omit<T, 'prospect_id'>>>();
  for (const { prospect_id, ...rest } of rows) {
    const list = map.get(prospect_id) ?? [];
    list.push(rest);
    map.set(prospect_id, list);
  }
  return map;
}

/** Righe di tabella per gli id dati, nello stesso ordine. */
function hydrateRows(ids: number[], analysisIcpId: number | undefined): ProspectRow[] {
  if (ids.length === 0) return [];
  const bases = db
    .prepare(`SELECT ${ROW_COLUMNS.join(', ')}, apollo_matched_at FROM prospects WHERE id IN (${placeholders(ids.length)})`)
    .all(...ids) as Array<ProspectBase & { apollo_matched_at: string | null }>;
  const byId = new Map(bases.map((b) => [b.id, b]));
  const sources = groupBy(loadSources(ids));
  const memberships = groupBy(loadMemberships(ids));
  const touchpoints = loadLastTouchpoints(ids);
  const analyses = new Map(loadLatestAnalyses(ids, { icpId: analysisIcpId }).map((a) => [a.prospect_id, a]));
  const states = analysisStates(ids, analysisIcpId);

  return ids.flatMap((id) => {
    const base = byId.get(id);
    if (!base) return [];
    const own = (sources.get(id) ?? []) as SourceView[];
    const counts: Partial<Record<SourceKind, number>> = {};
    for (const s of own) counts[s.kind] = (counts[s.kind] ?? 0) + 1;
    const analysis = analyses.get(id);
    return [
      {
        ...base,
        has_email: emailPresent(base.email),
        sources_count: own.length,
        source_kinds: Object.keys(counts) as SourceKind[],
        source_counts: counts,
        sources: own.map((s) => ({
          ...s,
          post_excerpt: s.post_excerpt === null ? null : truncate(s.post_excerpt, 120),
          comment_text: s.comment_text === null ? null : truncate(s.comment_text, 280),
        })),
        last_captured_at: own[0]?.captured_at ?? null,
        last_touchpoint_at: touchpoints.get(id) ?? null,
        latest_analysis: analysis
          ? {
              id: analysis.id,
              icp_id: analysis.icp_id,
              icp_name: analysis.icp_name,
              summary: analysis.summary,
              fit: analysis.fit,
              fit_reason: analysis.fit_reason,
              input_hash: analysis.input_hash,
              created_at: analysis.created_at,
            }
          : null,
        analysis_state: states.get(id)?.state ?? null,
        analysis_error: states.get(id)?.error ?? null,
        memberships: (memberships.get(id) ?? []) as Membership[],
      },
    ];
  });
}

/**
 * Dettaglio completo: riga intera (`raw_json` parsato in `raw`), fonti con post/azienda,
 * membership con ICP, ultima analisi per ICP (grezza, con `input_hash` e `angles` parsati)
 * e timeline desc. `null` se non esiste.
 */
export function getProspect(id: number): ProspectDetail | null {
  const row = db.prepare('SELECT * FROM prospects WHERE id = ?').get(id) as
    | (ProspectBase & {
        member_urn: string | null;
        apollo_person_id: string | null;
        apollo_matched_at: string | null;
        about: string | null;
        raw_json: string | null;
      })
    | undefined;
  if (!row) return null;
  const { raw_json, ...base } = row;
  const latestAnalyses = loadLatestAnalyses([id], { perIcp: true });
  return {
    ...base,
    raw: raw_json ? JSON.parse(raw_json) : null,
    has_email: emailPresent(base.email),
    sources: (groupBy(loadSources([id])).get(id) ?? []) as SourceView[],
    memberships: (groupBy(loadMemberships([id])).get(id) ?? []) as Membership[],
    latest_analysis: latestAnalyses[0] ?? null,
    latest_analyses: latestAnalyses,
    last_touchpoint_at: loadLastTouchpoints([id]).get(id) ?? null,
    timeline: timeline(id),
  };
}

// ---------------------------------------------------------------------------
// Ricerca: Inbox, prospect filtrati, id per la selezione "tutti i filtrati"
// ---------------------------------------------------------------------------

export const PROSPECT_SORTS = ['recent', 'comments_first', 'most_interactions', 'fit'] as const;
export type ProspectSort = (typeof PROSPECT_SORTS)[number];

/**
 * Valori del filtro `fit` = stato della colonna Fit (`AnalysisState`): i tre livelli, `rifiutata`,
 * `errore`, `non_arricchibile` (per riprovare solo i falliti, FLOW E.4) e `none` (non analizzato).
 * Esclusivi: ogni riga ha un solo stato.
 */
export const FIT_FILTERS = ['alto', 'medio', 'basso', 'none', 'rifiutata', 'errore', 'non_arricchibile'] as const;
export type FitFilter = (typeof FIT_FILTERS)[number];

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 50;
export const IDS_CAP = 500;

/**
 * Filtri comuni a Inbox, ricerca prospect e `/ids`. Gli array sono in OR, i campi in AND.
 * - `inbox`: solo prospect senza membership; `scartato` escluso salvo `includeDiscarded` o
 *   `status` che lo contiene esplicitamente.
 * - `fit` si applica solo entro un ICP: `icpId`, altrimenti quello della `listId`, altrimenti
 *   l'unico ICP esistente; se non determinabile lancia `ProspectQueryError('fit_requires_icp')`.
 *   Lo stesso ICP sceglie `latest_analysis` e `analysis_state` delle righe (senza ICP: di qualsiasi).
 *   Il filtro confronta `analysis_state` (`none` = non analizzato), non solo il fit salvato.
 * - `sort` `recent`: in una lista per data di aggiunta, altrove per ultima cattura (fonte) o creazione.
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
  inbox?: boolean;
  includeDiscarded?: boolean;
  sort?: ProspectSort;
  page?: number;
  pageSize?: number;
}

export interface ProspectPage {
  items: ProspectRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** Errore di combinazione dei filtri (l'API lo traduce in 400 con `code`). */
export class ProspectQueryError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ProspectQueryError';
  }
}

/** ICP entro cui leggere fit e ultima analisi (vedi `ProspectQuery`). */
function resolveIcp(query: ProspectQuery): number | undefined {
  if (query.icpId !== undefined) return query.icpId;
  if (query.listId !== undefined) {
    const icp = db.prepare('SELECT icp_id FROM lists WHERE id = ?').pluck().get(query.listId) as number | undefined;
    if (icp !== undefined) return icp;
  }
  const icps = db.prepare('SELECT id FROM icps LIMIT 2').pluck().all() as number[];
  return icps.length === 1 ? icps[0] : undefined;
}

interface BuiltQuery {
  where: string;
  whereParams: unknown[];
  orderBy: string;
  orderParams: unknown[];
  icpId: number | undefined;
}

function buildQuery(query: ProspectQuery): BuiltQuery {
  const conds: string[] = [];
  const params: unknown[] = [];
  const icpId = resolveIcp(query);

  if (query.inbox) {
    conds.push('NOT EXISTS (SELECT 1 FROM list_members lm WHERE lm.prospect_id = p.id)');
    if (!query.includeDiscarded && !query.status?.includes('scartato')) conds.push(`p.status <> 'scartato'`);
  }
  if (query.status?.length) {
    conds.push(`p.status IN (${placeholders(query.status.length)})`);
    params.push(...query.status);
  }
  if (query.listId !== undefined) {
    conds.push('EXISTS (SELECT 1 FROM list_members lm WHERE lm.prospect_id = p.id AND lm.list_id = ?)');
    params.push(query.listId);
  }
  if (query.companyId !== undefined) {
    conds.push('(p.company_id = ? OR EXISTS (SELECT 1 FROM sources s WHERE s.prospect_id = p.id AND s.company_id = ?))');
    params.push(query.companyId, query.companyId);
  }
  if (query.hasEmail !== undefined) {
    conds.push(`${query.hasEmail ? '' : 'NOT '}(p.email IS NOT NULL AND TRIM(p.email) <> '')`);
  }
  if (query.enriched !== undefined) {
    conds.push(`p.enriched_at IS ${query.enriched ? 'NOT ' : ''}NULL`);
  }
  if (query.source?.length) {
    conds.push(
      `EXISTS (SELECT 1 FROM sources s WHERE s.prospect_id = p.id AND s.kind IN (${placeholders(query.source.length)}))`,
    );
    params.push(...query.source);
  }
  if (query.postId !== undefined) {
    conds.push('EXISTS (SELECT 1 FROM sources s WHERE s.prospect_id = p.id AND s.post_id = ?)');
    params.push(query.postId);
  }
  if (query.q?.trim()) {
    const like = `%${query.q.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const cols = ['p.full_name', 'p.headline', 'p.company_name', 'p.title', 'p.email', 'p.linkedin_url'];
    conds.push(`(${cols.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(' OR ')})`);
    params.push(...cols.map(() => like));
  }

  // Fit dell'ultima analisi entro l'ICP risolto (senza ICP: di qualsiasi ICP, solo per l'ordinamento).
  const fitExpr = (icp: number | undefined): [string, unknown[]] => [
    `(SELECT a.fit FROM analyses a WHERE a.prospect_id = p.id ${icp !== undefined ? 'AND a.icp_id = ?' : ''}
      ORDER BY a.created_at DESC, a.id DESC LIMIT 1)`,
    icp !== undefined ? [icp] : [],
  ];
  if (query.fit?.length) {
    if (icpId === undefined) {
      throw new ProspectQueryError('fit_requires_icp', 'Il filtro fit richiede un ICP (icpId): con più ICP le analisi non sono confrontabili.');
    }
    const sql = analysisStateSql(icpId);
    conds.push(`p.id IN (SELECT pp.id FROM ${sql.from} WHERE ${sql.state} IN (${placeholders(query.fit.length)}))`);
    params.push(...sql.params, ...query.fit);
  }

  const orderParams: unknown[] = [];
  let recent: string;
  if (query.listId !== undefined) {
    recent = '(SELECT lm.added_at FROM list_members lm WHERE lm.prospect_id = p.id AND lm.list_id = ?) DESC';
    orderParams.push(query.listId);
  } else {
    recent = 'COALESCE((SELECT MAX(s.captured_at) FROM sources s WHERE s.prospect_id = p.id), p.created_at) DESC';
  }
  const lead: string[] = [];
  const leadParams: unknown[] = [];
  switch (query.sort ?? 'recent') {
    case 'comments_first':
      lead.push(`EXISTS (SELECT 1 FROM sources s WHERE s.prospect_id = p.id AND s.kind = 'post_comment') DESC`);
      break;
    case 'most_interactions':
      lead.push('(SELECT COUNT(*) FROM sources s WHERE s.prospect_id = p.id) DESC');
      break;
    case 'fit': {
      const [expr, exprParams] = fitExpr(icpId);
      lead.push(`CASE ${expr} WHEN 'alto' THEN 0 WHEN 'medio' THEN 1 WHEN 'basso' THEN 2 ELSE 3 END`);
      leadParams.push(...exprParams);
      break;
    }
    default:
      break;
  }

  return {
    where: conds.length ? `WHERE ${conds.join(' AND ')}` : '',
    whereParams: params,
    orderBy: `ORDER BY ${[...lead, recent, 'p.id DESC'].join(', ')}`,
    orderParams: [...leadParams, ...orderParams],
    icpId,
  };
}

function clampPage(query: ProspectQuery): { page: number; pageSize: number } {
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(query.pageSize ?? DEFAULT_PAGE_SIZE)));
  return { page, pageSize };
}

/**
 * Ricerca paginata di prospect con tutti i filtri di `ProspectQuery` (Lista: `listId`;
 * aziende: `companyId`). `pageSize` ≤ 100. Può lanciare `ProspectQueryError`.
 */
export function searchProspects(query: ProspectQuery = {}): ProspectPage {
  const built = buildQuery(query);
  const { page, pageSize } = clampPage(query);
  const total = db.prepare(`SELECT COUNT(*) FROM prospects p ${built.where}`).pluck().get(...built.whereParams) as number;
  const ids = db
    .prepare(`SELECT p.id FROM prospects p ${built.where} ${built.orderBy} LIMIT ? OFFSET ?`)
    .pluck()
    .all(...built.whereParams, ...built.orderParams, pageSize, (page - 1) * pageSize) as number[];
  return { items: hydrateRows(ids, built.icpId), total, page, pageSize };
}

/** Inbox (P1): `searchProspects` con `inbox: true` (senza liste, `scartato` escluso salvo richiesta). */
export function listInbox(query: Omit<ProspectQuery, 'inbox'> = {}): ProspectPage {
  return searchProspects({ ...query, inbox: true });
}

/**
 * Id di tutti i prospect che soddisfano i filtri (stesso ordinamento della tabella), al massimo
 * `cap` (default 500): selezione "tutti i filtrati" (P9). Per l'Inbox passare `inbox: true`.
 */
export function idsByFilters(query: ProspectQuery = {}, cap = IDS_CAP): { ids: number[]; total: number; capped: boolean } {
  const built = buildQuery(query);
  const total = db.prepare(`SELECT COUNT(*) FROM prospects p ${built.where}`).pluck().get(...built.whereParams) as number;
  const ids = db
    .prepare(`SELECT p.id FROM prospects p ${built.where} ${built.orderBy} LIMIT ?`)
    .pluck()
    .all(...built.whereParams, ...built.orderParams, cap) as number[];
  return { ids, total, capped: total > cap };
}
