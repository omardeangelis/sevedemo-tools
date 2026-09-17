import { beforeEach, describe, expect, it } from 'vitest';

// Enrichment on-demand (crm-foundation T10). Import dinamici: la config (DB_PATH isolato da
// tests/setup.ts) è letta a import-time. Mai Apify reale: `deps.enrich` è sempre un fake.
const { db } = await import('../src/db/index.js');
const { upsertProspect } = await import('../src/db/prospects.js');
const { enrichProspects } = await import('../src/jobs/enrich.js');

type Enrichment = import('../src/enrich/profile-detail.js').Enrichment;

const URL_A = 'https://www.linkedin.com/in/anna-arricchita';
const URL_B = 'https://www.linkedin.com/in/bruno-senza-email';
const URL_C = 'https://www.linkedin.com/in/carla-privata';

function reset(): void {
  db.exec('DELETE FROM prospects; DELETE FROM posts; DELETE FROM lists; DELETE FROM companies; DELETE FROM icps; DELETE FROM jobs;');
}

function row(id: number): any {
  return db.prepare('SELECT * FROM prospects WHERE id = ?').get(id);
}

/** Fake di `deps.enrich`: ritorna i dati per gli URL noti e registra le chiamate. */
function fakeEnrich(data: Record<string, Enrichment>) {
  const calls: string[][] = [];
  return {
    calls,
    enrich: async (urls: string[]) => {
      calls.push(urls);
      const map = new Map<string, Enrichment>();
      for (const u of urls) if (data[u]) map.set(u, data[u]);
      return map;
    },
  };
}

beforeEach(reset);

