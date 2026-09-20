import fs from 'node:fs';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { config, ROOT } from '../config.js';
import { db } from '../db/index.js';
import { fillMissingRunTools } from '../db/schema.js';
import { createApp } from './app.js';
import { reconcileRunning } from './jobs.js';

// Run creati prima degli strumenti (people-first-crm P-28): senza questo mancherebbero da Connessioni.
// Idempotente e silenzioso quando non c'è niente da riempire; nessuna ricostruzione, nessun backup.
const filled = fillMissingRunTools(db);
if (filled > 0) console.log(`Strumenti assegnati a ${filled} run (creati prima di questa versione).`);
// Job e analisi singole rimasti `running` da un'esecuzione precedente (P-13): chiusi subito come falliti.
reconcileRunning();

const app = createApp();

// In produzione (dopo `npm run ui:build`) serve la SPA da web/dist; in dev ci pensa Vite.
const webDist = path.join(ROOT, 'web', 'dist');
if (fs.existsSync(webDist)) {
  const relDist = path.relative(process.cwd(), webDist);
  app.use('*', serveStatic({ root: relDist }));
  // Fallback SPA solo fuori da /api: le path API inesistenti restano 404 JSON.
  app.get('*', (c, next) =>
    c.req.path.startsWith('/api') ? next() : c.html(fs.readFileSync(path.join(webDist, 'index.html'), 'utf8')),
  );
}

const port = Number.parseInt(process.env.UI_PORT ?? '8787', 10);
serve(
  {
    fetch: app.fetch,
    port,
    // L'analisi singola sincrona con `enrichFirst` può durare fino a ~210 s (PLAN T11).
    serverOptions: { requestTimeout: 300_000 },
  },
  (info) => {
    console.log(`API CRM prospecting su http://localhost:${info.port} (db: ${config.paths.db})`);
    if (!fs.existsSync(webDist)) {
      console.log('Frontend: avvia `npm run ui` (dev) oppure builda con `npm run ui:build`.');
    }
  },
);
