/**
 * Server e2e del CRM (crm-foundation T20): l'API reale su un DB scratch, con i job che girano
 * davvero (processo figlio, mapper, DB) ma su deps fixture-backed (`E2E_FAKE_JOBS=1`, niente Apify
 * né Claude). Serve a validare il frontend con agent-browser. Guida: `tests/e2e/README.md`.
 *
 *   npm run e2e:server                     → http://localhost:8790, DB in tmp azzerato all'avvio
 *   UI_PORT=8802 npm run e2e:server        → altra porta (e altro DB: uno per porta)
 *   E2E_NO_APIFY=1 / E2E_NO_ANTHROPIC=1 / E2E_NO_APOLLO=1 → token assenti (blocchi nelle preview)
 *   E2E_NO_CLOUDFLARE=1 | account | token → senza le due credenziali Cloudflare, o senza una sola
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
const noCloudflare = process.env.E2E_NO_CLOUDFLARE;
process.env.CLOUDFLARE_ACCOUNT_ID = noCloudflare === '1' || noCloudflare === 'account' ? '' : 'e2e-fake-cloudflare-account';
process.env.CLOUDFLARE_API_TOKEN = noCloudflare === '1' || noCloudflare === 'token' ? '' : 'e2e-fake-cloudflare-token';
process.env.E2E_FAKE_DELAY_MS ??= '1000';
delete process.env.JOB_ID;

const { Hono } = await import('hono');
const { z } = await import('zod');
const { serve } = await import('@hono/node-server');
const { serveStatic } = await import('@hono/node-server/serve-static');
const { config } = await import('../src/config.js');
const { createApp } = await import('../src/server/app.js');
const { httpError, readJson, readOptionalJson } = await import('../src/server/http.js');
const { runningJobBlocker } = await import('../src/server/jobs.js');
const { E2E_PROFILE_SCENARIOS, resetE2eData, seedBulkPeople, seedE2eData } = await import('../src/jobs/fake-deps.js');

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

/**
 * Fallimenti simulati (people-first-crm PLAN P-23): le prossime `times` richieste con quel metodo e quel path
 * (senza query string) rispondono `status` (default 500) `{error: 'Errore interno (e2e).'}` senza arrivare all'API.
 * Servono alle righe d'errore del FLOW che la UI non sa provocare (salvataggio fallito, Unisci 500, …).
 */
type FailRule = { method: string; path: string; status: number; times: number };
let failRules: FailRule[] = [];

// App esterna davanti a `createApp()`: un `app.use` aggiunto dopo non vedrebbe le route già registrate.
const outer = new Hono();

outer.use('*', async (c, next) => {
  const rule = failRules.find((r) => r.method === c.req.method && r.path === c.req.path && r.times > 0);
  if (!rule) return next();
  rule.times -= 1;
  failRules = failRules.filter((r) => r.times > 0);
  return c.json({ error: 'Errore interno (e2e).' }, rule.status as 500);
});

const failNextSchema = z
  .object({
    method: z.string().transform((m) => m.toUpperCase()),
    path: z.string().startsWith('/api/'),
    status: z.number().int().min(400).max(599).optional(),
    times: z.number().int().min(1).max(20).optional(),
  })
  .strict();

// Endpoint di supporto registrati qui, non in `app.ts` (regola anti co-edit, PLAN §8).
outer.post('/api/e2e/fail-next', async (c) => {
  const body = await readJson(c, failNextSchema);
  const rule = { method: body.method, path: body.path.split('?')[0], status: body.status ?? 500, times: body.times ?? 1 };
  failRules.push(rule);
  return c.json({ ok: true, rule });
});
outer.post('/api/e2e/reset', (c) => {
  assertNoRunningJob();
  failRules = [];
  return c.json(resetE2eData());
});
// Scenario del profilo per la generazione (own-profile-services T29): `empty` = percorso A, `curated` = percorso C.
const seedSchema = z.object({ profile: z.enum(E2E_PROFILE_SCENARIOS).optional() }).strict();
outer.post('/api/e2e/seed', async (c) => {
  assertNoRunningJob();
  const body = await readOptionalJson(c, seedSchema);
  failRules = [];
  return c.json(await seedE2eData(body));
});
// Volume del perf (people-first-crm T21, P-23): seed normale + `people`/`companies` in più (default 10.000/2.000).
const seedBulkSchema = z
  .object({ people: z.number().int().min(0).max(50_000).optional(), companies: z.number().int().min(0).max(10_000).optional() })
  .strict();
outer.post('/api/e2e/seed-bulk', async (c) => {
  assertNoRunningJob();
  const body = await readOptionalJson(c, seedBulkSchema);
  failRules = [];
  const seed = await seedE2eData();
  return c.json({ ...seed, bulk: seedBulkPeople(body.people ?? 10_000, body.companies ?? 2_000) });
});
outer.all('*', (c) => app.fetch(c.req.raw));

// Come `src/server/index.ts`: SPA buildata se c'è (`npm run ui:build`), altrimenti Vite con `API_URL`.
const webDist = path.join(root, 'web', 'dist');
if (fs.existsSync(webDist)) {
  app.use('*', serveStatic({ root: path.relative(process.cwd(), webDist) }));
  app.get('*', (c, next) =>
    c.req.path.startsWith('/api') ? next() : c.html(fs.readFileSync(path.join(webDist, 'index.html'), 'utf8')),
  );
}

serve({ fetch: outer.fetch, port, serverOptions: { requestTimeout: 300_000 } }, (info) => {
  console.log(`[e2e] API CRM (job fake, E2E_FAKE_JOBS=1) su http://localhost:${info.port}`);
  console.log(`[e2e] DB scratch azzerato: ${dbPath}`);
  console.log(
    `[e2e] Token: Apify ${config.apifyToken ? 'finto' : 'ASSENTE'} · Anthropic ${config.anthropicApiKey ? 'finto' : 'ASSENTE'} · ` +
      `Apollo: ${config.apolloApiKey ? 'finto' : 'ASSENTE (E2E_NO_APOLLO=1)'} · ` +
      `Cloudflare: account ${config.cloudflareAccountId ? 'finto' : 'ASSENTE'}, token ${config.cloudflareApiToken ? 'finto' : 'ASSENTE'} · ` +
      `latenza job ${process.env.E2E_FAKE_DELAY_MS} ms`,
  );
  console.log('[e2e] Supporto: POST /api/e2e/reset · POST /api/e2e/seed · POST /api/e2e/seed-bulk · POST /api/e2e/fail-next');
  console.log(
    fs.existsSync(webDist)
      ? `[e2e] Frontend buildato servito da web/dist (ricostruisci con \`npm run ui:build\` se è vecchio).`
      : `[e2e] Frontend: API_URL=http://localhost:${info.port} npm --prefix web run dev`,
  );
});
