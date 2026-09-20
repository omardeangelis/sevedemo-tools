import { Hono } from 'hono';
import { z } from 'zod';
import { removeManualFit, setManualFit, type FitWriteResult } from '../../db/fits.js';
import { PERSON_NOT_FOUND_MESSAGE } from '../../db/people.js';
import { FIT_LEVELS } from '../../db/schema.js';
import { httpError, idParam, readJson } from '../http.js';
import type { AppEnv } from '../types.js';

/**
 * Fit manuale per ICP (people-first-crm F1–F7, T19): `PUT` imposta o cambia, `DELETE` rimuove; entrambi
 * rispondono 200 `{fit_state, fit_origin, manual_fit}` (fit effettivo dopo la scrittura) e scrivono una voce
 * `fit_change` in timeline. 404 persona o ICP.
 */
export const fitsRoutes = new Hono<AppEnv>();

const FIT_TEXT = 'Scegli alto, medio o basso.';

const setSchema = z
  .object({
    fit: z.enum(FIT_LEVELS, { error: FIT_TEXT }),
    reason: z.string().max(2000).nullable().optional(),
  })
  .strict();

function outcome(result: FitWriteResult | { missing: 'person' | 'icp' }): FitWriteResult {
  if ('missing' in result) throw httpError(404, result.missing === 'person' ? PERSON_NOT_FOUND_MESSAGE : 'ICP non trovato.');
  return result;
}

fitsRoutes.put('/prospects/:id/fits/:icpId', async (c) => {
  const id = idParam(c);
  const icpId = idParam(c, 'icpId');
  const body = await readJson(c, setSchema);
  return c.json(outcome(setManualFit(id, icpId, body)));
});

fitsRoutes.delete('/prospects/:id/fits/:icpId', (c) => c.json(outcome(removeManualFit(idParam(c), idParam(c, 'icpId')))));
