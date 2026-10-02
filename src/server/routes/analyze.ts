import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { analyzeProspect, isAnalysisStale, type AnalyzeResult } from '../../analysis/analyze.js';
import { config } from '../../config.js';
import { analysisHistory, hasProfileData, latestAnalysisFailure, loadAnalysisSubject } from '../../db/analyses.js';
import { manualFitsFor } from '../../db/fits.js';
import { getIcp, getIcpContext } from '../../db/icps.js';
import { listExists } from '../../db/lists.js';
import { PERSON_NOT_FOUND_MESSAGE } from '../../db/people.js';
import { analysisStates } from '../../db/prospects.js';
import { resolveDeps } from '../../jobs/deps.js';
import { NO_LINKEDIN_ERROR } from '../../jobs/enrich.js';
import {
  ANTHROPIC_BLOCKER,
  detachedOutcome,
  previewFromParams,
  singleAnalysisEstimate,
  toolsOfSingle,
  type AnalyzeParams,
  type Deps,
} from '../../jobs/analyze.js';
import { httpError, idParam, nonEmptyQuery, readJson, readOptionalJson, readQuery } from '../http.js';
import { launchUnlessBlocked, withDetachedRun, withRunningBlocker } from '../jobs.js';
import type { AppEnv } from '../types.js';

/**
 * Analisi AI (singola sincrona, bulk, preview, storico) — crm-foundation T11.
 * Montato da `app.ts` con `app.route('/api', analyzeRoutes)`: dichiara le path assolute
 * sotto `/api` (es. `/prospects/:id/analyze` → `/api/prospects/:id/analyze`).
 */
export const analyzeRoutes = new Hono<AppEnv>();

const positiveInt = z.coerce.number().int().positive();
const MAX_IDS = 1000;

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

/**
 * Esito → risposta: 200 con l'analisi, altrimenti `{error, code}` (FLOW, error paths dell'analisi). `stale` è
 * quello vero, con lo stesso criterio della scheda (P-7): un campo fisso a `false` mentirebbe.
 */
function analyzeResponse(c: Context<AppEnv>, r: AnalyzeResult) {
  switch (r.outcome) {
    case 'analyzed':
    case 'skipped_same_input': {
      // Riletta adesso: un cambio arrivato durante la chiamata al modello deve risultare.
      const subject = loadAnalysisSubject(r.prospectId);
      const stale = subject !== null && isAnalysisStale(r.analysis, subject);
      return c.json({ outcome: r.outcome, enriched_first: r.enrichedFirst, stale, analysis: r.analysis });
    }
    case 'not_found':
      throw httpError(404, PERSON_NOT_FOUND_MESSAGE);
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
  if (!subject) throw httpError(404, PERSON_NOT_FOUND_MESSAGE);
  if (subject.linkedin_url === null) throw httpError(409, NO_LINKEDIN_ERROR, { code: 'no_linkedin' });
  const icp = requireIcp(body.icpId);

  const blockers: string[] = [];
  if (!config.anthropicApiKey.trim()) blockers.push(ANTHROPIC_BLOCKER);
  if (body.enrichFirst && !hasProfileData(subject) && !config.apifyToken.trim()) {
    blockers.push('APIFY_TOKEN mancante nel .env: impossibile arricchire il profilo prima dell\'analisi.');
  }
  if (blockers.length > 0) throw httpError(400, `Analisi non avviata: ${blockers.join(' ')}`, { code: 'blocked', blockers });

  const deps = depsOf(c);
  const who = subject.full_name ?? `persona #${id}`;
  // Run staccato (P-13, J15): nasce solo se l'analisi chiama davvero uno strumento, e non blocca i job.
  const result = await withDetachedRun(
    'analyze',
    { prospectIds: [id], icpId: body.icpId, force: body.force ?? false, enrichFirst: body.enrichFirst ?? false },
    toolsOfSingle(subject, body.enrichFirst),
    (onToolCall) =>
      analyzeProspect(id, body.icpId, {
        client: deps.client,
        enrich: deps.enrich,
        force: body.force,
        enrichFirst: body.enrichFirst,
        icpContext: icp,
        onToolCall,
      }),
    (r) => detachedOutcome(r, who),
  );
  return analyzeResponse(c, result);
});

/**
 * `GET /api/prospects/:id/analyses?icpId=` → `{icp_id, latest, stale, history, state, last_error,
 * analyzable, estimate}`. `stale` = la persona è cambiata dopo l'ultima analisi (`isAnalysisStale`, own-profile-services F13).
 * `history` = tutte le analisi per l'ICP, dalla più recente (la prima è `latest`); `last_error` =
 * ultimo fallimento se più recente dell'ultima analisi; `state` = stato di riga (`analysis_state`).
 */