describe('enrichProspects({prospectIds})', () => {
  it('arricchisce chi torna con dati, timbra il tentativo su tutti, enriched_at solo con dati', async () => {
    const a = upsertProspect({ linkedinUrl: URL_A }).id;
    const b = upsertProspect({ linkedinUrl: URL_B }).id;
    const c = upsertProspect({ linkedinUrl: URL_C }).id;
    const fake = fakeEnrich({
      [URL_A]: { about: 'Guida il team data di Acme.', email: 'a@x.it' },
      [URL_B]: { about: 'Freelance.' },
    });

    const result = await enrichProspects({ prospectIds: [a, b, c] }, fake);

    expect(result.counts).toMatchObject({ targets: 3, enriched: 2, no_data: 1, with_email: 1, skipped_fresh: 0 });
    expect(row(a)).toMatchObject({ email: 'a@x.it', about: 'Guida il team data di Acme.' });
    expect(row(a).enriched_at).toBeTruthy();
    expect(row(b).enriched_at).toBeTruthy();
    expect(row(c).enrichment_attempted_at).toBeTruthy();
    expect(row(c).enriched_at).toBeNull();
    for (const id of [a, b, c]) expect(row(id).enrichment_attempted_at).toBeTruthy();
  });

  it('re-run: già arricchiti e tentati di recente senza esito sono saltati (nessuna chiamata al provider)', async () => {
    const a = upsertProspect({ linkedinUrl: URL_A }).id;
    const c = upsertProspect({ linkedinUrl: URL_C }).id;
    await enrichProspects({ prospectIds: [a, c] }, fakeEnrich({ [URL_A]: { about: 'Bio' } }));

    const again = fakeEnrich({ [URL_A]: { about: 'Bio' }, [URL_C]: { about: 'Ora pubblico' } });
    const result = await enrichProspects({ prospectIds: [a, c] }, again);

    expect(result.counts).toMatchObject({ selected: 2, targets: 0, enriched: 0, skipped_enriched: 1, skipped_fresh: 1 });
    expect(again.calls).toEqual([]);
    expect(result.summary).toMatch(/nessun profilo da arricchire/);
  });

  it('tentativo più vecchio di FRESHNESS_DAYS o `retryFailed` → riprovato; `onlyMissing:false` riarricchisce', async () => {
    const { config } = await import('../src/config.js');
    const a = upsertProspect({ linkedinUrl: URL_A }).id;
    const c = upsertProspect({ linkedinUrl: URL_C }).id;
    await enrichProspects({ prospectIds: [a, c] }, fakeEnrich({ [URL_A]: { about: 'Bio' } }));

    const retry = fakeEnrich({ [URL_C]: { about: 'Ora pubblico' } });
    expect((await enrichProspects({ prospectIds: [c], retryFailed: true }, retry)).counts).toMatchObject({ targets: 1, enriched: 1 });
    expect(retry.calls).toEqual([[URL_C]]);

    const old = new Date(Date.now() - (config.freshnessDays + 1) * 86_400_000).toISOString();
    db.prepare('UPDATE prospects SET enriched_at = NULL, enrichment_attempted_at = ? WHERE id = ?').run(old, c);
    const stale = fakeEnrich({});
    expect((await enrichProspects({ prospectIds: [c] }, stale)).counts).toMatchObject({ targets: 1, no_data: 1, skipped_fresh: 0 });

    const refresh = fakeEnrich({ [URL_A]: { about: 'Bio aggiornata' } });
    expect((await enrichProspects({ prospectIds: [a], onlyMissing: false }, refresh)).counts).toMatchObject({ enriched: 1 });
    expect(row(a).about).toBe('Bio aggiornata');
  });

  it('non azzera né sovrascrive email/telefono esistenti; i campi del profilo si aggiornano coi valori non vuoti', async () => {
    const b = upsertProspect({ linkedinUrl: URL_B, email: 'bruno@old.it', phone: '+39 333', headline: 'Vecchia', title: 'CTO' }).id;
    await enrichProspects(
      { prospectIds: [b] },
      fakeEnrich({ [URL_B]: { headline: 'Nuova headline', email: 'pubblica@x.it', title: '  ', about: 'Bio', raw: { experience: [] } } }),
    );
    expect(row(b)).toMatchObject({ email: 'bruno@old.it', phone: '+39 333', headline: 'Nuova headline', title: 'CTO', about: 'Bio' });
    expect(JSON.parse(row(b).raw_json)).toEqual({ experience: [] });

    // Nessun dato: l'email resta.
    await enrichProspects({ prospectIds: [b], onlyMissing: false }, fakeEnrich({}));
    expect(row(b).email).toBe('bruno@old.it');
  });

  it("identità: l'URL canonico (slug) sostituisce la forma id membro e il prospect arricchito assorbe il duplicato", async () => {
    const { addSource, getProspect } = await import('../src/db/prospects.js');
    const { createIcp } = await import('../src/db/icps.js');
    const { createList, addMembers } = await import('../src/db/lists.js');
    const URN = 'ACoAAFakeMember0001AbCdEfGhIjKl';
    const SLUG = 'https://www.linkedin.com/in/marco-esempio';
    const postId = Number(db.prepare('INSERT INTO posts (post_url) VALUES (?)').run('https://www.linkedin.com/posts/p-1').lastInsertRowid);
    const listId = createList({ icpId: createIcp({ name: 'CTO' }).id, name: 'CTO startup' })!.id;

    const a = upsertProspect({ linkedinUrl: `https://www.linkedin.com/in/${URN}`, fullName: 'Marco E.' }).id;
    addSource(a, { kind: 'post_reaction', postId, reactionType: 'LIKE' });
    const b = upsertProspect({ linkedinUrl: SLUG, email: 'marco@example.invalid' }).id;
    addSource(b, { kind: 'post_comment', postId, commentText: 'Anche noi!' });
    addMembers(listId, [b]);

    const fake = fakeEnrich({
      [`https://www.linkedin.com/in/${URN}`]: { canonicalUrl: SLUG, memberUrn: URN, fullName: 'Marco Esempio', about: 'CTO' },
    });
    const result = await enrichProspects({ prospectIds: [a] }, fake);

    expect(result.counts).toMatchObject({ enriched: 1, prospects_merged: 1, with_email: 1 });
    expect(db.prepare('SELECT COUNT(*) FROM prospects').pluck().get()).toBe(1);
    const merged = getProspect(a)!;
    expect(merged).toMatchObject({ linkedin_url: SLUG, member_urn: URN, full_name: 'Marco Esempio', email: 'marco@example.invalid' });
    expect(merged.sources.map((s) => s.kind).sort()).toEqual(['post_comment', 'post_reaction']);
    expect(merged.memberships.map((m) => m.list_id)).toEqual([listId]);
    expect(getProspect(b)).toBeFalsy();
  });

  it("attività `enrichment` con l'esito in timeline (arricchito / senza dati)", async () => {
    const { timeline } = await import('../src/db/activities.js');
    const a = upsertProspect({ linkedinUrl: URL_A }).id;
    const c = upsertProspect({ linkedinUrl: URL_C }).id;
    await enrichProspects({ prospectIds: [a, c] }, fakeEnrich({ [URL_A]: { email: 'a@x.it' } }));

    expect(timeline(a)).toEqual([expect.objectContaining({ kind: 'enrichment', meta: expect.objectContaining({ outcome: 'enriched', with_email: true }) })]);
    expect(timeline(c)).toEqual([expect.objectContaining({ kind: 'enrichment', meta: expect.objectContaining({ outcome: 'no_data' }) })]);
  });
});

