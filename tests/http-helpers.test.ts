import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { z } from 'zod';

describe('server/http helpers', () => {
  it('readJson valida il body e httpError produce `{error, ...extra}` con lo status dato', async () => {
    const { readJson, httpError, idParam } = await import('../src/server/http.js');
    const { createApp } = await import('../src/server/app.js');
    const app = createApp();
    const r = new Hono();
    r.post('/t/:id', async (c) => {
      const id = idParam(c);
      const body = await readJson(c, z.object({ name: z.string().min(1) }).strict());
      if (body.name === 'dup') throw httpError(409, 'Esiste già.', { code: 'duplicate', existing_id: id });
      return c.json({ id, name: body.name }, 201);
    });
    app.route('/api', r);

    const post = (path: string, body: string) =>
      app.request(path, { method: 'POST', body, headers: { 'content-type': 'application/json' } });

    const ok = await post('/api/t/7', JSON.stringify({ name: 'Acme' }));
    expect(ok.status).toBe(201);
    expect(await ok.json()).toEqual({ id: 7, name: 'Acme' });

    const invalid = await post('/api/t/7', JSON.stringify({ name: '', extra: 1 }));
    expect(invalid.status).toBe(400);
    const invalidBody = (await invalid.json()) as { error: unknown; issues: unknown[] };
    expect(invalidBody.error).toBeTypeOf('string');
    expect(invalidBody.issues.length).toBeGreaterThan(0);

    const malformed = await post('/api/t/7', '{nope');
    expect(malformed.status).toBe(400);

    const conflict = await post('/api/t/7', JSON.stringify({ name: 'dup' }));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: 'Esiste già.', code: 'duplicate', existing_id: 7 });

    const badId = await post('/api/t/abc', JSON.stringify({ name: 'Acme' }));
    expect(badId.status).toBe(404);
  });
});
