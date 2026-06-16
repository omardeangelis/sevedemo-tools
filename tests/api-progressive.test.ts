import { describe, expect, it } from 'vitest';

// Job finto che resta vivo ~1.5s: enrichment "running" senza pipeline reale.
const FAKE_JOB = { command: process.execPath, args: ['-e', 'setTimeout(() => {}, 1500);'] };

let seq = 0;
const newUrl = () => `https://www.linkedin.com/in/apiprog-${process.pid}-${++seq}`;
const score = (bucket: string) => ({
  role: 'r',
  bucket,
  sector: 'tech',
  fitScore: 80,
  shortDescription: 'd',
  reason: 'x',
  signals: {},
});

async function makeApp() {
  const { createApp } = await import('../src/server/app.js');
  return createApp({ job: FAKE_JOB, enrichmentJob: FAKE_JOB });
}

async function seed() {
  const { upsertCandidate, updateScore } = await import('../src/db/contacts.js');
  const { saveSelection, logRun } = await import('../src/db/runs.js');
  const { db } = await import('../src/db/index.js');
  return { upsertCandidate, updateScore, saveSelection, logRun, db };
}

const json = (b: unknown) => ({
  method: 'POST',
  body: JSON.stringify(b),
  headers: { 'Content-Type': 'application/json' },
});

describe('API — Run per esecuzione', () => {
  it('/api/runs raggruppa per run_id con stato selezione e conteggi pronti/da-arricchire', async () => {
    const { upsertCandidate, updateScore, saveSelection, logRun, db } = await seed();
    const withE = upsertCandidate({ linkedinUrl: newUrl(), sourceStrategy: 's' }).id;
    const noE = upsertCandidate({ linkedinUrl: newUrl(), sourceStrategy: 's' }).id;
    updateScore(withE, score('freelance'));
    updateScore(noE, score('azienda'));
    db.prepare('UPDATE contacts SET email = ? WHERE id = ?').run('ready@x.it', withE);
    saveSelection(
      '2099-07-01',
      [
        { bucket: 'freelance', contactId: withE, rank: 1 },
        { bucket: 'azienda', contactId: noE, rank: 1 },
      ],
      '2099-07-01-1',
    );
    logRun({ runDate: '2099-07-01', strategy: 'st', runId: '2099-07-01-1', itemsIn: 10, itemsNew: 5 });

    const app = await makeApp();
    const execs = (await (await app.request('/api/runs')).json()) as any[];
    const exec = execs.find((e) => e.run_id === '2099-07-01-1');

    expect(exec).toBeTruthy();
    expect(exec.run_date).toBe('2099-07-01');
    expect(exec.strategies).toContain('st');
    expect(exec.selection.state).toBe('in_review');
    expect(exec.selection.total).toBe(2);
    expect(exec.selection.ready).toBe(1);
    expect(exec.selection.toEnrich).toBe(1);
  });
});

describe('API — Selezione: provenienza, stato, export', () => {
  it('/api/selections/:date include run_id e state', async () => {
    const { upsertCandidate, updateScore, saveSelection } = await seed();
    const id = upsertCandidate({ linkedinUrl: newUrl(), sourceStrategy: 's' }).id;
    updateScore(id, score('freelance'));
    saveSelection('2099-07-02', [{ bucket: 'freelance', contactId: id, rank: 1 }], '2099-07-02-1');

    const app = await makeApp();
    const sel = (await (await app.request('/api/selections/2099-07-02')).json()) as any;
    expect(sel.run_id).toBe('2099-07-02-1');
    expect(sel.state).toBe('in_review');
    expect(sel.items).toHaveLength(1);
  });

  it('POST .../export porta la selezione a exported e blocca add/remove (409)', async () => {
    const { upsertCandidate, updateScore, saveSelection } = await seed();
    const member = upsertCandidate({ linkedinUrl: newUrl(), sourceStrategy: 's' }).id;
    const extra = upsertCandidate({ linkedinUrl: newUrl(), sourceStrategy: 's' }).id;
    updateScore(member, score('freelance'));
    updateScore(extra, score('freelance'));
    saveSelection('2099-07-03', [{ bucket: 'freelance', contactId: member, rank: 1 }], '2099-07-03-1');

    const app = await makeApp();
    const exp = await app.request('/api/selections/2099-07-03/export', { method: 'POST' });
    expect(exp.status).toBe(200);
    expect(((await exp.json()) as any).state).toBe('exported');

    const sel = (await (await app.request('/api/selections/2099-07-03')).json()) as any;
    expect(sel.state).toBe('exported');

    const add = await app.request(
      '/api/selections/2099-07-03/contacts',
      json({ contactId: extra, bucket: 'freelance' }),
    );
    expect(add.status).toBe(409);

    const del = await app.request(`/api/selections/2099-07-03/contacts/${member}`, {
      method: 'DELETE',
    });
    expect(del.status).toBe(409);
  });
});

describe('API — Enrichment', () => {
  it('POST .../enrich → 202; secondo → 409 (job in corso)', async () => {
    const { upsertCandidate, updateScore, saveSelection } = await seed();
    const id = upsertCandidate({ linkedinUrl: newUrl(), sourceStrategy: 's' }).id;
    updateScore(id, score('freelance'));
    saveSelection('2099-07-04', [{ bucket: 'freelance', contactId: id, rank: 1 }], '2099-07-04-1');

    const app = await makeApp();
    const first = await app.request('/api/selections/2099-07-04/enrich', json({}));
    expect(first.status).toBe(202);
    expect(((await first.json()) as any).state).toBe('running');

    const second = await app.request('/api/selections/2099-07-04/enrich', json({}));
    expect(second.status).toBe(409);

    const status = await app.request('/api/enrichment/status');
    expect(status.status).toBe(200);
    expect(((await status.json()) as any).state).toBe('running');
  });

  it('POST .../enrich su selezione inesistente → 404', async () => {
    const app = await makeApp();
    const res = await app.request('/api/selections/2099-12-31/enrich', json({}));
    expect(res.status).toBe(404);
  });
});

describe('API — stats e candidates', () => {
  it('/api/stats include freshnessDays', async () => {
    const app = await makeApp();
    const stats = (await (await app.request('/api/stats')).json()) as any;
    expect(stats.freshnessDays).toBe(90);
  });

  it('/api/selections/:date/candidates esclude chi è già in una selezione', async () => {
    const { upsertCandidate, updateScore, saveSelection } = await seed();
    const member = upsertCandidate({ linkedinUrl: newUrl(), sourceStrategy: 's' }).id;
    const free = upsertCandidate({ linkedinUrl: newUrl(), sourceStrategy: 's' }).id;
    updateScore(member, score('freelance'));
    updateScore(free, score('freelance'));
    saveSelection('2099-07-05', [{ bucket: 'freelance', contactId: member, rank: 1 }], '2099-07-05-1');

    const app = await makeApp();
    const cands = (await (
      await app.request('/api/selections/2099-07-06/candidates?bucket=freelance')
    ).json()) as any[];
    const ids = cands.map((c) => c.id);
    expect(ids).toContain(free);
    expect(ids).not.toContain(member); // già membro di un'altra selezione
  });
});
