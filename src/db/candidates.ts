import { bucketOf, SCORE_BUCKETS, SCORING_VERSION, type ScoreBucket, type ScoreParts } from '../apollo/similarity.js';
import type { JobResult, JobState, LookalikeParams, LookalikeResultCounts } from '../jobs/types.js';
import { db, nowIso } from './index.js';
import { CANDIDATE_STATUSES, type CandidateStatus } from './schema.js';

/*
 * Candidate di un ICP (apollo-lookalike T5, SPEC D10/D14/E; PLAN §6, P-4, P-17): API dati usata dal
 * job lookalike (T7b/T9), dalla preview e dallo storico delle ricerche (T7a), dalle route candidate e
 * dal dettaglio azienda (T11), dai contatti (T8). Tutto il resto è derivato: "ultima ricerca" e
 * "ultima pagina letta" dai job `lookalike_companies` riusciti, "già cercata il <data>" dalle fonti
 * `apollo_people`, le statistiche per ricerca dalle candidate raggruppate per `job_id`.
 */

export type { CandidateStatus } from './schema.js';

/** Righe massime restituite da `listCandidates` (P-17: la tabella pagina lato client). */
export const CANDIDATES_CAP = 500;

// ---------------------------------------------------------------------------
// Scrittura
// ---------------------------------------------------------------------------

export interface CandidateInput {
  icpId: number;
  companyId: number;
  /** Punteggio 0–1 a 2 decimali (`scoreCandidate`). */
  score: number;
  /** Componenti del punteggio (`location: null` = esclusa). */
  parts: ScoreParts;
  /** Ragioni "perché simile" in italiano. */
  reasons: string[];
  /** Ricerca che l'ha proposta (`null` fuori da un job, es. test o seed). */
  jobId: number | null;
  /** Default `SCORING_VERSION`. */
  scoringVersion?: string;
}

export interface UpsertCandidateResult {
  /** `true` = riga nuova in stato `proposta`. */
  created: boolean;
  /** `true` = l'azienda è referenza dell'ICP: nessuna candidata scritta (SPEC Data model, E4). */
  reference: boolean;
}

/**
 * Propone l'azienda come candidata dell'ICP (stato `proposta`). Se la candidata esiste già **non
 * cambia nulla**: stato, `decided_at`, `job_id` (la ricerca che l'ha proposta per prima, SPEC D14),
 * punteggio, componenti, ragioni e versione restano quelli originali ("cambiare le costanti non
 * ricalcola i punteggi esistenti"). Una referenza dello stesso ICP non diventa candidata:
 * `{created: false, reference: true}`. ICP e azienda devono esistere (FK: altrimenti lancia).
 */
export function upsertCandidate(input: CandidateInput): UpsertCandidateResult {
  return db.transaction((): UpsertCandidateResult => {
    const isReference =
      db.prepare('SELECT 1 FROM icp_reference_companies WHERE icp_id = ? AND company_id = ?').get(input.icpId, input.companyId) !==
      undefined;
    if (isReference) return { created: false, reference: true };
    const info = db
      .prepare(
        `INSERT INTO icp_company_candidates (icp_id, company_id, status, score, reasons, job_id, score_parts, scoring_version, created_at)
         VALUES (?, ?, 'proposta', ?, ?, ?, ?, ?, ?)
         ON CONFLICT (icp_id, company_id) DO NOTHING`,
      )
      .run(
        input.icpId,
        input.companyId,
        input.score,
        JSON.stringify(input.reasons),
        input.jobId,
        JSON.stringify(input.parts),
        input.scoringVersion ?? SCORING_VERSION,
        nowIso(),
      );
    return { created: info.changes === 1, reference: false };
  })();
}

export interface SetCandidateStatusResult {
  /** Candidate aggiornate (anche se lo stato era già quello: idempotente). */
  updated: number;
  /** Id senza candidata per quell'ICP, con il motivo in italiano. */
  failed: Array<{ company_id: number; error: string }>;
}

const NOT_A_CANDIDATE = 'Candidata non trovata per questo ICP.';

