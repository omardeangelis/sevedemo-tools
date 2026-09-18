import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

// Controller dei job (crm-foundation T6). Import dinamici: la config (DB_PATH isolato
// da tests/setup.ts) è letta a import-time. Mai handler reali: i figli sono comandi
// `node -e` brevissimi, l'esito "succeeded" si prova con `runJob` in-process.
const jobs = await import('../src/server/jobs.js');
const { createApp } = await import('../src/server/app.js');

/** Attende che il job esca da `running` (il figlio è terminato e il parent l'ha visto). */
async function waitTerminal(id: number, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = jobs.getJob(id);
    if (job && job.state !== 'running') return job;
    if (Date.now() > deadline) throw new Error(`job ${id} ancora running dopo ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('wrapper del processo figlio (runJob in-process)', () => {
  it('handler che risolve → succeeded con result; riceve i params salvati e le deps risolte', async () => {
    const { runJob } = await import('../src/server/job-entry.js');
    const { insertJob } = await import('../src/db/jobs.js');
    const row = insertJob('enrich', { prospectIds: [7, 8] });
    const seen: unknown[] = [];

    const done = await runJob(row.id, {
      resolveDeps: (kind) => ({ fake: kind }),
      handlers: {
        enrich: async (params, deps) => {
          seen.push(params, deps);
          return { summary: 'Arricchiti 2 prospect', counts: { enriched: 2 }, warnings: [] };
        },
      },
    });

    expect(seen).toEqual([{ prospectIds: [7, 8] }, { fake: 'enrich' }]);
    expect(done.state).toBe('succeeded');
    expect(done.result?.summary).toBe('Arricchiti 2 prospect');
    expect(done.error).toBeNull();
    expect(done.finished_at).toBeTruthy();
  });

  it('errori attribuiti: `actor:`/`config:` restano, il resto (anche deps che lanciano) diventa `process:`', async () => {
    const { runJob } = await import('../src/server/job-entry.js');
    const { insertJob } = await import('../src/db/jobs.js');
    const fail = (message: string) => async () => {
      throw new Error(message);
    };

    const actor = await runJob(insertJob('sync_interactions', {}).id, {
      resolveDeps: () => ({}),
      handlers: { sync_interactions: fail('actor:apimaestro/linkedin-profile-posts: 502') },
    });
    expect(actor.state).toBe('failed');
    expect(actor.error).toBe('actor:apimaestro/linkedin-profile-posts: 502');
    expect(actor.result).toBeNull();

    const cfg = await runJob(insertJob('sync_interactions', {}).id, {
      resolveDeps: () => ({}),
      handlers: { sync_interactions: fail('config: Salva il tuo profilo LinkedIn nelle Impostazioni') },
    });
    expect(cfg.error).toBe('config: Salva il tuo profilo LinkedIn nelle Impostazioni');

    const generic = await runJob(insertJob('analyze', {}).id, {
      resolveDeps: () => {
        throw new Error('boom');
      },
    });
    expect(generic.state).toBe('failed');
    expect(generic.error).toBe('process: boom');
  });
});

describe('controller job', () => {
  it('figlio che esce senza esito → running con pid, poi failed con errore `process:`', async () => {
    const job = jobs.startJob('enrich', { prospectIds: [1] }, { command: 'node', args: ['-e', ''] });
    expect(job.state).toBe('running');
    expect(job.kind).toBe('enrich');
    expect(job.params).toEqual({ prospectIds: [1] });
    expect(job.pid).toBeTypeOf('number');

    await waitTerminal(job.id);
    const current = jobs.getCurrentJob();
    expect(current?.id).toBe(job.id);
    expect(current?.state).toBe('failed');
    expect(current?.error).toMatch(/^process: /);
    expect(current?.finished_at).toBeTruthy();
  });

  it('un solo job alla volta: il secondo start lancia JobRunningError e la preview ha il blocker', async () => {
    expect(jobs.runningJobBlocker()).toBeNull();

    const first = jobs.startJob('sync_interactions', {}, { command: 'node', args: ['-e', 'setTimeout(() => {}, 400)'] });
    let conflict: unknown;
    try {
      jobs.startJob('enrich', { prospectIds: [2] }, { command: 'node', args: ['-e', ''] });
    } catch (err) {
      conflict = err;
    }
    expect(conflict).toBeInstanceOf(jobs.JobRunningError);
    expect((conflict as InstanceType<typeof jobs.JobRunningError>).job.id).toBe(first.id);
    expect(jobs.runningJobBlocker()).toMatch(/^C'è già un job in corso: Sync interazioni, avviato /);

    await waitTerminal(first.id);
    expect(jobs.runningJobBlocker()).toBeNull();
  });

  it('`process.exit(1)` senza esito → failed con errore `process:` che cita l\'exit code', async () => {
    const job = jobs.startJob('source_company', { companyId: 1, listId: 1 }, {
      command: 'node',
      args: ['-e', 'process.exit(1)'],
    });
    const done = await waitTerminal(job.id);
    expect(done.state).toBe('failed');
    expect(done.error).toMatch(/^process: .*exit 1/);
    expect(done.result).toBeNull();
  });

  it('il figlio che scrive il proprio esito vince sull\'handler di uscita; riceve l\'id come ultimo arg e JOB_ID', async () => {
    // Imita il wrapper: scrive `succeeded` + result sulla riga indicata, poi esce con 0.
    const child = `
      const Database = require('better-sqlite3');
      const id = Number(process.argv.at(-1));
      if (id !== Number(process.env.JOB_ID)) process.exit(3);
      const db = new Database(process.env.DB_PATH);
      db.prepare("UPDATE jobs SET state = 'succeeded', result = ?, finished_at = ? WHERE id = ?")
        .run(JSON.stringify({ summary: 'Fatto: 2 prospect', counts: { enriched: 2 } }), new Date().toISOString(), id);
      db.close();
    `;
    const job = jobs.startJob('enrich', { prospectIds: [1, 2] }, { command: 'node', args: ['-e', child] });
    const done = await waitTerminal(job.id);
    expect(done.state).toBe('succeeded');
    expect(done.error).toBeNull();
    expect(done.result).toEqual({ summary: 'Fatto: 2 prospect', counts: { enriched: 2 } });
  });

  it('riga running con pid morto (es. server riavviato) → failed "processo non più attivo", persistito', async () => {
    const { insertJob, setJobPid, findJob } = await import('../src/db/jobs.js');
    // Un processo già terminato fornisce un pid sicuramente morto.
    const dead = spawnSync(process.execPath, ['-e', '']);
    const orphan = insertJob('analyze', { listId: 3 });
    setJobPid(orphan.id, dead.pid!);

    const current = jobs.getCurrentJob();
    expect(current?.id).toBe(orphan.id);
    expect(current?.state).toBe('failed');
    expect(current?.error).toMatch(/^process: .*processo non più attivo/);
    expect(findJob(orphan.id)?.state).toBe('failed');
    expect(jobs.runningJobBlocker()).toBeNull();
  });
});

describe('API job', () => {
  type JobBody = { job: import('../src/server/jobs.js').Job };

  /** App con una route di avvio di prova che usa `launchJob`, come faranno T8–T11. */
  function appWith(args: string[]) {
    const app = createApp({ jobs: { command: 'node', args } });
    app.post('/api/__start', async (c) => jobs.launchJob(c, 'enrich', await c.req.json()));
    return app;
  }
  const post = (app: ReturnType<typeof createApp>, path: string, body?: unknown) =>
    app.request(path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    });

  it('due POST di avvio concorrenti → 202 {job} e 409 job_running con job_id', async () => {
    const app = appWith(['-e', 'setTimeout(() => {}, 300)']);
    const [a, b] = await Promise.all([
      post(app, '/api/__start', { prospectIds: [1] }),
      post(app, '/api/__start', { prospectIds: [2] }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([202, 409]);
    const ok = (a.status === 202 ? a : b) as Response;
    const ko = (a.status === 202 ? b : a) as Response;
    const { job } = (await ok.json()) as JobBody;
    expect(job.state).toBe('running');
    expect(await ko.json()).toEqual({
      error: expect.stringMatching(/^C'è già un job in corso: Arricchimento, /),
      code: 'job_running',
      job_id: job.id,
    });

    const current = await (await app.request('/api/jobs/current')).json();
    expect(current).toEqual({ job: expect.objectContaining({ id: job.id, state: 'running' }) });
    await waitTerminal(job.id);
  });

  it('GET /api/jobs/:id, /api/jobs?limit (dal più recente, max 100) e 404', async () => {
    const app = createApp();
    const { insertJob, completeJob } = await import('../src/db/jobs.js');
    const a = insertJob('enrich', { prospectIds: [1] });
    completeJob(a.id, { state: 'succeeded', result: { summary: 'ok', counts: {} } });
    const b = insertJob('analyze', { listId: 2, onlyMissing: true });
    completeJob(b.id, { state: 'failed', error: 'process: boom' });

    const one = await app.request(`/api/jobs/${a.id}`);
    expect(one.status).toBe(200);
    expect(await one.json()).toMatchObject({ id: a.id, kind: 'enrich', state: 'succeeded', params: { prospectIds: [1] }, result: { summary: 'ok', counts: {} } });

    const list = (await (await app.request('/api/jobs?limit=2')).json()) as { items: Array<{ id: number }> };
    expect(list.items.map((j) => j.id)).toEqual([b.id, a.id]);
    const capped = (await (await app.request('/api/jobs?limit=5000')).json()) as { items: unknown[] };
    expect(capped.items.length).toBeLessThanOrEqual(100);

    expect((await app.request('/api/jobs/999999')).status).toBe(404);
    expect((await app.request('/api/jobs/abc')).status).toBe(404);
  });

  it('POST /api/jobs/:id/retry: failed → 202 nuova riga running con params identici; altrimenti 409/404', async () => {
    const { insertJob, completeJob } = await import('../src/db/jobs.js');
    const { createIcp } = await import('../src/db/icps.js');
    const { createList } = await import('../src/db/lists.js');
    const app = appWith(['-e', 'setTimeout(() => {}, 300)']);
    // Lista reale: una lista inesistente è un blocker del retry (apollo-lookalike T6).
    const list = createList({ icpId: createIcp({ name: 'ICP retry base' }).id, name: 'Lista retry base' })!;
    const params = { listId: list.id, onlyMissing: true, force: false };
    const failed = insertJob('analyze', params);
    completeJob(failed.id, { state: 'failed', error: 'actor:x: giù' });
    const succeeded = insertJob('enrich', { prospectIds: [9] });
    completeJob(succeeded.id, { state: 'succeeded', result: { summary: 'ok', counts: {} } });

    const notFailed = await post(app, `/api/jobs/${succeeded.id}/retry`);
    expect(notFailed.status).toBe(409);
    expect(await notFailed.json()).toMatchObject({ code: 'job_not_failed' });
    expect((await post(app, '/api/jobs/999999/retry')).status).toBe(404);

    const res = await post(app, `/api/jobs/${failed.id}/retry`);
    expect(res.status).toBe(202);
    const { job } = (await res.json()) as JobBody;
    expect(job.id).not.toBe(failed.id);
    expect(job.kind).toBe('analyze');
    expect(job.state).toBe('running');
    expect(job.params).toEqual(params);
    expect(jobs.getJob(failed.id)?.state).toBe('failed');

    const busy = await post(app, `/api/jobs/${failed.id}/retry`);
    expect(busy.status).toBe(409);
    expect(await busy.json()).toMatchObject({ code: 'job_running', job_id: job.id });
    await waitTerminal(job.id);
  });
});

// Fixture del retry con blocker (apollo-lookalike T6): import dinamici per la stessa ragione di sopra.
const { APOLLO_KEY_BLOCKER, config } = await import('../src/config.js');
const { db } = await import('../src/db/index.js');
const { insertJob, completeJob, findJob } = await import('../src/db/jobs.js');
const { createIcp } = await import('../src/db/icps.js');
const { createList, updateList, addMembers } = await import('../src/db/lists.js');
const { createCompany, updateCompany } = await import('../src/db/companies.js');
const { upsertProspect } = await import('../src/db/prospects.js');
const { updateSettings } = await import('../src/db/settings.js');
const { archivedListText, NO_LINKEDIN_BLOCKER } = await import('../src/jobs/source-company.js');
const { EMPTY_FILTERS } = await import('../src/jobs/lookalike-companies.js');
const { ICP_MISSING_BLOCKER } = await import('../src/jobs/types.js');
type JobKind = import('../src/jobs/types.js').JobKind;

describe('"Riprova" ripassa dai blocker di configurazione (apollo-lookalike T6, TD-25)', () => {
  // Il figlio esce subito senza esito: nessun handler reale, il job torna `failed` da solo.
  const app = createApp({ jobs: { command: 'node', args: ['-e', ''] } });
  let seq = 0;

  function failedJob(kind: JobKind, params: object): number {
    const row = insertJob(kind, params);
    completeJob(row.id, { state: 'failed', error: 'actor:x: giù' });
    return row.id;
  }
  const jobCount = () => (db.prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number }).n;
  const retry = (id: number) => app.request(`/api/jobs/${id}/retry`, { method: 'POST' });

  /** Retry → 400 `blocked` con esattamente questi blocker, nessuna riga nuova; la preview del kind ha gli stessi testi. */
  async function expectBlocked(id: number, blockers: string[], previewPath?: string) {
    const before = jobCount();
    const res = await retry(id);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: `Riprova bloccata: ${blockers.join(' ')}`, code: 'blocked', blockers });
    expect(jobCount()).toBe(before);
    if (previewPath) {
      const preview = await app.request(previewPath);
      expect(preview.status).toBe(200);
      expect(((await preview.json()) as { blockers: string[] }).blockers).toEqual(expect.arrayContaining(blockers));
    }
  }

  /** Retry → 202 con kind e params identici; attende l'uscita del figlio (un job alla volta). */
  async function expectRetried(id: number) {
    const res = await retry(id);
    expect(res.status).toBe(202);
    const { job } = (await res.json()) as { job: import('../src/server/jobs.js').Job };
    const source = findJob(id)!;
    expect(job.id).not.toBe(id);
    expect(job.kind).toBe(source.kind);
    expect(job.params).toEqual(source.params);
    await waitTerminal(job.id);
  }

  /** Chiavi della config azzerate per la durata di `fn`, ripristinate anche se un'asserzione fallisce. */
  async function without(keys: Array<'apifyToken' | 'anthropicApiKey' | 'apolloApiKey'>, fn: () => Promise<void>) {
    const saved = keys.map((k) => config[k]);
    for (const k of keys) config[k] = '';
    try {
      await fn();
    } finally {
      keys.forEach((k, i) => (config[k] = saved[i]));
    }
  }

  function icpWithList(archived = false) {
    seq += 1;
    const icp = createIcp({ name: `ICP retry ${seq}`, target_roles: ['CTO'] });
    const list = createList({ icpId: icp.id, name: `Lista retry ${seq}` })!;
    if (archived) updateList(list.id, { archived: true });
    return { icp, list };
  }

  it('enrich: lista archiviata → 400 blocked senza nuovo job; riattivata → 202', async () => {
    const { list } = icpWithList(true);
    const id = failedJob('enrich', { listId: list.id, provider: 'apify', onlyMissing: true, retryFailed: false });
    const preview = `/api/enrich/preview?listId=${list.id}`;
    const archived = 'Lista archiviata: arricchimento disabilitato (lettura ed export restano possibili).';

    await expectBlocked(id, [archived], preview);
    await without(['apifyToken'], () =>
      expectBlocked(id, ['APIFY_TOKEN mancante nel .env — nessun job avviato.', archived], preview),
    );
    updateList(list.id, { archived: false });
    await expectRetried(id);

    // AL-TD-4: lista cancellata dopo il job → "Riprova" bloccata invece di un nuovo job che fallisce subito.
    await expectBlocked(failedJob('enrich', { listId: 999_999, provider: 'apify', onlyMissing: true, retryFailed: false }), [
      'Lista non trovata.',
    ]);
  });

  it('sync_interactions: profilo non salvato e token Apify mancante → blocked; configurati → 202', async () => {
    const id = failedJob('sync_interactions', { force: false, postsOnly: false });
    try {
      await without(['apifyToken'], () =>
        expectBlocked(
          id,
          ['Salva prima il tuo profilo LinkedIn nelle Impostazioni.', 'APIFY_TOKEN mancante nel .env — nessun job avviato.'],
          '/api/sync/preview',
        ),
      );
      updateSettings({ own_profile_url: 'https://www.linkedin.com/in/omar-retry' });
      await expectRetried(id);
    } finally {
      updateSettings({ own_profile_url: null });
    }
  });

  it('source_company: azienda senza LinkedIn, lista archiviata o azienda sparita → blocked; sistemate → 202', async () => {
    const { list } = icpWithList(true);
    const company = createCompany({ website: `https://retry-${seq}.it` });
    const params = { companyId: company.id, listId: list.id, roles: ['CTO'], locations: [], maxItems: 10, mode: 'Short' };
    const id = failedJob('source_company', params);
    const preview = `/api/companies/${company.id}/source/preview?listId=${list.id}`;

    await expectBlocked(id, [NO_LINKEDIN_BLOCKER, archivedListText(list.name)], preview);
    await without(['apifyToken'], () =>
      expectBlocked(
        id,
        [NO_LINKEDIN_BLOCKER, 'APIFY_TOKEN mancante nel .env — nessun job avviato.', archivedListText(list.name)],
        preview,
      ),
    );
    updateCompany(company.id, { linkedin_url: `https://www.linkedin.com/company/retry-${seq}` });
    updateList(list.id, { archived: false });
    await expectRetried(id);

    await expectBlocked(failedJob('source_company', { ...params, companyId: 999_999 }), ['Azienda non trovata.']);
    await expectBlocked(failedJob('source_company', { ...params, listId: 999_999 }), ['La lista di destinazione non esiste.']);
  });

  it('analyze: chiave Anthropic, lista archiviata, Apify per i da arricchire, lista/ICP spariti → blocked; sistemati → 202', async () => {
    const { list } = icpWithList(true);
    const { id: prospectId } = upsertProspect({ linkedinUrl: `https://www.linkedin.com/in/retry-analisi-${seq}`, fullName: 'Da Arricchire' });
    addMembers(list.id, [prospectId]);
    const id = failedJob('analyze', { listId: list.id, onlyMissing: true, force: false });
    const preview = `/api/analyze/preview?listId=${list.id}`;
    const anthropic = 'ANTHROPIC_API_KEY mancante nel .env — nessuna analisi avviata.';
    const archived = 'Lista archiviata: analisi disabilitata (lettura ed export restano possibili).';
    const apify = "APIFY_TOKEN mancante nel .env: 1 prospect vanno arricchiti prima dell'analisi — nessun job avviato.";

    await without(['anthropicApiKey', 'apifyToken'], () => expectBlocked(id, [anthropic, archived, apify], preview));
    await expectBlocked(id, [archived], preview);
    updateList(list.id, { archived: false });
    await expectRetried(id);

    await expectBlocked(failedJob('analyze', { listId: 999_999, onlyMissing: true, force: false }), ['Lista non trovata.']);
    await expectBlocked(failedJob('analyze', { prospectIds: [prospectId], icpId: 999_999, onlyMissing: false, force: false }), [
      'ICP non trovato.',
    ]);
  });

  it('enrich_companies: chiave Apollo mancante → blocked; ripristinata → 202', async () => {
    const { icp } = icpWithList();
    const id = failedJob('enrich_companies', { companyIds: [], icpId: icp.id, retryNotFound: false });
    await without(['apolloApiKey'], () => expectBlocked(id, [APOLLO_KEY_BLOCKER], `/api/icps/${icp.id}/enrich-companies/preview`));
    await expectRetried(id);

    // AL-TD-4: ICP cancellato dopo il job → "Riprova" bloccata.
    await expectBlocked(failedJob('enrich_companies', { companyIds: [], icpId: 999_999, retryNotFound: false }), [ICP_MISSING_BLOCKER]);
  });

  it('lookalike_companies: chiave Apollo mancante o filtri vuoti → blocked; chiave ripristinata → 202', async () => {
    const { icp } = icpWithList();
    const base = {
      icpId: icp.id,
      pages: 1,
      perPage: 25,
      startPage: 1,
      keywords: ['saas'],
      ranges: [],
      locations: [],
      filtersHash: 'retry',
      restart: false,
      autoContacts: null,
    };
    const id = failedJob('lookalike_companies', base);
    await without(['apolloApiKey'], () =>
      expectBlocked(id, [APOLLO_KEY_BLOCKER], `/api/icps/${icp.id}/lookalike/preview?custom=1&keywords=saas`),
    );
    await expectRetried(id);
    await expectBlocked(failedJob('lookalike_companies', { ...base, keywords: [] }), [EMPTY_FILTERS], `/api/icps/${icp.id}/lookalike/preview?custom=1`);
    // AL-TD-4: ICP cancellato dopo il job → "Riprova" bloccata.
    await expectBlocked(failedJob('lookalike_companies', { ...base, icpId: 999_999 }), [ICP_MISSING_BLOCKER]);
  });

  it('apollo_people: chiave Apollo mancante e lista archiviata → blocked; sistemate → 202', async () => {
    const { icp, list } = icpWithList(true);
    const company = createCompany({ website: `https://contatti-retry-${seq}.it` });
    const params = { icpId: icp.id, companyIds: [company.id], listId: list.id, roles: ['CTO'], seniorities: [], locations: [], perCompany: 3 };
    const id = failedJob('apollo_people', params);
    const preview = `/api/icps/${icp.id}/contacts/preview?companyIds=${company.id}&listId=${list.id}`;

    await without(['apolloApiKey'], () => expectBlocked(id, [APOLLO_KEY_BLOCKER, archivedListText(list.name)], preview));
    updateList(list.id, { archived: false });
    await expectRetried(id);
  });
});

