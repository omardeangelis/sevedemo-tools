import type { AnalysisOutput } from '../analysis/schema.js';
import { addActivity, type Activity } from './activities.js';
import { db, nowIso } from './index.js';
import type { AnalysisView } from './prospects.js';
import type { SourceKind } from './schema.js';

/*
 * Analisi AI salvate (PLAN crm-foundation §6 `analyses`, T11). L'ultima riga per (prospect, ICP)
 * è quella corrente; `stale` si calcola confrontando `input_hash` con l'input attuale (lo fa solo
 * `GET /api/prospects/:id/analyses`). I fallimenti non creano righe: sono attività `analysis`
 * con `meta.error` + `meta.error_kind` + `meta.icp_id` (così la tabella li mostra e li filtra).
 */

/** Tipo di fallimento di un'analisi, salvato in `activities.meta.error_kind`. */
export const ANALYSIS_ERROR_KINDS = ['refusal', 'invalid_output', 'max_tokens', 'error'] as const;
export type AnalysisErrorKind = (typeof ANALYSIS_ERROR_KINDS)[number];

/** Fonte del prospect come serve al prompt (testi interi, post e azienda risolti). */
export interface AnalysisSource {
  kind: SourceKind;
  post_url: string | null;
  post_excerpt: string | null;
  company_name: string | null;
  reaction_type: string | null;
  comment_text: string | null;
}

/** Il prospect come lo legge l'analisi: anagrafica, `raw_json` parsato e fonti. */
export interface AnalysisSubject {
  id: number;
  linkedin_url: string;
  full_name: string | null;
  headline: string | null;
  about: string | null;
  location: string | null;
  company_name: string | null;
  title: string | null;
  raw: unknown;
  enriched_at: string | null;
  enrichment_attempted_at: string | null;
  sources: AnalysisSource[];
}

type SubjectRow = Omit<AnalysisSubject, 'raw' | 'sources'> & { raw_json: string | null };

/** `null` se il prospect non esiste (anche perché unito in un altro). */
export function loadAnalysisSubject(prospectId: number): AnalysisSubject | null {
  const row = db
    .prepare(
      `SELECT id, linkedin_url, full_name, headline, about, location, company_name, title, raw_json,
              enriched_at, enrichment_attempted_at
       FROM prospects WHERE id = ?`,
    )
    .get(prospectId) as SubjectRow | undefined;
  if (!row) return null;
  const sources = db
    .prepare(
      `SELECT s.kind, po.post_url, po.text_excerpt AS post_excerpt, c.name AS company_name, s.reaction_type, s.comment_text
       FROM sources s
       LEFT JOIN posts po ON po.id = s.post_id
       LEFT JOIN companies c ON c.id = s.company_id
       WHERE s.prospect_id = ?
       ORDER BY s.captured_at, s.id`,
    )
    .all(prospectId) as AnalysisSource[];
  const { raw_json, ...rest } = row;
  let raw: unknown = null;
  try {
    raw = raw_json ? JSON.parse(raw_json) : null;
  } catch {
    raw = null;
  }
  return { ...rest, raw, sources };
}

/** Il prospect ha dati su cui ragionare: arricchito, oppure con About compilato a mano (FLOW: "compila e riprova"). */
export function hasProfileData(p: { enriched_at: string | null; about: string | null }): boolean {
  return p.enriched_at !== null || (typeof p.about === 'string' && p.about.trim() !== '');
}

type AnalysisRecord = Omit<AnalysisView, 'angles'> & { angles: string };

const SELECT_ANALYSIS = `
  SELECT a.id, a.prospect_id, a.icp_id, i.name AS icp_name, a.model, a.summary, a.angles, a.fit, a.fit_reason,
         a.input_hash, a.created_at
  FROM analyses a JOIN icps i ON i.id = a.icp_id`;

function toView(r: AnalysisRecord): AnalysisView {
  return { ...r, angles: JSON.parse(r.angles) as AnalysisView['angles'] };
}

