import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';

// Scheletro del server (crm-foundation T3). Import dinamici: la config (DB_PATH
// isolato da tests/setup.ts) è letta a import-time.
const { createApp } = await import('../src/server/app.js');
const { HANDLERS } = await import('../src/jobs/handlers.js');
const { JOB_KINDS } = await import('../src/jobs/types.js');

describe('scheletro API', () => {
  it('GET /api/health → 200 con il path del DB', async () => {
    const res = await createApp().request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, db: process.env.DB_PATH });
  });

  it('una path /api inesistente → 404 JSON dal notFound globale', async () => {
    const res = await createApp().request('/api/__inesistente/42');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ error: 'Endpoint inesistente.' });
  });

  it('le opzioni di createApp arrivano ai router via context', async () => {
    const opts = { jobs: { command: 'node', args: ['-e', ''] } };
    const app = createApp(opts);
    app.get('/api/__opts', (c) => c.json(c.get('opts')));
    const res = await app.request('/api/__opts');
    expect(await res.json()).toEqual(opts);
  });

  it('un errore non gestito su /api → 500 JSON con messaggio', async () => {
    const app = createApp();
    app.get('/api/__boom', () => {
      throw new Error('esploso');
    });
    const res = await app.request('/api/__boom');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'esploso' });
  });
});

describe('registry dei job', () => {
  it('ha un handler per ogni kind', () => {
    expect(Object.keys(HANDLERS).sort()).toEqual([...JOB_KINDS].sort());
    for (const kind of JOB_KINDS) expect(typeof HANDLERS[kind]).toBe('function');
  });

  it('pre-cablaggio apollo-lookalike T5: deps reali, blocker di configurazione ed etichetta per ogni kind', async () => {
    const { CONFIG_BLOCKERS, REAL_DEPS } = await import('../src/jobs/handlers.js');
    const { JOB_KIND_LABELS } = await import('../src/server/jobs.js');
    for (const registry of [REAL_DEPS, CONFIG_BLOCKERS, JOB_KIND_LABELS]) {
      expect(Object.keys(registry).sort()).toEqual([...JOB_KINDS].sort());
    }
    for (const kind of JOB_KINDS) expect(typeof CONFIG_BLOCKERS[kind]).toBe('function');
    expect(JOB_KIND_LABELS).toMatchObject({
      enrich_companies: 'Arricchimento aziende (Apollo)',
      lookalike_companies: 'Aziende simili (Apollo)',
      apollo_people: 'Contatti Apollo',
    });
    // Deps reali dei kind Apollo nella forma definitiva (S-6, S-7), senza chiamate alla creazione.
    expect(Object.keys(REAL_DEPS.enrich_companies()).sort()).toEqual(['enrichOrganizations']);
    expect(Object.keys(REAL_DEPS.lookalike_companies()).sort()).toEqual([
      'enrichOrganizations',
      'matchPeople',
      'searchOrganizations',
      'searchPeople',
    ]);
    expect(Object.keys(REAL_DEPS.apollo_people()).sort()).toEqual(['matchPeople', 'searchPeople']);
  });
});

describe('router Apollo montati (apollo-lookalike T5, implementati in T7a/T7c/T8/T11)', () => {
  const ROUTES: Array<[method: string, path: string]> = [
    ['GET', '/api/icps/999999/enrich-companies/preview'],
    ['POST', '/api/icps/999999/enrich-companies'],
    ['GET', '/api/companies/999999/enrich-apollo/preview'],
    ['POST', '/api/companies/999999/enrich-apollo'],
    ['GET', '/api/icps/999999/lookalike/preview'],
    ['GET', '/api/icps/999999/lookalike/runs'],
    ['GET', '/api/icps/999999/candidates'],
    ['GET', '/api/companies/999999/candidate-of'],
  ];

  it.each(ROUTES)('%s %s → 404 del router (ICP/azienda inesistente), non 501', async (method, path) => {
    const res = await createApp().request(path, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code?: string };
    expect(body.code).not.toBe('not_implemented');
  });

  it('non oscurano le route esistenti di ICP e aziende', async () => {
    const app = createApp();
    expect((await app.request('/api/icps/999999')).status).toBe(404);
    expect((await app.request('/api/companies/999999')).status).toBe(404);
    expect((await app.request('/api/icps')).status).toBe(200);
  });
});

describe('dipendenze: SDK Anthropic e zod', () => {
  it('MessageCreateParams tipizza output_config.format e StopReason include refusal', () => {
    // Asserzioni a compile-time (tsconfig.tests.json): con l'SDK 0.65 non compilano.
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: 'claude-opus-5',
      max_tokens: 4000,
      messages: [{ role: 'user', content: 'ciao' }],
      output_config: { format: { type: 'json_schema', schema: { type: 'object' } } },
    };
    const refusal: Anthropic.StopReason = 'refusal';
    expect(params.output_config?.format?.type).toBe('json_schema');
    expect(refusal).toBe('refusal');
  });

  it('zod espone toJSONSchema (v4) per output_config.format', async () => {
    const { z } = await import('zod');
    expect(z.toJSONSchema(z.object({ fit: z.enum(['alto', 'medio', 'basso']) }))).toMatchObject({ type: 'object' });
  });
});
