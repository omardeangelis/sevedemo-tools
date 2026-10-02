import { beforeEach, describe, expect, it } from 'vitest';

// Connessioni, run e attribuzione degli esiti (people-first-crm T30, SPEC J2–J7). Import dinamici: la
// config (DB_PATH isolato) è letta a import-time.
const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/server/app.js');
const { completeJob, insertJob } = await import('../src/db/jobs.js');
const { fillMissingRunTools } = await import('../src/db/schema.js');
const { RUN_TOOLS } = await import('../src/jobs/handlers.js');
const { failedTools } = await import('../src/runs/tools.js');
const { config } = await import('../src/config.js');

const app = createApp();

async function get(path: string) {
  const res = await app.request(`/api${path}`);
  return { status: res.status, body: (await res.json()) as any };
}

type Kind = Parameters<typeof insertJob>[0];

/** Run concluso con strumenti fissati all'avvio, come lo scrive `startJob`. */
function run(kind: Kind, tools: string[], outcome: { error: string } | { summary?: string; counts?: Record<string, number>; warnings?: string[] }) {
  const job = insertJob(kind, { icpId: 1 }, tools);
  if ('error' in outcome) completeJob(job.id, { state: 'failed', error: outcome.error });
  else {
    completeJob(job.id, {
      state: 'succeeded',
      result: { summary: outcome.summary ?? 'Fatto.', counts: outcome.counts ?? {}, warnings: outcome.warnings ?? [] },
    });
  }
  return job.id;
}

const tool = (body: any, id: string) => body.items.find((t: any) => t.tool === id);

beforeEach(() => {
  db.exec('DELETE FROM jobs;');
});

describe('GET /api/connections (J2, J5)', () => {
  it('tdd_target: Apollo fallito per la sua chiave è "failing"; l\'analisi fallita per Anthropic non spegne Apify', async () => {
    run('apollo_people', ['apollo'], { error: 'actor:apollo:mixed_people/api_search: chiave Apollo rifiutata (401)' });
    run('analyze', ['anthropic', 'apify'], { error: 'config: ANTHROPIC_API_KEY non valida o senza permessi.' });

    const { status, body } = await get('/connections');
    expect(status).toBe(200);
    expect(body.items.map((t: any) => t.tool)).toEqual(['apify', 'apollo', 'anthropic', 'cloudflare']);

    expect(tool(body, 'apollo')).toMatchObject({
      label: 'Apollo',
      env_vars: ['APOLLO_API_KEY'],
      missing_env_vars: [],
      configured: true,
      runs_count: 1,
      health: 'failing',
    });
    expect(tool(body, 'apollo').enables).toMatch(/^Abilita: /);
    expect(tool(body, 'apollo').last_run).toMatchObject({ outcome: 'failed', failed_tools: ['apollo'] });

    // L'analisi è l'ultimo run di Anthropic e di Apify, ma conta fallita solo per Anthropic (J4).
    expect(tool(body, 'anthropic')).toMatchObject({ health: 'failing', runs_count: 1 });
    expect(tool(body, 'apify')).toMatchObject({ health: 'ok', runs_count: 1 });
    expect(tool(body, 'apify').last_run).toMatchObject({ outcome: 'failed', failed_tools: ['anthropic'] });
  });

  it('nessun run → "Nessun run ancora"; chiave mancante → configured false', async () => {
    const saved = config.apolloApiKey;
    config.apolloApiKey = '';
    try {
      const { body } = await get('/connections');
      expect(tool(body, 'apollo')).toMatchObject({ configured: false, runs_count: 0, health: 'unknown', last_run: null });
    } finally {
      config.apolloApiKey = saved;
    }
  });
});

describe('strumenti di un run (J3) ed esiti (J4)', () => {
  it('toolsOf per kind: sync e azienda → Apify; arricchimento secondo il provider; kind Apollo → Apollo', () => {
    expect(RUN_TOOLS.sync_interactions({})).toEqual(['apify']);
    expect(RUN_TOOLS.source_company({ companyId: 1, listId: 1 })).toEqual(['apify']);
    expect(RUN_TOOLS.enrich({ prospectIds: [1], provider: 'apify' })).toEqual(['apify']);
    expect(RUN_TOOLS.enrich({ prospectIds: [1], provider: 'apollo' })).toEqual(['apollo']);
    expect(RUN_TOOLS.enrich_companies({ companyIds: [1], retryNotFound: false })).toEqual(['apollo']);
    expect(RUN_TOOLS.lookalike_companies({ icpId: 1 })).toEqual(['apollo']);
    expect(RUN_TOOLS.apollo_people({ icpId: 1, companyIds: [1] })).toEqual(['apollo']);
    // Analisi: Anthropic sempre, Apify solo se il piano prevede di arricchire prima (nessun dato qui).
    expect(RUN_TOOLS.analyze({ prospectIds: [], icpId: 1 })).toEqual(['anthropic']);
  });

  it('attribuzione dell\'errore: actor Apollo, actor Apify, modello diverso da quello configurato, config:, process:', () => {
    const attribution = (tools: string[], error: string) => failedTools({ state: 'failed', error, tools });
    expect(attribution(['apollo'], 'actor:apollo:people/bulk_match: HTTP 500')).toEqual(['apollo']);
    expect(attribution(['anthropic', 'apify'], 'actor:apimaestro/linkedin-profile-detail: 502')).toEqual(['apify']);
    // Il prefisso dell'analisi porta il nome del modello: resta di Anthropic anche cambiando ANALYSIS_MODEL.
    expect(attribution(['anthropic', 'apify'], 'actor:un-altro-modello-9: risposta non valida')).toEqual(['anthropic']);
    expect(attribution(['anthropic', 'apify'], 'config: APIFY_TOKEN mancante nel .env.')).toEqual(['apify']);
    // Errore che non nomina uno strumento: conta per tutti quelli del run (J4).
    expect(attribution(['anthropic', 'apify'], 'process: Job interrotto senza esito (exit 1).')).toEqual(['anthropic', 'apify']);
    expect(attribution(['anthropic', 'apify'], 'config: Salva il tuo profilo LinkedIn.')).toEqual(['anthropic', 'apify']);
    expect(failedTools({ state: 'succeeded', error: null, tools: ['apify'] })).toEqual([]);
  });

  it('esito: completato · completato con avvisi (warning, errori per elemento, rifiuti) · fallito', async () => {
    const clean = run('enrich', ['apify'], { counts: { enriched: 2, errors: 0 } });
    const warned = run('enrich', ['apify'], { counts: { enriched: 1, errors: 1 }, warnings: ['1 profilo non arricchito.'] });
    const refused = run('analyze', ['anthropic'], { counts: { analyzed: 1, refusals: 1, errors: 0 } });
    expect((await get(`/runs/${clean}`)).body.outcome).toBe('completed');
    expect((await get(`/runs/${warned}`)).body.outcome).toBe('warnings');
    expect((await get(`/runs/${refused}`)).body.outcome).toBe('warnings');
  });
});

