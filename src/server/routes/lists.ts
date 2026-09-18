import { Hono } from 'hono';
import { z } from 'zod';
import { addMembers, createList, getList, listExists, listLists, removeMembers, updateList } from '../../db/lists.js';
import { IDS_CAP, idsByFilters } from '../../db/prospects.js';
import { httpError, idParam, readJson } from '../http.js';
import type { AppEnv } from '../types.js';
import { readProspectQuery, runQuery } from './prospects.js';

/**
 * Liste e membership (crm-foundation T5). Montato da `app.ts` con `app.route('/api', listsRoutes)`:
 * path assolute sotto `/api`. I membri come tabella si leggono da `GET /api/prospects?listId=`.
 * Le azioni job sulla lista (`/lists/:id/enrich|analyze|exports`) vivono nei router di T10–T12.
 */
export const listsRoutes = new Hono<AppEnv>();

const positiveInt = z.coerce.number().int().positive();
const name = z.string().trim().min(1, 'Il nome è obbligatorio.').max(200);
const description = z.string().max(2000).nullable().optional();

listsRoutes.get('/lists', (c) => {
  const raw = c.req.query('includeArchived');
  const includeArchived = raw === '1' || raw === 'true';
  return c.json({ items: listLists({ includeArchived }) });
});

const createSchema = z.object({ icpId: positiveInt, name, description }).strict();

listsRoutes.post('/lists', async (c) => {
  const body = await readJson(c, createSchema);
  const list = createList(body);
  if (!list) throw httpError(400, 'ICP inesistente.', { code: 'icp_not_found' });
  return c.json(list, 201);
});

listsRoutes.get('/lists/:id', (c) => {
  const list = getList(idParam(c));
  if (!list) throw httpError(404, 'Lista non trovata.');
  return c.json(list);
});

const patchSchema = z.object({ name: name.optional(), description, archived: z.boolean().optional() }).strict();

listsRoutes.patch('/lists/:id', async (c) => {
  const id = idParam(c);
  const body = await readJson(c, patchSchema);
  const list = updateList(id, body);
  if (!list) throw httpError(404, 'Lista non trovata.');
  return c.json(list);
});

function requireList(id: number): void {
  if (!listExists(id)) throw httpError(404, 'Lista non trovata.');
}

listsRoutes.get('/lists/:id/members/ids', (c) => {
  const id = idParam(c);
  requireList(id);
  const query = readProspectQuery(c);
  return c.json(runQuery(() => idsByFilters({ ...query, listId: id, inbox: false }, IDS_CAP)));
});

const membersSchema = z.object({ prospectIds: z.array(positiveInt).min(1).max(1000) }).strict();

listsRoutes.post('/lists/:id/members', async (c) => {
  const id = idParam(c);
  const body = await readJson(c, membersSchema);
  requireList(id);
  return c.json(addMembers(id, body.prospectIds));
});

listsRoutes.delete('/lists/:id/members', async (c) => {
  const id = idParam(c);
  const body = await readJson(c, membersSchema);
  requireList(id);
  return c.json({ ok: true, ...removeMembers(id, body.prospectIds) });
});