describe('enrichProspects: errori, lista, azienda', () => {
  it("un profilo in errore non ferma il job: errore attribuito all'actor, nessun timbro del tentativo", async () => {
    const { timeline } = await import('../src/db/activities.js');
    const a = upsertProspect({ linkedinUrl: URL_A }).id;
    const b = upsertProspect({ linkedinUrl: URL_B }).id;
    const deps = {
      enrich: async (urls: string[]) => {
        if (urls[0] === URL_B) throw new Error('timeout della run');
        return new Map<string, Enrichment>([[urls[0], { about: 'Bio' }]]);
      },
    };

    const result = await enrichProspects({ prospectIds: [a, b] }, deps);

    expect(result.counts).toMatchObject({ targets: 2, enriched: 1, errors: 1 });
    expect(result.warnings).toHaveLength(1);
    expect(result.summary).toMatch(/1 in errore/);
    expect(row(b).enrichment_attempted_at).toBeNull();
    expect(timeline(b)[0]).toMatchObject({
      kind: 'enrichment',
      meta: { outcome: 'error', error: 'actor:apimaestro/linkedin-profile-detail: timeout della run' },
    });
  });

  it('tutti i profili in errore → il job fallisce con il messaggio actor; errore di config → fallisce subito', async () => {
    const a = upsertProspect({ linkedinUrl: URL_A }).id;
    const b = upsertProspect({ linkedinUrl: URL_B }).id;
    const down = { enrich: async () => Promise.reject(new Error('actor:apimaestro/linkedin-profile-detail: 502')) };
    await expect(enrichProspects({ prospectIds: [a, b] }, down)).rejects.toThrow(/^actor:apimaestro\/linkedin-profile-detail: 502/);

    const noToken = { enrich: async () => Promise.reject(new Error('config: APIFY_TOKEN mancante')) };
    await expect(enrichProspects({ prospectIds: [a] }, noToken)).rejects.toThrow(/^config: APIFY_TOKEN mancante/);
    await expect(enrichProspects({} as any, noToken)).rejects.toThrow(/^config: /);
  });

  it('realDeps senza APIFY_TOKEN → errore `config:` (nessuna chiamata Apify)', async () => {
    const { config } = await import('../src/config.js');
    const { realDeps } = await import('../src/jobs/enrich.js');
    const saved = config.apifyToken;
    config.apifyToken = '';
    try {
      await expect(realDeps().enrich([URL_A])).rejects.toThrow(/^config: APIFY_TOKEN mancante/);
    } finally {
      config.apifyToken = saved;
    }
  });

  it('ambito lista: membri non arricchiti; lista archiviata → errore `config:`', async () => {
    const { createIcp } = await import('../src/db/icps.js');
    const { createList, addMembers, updateList } = await import('../src/db/lists.js');
    const listId = createList({ icpId: createIcp({ name: 'CTO' }).id, name: 'CTO startup' })!.id;
    const a = upsertProspect({ linkedinUrl: URL_A }).id;
    const b = upsertProspect({ linkedinUrl: URL_B, enrichedAt: '2026-09-01T00:00:00.000Z' }).id;
    upsertProspect({ linkedinUrl: URL_C });
    addMembers(listId, [a, b]);

    const fake = fakeEnrich({ [URL_A]: { about: 'Bio' } });
    const result = await enrichProspects({ listId, onlyMissing: true }, fake);
    expect(result.counts).toMatchObject({ selected: 2, targets: 1, enriched: 1, skipped_enriched: 1 });
    expect(fake.calls).toEqual([[URL_A]]);

    updateList(listId, { archived: true });
    await expect(enrichProspects({ listId }, fake)).rejects.toThrow(/^config: la lista "CTO startup" è archiviata/);
  });

  it("aggancia l'azienda in anagrafica per URL o nome univoco, senza sovrascrivere un collegamento esistente", async () => {
    const { createCompany } = await import('../src/db/companies.js');
    const acme = createCompany({ linkedin_url: 'https://www.linkedin.com/company/acme', name: 'Acme' });
    const beta = createCompany({ linkedin_url: 'https://www.linkedin.com/company/beta-srl', name: 'Beta' });
    const a = upsertProspect({ linkedinUrl: URL_A }).id;
    const b = upsertProspect({ linkedinUrl: URL_B }).id;
    const c = upsertProspect({ linkedinUrl: URL_C, companyId: beta.id }).id;

    await enrichProspects(
      { prospectIds: [a, b, c] },
      fakeEnrich({
        [URL_A]: { company: 'ACME', about: 'x' },
        [URL_B]: { company: 'Altro nome', companyUrl: 'https://it.linkedin.com/company/beta-srl/', about: 'x' },
        [URL_C]: { company: 'Acme', about: 'x' },
      }),
    );
    expect(row(a)).toMatchObject({ company_id: acme.id, company_name: 'ACME' });
    expect(row(b).company_id).toBe(beta.id);
    expect(row(c).company_id).toBe(beta.id);
  });
});

