import { describe, expect, it, vi } from 'vitest';

// Smoke reale Apollo (apollo-lookalike T0): qui lo script gira SOLO con `fetch`, `env`, `log` e
// `writeFile` iniettati. Nessuna chiamata di rete, nessuna scrittura in tests/fixtures/apollo/.
// Import statici sicuri: né lo script né `src/apollo/{client,requests}.ts` leggono la config.
const { main, anonymize, SMOKE_OPS, EXPECTED_CREDITS } = await import('../scripts/apollo-smoke.js');
const { buildApolloUrl } = await import('../src/apollo/client.js');
const { enrichOrganizationsRequest, matchPeopleRequest, searchOrganizationsRequest, searchPeopleRequest } = await import(
  '../src/apollo/requests.js'
);

const KEY = 'chiave-finta-smoke-123';
const DOMAIN = 'acme-fittizia.it';
const PROFILE = 'https://www.linkedin.com/in/persona-fittizia';
const FIXTURES_DIR = '/cartella-finta/apollo';

const ARGS = ['--domain', DOMAIN, '--linkedin', PROFILE];

type FetchInit = { method?: string; headers?: Record<string, string>; body?: string };

/** Risposte finte per endpoint (forme documentate), con dati personali da anonimizzare. */
function fakeBody(url: string): unknown {
  if (url.includes('/organizations/bulk_enrich')) {
    return {
      status: 'success',
      organizations: [
        { id: 'org-1', name: 'Acme Fittizia', primary_domain: DOMAIN, keywords: ['meccanica', 'automazione'], country: 'Italy' },
      ],
    };
  }
  if (url.endsWith('/mixed_companies/search')) {
    return {
      accounts: [],
      organizations: [
        { id: 'org-2', name: 'Beta Fittizia', primary_domain: 'beta-fittizia.it', linkedin_url: 'http://www.linkedin.com/company/beta' },
        {
          id: 'org-3',
          name: 'Gamma Fittizia',
          primary_domain: 'gamma-fittizia.it',
          linkedin_url: null,
          industry: 'machinery',
          keywords: ['meccanica'],
          estimated_num_employees: 40,
          city: 'Brescia',
          state: 'Lombardy',
          country: 'Italy',
        },
      ],
      pagination: { page: 1, per_page: 5, total_entries: 2, total_pages: 1 },
    };
  }
  if (url.endsWith('/mixed_people/api_search')) {
    return {
      total_entries: 1,
      people: [{ id: 'persona-apollo-1', first_name: 'Mario', last_name_obfuscated: 'Ro***i', title: 'CTO', has_email: true, organization: { name: 'Acme Fittizia' } }],
    };
  }
  return {
    status: 'success',
    credits_consumed: 1,
    matches: [
      {
        id: 'persona-apollo-1',
        name: 'Mario Rossi',
        email: 'mario.rossi@azienda-vera.it',
        linkedin_url: 'https://www.linkedin.com/in/mario-rossi-vero',
        organization: { name: 'Acme Fittizia', primary_domain: DOMAIN, linkedin_url: 'https://www.linkedin.com/company/acme-fittizia' },
      },
      null,
    ],
  };
}

function makeDeps(opts: { env?: Record<string, string | undefined>; status?: (url: string) => number } = {}) {
  const lines: string[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input);
    const status = opts.status?.(url) ?? 200;
    const body = status >= 400 ? { error: `errore finto per ${KEY}` } : fakeBody(url);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', 'x-rate-limit-minute': '200', 'x-minute-usage': '4' },
    });
  });
  const writeFile = vi.fn(async (_filePath: string, _content: string) => {});
  const deps = {
    fetch: fetch as unknown as typeof globalThis.fetch,
    env: opts.env ?? { APOLLO_API_KEY: KEY },
    log: (line: string) => lines.push(line),
    writeFile,
    fixturesDir: FIXTURES_DIR,
  };
  return { deps, lines, fetch, writeFile, output: () => lines.join('\n') };
}

function callInit(fetch: ReturnType<typeof makeDeps>['fetch'], index: number): FetchInit {
  return fetch.mock.calls[index]![1] as FetchInit;
}

