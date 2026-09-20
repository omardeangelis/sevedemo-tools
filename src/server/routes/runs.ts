import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import { connections, readRunLog, runDetail, runsOfTool } from '../../db/runs.js';
import { isToolId } from '../../runs/tools.js';
import { httpError, idParam, readQuery } from '../http.js';
import { getJob } from '../jobs.js';
import type { AppEnv } from '../types.js';

/**
 * Connessioni, run e log (people-first-crm SPEC J2–J11, T28 e T30):
 * `GET /api/connections` (uno stato per strumento) · `GET /api/connections/:tool/runs?outcome&page` (i run
 * dello strumento, dal più recente, con il filtro Falliti) · `GET /api/runs/:id` (dettaglio) ·
 * `GET /api/runs/:id/log?after` (righe nuove dal `seq` già visto).
 * Chiavi API mai nelle risposte: `db/runs.ts` ripulisce errore, riassunto e warning (J10).
 */
export const runsRoutes = new Hono<AppEnv>();

const DEFAULT_PAGE_SIZE = 20;

const runsQuery = z.object({
  outcome: z.enum(['all', 'failed']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

const logQuery = z.object({ after: z.coerce.number().int().min(0).optional() });

runsRoutes.get('/connections', (c) => c.json({ items: connections() }));

runsRoutes.get('/connections/:tool/runs', (c) => {
  const tool = c.req.param('tool');
  if (!isToolId(tool)) throw httpError(404, 'Strumento non trovato.');
  const { outcome, page, pageSize } = readQuery(c, runsQuery, 'Parametri dei run non validi.');
  return c.json(
    runsOfTool(tool, { failedOnly: outcome === 'failed', page: page ?? 1, pageSize: pageSize ?? DEFAULT_PAGE_SIZE }),
  );
});

/** Riga `jobs` di un run, riconciliata: un run rimasto `running` senza processo risulta fallito. */
function run(c: Context<AppEnv>) {
  const id = idParam(c);
  const job = getJob(id);
  if (!job) throw httpError(404, 'Run non trovato.');
  return job;
}

runsRoutes.get('/runs/:id', (c) => c.json(runDetail(run(c))));

runsRoutes.get('/runs/:id/log', (c) => {
  const job = run(c);
  const { after } = readQuery(c, logQuery, 'Parametri del log non validi.');
  return c.json({ ...readRunLog(job.id, after ?? 0), logged: job.logged === 1, state: job.state });
});
