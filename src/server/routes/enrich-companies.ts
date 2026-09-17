import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { planEnrichCompanies, type EnrichCompaniesScope } from '../../jobs/enrich-companies.js';
import { httpError, idParam, readJson } from '../http.js';
import { launchJob, runningJobBlocker } from '../jobs.js';
import type { AppEnv } from '../types.js';

/**
 * Arricchimento Apollo delle aziende: referenze di un ICP o singola azienda (SPEC C, PLAN T7c, §12).
 * Montato da `app.ts` con `app.route('/api', enrichCompaniesRoutes)`: path assolute sotto `/api`.
 * Ogni avvio ricalcola la preview e congela nei `params` le aziende da arricchire in quel momento
 * (`{companyIds, icpId?, retryNotFound}`): con blocker il job non parte (400 `code:'blocked'`), con un
 * job in corso risponde `launchJob` (409 `job_running`).
 */
export const enrichCompaniesRoutes = new Hono<AppEnv>();

const previewQuery = z.object({ retryNotFound: z.stringbool().optional() }).strict();
const startBody = z.object({ retryNotFound: z.boolean().optional() }).strict();

/** Query della preview: solo `retryNotFound` (`true`/`false`, vuoto = assente); altro → 400. */
function readPreviewQuery(c: Context<AppEnv>): { retryNotFound?: boolean } {
  const raw = Object.fromEntries(Object.entries(c.req.query()).filter(([, v]) => v !== ''));
  const parsed = previewQuery.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw httpError(400, 'Parametri della preview non validi.', { issues });
  }
  return parsed.data;
}

/** Body facoltativo (`POST` senza body = default); se presente va validato. */
async function readOptionalBody(c: Context<AppEnv>): Promise<{ retryNotFound?: boolean }> {
  if ((await c.req.text()).trim() === '') return {};
  return readJson(c, startBody);
}

function notFoundText(scope: EnrichCompaniesScope): string {
  return scope.icpId !== undefined ? 'ICP non trovato.' : 'Azienda non trovata.';
}

function preview(c: Context<AppEnv>, scope: EnrichCompaniesScope) {
  const { retryNotFound } = readPreviewQuery(c);
  const plan = planEnrichCompanies(scope, { retryNotFound, runningBlocker: runningJobBlocker() });
  if (!plan) throw httpError(404, notFoundText(scope));
  return c.json(plan.preview);
}

async function start(c: Context<AppEnv>, scope: EnrichCompaniesScope) {
  const { retryNotFound } = await readOptionalBody(c);
  const plan = planEnrichCompanies(scope, { retryNotFound });
  if (!plan) throw httpError(404, notFoundText(scope));
  if (plan.startBlockers.length > 0) {
    throw httpError(400, `Arricchimento non avviato: ${plan.startBlockers.join(' ')}`, {
      code: 'blocked',
      blockers: plan.startBlockers,
    });
  }
  return launchJob(c, 'enrich_companies', plan.params);
}

/** `GET /api/icps/:id/enrich-companies/preview?retryNotFound=` — referenze dell'ICP (SPEC C1/C2). */
enrichCompaniesRoutes.get('/icps/:id/enrich-companies/preview', (c) => preview(c, { icpId: idParam(c) }));

/** `POST /api/icps/:id/enrich-companies {retryNotFound?}` → 202 `{job}` | 400 `blocked` | 404 | 409. */
enrichCompaniesRoutes.post('/icps/:id/enrich-companies', (c) => start(c, { icpId: idParam(c) }));

/** `GET /api/companies/:id/enrich-apollo/preview?retryNotFound=` — singola azienda dal dettaglio (SPEC C4). */
enrichCompaniesRoutes.get('/companies/:id/enrich-apollo/preview', (c) => preview(c, { companyId: idParam(c) }));

/** `POST /api/companies/:id/enrich-apollo {retryNotFound?}` → 202 `{job}` | 400 `blocked` | 404 | 409. */
enrichCompaniesRoutes.post('/companies/:id/enrich-apollo', (c) => start(c, { companyId: idParam(c) }));
