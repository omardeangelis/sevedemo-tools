import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Cloudflare come quarto strumento (own-profile-services T18 e T21, SPEC A1, A3, A4, A6, A7, A9, PLAN P-26). Import
// dinamici: la config (DB_PATH isolato) è letta a import-time.
const { createApp } = await import('../src/server/app.js');
const { config } = await import('../src/config.js');
const { failedTools, redactSecrets } = await import('../src/runs/tools.js');
const { db } = await import('../src/db/index.js');
const { completeJob, insertJob } = await import('../src/db/jobs.js');
const { CONFIG_BLOCKERS, RETRY_PREVIEWS } = await import('../src/jobs/handlers.js');

const app = createApp();

async function get(path: string) {
  const res = await app.request(`/api${path}`);
  return { status: res.status, body: (await res.json()) as any };
}

const saved = { account: config.cloudflareAccountId, token: config.cloudflareApiToken };

function cloudflare(account: string, token: string) {
  config.cloudflareAccountId = account;
  config.cloudflareApiToken = token;
}

afterEach(() => cloudflare(saved.account, saved.token));

const cloudflareCard = async () => (await get('/connections')).body.items.find((t: any) => t.tool === 'cloudflare');

describe('Cloudflare in Connessioni (A3, A4)', () => {
  it('tdd_target: con solo CLOUDFLARE_ACCOUNT_ID lo strumento non è configurato e il payload nomina il token', async () => {
    cloudflare('0123456789abcdef', '');
    expect(await cloudflareCard()).toMatchObject({
      label: 'Cloudflare',
      env_vars: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'],
      missing_env_vars: ['CLOUDFLARE_API_TOKEN'],
      configured: false,
    });
  });

  it('senza nessuna delle due: non configurato, mancano entrambe; con entrambe: configurato', async () => {
    cloudflare('', '  ');
    expect(await cloudflareCard()).toMatchObject({
      missing_env_vars: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'],
      configured: false,
    });
    cloudflare('0123456789abcdef', 'cf-token-segreto-123');
    expect(await cloudflareCard()).toMatchObject({ missing_env_vars: [], configured: true, health: 'unknown' });
  });

  it('quattro strumenti in Connessioni; la pagina dei run di Cloudflare esiste', async () => {
    const { body } = await get('/connections');
    expect(body.items.map((t: any) => t.tool)).toEqual(['apify', 'apollo', 'anthropic', 'cloudflare']);
    const runs = await get('/connections/cloudflare/runs');
    expect(runs.status).toBe(200);
    expect(runs.body).toMatchObject({ items: [], total: 0, page: 1 });
  });
});

describe('redazione (A7)', () => {
  it('il token Cloudflare è oscurato, l\'identificativo dell\'account no', () => {
    cloudflare('0123456789abcdef', 'cf-token-segreto-123');
    expect(redactSecrets('actor:cloudflare:crawl: 401 per cf-token-segreto-123 (account 0123456789abcdef)')).toBe(
      'actor:cloudflare:crawl: 401 per *** (account 0123456789abcdef)',
    );
  });
});

describe('senza credenziali Cloudflare il resto del CRM non cambia (A9)', () => {
  /** Esito di una chiamata, anche quando lancia: "come prima" vale anche per gli errori. */
  const outcome = (fn: () => unknown) => {
    try {
      return { value: fn() };
    } catch (err) {
      return { error: (err as Error).message };
    }
  };
  // Un `params` plausibile per ogni kind che non usa Cloudflare: `generate_profile` lo usa, e senza credenziali la sua
  // anteprima mette di proposito il sito fra le fonti non disponibili (D8).
  const PARAMS = {
    sync_interactions: {},
    source_company: { companyId: 1, listId: 1 },
    enrich: { prospectIds: [1], provider: 'apify' },
    analyze: { prospectIds: [1], icpId: 1 },
    enrich_companies: { companyIds: [1], retryNotFound: false },
    lookalike_companies: { icpId: 1 },
    apollo_people: { icpId: 1, companyIds: [1] },
  } as const;

  const snapshot = async () => ({
    kinds: Object.entries(PARAMS).map(([kind, params]) => ({
      kind,
      blockers: outcome(() => CONFIG_BLOCKERS[kind as keyof typeof PARAMS](params)),
      preview: outcome(() => RETRY_PREVIEWS[kind as keyof typeof PARAMS](params)),
    })),
    settings: (await get('/settings')).body,
    today: (await get('/today')).body,
    others: (await get('/connections')).body.items.filter((t: any) => t.tool !== 'cloudflare'),
  });

  it('blocchi e anteprime di ogni kind, readiness, Oggi e le altre card sono gli stessi', async () => {
    cloudflare('0123456789abcdef', 'cf-token-segreto-123');
    const withCredentials = await snapshot();
    cloudflare('', '');
    expect(await snapshot()).toEqual(withCredentials);
  });
});

