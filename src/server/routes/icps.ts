import { Hono } from 'hono';
import { z } from 'zod';
import { getCompany, withoutApolloJson, type CompanySummary } from '../../db/companies.js';
import {
  countIcpLists,
  createIcp,
  deleteIcp,
  getIcp,
  getIcpDetail,
  listIcps,
  removeReferenceCompany,
  setReferenceCompany,
  updateIcp,
  type ReferenceCompany,
} from '../../db/icps.js';
import { REFERENCE_OUTCOMES } from '../../db/schema.js';
import { httpError, idParam, readJson } from '../http.js';
import type { AppEnv } from '../types.js';

/**
 * ICP e aziende di riferimento (crm-foundation T4).
 * Montato da `app.ts` con `app.route('/api', icpsRoutes)`: dichiara le path assolute
 * sotto `/api` (es. `/icps/:id` → `/api/icps/:id`).
 */
export const icpsRoutes = new Hono<AppEnv>();

const text = z.string().nullable().optional();
const list = z.array(z.string()).optional();

const IcpFields = z.object({
  name: z.string().trim().min(1, 'Il nome è obbligatorio.'),
  description: text,
  target_roles: list,
  target_industries: list,
  target_locations: list,
  company_size: text,
  pains: text,
  notes: text,
});

/** Riferimento per il browser: l'azienda senza `apollo_json` (i job lo leggono da `listReferenceCompanies`). */
function referencePayload<R extends ReferenceCompany>(reference: R): Omit<R, 'company'> & { company: CompanySummary } {
  return { ...reference, company: withoutApolloJson(reference.company) };
}

function icpOr404(id: number) {
  const icp = getIcpDetail(id);
  if (!icp) throw httpError(404, 'ICP non trovato.');
  return { ...icp, reference_companies: icp.reference_companies.map(referencePayload) };
}

icpsRoutes.get('/icps', (c) => c.json({ items: listIcps() }));

icpsRoutes.post('/icps', async (c) => {
  const body = await readJson(c, IcpFields.strict());
  const icp = createIcp(body);
  return c.json(icpOr404(icp.id), 201);
});

icpsRoutes.get('/icps/:id', (c) => c.json(icpOr404(idParam(c))));

icpsRoutes.patch('/icps/:id', async (c) => {
  const id = idParam(c);
  const body = await readJson(c, IcpFields.partial().strict());
  if (!updateIcp(id, body)) throw httpError(404, 'ICP non trovato.');
  return c.json(icpOr404(id));
});

/** 409 se l'ICP ha liste (anche archiviate): la FK `lists.icp_id` è RESTRICT. */
function icpHasLists(n: number) {
  return httpError(409, `Impossibile eliminare l'ICP: ha ${n} ${n === 1 ? 'lista' : 'liste'} (contano anche le archiviate).`, {
    code: 'icp_has_lists',
    lists_count: n,
  });
}

icpsRoutes.delete('/icps/:id', (c) => {
  const id = idParam(c);
  if (!getIcp(id)) throw httpError(404, 'ICP non trovato.');
  const lists = countIcpLists(id);
  if (lists > 0) throw icpHasLists(lists);
  try {
    deleteIcp(id);
  } catch (err) {
    // Race con una lista creata nel frattempo: RESTRICT fallisce come vincolo di trigger.
    const code = (err as { code?: string }).code;
    if (code === 'SQLITE_CONSTRAINT_TRIGGER' || code === 'SQLITE_CONSTRAINT_FOREIGNKEY') throw icpHasLists(countIcpLists(id));
    throw err;
  }
  return c.json({ ok: true });
});

const ReferenceBody = z
  .object({ outcome: z.enum(REFERENCE_OUTCOMES).optional(), notes: z.string().nullable().optional() })
  .strict();

icpsRoutes.put('/icps/:id/reference-companies/:companyId', async (c) => {
  const icpId = idParam(c);
  const companyId = idParam(c, 'companyId');
  const body = await readJson(c, ReferenceBody);
  if (!getIcp(icpId)) throw httpError(404, 'ICP non trovato.');
  if (!getCompany(companyId)) throw httpError(404, 'Azienda non trovata.');
  return c.json(referencePayload(setReferenceCompany(icpId, companyId, body)));
});

icpsRoutes.delete('/icps/:id/reference-companies/:companyId', (c) => {
  const icpId = idParam(c);
  const companyId = idParam(c, 'companyId');
  if (!removeReferenceCompany(icpId, companyId)) {
    throw httpError(404, "L'azienda non è tra i riferimenti di questo ICP.");
  }
  return c.json({ ok: true });
});