/**
 * Cambia lo stato delle candidate indicate, **per item** (SPEC E2/E3): un id che non è candidata
 * dell'ICP finisce in `failed` e non ferma gli altri. Idempotente: lo stesso stato risponde come
 * aggiornato; `decided_at` si aggiorna a **ogni** chiamata, anche per "Riproponi" (`proposta`). Id
 * ripetuti contano una volta. Lancia solo per uno stato fuori da `CANDIDATE_STATUSES` (validato
 * dalle route).
 */
export function setCandidateStatus(icpId: number, companyIds: readonly number[], status: CandidateStatus): SetCandidateStatusResult {
  if (!(CANDIDATE_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`Stato candidata non valido: ${String(status)}`);
  }
  return db.transaction((): SetCandidateStatusResult => {
    const update = db.prepare('UPDATE icp_company_candidates SET status = ?, decided_at = ? WHERE icp_id = ? AND company_id = ?');
    const now = nowIso();
    const result: SetCandidateStatusResult = { updated: 0, failed: [] };
    for (const companyId of new Set(companyIds)) {
      if (update.run(status, now, icpId, companyId).changes === 1) result.updated += 1;
      else result.failed.push({ company_id: companyId, error: NOT_A_CANDIDATE });
    }
    return result;
  })();
}

/** Toglie la candidata (es. promozione a referenza, SPEC E4). `false` se non c'era. */
export function removeCandidate(icpId: number, companyId: number): boolean {
  return db.prepare('DELETE FROM icp_company_candidates WHERE icp_id = ? AND company_id = ?').run(icpId, companyId).changes > 0;
}

// ---------------------------------------------------------------------------
// Lettura
// ---------------------------------------------------------------------------

/** Riga candidata con i campi dell'azienda (payload di `GET /api/icps/:id/candidates`, PLAN §12). */
export interface CandidateRow {
  icp_id: number;
  company_id: number;
  name: string | null;
  domain: string | null;
  linkedin_url: string | null;
  website: string | null;
  industry: string | null;
  size: string | null;
  location: string | null;
  /** Dall'ultima risposta Apollo salvata sull'azienda (`apollo_json`), se presenti. */
  apollo_city: string | null;
  apollo_state: string | null;
  apollo_country: string | null;
  apollo_employees: number | null;
  score: number;
  score_parts: ScoreParts;
  scoring_version: string;
  reasons: string[];
  status: CandidateStatus;
  job_id: number | null;
  created_at: string;
  decided_at: string | null;
  /** Fonte `apollo_people` più recente per l'azienda (qualunque lista): "già cercata il <data>" (SPEC E5). */
  last_contacts_at: string | null;
}

type CandidateRecord = Omit<CandidateRow, 'score_parts' | 'reasons' | 'last_contacts_at'> & { score_parts: string; reasons: string };

const SELECT_CANDIDATES = `
  SELECT cand.icp_id, cand.company_id, c.name, c.domain, c.linkedin_url, c.website, c.industry, c.size, c.location,
         json_extract(c.apollo_json, '$.city') AS apollo_city,
         json_extract(c.apollo_json, '$.state') AS apollo_state,
         json_extract(c.apollo_json, '$.country') AS apollo_country,
         json_extract(c.apollo_json, '$.estimated_num_employees') AS apollo_employees,
         cand.score, cand.score_parts, cand.scoring_version, cand.reasons, cand.status, cand.job_id,
         cand.created_at, cand.decided_at
  FROM icp_company_candidates cand
  JOIN companies c ON c.id = cand.company_id`;

/** Testo Apollo tollerante: solo stringhe non vuote; numero solo se finito. */
function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function toRows(records: CandidateRecord[]): CandidateRow[] {
  const contacts = lastContactsByCompany(records.map((r) => r.company_id));
  return records.map((r) => ({
    ...r,
    apollo_city: textOrNull(r.apollo_city),
    apollo_state: textOrNull(r.apollo_state),
    apollo_country: textOrNull(r.apollo_country),
    apollo_employees: typeof r.apollo_employees === 'number' && Number.isFinite(r.apollo_employees) ? r.apollo_employees : null,
    score_parts: JSON.parse(r.score_parts) as ScoreParts,
    reasons: JSON.parse(r.reasons) as string[],
    last_contacts_at: contacts.get(r.company_id) ?? null,
  }));
}

