import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Preview della ricerca aziende simili, storico ricerche e avvio (apollo-lookalike T7a, SPEC D1–D6/D14,
// FLOW A.2). Import dinamici: la config (DB_PATH isolato da tests/setup.ts) è letta a import-time.
// Nessuna chiamata Apollo: la route non esegue il job (i test di avvio lanciano un figlio innocuo). Pipeline
// `autoContacts` (T9): stima sommata, blocker della lista (SPEC H4), avvio con le opzioni congelate.
const { config } = await import('../src/config.js');
const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/server/app.js');
const { createCompany, upsertCompany } = await import('../src/db/companies.js');
const { createIcp, setReferenceCompany } = await import('../src/db/icps.js');
const { createList, updateList } = await import('../src/db/lists.js');
const { completeJob, insertJob, setJobPid } = await import('../src/db/jobs.js');
const { setCandidateStatus, upsertCandidate } = await import('../src/db/candidates.js');
const { filtersHash } = await import('../src/apollo/similarity.js');

const app = createApp();
/** App che avvia un figlio innocuo al posto del job reale. */
const launcher = createApp({ jobs: { command: 'node', args: ['-e', ''] } });

const FIXTURE = JSON.parse(fs.readFileSync(new URL('./fixtures/apollo/organizations-bulk-enrich.json', import.meta.url), 'utf8'))
  .organizations[0] as Record<string, unknown>;

const ENRICHED_AT = '2026-09-10T10:00:00.000Z';

/** Filtri dell'esempio SPEC (Regole di somiglianza) per referenze Acme + Beta arricchite e ICP. */
const EXAMPLE_FILTERS = {
  keywords: ['hr', 'human resources', 'payroll', 'saas', 'software', 'hr tech'],
  ranges: ['1-10', '11-20', '21-50', '51-100', '101-200'],
  locations: ['Italy', 'Milano'],
};

const TEXT = {
  noKey: 'APOLLO_API_KEY mancante nel .env — nessun job avviato.',
  emptyFilters: 'Tutti i filtri sono vuoti: aggiungi almeno una parola chiave, una fascia o una località.',
  noList: 'Nessuna lista attiva per questo ICP: potrai trovare i contatti solo dopo aver creato una lista.',
  noEnriched: 'Nessuna referenza arricchita: i filtri derivano solo dall\'ICP.',
  noKeywords: 'Nessuna parola chiave: la ricerca userà solo fasce e località, i risultati saranno poco simili.',
  emptyIcp: "L'ICP non ha settori, dimensione né località.",
};

function reset(): void {
  db.exec(`
    DELETE FROM sources; DELETE FROM prospects; DELETE FROM lists;
    DELETE FROM icp_company_candidates; DELETE FROM icp_reference_companies;
    DELETE FROM companies; DELETE FROM icps; DELETE FROM jobs;
  `);
}

const saved = { key: config.apolloApiKey, price: config.prices.apolloCreditUsd, maxPages: config.apolloMaxCompanyPages, rate: config.apolloRateLimitPerMinute };
beforeEach(reset);
afterEach(() => {
  config.apolloApiKey = saved.key;
  config.prices.apolloCreditUsd = saved.price;
  config.apolloMaxCompanyPages = saved.maxPages;
  config.apolloRateLimitPerMinute = saved.rate;
});

async function get(path: string) {
  const res = await app.request(path);
  return { status: res.status, body: (await res.json()) as any };
}

async function post(path: string, body: unknown, target = app) {
  const res = await target.request(path, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
  return { status: res.status, body: (await res.json()) as any };
}

/** ICP dell'esempio SPEC: settori `hr tech`, dimensione `10-50`, località `Milano`. */
function exampleIcp(extra: Parameters<typeof createIcp>[0] extends infer T ? Partial<T> : never = {}) {
  return createIcp({ name: 'CTO startup IT', target_industries: ['hr tech'], company_size: '10-50', target_locations: ['Milano'], ...extra }).id;
}

interface OrgData {
  name: string;
  domain: string;
  industry: string;
  keywords: string[];
  employees: number;
  city: string;
  state: string;
  country: string;
}

/** Referenza arricchita: `apollo_json` con la forma degli item di `organizations/bulk_enrich`. */
function enrichedReference(icpId: number, o: OrgData): number {
  const orgId = `org-${o.domain}`;
  const json = {
    ...FIXTURE,
    id: orgId,
    name: o.name,
    website_url: `http://www.${o.domain}`,
    linkedin_url: null,
    primary_domain: o.domain,
    industry: o.industry,
    keywords: o.keywords,
    estimated_num_employees: o.employees,
    city: o.city,
    state: o.state,
    country: o.country,
  };
  const { id } = upsertCompany({ domain: o.domain, name: o.name, apollo: { orgId, json, enrichedAt: ENRICHED_AT } });
  setReferenceCompany(icpId, id!);
  return id!;
}

const ACME: OrgData = { name: 'Acme', domain: 'acme.it', industry: 'Software', keywords: ['SaaS', 'hr'], employees: 80, city: 'Milan', state: 'Lombardy', country: 'Italy' };
const BETA: OrgData = { name: 'Beta', domain: 'beta.io', industry: 'human resources', keywords: ['HR', 'payroll'], employees: 30, city: 'Turin', state: 'Piedmont', country: 'Italy' };

/** Scenario dell'esempio SPEC: ICP + Acme e Beta arricchite (+ lista attiva, così nessun warning). */
function exampleScenario(opts: { list?: boolean } = {}) {
  const icpId = exampleIcp();
  const acme = enrichedReference(icpId, ACME);
  const beta = enrichedReference(icpId, BETA);
  if (opts.list !== false) createList({ icpId, name: 'Lista CTO' });
  return { icpId, acme, beta };
}

/** Ricerca riuscita seminata in `jobs` (come la scriverebbe T7b). */
function succeededRun(
  icpId: number,
  opts: { filters?: typeof EXAMPLE_FILTERS; perPage?: number; lastPage?: number; declared?: number; at?: string } = {},
) {
  const filters = opts.filters ?? EXAMPLE_FILTERS;
  const job = insertJob('lookalike_companies', {
    icpId,
    pages: 1,
    perPage: opts.perPage ?? 25,
    startPage: 1,
    ...filters,
    filtersHash: filtersHash(filters),
    restart: false,
    autoContacts: null,
  });
  completeJob(job.id, {
    state: 'succeeded',
    result: {
      summary: 'ok',
      counts: { read: 25, new_candidates: 20, pages_read: 1, last_page: opts.lastPage ?? 1, last_page_declared: opts.declared ?? 25 },
    },
  });
  if (opts.at) db.prepare('UPDATE jobs SET finished_at = ? WHERE id = ?').run(opts.at, job.id);
  return job.id;
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });

describe('GET /api/icps/:id/lookalike/preview', () => {
  it('esempio SPEC: filtri derivati dalle referenze arricchite + ICP e crediti 1 pagina da 25 = 26 (tdd_target)', async () => {
    const { icpId, acme, beta } = exampleScenario();

    const { status, body } = await get(`/api/icps/${icpId}/lookalike/preview`);

    expect(status).toBe(200);
    expect(body.filters).toMatchObject({ ...EXAMPLE_FILTERS, custom: false, notes: [] });
    expect(body.filters.derived).toEqual(EXAMPLE_FILTERS);
    expect(body.filters.origins.keywords).toMatchObject({ hr: ['Acme', 'Beta'], saas: ['Acme'], payroll: ['Beta'], 'hr tech': ['ICP'] });
    expect(body.filters.origins.ranges['51-100']).toEqual(['Acme', 'Beta']);
    expect(body.filters.origins.locations).toEqual({ Italy: ['Acme', 'Beta'], Milano: ['ICP'] });
    expect(body.counts).toEqual({ pages: 1, per_page: 25, start_page: 1, est_credits: 26, requests: 4 });
    expect(body.est_cost_usd).toBeNull();
    expect(body.warnings).toEqual([]);
    expect(body.blockers).toEqual([]);
    expect(body.resume).toBeNull();
    expect(body.references).toEqual([
      { company_id: acme, name: 'Acme', domain: 'acme.it', linkedin_url: null, status: 'enriched', enriched_at: ENRICHED_AT, attempted_at: ENRICHED_AT },
      { company_id: beta, name: 'Beta', domain: 'beta.io', linkedin_url: null, status: 'enriched', enriched_at: ENRICHED_AT, attempted_at: ENRICHED_AT },
    ]);
  });

  it('pagine × dimensione cambiano crediti e richieste; costo = crediti × APOLLO_CREDIT_USD; oltre il limite al minuto → warning', async () => {
    const { icpId } = exampleScenario();
    config.prices.apolloCreditUsd = 0.1;

    const one = (await get(`/api/icps/${icpId}/lookalike/preview`)).body;
    expect(one.est_cost_usd).toBe(2.6);

    const two = (await get(`/api/icps/${icpId}/lookalike/preview?pages=2&perPage=50`)).body;
    expect(two.counts).toEqual({ pages: 2, per_page: 50, start_page: 1, est_credits: 102, requests: 12 });
    expect(two.est_cost_usd).toBe(10.2);
    expect(two.warnings).toEqual([]);

    const big = (await get(`/api/icps/${icpId}/lookalike/preview?pages=3&perPage=100`)).body;
    expect(big.counts).toMatchObject({ est_credits: 303, requests: 33 });
    expect(big.warnings).toEqual([
      'Fino a 33 richieste Apollo: più del limite di 20 al minuto; il job rallenta e si ferma con esito parziale se Apollo limita.',
    ]);
  });

  it('pagine fuori range, dimensione non ammessa o fascia sconosciuta → 400; ICP inesistente → 404', async () => {
    const { icpId } = exampleScenario();
    config.apolloMaxCompanyPages = 3;

    for (const query of ['pages=0', 'pages=4', 'pages=1.5', 'pages=abc', 'perPage=30', 'custom=1&ranges=7-12']) {
      const res = await get(`/api/icps/${icpId}/lookalike/preview?${query}`);
      expect(res.status, query).toBe(400);
      expect(res.body.error).toBeTypeOf('string');
      expect(res.body.issues.length, query).toBeGreaterThan(0);
    }
    expect((await get('/api/icps/999999/lookalike/preview')).status).toBe(404);
  });

  it('1 referenza arricchita + 1 con sito non arricchita + non trovata + senza sito → warning per nome, filtri dalla sola arricchita + ICP', async () => {
    const icpId = exampleIcp();
    const acme = enrichedReference(icpId, ACME);
    const beta = createCompany({ website: 'https://www.beta.io', name: 'Beta' }).id;
    setReferenceCompany(icpId, beta);
    const delta = createCompany({ linkedin_url: 'https://www.linkedin.com/company/delta', name: 'Delta' }).id;
    setReferenceCompany(icpId, delta);
    const epsilon = upsertCompany({ domain: 'epsilon.it', name: 'Epsilon', apollo: { orgId: null, json: { outcome: 'not_found' }, enrichedAt: ENRICHED_AT } }).id!;
    setReferenceCompany(icpId, epsilon);
    const zeta = upsertCompany({ domain: 'zeta.it', name: 'Zeta', apollo: { orgId: null, json: { outcome: 'key_conflict', apollo_keys: {} }, enrichedAt: ENRICHED_AT } }).id!;
    setReferenceCompany(icpId, zeta);

    const { body } = await get(`/api/icps/${icpId}/lookalike/preview`);

    expect(body.filters).toMatchObject({
      keywords: ['hr', 'saas', 'software', 'hr tech'],
      ranges: ['1-10', '11-20', '21-50', '51-100', '101-200'],
      locations: ['Italy', 'Milano'],
    });
    expect(body.filters.origins.keywords.hr).toEqual(['Acme']);
    expect(body.references.map((r: any) => [r.company_id, r.status, r.enriched_at])).toEqual([
      [acme, 'enriched', ENRICHED_AT],
      [beta, 'to_enrich', null],
      [delta, 'no_domain', null],
      [epsilon, 'not_found', null],
      [zeta, 'key_conflict', null],
    ]);
    expect(body.references.find((r: any) => r.company_id === epsilon).attempted_at).toBe(ENRICHED_AT);
    expect(body.warnings).toEqual([
      TEXT.noList,
      'Beta non è ancora arricchita: i suoi settori e dimensioni non entrano nei filtri. Arricchisci le referenze prima.',
      `Epsilon non è stata trovata su Apollo il ${shortDate(ENRICHED_AT)}: i suoi settori e dimensioni non entrano nei filtri. Correggi il sito della referenza.`,
      `Zeta ha chiavi in conflitto con Apollo (${shortDate(ENRICHED_AT)}): i suoi settori e dimensioni non entrano nei filtri. Correggi l'URL LinkedIn o il sito in anagrafica.`,
      'Delta è senza sito: ignorata per la ricerca. Aggiungi il sito in Aziende → Delta per usarla.',
    ]);
    expect(body.blockers).toEqual([]);
    expect(body.counts.est_credits).toBe(26);
  });

  it('nessuna referenza arricchita → warning, filtri solo dall\'ICP; senza settori → warning parole chiave', async () => {
    const icpId = exampleIcp();
    createList({ icpId, name: 'Lista' });
    const onlyIcp = (await get(`/api/icps/${icpId}/lookalike/preview`)).body;
    expect(onlyIcp.filters).toMatchObject({ keywords: ['hr tech'], ranges: ['1-10', '11-20', '21-50'], locations: ['Milano'] });
    expect(onlyIcp.warnings).toEqual([TEXT.noEnriched]);
    expect(onlyIcp.blockers).toEqual([]);

    const sizeOnly = createIcp({ name: 'Solo dimensione', company_size: '50+' }).id;
    createList({ icpId: sizeOnly, name: 'Lista 2' });
    const noKeywords = (await get(`/api/icps/${sizeOnly}/lookalike/preview`)).body;
    expect(noKeywords.filters.keywords).toEqual([]);
    expect(noKeywords.filters.ranges[0]).toBe('21-50');
    expect(noKeywords.warnings).toEqual([TEXT.noEnriched, TEXT.noKeywords]);

    const odd = createIcp({ name: 'Dimensione strana', target_industries: ['fintech'], company_size: 'piccola' }).id;
    const notes = (await get(`/api/icps/${odd}/lookalike/preview`)).body.filters.notes;
    expect(notes).toEqual([expect.stringContaining('"piccola" non è riconoscibile')]);
  });

  it('blocker: chiave Apollo mancante', async () => {
    const { icpId } = exampleScenario();
    config.apolloApiKey = '';
    const { body } = await get(`/api/icps/${icpId}/lookalike/preview`);
    expect(body.blockers).toEqual([TEXT.noKey]);
  });

  it('blocker: ICP senza settori/dimensione/località e nessuna referenza arricchita → filtri vuoti', async () => {
    const icpId = createIcp({ name: 'Vuoto' }).id;
    const beta = createCompany({ website: 'beta.io', name: 'Beta' }).id;
    setReferenceCompany(icpId, beta);

    const { body } = await get(`/api/icps/${icpId}/lookalike/preview`);

    expect(body.filters).toMatchObject({ keywords: [], ranges: [], locations: [] });
    expect(body.blockers).toEqual([TEXT.emptyFilters]);
    expect(body.warnings).toEqual([
      TEXT.noList,
      'Beta non è ancora arricchita: i suoi settori e dimensioni non entrano nei filtri. Arricchisci le referenze prima.',
      TEXT.noEnriched,
      TEXT.emptyIcp,
    ]);
  });

  it('filtri modificati (`custom=1`): valori normalizzati, origini conservate, derivati a parte; tutto tolto → blocker', async () => {
    const { icpId } = exampleScenario();

    const custom = (await get(`/api/icps/${icpId}/lookalike/preview?custom=1&keywords=%20Fintech%20&keywords=HR&keywords=fintech&ranges=51%2C100&ranges=21-50&locations=Torino&locations=&locations=torino`)).body;
    expect(custom.filters).toMatchObject({ keywords: ['fintech', 'hr'], ranges: ['21-50', '51-100'], locations: ['Torino'], custom: true });
    expect(custom.filters.derived).toEqual(EXAMPLE_FILTERS);
    expect(custom.filters.origins.keywords).toEqual({ fintech: [], hr: ['Acme', 'Beta'] });
    expect(custom.filters.origins.ranges).toEqual({ '21-50': ['Acme', 'Beta', 'ICP'], '51-100': ['Acme', 'Beta'] });
    expect(custom.filters.origins.locations).toEqual({ Torino: [] });
    expect(custom.blockers).toEqual([]);

    const cleared = (await get(`/api/icps/${icpId}/lookalike/preview?custom=1`)).body;
    expect(cleared.filters).toMatchObject({ keywords: [], ranges: [], locations: [], custom: true });
    expect(cleared.blockers).toEqual([TEXT.emptyFilters]);

    // Senza `custom` i parametri dei filtri sono ignorati: valgono i derivati.
    const ignored = (await get(`/api/icps/${icpId}/lookalike/preview?keywords=fintech`)).body;
    expect(ignored.filters).toMatchObject({ ...EXAMPLE_FILTERS, custom: false });
  });

  describe('ripartenza (SPEC D6)', () => {
    it('stessi filtri e stessa dimensione, ultima pagina piena → continua dalla pagina successiva; restart=1 → 1', async () => {
      const { icpId } = exampleScenario();
      const at = '2026-09-16T09:00:00.000Z';
      const runId = succeededRun(icpId, { lastPage: 1, declared: 25, at });

      const cont = (await get(`/api/icps/${icpId}/lookalike/preview`)).body;
      expect(cont.resume).toEqual({
        run_id: runId,
        last_run_at: at,
        per_page: 25,
        last_page: 1,
        last_page_declared: 25,
        next_page: 2,
        exhausted: false,
        restart: false,
      });
      expect(cont.counts.start_page).toBe(2);
      expect(cont.warnings).toEqual([`Stessi filtri della ricerca del ${shortDate(at)} (letta fino alla pagina 1): continuo dalla pagina 2.`]);

      // Filtri modificati ma con gli stessi insiemi normalizzati: stessa ricerca.
      const same = (await get(`/api/icps/${icpId}/lookalike/preview?custom=1&keywords=Software&keywords=HR&keywords=human%20resources&keywords=payroll&keywords=saas&keywords=hr%20tech&ranges=101-200&ranges=1-10&ranges=11-20&ranges=21-50&ranges=51-100&locations=milano&locations=ITALY`)).body;
      expect(same.counts.start_page).toBe(2);

      const restart = (await get(`/api/icps/${icpId}/lookalike/preview?restart=1`)).body;
      expect(restart.counts.start_page).toBe(1);
      expect(restart.resume).toMatchObject({ next_page: 2, restart: true });
      expect(restart.warnings).toEqual([
        `Ricomincio dalla pagina 1 con i filtri della ricerca del ${shortDate(at)}: ricominciare ripaga pagine già lette.`,
      ]);
    });

    it('ultima pagina non piena → ricerca esaurita (parte dalla pagina 1 con warning)', async () => {
      const { icpId } = exampleScenario();
      succeededRun(icpId, { lastPage: 2, declared: 17 });

      const { body } = await get(`/api/icps/${icpId}/lookalike/preview`);

      expect(body.resume).toMatchObject({ last_page: 2, last_page_declared: 17, next_page: null, exhausted: true });
      expect(body.counts.start_page).toBe(1);
      expect(body.warnings).toEqual([
        'Ricerca esaurita con questi filtri (ultima pagina: 17 aziende su 25): ricomincia dalla pagina 1 o cambia i filtri.',
      ]);
    });

    it('dimensione di pagina diversa o filtri diversi → nessuna ripartenza', async () => {
      const { icpId } = exampleScenario();
      const at = '2026-09-16T09:00:00.000Z';
      succeededRun(icpId, { lastPage: 1, declared: 25, at });

      const otherSize = (await get(`/api/icps/${icpId}/lookalike/preview?perPage=50`)).body;
      expect(otherSize.resume).toBeNull();
      expect(otherSize.counts.start_page).toBe(1);
      expect(otherSize.warnings).toEqual([
        `Stessi filtri della ricerca del ${shortDate(at)} ma con 25 aziende per pagina: la continuazione richiede la stessa dimensione, riparto dalla pagina 1.`,
      ]);

      const otherFilters = (await get(`/api/icps/${icpId}/lookalike/preview?custom=1&keywords=fintech`)).body;
      expect(otherFilters.resume).toBeNull();
      expect(otherFilters.counts.start_page).toBe(1);
      expect(otherFilters.warnings).toEqual([]);
    });
  });
});

describe('GET /api/icps/:id/lookalike/runs', () => {
  it('ultime 5 ricerche riuscite dalla più recente, con filtri, conteggi e statistiche fascia × stato', async () => {
    const { icpId } = exampleScenario();
    const older = Array.from({ length: 5 }, () => succeededRun(icpId, { perPage: 50 }));
    const failed = insertJob('lookalike_companies', { icpId });
    completeJob(failed.id, { state: 'failed', error: 'actor:apollo:mixed_companies/search: errore' });
    const latest = succeededRun(icpId);

    const low1 = createCompany({ website: 'low1.it', name: 'Low 1' }).id;
    const low2 = createCompany({ website: 'low2.it', name: 'Low 2' }).id;
    const high = createCompany({ website: 'high.it', name: 'High' }).id;
    upsertCandidate({ icpId, companyId: low1, score: 0.2, parts: { keywords: 0, size: 0.5, location: 0 }, reasons: [], jobId: latest });
    upsertCandidate({ icpId, companyId: low2, score: 0.1, parts: { keywords: 0, size: 0, location: null }, reasons: [], jobId: latest });
    upsertCandidate({ icpId, companyId: high, score: 0.8, parts: { keywords: 1, size: 1, location: 0 }, reasons: [], jobId: latest });
    setCandidateStatus(icpId, [low1, low2], 'scartata');
    setCandidateStatus(icpId, [high], 'accettata');

    const { status, body } = await get(`/api/icps/${icpId}/lookalike/runs`);

    expect(status).toBe(200);
    expect(body.items.map((r: any) => r.id)).toEqual([latest, ...older.slice(1).reverse()]);
    const zero = { proposta: 0, accettata: 0, scartata: 0 };
    expect(body.items[0]).toMatchObject({
      id: latest,
      state: 'succeeded',
      pages: 1,
      per_page: 25,
      filters: EXAMPLE_FILTERS,
      counts: { read: 25, new_candidates: 20, last_page: 1 },
      stats: {
        proposed: 3,
        without_location: 1,
        buckets: { basso: { ...zero, scartata: 2 }, medio: zero, alto: { ...zero, accettata: 1 } },
      },
    });
    expect(body.items[1]).toMatchObject({ per_page: 50, stats: { proposed: 0, without_location: 0 } });

    expect((await get('/api/icps/999999/lookalike/runs')).status).toBe(404);
  });
});

describe('POST /api/icps/:id/lookalike', () => {
  const body = (extra: Record<string, unknown> = {}) => ({ pages: 1, perPage: 25, ...EXAMPLE_FILTERS, ...extra });

  it('202 con i params congelati (filtri normalizzati, hash, pagina di partenza, pipeline spenta)', async () => {
    const { icpId } = exampleScenario();
    succeededRun(icpId, { lastPage: 1, declared: 25 });

    const res = await post(`/api/icps/${icpId}/lookalike`, body({ keywords: ['HR', ' payroll', 'saas', 'Software', 'human resources', 'hr tech'], autoContacts: null }), launcher);

    expect(res.status).toBe(202);
    const { job } = res.body;
    try {
      expect(job).toMatchObject({ kind: 'lookalike_companies', state: 'running' });
      expect(job.params).toEqual({
        icpId,
        pages: 1,
        perPage: 25,
        startPage: 2,
        keywords: ['hr', 'payroll', 'saas', 'software', 'human resources', 'hr tech'],
        ranges: EXAMPLE_FILTERS.ranges,
        locations: EXAMPLE_FILTERS.locations,
        filtersHash: filtersHash(EXAMPLE_FILTERS),
        restart: false,
        autoContacts: null,
      });
    } finally {
      completeJob(job.id, { state: 'failed', error: 'process: fine test' });
    }

    const restarted = await post(`/api/icps/${icpId}/lookalike`, { pages: 2, ...EXAMPLE_FILTERS, restart: true }, launcher);
    expect(restarted.status).toBe(202);
    completeJob(restarted.body.job.id, { state: 'failed', error: 'process: fine test' });
    expect(restarted.body.job.params).toMatchObject({ pages: 2, perPage: 25, startPage: 1, restart: true });
  });

  it('400 `blocked` senza chiave o con filtri vuoti; nessun job creato', async () => {
    const { icpId } = exampleScenario();

    config.apolloApiKey = '';
    const noKey = await post(`/api/icps/${icpId}/lookalike`, body(), launcher);
    expect(noKey.status).toBe(400);
    expect(noKey.body).toMatchObject({ code: 'blocked', blockers: [TEXT.noKey] });
    expect(noKey.body.error).toBeTypeOf('string');
    config.apolloApiKey = saved.key;

    const empty = await post(`/api/icps/${icpId}/lookalike`, body({ keywords: [], ranges: [], locations: [' '] }), launcher);
    expect(empty.status).toBe(400);
    expect(empty.body).toMatchObject({ code: 'blocked', blockers: [TEXT.emptyFilters] });

    expect(db.prepare('SELECT COUNT(*) FROM jobs').pluck().get()).toBe(0);
  });

  it('job già in corso → preview con blocker e avvio 409 `job_running`', async () => {
    const { icpId } = exampleScenario();
    const running = insertJob('enrich', {});
    setJobPid(running.id, process.pid);
    try {
      const preview = (await get(`/api/icps/${icpId}/lookalike/preview`)).body;
      expect(preview.blockers).toEqual([expect.stringMatching(/^C'è già un job in corso: Arricchimento/)]);
      const busy = await post(`/api/icps/${icpId}/lookalike`, body(), launcher);
      expect(busy.status).toBe(409);
      expect(busy.body).toMatchObject({ code: 'job_running', job_id: running.id });
    } finally {
      completeJob(running.id, { state: 'failed', error: 'process: fine test' });
    }
  });

  it('validazione: pagine oltre il tetto, dimensione non ammessa, campi ignoti, fascia sconosciuta, pipeline malformata → 400; ICP inesistente → 404', async () => {
    const { icpId } = exampleScenario();
    config.apolloMaxCompanyPages = 3;
    const url = `/api/icps/${icpId}/lookalike`;

    for (const invalid of [
      body({ pages: 4 }),
      body({ pages: 0 }),
      body({ perPage: 30 }),
      body({ extra: true }),
      body({ ranges: ['7-12'] }),
      { perPage: 25, ...EXAMPLE_FILTERS },
      body({ autoContacts: { roles: ['CTO'] } }),
      body({ autoContacts: { listId: 1, perCompany: 0 } }),
      body({ autoContacts: { listId: 1, perCompany: 101 } }),
      body({ autoContacts: { listId: 1, seniorities: ['boss'] } }),
      body({ autoContacts: { listId: 1, extra: true } }),
      body({ autoContacts: true }),
    ]) {
      const res = await post(url, invalid, launcher);
      expect(res.status, JSON.stringify(invalid)).toBe(400);
      expect(res.body.issues.length).toBeGreaterThan(0);
    }

    expect((await post('/api/icps/999999/lookalike', body(), launcher)).status).toBe(404);
    expect(db.prepare('SELECT COUNT(*) FROM jobs').pluck().get()).toBe(0);
  });
});

describe('pipeline `autoContacts` (T9, SPEC H1–H4, FLOW E)', () => {
  const PIPELINE_WARNING =
    'Le persone entreranno in lista anche da aziende che poi scarterai: puoi rimuoverle dalla lista, ma non torna indietro da solo.';
  const NO_ACTIVE_LIST = 'Crea una lista per questo ICP per usare questa opzione.';
  const body = (autoContacts: unknown) => ({ pages: 1, perPage: 25, ...EXAMPLE_FILTERS, autoContacts });

  function listOf(icpId: number, name = 'Lista CTO') {
    return createList({ icpId, name })!.id;
  }

  it('preview 1 pagina × 25 × 10 persone: totali e dettaglio (26 + 250 crediti), warning della pipeline, opzioni risolte', async () => {
    const { icpId } = exampleScenario({ list: false });
    const listId = listOf(icpId);
    config.prices.apolloCreditUsd = 0.1;

    const { status, body: preview } = await get(`/api/icps/${icpId}/lookalike/preview?contacts=1&contactsListId=${listId}&contactsPerCompany=10`);

    expect(status).toBe(200);
    expect(preview.counts).toEqual({
      pages: 1,
      per_page: 25,
      start_page: 1,
      est_credits: 276,
      requests: 54,
      search_est_credits: 26,
      search_requests: 4,
      contacts_companies: 25,
      contacts_per_company: 10,
      contacts_est_credits: 250,
      contacts_requests: 50,
    });
    expect(preview.est_cost_usd).toBe(27.6);
    expect(preview.blockers).toEqual([]);
    // ICP senza ruoli target: stesso warning di "Trova contatti"; richieste totali oltre il limite al minuto.
    expect(preview.warnings).toEqual([
      PIPELINE_WARNING,
      "L'ICP non ha ruoli target: verranno prese le prime 10 persone qualunque per azienda.",
      'Fino a 54 richieste Apollo: più del limite di 20 al minuto; il job rallenta e si ferma con esito parziale se Apollo limita.',
    ]);
    // Chiavi assenti = default dell'ICP (località) e della config.
    expect(preview.contacts).toEqual({ list_id: listId, roles: [], seniorities: [], locations: ['Milano'], per_company: 10 });

    const custom = (
      await get(
        `/api/icps/${icpId}/lookalike/preview?pages=2&perPage=50&contacts=1&contactsListId=${listId}&contactsRoles=CTO&contactsRoles=Head%20of%20Engineering&contactsSeniorities=vp,head&contactsLocations=Milano%2C%20Italia&contactsPerCompany=2`,
      )
    ).body;
    expect(custom.counts).toMatchObject({ est_credits: 302, search_est_credits: 102, contacts_companies: 100, contacts_est_credits: 200, contacts_requests: 120, requests: 132 });
    expect(custom.contacts).toEqual({
      list_id: listId,
      roles: ['CTO', 'Head of Engineering'],
      seniorities: ['vp', 'head'],
      locations: ['Milano, Italia'],
      per_company: 2,
    });
    expect(custom.warnings).not.toContain("L'ICP non ha ruoli target: verranno prese le prime 2 persone qualunque per azienda.");

    // Senza `contacts=1` i parametri `contacts*` sono ignorati.
    const off = (await get(`/api/icps/${icpId}/lookalike/preview?contactsListId=${listId}&contactsPerCompany=10`)).body;
    expect(off.counts).toEqual({ pages: 1, per_page: 25, start_page: 1, est_credits: 26, requests: 4 });
    expect(off.contacts).toBeNull();
    expect(off.warnings).toEqual([]);
  });

  it('preview: lista non scelta, di un altro ICP o archiviata → blocker di C; parametri non validi → 400 col nome del parametro', async () => {
    const { icpId } = exampleScenario();
    const other = listOf(createIcp({ name: 'Altro ICP' }).id, 'Lista altrui');
    const archived = listOf(icpId, 'Vecchia');
    updateList(archived, { archived: true });

    const blockersOf = async (query: string) => (await get(`/api/icps/${icpId}/lookalike/preview?contacts=1${query}`)).body.blockers;
    expect(await blockersOf('')).toEqual(['Scegli una lista di destinazione.']);
    expect(await blockersOf(`&contactsListId=${other}`)).toEqual([
      "La lista 'Lista altrui' non è dell'ICP 'CTO startup IT': scegli una lista di questo ICP.",
    ]);
    expect(await blockersOf(`&contactsListId=${archived}`)).toEqual(["La lista 'Vecchia' è archiviata: riattivala per aggiungere persone."]);

    config.apolloApiKey = '';
    const listId = db.prepare('SELECT id FROM lists WHERE icp_id = ? AND archived_at IS NULL').pluck().get(icpId);
    expect(await blockersOf(`&contactsListId=${listId}`)).toEqual([TEXT.noKey]);
    config.apolloApiKey = saved.key;

    for (const [query, path] of [
      ['&contactsPerCompany=0', 'contactsPerCompany'],
      ['&contactsPerCompany=abc', 'contactsPerCompany'],
      ['&contactsListId=x', 'contactsListId'],
      ['&contactsSeniorities=boss', 'contactsSeniorities.0'],
    ] as const) {
      const res = await get(`/api/icps/${icpId}/lookalike/preview?contacts=1${query}`);
      expect(res.status, query).toBe(400);
      expect(res.body.issues.map((i: any) => i.path), query).toEqual([path]);
    }
  });

  it('SPEC H4: nessuna lista attiva per l\'ICP → blocker in preview e avvio 400 `blocked`, nessun job', async () => {
    const { icpId } = exampleScenario({ list: false });
    const archived = listOf(icpId, 'Archiviata');
    updateList(archived, { archived: true });

    const preview = (await get(`/api/icps/${icpId}/lookalike/preview?contacts=1`)).body;
    expect(preview.blockers).toEqual([NO_ACTIVE_LIST]);
    expect(preview.warnings).toContain(TEXT.noList);

    const res = await post(`/api/icps/${icpId}/lookalike`, body({ listId: archived }), launcher);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: 'blocked',
      blockers: [NO_ACTIVE_LIST, "La lista 'Archiviata' è archiviata: riattivala per aggiungere persone."],
    });
    expect(res.body.error).toMatch(/^Ricerca non avviata: Crea una lista per questo ICP/);
    expect(db.prepare('SELECT COUNT(*) FROM jobs').pluck().get()).toBe(0);
  });

  it('avvio con pipeline → 202 con `autoContacts` congelati (default risolti)', async () => {
    const { icpId } = exampleScenario({ list: false });
    const listId = listOf(icpId);

    const res = await post(`/api/icps/${icpId}/lookalike`, body({ listId, roles: [' CTO ', 'cto'], seniorities: ['c_suite'] }), launcher);

    expect(res.status).toBe(202);
    const { job } = res.body;
    try {
      expect(job.params.autoContacts).toEqual({
        listId,
        roles: ['CTO'],
        seniorities: ['c_suite'],
        locations: ['Milano'],
        perCompany: config.apolloPeoplePerCompany,
      });
    } finally {
      completeJob(job.id, { state: 'failed', error: 'process: fine test' });
    }

    const off = await post(`/api/icps/${icpId}/lookalike`, body(null), launcher);
    expect(off.status).toBe(202);
    completeJob(off.body.job.id, { state: 'failed', error: 'process: fine test' });
    expect(off.body.job.params.autoContacts).toBeNull();
  });
});
