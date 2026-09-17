import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { analysisContext, analysisInput, analyzeProspect, type AnalyzeResult } from '../../analysis/analyze.js';
import { config } from '../../config.js';
import { analysisHistory, hasProfileData, latestAnalysisFailure, loadAnalysisSubject } from '../../db/analyses.js';
import { getIcpContext } from '../../db/icps.js';
import { isListArchived, listExists } from '../../db/lists.js';
import { analysisStates } from '../../db/prospects.js';
import { resolveDeps } from '../../jobs/deps.js';
import { estimateAnalysisCostUsd, planAnalysis, type AnalysisPlan, type AnalyzeParams, type Deps } from '../../jobs/analyze.js';
import type { JobPreview } from '../../jobs/types.js';
import { httpError, idParam, readJson } from '../http.js';
import { launchJob, runningJobBlocker } from '../jobs.js';
import type { AppEnv } from '../types.js';

/**
 * Analisi AI (singola sincrona, bulk, preview, storico) — crm-foundation T11.
 * Montato da `app.ts` con `app.route('/api', analyzeRoutes)`: dichiara le path assolute
 * sotto `/api` (es. `/prospects/:id/analyze` → `/api/prospects/:id/analyze`).
 */
export const analyzeRoutes = new Hono<AppEnv>();

const positiveInt = z.coerce.number().int().positive();
const MAX_IDS = 1000;

const ANTHROPIC_BLOCKER = 'ANTHROPIC_API_KEY mancante nel .env — nessuna analisi avviata.';

/** Deps dell'analisi: `opts.analyzeDeps` (test) oppure il dispatcher dei job (reali o fake e2e). */
function depsOf(c: Context<AppEnv>): Deps {
  return (c.get('opts').analyzeDeps as Deps | undefined) ?? resolveDeps('analyze');
}

function requireIcp(icpId: number) {
  const icp = getIcpContext(icpId);
  if (!icp) throw httpError(404, 'ICP non trovato.');
  return icp;
}

// ---------------------------------------------------------------------------
// Analisi singola (sincrona)
// ---------------------------------------------------------------------------

const AnalyzeOneBody = z
  .object({ icpId: positiveInt, force: z.boolean().optional(), enrichFirst: z.boolean().optional() })
  .strict();

/** Esito → risposta: 200 con l'analisi, altrimenti `{error, code}` (FLOW, error paths dell'analisi). */
function analyzeResponse(c: Context<AppEnv>, r: AnalyzeResult) {
  switch (r.outcome) {
    case 'analyzed':
    case 'skipped_same_input':
      return c.json({ outcome: r.outcome, enriched_first: r.enrichedFirst, stale: false, analysis: r.analysis });
    case 'not_found':
      throw httpError(404, 'Prospect non trovato.');
    case 'icp_not_found':
      throw httpError(404, 'ICP non trovato.');
    case 'not_enriched':
      throw httpError(409, r.error, { code: 'not_enriched' });
    case 'not_enrichable':
      throw httpError(409, r.error, { code: 'not_enrichable' });
    case 'enrich_error':
      if (r.error.startsWith('config:')) throw httpError(400, r.error.replace(/^config:\s*/, ''), { code: 'config' });
      throw httpError(502, `Arricchimento non riuscito: ${r.error}`, { code: 'enrich_failed' });
    case 'failed': {
      const extra = { activity_id: r.activity?.id ?? null, enriched_first: r.enrichedFirst };
      if (r.error.startsWith('config:')) throw httpError(400, r.error.replace(/^config:\s*/, ''), { code: 'config' });
      const code = r.errorKind === 'error' ? 'analysis_failed' : r.errorKind;
      throw httpError(502, r.error, { code, ...extra });
    }
  }
}

/**
 * `POST /api/prospects/:id/analyze {icpId, force?, enrichFirst?}`: sincrona, non è un job (vale
 * anche con un job in corso). Con `enrichFirst` l'arricchimento avviene inline (≤ 120 s) e poi
 * l'analisi (≤ 90 s): ben sotto il `requestTimeout` di 300 s del server.
 */
analyzeRoutes.post('/prospects/:id/analyze', async (c) => {
  const id = idParam(c);
  const body = await readJson(c, AnalyzeOneBody);
  const subject = loadAnalysisSubject(id);
  if (!subject) throw httpError(404, 'Prospect non trovato.');
  const icp = requireIcp(body.icpId);

  const blockers: string[] = [];
  if (!config.anthropicApiKey.trim()) blockers.push(ANTHROPIC_BLOCKER);
  if (body.enrichFirst && !hasProfileData(subject) && !config.apifyToken.trim()) {
    blockers.push('APIFY_TOKEN mancante nel .env: impossibile arricchire il profilo prima dell\'analisi.');
  }
  if (blockers.length > 0) throw httpError(400, `Analisi non avviata: ${blockers.join(' ')}`, { code: 'blocked', blockers });

  const deps = depsOf(c);
  const result = await analyzeProspect(id, body.icpId, {
    client: deps.client,
    enrich: deps.enrich,
    force: body.force,
    enrichFirst: body.enrichFirst,
    icpContext: icp,
  });
  return analyzeResponse(c, result);
});

