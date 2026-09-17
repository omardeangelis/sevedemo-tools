import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { config } from '../../config.js';
import { isListArchived, listExists } from '../../db/lists.js';
import { prospectExists } from '../../db/prospects.js';
import { estimateEnrichCostUsd, planEnrichment, type EnrichParams } from '../../jobs/enrich.js';
import type { JobPreview } from '../../jobs/types.js';
import { httpError, idParam, readJson } from '../http.js';
import { launchJob, runningJobBlocker } from '../jobs.js';
import type { AppEnv } from '../types.js';

/**
 * Enrichment on-demand (prospect, selezione, lista) — crm-foundation T10. Montato da `app.ts` con
 * `app.route('/api', enrichRoutes)`: dichiara le path assolute sotto `/api`. Ogni avvio ricalcola
 * la preview: con `blockers` non vuoti il job non parte (400 `code:'blocked'`).
 */
export const enrichRoutes = new Hono<AppEnv>();

const positiveInt = z.coerce.number().int().positive();
const MAX_IDS = 1000;
const flags = { onlyMissing: z.boolean().optional(), retryFailed: z.boolean().optional() };

/** Params salvati sul job: flag sempre espliciti, così "Riprova" rifà esattamente la stessa cosa. */
function jobParams(scope: { prospectIds: number[] } | { listId: number }, opts: { onlyMissing?: boolean; retryFailed?: boolean }): EnrichParams {
  return { ...scope, onlyMissing: opts.onlyMissing ?? true, retryFailed: opts.retryFailed ?? false };
}

/** Blocchi di configurazione: con uno di questi il job non parte (400 `blocked`). */
function configBlockers(params: EnrichParams): string[] {
  const blockers: string[] = [];
  if (!config.apifyToken.trim()) blockers.push('APIFY_TOKEN mancante nel .env — nessun job avviato.');
  if (params.listId !== undefined && isListArchived(params.listId)) {
    blockers.push('Lista archiviata: arricchimento disabilitato (lettura ed export restano possibili).');
  }
  return blockers;
}

/** Preview uniforme (P7): conteggi del piano, stima o `null`, warning, blocchi (config + job in corso). */
function buildPreview(params: EnrichParams): JobPreview {
  const plan = planEnrichment(params);
  const est = estimateEnrichCostUsd(plan.targets.length);
  const warnings: string[] = [];
  if (est === null) warnings.push('Prezzo per profilo non configurato (PRICE_PROFILE_DETAIL_USD): stima non disponibile.');
  if (plan.selected > 0 && plan.targets.length === 0) warnings.push('Nessun profilo da arricchire con queste opzioni.');

  const blockers = configBlockers(params);
  const running = runningJobBlocker();
  if (running) blockers.push(running);

  return {
    counts: {
      selected: plan.selected,
      targets: plan.targets.length,
      skipped_enriched: plan.skipped_enriched,
      skipped_fresh: plan.skipped_fresh,
      not_found: plan.not_found,
    },
    est_cost_usd: est,
    warnings,
    blockers,
  };
}

/**
 * Avvio: 400 `{error, code:'blocked', blockers}` con i blocchi di configurazione, altrimenti `launchJob`
 * (202 `{job}`, o 409 `job_running` se c'è già un job in corso).
 */
function start(c: Context<AppEnv>, params: EnrichParams) {
  const blockers = configBlockers(params);
  if (blockers.length > 0) {
    throw httpError(400, `Arricchimento non avviato: ${blockers.join(' ')}`, { code: 'blocked', blockers });
  }
  return launchJob(c, 'enrich', params);
}

function requireList(id: number): void {
  if (!listExists(id)) throw httpError(404, 'Lista non trovata.');
}

/** Body facoltativo (`POST` senza body = tutti i default); se presente va validato. */
async function readOptionalJson<S extends z.ZodType>(c: Context<AppEnv>, schema: S): Promise<z.infer<S>> {
  if ((await c.req.text()).trim() === '') return schema.parse({});
  return readJson(c, schema);
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

const idsCsv = z
  .string()
  .transform((s) => s.split(',').map((v) => v.trim()).filter(Boolean).map(Number))
  .pipe(z.array(z.number().int().positive()).min(1).max(MAX_IDS));

const previewQuery = z.object({
  prospectIds: idsCsv.optional(),
  listId: positiveInt.optional(),
  onlyMissing: z.stringbool().optional(),
  retryFailed: z.stringbool().optional(),
});

/** `GET /api/enrich/preview?prospectIds=1,2|listId=3&onlyMissing=&retryFailed=` (id anche ripetuti). */
enrichRoutes.get('/enrich/preview', (c) => {
  const raw: Record<string, string> = Object.fromEntries(Object.entries(c.req.query()).filter(([, v]) => v !== ''));
  const ids = c.req.queries('prospectIds')?.filter((v) => v !== '');
  if (ids?.length) raw.prospectIds = ids.join(',');
  const parsed = previewQuery.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw httpError(400, 'Parametri della preview non validi.', { issues });
  }
  const { prospectIds, listId, ...opts } = parsed.data;
  if ((prospectIds === undefined) === (listId === undefined)) {
    throw httpError(400, 'Indica prospectIds oppure listId.', { code: 'invalid_scope' });
  }
  if (listId !== undefined) requireList(listId);
  const scope = prospectIds !== undefined ? { prospectIds } : { listId: listId! };
  return c.json(buildPreview(jobParams(scope, opts)));
});

// ---------------------------------------------------------------------------
// Avvio
// ---------------------------------------------------------------------------

const optionsSchema = z.object(flags).strict();

/** Singolo prospect (dettaglio): stesso job, ambito di un id. */
enrichRoutes.post('/prospects/:id/enrich', async (c) => {
  const id = idParam(c);
  if (!prospectExists(id)) throw httpError(404, 'Prospect non trovato.');
  const opts = await readOptionalJson(c, optionsSchema);
  return start(c, jobParams({ prospectIds: [id] }, opts));
});

const bulkSchema = z.object({ prospectIds: z.array(positiveInt).min(1).max(MAX_IDS), ...flags }).strict();

/** Selezione (Inbox/Lista): gli id inesistenti si contano nel risultato (`not_found`), non sono errori. */
enrichRoutes.post('/enrich', async (c) => {
  const { prospectIds, ...opts } = await readJson(c, bulkSchema);
  return start(c, jobParams({ prospectIds: [...new Set(prospectIds)] }, opts));
});

/** Tutti i membri della lista (default `onlyMissing`). */
enrichRoutes.post('/lists/:id/enrich', async (c) => {
  const listId = idParam(c);
  const opts = await readOptionalJson(c, optionsSchema);
  requireList(listId);
  return start(c, jobParams({ listId }, opts));
});
