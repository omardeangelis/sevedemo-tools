import { addActivity } from './activities.js';
import { db, nowIso } from './index.js';
import type { FitLevel } from './schema.js';

/*
 * Fit manuale per ICP e fit effettivo (people-first-crm SPEC F, PLAN P-7, T19). Il fit manuale è al più uno per
 * coppia persona–ICP (`manual_fits`, CASCADE con persona e ICP: F10); il **fit effettivo** è il manuale se c'è,
 * altrimenti lo stato dell'analisi AI (F2, F3): la stessa regola in SQL per filtro e ordinamento (`effectiveFitSql`) e
 * sulle righe già lette per la colonna (`effectiveFit`).
 * Né l'AI né i job scrivono qui (K3): solo l'utente, con una voce `fit_change` in timeline (F7).
 */

/**
 * Stato dell'analisi AI mostrato nella colonna Fit senza fit manuale (FLOW E.4): il fit dell'ultima analisi,
 * `rifiutata`/`errore` se l'ultimo tentativo fallito è più recente dell'ultima analisi salvata,
 * `non_arricchibile` se l'arricchimento non ha trovato dati, `null` = non analizzato.
 */
export type AnalysisState = FitLevel | 'rifiutata' | 'errore' | 'non_arricchibile';

/** Origine del fit effettivo (F2, F3): il tuo o quello dell'AI. */
export type FitOrigin = 'tuo' | 'ai';

/** Fit manuale di una persona per un ICP. */
export interface ManualFit {
  icp_id: number;
  icp_name: string;
  fit: FitLevel;
  reason: string | null;
  set_at: string;
}

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ');

/**
 * Espressione SQL dello stato dell'analisi AI (`AnalysisState`, `'none'` se non analizzato) su `pp` =
 * prospects, entro l'ICP dato (senza: qualsiasi ICP). I fallimenti sono attività `analysis` con `meta.error`
 * (`meta.icp_id`, `meta.error_kind`). Con `ids` le sottoquery a finestra leggono solo quelle persone (righe di una
 * pagina); senza, tutte (filtro e ordinamento).
 */
export function analysisStateSql(icpId: number | undefined, ids?: readonly number[]): { from: string; state: string; params: unknown[] } {
  const only = ids ? `prospect_id IN (${placeholders(ids.length)})` : null;
  const analysesWhere = [icpId !== undefined && 'icp_id = ?', only].filter(Boolean).join(' AND ');
  const icpFailure = icpId !== undefined ? `AND json_extract(meta, '$.icp_id') = ?` : '';
  const from = `prospects pp
    LEFT JOIN (
      SELECT prospect_id, fit, created_at,
             ROW_NUMBER() OVER (PARTITION BY prospect_id ORDER BY created_at DESC, id DESC) AS rn
      FROM analyses ${analysesWhere ? `WHERE ${analysesWhere}` : ''}
    ) an ON an.prospect_id = pp.id AND an.rn = 1
    LEFT JOIN (
      SELECT prospect_id, created_at, body, json_extract(meta, '$.error') AS error,
             json_extract(meta, '$.error_kind') AS error_kind,
             ROW_NUMBER() OVER (PARTITION BY prospect_id ORDER BY created_at DESC, id DESC) AS rn
      FROM activities
      WHERE kind = 'analysis' AND json_extract(meta, '$.error') IS NOT NULL ${icpFailure} ${only ? `AND ${only}` : ''}
    ) fa ON fa.prospect_id = pp.id AND fa.rn = 1`;
  const state = `CASE
      WHEN fa.created_at IS NOT NULL AND (an.created_at IS NULL OR fa.created_at > an.created_at)
        THEN CASE WHEN fa.error_kind = 'refusal' THEN 'rifiutata' ELSE 'errore' END
      WHEN an.fit IS NOT NULL THEN an.fit
      WHEN pp.enrichment_attempted_at IS NOT NULL AND pp.enriched_at IS NULL THEN 'non_arricchibile'
      ELSE 'none'
    END`;
  const icp = icpId !== undefined ? [icpId] : [];
  const scoped = ids ?? [];
  return { from, state, params: [...icp, ...scoped, ...icp, ...scoped] };
}

/**
 * Stato analisi per persona entro l'ICP (senza ICP: di qualsiasi ICP), con il messaggio dell'ultimo fallimento
 * quando lo stato è `rifiutata`/`errore`.
 */
