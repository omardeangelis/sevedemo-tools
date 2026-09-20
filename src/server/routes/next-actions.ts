import { Hono } from 'hono';
import { z } from 'zod';
import { changeNextAction, completeNextAction, type NextActionOutcome } from '../../db/next-actions.js';
import { DATE_REQUIRED_MESSAGE } from '../../db/people.js';
import { calendarDate, httpError, idParam, readJson, readOptionalJson } from '../http.js';
import type { AppEnv } from '../types.js';
import { requireProspect } from './prospects.js';

/**
 * Prossima azione della persona (people-first-crm G1–G6): imposta, modifica, **Rimanda** (PUT con la nuova data),
 * rimuove, **Fatto**. `expectedSetAt` = `next_action_set_at` letto dal client (`null` = non ce n'era): se nel
 * frattempo è cambiata → 409 `next_action_changed` e nulla cambia. Assente = nessun controllo (M1).
 */
export const nextActionsRoutes = new Hono<AppEnv>();


const CHANGED = 'La prossima azione è già stata completata o cambiata.';

const expectedSetAt = z.string().max(40).nullable().optional();

const setSchema = z
  .object({
    on: calendarDate.nullable().optional(),
    text: z.string().max(500).nullable().optional(),
    expectedSetAt,
  })
  .strict();

/** Esito → risposta: 404 persona, 409 `next_action_changed`, altrimenti il dettaglio aggiornato. */
function respond(id: number, outcome: NextActionOutcome) {
  if (outcome === 'changed') throw httpError(409, CHANGED, { code: 'next_action_changed' });
  return requireProspect(id);
}

nextActionsRoutes.put('/prospects/:id/next-action', async (c) => {
  const id = idParam(c);
  const body = await readJson(c, setSchema);
  if (!body.on) throw httpError(400, DATE_REQUIRED_MESSAGE, { code: 'next_action_date_required' });
  return c.json(respond(id, changeNextAction(id, { on: body.on, text: body.text }, body.expectedSetAt)));
});

const deleteSchema = z.object({ expectedSetAt }).strict();

nextActionsRoutes.delete('/prospects/:id/next-action', async (c) => {
  const id = idParam(c);
  const body = await readOptionalJson(c, deleteSchema);
  return c.json(respond(id, changeNextAction(id, null, body.expectedSetAt)));
});

const doneSchema = z.object({ expectedSetAt: z.string().max(40) }).strict();

/** **Fatto** (G4): toglie la prossima azione e scrive "Prossima azione completata" in timeline. */
nextActionsRoutes.post('/prospects/:id/next-action/done', async (c) => {
  const id = idParam(c);
  const body = await readJson(c, doneSchema);
  return c.json(respond(id, completeNextAction(id, body.expectedSetAt)));
});