describe('enrichOneInline (per T11 enrichFirst)', () => {
  it('esiti enriched / no_data / error / not_found; ignora la freschezza', async () => {
    const { enrichOneInline } = await import('../src/jobs/enrich.js');
    const a = upsertProspect({ linkedinUrl: URL_A }).id;
    const c = upsertProspect({ linkedinUrl: URL_C, enrichmentAttemptedAt: new Date().toISOString() }).id;

    expect(await enrichOneInline(a, fakeEnrich({ [URL_A]: { email: 'a@x.it', about: 'Bio' } }))).toEqual({
      prospectId: a,
      outcome: 'enriched',
      withEmail: true,
      mergedIds: [],
    });
    const fake = fakeEnrich({});
    expect(await enrichOneInline(c, fake)).toMatchObject({ prospectId: c, outcome: 'no_data', withEmail: false });
    expect(fake.calls).toEqual([[URL_C]]);

    const failing = { enrich: async () => Promise.reject(new Error('boom')) };
    expect(await enrichOneInline(c, failing)).toMatchObject({
      outcome: 'error',
      error: 'actor:apimaestro/linkedin-profile-detail: boom',
    });
    expect(await enrichOneInline(999_999, fake)).toMatchObject({ prospectId: 999_999, outcome: 'not_found' });
  });

  it('`timeoutMs`: provider troppo lento → error senza scritture', async () => {
    const { enrichOneInline } = await import('../src/jobs/enrich.js');
    const a = upsertProspect({ linkedinUrl: URL_A }).id;
    const slow = {
      enrich: () => new Promise<Map<string, Enrichment>>((r) => setTimeout(() => r(new Map([[URL_A, { about: 'tardi' }]])), 200)),
    };
    const r = await enrichOneInline(a, slow, { timeoutMs: 20 });
    expect(r).toMatchObject({ outcome: 'error', error: expect.stringMatching(/^actor:.*nessuna risposta/) });
    await new Promise((res) => setTimeout(res, 250));
    expect(row(a)).toMatchObject({ about: null, enriched_at: null, enrichment_attempted_at: null });
  });
});

const { createApp } = await import('../src/server/app.js');
const jobs = await import('../src/server/jobs.js');
const { config } = await import('../src/config.js');

