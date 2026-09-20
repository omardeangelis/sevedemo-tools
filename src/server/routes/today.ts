import { Hono } from 'hono';
import { z } from 'zod';
import { getToday } from '../../db/today.js';
import { calendarDate, readQuery } from '../http.js';
import type { AppEnv } from '../types.js';

/**
 * Oggi, la home (people-first-crm H1–H8, T25): `GET /api/today?today=YYYY-MM-DD` → `{empty, due, upcoming,
 * to_triage, recent, setup_missing, failed_runs}`. `today` = oggi dell'utente (default: data locale del server).
 */
export const todayRoutes = new Hono<AppEnv>();

const query = z.object({ today: calendarDate.optional() });

todayRoutes.get('/today', (c) => c.json(getToday(readQuery(c, query, 'Data di oggi non valida (AAAA-MM-GG).').today)));
