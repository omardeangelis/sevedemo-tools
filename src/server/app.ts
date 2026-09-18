import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { config } from '../config.js';
import type { AppEnv, AppOptions } from './types.js';
import { analyzeRoutes } from './routes/analyze.js';
import { candidatesRoutes } from './routes/candidates.js';
import { companiesRoutes } from './routes/companies.js';
import { contactsRoutes } from './routes/contacts.js';
import { enrichCompaniesRoutes } from './routes/enrich-companies.js';
import { enrichRoutes } from './routes/enrich.js';
import { exportsRoutes } from './routes/exports.js';
import { icpsRoutes } from './routes/icps.js';
import { jobsRoutes } from './routes/jobs.js';
import { listsRoutes } from './routes/lists.js';
import { lookalikeRoutes } from './routes/lookalike.js';
import { prospectsRoutes } from './routes/prospects.js';
import { settingsRoutes } from './routes/settings.js';
import { syncRoutes } from './routes/sync.js';

/**
 * API del CRM. Monta una volta per tutte i router di `server/routes/` sotto `/api`
 * (regola anti co-edit, PLAN §8: da qui in avanti ogni task edita solo il proprio
 * router, mai questo file). Le `opts` arrivano ai router via `c.get('opts')`.
 */
export function createApp(opts: AppOptions = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Prima dei router: il middleware vale solo per le route registrate dopo.
  app.use('*', async (c, next) => {
    c.set('opts', opts);
    await next();
  });

  app.get('/api/health', (c) => c.json({ ok: true, db: config.paths.db }));

  app.route('/api', settingsRoutes);
  app.route('/api', icpsRoutes);
  app.route('/api', companiesRoutes);
  app.route('/api', listsRoutes);
  app.route('/api', prospectsRoutes);
  app.route('/api', jobsRoutes);
  app.route('/api', syncRoutes);
  app.route('/api', enrichRoutes);
  app.route('/api', analyzeRoutes);
  app.route('/api', exportsRoutes);
  // apollo-lookalike T5: solo path specifiche (`/icps/:id/<azione>…`, `/companies/:id/<azione>…`),
  // nessuna sovrapposizione con le route di ICP e aziende montate sopra.
  app.route('/api', enrichCompaniesRoutes);
  app.route('/api', lookalikeRoutes);
  app.route('/api', contactsRoutes);
  app.route('/api', candidatesRoutes);

  app.notFound((c) =>
    c.req.path.startsWith('/api') ? c.json({ error: 'Endpoint inesistente.' }, 404) : c.text('Not found', 404),
  );
  // Errori non gestiti dai router: JSON `{error}` (il client web legge quel campo).
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    console.error(err);
    return c.json({ error: err.message || 'Errore interno.' }, 500);
  });

  return app;
}