describe('API enrichment', () => {
  type JobBody = { job: import('../src/server/jobs.js').Job };
  type Preview = import('../src/jobs/types.js').JobPreview;
  const previewOf = async (path: string) => (await (await app.request(path)).json()) as Preview;

  /** Figlio fittizio che resta vivo 200 ms (il job risulta in corso) ed esce: nessun handler reale, nessun Apify. */
  const app = createApp({ jobs: { command: 'node', args: ['-e', 'setTimeout(() => {}, 200)'] } });
  const post = (path: string, body?: unknown) =>
    app.request(path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    });

  async function waitTerminal(id: number) {
    const deadline = Date.now() + 5000;
    while (jobs.getJob(id)?.state === 'running') {
      if (Date.now() > deadline) throw new Error(`job ${id} ancora running`);
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  async function makeList() {
    const { createIcp } = await import('../src/db/icps.js');
    const { createList } = await import('../src/db/lists.js');
    return createList({ icpId: createIcp({ name: 'CTO' }).id, name: 'CTO startup' })!.id;
  }

  it('preview con prezzo non configurato → est_cost_usd null e warning "stima non disponibile"', async () => {
    const a = upsertProspect({ linkedinUrl: URL_A }).id;
    const b = upsertProspect({ linkedinUrl: URL_B, enrichedAt: '2026-09-01T00:00:00.000Z' }).id;
    const c = upsertProspect({ linkedinUrl: URL_C, enrichmentAttemptedAt: new Date().toISOString() }).id;
    expect(config.prices.profileDetailUsd).toBeNull();

    const res = await app.request(`/api/enrich/preview?prospectIds=${a},${b},${c},999999`);
    expect(res.status).toBe(200);
    const preview = await res.json();
    expect(preview).toEqual({
      counts: { selected: 3, targets: 1, skipped_enriched: 1, skipped_fresh: 1, not_found: 1 },
      est_cost_usd: null,
      warnings: [expect.stringMatching(/stima non disponibile/)],
      blockers: [],
    });

    const retry = await previewOf(`/api/enrich/preview?prospectIds=${a}&prospectIds=${c}&retryFailed=true`);
    expect(retry.counts).toMatchObject({ selected: 2, targets: 2, skipped_fresh: 0 });
  });

  it('preview con prezzo configurato → targets × prezzo; lista: 404 se inesistente, blocker se archiviata', async () => {
    const { addMembers, updateList } = await import('../src/db/lists.js');
    const listId = await makeList();
    addMembers(listId, [upsertProspect({ linkedinUrl: URL_A }).id, upsertProspect({ linkedinUrl: URL_B }).id]);
    const saved = config.prices.profileDetailUsd;
    config.prices.profileDetailUsd = 0.01;
    try {
      const preview = await previewOf(`/api/enrich/preview?listId=${listId}`);
      expect(preview).toMatchObject({ counts: { selected: 2, targets: 2 }, est_cost_usd: 0.02, warnings: [], blockers: [] });
    } finally {
      config.prices.profileDetailUsd = saved;
    }

    expect((await app.request('/api/enrich/preview?listId=999999')).status).toBe(404);
    expect((await app.request('/api/enrich/preview')).status).toBe(400);
    expect((await app.request(`/api/enrich/preview?listId=${listId}&prospectIds=1`)).status).toBe(400);
    expect((await app.request('/api/enrich/preview?prospectIds=abc')).status).toBe(400);

    updateList(listId, { archived: true });
    const archived = await previewOf(`/api/enrich/preview?listId=${listId}`);
    expect(archived.blockers).toEqual([expect.stringMatching(/^Lista archiviata/)]);
    const start = await post(`/api/lists/${listId}/enrich`, { onlyMissing: true });
    expect(start.status).toBe(400);
    expect(await start.json()).toMatchObject({ code: 'blocked', blockers: archived.blockers });
  });

  it('POST /api/prospects/:id/enrich → 202 job enrich con params espliciti; 404 se inesistente', async () => {
    const a = upsertProspect({ linkedinUrl: URL_A }).id;
    expect((await post('/api/prospects/999999/enrich')).status).toBe(404);

    const res = await post(`/api/prospects/${a}/enrich`);
    expect(res.status).toBe(202);
    const { job } = (await res.json()) as JobBody;
    expect(job).toMatchObject({ kind: 'enrich', state: 'running', params: { prospectIds: [a], onlyMissing: true, retryFailed: false } });

    // Job in corso → preview con blocker (l'avvio risponde 409 `job_running`, vedi test dedicato).
    const preview = await previewOf(`/api/enrich/preview?prospectIds=${a}`);
    expect(preview.blockers).toEqual([expect.stringMatching(/^C'è già un job in corso: Arricchimento/)]);
    await waitTerminal(job.id);
  });

  it('POST /api/enrich {prospectIds} e /api/lists/:id/enrich → 202; body non valido 400; lista inesistente 404', async () => {
    const a = upsertProspect({ linkedinUrl: URL_A }).id;
    const listId = await makeList();

    const bulk = await post('/api/enrich', { prospectIds: [a], retryFailed: true });
    expect(bulk.status).toBe(202);
    const { job } = (await bulk.json()) as JobBody;
    expect(job.params).toEqual({ prospectIds: [a], onlyMissing: true, retryFailed: true });
    await waitTerminal(job.id);

    expect((await post('/api/enrich', { prospectIds: [] })).status).toBe(400);
    expect((await post('/api/enrich', { prospectIds: [a], extra: 1 })).status).toBe(400);
    expect((await post('/api/lists/999999/enrich', { onlyMissing: true })).status).toBe(404);

    const list = await post(`/api/lists/${listId}/enrich`, { onlyMissing: false });
    expect(list.status).toBe(202);
    const listJob = ((await list.json()) as JobBody).job;
    expect(listJob.params).toEqual({ listId, onlyMissing: false, retryFailed: false });
    await waitTerminal(listJob.id);
  });

  it('solo un job in corso → blocker in preview ma avvio 409 `job_running` da launchJob (T6, FLOW)', async () => {
    const { insertJob, setJobPid, completeJob } = await import('../src/db/jobs.js');
    const a = upsertProspect({ linkedinUrl: URL_A }).id;
    const running = insertJob('sync_interactions', {});
    setJobPid(running.id, process.pid);
    try {
      const preview = await previewOf(`/api/enrich/preview?prospectIds=${a}`);
      expect(preview.blockers).toEqual([expect.stringMatching(/^C'è già un job in corso/)]);
      const res = await post('/api/enrich', { prospectIds: [a] });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: 'job_running', job_id: running.id });
    } finally {
      completeJob(running.id, { state: 'failed', error: 'process: fine test' });
    }
  });

  it('APIFY_TOKEN mancante → blocker in preview e avvio rifiutato (400 `blocked`), nessun job creato', async () => {
    const a = upsertProspect({ linkedinUrl: URL_A }).id;
    const saved = config.apifyToken;
    config.apifyToken = '';
    try {
      const preview = await previewOf(`/api/enrich/preview?prospectIds=${a}`);
      expect(preview.blockers).toEqual([expect.stringMatching(/APIFY_TOKEN mancante/)]);
      const res = await post('/api/enrich', { prospectIds: [a] });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'blocked', blockers: preview.blockers });
      expect(db.prepare('SELECT COUNT(*) FROM jobs').pluck().get()).toBe(0);
    } finally {
      config.apifyToken = saved;
    }
  });

  it('handler registrato: il wrapper del job esegue enrich con deps fake e scrive summary e counts', async () => {
    const { runJob } = await import('../src/server/job-entry.js');
    const { insertJob } = await import('../src/db/jobs.js');
    const a = upsertProspect({ linkedinUrl: URL_A }).id;
    const b = upsertProspect({ linkedinUrl: URL_B }).id;
    const job = insertJob('enrich', { prospectIds: [a, b], onlyMissing: true, retryFailed: false });

    const done = await runJob(job.id, { resolveDeps: () => fakeEnrich({ [URL_A]: { email: 'a@x.it' } }) });

    expect(done.state).toBe('succeeded');
    expect(done.result?.counts).toMatchObject({ enriched: 1, no_data: 1, with_email: 1 });
    expect(done.result?.summary).toBe('Arricchimento: 1 arricchito (1 con email) · 1 senza dati sul profilo.');
  });
});
