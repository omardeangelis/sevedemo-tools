import { afterAll, beforeEach, describe, expect, it } from 'vitest';

// Deps fake del server e2e (crm-foundation T20): i job girano davvero (mapper, DB, esiti) su item
// delle fixture `tests/fixtures/e2e/`. `E2E_FAKE_JOBS=1` prima degli import: il dispatcher lo legge a
// ogni chiamata, ma così vale per tutto il file. Import dinamici: la config (DB_PATH isolato da
// tests/setup.ts) è letta a import-time.
const previousFake = process.env.E2E_FAKE_JOBS;
process.env.E2E_FAKE_JOBS = '1';
afterAll(() => {
  if (previousFake === undefined) delete process.env.E2E_FAKE_JOBS;
  else process.env.E2E_FAKE_JOBS = previousFake;
  delete process.env.JOB_ID;
});

const { resolveDeps } = await import('../src/jobs/deps.js');
const { HANDLERS } = await import('../src/jobs/handlers.js');
const { resetE2eData, seedE2eData } = await import('../src/jobs/fake-deps.js');
const { insertJob } = await import('../src/db/jobs.js');
const { runJob } = await import('../src/server/job-entry.js');
const { createApp } = await import('../src/server/app.js');
const { db } = await import('../src/db/index.js');
const { updateSettings } = await import('../src/db/settings.js');
const { createIcp } = await import('../src/db/icps.js');
const { createList } = await import('../src/db/lists.js');
const { createCompany } = await import('../src/db/companies.js');
const { listInbox, updateProspect } = await import('../src/db/prospects.js');

type JobKind = Parameters<typeof insertJob>[0];

const PROFILE = 'https://www.linkedin.com/in/utente-demo-e2e';

/** Come il processo figlio del job: riga `jobs` con quei `params` e `JOB_ID` nell'env. */
function asJob(kind: JobKind, params: object) {
  const job = insertJob(kind, params);
  process.env.JOB_ID = String(job.id);
  return job;
}

/** Esegue il job con il wrapper reale (`runJob`): deps dal dispatcher, esito scritto sulla riga. */
async function runAsJob(kind: JobKind, params: object) {
  const job = asJob(kind, params);
  try {
    return await runJob(job.id);
  } finally {
    delete process.env.JOB_ID;
  }
}

/** DB e2e vuoto con il mio profilo salvato. */
function freshDb(settings: Parameters<typeof updateSettings>[0] = {}) {
  resetE2eData();
  delete process.env.JOB_ID;
  updateSettings({ own_profile_url: PROFILE, ...settings });
}

async function json(res: Response | Promise<Response>): Promise<any> {
  return (await res).json();
}

const byName = (name: string) => db.prepare('SELECT id FROM prospects WHERE full_name = ?').pluck().get(name) as number;

describe('fakeDeps sync_interactions (tdd_target)', () => {
  it("fetchReactions ritorna gli item della fixture; con __fixture 'FAIL' l'handler rigetta con actor:", async () => {
    delete process.env.JOB_ID;
    const items = await resolveDeps('sync_interactions').fetchReactions(['u'], 1);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toMatchObject({ reactor: { name: expect.any(String) }, _metadata: { post_url: 'u' } });

    updateSettings({ own_profile_url: PROFILE });
    asJob('sync_interactions', { force: false, postsOnly: false, __fixture: 'FAIL' });
    const deps = resolveDeps('sync_interactions');
    await expect(HANDLERS.sync_interactions({ __fixture: 'FAIL' }, deps)).rejects.toThrow(/^actor:/);
    delete process.env.JOB_ID;
  });
});

describe('resetE2eData', () => {
  it('svuota tutte le tabelle e riparte dagli id 1; rifiuta fuori dal server e2e', () => {
    updateSettings({ own_profile_url: PROFILE });
    createIcp({ name: 'Da cancellare' });
    insertJob('enrich', { prospectIds: [1] });

    expect(resetE2eData()).toEqual({ ok: true });
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).pluck().all() as string[];
    expect(tables.length).toBeGreaterThanOrEqual(13);
    for (const table of tables) expect(db.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get()).toBe(0);
    expect(createIcp({ name: 'Primo' }).id).toBe(1);

    delete process.env.E2E_FAKE_JOBS;
    try {
      expect(() => resetE2eData()).toThrow(/E2E_FAKE_JOBS/);
    } finally {
      process.env.E2E_FAKE_JOBS = '1';
    }
  });
});