/**
 * `GET /api/prospects/:id/analyses?icpId=` → `{icp_id, latest, stale, history, state, last_error,
 * analyzable}`. Unico punto che calcola `stale` (input attuale ≠ `input_hash` dell'ultima analisi).
 * `history` = tutte le analisi per l'ICP, dalla più recente (la prima è `latest`); `last_error` =
 * ultimo fallimento se più recente dell'ultima analisi; `state` = stato di riga (`analysis_state`).
 */
analyzeRoutes.get('/prospects/:id/analyses', (c) => {
  const id = idParam(c);
  const parsedIcp = positiveInt.safeParse(c.req.query('icpId'));
  if (!parsedIcp.success) throw httpError(400, 'Indica icpId: l\'analisi dipende dall\'ICP.', { code: 'icp_required' });
  const icpId = parsedIcp.data;
  const icp = requireIcp(icpId);
  const ctx = analysisContext(id, icp);
  if (!ctx) throw httpError(404, 'Prospect non trovato.');

  const history = analysisHistory(id, icpId);
  const latest = history[0] ?? null;
  const failure = latestAnalysisFailure(id, icpId);
  const lastError = failure && (!latest || failure.created_at > latest.created_at) ? failure : null;
  return c.json({
    icp_id: icpId,
    latest,
    stale: latest !== null && latest.input_hash !== analysisInput(ctx).inputHash,
    history,
    state: analysisStates([id], icpId).get(id)?.state ?? null,
    last_error: lastError && { kind: lastError.kind, message: lastError.error, occurred_at: lastError.created_at, activity_id: lastError.activity_id },
    analyzable: hasProfileData(ctx.prospect),
  });
});

// ---------------------------------------------------------------------------
// Bulk: preview e avvio
// ---------------------------------------------------------------------------

/** Blocchi di configurazione: con uno di questi il job non parte (400 `blocked`). */
function configBlockers(params: AnalyzeParams, plan: AnalysisPlan): string[] {
  const blockers: string[] = [];
  if (!config.anthropicApiKey.trim()) blockers.push(ANTHROPIC_BLOCKER);
  if (params.listId !== undefined && isListArchived(params.listId)) {
    blockers.push('Lista archiviata: analisi disabilitata (lettura ed export restano possibili).');
  }
  if (plan.enrichTargets.length > 0 && !config.apifyToken.trim()) {
    blockers.push(`APIFY_TOKEN mancante nel .env: ${plan.enrichTargets.length} prospect vanno arricchiti prima dell'analisi — nessun job avviato.`);
  }
  return blockers;
}

/** Preview uniforme (P7) + `model`: conteggi del piano, stima, warning, blocchi (config + job in corso). */
function buildPreview(params: AnalyzeParams): JobPreview & { model: string } {
  const plan = planAnalysis(params);
  const icp = plan.icpId === null ? null : getIcpContext(plan.icpId);
  const estimate = estimateAnalysisCostUsd(plan);

  const warnings: string[] = [];
  if (icp && !icp.company.description) warnings.push('Descrizione della tua azienda vuota: angoli meno mirati.');
  if (icp && !icp.icp.pains && !icp.icp.description) warnings.push("L'ICP non ha pains/descrizione: il fit sarà poco affidabile.");
  if (estimate.enrichmentUnavailable) {
    warnings.push(
      "Prezzo per profilo non configurato (PRICE_PROFILE_DETAIL_USD): stima arricchimento non disponibile, la stima copre solo l'analisi.",
    );
  }
  if (plan.selected > 0 && plan.analyzeTargets.length === 0) warnings.push('Nessun prospect da analizzare con queste opzioni.');

  const blockers = configBlockers(params, plan);
  const running = runningJobBlocker();
  if (running) blockers.push(running);

  return {
    counts: {
      selected: plan.selected,
      to_enrich: plan.enrichTargets.length,
      to_analyze: plan.analyzeTargets.length,
      skipped_same_input: plan.skipped_same_input,
      skipped_analyzed: plan.skipped_analyzed,
      not_enrichable: plan.not_enrichable,
      not_found: plan.not_found,
    },
    est_cost_usd: estimate.usd,
    warnings,
    blockers,
    model: config.analysisModel,
  };
}