describe('resolveDeps', () => {
  /** Esito di una factory di deps, confrontabile: messaggio d'errore o chiavi dell'oggetto. */
  function outcome(factory: () => unknown) {
    try {
      const deps = factory() as object;
      return { keys: Object.keys(deps).sort() };
    } catch (err) {
      return { threw: (err as Error).constructor.name, message: (err as Error).message };
    }
  }

  it('con E2E_FAKE_JOBS=1 usa fakeDeps(kind), altrimenti REAL_DEPS[kind]()', async () => {
    const { resolveDeps } = await import('../src/jobs/deps.js');
    const { fakeDeps } = await import('../src/jobs/fake-deps.js');
    const { REAL_DEPS } = await import('../src/jobs/handlers.js');
    const { JOB_KINDS } = await import('../src/jobs/types.js');
    const previous = process.env.E2E_FAKE_JOBS;
    try {
      for (const kind of JOB_KINDS) {
        process.env.E2E_FAKE_JOBS = '1';
        const fake = outcome(() => resolveDeps(kind));
        expect(fake).toEqual(outcome(() => fakeDeps(kind)));
        // Oggi gli stub di T3 lanciano NotImplementedError con messaggi distinti
        // (fake "T20" vs reali "T8–T11"): il confronto distingue i due rami.
        delete process.env.E2E_FAKE_JOBS;
        const real = outcome(() => resolveDeps(kind));
        expect(real).toEqual(outcome(() => REAL_DEPS[kind]()));
        if ('threw' in fake && 'threw' in real) expect(fake.message).not.toBe(real.message);
      }
    } finally {
      if (previous === undefined) delete process.env.E2E_FAKE_JOBS;
      else process.env.E2E_FAKE_JOBS = previous;
    }
  });
});