describe('apollo-smoke senza --yes', () => {
  it('stampa il costo atteso ed esce con codice 2 senza invocare fetch', async () => {
    const t = makeDeps();
    const code = await main(ARGS, t.deps);
    expect(code).toBe(2);
    expect(t.fetch).not.toHaveBeenCalled();
    expect(t.writeFile).not.toHaveBeenCalled();
    expect(EXPECTED_CREDITS).toBe(4);
    expect(t.output()).toMatch(/≈ 4 crediti/);
    expect(t.output()).toContain('fino a 2 match');
    for (const op of SMOKE_OPS) expect(t.output()).toContain(op.path);
    expect(t.output()).toContain('--yes');
    expect(t.output()).toContain(`copia anonimizzata in ${FIXTURES_DIR}/smoke`);
    expect(t.output()).not.toContain(KEY);
  });

  it('senza argomenti né chiave esce comunque con codice 2 e nessuna chiamata', async () => {
    const t = makeDeps({ env: {} });
    const code = await main([], t.deps);
    expect(code).toBe(2);
    expect(t.fetch).not.toHaveBeenCalled();
    expect(t.output()).toMatch(/≈ 4 crediti/);
    expect(t.output()).toContain('APOLLO_API_KEY');
  });
});

describe('apollo-smoke: configurazione mancante con --yes', () => {
  it('senza APOLLO_API_KEY esce con codice non zero e non chiama fetch', async () => {
    for (const env of [{}, { APOLLO_API_KEY: '' }, { APOLLO_API_KEY: '   ' }]) {
      const t = makeDeps({ env });
      const code = await main([...ARGS, '--yes'], t.deps);
      expect(code).not.toBe(0);
      expect(t.fetch).not.toHaveBeenCalled();
      expect(t.output()).toContain('APOLLO_API_KEY mancante');
    }
  });

  it('senza --domain o --linkedin (o con valori non validi) esce con codice non zero e non chiama fetch', async () => {
    const cases = [
      ['--linkedin', PROFILE, '--yes'],
      ['--domain', DOMAIN, '--yes'],
      ['--domain', 'non un dominio', '--linkedin', PROFILE, '--yes'],
      ['--domain', DOMAIN, '--linkedin', 'https://www.linkedin.com/company/acme', '--yes'],
      [...ARGS, '--yes', '--sconosciuta'],
    ];
    for (const argv of cases) {
      const t = makeDeps();
      const code = await main(argv, t.deps);
      expect(code, argv.join(' ')).not.toBe(0);
      expect(t.fetch).not.toHaveBeenCalled();
    }
  });
});

