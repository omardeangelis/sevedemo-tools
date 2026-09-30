import { Hono } from 'hono';
import { z } from 'zod';
import {
  createService,
  deleteService,
  listServices,
  reorderServices,
  ServiceNameTakenError,
  updateService,
} from '../../db/services.js';
import { httpError, idParam, readJson } from '../http.js';
import type { AppEnv } from '../types.js';

/**
 * Servizi dell'utente, scritti a mano (own-profile-services T8: B2, B3, B4, B10).
 * Montato da `app.ts` con `app.route('/api', servicesRoutes)`: path assolute sotto `/api`.
 */
export const servicesRoutes = new Hono<AppEnv>();

const text = z.string().nullable().optional();

/** B2: solo il nome è obbligatorio, nessuna validazione in più (PLAN §9). */
const ServiceFields = z.object({
  name: z.string().trim().min(1, 'Inserisci il nome del servizio.'),
  description: text,
  audience: text,
  problem: text,
  proof: text,
  notes: text,
});

/** Scrittura del repo con il 409 `service_exists` e il nome già presente nel messaggio (B10, FLOW). */
function withNameCheck<T>(write: () => T): T {
  try {
    return write();
  } catch (err) {
    if (err instanceof ServiceNameTakenError) {
      throw httpError(409, err.message, { code: err.code, service: { id: err.existing.id, name: err.existing.name } });
    }
    throw err;
  }
}

const notFound = () => httpError(404, 'Servizio non trovato: potrebbe essere stato eliminato.');

servicesRoutes.get('/services', (c) => c.json({ items: listServices() }));

const OrderBody = z
  .object({
    ids: z
      .array(z.number().int().positive())
      .refine((ids) => new Set(ids).size === ids.length, 'Lo stesso servizio compare due volte.'),
  })
  .strict();

servicesRoutes.put('/services/order', async (c) => {
  const { ids } = await readJson(c, OrderBody);
  return c.json({ items: reorderServices(ids) });
});

servicesRoutes.post('/services', async (c) => {
  const body = await readJson(c, ServiceFields.strict());
  return c.json(withNameCheck(() => createService(body)), 201);
});

servicesRoutes.patch('/services/:id', async (c) => {
  const id = idParam(c);
  const body = await readJson(c, ServiceFields.partial().strict());
  const service = withNameCheck(() => updateService(id, body));
  if (!service) throw notFound();
  return c.json(service);
});

servicesRoutes.delete('/services/:id', (c) => {
  if (!deleteService(idParam(c))) throw notFound();
  return c.json({ ok: true });
});
