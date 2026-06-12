import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// Figlio finto che resta vivo ~1.5s: tiene lo stato su running senza mai
// toccare la pipeline reale.
const FAKE_JOB = { command: process.execPath, args: ['-e', 'setTimeout(() => {}, 1500);'] };

type JsonBody = { state?: string; error?: string; ok?: boolean };
const body = (res: Response): Promise<JsonBody> => res.json() as Promise<JsonBody>;

async function makeApp() {
  const { createApp } = await import('../src/server/app.js');
  const exportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sevedemo-exports-'));
  return { app: createApp({ job: FAKE_JOB, erase: { exportsDir } }), exportsDir };
}

describe('API pipeline', () => {
  it('status iniziale idle; POST run → 202 e running; secondo POST → 409', async () => {
    const { app } = await makeApp();

    const initial = await app.request('/api/pipeline/status');
    expect(initial.status).toBe(200);
    expect((await body(initial)).state).toBe('idle');

    const run = await app.request('/api/pipeline/run', { method: 'POST' });
    expect(run.status).toBe(202);
    expect((await body(run)).state).toBe('running');

    const status = await app.request('/api/pipeline/status');
    expect((await body(status)).state).toBe('running');

    const second = await app.request('/api/pipeline/run', { method: 'POST' });
    expect(second.status).toBe(409);
    expect((await body(second)).error).toBeTruthy();
  });

  it('erase: 400 senza conferma valida, 409 durante un run, 200 con conteggi a riposo', async () => {
    const { app, exportsDir } = await makeApp();
    const json = (body: unknown) => ({
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
    const waitIdleRun = () =>
      vi.waitFor(
        async () => {
          const s = await body(await app.request('/api/pipeline/status'));
          expect(s.state).not.toBe('running');
        },
        { timeout: 5000 },
      );

    // Il run del test precedente può essere ancora vivo: si attende la fine.
    await waitIdleRun();

    const bad = await app.request('/api/data/erase', json({ confirm: 'SI' }));
    expect(bad.status).toBe(400);
    const noBody = await app.request('/api/data/erase', { method: 'POST' });
    expect(noBody.status).toBe(400);

    await app.request('/api/pipeline/run', { method: 'POST' });
    const duringRun = await app.request('/api/data/erase', json({ confirm: 'ERASE' }));
    expect(duringRun.status).toBe(409);
    await waitIdleRun();

    const { db, nowIso } = await import('../src/db/index.js');
    db.prepare('INSERT INTO contacts (linkedin_url, first_seen_at) VALUES (?, ?)').run(
      'https://linkedin.com/in/da-cancellare',
      nowIso(),
    );
    fs.writeFileSync(path.join(exportsDir, 'daily.csv'), 'a,b\n');

    const ok = await app.request('/api/data/erase', json({ confirm: 'ERASE' }));
    expect(ok.status).toBe(200);
    const counts = (await ok.json()) as { contacts: number; exportFiles: number };
    expect(counts.contacts).toBe(1);
    expect(counts.exportFiles).toBe(1);
    const total = db.prepare('SELECT COUNT(*) AS n FROM contacts').get() as { n: number };
    expect(total.n).toBe(0);

    // L'erase cancella anche lo stato del job (vive in kv): si torna a idle.
    const after = await app.request('/api/pipeline/status');
    expect((await body(after)).state).toBe('idle');
  });

  it('gli endpoint esistenti restano invariati (health, stats)', async () => {
    const { app } = await makeApp();
    const health = await app.request('/api/health');
    expect(health.status).toBe(200);
    expect((await body(health)).ok).toBe(true);
    const stats = await app.request('/api/stats');
    expect(stats.status).toBe(200);
    expect(await stats.json()).toHaveProperty('total');
  });
});