/**
 * Avvio: 400 `{error, code:'blocked', blockers}` con i blocchi di configurazione, altrimenti
 * `launchJob` (202 `{job}`, o 409 `job_running` se c'è già un job in corso).
 */
function start(c: Context<AppEnv>, params: AnalyzeParams) {
  const blockers = configBlockers(params, planAnalysis(params));
  if (blockers.length > 0) {
    throw httpError(400, `Analisi non avviata: ${blockers.join(' ')}`, { code: 'blocked', blockers });
  }
  return launchJob(c, 'analyze', params);
}

function requireList(id: number): void {
  if (!listExists(id)) throw httpError(404, 'Lista non trovata.');
}

const idsCsv = z
  .string()
  .transform((s) => s.split(',').map((v) => v.trim()).filter(Boolean).map(Number))
  .pipe(z.array(z.number().int().positive()).min(1).max(MAX_IDS));

const previewQuery = z.object({
  prospectIds: idsCsv.optional(),
  listId: positiveInt.optional(),
  icpId: positiveInt.optional(),
  onlyMissing: z.stringbool().optional(),
  force: z.stringbool().optional(),
});

/**
 * `GET /api/analyze/preview?listId=|prospectIds=1,2&icpId=&force=&onlyMissing=` → `JobPreview`
 * (+ `model`). Su lista l'ICP è quello della lista (`icpId` ignorato); sulla selezione è obbligatorio.
 */
analyzeRoutes.get('/analyze/preview', (c) => {
  const raw: Record<string, string> = Object.fromEntries(Object.entries(c.req.query()).filter(([, v]) => v !== ''));
  const ids = c.req.queries('prospectIds')?.filter((v) => v !== '');
  if (ids?.length) raw.prospectIds = ids.join(',');
  const parsed = previewQuery.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw httpError(400, 'Parametri della preview non validi.', { issues });
  }
  const { prospectIds, listId, icpId, onlyMissing, force } = parsed.data;
  if ((prospectIds === undefined) === (listId === undefined)) {
    throw httpError(400, 'Indica prospectIds oppure listId.', { code: 'invalid_scope' });
  }
  if (listId !== undefined) {
    requireList(listId);
    return c.json(buildPreview({ listId, onlyMissing: onlyMissing ?? true, force: force ?? false }));
  }
  if (icpId === undefined) throw httpError(400, "Indica icpId: l'analisi calcola il fit rispetto a un ICP.", { code: 'icp_required' });
  requireIcp(icpId);
  return c.json(buildPreview({ prospectIds: prospectIds!, icpId, onlyMissing: onlyMissing ?? false, force: force ?? false }));
});

/** `__fixture` pilota le deps fake del server e2e (T20); le deps reali lo ignorano. */
const fixture = { __fixture: z.string().optional() };

const bulkSchema = z
  .object({
    prospectIds: z.array(positiveInt).min(1).max(MAX_IDS),
    icpId: positiveInt,
    onlyMissing: z.boolean().optional(),
    force: z.boolean().optional(),
    ...fixture,
  })
  .strict();

/** `POST /api/analyze {prospectIds[], icpId, force?, onlyMissing?}` → 202 `{job}` (id inesistenti contati in `not_found`). */
analyzeRoutes.post('/analyze', async (c) => {
  const body = await readJson(c, bulkSchema);
  requireIcp(body.icpId);
  const params: AnalyzeParams & { __fixture?: string } = {
    prospectIds: [...new Set(body.prospectIds)],
    icpId: body.icpId,
    onlyMissing: body.onlyMissing ?? false,
    force: body.force ?? false,
  };
  if (body.__fixture !== undefined) params.__fixture = body.__fixture;
  return start(c, params);
});

const listSchema = z.object({ onlyMissing: z.boolean().optional(), force: z.boolean().optional(), ...fixture }).strict();

/** `POST /api/lists/:id/analyze {onlyMissing?, force?}` (body facoltativo) → 202 `{job}`; ICP della lista. */
analyzeRoutes.post('/lists/:id/analyze', async (c) => {
  const listId = idParam(c);
  const hasBody = (await c.req.raw.clone().text()).trim() !== '';
  const body = hasBody ? await readJson(c, listSchema) : {};
  requireList(listId);
  const params: AnalyzeParams & { __fixture?: string } = {
    listId,
    onlyMissing: body.onlyMissing ?? true,
    force: body.force ?? false,
  };
  if (body.__fixture !== undefined) params.__fixture = body.__fixture;
  return start(c, params);
});
