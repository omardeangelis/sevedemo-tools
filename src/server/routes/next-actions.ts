import { Hono } from 'hono';
import { z } from 'zod';
import { clearNextAction, setNextAction } from '../../db/next-actions.js';
import { calendarDate, httpError, idParam, readJson } from '../http.js';
import type { AppEnv } from '../types.js';
import { requireProspect } from './prospects.js';

/** Prossima azione della persona (people-first-crm G1–G6): imposta, modifica, rimuove. */
export const nextActionsRoutes = new Hono<AppEnv>();

const DATE_REQUIRED = 'Scegli la data della prossima azione.';

const setSchema = z
  .object({
    on: calendarDate.nullable().optional(),
    text: z.string().max(500).nullable().optional(),
  })
  .strict();

nextActionsRoutes.put('/prospects/:id/next-action', async (c) => {
  const id = idParam(c);
  const body = await readJson(c, setSchema);
  if (!body.on) throw httpError(400, DATE_REQUIRED, { code: 'next_action_date_required' });
  if (!setNextAction(id, { on: body.on, text: body.text })) requireProspect(id);
  return c.json(requireProspect(id));
});

nextActionsRoutes.delete('/prospects/:id/next-action', (c) => {
  const id = idParam(c);
  if (!clearNextAction(id)) requireProspect(id);
  return c.json(requireProspect(id));
});
