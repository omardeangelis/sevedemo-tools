/**
 * Server e2e del CRM (crm-foundation T20): l'API reale su un DB scratch, con i job che girano
 * davvero (processo figlio, mapper, DB) ma su deps fixture-backed (`E2E_FAKE_JOBS=1`, niente Apify
 * né Claude). Serve a validare il frontend con agent-browser. Guida: `tests/e2e/README.md`.
 *
 *   npm run e2e:server                     → http://localhost:8790, DB in tmp azzerato all'avvio
 *   UI_PORT=8802 npm run e2e:server        → altra porta (e altro DB: uno per porta)
 *   E2E_NO_APIFY=1 / E2E_NO_ANTHROPIC=1 / E2E_NO_APOLLO=1 → token assenti (blocchi nelle preview)
 *
 * Il `.env` NON viene letto (config deterministica, chiavi reali mai usate): l'ambiente va
 * preparato qui sotto PRIMA di importare qualunque modulo che legga `config` a import-time.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number.parseInt(process.env.UI_PORT ?? '8790', 10);

// --- DB scratch: mai i dati reali in data/ (il reset li cancellerebbe) ---
const dbPath = path.resolve(process.env.DB_PATH || path.join(os.tmpdir(), `crm-e2e-${port}`, 'crm.db'));
const real = (p: string) => (fs.existsSync(p) ? fs.realpathSync(p) : p);
const dataDirs = [path.join(root, 'data'), real(path.join(root, 'data'))];
const dbDir = path.dirname(dbPath);
const insideData = [dbDir, real(dbDir)].some((dir) => dataDirs.some((data) => dir === data || dir.startsWith(data + path.sep)));
if (insideData) {
  console.error(`[e2e] Rifiuto di partire: DB_PATH punta ai dati reali (${dbPath}). Usa un file scratch fuori da data/.`);
  process.exit(1);
}
for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
fs.mkdirSync(dbDir, { recursive: true });

// --- Ambiente del server e dei processi figli dei job (lo ereditano da `process.env`) ---
process.env.DB_PATH = dbPath;
process.env.E2E_FAKE_JOBS = '1';
process.env.DOTENV_CONFIG_PATH = os.devNull;
process.env.DOTENV_CONFIG_QUIET = 'true';
process.env.APIFY_TOKEN = process.env.E2E_NO_APIFY === '1' ? '' : 'e2e-fake-apify-token';
process.env.ANTHROPIC_API_KEY = process.env.E2E_NO_ANTHROPIC === '1' ? '' : 'e2e-fake-anthropic-key';
process.env.APOLLO_API_KEY = process.env.E2E_NO_APOLLO === '1' ? '' : 'e2e-fake-apollo-key';
process.env.E2E_FAKE_DELAY_MS ??= '1000';
delete process.env.JOB_ID;

const { serve } = await import('@hono/node-server');
const { serveStatic } = await import('@hono/node-server/serve-static');
const { config } = await import('../src/config.js');
const { createApp } = await import('../src/server/app.js');
const { httpError } = await import('../src/server/http.js');
const { runningJobBlocker } = await import('../src/server/jobs.js');
const { resetE2eData, seedE2eData } = await import('../src/jobs/fake-deps.js');

if (path.resolve(config.paths.db) !== dbPath) {
  console.error(`[e2e] La config usa ${config.paths.db} invece di ${dbPath}: rifiuto di partire.`);
  process.exit(1);
}

const app = createApp();

/** Reset e seed cancellano tutto: non mentre un job scrive sul DB. */
function assertNoRunningJob(): void {
  const running = runningJobBlocker();
  if (running) throw httpError(409, `${running} Attendi che finisca prima di azzerare i dati.`, { code: 'job_running' });
}

// Endpoint di supporto registrati qui, non in `app.ts` (regola anti co-edit, PLAN §8).
app.post('/api/e2e/reset', (c) => {
  assertNoRunningJob();
  return c.json(resetE2eData());
});
app.post('/api/e2e/seed', async (c) => {
  assertNoRunningJob();
  return c.json(await seedE2eData());
});

// Come `src/server/index.ts`: SPA buildata se c'è (`npm run ui:build`), altrimenti Vite con `API_URL`.
const webDist = path.join(root, 'web', 'dist');
if (fs.existsSync(webDist)) {
  app.use('*', serveStatic({ root: path.relative(process.cwd(), webDist) }));
  app.get('*', (c, next) =>
    c.req.path.startsWith('/api') ? next() : c.html(fs.readFileSync(path.join(webDist, 'index.html'), 'utf8')),
  );
}

serve({ fetch: app.fetch, port, serverOptions: { requestTimeout: 300_000 } }, (info) => {
  console.log(`[e2e] API CRM (job fake, E2E_FAKE_JOBS=1) su http://localhost:${info.port}`);
  console.log(`[e2e] DB scratch azzerato: ${dbPath}`);
  console.log(
    `[e2e] Token: Apify ${config.apifyToken ? 'finto' : 'ASSENTE'} · Anthropic ${config.anthropicApiKey ? 'finto' : 'ASSENTE'} · ` +
      `Apollo: ${config.apolloApiKey ? 'finto' : 'ASSENTE (E2E_NO_APOLLO=1)'} · latenza job ${process.env.E2E_FAKE_DELAY_MS} ms`,
  );
  console.log('[e2e] Supporto: POST /api/e2e/reset · POST /api/e2e/seed');
  console.log(
    fs.existsSync(webDist)
      ? `[e2e] Frontend buildato servito da web/dist (ricostruisci con \`npm run ui:build\` se è vecchio).`
      : `[e2e] Frontend: API_URL=http://localhost:${info.port} npm --prefix web run dev`,
  );
});