/**
 * Candidate dell'ICP, filtrate per stato se indicato, ordinate per punteggio decrescente poi nome
 * (senza maiuscole), al massimo `CANDIDATES_CAP` (P-17). JSON parsati e `last_contacts_at` derivata.
 * Il totale per stato è in `countCandidates`.
 */
export function listCandidates(icpId: number, status?: CandidateStatus): CandidateRow[] {
  const records = db
    .prepare(
      `${SELECT_CANDIDATES}
       WHERE cand.icp_id = @icpId AND (@status IS NULL OR cand.status = @status)
       ORDER BY cand.score DESC, COALESCE(c.name, c.domain, c.linkedin_url) COLLATE NOCASE, c.id
       LIMIT ${CANDIDATES_CAP}`,
    )
    .all({ icpId, status: status ?? null }) as CandidateRecord[];
  return toRows(records);
}

/** Candidata singola con i campi dell'azienda, `undefined` se l'azienda non è candidata dell'ICP. */
export function getCandidate(icpId: number, companyId: number): CandidateRow | undefined {
  const record = db.prepare(`${SELECT_CANDIDATES} WHERE cand.icp_id = ? AND cand.company_id = ?`).get(icpId, companyId) as
    | CandidateRecord
    | undefined;
  return record ? toRows([record])[0] : undefined;
}

export type CandidateCounts = Record<CandidateStatus, number>;

function zeroCounts(): CandidateCounts {
  return Object.fromEntries(CANDIDATE_STATUSES.map((s) => [s, 0])) as CandidateCounts;
}

/** Candidate dell'ICP per stato (zeri se nessuna). */
export function countCandidates(icpId: number): CandidateCounts {
  const counts = zeroCounts();
  const rows = db
    .prepare('SELECT status, COUNT(*) AS n FROM icp_company_candidates WHERE icp_id = ? GROUP BY status')
    .all(icpId) as Array<{ status: CandidateStatus; n: number }>;
  for (const row of rows) counts[row.status] = row.n;
  return counts;
}

export interface CandidateOf {
  icp_id: number;
  icp_name: string;
  status: CandidateStatus;
  score: number;
  decided_at: string | null;
}

/** ICP di cui l'azienda è candidata, per nome ICP (dettaglio azienda, SPEC E5). */
export function candidateOf(companyId: number): CandidateOf[] {
  return db
    .prepare(
      `SELECT cand.icp_id, i.name AS icp_name, cand.status, cand.score, cand.decided_at
       FROM icp_company_candidates cand JOIN icps i ON i.id = cand.icp_id
       WHERE cand.company_id = ?
       ORDER BY i.name COLLATE NOCASE, i.id`,
    )
    .all(companyId) as CandidateOf[];
}

/**
 * Aziende già note all'ICP per la ricerca lookalike (SPEC D7): candidate in qualunque stato e
 * referenze. Il job le esclude dalle candidate nuove (contate come "già note").
 */
export function knownCompanyIdsForIcp(icpId: number): Set<number> {
  const ids = db
    .prepare(
      `SELECT company_id FROM icp_company_candidates WHERE icp_id = @icpId
       UNION SELECT company_id FROM icp_reference_companies WHERE icp_id = @icpId`,
    )
    .pluck()
    .all({ icpId }) as number[];
  return new Set(ids);
}

// ---------------------------------------------------------------------------
// Ricerche derivate dai job (P-4, SPEC D6/D14)
// ---------------------------------------------------------------------------

export interface LookalikeRun {
  id: number;
  /** Fine del job (`finished_at`, o `created_at` se mancasse). */
  at: string;
  params: LookalikeParams;
  result: JobResult | null;
}

interface JobRecord {
  id: number;
  params: string;
  state: JobState;
  result: string | null;
  finished_at: string | null;
  created_at: string;
}

function succeededLookalikeJobs(icpId: number, limit: number): JobRecord[] {
  return db
    .prepare(
      `SELECT id, params, state, result, finished_at, created_at FROM jobs
       WHERE kind = 'lookalike_companies' AND state = 'succeeded' AND json_extract(params, '$.icpId') = ?
       ORDER BY id DESC LIMIT ?`,
    )
    .all(icpId, limit) as JobRecord[];
}

/**
 * Ultima ricerca lookalike **riuscita** dell'ICP (anche parziale: S-4) con `params` e `result`
 * parsati, `null` se nessuna. Base di "ultima ricerca", `resume` e "Riusa questi filtri".
 */
