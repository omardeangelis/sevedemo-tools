/**
 * Server di smoke per validare la UI senza pipeline reale (~2 $ a run):
 * DB scratch in tmp, exports scratch e job finto che simula il run daily.
 *
 *   npx tsx scripts/ui-smoke-server.ts                          → succeeded dopo 20s
 *   FAKE_JOB_SECONDS=5 FAKE_JOB_OUTCOME=failed npx tsx ...      → failed dopo 5s
 *
 * Dati demo nello stesso DB: DB_PATH=<path stampato> npm run seed:demo
 * Ogni richiesta a /api/pipeline/status è loggata con timestamp, per
 * osservare la cadenza di polling della UI (15s a riposo, 2.5s in run).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const scratchDir = path.join(os.tmpdir(), 'sevedemo-ui-smoke');
fs.mkdirSync(scratchDir, { recursive: true });
process.env.DB_PATH ??= path.join(scratchDir, 'smoke.db');
const exportsDir = path.join(scratchDir, 'exports');
fs.mkdirSync(exportsDir, { recursive: true });

const seconds = Number(process.env.FAKE_JOB_SECONDS ?? '20');
const outcome = process.env.FAKE_JOB_OUTCOME === 'failed' ? 'failed' : 'succeeded';

// Import dinamici: la config legge DB_PATH a import-time.
const { serve } = await import('@hono/node-server');
const { createApp } = await import('../src/server/app.js');
const { JOB_KV_KEY } = await import('../src/server/jobs.js');

const patch =
  outcome === 'failed'
    ? {
        state: 'failed',
        error:
          'Errore simulato: APIFY_TOKEN mancante. Copia .env.example in .env e inserisci il token Apify.',
      }
    : { state: 'succeeded' };

// Come il wrapper reale: legge il record corrente e scrive lo stato terminale.
const childScript = `
  setTimeout(() => {
    const Database = require('better-sqlite3');
    const db = new Database(process.env.DB_PATH);
    const key = ${JSON.stringify(JOB_KV_KEY)};
    const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
    const current = row ? JSON.parse(row.value) : {};
    const next = Object.assign({}, current, ${JSON.stringify(patch)}, { finished_at: new Date().toISOString() });
    db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(next));
    db.close();
  }, ${Math.round(seconds * 1000)});
`;

const app = createApp({
  job: { command: process.execPath, args: ['-e', childScript] },
  erase: { exportsDir },
});

const port = Number.parseInt(process.env.UI_PORT ?? '8787', 10);
serve(
  {
    fetch: (req: Request) => {
      if (new URL(req.url).pathname === '/api/pipeline/status') {
        console.log(`[smoke] ${new Date().toISOString()} GET /api/pipeline/status`);
      }
      return app.fetch(req);
    },
    port,
  },
  (info) => {
    console.log(`[smoke] API su http://localhost:${info.port}`);
    console.log(`[smoke] DB scratch: ${process.env.DB_PATH}`);
    console.log(`[smoke] exports scratch: ${exportsDir}`);
    console.log(`[smoke] job finto: ${outcome} dopo ${seconds}s`);
  },
);
