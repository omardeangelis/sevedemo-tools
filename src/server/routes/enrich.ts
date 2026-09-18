import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { config } from '../../config.js';
import { listExists } from '../../db/lists.js';
import { prospectExists } from '../../db/prospects.js';
import {
  configBlockers,
  enrichProvider,
  estimateEnrichCostUsd,
  planEnrichment,
  type EnrichParams,
  type EnrichPlan,
} from '../../jobs/enrich.js';
import { ENRICH_PROVIDERS, type EnrichProvider, type JobPreview } from '../../jobs/types.js';
import { httpError, idParam, nonEmptyQuery, readJson, readQuery } from '../http.js';
import { launchUnlessBlocked, withRunningBlocker } from '../jobs.js';
import type { AppEnv } from '../types.js';

/**
 * Enrichment on-demand (prospect, selezione, lista) — crm-foundation T10. Montato da `app.ts` con
 * `app.route('/api', enrichRoutes)`: dichiara le path assolute sotto `/api`. Ogni avvio ricalcola
 * la preview: con `blockers` non vuoti il job non parte (400 `code:'blocked'`).
 *
 * Provider (apollo-lookalike T10, SPEC G1–G3): `provider=apify|apollo` in query (preview) e nel body
 * (avvio) su tutte le forme; assente = `apify`, comportamento invariato.
 */
export const enrichRoutes = new Hono<AppEnv>();

const positiveInt = z.coerce.number().int().positive();
const MAX_IDS = 1000;
const provider = z.enum(ENRICH_PROVIDERS).optional();
const flags = { provider, onlyMissing: z.boolean().optional(), retryFailed: z.boolean().optional() };

type Options = { provider?: EnrichProvider; onlyMissing?: boolean; retryFailed?: boolean };

/**
 * Params salvati sul job: provider e flag sempre espliciti, così "Riprova" rifà esattamente la stessa
 * cosa. Con `apollo` `onlyMissing` è ignorato (P-7: chi ha un'email non si cerca mai) e si salva `true`.
 */
function jobParams(scope: { prospectIds: number[] } | { listId: number }, opts: Options): EnrichParams {
  const chosen = opts.provider ?? 'apify';
  return {
    ...scope,
    provider: chosen,
    onlyMissing: chosen === 'apollo' ? true : (opts.onlyMissing ?? true),
    retryFailed: opts.retryFailed ?? false,
  };
}

/** Apollo con 0 target: il job non parte vuoto (SPEC G3, FLOW D.2). Con Apify resta il warning (TD-3). */
const APOLLO_NO_TARGETS = 'Nessun profilo da cercare con queste opzioni.';

/**
 * Blocchi che impediscono l'avvio: configurazione (`configBlockers`) + nessun target con Apollo. Il
 * piano si ricalcola all'avvio se non è passato (lo stato dei prospect può essere cambiato).
 */
function startBlockers(params: EnrichParams, plan?: EnrichPlan): string[] {
  const blockers = configBlockers(params);
  if (enrichProvider(params) === 'apollo' && (plan ?? planEnrichment(params)).targets.length === 0) {
    blockers.push(APOLLO_NO_TARGETS);
  }
  return blockers;
}

/**
 * Preview dell'arricchimento: `unit_prices` = prezzo a persona per provider (`null` = non configurato), con
 * cui il radio Provider mostra il costo di entrambi senza una preview in più.
 */
export interface EnrichPreview extends JobPreview {
  unit_prices: Record<EnrichProvider, number | null>;
}

/** Preview uniforme (P7): conteggi del piano, stima o `null`, warning, blocchi (config + job in corso). */
function buildPreview(params: EnrichParams): EnrichPreview {
  const plan = planEnrichment(params);
  const targets = plan.targets.length;
  const chosen = enrichProvider(params);
  const apollo = chosen === 'apollo';
  const est = estimateEnrichCostUsd(targets, chosen);
  const warnings: string[] = [];
  if (apollo) {
    if (est === null) warnings.push('Prezzo del credito Apollo non configurato (APOLLO_CREDIT_USD): stima non disponibile.');
  } else {
    if (est === null) warnings.push('Prezzo per profilo non configurato (PRICE_PROFILE_DETAIL_USD): stima non disponibile.');
    if (plan.selected > 0 && targets === 0) warnings.push('Nessun profilo da arricchire con queste opzioni.');
  }

  const counts: Record<string, number> = apollo
    ? {
        selected: plan.selected,
        targets,
        skipped_with_email: plan.skipped_with_email,
        skipped_fresh: plan.skipped_fresh,
        not_found: plan.not_found,
        est_credits: targets,
      }
    : {
        selected: plan.selected,
        targets,
        skipped_enriched: plan.skipped_enriched,
        skipped_fresh: plan.skipped_fresh,
        not_found: plan.not_found,
      };
  const unit_prices = { apify: config.prices.profileDetailUsd, apollo: config.prices.apolloCreditUsd };
  return withRunningBlocker({ counts, est_cost_usd: est, warnings, blockers: startBlockers(params, plan), unit_prices });
}

/**
 * Avvio: 400 `{error, code:'blocked', blockers}` con i blocchi di configurazione (o, con Apollo, senza
 * target), altrimenti `launchJob` (202 `{job}`, o 409 `job_running` se c'è già un job in corso).
 */
function start(c: Context<AppEnv>, params: EnrichParams) {
  return launchUnlessBlocked(c, 'enrich', params, startBlockers(params), 'Arricchimento non avviato');
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
  provider,
  onlyMissing: z.stringbool().optional(),
  retryFailed: z.stringbool().optional(),
});

/**
 * `GET /api/enrich/preview?prospectIds=1,2|listId=3&provider=apify|apollo&onlyMissing=&retryFailed=`
 * (id anche ripetuti). Con `provider=apollo` i `counts` sono
 * `{selected, targets, skipped_with_email, skipped_fresh, not_found, est_credits}`. Con entrambi i provider
 * `unit_prices: {apify, apollo}`.
 */
enrichRoutes.get('/enrich/preview', (c) => {
  const raw = nonEmptyQuery(c);
  const ids = c.req.queries('prospectIds')?.filter((v) => v !== '');
  if (ids?.length) raw.prospectIds = ids.join(',');
  const { prospectIds, listId, ...opts } = readQuery(c, previewQuery, undefined, { raw });
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
