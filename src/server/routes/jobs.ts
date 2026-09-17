import { Hono } from 'hono';
import { httpError, idParam } from '../http.js';
import { getCurrentJob, getJob, jobHttpError, listJobs, retryJob } from '../jobs.js';
import type { AppEnv } from '../types.js';

/**
 * Job (corrente, storico, retry) — crm-foundation T6. Montato da `app.ts` con
 * `app.route('/api', jobsRoutes)`: le path sono assolute sotto `/api`. L'avvio dei
 * singoli kind sta nei router dei task proprietari (`launchJob` di `server/jobs.ts`).
 */
export const jobsRoutes = new Hono<AppEnv>();

// Per il JobBanner: il job in corso, altrimenti l'ultimo terminato (`null` se mai lanciato).
jobsRoutes.get('/jobs/current', (c) => c.json({ job: getCurrentJob() }));

jobsRoutes.get('/jobs', (c) => {
  const raw = c.req.query('limit');
  return c.json({ items: listJobs(raw ? Number(raw) : 20) });
});

jobsRoutes.get('/jobs/:id', (c) => {
  const job = getJob(idParam(c));
  if (!job) throw httpError(404, 'Job inesistente.');
  return c.json(job);
});

jobsRoutes.post('/jobs/:id/retry', (c) => {
  try {
    const job = retryJob(idParam(c), c.get('opts')?.jobs);
    return c.json({ job }, 202);
  } catch (err) {
    throw jobHttpError(err);
  }
});