analyzeRoutes.get('/prospects/:id/analyses', (c) => {
  const id = idParam(c);
  const parsedIcp = positiveInt.safeParse(c.req.query('icpId'));
  if (!parsedIcp.success) throw httpError(400, 'Indica icpId: l\'analisi dipende dall\'ICP.', { code: 'icp_required' });
  const icpId = parsedIcp.data;
  // Serve solo la persona (e che l'ICP esista): il contesto dell'utente non decide niente qui (F7).
  if (!getIcp(icpId)) throw httpError(404, 'ICP non trovato.');
  const subject = loadAnalysisSubject(id);
  if (!subject) throw httpError(404, PERSON_NOT_FOUND_MESSAGE);

  const history = analysisHistory(id, icpId);
  const latest = history[0] ?? null;
  const failure = latestAnalysisFailure(id, icpId);
  const lastError = failure && (!latest || failure.created_at > latest.created_at) ? failure : null;
  const analyzable = hasProfileData(subject);
  return c.json({
    icp_id: icpId,
    latest,
    stale: latest !== null && isAnalysisStale(latest, subject),
    history,
    state: analysisStates([id], icpId).get(id)?.state ?? null,
    last_error: lastError && { kind: lastError.kind, message: lastError.error, occurred_at: lastError.created_at, activity_id: lastError.activity_id },
    analyzable,
    // La stima dell'azione del bottone, dalla funzione della preview in blocco (T15): la card non scrive prezzi.
    estimate: singleAnalysisEstimate(analyzable),
    // Fit manuale per lo stesso ICP (F4): la card lo mostra accanto al fit dell'AI; "da aggiornare" resta dell'AI (F8).
    manual_fit: manualFitsFor([id], icpId).get(id) ?? null,
  });
});

// ---------------------------------------------------------------------------
// Bulk: preview e avvio
// ---------------------------------------------------------------------------

/**
 * Avvio: 400 `{error, code:'blocked', blockers}` con i blocchi di configurazione, altrimenti
 * `launchJob` (202 `{job}`, o 409 `job_running` se c'è già un job in corso).
 */
function start(c: Context<AppEnv>, params: AnalyzeParams) {
  // Stessi blocchi della preview (configurazione + "niente da analizzare", G-12), come gli altri kind.
  return launchUnlessBlocked(c, 'analyze', params, previewFromParams(params).blockers, 'Analisi non avviata');
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
 * `onlyMissing` vale `true` se assente, su lista e su selezione (own-profile-services F8).
 */
analyzeRoutes.get('/analyze/preview', (c) => {
  const raw = nonEmptyQuery(c);
  const ids = c.req.queries('prospectIds')?.filter((v) => v !== '');
  if (ids?.length) raw.prospectIds = ids.join(',');
  const { prospectIds, listId, icpId, onlyMissing, force } = readQuery(c, previewQuery, undefined, { raw });
  if ((prospectIds === undefined) === (listId === undefined)) {
    throw httpError(400, 'Indica prospectIds oppure listId.', { code: 'invalid_scope' });
  }
  if (listId !== undefined) {
    requireList(listId);
    return c.json(withRunningBlocker(previewFromParams({ listId, onlyMissing: onlyMissing ?? true, force: force ?? false })));
  }
  if (icpId === undefined) throw httpError(400, "Indica icpId: l'analisi calcola il fit rispetto a un ICP.", { code: 'icp_required' });
  requireIcp(icpId);
  return c.json(
    withRunningBlocker(previewFromParams({ prospectIds: prospectIds!, icpId, onlyMissing: onlyMissing ?? true, force: force ?? false })),
  );
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
    onlyMissing: body.onlyMissing ?? true,
    force: body.force ?? false,
  };
  if (body.__fixture !== undefined) params.__fixture = body.__fixture;
  return start(c, params);
});

const listSchema = z.object({ onlyMissing: z.boolean().optional(), force: z.boolean().optional(), ...fixture }).strict();

/** `POST /api/lists/:id/analyze {onlyMissing?, force?}` (body facoltativo) → 202 `{job}`; ICP della lista. */
analyzeRoutes.post('/lists/:id/analyze', async (c) => {
  const listId = idParam(c);
  const body = await readOptionalJson(c, listSchema);
  requireList(listId);
  const params: AnalyzeParams & { __fixture?: string } = {
    listId,
    onlyMissing: body.onlyMissing ?? true,
    force: body.force ?? false,
  };
  if (body.__fixture !== undefined) params.__fixture = body.__fixture;
  return start(c, params);
});
