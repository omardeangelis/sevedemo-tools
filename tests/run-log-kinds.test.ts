import { afterAll, beforeEach, describe, expect, it } from 'vitest';

// Righe di log dei kind (people-first-crm T29, SPEC J8, J10, PLAN P-11): ogni job racconta fasi, chiamate
// agli strumenti (quale operazione, mai i dati), elementi elaborati, errori per elemento e warning.
// Gli handler girano davvero sulle deps fake del server e2e: reali e fake loggano uguale.
const previousFake = process.env.E2E_FAKE_JOBS;
process.env.E2E_FAKE_JOBS = '1';
afterAll(() => {
  if (previousFake === undefined) delete process.env.E2E_FAKE_JOBS;
  else process.env.E2E_FAKE_JOBS = previousFake;
  delete process.env.JOB_ID;
});

const { db } = await import('../src/db/index.js');
const { insertJob } = await import('../src/db/jobs.js');
const { runJob } = await import('../src/server/job-entry.js');
const { resetE2eData, seedE2eData } = await import('../src/jobs/fake-deps.js');
const { readRunLog } = await import('../src/db/runs.js');
const { updateSettings } = await import('../src/db/settings.js');
const { createCompany } = await import('../src/db/companies.js');
const { createIcp } = await import('../src/db/icps.js');
const { createList } = await import('../src/db/lists.js');
const { planContacts } = await import('../src/jobs/apollo-people.js');
const { planLookalike } = await import('../src/jobs/lookalike-companies.js');
const { planEnrichCompanies } = await import('../src/jobs/enrich-companies.js');
const { config } = await import('../src/config.js');

type JobKind = Parameters<typeof insertJob>[0];

const PROFILE = 'https://www.linkedin.com/in/utente-demo-e2e';

/** Come il processo figlio: riga `jobs`, `JOB_ID` nell'env, esito e log scritti da `runJob`. */
async function runAsJob(kind: JobKind, params: object) {
  const job = insertJob(kind, params);
  process.env.JOB_ID = String(job.id);
  try {
    return { job: await runJob(job.id), lines: messages(job.id), id: job.id };
  } finally {
    delete process.env.JOB_ID;
  }
}

function messages(jobId: number): string[] {
  return db.prepare('SELECT message FROM run_logs WHERE job_id = ? ORDER BY seq').pluck().all(jobId) as string[];
}

const starting = (lines: string[], prefix: string) => lines.filter((l) => l.startsWith(prefix));

/** J10: nessun log contiene i valori delle chiavi (qui finte, in produzione quelle del `.env`). */
function expectNoSecrets() {
  const all = (db.prepare('SELECT message FROM run_logs').pluck().all() as string[]).join('\n');
  for (const key of [config.apifyToken, config.anthropicApiKey, config.apolloApiKey]) {
    expect(key).not.toBe('');
    expect(all).not.toContain(key);
  }
}

function freshDb(settings: Parameters<typeof updateSettings>[0] = {}) {
  resetE2eData();
  delete process.env.JOB_ID;
  updateSettings({ own_profile_url: PROFILE, ...settings });
}

const byName = (name: string) => db.prepare('SELECT id FROM prospects WHERE full_name = ?').pluck().get(name) as number;