export function analysisStates(
  ids: number[],
  icpId: number | undefined,
): Map<number, { state: AnalysisState | null; error: string | null }> {
  if (ids.length === 0) return new Map();
  const sql = analysisStateSql(icpId, ids);
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

/**
 * Espressione SQL del **fit effettivo** (F2, F3) su `pp` = prospects, per filtro e ordinamento: il fit manuale
 * dell'ICP se c'è, altrimenti lo stato dell'analisi AI (`'none'` = nessuno dei due). Senza ICP vale solo l'AI (i fit
 * manuali sono per ICP). Stessa regola di `effectiveFit`, che la applica alle righe già lette.
 */
export function effectiveFitSql(icpId: number | undefined): { from: string; state: string; params: unknown[] } {
  const ai = analysisStateSql(icpId);
  if (icpId === undefined) return ai;
  return {
    from: `${ai.from}
    LEFT JOIN manual_fits mf ON mf.prospect_id = pp.id AND mf.icp_id = ?`,
    state: `COALESCE(mf.fit, ${ai.state})`,
    params: [...ai.params, icpId],
  };
}

/** Fit effettivo di una persona (F2, F3) dal fit manuale e dallo stato AI: il tuo se c'è, altrimenti quello dell'AI. */
export function effectiveFit(manual: ManualFit | null | undefined, ai: AnalysisState | null): { state: AnalysisState | null; origin: FitOrigin | null } {
  if (manual) return { state: manual.fit, origin: 'tuo' };
  return { state: ai, origin: ai ? 'ai' : null };
}

const MANUAL_FIT_COLUMNS = 'mf.prospect_id, mf.icp_id, i.name AS icp_name, mf.fit, mf.reason, mf.set_at';

/** Fit manuali delle persone per un ICP. */
export function manualFitsFor(ids: number[], icpId: number): Map<number, ManualFit> {
  if (ids.length === 0) return new Map();
  const rows = db
    .prepare(
      `SELECT ${MANUAL_FIT_COLUMNS} FROM manual_fits mf JOIN icps i ON i.id = mf.icp_id
       WHERE mf.icp_id = ? AND mf.prospect_id IN (${placeholders(ids.length)})`,
    )
    .all(icpId, ...ids) as Array<ManualFit & { prospect_id: number }>;
  return new Map(rows.map(({ prospect_id, ...fit }) => [prospect_id, fit]));
}

/** Tutti i fit manuali di una persona, per nome dell'ICP (dettaglio). */
export function manualFitsOf(prospectId: number): ManualFit[] {
  return (
    db
      .prepare(`SELECT ${MANUAL_FIT_COLUMNS} FROM manual_fits mf JOIN icps i ON i.id = mf.icp_id WHERE mf.prospect_id = ? ORDER BY i.name COLLATE NOCASE, i.id`)
      .all(prospectId) as Array<ManualFit & { prospect_id: number }>
  ).map(({ prospect_id: _, ...fit }) => fit);
}

/** Fit manuali espressi per l'ICP: la conferma di "Elimina ICP" li conta (F10). */
export function countManualFits(icpId: number): number {
  return db.prepare('SELECT COUNT(*) FROM manual_fits WHERE icp_id = ?').pluck().get(icpId) as number;
}

/** Esito di una scrittura del fit manuale: fit effettivo dopo la scrittura e fit manuale rimasto. */
export interface FitWriteResult {
  fit_state: AnalysisState | null;
  fit_origin: FitOrigin | null;
  manual_fit: ManualFit | null;
}

function writeResult(prospectId: number, icpId: number): FitWriteResult {
  const manual = manualFitsFor([prospectId], icpId).get(prospectId) ?? null;
  const { state, origin } = effectiveFit(manual, analysisStates([prospectId], icpId).get(prospectId)?.state ?? null);
  return { fit_state: state, fit_origin: origin, manual_fit: manual };
}

/** Controlla persona e ICP: `'person'`/`'icp'` = non esiste; altrimenti il nome dell'ICP. */
function targets(prospectId: number, icpId: number): { missing: 'person' | 'icp' } | { icpName: string } {
  if (!db.prepare('SELECT 1 FROM prospects WHERE id = ?').get(prospectId)) return { missing: 'person' };
  const icpName = db.prepare('SELECT name FROM icps WHERE id = ?').pluck().get(icpId) as string | undefined;
  return icpName === undefined ? { missing: 'icp' } : { icpName };
}

function fitChange(prospectId: number, icpId: number, icpName: string, from: FitLevel | null, to: FitLevel | null, reason: string | null): void {
  addActivity({ prospectId, kind: 'fit_change', body: reason, meta: { icp_id: icpId, icp_name: icpName, from, to } });
}

/**
 * Imposta o cambia il fit manuale (F1, F7): vale anche senza arricchimento, analisi o LinkedIn; stato e liste
 * non cambiano. Stesso valore e stessa motivazione = nessuna scrittura. `reason` vuota = nessuna.
 */
export function setManualFit(
  prospectId: number,
  icpId: number,
  input: { fit: FitLevel; reason?: string | null },
): FitWriteResult | { missing: 'person' | 'icp' } {
  const reason = input.reason?.trim() || null;
  return db
    .transaction(() => {
      const t = targets(prospectId, icpId);
      if ('missing' in t) return t;
      const before = manualFitsFor([prospectId], icpId).get(prospectId);
      if (before?.fit !== input.fit || before.reason !== reason) {
        db.prepare(
          `INSERT INTO manual_fits (prospect_id, icp_id, fit, reason, set_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (prospect_id, icp_id) DO UPDATE SET fit = excluded.fit, reason = excluded.reason, set_at = excluded.set_at`,
        ).run(prospectId, icpId, input.fit, reason, nowIso());
        fitChange(prospectId, icpId, t.icpName, before?.fit ?? null, input.fit, reason);
      }
      return writeResult(prospectId, icpId);
    })
    .immediate();
}

/** "Rimuovi il mio fit" (F6, F7): torna a valere l'analisi AI. Nessun fit manuale = nessuna scrittura. */
export function removeManualFit(prospectId: number, icpId: number): FitWriteResult | { missing: 'person' | 'icp' } {
  return db
    .transaction(() => {
      const t = targets(prospectId, icpId);
      if ('missing' in t) return t;
      const before = manualFitsFor([prospectId], icpId).get(prospectId);
      if (before) {
        db.prepare('DELETE FROM manual_fits WHERE prospect_id = ? AND icp_id = ?').run(prospectId, icpId);
        fitChange(prospectId, icpId, t.icpName, before.fit, null, null);
      }
      return writeResult(prospectId, icpId);
    })
    .immediate();
}
