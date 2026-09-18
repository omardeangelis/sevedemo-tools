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
const { createIcp, setReferenceCompany, updateIcp } = await import('../src/db/icps.js');
const { createList, updateList } = await import('../src/db/lists.js');
const { createCompany, getCompany } = await import('../src/db/companies.js');
const { listInbox, updateProspect } = await import('../src/db/prospects.js');
const { config } = await import('../src/config.js');
const { getCandidate, listCandidates } = await import('../src/db/candidates.js');
const { bucketOf } = await import('../src/apollo/similarity.js');
const { planLookalike } = await import('../src/jobs/lookalike-companies.js');
const { planEnrichCompanies } = await import('../src/jobs/enrich-companies.js');
const { planContacts } = await import('../src/jobs/apollo-people.js');

type ApolloSeed = Awaited<ReturnType<typeof seedE2eData>>['apollo'];

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

describe('job Apollo (apollo-lookalike T16): handler reali su fakeDeps', () => {
  let apollo: ApolloSeed;
  beforeEach(async () => {
    delete process.env.JOB_ID;
    apollo = (await seedE2eData()).apollo;
  });

  const KEY_BLOCKER = 'APOLLO_API_KEY mancante nel .env — nessun job avviato.';

  /** Parametri congelati come dalla route di avvio (ICP "HR tech Milano"), più eventuali extra (`__fixture`). */
  const lookalikeParams = (input: Parameters<typeof planLookalike>[1] = {}, extra: object = {}) => ({
    ...planLookalike(apollo.icp_id, { pages: 1, perPage: 25, ...input })!.params,
    ...extra,
  });

  /** Aziende con dominio per "Trova contatti": Gamma Welfare (persone speciali), Turni Facili, Paghe Semplici. */
  function contactsCompanies(): number[] {
    const gamma = createCompany({ website: 'gamma-welfare.example', name: 'Gamma Welfare Srl' }).id;
    const turni = createCompany({ website: 'turni-facili.example', name: 'Turni Facili Srl' }).id;
    return [gamma, turni, apollo.nolinkedin_company_id];
  }
  const contactsParams = (companyIds: number[], extra: object = {}) => ({
    ...planContacts(apollo.icp_id, { companyIds, listId: apollo.list_id }).params!,
    ...extra,
  });

  it('tdd_target: PARTIAL → ricerca aziende simili riuscita con "Limite Apollo raggiunto" e last_page 1', async () => {
    const job = await runAsJob('lookalike_companies', lookalikeParams({ pages: 2 }, { __fixture: 'PARTIAL' }));
    expect(job.state).toBe('succeeded');
    expect(job.result?.warnings?.[0]).toMatch(/^Limite Apollo raggiunto: letta 1 pagina su 2/);
    expect(job.result?.counts.last_page).toBe(1);
  });

  it('ricerca: pagina 1 con i casi speciali, punteggi > 0 e vari; poi continua fino alla pagina corta (esaurita)', async () => {
    const first = await runAsJob('lookalike_companies', lookalikeParams());
    expect(first.state).toBe('succeeded');
    expect(first.result?.counts).toMatchObject({
      read: 25,
      new_candidates: 21,
      known: 1, // Acme, referenza con le stesse chiavi
      references_completed: 1, // Delta, referenza solo-LinkedIn: acquisisce il dominio
      key_conflicts: 1, // Conflitto Chiavi
      no_keys: 1, // Studio Senza Sito
      without_linkedin: 2, // nolinkedin.example + Turni Facili
      without_location: 1, // Epsilon Paghe Cloud
      enriched: 21,
      pages_read: 1,
      last_page: 1,
      last_page_declared: 25,
      credits_used: 22,
      requests: 4,
    });
    const candidates = listCandidates(apollo.icp_id);
    expect(candidates).toHaveLength(21);
    expect(candidates.every((c) => c.score > 0)).toBe(true);
    expect(new Set(candidates.map((c) => bucketOf(c.score)))).toEqual(new Set(['alto', 'medio', 'basso']));
    expect(candidates[0]).toMatchObject({ name: 'Gamma Welfare Srl', score: 0.75 });
    expect(getCandidate(apollo.icp_id, apollo.nolinkedin_company_id)).toMatchObject({ status: 'proposta', linkedin_url: null });
    expect(getCompany(apollo.reference_ids.delta)?.domain).toBe('delta-people.example');

    const resume = planLookalike(apollo.icp_id, { pages: 3, perPage: 25 })!;
    expect(resume.resume).toMatchObject({ next_page: 2, exhausted: false });
    const rest = await runAsJob('lookalike_companies', resume.params);
    expect(rest.result?.counts).toMatchObject({ pages_read: 2, last_page: 3, last_page_declared: 8, new_candidates: 33 });
    expect(planLookalike(apollo.icp_id, { pages: 1, perPage: 25 })!.resume).toMatchObject({ exhausted: true, next_page: null });
  });

  it('ricerca: EMPTY zero neutro · FAIL e BADKEY falliti attribuiti · UNRECOGNIZED warning · FAIL_ONCE riesce al "Riprova"', async () => {
    const empty = await runAsJob('lookalike_companies', lookalikeParams({}, { __fixture: 'EMPTY' }));
    expect(empty.state).toBe('succeeded');
    expect(empty.result?.summary).toMatch(/^Nessuna azienda trovata con: hr, saas, software, hr tech/);

    const failed = await runAsJob('lookalike_companies', lookalikeParams({}, { __fixture: 'FAIL' }));
    expect(failed.state).toBe('failed');
    expect(failed.error).toMatch(/^actor:apollo:mixed_companies\/search: HTTP 500 \(errore simulato dal server e2e .*Nessun dato modificato\.$/);

    const badKey = await runAsJob('lookalike_companies', lookalikeParams({}, { __fixture: 'BADKEY' }));
    expect(badKey.error).toMatch(/^config: chiave Apollo rifiutata \(401\)/);

    const unrecognized = await runAsJob('lookalike_companies', lookalikeParams({}, { __fixture: 'UNRECOGNIZED' }));
    expect(unrecognized.state).toBe('succeeded');
    expect(unrecognized.result?.warnings?.[0]).toMatch(/^Apollo ha risposto ma nessuna azienda è stata riconosciuta \(5 dichiarate\)/);
    expect(listCandidates(apollo.icp_id)).toHaveLength(0);

    const once = lookalikeParams({ restart: true }, { __fixture: 'FAIL_ONCE' });
    expect((await runAsJob('lookalike_companies', once)).state).toBe('failed');
    const retry = await runAsJob('lookalike_companies', once);
    expect(retry.state).toBe('succeeded');
    expect(retry.result?.counts.new_candidates).toBe(21);
  });

  it("ricerca: HOURLY → limite orario al 2° lotto dell'arricchimento, esito parziale dopo la pagina 1", async () => {
    const job = await runAsJob('lookalike_companies', lookalikeParams({ pages: 2 }, { __fixture: 'HOURLY' }));
    expect(job.state).toBe('succeeded');
    expect(job.result?.counts).toMatchObject({ last_page: 1, new_candidates: 21, enriched: 10 });
    expect(job.result?.warnings?.[0]).toMatch(/^Limite Apollo raggiunto durante l'arricchimento: 11 aziende nuove della pagina 1/);
  });

  it('trigger nei dati: chip `apollo-partial` tra le parole chiave; ICP rinominato `apollo-fail-once` → fallisce, il "Riprova" riesce', async () => {
    const chip = lookalikeParams({ pages: 2, filters: { keywords: ['hr', 'apollo-partial'], ranges: ['21-50'], locations: [] } });
    const partial = await runAsJob('lookalike_companies', chip);
    expect(partial.result?.warnings?.[0]).toMatch(/^Limite Apollo raggiunto/);

    updateIcp(apollo.other_icp_id, { name: 'Software house Torino apollo-fail-once' });
    const other = planLookalike(apollo.other_icp_id, { pages: 1, perPage: 25 })!.params;
    const failed = await runAsJob('lookalike_companies', other);
    expect(failed.error).toMatch(/^actor:apollo:mixed_companies\/search: HTTP 500/);
    expect((await runAsJob('lookalike_companies', other)).state).toBe('succeeded');
  });

  it('pipeline: contatti nelle 21 candidate create, che restano proposte', async () => {
    const job = await runAsJob('lookalike_companies', lookalikeParams({ autoContacts: { listId: apollo.list_id } }));
    expect(job.state).toBe('succeeded');
    expect(job.result?.summary).toMatch(/\nContatti Apollo: 83 persone lette in 21 aziende/);
    expect(job.result?.counts).toMatchObject({
      new_candidates: 21,
      contacts_companies_done: 21,
      contacts_added: 81,
      contacts_prospects_seen: 2, // Marta Ferrari (già in lista) e Giulia Marchetti (dal sync)
      contacts_skipped_no_url: 1,
      contacts_apollo_id_taken: 1,
      contacts_with_email: 62,
    });
    expect(listCandidates(apollo.icp_id).every((c) => c.status === 'proposta')).toBe(true);
  });

  it('pipeline: lista rinominata `apollo-noscope` → 403 sulla ricerca persone, job riuscito con warning config:', async () => {
    updateList(apollo.list_id, { name: 'HR tech Milano — decisori apollo-noscope' });
    const job = await runAsJob('lookalike_companies', lookalikeParams({ autoContacts: { listId: apollo.list_id } }));
    expect(job.state).toBe('succeeded');
    expect(job.result?.counts).toMatchObject({ new_candidates: 21, contacts_added: 0 });
    expect(job.result?.warnings).toContainEqual(
      expect.stringMatching(
        /^config: la chiave Apollo non ha i permessi per mixed_people\/api_search: usa una master key .* Le candidate sono salvate: usa 'Trova contatti' dopo aver sistemato la chiave\.$/,
      ),
    );
  });

  it('contatti: persone rivelate in lista con fonte Apollo ed email; `senza-url` saltata, `id-preso` contato', async () => {
    const companyIds = contactsCompanies();
    const noscope = await runAsJob('apollo_people', contactsParams(companyIds, { __fixture: 'NOSCOPE' }));
    expect(noscope.error).toMatch(/^config: la chiave Apollo non ha i permessi per mixed_people\/api_search: .*Nessun dato modificato\.$/);
    const failed = await runAsJob('apollo_people', contactsParams(companyIds, { __fixture: 'FAIL' }));
    expect(failed.error).toMatch(/^actor:apollo:mixed_people\/api_search: HTTP 500/);
    const empty = await runAsJob('apollo_people', contactsParams(companyIds, { __fixture: 'EMPTY' }));
    expect(empty.result?.summary).toMatch(/^Nessuna persona trovata in 3 aziende con ruoli CTO, Head of People/);

    const job = await runAsJob('apollo_people', contactsParams(companyIds));
    expect(job.state).toBe('succeeded');
    expect(job.result?.counts).toMatchObject({
      people_read: 13,
      people_matched: 13,
      companies_done: 3,
      added: 11,
      prospects_new: 11,
      prospects_seen: 1,
      already_in_list: 1,
      skipped_no_url: 1,
      apollo_id_taken: 1,
      with_email: 9,
      credits_used: 13,
      requests: 6,
    });
    const rows = db
      .prepare(
        `SELECT p.full_name, p.email, p.apollo_person_id FROM prospects p
         JOIN sources s ON s.prospect_id = p.id AND s.kind = 'apollo_people'
         JOIN list_members m ON m.prospect_id = p.id AND m.list_id = ?`,
      )
      .all(apollo.list_id) as Array<{ full_name: string; email: string | null; apollo_person_id: string | null }>;
    expect(rows).toHaveLength(12);
    expect(rows.find((r) => r.full_name === 'Beatrice Galli')).toMatchObject({ apollo_person_id: null, email: expect.stringContaining('@') });
    expect(rows.find((r) => r.full_name === 'Marta Ferrari')?.email).toBe('marta.ferrari@gamma-welfare.example');
    expect(rows.some((r) => r.full_name === 'Ludovica Neri')).toBe(false);
  });

  it('contatti: PARTIAL e HOURLY chiudono parziali dopo la prima azienda; `apollo-fail` nel dominio della 2ª → errore attribuito', async () => {
    const companyIds = contactsCompanies();
    const partial = await runAsJob('apollo_people', contactsParams(companyIds, { __fixture: 'PARTIAL' }));
    expect(partial.state).toBe('succeeded');
    expect(partial.result?.counts.companies_done).toBe(1);
    expect(partial.result?.warnings?.[0]).toMatch(/^Limite Apollo raggiunto: completata 1 azienda su 3/);

    const hourly = await runAsJob('apollo_people', contactsParams(companyIds, { __fixture: 'HOURLY' }));
    expect(hourly.result?.warnings?.[0]).toMatch(/^Limite Apollo raggiunto: completata 1 azienda su 3/);

    const broken = createCompany({ website: 'apollo-fail.example', name: 'Azienda Rotta Srl' }).id;
    const perCompany = await runAsJob('apollo_people', contactsParams([companyIds[1]!, broken]));
    expect(perCompany.state).toBe('succeeded');
    expect(perCompany.result?.warnings?.[0]).toMatch(/^actor:apollo:mixed_people\/api_search: HTTP 500 .* · completata 1 azienda su 2/);
  });

  it('arricchimento referenze: Beta arricchita con URL acquisito; secondo ICP: non trovata e chiavi in conflitto; FAIL fallito', async () => {
    const plan = planEnrichCompanies({ icpId: apollo.icp_id })!;
    expect(plan.preview.counts).toMatchObject({ references: 3, with_domain: 2, to_enrich: 1, enriched: 1 });
    const failed = await runAsJob('enrich_companies', { ...plan.params, __fixture: 'FAIL' });
    expect(failed.error).toMatch(/^actor:apollo:organizations\/bulk_enrich: HTTP 500 .*Nessun dato modificato\.$/);

    const job = await runAsJob('enrich_companies', plan.params);
    expect(job.result?.counts).toMatchObject({ enriched: 1, linkedin_acquired: 1, not_found: 0, credits_used: 1 });
    expect(getCompany(apollo.reference_ids.beta)).toMatchObject({
      linkedin_url: 'https://www.linkedin.com/company/beta-payroll-e2e',
      apollo_org_id: 'e2e-org-beta-payroll',
    });

    const other = await runAsJob('enrich_companies', planEnrichCompanies({ icpId: apollo.other_icp_id })!.params);
    expect(other.state).toBe('succeeded');
    expect(other.result?.counts).toMatchObject({ enriched: 0, not_found: 1, key_conflicts: 1 });
  });

  it('arricchimento di 12 referenze: PARTIAL (429 al lotto 2) isola il lotto; HOURLY si ferma con "Limite Apollo raggiunto"', async () => {
    const domains = [
      'omega-paghe', 'assunzioni-digitali', 'cedolino-facile', 'team-pulse', 'mentor-hub', 'selezione-pro', 'orari-chiari', 'welfare-nord',
      'skill-map', 'contratti-snelli', 'hr-analytics-italia', 'nuove-leve', 'presenza-mobile', 'clima-team', 'buste-paga-online',
      'giardino-talenti', 'formula-welfare', 'codice-risorse', 'ingaggio', 'percorsi-carriera', 'gestione-turni-pro', 'hr-cloud-sud',
      'busta-smart', 'onboarding-facile',
    ];
    const icpWith = (name: string, slice: string[]) => {
      const icp = createIcp({ name });
      for (const d of slice) setReferenceCompany(icp.id, createCompany({ website: `${d}.example` }).id);
      return planEnrichCompanies({ icpId: icp.id })!.params;
    };

    const partial = await runAsJob('enrich_companies', { ...icpWith('Blocco A', domains.slice(0, 12)), __fixture: 'PARTIAL' });
    expect(partial.state).toBe('succeeded');
    expect(partial.result?.counts.enriched).toBe(10);
    expect(partial.result?.warnings).toContainEqual(expect.stringMatching(/^Errore Apollo \(actor:apollo:organizations\/bulk_enrich: limite di richieste raggiunto .*\): 2 referenze restano da arricchire/));

    const hourly = await runAsJob('enrich_companies', { ...icpWith('Blocco B', domains.slice(12)), __fixture: 'HOURLY' });
    expect(hourly.state).toBe('succeeded');
    expect(hourly.result?.warnings).toContainEqual('Limite Apollo raggiunto: arricchite 10 referenze su 12; le altre restano da arricchire.');
  });

  const emailParams = () => ({ listId: apollo.list_id, provider: 'apollo', onlyMissing: true, retryFailed: false });

  it('email via Apollo sulla lista: FAIL fallito; poi 8 trovate, 3 non disponibili, `enriched_at` intatto', async () => {
    const failed = await runAsJob('enrich', { ...emailParams(), __fixture: 'FAIL' });
    expect(failed.error).toMatch(/^actor:apollo:people\/bulk_match: HTTP 500/);

    const job = await runAsJob('enrich', emailParams());
    expect(job.result?.counts).toMatchObject({ targets: 11, with_email: 8, unavailable: 3, already_had_email: 1, credits_used: 10 });
    const emails = db
      .prepare(`SELECT email, enriched_at, apollo_matched_at FROM prospects WHERE id IN (SELECT value FROM json_each(?))`)
      .all(JSON.stringify(apollo.email_target_prospect_ids)) as Array<{ email: string | null; enriched_at: string | null; apollo_matched_at: string | null }>;
    expect(emails.filter((e) => e.email !== null)).toHaveLength(8);
    expect(emails.every((e) => e.enriched_at === null && e.apollo_matched_at !== null)).toBe(true);
  });

  it('email via Apollo: PARTIAL → 429 al lotto 2, il restante resta "da cercare"', async () => {
    const partial = await runAsJob('enrich', { ...emailParams(), __fixture: 'PARTIAL' });
    expect(partial.state).toBe('succeeded');
    expect(partial.result?.counts).toMatchObject({ targets: 11, with_email: 7, not_searched: 1 });
    expect(partial.result?.warnings?.[0]).toMatch(/^Limite Apollo raggiunto: 10 email cercate su 11 · 7 trovate/);
  });

  it('E2E_NO_APOLLO (chiave vuota): le 4 preview Apollo hanno il blocker della chiave; il seed arricchisce comunque Acme', async () => {
    const saved = config.apolloApiKey;
    config.apolloApiKey = '';
    try {
      apollo = (await seedE2eData()).apollo;
      const app = createApp();
      const previews = [
        `/api/icps/${apollo.icp_id}/enrich-companies/preview`,
        `/api/icps/${apollo.icp_id}/lookalike/preview`,
        `/api/icps/${apollo.icp_id}/contacts/preview?companyIds=${apollo.nolinkedin_company_id}&listId=${apollo.list_id}`,
        `/api/enrich/preview?listId=${apollo.list_id}&provider=apollo`,
      ];
      for (const url of previews) {
        const res = await app.request(url);
        expect(res.status, url).toBe(200);
        expect((await json(res)).blockers, url).toContain(KEY_BLOCKER);
      }
      expect(getCompany(apollo.reference_ids.acme)?.apollo_org_id).toBe('e2e-org-acme-hr');
    } finally {
      config.apolloApiKey = saved;
    }
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

    // Scenario Apollo: ICP dell'esempio SPEC con referenze nei tre stati, liste raggruppabili per ICP.
    const { apollo } = seed;
    const preview = await json(app.request(`/api/icps/${apollo.icp_id}/lookalike/preview`));
    expect(preview.references.map((r: { name: string; status: string }) => [r.name, r.status])).toEqual([
      ['Acme HR Software Srl', 'enriched'],
      ['Beta Payroll Srl', 'to_enrich'],
      ['Delta People Srl', 'no_domain'],
    ]);
    expect(preview.filters).toMatchObject({ keywords: ['hr', 'saas', 'software', 'hr tech'], locations: ['Italy', 'Milano'] });
    expect(preview.blockers).toEqual([]);
    expect((await json(app.request(`/api/prospects?listId=${apollo.list_id}`))).total).toBe(12);
    expect((await json(app.request(`/api/icps/${apollo.other_icp_id}`))).reference_companies).toHaveLength(2);
    expect(apollo.email_target_prospect_ids).toHaveLength(11);
    expect(db.prepare('SELECT apollo_person_id FROM prospects WHERE id = ?').pluck().get(apollo.id_taken_prospect_id)).toBe('e2e-id-preso');
    expect(getCompany(apollo.nolinkedin_company_id)).toMatchObject({ domain: 'nolinkedin.example', linkedin_url: null });
  });
});