describe('GET /api/connections/:tool/runs (J6) e GET /api/runs/:id (J7)', () => {
  it('dal più recente, filtro Falliti e pagina; strumento inesistente → 404', async () => {
    const ids = [
      run('enrich', ['apify'], { summary: 'Primo.' }),
      run('enrich', ['apify'], { error: 'actor:apimaestro/linkedin-profile-detail: 502' }),
      run('lookalike_companies', ['apollo'], { summary: 'Solo Apollo.' }),
      run('enrich', ['apify'], { summary: 'Terzo.' }),
    ];

    const all = await get('/connections/apify/runs');
    expect(all.body.total).toBe(3);
    expect(all.body.items.map((r: any) => r.id)).toEqual([ids[3], ids[1], ids[0]]);
    expect(all.body.items[0]).toMatchObject({ operation: 'Arricchimento (Apify)', outcome: 'completed', summary: 'Terzo.' });
    expect(all.body.items[0].duration_ms).toBeGreaterThanOrEqual(0);

    const failed = await get('/connections/apify/runs?outcome=failed');
    expect(failed.body.items.map((r: any) => r.id)).toEqual([ids[1]]);
    expect(failed.body.total).toBe(1);

    const page = await get('/connections/apify/runs?page=2&pageSize=2');
    expect(page.body).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect(page.body.items.map((r: any) => r.id)).toEqual([ids[0]]);

    const missing = await get('/connections/perplexity/runs');
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe('Strumento non trovato.');
  });

  it('dettaglio: parametri, esito, attribuzione, chiavi oscurate; run inesistente → 404', async () => {
    const job = insertJob('analyze', { prospectIds: [1, 2], icpId: 3 }, ['anthropic', 'apify']);
    completeJob(job.id, { state: 'failed', error: `config: chiave rifiutata (x-api-key: ${config.anthropicApiKey})` });

    const { status, body } = await get(`/runs/${job.id}`);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      id: job.id,
      kind: 'analyze',
      operation: 'Analisi',
      state: 'failed',
      outcome: 'failed',
      tools: ['anthropic', 'apify'],
      detached: 0,
      logged: true,
    });
    expect(body.params).toEqual({ prospectIds: [1, 2], icpId: 3 });
    expect(body.error).not.toContain(config.anthropicApiKey);
    expect(body.error).toContain('***');
    // La chiave nominata dall'errore `config:` attribuisce il fallimento (J4).
    expect(body.failed_tools).toEqual(['anthropic', 'apify']);

    expect((await get('/runs/999999')).status).toBe(404);
    expect((await get('/runs/999999')).body.error).toBe('Run non trovato.');
  });

  it('riassunti e warning dell\'esito sono ripuliti dalle chiavi (J10)', async () => {
    const job = insertJob('enrich', { prospectIds: [1] }, ['apify']);
    completeJob(job.id, {
      state: 'succeeded',
      result: {
        summary: `Arricchimento fatto con token ${config.apifyToken}.`,
        counts: { enriched: 1 },
        warnings: [`Token usato: ${config.apifyToken}`],
      },
    });
    const { body } = await get(`/runs/${job.id}`);
    expect(JSON.stringify(body)).not.toContain(config.apifyToken);
    expect(body.result.summary).toContain('***');
    expect(body.result.warnings[0]).toContain('***');
  });
});

describe('run creati prima di T30 (P-28)', () => {
  it('un run senza strumenti compare nella pagina dello strumento dopo fillMissingRunTools', async () => {
    const job = insertJob('sync_interactions', {}, []);
    completeJob(job.id, { state: 'succeeded', result: { summary: 'Sync fatto.', counts: {}, warnings: [] } });
    expect((await get('/connections/apify/runs')).body.total).toBe(0);

    expect(fillMissingRunTools(db)).toBe(1);
    expect((await get('/connections/apify/runs')).body.items.map((r: any) => r.id)).toEqual([job.id]);
    // Idempotente: una seconda chiamata non tocca più nulla.
    expect(fillMissingRunTools(db)).toBe(0);
  });
});