export function lastLookalikeRun(icpId: number): LookalikeRun | null {
  const job = succeededLookalikeJobs(icpId, 1)[0];
  if (!job) return null;
  return {
    id: job.id,
    at: job.finished_at ?? job.created_at,
    params: JSON.parse(job.params) as LookalikeParams,
    result: job.result === null ? null : (JSON.parse(job.result) as JobResult),
  };
}

export type BucketStats = Record<ScoreBucket, CandidateCounts>;

export interface RunStats {
  /** Candidate proposte da quella ricerca (con quel `job_id`), in qualunque stato attuale. */
  proposed: number;
  /** Di cui con la componente località esclusa (`score_parts.location` nullo o assente). */
  without_location: number;
  /** Distribuzione fascia di punteggio (`SCORE_BUCKETS`) × stato attuale. */
  buckets: BucketStats;
}

/** Statistiche di una ricerca derivate dalle sue candidate (SPEC D14); zeri se non ne ha. */
export function runStats(jobId: number): RunStats {
  const buckets = Object.fromEntries(SCORE_BUCKETS.map((b) => [b.bucket, zeroCounts()])) as BucketStats;
  const rows = db
    .prepare(
      `SELECT score, status, json_extract(score_parts, '$.location') IS NULL AS no_location
       FROM icp_company_candidates WHERE job_id = ?`,
    )
    .all(jobId) as Array<{ score: number; status: CandidateStatus; no_location: number }>;
  let withoutLocation = 0;
  for (const row of rows) {
    buckets[bucketOf(row.score)][row.status] += 1;
    if (row.no_location === 1) withoutLocation += 1;
  }
  return { proposed: rows.length, without_location: withoutLocation, buckets };
}

/** Riga di "Ricerche precedenti" (`GET /api/icps/:id/lookalike/runs`, PLAN §12). */
export interface LookalikeRunSummary {
  id: number;
  at: string;
  state: JobState;
  filters: { keywords: string[]; ranges: string[]; locations: string[] };
  counts: Partial<LookalikeResultCounts> & Record<string, number>;
  /** Avvisi dell'esito (es. esito parziale). */
  warnings: string[];
  stats: RunStats;
}

/** Ultime `limit` ricerche lookalike **riuscite** dell'ICP, dalla più recente, con le statistiche. */
export function lookalikeRuns(icpId: number, limit = 5): LookalikeRunSummary[] {
  return succeededLookalikeJobs(icpId, limit).map((job) => {
    const params = JSON.parse(job.params) as Partial<LookalikeParams>;
    const result = job.result === null ? null : (JSON.parse(job.result) as JobResult);
    return {
      id: job.id,
      at: job.finished_at ?? job.created_at,
      state: job.state,
      filters: { keywords: params.keywords ?? [], ranges: params.ranges ?? [], locations: params.locations ?? [] },
      counts: result?.counts ?? {},
      warnings: result?.warnings ?? [],
      stats: runStats(job.id),
    };
  });
}

// ---------------------------------------------------------------------------
// Contatti già cercati (G-3, SPEC E5/F3/F12)
// ---------------------------------------------------------------------------

/**
 * Per azienda, la data più recente (`captured_at`) delle fonti `apollo_people`; le aziende senza fonti
 * mancano dalla mappa. Con `listId`, solo le fonti di prospect membri di quella lista (warning F3
 * "già cercate per questa lista").
 */
export function lastContactsByCompany(companyIds: readonly number[], listId?: number): Map<number, string> {
  if (companyIds.length === 0) return new Map();
  const rows = db
    .prepare(
      `SELECT s.company_id, MAX(s.captured_at) AS at FROM sources s
       WHERE s.kind = 'apollo_people'
         AND s.company_id IN (SELECT value FROM json_each(@ids))
         AND (@listId IS NULL OR EXISTS (
           SELECT 1 FROM list_members lm WHERE lm.prospect_id = s.prospect_id AND lm.list_id = @listId))
       GROUP BY s.company_id`,
    )
    .all({ ids: JSON.stringify([...new Set(companyIds)]), listId: listId ?? null }) as Array<{ company_id: number; at: string }>;
  return new Map(rows.map((r) => [r.company_id, r.at]));
}
