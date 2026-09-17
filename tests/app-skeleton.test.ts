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