describe('sync interazioni', () => {
  beforeEach(() => freshDb());

  it('primo sync: 7 prospect in Inbox da reazioni e commenti; reazione id membro + commento slug = 1 prospect', async () => {
    const job = await runAsJob('sync_interactions', { force: false, postsOnly: false });
    expect(job.state).toBe('succeeded');
    expect(job.result?.counts).toMatchObject({
      posts: 2,
      posts_synced: 2,
      reactions: 6,
      comments: 3,
      prospects_new: 7,
      skipped_no_url: 1,
      post_errors: 0,
    });
    expect(job.result?.warnings).toEqual([]);
    expect(listInbox().total).toBe(7);

    const giulia = db
      .prepare(`SELECT id, linkedin_url, member_urn FROM prospects WHERE full_name = 'Giulia Marchetti'`)
      .all() as Array<{ id: number; linkedin_url: string; member_urn: string }>;
    expect(giulia).toEqual([
      { id: giulia[0].id, linkedin_url: 'https://www.linkedin.com/in/giulia-marchetti-e2e', member_urn: 'ACoAAE2eGiuliaMarchetti0001' },
    ]);
    const kinds = db.prepare('SELECT kind FROM sources WHERE prospect_id = ? ORDER BY kind').pluck().all(giulia[0].id);
    expect(kinds).toEqual(['post_comment', 'post_reaction']);

    // Rilancio entro il cooldown: esito zero neutro.
    const again = await runAsJob('sync_interactions', { force: false, postsOnly: false });
    expect(again.result?.summary).toMatch(/^Nessun post da sincronizzare/);
  });

  it('WARN: un post dichiara reazioni ma ne tornano 0 → warning e post non marcato', async () => {
    const job = await runAsJob('sync_interactions', { __fixture: 'WARN' });
    expect(job.state).toBe('succeeded');
    expect(job.result?.warnings).toHaveLength(1);
    expect(job.result?.warnings?.[0]).toMatch(/^0 reazioni lette da 1 post che ne dichiara 12/);
    const unsynced = db.prepare('SELECT post_url FROM posts WHERE last_synced_at IS NULL').pluck().all();
    expect(unsynced).toEqual([expect.stringContaining('activity-7500000000000000103')]);
  });

  it('EMPTY: 0 risultati con esito neutro, nessun dato scritto', async () => {
    const job = await runAsJob('sync_interactions', { __fixture: 'EMPTY' });
    expect(job.state).toBe('succeeded');
    expect(job.result?.summary).toMatch(/^Nessun post trovato/);
    expect(listInbox().total).toBe(0);
  });

  it('PARTIAL: commenti di un post in errore → job riuscito con post_errors 1 e errore attribuito', async () => {
    const job = await runAsJob('sync_interactions', { __fixture: 'PARTIAL' });
    expect(job.state).toBe('succeeded');
    expect(job.result?.counts).toMatchObject({ posts_synced: 1, post_errors: 1 });
    const errors = (job.result as unknown as { errors: Array<{ post_url: string; error: string }> }).errors;
    expect(errors).toEqual([
      { post_url: expect.stringContaining('activity-7500000000000000102'), error: expect.stringMatching(/^actor:apimaestro\//) },
    ]);
  });

  it('FAIL e FAIL_ONCE: fallimento intero attribuito; con FAIL_ONCE il "Riprova" (stessi params) riesce', async () => {
    const failed = await runAsJob('sync_interactions', { __fixture: 'FAIL' });
    expect(failed.state).toBe('failed');
    expect(failed.error).toMatch(/^actor:apimaestro\/linkedin-profile-posts: Impossibile leggere i post di .*Nessun dato modificato\.$/);

    // Il job FAIL qui sopra non conta: FAIL_ONCE guarda solo i job con gli stessi params (il "Riprova").
    const first = await runAsJob('sync_interactions', { __fixture: 'FAIL_ONCE' });
    expect(first.state).toBe('failed');
    const retry = await runAsJob('sync_interactions', { __fixture: 'FAIL_ONCE' });
    expect(retry.state).toBe('succeeded');
    expect(retry.result?.counts.prospects_new).toBe(7);
  });

  it('trigger nei dati: lo slug del profilo pilota lo scenario senza __fixture', async () => {
    updateSettings({ own_profile_url: 'https://www.linkedin.com/in/demo-fail' });
    expect((await runAsJob('sync_interactions', {})).error).toMatch(/^actor:/);
    updateSettings({ own_profile_url: 'https://www.linkedin.com/in/demo-empty' });
    expect((await runAsJob('sync_interactions', {})).result?.summary).toMatch(/^Nessun post trovato/);
    updateSettings({ own_profile_url: 'https://www.linkedin.com/in/demo-warn' });
    expect((await runAsJob('sync_interactions', {})).result?.warnings).toHaveLength(1);
  });
});

describe('sourcing da azienda', () => {
  beforeEach(() => freshDb());

  function target(companyUrl: string, name?: string) {
    const icp = createIcp({ name: 'CTO di PMI', target_roles: ['CTO'] });
    const list = createList({ icpId: icp.id, name: 'CTO manifattura' })!;
    const company = createCompany({ linkedin_url: companyUrl, name });
    return { listId: list.id, companyId: company.id };
  }

  const sourcing = (ids: { companyId: number; listId: number }, mode: string, maxItems = 50) =>
    runAsJob('source_company', { ...ids, roles: ['CTO'], locations: [], maxItems, mode });

  it('Short: le persone della fixture entrano nella lista con il nome azienda; Full: marcate arricchite; maxItems rispettato', async () => {
    const acme = target('https://www.linkedin.com/company/acme-cloud-e2e', 'Acme Cloud Srl');
    const short = await sourcing(acme, 'Short');
    expect(short.state).toBe('succeeded');
    expect(short.result?.counts).toMatchObject({ fetched: 5, prospects_new: 4, added_to_list: 4, marked_enriched: 0, skipped_no_url: 1 });
    const rows = db
      .prepare('SELECT linkedin_url, member_urn, company_name, enriched_at FROM prospects WHERE company_id = ?')
      .all(acme.companyId) as Array<{ linkedin_url: string; member_urn: string | null; company_name: string; enriched_at: string | null }>;
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(r.linkedin_url).toMatch(/^https:\/\/www\.linkedin\.com\/in\/[a-z-]+-acme-cloud-e2e$/);
      expect(r.member_urn).toMatch(/^ACoAA/);
      expect(r.enriched_at).toBeNull();
    }
    expect(rows.map((r) => r.company_name)).toContain('Acme Cloud Srl');

    // Altra azienda: persone diverse; Full → arricchite (P10); maxItems taglia.
    const beta = createCompany({ linkedin_url: 'https://www.linkedin.com/company/beta-logistica-e2e' });
    const full = await sourcing({ companyId: beta.id, listId: acme.listId }, 'Full', 2);
    expect(full.result?.counts).toMatchObject({ fetched: 2, prospects_new: 2, marked_enriched: 2 });
  });

  it("Full+email su ferronova-digitale-e2e: ritrova Giulia del sync (già in archivio) e la toglie dall'Inbox", async () => {
    await runAsJob('sync_interactions', {});
    const job = await sourcing(target('https://www.linkedin.com/company/ferronova-digitale-e2e', 'Ferronova Digitale Srl'), 'Full+email');
    expect(job.result?.counts).toMatchObject({ fetched: 3, prospects_new: 2, prospects_seen: 1, added_to_list: 3, prospects_merged: 0 });
    const email = db.prepare('SELECT email FROM prospects WHERE linkedin_url = ?').pluck().get('https://www.linkedin.com/in/giulia-marchetti-e2e');
    expect(email).toMatch(/@ferronova-digitale-e2e\.example$/);
    expect(listInbox().total).toBe(6);
  });

  it("trigger nello slug dell'azienda: fail → job failed attribuito all'actor; empty → zero neutro", async () => {
    const failing = target('https://www.linkedin.com/company/demo-fail');
    const failed = await sourcing(failing, 'Short');
    expect(failed.state).toBe('failed');
    expect(failed.error).toMatch(/^actor:harvestapi\/linkedin-company-employees: /);

    const empty = createCompany({ linkedin_url: 'https://www.linkedin.com/company/demo-empty' });
    const zero = await sourcing({ companyId: empty.id, listId: failing.listId }, 'Short');
    expect(zero.state).toBe('succeeded');
    expect(zero.result?.summary).toMatch(/^Nessuna persona trovata in demo-empty con ruoli CTO\./);
  });
});

describe('arricchimento', () => {
  beforeEach(() => freshDb());

  it('profili della fixture per id membro o slug (URL canonico applicato); Chiara Lombardi senza dati', async () => {
    await runAsJob('sync_interactions', {});
    const ids = db.prepare('SELECT id FROM prospects ORDER BY id').pluck().all() as number[];

    const job = await runAsJob('enrich', { prospectIds: ids, onlyMissing: true, retryFailed: false });
    expect(job.state).toBe('succeeded');
    expect(job.result?.counts).toMatchObject({ targets: 7, enriched: 6, no_data: 1, errors: 0 });
    expect(job.result?.counts.with_email).toBeGreaterThan(0);

    const paolo = db.prepare(`SELECT * FROM prospects WHERE full_name = 'Paolo Ranieri'`).get() as Record<string, string | null>;
    expect(paolo).toMatchObject({
      linkedin_url: 'https://www.linkedin.com/in/paolo-ranieri-e2e',
      member_urn: 'ACoAAE2ePaoloRanieri00003',
      company_name: 'Molini Valdenza Srl',
    });
    expect(paolo.about).toBeTruthy();
    expect(paolo.enriched_at).toBeTruthy();

    const chiara = db.prepare(`SELECT enriched_at, enrichment_attempted_at FROM prospects WHERE full_name = 'Chiara Lombardi'`).get();
    expect(chiara).toEqual({ enriched_at: null, enrichment_attempted_at: expect.any(String) });
  });

  it('persone fuori fixture → profilo sintetico; "nodata" nei dati → senza dati; "enrich-error" → job failed attribuito', async () => {
    const listId = createList({ icpId: createIcp({ name: 'CTO', target_roles: ['CTO'] }).id, name: 'Lista' })!.id;
    const enrichCompany = async (slug: string) => {
      const company = createCompany({ linkedin_url: `https://www.linkedin.com/company/${slug}` });
      await runAsJob('source_company', { companyId: company.id, listId, roles: ['CTO'], locations: [], maxItems: 50, mode: 'Short' });
      const ids = db.prepare('SELECT id FROM prospects WHERE company_id = ?').pluck().all(company.id) as number[];
      expect(ids).toHaveLength(4);
      return runAsJob('enrich', { prospectIds: ids, onlyMissing: true, retryFailed: false });
    };

    const synthetic = await enrichCompany('acme-cloud-e2e');
    expect(synthetic.result?.counts).toMatchObject({ enriched: 4, no_data: 0 });
    const alessandro = db.prepare(`SELECT about, enriched_at FROM prospects WHERE full_name = 'Alessandro Conti'`).get() as Record<string, string>;
    expect(alessandro.about).toMatch(/sintetico/);
    expect(alessandro.enriched_at).toBeTruthy();

    expect((await enrichCompany('acme-nodata')).result?.counts).toMatchObject({ enriched: 0, no_data: 4 });

    const failed = await enrichCompany('acme-enrich-error');
    expect(failed.state).toBe('failed');
    expect(failed.error).toMatch(/^actor:apimaestro\/linkedin-profile-detail: /);
  });
});

describe('analisi AI (client Claude fake)', () => {
  /** Sync + arricchimento di tutti tranne Marco Ferri + ICP: il mondo di partenza dell'analisi. */
  async function world() {
    freshDb({ company_description: 'Software su misura e migrazioni cloud per PMI.' });
    await runAsJob('sync_interactions', {});
    const others = ['Giulia Marchetti', 'Luca Bernardi', 'Paolo Ranieri', 'Sara Colombo', 'Davide Greco', 'Chiara Lombardi'].map(byName);
    await runAsJob('enrich', { prospectIds: others, onlyMissing: true, retryFailed: false });
    return createIcp({ name: 'CTO di PMI manifatturiere', target_roles: ['CTO', 'Head of Engineering'] }).id;
  }

  const analyze = (id: number, body: object) =>
    createApp().request(`/api/prospects/${id}/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('singola sincrona (processo del server): fit alto/medio/basso dalla fixture, rifiuto, JSON non valido, profilo senza dati', async () => {
    const icpId = await world();

    for (const [name, fit] of [['Giulia Marchetti', 'alto'], ['Luca Bernardi', 'medio'], ['Paolo Ranieri', 'basso']] as const) {
      const res = await analyze(byName(name), { icpId });
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.analysis).toMatchObject({ fit });
      expect(body.analysis.angles).toHaveLength(3);
    }

    const refusal = await analyze(byName('Sara Colombo'), { icpId });
    expect(refusal.status).toBe(502);
    expect(await json(refusal)).toMatchObject({ code: 'refusal' });

    const invalid = await analyze(byName('Davide Greco'), { icpId });
    expect(invalid.status).toBe(502);
    expect(await json(invalid)).toMatchObject({ code: 'invalid_output' });

    const noData = await analyze(byName('Chiara Lombardi'), { icpId, enrichFirst: true });
    expect(noData.status).toBe(409);
    expect(await json(noData)).toMatchObject({ code: 'not_enrichable' });

    // Fuori dai profili nominati: analisi di default personalizzata, dopo l'arricchimento inline.
    const marco = await analyze(byName('Marco Ferri'), { icpId, enrichFirst: true });
    expect(marco.status).toBe(200);
    const marcoBody = await json(marco);
    expect(marcoBody).toMatchObject({ enriched_first: true, analysis: { fit: 'medio' } });
    expect(marcoBody.analysis.summary).toContain('Marco Ferri');
  });

  it('marcatori nei dati del profilo: e2e-fit-basso ed e2e-refusal', async () => {
    const icpId = await world();
    const marco = byName('Marco Ferri');
    updateProspect(marco, { about: 'Profilo di prova e2e-fit-basso' });
    expect((await json(analyze(marco, { icpId }))).analysis).toMatchObject({ fit: 'basso' });
    updateProspect(marco, { about: 'Profilo di prova e2e-refusal' });
    expect(await json(analyze(marco, { icpId, force: true }))).toMatchObject({ code: 'refusal' });
  });

  it("parole chiave propagate dallo slug dell'azienda ai dipendenti estratti (Arricchisci e analizza)", async () => {
    const icpId = await world();
    const listId = createList({ icpId, name: 'Lista' })!.id;
    const firstEmployee = async (slug: string) => {
      const company = createCompany({ linkedin_url: `https://www.linkedin.com/company/${slug}` });
      await runAsJob('source_company', { companyId: company.id, listId, roles: [], locations: [], maxItems: 1, mode: 'Short' });
      return db.prepare('SELECT id FROM prospects WHERE company_id = ?').pluck().get(company.id) as number;
    };
    const refused = await analyze(await firstEmployee('acme-e2e-refusal'), { icpId, enrichFirst: true });
    expect(refused.status).toBe(502);
    expect(await json(refused)).toMatchObject({ code: 'refusal', enriched_first: true });
    const noData = await analyze(await firstEmployee('acme-nodata'), { icpId, enrichFirst: true });
    expect(noData.status).toBe(409);
    expect(await json(noData)).toMatchObject({ code: 'not_enrichable' });
    const enrichError = await analyze(await firstEmployee('acme-enrich-error'), { icpId, enrichFirst: true });
    expect(enrichError.status).toBe(502);
    expect(await json(enrichError)).toMatchObject({ code: 'enrich_failed' });
  });

  it('job bulk: esiti misti nei conteggi; __fixture FAIL → job failed attribuito', async () => {
    const icpId = await world();
    const ids = db.prepare('SELECT id FROM prospects ORDER BY id').pluck().all() as number[];

    const job = await runAsJob('analyze', { prospectIds: ids, icpId, onlyMissing: false, force: false });
    expect(job.state).toBe('succeeded');
    expect(job.result?.counts).toMatchObject({ analyzed: 4, refusals: 1, errors: 1, not_enrichable: 1, enriched_first: 1 });

    const failed = await runAsJob('analyze', { prospectIds: ids, icpId, onlyMissing: false, force: true, __fixture: 'FAIL' });
    expect(failed.state).toBe('failed');
    expect(failed.error).toMatch(/^actor:/);
  });
});

describe('seedE2eData', () => {
  it('azzera e popola lo scenario base: profilo e azienda, ICP con ruoli e riferimento, lista con 2 membri, Inbox da sync', async () => {
    createIcp({ name: 'Da cancellare' });

    const seed = await seedE2eData();
    expect(seed).toMatchObject({ icp_id: 1, list_id: 1, company_id: 1 });

    const app = createApp();
    expect((await json(app.request('/api/settings'))).readiness).toMatchObject({ profile: true, company: true, icp: true });
    const icp = await json(app.request(`/api/icps/${seed.icp_id}`));
    expect(icp.target_roles.length).toBeGreaterThan(0);
    expect(icp.reference_companies).toEqual([expect.objectContaining({ outcome: 'vinta' })]);

    expect((await json(app.request(`/api/prospects?listId=${seed.list_id}`))).total).toBe(2);
    expect((await json(app.request('/api/inbox'))).total).toBe(5);
    expect(seed.prospects).toHaveLength(7);
    expect(seed.prospects.filter((p) => p.in_list)).toHaveLength(2);
  });
});