describe('attribuzione degli errori a quattro strumenti (A6, T21)', () => {
  const ALL = ['apify', 'cloudflare', 'apollo', 'anthropic'];
  const failed = (error: string) => failedTools({ state: 'failed', error, tools: ALL });

  it('un errore actor:cloudflare: conta solo per Cloudflare, uno del modello solo per Anthropic', () => {
    expect(failed('actor:cloudflare:crawl: la lettura del sito è fallita lato Cloudflare.')).toEqual(['cloudflare']);
    expect(failed('actor:cloudflare:crawl/status: HTTP 500')).toEqual(['cloudflare']);
    expect(failed('config: Cloudflare ha rifiutato le credenziali (401). Verifica CLOUDFLARE_API_TOKEN nel .env.')).toEqual([
      'cloudflare',
    ]);
    expect(failed('config: CLOUDFLARE_ACCOUNT_ID mancante nel .env')).toEqual(['cloudflare']);
    expect(failed('actor:claude-opus-5: risposta non valida')).toEqual(['anthropic']);
  });

  it('un errore che non nomina nessuno strumento conta per tutti quelli del run', () => {
    expect(failed('process: Job interrotto senza esito (exit 1).')).toEqual(ALL);
  });
});

describe('un run riuscito con una fonte fallita conta come fallito per il suo strumento (P-26)', () => {
  beforeEach(() => {
    db.exec('DELETE FROM jobs;');
  });

  const SITE_ERROR = 'config: Cloudflare ha rifiutato le credenziali (401). Verifica CLOUDFLARE_API_TOKEN nel .env.';

  function generation(toolErrors?: Record<string, string>) {
    const job = insertJob('generate_profile', { sources: ['linkedin', 'website', 'posts'], force: [] }, ['apify', 'cloudflare', 'anthropic']);
    completeJob(job.id, {
      state: 'succeeded',
      result: {
        summary: 'Proposta pronta da 2 fonti su 3.',
        counts: {},
        warnings: toolErrors ? ['Sito non letto: Cloudflare ha rifiutato le credenziali (401).'] : [],
        ...(toolErrors ? { tool_errors: toolErrors } : {}),
      },
    });
    return job.id;
  }

  it('tdd_target: il sito non letto fa risultare non sano solo Cloudflare, e il run resta riuscito', async () => {
    const id = generation({ cloudflare: SITE_ERROR });
    const { body } = await get('/connections');
    const health = Object.fromEntries(body.items.map((t: any) => [t.tool, t.health]));
    // Apollo non è fra gli strumenti della generazione (P-29): nessun run, salute sconosciuta.
    expect(health).toEqual({ apify: 'ok', apollo: 'unknown', anthropic: 'ok', cloudflare: 'failing' });

    const card = body.items.find((t: any) => t.tool === 'cloudflare');
    expect(card.last_run).toMatchObject({
      id,
      state: 'succeeded',
      outcome: 'warnings',
      error: null,
      failed_tools: ['cloudflare'],
      tool_errors: { cloudflare: SITE_ERROR },
    });

    // Gli avvisi di Oggi dicono la stessa cosa della salute (H5): un avviso, per Cloudflare, col suo motivo.
    const today = (await get('/today')).body;
    expect(today.failed_runs).toHaveLength(1);
    expect(today.failed_runs[0]).toMatchObject({ tools: ['cloudflare'], run: { id, tool_errors: { cloudflare: SITE_ERROR } } });
    expect((await get(`/runs/${id}`)).body).toMatchObject({ state: 'succeeded', failed_tools: ['cloudflare'] });
  });

  it('lo stesso run senza fonti fallite: nessuno strumento non sano, nessun avviso', async () => {
    generation();
    const { body } = await get('/connections');
    expect(body.items.map((t: any) => t.health)).toEqual(['ok', 'unknown', 'ok', 'ok']);
    expect((await get('/today')).body.failed_runs).toEqual([]);
  });

  it('un run fallito porta come motivo di ogni strumento l\'errore del run', async () => {
    const job = insertJob('analyze', { icpId: 1 }, ['anthropic', 'apify']);
    completeJob(job.id, { state: 'failed', error: 'config: ANTHROPIC_API_KEY non valida o senza permessi.' });
    const card = (await get('/connections')).body.items.find((t: any) => t.tool === 'anthropic');
    expect(card.last_run).toMatchObject({
      failed_tools: ['anthropic'],
      tool_errors: { anthropic: 'config: ANTHROPIC_API_KEY non valida o senza permessi.' },
    });
  });

  it('il motivo di una fonte fallita è ripulito dai segreti come l\'errore del run (A7)', async () => {
    cloudflare('0123456789abcdef', 'cf-token-segreto-123');
    const id = generation({ cloudflare: 'actor:cloudflare:crawl: HTTP 500 (echo cf-token-segreto-123)' });
    expect((await get(`/runs/${id}`)).body.tool_errors).toEqual({ cloudflare: 'actor:cloudflare:crawl: HTTP 500 (echo ***)' });
  });
});
