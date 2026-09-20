import { Hono } from 'hono';
import { searchAll } from '../../db/search.js';
import type { AppEnv } from '../types.js';

/**
 * Ricerca globale di ⌘K (people-first-crm I2–I3, T21): `GET /api/search?q` → `{people, people_total, companies,
 * companies_total}`, al più 5 per gruppo; sotto i 2 caratteri liste vuote.
 */
export const searchRoutes = new Hono<AppEnv>();

searchRoutes.get('/search', (c) => c.json(searchAll(c.req.query('q'))));
