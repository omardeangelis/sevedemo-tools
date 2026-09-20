import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { listExists } from '../../db/lists.js';
import { db } from '../../db/index.js';
import { PERSON_NOT_FOUND_MESSAGE } from '../../db/people.js';
import {
  NO_LINKEDIN_ERROR,
  previewFromParams,
  startBlockers,
  type EnrichParams,
} from '../../jobs/enrich.js';
import { ENRICH_PROVIDERS, type EnrichProvider } from '../../jobs/types.js';
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
  return c.json(withRunningBlocker(previewFromParams(jobParams(scope, opts))));
});

// ---------------------------------------------------------------------------
// Avvio
// ---------------------------------------------------------------------------

const optionsSchema = z.object(flags).strict();

/** Singolo prospect (dettaglio): stesso job, ambito di un id. */
enrichRoutes.post('/prospects/:id/enrich', async (c) => {
  const id = idParam(c);
  const person = db.prepare('SELECT linkedin_url FROM prospects WHERE id = ?').get(id) as { linkedin_url: string | null } | undefined;
  if (!person) throw httpError(404, PERSON_NOT_FOUND_MESSAGE);
  if (person.linkedin_url === null) throw httpError(409, NO_LINKEDIN_ERROR, { code: 'no_linkedin' });
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
