import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Job `lookalike_companies` — handler reale (apollo-lookalike T7b, SPEC D7–D14, S-7; FLOW A.3, Error paths,
// Edge cases). Import dinamici: la config (DB_PATH isolato da tests/setup.ts) è letta a import-time.
// Mai Apollo reale: `searchOrganizations` risponde nella forma di
// `tests/fixtures/apollo/smoke/mixed-companies-search.json` (senza campi descrittivi) e `enrichOrganizations`
// in quella di `tests/fixtures/apollo/organizations-bulk-enrich.json` (parole chiave, dipendenti, sede).
const { handler } = await import('../src/jobs/lookalike-companies.js');
const { config } = await import('../src/config.js');
const { db } = await import('../src/db/index.js');
const { createCompany, getCompany, upsertCompany } = await import('../src/db/companies.js');
const { createIcp, setReferenceCompany } = await import('../src/db/icps.js');
const { getCandidate, listCandidates, setCandidateStatus, upsertCandidate } = await import('../src/db/candidates.js');
const { filtersHash } = await import('../src/apollo/similarity.js');
const { insertJob } = await import('../src/db/jobs.js');
const { ApolloConfigError, ApolloProviderError, ApolloRateLimitError } = await import('../src/apollo/client.js');
const { createList, updateList } = await import('../src/db/lists.js');
const { runJob } = await import('../src/server/job-entry.js');
const { CONFIG_BLOCKERS } = await import('../src/jobs/handlers.js');

type Params = Parameters<typeof handler>[0];
type PeopleSearchParams = import('../src/apollo/requests.js').PeopleSearchParams;

const ENRICHED_AT = '2026-09-10T10:00:00.000Z';

/** Filtri dell'esempio SPEC (Regole di somiglianza) per referenze Acme + Beta arricchite e ICP. */
const FILTERS = {
  keywords: ['hr', 'human resources', 'payroll', 'saas', 'software', 'hr tech'],
  ranges: ['1-10', '11-20', '21-50', '51-100', '101-200'],
  locations: ['Italy', 'Milano'],
};

function reset(): void {
  db.exec(`
    DELETE FROM sources; DELETE FROM prospects; DELETE FROM lists;
    DELETE FROM icp_company_candidates; DELETE FROM icp_reference_companies;
    DELETE FROM companies; DELETE FROM icps; DELETE FROM jobs;
  `);
}

const saved = { key: config.apolloApiKey, jobId: process.env.JOB_ID };
beforeEach(reset);
afterEach(() => {
  config.apolloApiKey = saved.key;
  if (saved.jobId === undefined) delete process.env.JOB_ID;
  else process.env.JOB_ID = saved.jobId;
});

// ---------------------------------------------------------------------------
// Scenario dell'esempio SPEC: ICP + referenze Acme e Beta arricchite
// ---------------------------------------------------------------------------

interface RefData {
  name: string;
  domain: string;
  industry: string;
  keywords: string[];
  employees: number;
  city: string;
  state: string;
}

function enrichedReference(icpId: number, o: RefData): number {
  const orgId = `org-${o.domain}`;
  const json = {
    id: orgId,
    name: o.name,
    website_url: `http://www.${o.domain}`,
    primary_domain: o.domain,
    industry: o.industry,
    keywords: o.keywords,
    estimated_num_employees: o.employees,
    city: o.city,
    state: o.state,
    country: 'Italy',
  };
  const { id } = upsertCompany({ domain: o.domain, name: o.name, apollo: { orgId, json, enrichedAt: ENRICHED_AT } });
  setReferenceCompany(icpId, id!);
  return id!;
}

const ACME: RefData = { name: 'Acme', domain: 'acme.it', industry: 'Software', keywords: ['SaaS', 'hr'], employees: 80, city: 'Milan', state: 'Lombardy' };
const BETA: RefData = { name: 'Beta', domain: 'beta.io', industry: 'human resources', keywords: ['HR', 'payroll'], employees: 30, city: 'Turin', state: 'Piedmont' };

function scenario(name = 'CTO startup IT') {
  const icpId = createIcp({ name, target_industries: ['hr tech'], company_size: '10-50', target_locations: ['Milano'] }).id;
  const acme = enrichedReference(icpId, ACME);
  const beta = enrichedReference(icpId, BETA);
  return { icpId, acme, beta };
}

function params(icpId: number, extra: Partial<Params> = {}): Params {
  return {
    icpId,
    pages: 1,
    perPage: 25,
    startPage: 1,
    ...FILTERS,
    filtersHash: filtersHash(FILTERS),
    restart: false,
    autoContacts: null,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Risposte Apollo fake
// ---------------------------------------------------------------------------

interface SearchOrg {
  name: string;
  domain?: string | null;
  linkedin?: string | null;
}

/** Item di `mixed_companies/search` come nello smoke reale: chiavi sì, settore/parole chiave/dipendenti/sede no. */
function searchItem(o: SearchOrg) {
  return {
    id: `search-${o.domain ?? o.linkedin ?? o.name}`,
    name: o.name,
    website_url: o.domain ? `http://www.${o.domain}` : null,
    linkedin_url: o.linkedin ? `http://www.linkedin.com/company/${o.linkedin}` : null,
    primary_domain: o.domain ?? null,
    founded_year: 2015,
    organization_revenue: 1_000_000,
  };
}

function searchResponse(items: unknown[], page: number, perPage: number) {
  return {
    breadcrumbs: [],
    partial_results_only: false,
    pagination: { page, per_page: perPage, total_entries: 5511, total_pages: 1103 },
    accounts: [],
    organizations: items,
  };
}

/** Dati descrittivi dell'arricchimento: di default quelli di Gamma dell'esempio SPEC (punteggio 0,67). */
type EnrichData = Record<string, unknown> & { linkedin?: string | null };

const GAMMA_LIKE = { industry: 'fintech', keywords: ['hr', 'saas'], estimated_num_employees: 60, city: 'Milan', state: 'Lombardy', country: 'Italy' };

function enrichItem(domain: string, data: EnrichData = {}) {
  const { linkedin, ...rest } = data;
  const slug = domain.split('.')[0];
  return {
    id: `org-${domain}`,
    name: `${slug} S.r.l.`,
    website_url: `http://www.${domain}`,
    primary_domain: domain,
    linkedin_url: linkedin === undefined ? `http://www.linkedin.com/company/${slug}` : linkedin ? `http://www.linkedin.com/company/${linkedin}` : null,
    ...GAMMA_LIKE,
    ...rest,
  };
}

interface FakeOptions {
  /** Organizzazioni per pagina, oppure errore lanciato alla lettura di quella pagina. */
  pages: Record<number, SearchOrg[] | Error | unknown>;
  /** Domini conosciuti dall'arricchimento, con i dati; assenti = non trovati. */
  enrich?: Record<string, EnrichData>;
  /** Errori dell'arricchimento per indice di chiamata (0-based). */
  enrichFailures?: Record<number, Error>;
  /**
   * Passo contatti della pipeline (T9): id Apollo delle persone trovate per dominio (tutte rivelate con
   * URL LinkedIn dal match) o l'errore della ricerca di quel dominio, oppure un errore lanciato da ogni
   * ricerca persone. Assente = nessuna chiamata persone attesa (la fake lancia).
   */
  people?: Record<string, string[] | Error> | Error;
}

/** Persona come la restituisce `mixed_people/api_search` (niente URL LinkedIn). */
function peopleSearchItem(id: string) {
  return { id, first_name: `Nome ${id}`, last_name_obfuscated: 'Ro***i', title: 'CTO', has_email: true, organization: { name: 'Org' } };
}

/** Persona rivelata da `people/bulk_match`, con URL LinkedIn ed email di lavoro. */
function peopleMatchItem(id: string) {
  return {
    id,
    name: `Persona ${id}`,
    first_name: 'Persona',
    last_name: id,
    title: 'CTO',
    city: 'Milano',
    country: 'Italy',
    linkedin_url: `http://www.linkedin.com/in/persona-${id.toLowerCase()}`,
    email: `${id.toLowerCase()}@example.com`,
    email_status: 'verified',
  };
}

function fakeDeps(opts: FakeOptions) {
  const searchCalls: Array<{ page: number; perPage: number; filters: unknown }> = [];
  const enrichCalls: string[][] = [];
  const peopleCalls: Array<Pick<PeopleSearchParams, 'domain' | 'perPage' | 'titles'>> = [];
  const matchCalls: unknown[][] = [];
  const deps = {
    searchOrganizations: async (filters: unknown, page: number, perPage: number) => {
      searchCalls.push({ page, perPage, filters });
      const value = opts.pages[page];
      if (value instanceof Error) throw value;
      if (value === undefined) return searchResponse([], page, perPage);
      if (Array.isArray(value)) return searchResponse((value as SearchOrg[]).map(searchItem), page, perPage);
      return value;
    },
    enrichOrganizations: async (domains: string[]) => {
      const index = enrichCalls.push(domains) - 1;
      const failure = opts.enrichFailures?.[index];
      if (failure) throw failure;
      const known = domains.filter((d) => opts.enrich && d in opts.enrich);
      return {
        status: 'success',
        total_requested_domains: domains.length,
        unique_enriched_records: known.length,
        missing_records: domains.length - known.length,
        organizations: known.map((d) => enrichItem(d, opts.enrich![d])),
      };
    },
    searchPeople: async (request: PeopleSearchParams) => {
      if (opts.people === undefined) throw new Error('searchPeople non atteso');
      peopleCalls.push({ domain: request.domain, perPage: request.perPage, titles: request.titles });
      if (opts.people instanceof Error) throw opts.people;
      const ids = opts.people[request.domain] ?? [];
      if (ids instanceof Error) throw ids;
      return { total_entries: ids.length, people: ids.map(peopleSearchItem) };
    },
    matchPeople: async (details: Array<{ id?: string }>) => {
      if (opts.people === undefined) throw new Error('matchPeople non atteso');
      matchCalls.push(details);
      const matches = details.map((d) => (d.id ? peopleMatchItem(d.id) : null));
      return { status: 'success', credits_consumed: matches.length, matches };
    },
  };
  return { deps, searchCalls, enrichCalls, peopleCalls, matchCalls };
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe('lookalike_companies — handler', () => {
  it('RED: crea 3 candidate `proposta` con score/reasons/score_parts; counts.new_candidates 3 e last_page 1', async () => {
    const { icpId } = scenario();
    const orgs = ['gamma.it', 'delta.it', 'epsilon.it'].map((domain) => ({ name: domain.split('.')[0], domain, linkedin: domain.split('.')[0] }));
    const { deps } = fakeDeps({
      pages: { 1: orgs },
      enrich: {
        'gamma.it': {},
        'delta.it': { city: 'Bergamo' },
        'epsilon.it': { city: null, state: null },
      },
    });

    const result = await handler(params(icpId), deps);

    expect(result.counts.new_candidates).toBe(3);
    expect(result.counts.last_page).toBe(1);
    const rows = listCandidates(icpId);
    // Nome dalla ricerca (l'arricchimento riempie solo i campi vuoti); punteggi dell'esempio SPEC.
    expect(rows.map((r) => [r.name, r.status, r.score])).toEqual([
      ['gamma', 'proposta', 0.67],
      ['epsilon', 'proposta', 0.58],
      ['delta', 'proposta', 0.57],
    ]);
    const gamma = rows.find((r) => r.domain === 'gamma.it')!;
    expect(gamma.reasons).toEqual(['2 parole chiave in comune: hr, saas', 'stessa fascia di dipendenti di Acme (51-100)', 'stessa città di Acme (Milan)']);
    expect(gamma.score_parts).toEqual({ keywords: 0.333, size: 1, location: 1 });
    expect(gamma.scoring_version).toBe('v1');
    expect(rows.find((r) => r.domain === 'epsilon.it')!.score_parts.location).toBeNull();
  });

  it('pagina di 5: referenza completata, unione dall\'arricchimento, senza URL, senza sede, già nota → conteggi, candidate e crediti', async () => {
    const { icpId } = scenario();
    // Referenza solo-dominio: Apollo la restituisce con l'URL → acquisisce la chiave, non diventa candidata (D8).
    const rho = createCompany({ website: 'rho.it', name: 'Rho' });
    setReferenceCompany(icpId, rho.id);
    // Azienda solo-LinkedIn già in anagrafica: la ricerca porta solo il dominio nuovo, l'arricchimento l'URL → unione.
    const bravoLinkedin = createCompany({ linkedin_url: 'https://www.linkedin.com/company/bravo', name: 'Bravo (sourcing)' });
    // Già candidata scartata e già arricchita: "già nota", nessun credito, stato intatto (D7).
    const echo = upsertCompany({ domain: 'echo.it', name: 'Echo', apollo: { orgId: 'org-echo', json: enrichItem('echo.it'), enrichedAt: ENRICHED_AT } }).id!;
    upsertCandidate({ icpId, companyId: echo, score: 0.1, parts: { keywords: 0, size: 0, location: 0 }, reasons: [], jobId: null });
    setCandidateStatus(icpId, [echo], 'scartata');

    const { deps, enrichCalls, searchCalls } = fakeDeps({
      pages: {
        1: [
          { name: 'Rho', domain: 'rho.it', linkedin: 'rho' },
          { name: 'Bravo', domain: 'bravo.it' },
          { name: 'Charlie', domain: 'charlie.it' },
          { name: 'Delta', domain: 'delta.it', linkedin: 'delta' },
          { name: 'Echo', domain: 'echo.it', linkedin: 'echo' },
        ],
      },
      enrich: {
        'bravo.it': { linkedin: 'bravo' },
        'charlie.it': { linkedin: null },
        'delta.it': { city: null, state: null },
      },
    });

    const result = await handler(params(icpId, { pages: 2 }), deps);

    expect(result.counts).toEqual({
      read: 5,
      new_candidates: 3,
      known: 1,
      without_linkedin: 1,
      without_location: 1,
      merged: 1,
      references_completed: 1,
      key_conflicts: 0,
      no_keys: 0,
      enriched: 3,
      pages_read: 1,
      last_page: 1,
      last_page_declared: 5,
      credits_used: 4,
      requests: 2,
    });
    // 5 dichiarate < 25 per pagina: ricerca esaurita, la pagina 2 non si legge.
    expect(searchCalls.map((c) => [c.page, c.perPage])).toEqual([[1, 25]]);
    expect(searchCalls[0]!.filters).toEqual(FILTERS);
    expect(enrichCalls).toEqual([['bravo.it', 'charlie.it', 'delta.it']]);
    expect(result.summary).toBe(
      "Aziende simili per 'CTO startup IT': 5 lette · 3 nuove candidate · 1 già nota (non riproposta) · 1 senza pagina LinkedIn · " +
        '1 unione · 1 referenza completata · 3 aziende arricchite · 1 pagina letta · 4 crediti usati.',
    );
    expect(result.warnings).toEqual([]);

    // Referenza completata con l'URL, mai candidata.
    expect(getCompany(rho.id)!.linkedin_url).toBe('https://www.linkedin.com/company/rho');
    expect(getCandidate(icpId, rho.id)).toBeUndefined();
    // Unione: resta l'azienda con l'URL, con dominio e dati Apollo; la candidata punta al superstite.
    const bravo = getCompany(bravoLinkedin.id)!;
    expect(bravo.domain).toBe('bravo.it');
    expect(bravo.apollo_org_id).toBe('org-bravo.it');
    expect(db.prepare("SELECT COUNT(*) FROM companies WHERE domain = 'bravo.it'").pluck().get()).toBe(1);
    const candidates = listCandidates(icpId);
    expect(candidates.map((c) => c.domain).sort()).toEqual(['bravo.it', 'charlie.it', 'delta.it', 'echo.it']);
    const byDomain = Object.fromEntries(candidates.map((c) => [c.domain, c]));
    expect(byDomain['bravo.it']).toMatchObject({
      company_id: bravoLinkedin.id,
      status: 'proposta',
      score: 0.67,
      linkedin_url: 'https://www.linkedin.com/company/bravo',
    });
    expect(byDomain['charlie.it']).toMatchObject({ status: 'proposta', linkedin_url: null, apollo_city: 'Milan' });
    expect(byDomain['delta.it']!.score_parts).toEqual({ keywords: 0.333, size: 1, location: null });
    expect(byDomain['delta.it']!.reasons).toContain('località non disponibile da Apollo');
    expect(byDomain['echo.it']).toMatchObject({ status: 'scartata', score: 0.1 });
    expect(byDomain['bravo.it']!.job_id).toBeNull();
  });

  it('referenza solo-LinkedIn ritrovata per URL acquisisce il dominio; referenza di un altro ICP → candidata normale', async () => {
    const { icpId } = scenario();
    const sigma = createCompany({ linkedin_url: 'https://www.linkedin.com/company/sigma', name: 'Sigma' });
    setReferenceCompany(icpId, sigma.id);
    const otherIcp = createIcp({ name: 'Altro ICP' }).id;
    const tau = createCompany({ website: 'tau.it', name: 'Tau' });
    setReferenceCompany(otherIcp, tau.id);
    const { deps, enrichCalls } = fakeDeps({
      pages: { 1: [{ name: 'Sigma', domain: 'sigma.it', linkedin: 'sigma' }, { name: 'Tau', domain: 'tau.it', linkedin: 'tau' }] },
      enrich: { 'tau.it': {} },
    });

    const result = await handler(params(icpId), deps);

    expect(result.counts).toMatchObject({ read: 2, references_completed: 1, new_candidates: 1, known: 0, merged: 0, enriched: 1, credits_used: 2 });
    expect(getCompany(sigma.id)!.domain).toBe('sigma.it');
    expect(getCandidate(icpId, sigma.id)).toBeUndefined();
    expect(enrichCalls).toEqual([['tau.it']]);
    expect(getCandidate(icpId, tau.id)).toMatchObject({ status: 'proposta', score: 0.67 });
    expect(db.prepare('SELECT COUNT(*) FROM icp_reference_companies WHERE icp_id = ? AND company_id = ?').pluck().get(otherIcp, tau.id)).toBe(1);
  });

  it('azienda già arricchita (non candidata) → candidata dai dati salvati, senza riarricchirla né crediti', async () => {
    const { icpId } = scenario();
    const omega = upsertCompany({ domain: 'omega.it', name: 'Omega', apollo: { orgId: 'org-omega', json: enrichItem('omega.it'), enrichedAt: ENRICHED_AT } }).id!;
    const { deps, enrichCalls } = fakeDeps({ pages: { 1: [{ name: 'Omega', domain: 'omega.it', linkedin: 'omega' }] } });

    const result = await handler(params(icpId), deps);

    expect(enrichCalls).toEqual([]);
    expect(result.counts).toMatchObject({ new_candidates: 1, enriched: 0, credits_used: 1, requests: 1 });
    expect(getCandidate(icpId, omega)).toMatchObject({ score: 0.67, status: 'proposta' });
  });

  it('secondo giro con startPage 2: nessun doppione, le candidate ritrovate sono già note e non si ripagano', async () => {
    const { icpId } = scenario();
    const page1 = Array.from({ length: 25 }, (_, i) => ({ name: `P1-${i}`, domain: `p1-${i}.it`, linkedin: `p1-${i}` }));
    const enrich = Object.fromEntries([...page1.map((o) => o.domain), 'p2-new.it'].map((d) => [d, {}]));
    const first = fakeDeps({ pages: { 1: page1 }, enrich });
    const r1 = await handler(params(icpId), first.deps);
    expect(r1.counts).toMatchObject({ read: 25, new_candidates: 25, enriched: 25, pages_read: 1, last_page: 1, last_page_declared: 25, credits_used: 26, requests: 4 });
    setCandidateStatus(icpId, [getCandidate(icpId, listCandidates(icpId)[0]!.company_id)!.company_id], 'scartata');

    const second = fakeDeps({
      pages: { 2: [page1[0]!, page1[1]!, { name: 'P2 new', domain: 'p2-new.it', linkedin: 'p2-new' }] },
      enrich,
    });
    const r2 = await handler(params(icpId, { startPage: 2, pages: 2 }), second.deps);

    expect(second.searchCalls.map((c) => c.page)).toEqual([2]);
    expect(second.enrichCalls).toEqual([['p2-new.it']]);
    expect(r2.counts).toMatchObject({ read: 3, known: 2, new_candidates: 1, enriched: 1, pages_read: 1, last_page: 2, last_page_declared: 3, credits_used: 2 });
    expect(listCandidates(icpId)).toHaveLength(26);
    expect(listCandidates(icpId, 'scartata')).toHaveLength(1);
    expect(db.prepare("SELECT COUNT(*) FROM companies WHERE domain LIKE 'p1-%' OR domain LIKE 'p2-%'").pluck().get()).toBe(26);
  });

  it('rate limit alla pagina 2 di 3 → esito parziale riuscito con warning, last_page 1', async () => {
    const { icpId } = scenario();
    const page1 = Array.from({ length: 25 }, (_, i) => ({ name: `R-${i}`, domain: `r-${i}.it`, linkedin: `r-${i}` }));
    const limit = new ApolloRateLimitError('actor:apollo:mixed_companies/search: limite di richieste raggiunto (3 tentativi)', 'mixed_companies/search', 3);
    const { deps, searchCalls } = fakeDeps({ pages: { 1: page1, 2: limit }, enrich: Object.fromEntries(page1.map((o) => [o.domain, {}])) });

    const result = await handler(params(icpId, { pages: 3 }), deps);

    expect(searchCalls.map((c) => c.page)).toEqual([1, 2]);
    expect(result.counts).toMatchObject({ read: 25, new_candidates: 25, pages_read: 1, last_page: 1, last_page_declared: 25, credits_used: 26, requests: 5 });
    expect(result.warnings).toEqual([
      'Limite Apollo raggiunto: letta 1 pagina su 3 (25 aziende). Le candidate della pagina 1 sono salvate; rilancia più tardi: continuo dalla pagina 2.',
    ]);
    expect(result.summary).toMatch(/^Aziende simili per 'CTO startup IT' \(esito parziale\): 25 lette · 25 nuove candidate · /);
    expect(listCandidates(icpId)).toHaveLength(25);
  });

  it('errore del provider alla pagina 3 dopo 2 pagine salvate → parziale con messaggio attribuito', async () => {
    const { icpId } = scenario();
    const page = (p: number) => Array.from({ length: 25 }, (_, i) => ({ name: `E${p}-${i}`, domain: `e${p}-${i}.it`, linkedin: `e${p}-${i}` }));
    const { deps } = fakeDeps({ pages: { 1: page(1), 2: page(2), 3: new ApolloProviderError('actor:apollo:mixed_companies/search: HTTP 502', 'mixed_companies/search', 502) } });

    const result = await handler(params(icpId, { pages: 3 }), deps);

    expect(result.counts).toMatchObject({ read: 50, new_candidates: 50, pages_read: 2, last_page: 2, credits_used: 2, enriched: 0 });
    expect(result.warnings?.[0]).toBe(
      'actor:apollo:mixed_companies/search: HTTP 502 · lette 2 pagine su 3 (50 aziende). Le candidate delle pagine 1–2 sono salvate e restano valide; rilancia per continuare dalla pagina 3.',
    );
  });

  it('403 alla pagina 1 → lancia `config:` senza scrivere nulla; errore generico → `actor:apollo:`', async () => {
    const { icpId } = scenario();
    const before = db.prepare('SELECT COUNT(*) FROM companies').pluck().get();
    const forbidden = new ApolloConfigError(
      'config: la chiave Apollo non ha i permessi per mixed_companies/search: usa una master key.',
      'mixed_companies/search',
      403,
    );
    const { deps, enrichCalls } = fakeDeps({ pages: { 1: forbidden } });

    await expect(handler(params(icpId), deps)).rejects.toThrow(
      'config: la chiave Apollo non ha i permessi per mixed_companies/search: usa una master key. Nessun dato modificato.',
    );
    expect(enrichCalls).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) FROM companies').pluck().get()).toBe(before);

    const boom = fakeDeps({ pages: { 1: new Error('socket hang up') } });
    await expect(handler(params(icpId), boom.deps)).rejects.toThrow('actor:apollo:mixed_companies/search: socket hang up. Nessun dato modificato.');
  });

  it('configurazione: chiave mancante o ICP inesistente → `config:` senza chiamate', async () => {
    const { icpId } = scenario();
    const { deps, searchCalls } = fakeDeps({ pages: {} });
    config.apolloApiKey = '';
    await expect(handler(params(icpId), deps)).rejects.toThrow(/^config: APOLLO_API_KEY mancante nel \.env/);
    config.apolloApiKey = 'test-apollo-key';
    await expect(handler(params(icpId + 999), deps)).rejects.toThrow(/^config: ICP non trovato/);
    await expect(handler(params(icpId, { keywords: [], ranges: [], locations: [] }), deps)).rejects.toThrow(/^config: Tutti i filtri sono vuoti/);
    expect(searchCalls).toEqual([]);
  });

  it('arricchimento fermato dal limite orario → candidate della pagina salvate con punteggio parziale, warning, stop', async () => {
    const { icpId } = scenario();
    const page1 = Array.from({ length: 25 }, (_, i) => ({ name: `H-${String(i).padStart(2, '0')}`, domain: `h-${i}.it`, linkedin: `h-${i}` }));
    const hourly = new ApolloRateLimitError(
      'actor:apollo:organizations/bulk_enrich: limite orario di Apollo esaurito (100 richieste/ora): riprova più tardi',
      'organizations/bulk_enrich',
      0,
      'hourly',
    );
    const { deps, searchCalls, enrichCalls } = fakeDeps({
      pages: { 1: page1, 2: page1 },
      enrich: Object.fromEntries(page1.map((o) => [o.domain, {}])),
      enrichFailures: { 1: hourly },
    });

    const result = await handler(params(icpId, { pages: 2 }), deps);

    expect(searchCalls.map((c) => c.page)).toEqual([1]);
    expect(enrichCalls).toHaveLength(2);
    expect(result.counts).toMatchObject({ read: 25, new_candidates: 25, enriched: 10, pages_read: 1, last_page: 1, credits_used: 11, requests: 3 });
    expect(result.warnings?.[0]).toBe(
      "Limite Apollo raggiunto durante l'arricchimento: 15 aziende nuove della pagina 1 senza dati Apollo (punteggio parziale). " +
        'Letta 1 pagina su 2 (25 aziende); le candidate della pagina 1 sono salvate; rilancia più tardi: continuo dalla pagina 2.',
    );
    expect(result.summary).toContain('(esito parziale)');
    const rows = listCandidates(icpId);
    expect(rows).toHaveLength(25);
    expect(rows.filter((r) => r.score === 0.67)).toHaveLength(10);
    const partial = rows.filter((r) => r.score === 0);
    expect(partial).toHaveLength(15);
    expect(partial[0]!.score_parts).toEqual({ keywords: 0, size: 0, location: null });
  });

  it('arricchimento rifiutato (403) dopo la ricerca → riuscito con warning `config:` e candidate salvate', async () => {
    const { icpId } = scenario();
    const forbidden = new ApolloConfigError('config: chiave Apollo rifiutata (401). Verifica APOLLO_API_KEY nel .env.', 'organizations/bulk_enrich', 401);
    const { deps } = fakeDeps({ pages: { 1: [{ name: 'Zeta', domain: 'zeta.it', linkedin: 'zeta' }] }, enrichFailures: { 0: forbidden } });

    const result = await handler(params(icpId), deps);

    expect(result.counts).toMatchObject({ new_candidates: 1, enriched: 0, pages_read: 1, credits_used: 1 });
    expect(result.warnings?.[0]).toMatch(/^config: chiave Apollo rifiutata \(401\)\. Verifica APOLLO_API_KEY nel \.env\. · 1 azienda nuova della pagina 1 senza dati Apollo/);
  });

  it('arricchimento: errore del provider su un lotto non ferma la ricerca; limite al minuto oltre i tentativi sì', async () => {
    const { icpId } = scenario();
    const page = (p: number) => Array.from({ length: 25 }, (_, i) => ({ name: `M${p}-${i}`, domain: `m${p}-${i}.it`, linkedin: `m${p}-${i}` }));
    const enrich = Object.fromEntries([...page(1), ...page(2)].map((o) => [o.domain, {}]));
    const bad = new ApolloProviderError('actor:apollo:organizations/bulk_enrich: HTTP 502', 'organizations/bulk_enrich', 502);
    const minute = new ApolloRateLimitError('actor:apollo:organizations/bulk_enrich: limite di richieste raggiunto (3 tentativi)', 'organizations/bulk_enrich', 3);

    // 502 sul primo lotto: si prosegue con la pagina 2, warning sulle aziende senza dati.
    const provider = fakeDeps({ pages: { 1: page(1), 2: page(2) }, enrich, enrichFailures: { 0: bad } });
    const r1 = await handler(params(icpId, { pages: 2 }), provider.deps);
    expect(provider.searchCalls.map((c) => c.page)).toEqual([1, 2]);
    expect(r1.counts).toMatchObject({ pages_read: 2, new_candidates: 50, enriched: 40 });
    expect(r1.warnings).toEqual([
      "Errore Apollo durante l'arricchimento (actor:apollo:organizations/bulk_enrich: HTTP 502): 10 aziende nuove senza dati Apollo, punteggio parziale.",
    ]);
    expect(r1.summary).not.toContain('esito parziale');

    // 429 al minuto oltre i tentativi (senza finestra oraria): i lotti successivi girano, poi la ricerca si ferma.
    reset();
    const { icpId: icp2 } = scenario();
    const limited = fakeDeps({ pages: { 1: page(1), 2: page(2) }, enrich, enrichFailures: { 0: minute } });
    const r2 = await handler(params(icp2, { pages: 2 }), limited.deps);
    expect(limited.searchCalls.map((c) => c.page)).toEqual([1]);
    expect(r2.counts).toMatchObject({ pages_read: 1, new_candidates: 25, enriched: 15, last_page: 1 });
    expect(r2.warnings?.[0]).toMatch(/^Limite Apollo raggiunto durante l'arricchimento: 10 aziende nuove della pagina 1 senza dati Apollo/);
  });

  it('5 dichiarate e 0 riconosciute → warning, nessuna candidata, pagina non salvata', async () => {
    const { icpId } = scenario();
    const broken = searchResponse(Array.from({ length: 5 }, (_, i) => ({ nome: `Azienda ${i}` })), 1, 25);
    const { deps, enrichCalls } = fakeDeps({ pages: { 1: broken } });

    const result = await handler(params(icpId, { pages: 3 }), deps);

    expect(result.counts).toMatchObject({ read: 0, new_candidates: 0, pages_read: 0, last_page: 0, last_page_declared: 0, credits_used: 1, requests: 1 });
    expect(result.warnings?.[0]).toMatch(/^Apollo ha risposto ma nessuna azienda è stata riconosciuta \(5 dichiarate\): verifica il provider\./);
    expect(enrichCalls).toEqual([]);
    expect(listCandidates(icpId)).toHaveLength(0);
  });

  it('0 risultati → esito neutro con i filtri usati; continuazione vuota → ricerca esaurita', async () => {
    const { icpId } = scenario();
    const { deps } = fakeDeps({ pages: { 1: [] } });
    const result = await handler(params(icpId, { pages: 2 }), deps);
    expect(result.summary).toBe(
      'Nessuna azienda trovata con: hr, human resources, payroll, saas, software, hr tech · 1–10, 11–20, 21–50, 51–100, 101–200 dipendenti · ' +
        'Italy, Milano. Allarga le fasce o togli la località.',
    );
    expect(result.counts).toMatchObject({ read: 0, pages_read: 1, last_page: 1, last_page_declared: 0, credits_used: 1 });
    expect(result.warnings).toEqual([]);

    const later = await handler(params(icpId, { startPage: 4 }), fakeDeps({ pages: { 4: [] } }).deps);
    expect(later.summary).toMatch(/^Nessun'altra azienda trovata dalla pagina 4 con: .*La ricerca è esaurita/);
  });

  it('chiavi in conflitto e aziende senza chiavi saltate e contate; più della metà senza LinkedIn → warning', async () => {
    const { icpId } = scenario();
    createCompany({ linkedin_url: 'https://www.linkedin.com/company/kappa', website: 'kappa-old.it', name: 'Kappa Old' });
    const { deps, enrichCalls } = fakeDeps({
      pages: {
        1: [
          { name: 'Kappa', domain: 'kappa.it', linkedin: 'kappa' },
          { name: 'Senza chiavi' },
          { name: 'Lambda', domain: 'lambda.it' },
          { name: 'Mu', domain: 'mu.it' },
        ],
      },
      enrich: { 'lambda.it': { linkedin: null }, 'mu.it': { linkedin: null } },
    });

    const result = await handler(params(icpId), deps);

    expect(enrichCalls).toEqual([['lambda.it', 'mu.it']]);
    expect(result.counts).toMatchObject({ read: 4, key_conflicts: 1, no_keys: 1, new_candidates: 2, without_linkedin: 2 });
    expect(result.summary).toContain('1 con chiavi in conflitto (saltata) · 1 senza sito né pagina LinkedIn (saltata) · 2 senza pagina LinkedIn');
    expect(result.warnings).toEqual([
      "Chiavi in conflitto con l'anagrafica, azienda saltata: Kappa Old: Apollo indica dominio kappa.it, in anagrafica kappa-old.it. " +
        "Correggi l'URL LinkedIn o il sito in Anagrafica (o unisci le aziende).",
      "Più della metà delle aziende lette è senza pagina LinkedIn (3 su 4): per estrarne le persone con Apify serve prima l'URL (Anagrafica → URL LinkedIn).",
    ]);
    expect(db.prepare("SELECT COUNT(*) FROM companies WHERE domain = 'kappa.it'").pluck().get()).toBe(0);
  });

  it('job_id della candidata dall\'env JOB_ID del processo figlio', async () => {
    const { icpId } = scenario();
    const job = insertJob('lookalike_companies', params(icpId));
    process.env.JOB_ID = String(job.id);
    const { deps } = fakeDeps({ pages: { 1: [{ name: 'Iota', domain: 'iota.it', linkedin: 'iota' }] }, enrich: { 'iota.it': {} } });

    await handler(params(icpId), deps);

    const company = db.prepare("SELECT id FROM companies WHERE domain = 'iota.it'").pluck().get() as number;
    expect(getCandidate(icpId, company)!.job_id).toBe(job.id);
  });
});

// ---------------------------------------------------------------------------
// Pipeline `autoContacts` (T9, SPEC H1–H4, FLOW E, S-6)
// ---------------------------------------------------------------------------

describe('lookalike_companies — pipeline autoContacts', () => {
  const ORGS = ['gamma.it', 'delta.it', 'epsilon.it'].map((domain) => ({ name: domain.split('.')[0]!, domain, linkedin: domain.split('.')[0]! }));
  const ENRICH = { 'gamma.it': {}, 'delta.it': { city: 'Bergamo' }, 'epsilon.it': { city: null, state: null } };

  function pipelineScenario() {
    const s = scenario();
    const list = createList({ icpId: s.icpId, name: 'Lista CTO' })!;
    const autoContacts = { listId: list.id, roles: ['CTO'], seniorities: [], locations: [], perCompany: 10 };
    return { ...s, list, autoContacts };
  }

  it('RED: 403 nella ricerca persone → job `succeeded` con le 3 candidate e un warning che inizia per `config:`', async () => {
    const { icpId, autoContacts } = pipelineScenario();
    const forbidden = new ApolloConfigError(
      'config: la chiave Apollo non ha i permessi per mixed_people/api_search: usa una master key o una chiave con il permesso di ricerca persone (Apollo → Settings → API keys).',
      'mixed_people/api_search',
      403,
    );
    const { deps, peopleCalls, matchCalls } = fakeDeps({ pages: { 1: ORGS }, enrich: ENRICH, people: forbidden });
    const job = insertJob('lookalike_companies', params(icpId, { autoContacts }));
    process.env.JOB_ID = String(job.id);

    const done = await runJob(job.id, { resolveDeps: () => deps });

    expect(done.state).toBe('succeeded');
    const rows = listCandidates(icpId);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === 'proposta' && r.job_id === job.id)).toBe(true);
    expect(peopleCalls).toHaveLength(1);
    expect(matchCalls).toEqual([]);
    const warnings = done.result!.warnings ?? [];
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^config: la chiave Apollo non ha i permessi per mixed_people\/api_search: /);
    expect(warnings[0]).toContain("Le candidate sono salvate: usa 'Trova contatti' dopo aver sistemato la chiave.");
    expect(warnings[0]).not.toContain('Nessun dato modificato');
    // AL-TD-5: conteggi parziali del passo fallito (la ricerca col 403 è una richiesta fatta, 0 crediti).
    expect(done.result!.counts).toMatchObject({ new_candidates: 3, contacts_companies: 3, contacts_added: 0, contacts_credits_used: 0, contacts_requests: 1 });
    expect(done.result!.summary.split('\n')).toEqual([
      expect.stringMatching(/^Aziende simili per 'CTO startup IT': 3 lette · 3 nuove candidate · /),
      "Contatti Apollo: passo interrotto da un errore, vedi l'avviso.",
    ]);
  });

  it('ricerca + contatti: candidate `proposta`, persone in lista, `contacts_*` nei conteggi, esito su due righe', async () => {
    const { icpId, list, autoContacts } = pipelineScenario();
    const { deps, peopleCalls, matchCalls } = fakeDeps({
      pages: { 1: ORGS },
      enrich: ENRICH,
      people: { 'gamma.it': ['G1', 'G2'], 'delta.it': ['D1'], 'epsilon.it': [] },
    });

    const result = await handler(params(icpId, { autoContacts }), deps);

    // H2: la pipeline non decide al posto dell'utente.
    expect(listCandidates(icpId).map((r) => [r.domain, r.status])).toEqual([
      ['gamma.it', 'proposta'],
      ['epsilon.it', 'proposta'],
      ['delta.it', 'proposta'],
    ]);
    // Una ricerca per candidata (punteggio più alto prima) con le opzioni della pipeline; match solo per chi c'è.
    expect(peopleCalls).toEqual([
      { domain: 'gamma.it', perPage: 10, titles: ['CTO'] },
      { domain: 'epsilon.it', perPage: 10, titles: ['CTO'] },
      { domain: 'delta.it', perPage: 10, titles: ['CTO'] },
    ]);
    expect(matchCalls).toHaveLength(2);
    const members = db.prepare('SELECT p.linkedin_url FROM list_members m JOIN prospects p ON p.id = m.prospect_id WHERE m.list_id = ? ORDER BY 1').pluck().all(list.id);
    expect(members).toEqual(['https://www.linkedin.com/in/persona-d1', 'https://www.linkedin.com/in/persona-g1', 'https://www.linkedin.com/in/persona-g2']);

    expect(result.counts).toEqual({
      read: 3,
      new_candidates: 3,
      known: 0,
      without_linkedin: 0,
      without_location: 1,
      merged: 0,
      references_completed: 0,
      key_conflicts: 0,
      no_keys: 0,
      enriched: 3,
      pages_read: 1,
      last_page: 1,
      last_page_declared: 3,
      credits_used: 4,
      requests: 2,
      contacts_people_read: 3,
      contacts_people_matched: 3,
      contacts_companies_done: 3,
      contacts_companies: 3,
      contacts_without_domain: 0,
      contacts_added: 3,
      contacts_prospects_new: 3,
      contacts_prospects_seen: 0,
      contacts_already_in_list: 0,
      contacts_skipped_no_url: 0,
      contacts_apollo_id_taken: 0,
      contacts_with_email: 3,
      contacts_credits_used: 3,
      contacts_requests: 5,
    });
    expect(result.warnings).toEqual([]);
    expect(result.summary).toBe(
      "Aziende simili per 'CTO startup IT': 3 lette · 3 nuove candidate · 3 aziende arricchite · 1 pagina letta · 4 crediti usati.\n" +
        "Contatti Apollo: 3 persone lette in 3 aziende · 3 aggiunte a 'Lista CTO' (3 nuove, 0 già in archivio) · 3 con email · 3 crediti usati.",
    );
  });

  it('solo le candidate create dal job: le già note non si cercano; nessuna nuova → passo saltato con riga dedicata', async () => {
    const { icpId, autoContacts } = pipelineScenario();
    const known = upsertCompany({ domain: 'gamma.it', name: 'gamma', apollo: { orgId: 'org-gamma', json: enrichItem('gamma.it'), enrichedAt: ENRICHED_AT } }).id!;
    upsertCandidate({ icpId, companyId: known, score: 0.5, parts: { keywords: 0, size: 1, location: 1 }, reasons: [], jobId: null });

    const mixed = fakeDeps({ pages: { 1: ORGS }, enrich: ENRICH, people: {} });
    const r1 = await handler(params(icpId, { autoContacts }), mixed.deps);
    expect(r1.counts).toMatchObject({ known: 1, new_candidates: 2, contacts_companies: 2 });
    expect(mixed.peopleCalls.map((c) => c.domain)).toEqual(['epsilon.it', 'delta.it']);
    expect(r1.summary.split('\n')[1]).toBe(
      "Contatti Apollo: nessuna persona trovata in 2 aziende con ruoli CTO. Amplia i ruoli.",
    );

    const again = fakeDeps({ pages: { 1: ORGS }, enrich: ENRICH, people: {} });
    const r2 = await handler(params(icpId, { autoContacts }), again.deps);
    expect(again.peopleCalls).toEqual([]);
    expect(r2.counts).toMatchObject({ read: 3, known: 3, new_candidates: 0, contacts_companies: 0, contacts_requests: 0 });
    expect(r2.summary.split('\n')).toEqual([
      expect.stringMatching(/^Aziende simili per 'CTO startup IT': 3 lette · 0 nuove candidate · /),
      'Contatti Apollo: nessuna nuova candidata in cui cercare, nessuna richiesta fatta.',
    ]);
  });

  it('ricerca con 0 aziende → nessuna chiamata persone ed esito neutro di A su una riga', async () => {
    const { icpId, autoContacts } = pipelineScenario();
    const { deps, peopleCalls, matchCalls } = fakeDeps({ pages: { 1: [] }, people: {} });

    const result = await handler(params(icpId, { autoContacts }), deps);

    expect(peopleCalls).toEqual([]);
    expect(matchCalls).toEqual([]);
    expect(result.summary).toMatch(/^Nessuna azienda trovata con: /);
    expect(result.summary).not.toContain('\n');
    expect(result.warnings).toEqual([]);
    expect(result.counts).toMatchObject({ read: 0, contacts_added: 0, contacts_credits_used: 0, contacts_requests: 0 });
  });

  it('passo contatti: errore del provider → warning attribuito con rimedio; limite alla 2ª azienda → parziale di C', async () => {
    const { icpId, autoContacts } = pipelineScenario();
    const bad = new ApolloProviderError('actor:apollo:mixed_people/api_search: HTTP 502', 'mixed_people/api_search', 502);
    const provider = fakeDeps({ pages: { 1: ORGS }, enrich: ENRICH, people: bad });
    const r1 = await handler(params(icpId, { autoContacts }), provider.deps);
    expect(r1.counts.new_candidates).toBe(3);
    expect(r1.warnings).toEqual([
      "actor:apollo:mixed_people/api_search: HTTP 502 · Contatti non trovati. Le candidate sono salvate: rilancia 'Trova contatti' sulle candidate più tardi.",
    ]);

    reset();
    const second = pipelineScenario();
    const limit = new ApolloRateLimitError('actor:apollo:mixed_people/api_search: limite di richieste raggiunto (3 tentativi)', 'mixed_people/api_search', 3);
    const limited = fakeDeps({ pages: { 1: ORGS }, enrich: ENRICH, people: { 'gamma.it': ['G1'], 'epsilon.it': limit } });
    const r2 = await handler(params(second.icpId, { autoContacts: second.autoContacts }), limited.deps);
    expect(r2.counts).toMatchObject({ new_candidates: 3, contacts_companies_done: 1, contacts_added: 1, contacts_credits_used: 1 });
    expect(r2.warnings).toEqual([
      "Limite Apollo raggiunto: completata 1 azienda su 3 · 1 aggiunta a 'Lista CTO'. Rilancia sulle stesse aziende: chi è già in lista non si duplica.",
    ]);
    expect(r2.summary.split('\n')[1]).toMatch(/^Contatti Apollo \(esito parziale\): 1 persona letta in 1 azienda su 3 · /);
  });

  it('AL-TD-5: lotto di match pagato e poi errore sulla stessa azienda → `contacts_*` parziali e crediti usati nel warning', async () => {
    const { icpId, list, autoContacts } = pipelineScenario();
    const ids = Array.from({ length: 12 }, (_, i) => `G${i + 1}`);
    const { deps, matchCalls } = fakeDeps({ pages: { 1: ORGS }, enrich: ENRICH, people: { 'gamma.it': ids } });
    const match = deps.matchPeople;
    // 1º lotto di Gamma (la candidata col punteggio più alto): 2 persone rivelate e pagate; il 2º lotto va in errore.
    deps.matchPeople = async (details) => {
      if (matchCalls.length === 1) {
        matchCalls.push(details);
        throw new ApolloProviderError('actor:apollo:people/bulk_match: HTTP 500', 'people/bulk_match', 500);
      }
      const raw = await match(details);
      return { ...raw, credits_consumed: 2, matches: raw.matches.map((m, i) => (i < 2 ? m : null)) };
    };

    const result = await handler(params(icpId, { autoContacts: { ...autoContacts, perCompany: 12 } }), deps);

    expect(matchCalls.map((batch) => batch.length)).toEqual([10, 2]);
    expect(result.counts).toMatchObject({
      new_candidates: 3,
      credits_used: 4,
      contacts_companies_done: 0,
      contacts_people_read: 12,
      contacts_people_matched: 2,
      contacts_added: 2,
      contacts_credits_used: 2,
      contacts_requests: 3,
    });
    expect(result.warnings).toEqual([
      "actor:apollo:people/bulk_match: HTTP 500 · 2 crediti usati · 2 persone aggiunte alla lista prima dell'errore. " +
        "Le candidate sono salvate: rilancia 'Trova contatti' sulle candidate più tardi.",
    ]);
    expect(result.summary.split('\n')[1]).toBe("Contatti Apollo: passo interrotto da un errore, vedi l'avviso.");
    expect(db.prepare('SELECT COUNT(*) FROM list_members WHERE list_id = ?').pluck().get(list.id)).toBe(2);
  });

  it('lista archiviata: `configBlockers` (registry di "Riprova") la segnala e il job si ferma `config:` prima di ogni chiamata', async () => {
    const { icpId, list, autoContacts } = pipelineScenario();
    const p = params(icpId, { autoContacts });
    expect(CONFIG_BLOCKERS.lookalike_companies(p)).toEqual([]);

    updateList(list.id, { archived: true });
    const archived = "La lista 'Lista CTO' è archiviata: riattivala per aggiungere persone.";
    // Nessun'altra lista attiva per l'ICP: anche il motivo della pipeline (SPEC H4).
    expect(CONFIG_BLOCKERS.lookalike_companies(p)).toEqual(['Crea una lista per questo ICP per usare questa opzione.', archived]);
    createList({ icpId, name: 'Altra lista' });
    expect(CONFIG_BLOCKERS.lookalike_companies(p)).toEqual([archived]);
    // Senza pipeline la lista non conta.
    expect(CONFIG_BLOCKERS.lookalike_companies({ ...p, autoContacts: null })).toEqual([]);

    const { deps, searchCalls } = fakeDeps({ pages: { 1: ORGS }, enrich: ENRICH, people: {} });
    await expect(handler(p, deps)).rejects.toThrow(`config: ${archived}`);
    expect(searchCalls).toEqual([]);
  });
});