describe('apollo-smoke con --yes (fetch finto)', () => {
  it('le 4 richieste sono quelle dei builder di produzione (requests.ts + buildApolloUrl)', async () => {
    const t = makeDeps();
    const code = await main([...ARGS, '--yes'], t.deps);
    expect(code).toBe(0);
    const expected = [
      enrichOrganizationsRequest([DOMAIN]),
      searchOrganizationsRequest({ keywords: ['meccanica', 'automazione'], ranges: [], locations: ['Italy'] }, 1, 5),
      searchPeopleRequest({ domain: DOMAIN, perPage: 5 }),
      matchPeopleRequest([{ id: 'persona-apollo-1' }, { linkedin_url: PROFILE }]),
    ];
    expect(t.fetch.mock.calls.map((c) => String(c[0]))).toEqual(expected.map(buildApolloUrl));
    for (let i = 0; i < 4; i++) {
      const init = callInit(t.fetch, i);
      expect(init.method).toBe('POST');
      expect(init.headers?.['x-api-key']).toBe(KEY);
      expect(init.headers?.['Content-Type']).toBe('application/json');
      expect(init.body === undefined ? undefined : JSON.parse(init.body)).toEqual(expected[i]!.body);
    }
  });

  it('bulk_enrich: domini come query domains[] e nessun body', async () => {
    const t = makeDeps();
    await main([...ARGS, '--yes'], t.deps);
    expect(String(t.fetch.mock.calls[0]![0])).toBe(`https://api.apollo.io/api/v1/organizations/bulk_enrich?domains[]=${DOMAIN}`);
    expect(callInit(t.fetch, 0).body).toBeUndefined();
  });

  it('bulk_match: id della prima persona trovata + URL LinkedIn, mai email personali né telefoni', async () => {
    const t = makeDeps();
    await main([...ARGS, '--yes'], t.deps);
    expect(String(t.fetch.mock.calls[3]![0])).toBe('https://api.apollo.io/api/v1/people/bulk_match');
    expect(JSON.parse(callInit(t.fetch, 3).body!)).toEqual({
      details: [{ id: 'persona-apollo-1' }, { linkedin_url: PROFILE }],
      reveal_personal_emails: false,
      reveal_phone_number: false,
    });
  });

  it('stampa status, header di rate limit e copertura dei campi, mai la chiave né valori testuali', async () => {
    const t = makeDeps();
    await main([...ARGS, '--yes'], t.deps);
    const out = t.output();
    expect(out).toContain('HTTP 200');
    expect(out).toContain('x-rate-limit-minute=200');
    expect(out).toContain('x-minute-usage=4');
    expect(out).toContain('organizations[1]');
    // Ricerca aziende: copertura per campo, anche su accounts[].
    expect(out).toContain('industry: presente in 1/2 aziende');
    expect(out).toContain('keywords: presente in 1/2 aziende');
    expect(out).toContain('estimated_num_employees: presente in 1/2 aziende');
    expect(out).toContain('primary_domain: presente in 2/2 aziende');
    expect(out).toContain('linkedin_url: presente in 1/2 aziende');
    expect(out).toMatch(/accounts\[\]: nessuna azienda/);
    // Ricerca persone.
    expect(out).toContain('linkedin_url: presente in 0/1 persone');
    expect(out).toContain('last_name_obfuscated: presente in 1/1 persone');
    expect(out).toContain('organization.primary_domain: presente in 0/1 persone');
    // Bulk match: per dettaglio, e crediti dichiarati.
    expect(out).toMatch(/match 1 \(per id\): linkedin_url presente, email presente/);
    expect(out).toMatch(/match 2 \(per linkedin_url\): nessun risultato/);
    expect(out).toContain('credits_consumed=1');
    expect(out).not.toContain(KEY);
    for (const text of ['Mario', 'Rossi', 'mario.rossi@azienda-vera.it', 'mario-rossi-vero', 'Beta Fittizia', 'Brescia']) {
      expect(out).not.toContain(text);
    }
  });

  it('salva raw in raw/ e copia anonimizzata in smoke/, mai sui percorsi delle fixture docs', async () => {
    const t = makeDeps();
    await main([...ARGS, '--yes'], t.deps);
    const written = new Map(t.writeFile.mock.calls.map(([p, c]) => [p, c]));
    expect(SMOKE_OPS.map((op) => op.file)).toEqual([
      'organizations-bulk-enrich.json',
      'mixed-companies-search.json',
      'mixed-people-api-search.json',
      'people-bulk-match.json',
    ]);
    for (const op of SMOKE_OPS) {
      expect(written.has(`${FIXTURES_DIR}/raw/${op.file}`)).toBe(true);
      expect(written.has(`${FIXTURES_DIR}/smoke/${op.file}`)).toBe(true);
      expect(written.has(`${FIXTURES_DIR}/${op.file}`), op.file).toBe(false);
    }
    expect([...written.keys()].every((p) => /^\/cartella-finta\/apollo\/(raw|smoke)\/[^/]+\.json$/.test(p))).toBe(true);
    for (const [filePath, content] of written) {
      expect(filePath.startsWith(FIXTURES_DIR)).toBe(true);
      if (filePath.includes('/raw/')) continue;
      expect(content).not.toContain('mario.rossi@azienda-vera.it');
      expect(content).not.toContain('linkedin.com/in/mario-rossi-vero');
      expect(content).not.toContain('Mario');
    }
    const match = JSON.parse(written.get(`${FIXTURES_DIR}/smoke/people-bulk-match.json`)!);
    expect(match._source).toBe('smoke');
    expect(match.matches[1]).toBeNull();
    expect(match.matches[0].organization.linkedin_url).toBe('https://www.linkedin.com/company/acme-fittizia');
  });

  it('403 sulla ricerca persone: rimedio in italiano, match solo per URL, uscita non zero', async () => {
    const t = makeDeps({ status: (url) => (url.endsWith('/mixed_people/api_search') ? 403 : 200) });
    const code = await main([...ARGS, '--yes'], t.deps);
    expect(code).not.toBe(0);
    expect(t.fetch).toHaveBeenCalledTimes(4);
    expect(t.output()).toContain('usa una master key o una chiave con il permesso di ricerca persone');
    expect(t.output()).toContain('HTTP 403');
    expect(t.output()).not.toContain(KEY);
    expect(JSON.parse(callInit(t.fetch, 3).body!).details).toEqual([{ linkedin_url: PROFILE }]);
    // La copia anonimizzata di un errore non sovrascrive la fixture.
    const paths = t.writeFile.mock.calls.map(([p]) => p);
    expect(paths).toContain(`${FIXTURES_DIR}/raw/mixed-people-api-search.json`);
    expect(paths).not.toContain(`${FIXTURES_DIR}/smoke/mixed-people-api-search.json`);
    expect(paths).not.toContain(`${FIXTURES_DIR}/mixed-people-api-search.json`);
  });

  it('se l\'arricchimento fallisce la ricerca aziende usa il filtro di ripiego (Italy)', async () => {
    const t = makeDeps({ status: (url) => (url.includes('/organizations/bulk_enrich') ? 500 : 200) });
    await main([...ARGS, '--yes'], t.deps);
    const companies = JSON.parse(callInit(t.fetch, 1).body!);
    expect(companies).toEqual({ organization_locations: ['Italy'], page: 1, per_page: 5 });
  });
});