describe('kind Apify: fasi e chiamate per operazione', () => {
  beforeEach(() => freshDb({ company_description: 'Software su misura e migrazioni cloud per PMI.' }));

  it('sync interazioni: post del profilo, reazioni per pagina, commenti per post; i warning finiscono nel log', async () => {
    const { job, lines } = await runAsJob('sync_interactions', { force: false, postsOnly: false });
    expect(job.state).toBe('succeeded');
    expect(lines[0]).toBe('Avvio: Sync interazioni');
    expect(lines).toContain('Apify · post del profilo');
    expect(starting(lines, 'Apify · reazioni · pagina 1').length).toBe(1);
    expect(starting(lines, 'Apify · commenti · ').length).toBeGreaterThan(0);
    expect(lines.at(-1)).toBe('Fine: completato');

    // WARN: il warning dell'esito è anche una riga del log (J8).
    const warn = await runAsJob('sync_interactions', { __fixture: 'WARN' });
    const warning = warn.job.result?.warnings?.[0];
    expect(warning).toBeTruthy();
    expect(warn.lines).toContain(warning);
    expect(warn.lines.at(-1)).toBe('Fine: completato con avvisi');
    expectNoSecrets();
  });

  it("persone di un'azienda: una riga per la chiamata con il nome dell'azienda", async () => {
    const icp = createIcp({ name: 'CTO di PMI', target_roles: ['CTO'] });
    const list = createList({ icpId: icp.id, name: 'CTO manifattura' })!;
    const company = createCompany({ linkedin_url: 'https://www.linkedin.com/company/acme-cloud-e2e', name: 'Acme Cloud Srl' });
    const { job, lines } = await runAsJob('source_company', {
      companyId: company.id,
      listId: list.id,
      roles: ['CTO'],
      locations: [],
      maxItems: 50,
      mode: 'Short',
    });
    expect(job.state).toBe('succeeded');
    expect(lines).toContain('Apify · dipendenti · Acme Cloud Srl');
    expectNoSecrets();
  });

  it('arricchimento: una riga per profilo, col nome della persona, e una riga d\'errore per chi fallisce', async () => {
    await runAsJob('sync_interactions', {});
    const ids = db.prepare('SELECT id FROM prospects ORDER BY id').pluck().all() as number[];
    const { job, lines } = await runAsJob('enrich', { prospectIds: ids, onlyMissing: true, retryFailed: false, provider: 'apify' });
    expect(job.state).toBe('succeeded');
    expect(lines).toContain('Apify · profilo · Giulia Marchetti');
    expect(starting(lines, 'Apify · profilo · ')).toHaveLength(ids.length);
    expectNoSecrets();
  });

  it('analisi: una riga per persona analizzata dal modello', async () => {
    await runAsJob('sync_interactions', {});
    const others = ['Giulia Marchetti', 'Luca Bernardi', 'Paolo Ranieri'].map(byName);
    await runAsJob('enrich', { prospectIds: others, onlyMissing: true, retryFailed: false, provider: 'apify' });
    const icpId = createIcp({ name: 'CTO di PMI manifatturiere', target_roles: ['CTO', 'Head of Engineering'] }).id;

    const { job, lines } = await runAsJob('analyze', { prospectIds: others, icpId, force: false, enrichFirst: false });
    expect(job.state).toBe('succeeded');
    expect(lines).toContain('Anthropic · analisi · Giulia Marchetti');
    expect(starting(lines, 'Anthropic · analisi · ')).toHaveLength(3);
    expectNoSecrets();
  });
});

describe('kind Apollo: chiamate per operazione ed errori per elemento', () => {
  let apollo: Awaited<ReturnType<typeof seedE2eData>>['apollo'];
  beforeEach(async () => {
    delete process.env.JOB_ID;
    apollo = (await seedE2eData()).apollo;
  });

  it('tdd_target: contatti Apollo → una ricerca per azienda, il match per lotto e una riga d\'errore sull\'azienda fallita', async () => {
    const turni = createCompany({ website: 'turni-facili.example', name: 'Turni Facili Srl' }).id;
    const rotta = createCompany({ website: 'apollo-fail.example', name: 'Azienda Rotta Srl' }).id;
    const params = planContacts(apollo.icp_id, { companyIds: [turni, rotta], listId: apollo.list_id }).params!;

    const { job, lines } = await runAsJob('apollo_people', params);
    expect(job.state).toBe('succeeded');
    expect(lines).toContain('Apollo · ricerca persone · Turni Facili Srl');
    expect(lines).toContain('Apollo · ricerca persone · Azienda Rotta Srl');
    expect(starting(lines, 'Apollo · match persone · Turni Facili Srl')).toHaveLength(1);
    expect(starting(lines, 'Errore su Azienda Rotta Srl: actor:apollo:mixed_people/api_search:')).toHaveLength(1);
    expectNoSecrets();
  });

  it('aziende simili e arricchimento aziende: pagine cercate e lotti arricchiti', async () => {
    const search = await runAsJob('lookalike_companies', planLookalike(apollo.icp_id, { pages: 1, perPage: 25 })!.params);
    expect(search.job.state).toBe('succeeded');
    expect(search.lines).toContain('Apollo · ricerca aziende · pagina 1');
    expect(starting(search.lines, 'Apollo · arricchimento aziende · ').length).toBeGreaterThan(0);

    const enrich = await runAsJob('enrich_companies', planEnrichCompanies({ icpId: apollo.icp_id }, { retryNotFound: true })!.params);
    expect(enrich.job.state).toBe('succeeded');
    expect(starting(enrich.lines, 'Apollo · arricchimento aziende · ').length).toBeGreaterThan(0);
    expectNoSecrets();
  });

  it('LOG_FLOOD: il log supera il tetto e viene troncato al centro', async () => {
    const { id } = await runAsJob('lookalike_companies', {
      ...planLookalike(apollo.icp_id, { pages: 1, perPage: 25 })!.params,
      __fixture: 'LOG_FLOOD',
    });
    const { lines, omitted } = readRunLog(id);
    expect(lines).toHaveLength(5000);
    expect(omitted).toBeGreaterThan(0);
    expect(lines[0]).toMatchObject({ seq: 1, message: 'Avvio: Aziende simili (Apollo)' });
    // Il taglio è al centro: avvio ed esito restano visibili (J11).
    expect(lines.at(-1)!.message).toMatch(/^Fine: completato/);
  });
});