/** Tutte le analisi del prospect per l'ICP, dalla più recente. */
export function analysisHistory(prospectId: number, icpId: number): AnalysisView[] {
  const rows = db
    .prepare(`${SELECT_ANALYSIS} WHERE a.prospect_id = ? AND a.icp_id = ? ORDER BY a.created_at DESC, a.id DESC`)
    .all(prospectId, icpId) as AnalysisRecord[];
  return rows.map(toView);
}

/** Analisi corrente per (prospect, ICP), o `null`. */
export function latestAnalysis(prospectId: number, icpId: number): AnalysisView | null {
  const row = db
    .prepare(`${SELECT_ANALYSIS} WHERE a.prospect_id = ? AND a.icp_id = ? ORDER BY a.created_at DESC, a.id DESC LIMIT 1`)
    .get(prospectId, icpId) as AnalysisRecord | undefined;
  return row ? toView(row) : null;
}

export interface SaveAnalysisInput {
  prospectId: number;
  icpId: number;
  icpName: string;
  model: string;
  output: AnalysisOutput;
  inputHash: string;
  listId?: number | null;
}

/**
 * Salva l'analisi e l'attività `analysis` in una transazione. `null` se nel frattempo il prospect
 * non esiste più (unito in un altro): nessuna scrittura.
 */
export function saveAnalysis(input: SaveAnalysisInput): { analysis: AnalysisView; activity: Activity } | null {
  return db.transaction(() => {
    if (!db.prepare('SELECT 1 FROM prospects WHERE id = ?').get(input.prospectId)) return null;
    const { output } = input;
    const info = db
      .prepare(
        `INSERT INTO analyses (prospect_id, icp_id, model, summary, angles, fit, fit_reason, input_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.prospectId,
        input.icpId,
        input.model,
        output.summary,
        JSON.stringify(output.angles),
        output.fit,
        output.fit_reason,
        input.inputHash,
        nowIso(),
      );
    const analysisId = Number(info.lastInsertRowid);
    const activity = addActivity({
      prospectId: input.prospectId,
      kind: 'analysis',
      listId: input.listId,
      body: `Analisi AI per l'ICP "${input.icpName}": fit ${output.fit}.`,
      meta: { icp_id: input.icpId, analysis_id: analysisId, model: input.model, fit: output.fit },
    });
    const row = db.prepare(`${SELECT_ANALYSIS} WHERE a.id = ?`).get(analysisId) as AnalysisRecord;
    return { analysis: toView(row), activity };
  })();
}

export interface AnalysisFailureInput {
  prospectId: number;
  icpId: number;
  model: string;
  kind: AnalysisErrorKind;
  /** Messaggio leggibile (mostrato in timeline, tooltip e card). */
  error: string;
  listId?: number | null;
  /** Categoria del rifiuto (`stop_details.category`), se presente. */
  refusalCategory?: string | null;
}

/** Attività `analysis` di un'analisi non riuscita (nessuna riga `analyses`). `null` se il prospect non esiste. */
export function recordAnalysisFailure(input: AnalysisFailureInput): Activity | null {
  if (!db.prepare('SELECT 1 FROM prospects WHERE id = ?').get(input.prospectId)) return null;
  return addActivity({
    prospectId: input.prospectId,
    kind: 'analysis',
    listId: input.listId,
    body: input.error,
    meta: {
      icp_id: input.icpId,
      model: input.model,
      error: input.error,
      error_kind: input.kind,
      ...(input.refusalCategory ? { refusal_category: input.refusalCategory } : {}),
    },
  });
}

/** Ultimo fallimento di analisi per (prospect, ICP), o `null`. */
export function latestAnalysisFailure(
  prospectId: number,
  icpId: number,
): { activity_id: number; kind: AnalysisErrorKind; error: string; created_at: string } | null {
  const row = db
    .prepare(
      `SELECT id AS activity_id, json_extract(meta, '$.error_kind') AS kind, json_extract(meta, '$.error') AS error, created_at
       FROM activities
       WHERE prospect_id = ? AND kind = 'analysis' AND json_extract(meta, '$.error') IS NOT NULL
         AND json_extract(meta, '$.icp_id') = ?
       ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(prospectId, icpId) as { activity_id: number; kind: AnalysisErrorKind | null; error: string; created_at: string } | undefined;
  return row ? { ...row, kind: row.kind ?? 'error' } : null;
}