describe('anonymize', () => {
  const input = {
    person: {
      id: 'p-1',
      first_name: 'Mario',
      last_name: 'Rossi',
      name: 'Mario Rossi',
      email: 'mario.rossi@azienda-vera.it',
      personal_emails: ['mario@gmail.com'],
      linkedin_url: 'https://www.linkedin.com/in/mario-rossi-vero',
      photo_url: 'https://media.licdn.com/mario.jpg',
      phone_numbers: [{ raw_number: '+39 333 1234567', sanitized_number: '+393331234567' }],
      title: 'CTO',
      headline: 'CTO @ Studio Mario Rossi',
      formatted_address: 'Via Garibaldi 3, Milano',
      organization: {
        name: 'Acme Fittizia',
        primary_domain: 'acme-fittizia.it',
        linkedin_url: 'https://www.linkedin.com/company/acme-fittizia',
        estimated_num_employees: 42,
      },
    },
    note: 'Scrivimi a mario.rossi@azienda-vera.it',
  };

  it('toglie email, URL di profilo, nomi, headline, telefoni e foto mantenendo struttura e dati aziendali', () => {
    const out = anonymize(input) as typeof input;
    const text = JSON.stringify(out);
    expect(text).not.toMatch(/mario|rossi|gmail|licdn|333|garibaldi/i);
    expect(out.person.email).toMatch(/@esempio\.invalid$/);
    expect(out.person.personal_emails).toHaveLength(1);
    expect(out.person.linkedin_url).toMatch(/^https:\/\/www\.linkedin\.com\/in\/persona-\d+$/);
    expect(out.person.phone_numbers[0]).toHaveProperty('sanitized_number');
    expect(out.person.title).toBe('<ruolo>');
    expect(out.person.id).toBe('persona-1');
    expect(out.person.headline).toBe('<headline>');
    expect(out.person.formatted_address).toBe('<indirizzo>');
    expect(out.person.organization).toEqual(input.person.organization);
    expect(Object.keys(out.person)).toEqual(Object.keys(input.person));
  });

  it('maschera gli indirizzi delle aziende ovunque nell\'albero (possono contenere nomi di persone)', () => {
    const org = (id: string) => ({
      id,
      name: 'Acme Fittizia',
      raw_address: 'Via Mario Rossi 1, 25100 Brescia BS, Italy',
      street_address: 'Via Mario Rossi 1',
      postal_code: '25100',
      formatted_address: 'Via Mario Rossi 1, Brescia',
      city: 'Brescia',
      country: 'Italy',
    });
    const response = {
      organizations: [org('o-1'), { ...org('o-2'), raw_address: null, postal_code: '' }],
      matches: [{ id: 'p-1', organization: org('o-3'), employment_history: [{ organization_name: 'Acme Fittizia', raw_address: 'Via Mario Rossi 1' }] }],
    };
    const out = anonymize(response) as any;
    expect(JSON.stringify(out)).not.toMatch(/rossi|25100/i);
    for (const o of [out.organizations[0], out.matches[0].organization]) {
      expect(o).toMatchObject({ raw_address: '<indirizzo>', street_address: '<indirizzo>', postal_code: '<indirizzo>', formatted_address: '<indirizzo>' });
      expect(o).toMatchObject({ name: 'Acme Fittizia', city: 'Brescia', country: 'Italy' });
    }
    // Tipi e valori vuoti invariati: null resta null, '' resta ''.
    expect(out.organizations[1]).toMatchObject({ raw_address: null, postal_code: '', street_address: '<indirizzo>' });
    expect(out.matches[0].employment_history[0]).toEqual({ organization_name: 'Azienda 1', raw_address: '<indirizzo>' });
  });

  it('maschera ruolo, id Apollo e storico lavorativo delle persone (con l\'azienda le rendono riconoscibili)', () => {
    const history = [
      { _id: 'h-1', current: true, organization_id: 'o-1', organization_name: 'Acme Fittizia', title: 'CEO / Founder', start_date: '2020-01-01' },
      { _id: 'h-2', current: false, organization_id: 'o-9', organization_name: 'Studio Precedente', title: 'Consulente', description: null },
    ];
    const response = {
      people: [{ id: 'p-7', first_name: 'Mario', title: 'CEO / Founder', organization: { id: 'o-1', name: 'Acme Fittizia' } }],
      matches: [{ id: 'p-7', title: 'CEO / Founder', organization_id: 'o-1', employment_history: history }, null],
    };
    const out = anonymize(response) as any;
    expect(JSON.stringify(out)).not.toMatch(/founder|consulente|studio precedente|p-7|h-1|o-9/i);
    expect(out.people[0]).toMatchObject({ id: 'persona-1', title: '<ruolo>', organization: { id: 'o-1', name: 'Acme Fittizia' } });
    expect(out.matches[0]).toMatchObject({ id: 'persona-1', title: '<ruolo>', organization_id: 'o-1' });
    expect(out.matches[0].employment_history).toEqual([
      { _id: 'persona-1-lavoro-1', current: true, organization_id: 'persona-1-lavoro-1', organization_name: 'Azienda 1', title: '<ruolo>', start_date: '2020-01-01' },
      { _id: 'persona-1-lavoro-2', current: false, organization_id: 'persona-1-lavoro-2', organization_name: 'Azienda 2', title: '<ruolo>', description: null },
    ]);
    expect(out.matches[1]).toBeNull();
  });

  it('fixture Apollo docs e smoke (sola lettura): nessuna email, profilo persona o indirizzo in chiaro', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const addressKey = /^(raw_address|street_address|postal_code|formatted_address)$/;
    const findAddresses = (node: unknown, found: string[] = []): string[] => {
      if (Array.isArray(node)) node.forEach((n) => findAddresses(n, found));
      else if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) {
          if (addressKey.test(k) && typeof v === 'string' && v !== '' && v !== '<indirizzo>') found.push(`${k}=${v}`);
          else findAddresses(v, found);
        }
      }
      return found;
    };
    let checked = 0;
    for (const dir of ['', 'smoke']) {
      for (const op of SMOKE_OPS) {
        const file = path.join(import.meta.dirname, 'fixtures', 'apollo', dir, op.file);
        if (!fs.existsSync(file)) continue;
        checked++;
        const fixture = JSON.parse(fs.readFileSync(file, 'utf8'));
        expect(fixture._source, file).toBe(dir === 'smoke' ? 'smoke' : 'docs');
        // Le copie smoke sono già anonimizzate: si controlla il file così com'è; le docs dopo anonymize.
        const checkedValue = dir === 'smoke' ? fixture : anonymize(fixture);
        const text = JSON.stringify(checkedValue);
        for (const email of text.match(/[\w.+-]+@[\w.-]+/g) ?? []) expect(email, file).toMatch(/^persona-\d+@esempio\.invalid$/);
        for (const url of text.match(/linkedin\.com\/in\/[^"'\s]+/g) ?? []) expect(url, file).toMatch(/^linkedin\.com\/in\/persona-\d+$/);
        expect(findAddresses(checkedValue), file).toEqual([]);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('è puro e deterministico: non muta l\'input e la stessa email diventa lo stesso segnaposto', () => {
    const snapshot = JSON.stringify(input);
    const out = anonymize(input) as typeof input;
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(out.note).toContain(out.person.email);
    expect(JSON.stringify(anonymize(input))).toBe(JSON.stringify(out));
  });
});
