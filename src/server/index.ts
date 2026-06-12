import fs from 'node:fs';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { config, ROOT } from '../config.js';
import { createApp } from './app.js';

const app = createApp();

// In produzione (dopo `npm run ui:build`) serve la SPA da web/dist; in dev ci pensa Vite.
const webDist = path.join(ROOT, 'web', 'dist');
if (fs.existsSync(webDist)) {
  const relDist = path.relative(process.cwd(), webDist);
  app.use('*', serveStatic({ root: relDist }));
  app.get('*', (c) => c.html(fs.readFileSync(path.join(webDist, 'index.html'), 'utf8')));
}

const port = Number.parseInt(process.env.UI_PORT ?? '8787', 10);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API Lead Engine su http://localhost:${info.port} (db: ${config.paths.db})`);
  if (!fs.existsSync(webDist)) {
    console.log('Frontend: avvia `npm run ui` (dev) oppure builda con `npm run ui:build`.');
  }
});
