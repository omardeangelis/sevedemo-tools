import { Hono } from 'hono';
import { z } from 'zod';
import { getReadiness, getSettings, updateSettings } from '../../db/settings.js';
import { normalizeProfileUrl } from '../../util/fields.js';
import { httpError, readJson } from '../http.js';
import type { AppEnv } from '../types.js';

/**
 * Impostazioni (profilo, azienda, readiness) — crm-foundation T4.
 * Montato da `app.ts` con `app.route('/api', settingsRoutes)`: dichiara le path assolute
 * sotto `/api` (es. `/settings` → `/api/settings`).
 */
export const settingsRoutes = new Hono<AppEnv>();

const value = z.string().nullable().optional();

/** PUT parziale: le chiavi assenti restano invariate; `''`/`null` le svuota. */
const SettingsBody = z
  .object({ own_profile_url: value, company_name: value, company_description: value, company_offering: value })
  .strict();

const settingsPayload = () => ({ ...getSettings(), readiness: getReadiness() });

settingsRoutes.get('/settings', (c) => c.json(settingsPayload()));

settingsRoutes.put('/settings', async (c) => {
  const body = await readJson(c, SettingsBody);
  const rawUrl = body.own_profile_url?.trim();
  if (rawUrl) {
    const url = normalizeProfileUrl(rawUrl);
    if (!url) {
      throw httpError(400, "Inserisci l'URL pubblico del tuo profilo, es. https://www.linkedin.com/in/tuo-nome/", {
        code: 'invalid_profile_url',
      });
    }
    body.own_profile_url = url;
  }
  updateSettings(body);
  return c.json(settingsPayload());
});
