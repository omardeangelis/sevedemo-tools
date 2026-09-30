import { Hono } from 'hono';
import { getProfile } from '../../db/profile.js';
import type { AppEnv } from '../types.js';

/**
 * Il profilo dell'utente in una lettura sola (own-profile-services T9, B7): profilo, servizi in ordine,
 * provenienza di ogni valore, record Apollo. Le scritture passano da `PUT /api/settings` e `/api/services`.
 * Montato da `app.ts` con `app.route('/api', profileRoutes)`: path assolute sotto `/api`.
 */
export const profileRoutes = new Hono<AppEnv>();

profileRoutes.get('/profile', (c) => c.json(getProfile()));
