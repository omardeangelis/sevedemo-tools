import { describe, expect, it } from 'vitest';

// Client Apollo (apollo-lookalike T3): `fetch` e `sleep` sempre iniettati. Nessuna chiamata di rete.
const {
  createApolloClient,
  ApolloConfigError,
  ApolloProviderError,
  ApolloRateLimitError,
  APOLLO_MAX_ATTEMPTS,
  APOLLO_RETRY_DEFAULT_WAIT_MS,
  APOLLO_RETRY_MAX_WAIT_MS,
} = await import('../src/apollo/client.js');
const {
  APOLLO_SENIORITIES,
  chunk,
  enrichOrganizationsRequest,
  matchPeopleRequest,
  searchOrganizationsRequest,
  searchPeopleRequest,
} = await import('../src/apollo/requests.js');

type ApolloRequest = import('../src/apollo/requests.js').ApolloRequest;

const KEY = 'chiave-segreta-apollo-xyz123';
const DOMAIN = 'acme-fittizia.it';
const PROFILE = 'https://www.linkedin.com/in/persona-fittizia';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

interface Call {
  url: string;
  init: RequestInit;
}

/** `fetch` finto: risponde in ordine con le risposte date (l'ultima si ripete) e registra le chiamate. */
function fakeFetch(...responses: Array<() => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return responses[Math.min(calls.length - 1, responses.length - 1)]!();
  };
  return { fetch, calls };
}

/** Client con `fetch` finto e orologio finto: `sleep` registra l'attesa e fa avanzare l'orologio. */
function setup(...responses: Array<() => Response | Promise<Response>>) {
  const { fetch, calls } = fakeFetch(...responses);
  const waits: number[] = [];
  const events: string[] = [];
  const clock = { t: Date.parse('2026-09-17T10:00:00Z') };
  const client = createApolloClient({
    apiKey: KEY,
    fetch: async (url, init) => {
      events.push('fetch');
      return fetch(url, init);
    },
    sleep: async (ms) => {
      waits.push(ms);
      events.push(`sleep:${ms}`);
      clock.t += ms;
    },
    now: () => clock.t,
  });
  return { client, calls, waits, events, clock };
}

/** Header di rate limit come li restituisce Apollo (smoke reale 2026-09-17, endpoint bulk). */
function rateHeaders(left: { minute?: number; hourly?: number; daily?: number }): Record<string, string> {
  return {
    'x-rate-limit-minute': '20',
    'x-rate-limit-hourly': '100',
    'x-rate-limit-24-hour': '600',
    'x-minute-requests-left': String(left.minute ?? 19),
    'x-hourly-requests-left': String(left.hourly ?? 99),
    'x-24-hour-requests-left': String(left.daily ?? 599),
    'x-minute-usage': '1',
  };
}

const companiesRequest = () => searchOrganizationsRequest({ keywords: ['meccanica'], ranges: ['11-20'], locations: ['Italy'] }, 1, 100);

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }
  throw new Error('la promessa doveva essere rifiutata');
}

describe('client Apollo: chiamata riuscita', () => {
  it('POST sul path della richiesta con header, body JSON e risposta letta come JSON', async () => {
    const { client, calls } = setup(() => jsonResponse(200, { people: [{ id: 'p-1' }] }));
    const request = searchPeopleRequest({ domain: DOMAIN, titles: ['CEO'], perPage: 10 });

    await expect(client.post(request)).resolves.toEqual({ people: [{ id: 'p-1' }] });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.apollo.io/api/v1/mixed_people/api_search');
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.init.headers).toMatchObject({
      'x-api-key': KEY,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
    });
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual(request.body);
    expect(client.stats.requests).toBe(1);
  });

  it('bulk_enrich: domini come query `domains[]` e nessun body', async () => {
    const { client, calls } = setup(() => jsonResponse(200, { organizations: [] }));

    await client.post(enrichOrganizationsRequest([DOMAIN, 'beta-fittizia.it']));

    expect(calls[0]!.url).toBe(
      'https://api.apollo.io/api/v1/organizations/bulk_enrich?domains[]=acme-fittizia.it&domains[]=beta-fittizia.it',
    );
    expect(calls[0]!.init.body).toBeUndefined();
  });
});

describe('client Apollo: limite di richieste (429)', () => {
  it('429 con retry-after: 0 → attende e ritenta, poi riesce (2 richieste)', async () => {
    const { client, waits } = setup(
      () => jsonResponse(429, { error: 'rate limited' }, { 'retry-after': '0' }),
      () => jsonResponse(200, { organizations: [{ id: 'org-1' }] }),
    );

    await expect(client.post(companiesRequest())).resolves.toEqual({ organizations: [{ id: 'org-1' }] });
    expect(client.stats.requests).toBe(2);
    expect(waits).toEqual([0]);
  });

  it(`429 ripetuto oltre ${APOLLO_MAX_ATTEMPTS} tentativi → ApolloRateLimitError attribuito, attesa limitata a 60 s`, async () => {
    const { client, waits } = setup(() => jsonResponse(429, { error: 'rate limited' }, { 'retry-after': '3600' }));

    const err = await rejection(client.post(companiesRequest()));

    expect(err).toBeInstanceOf(ApolloRateLimitError);
    expect(err.message).toMatch(/^actor:apollo:mixed_companies\/search: limite di richieste raggiunto \(/);
    expect(APOLLO_MAX_ATTEMPTS).toBe(3);
    expect(APOLLO_RETRY_MAX_WAIT_MS).toBe(60_000);
    expect(client.stats.requests).toBe(APOLLO_MAX_ATTEMPTS);
    // Nessuna attesa dopo l'ultimo tentativo.
    expect(waits).toEqual([60_000, 60_000]);
  });

  it('429 senza retry-after → attesa di default; retry-after come data lontana → limitata a 60 s', async () => {
    const s = setup(
      () => jsonResponse(429, {}),
      () => jsonResponse(429, {}, { 'retry-after': new Date(s.clock.t + 3_600_000).toUTCString() }),
      () => jsonResponse(200, { ok: true }),
    );
    const { client, waits } = s;

    await expect(client.post(companiesRequest())).resolves.toEqual({ ok: true });
    expect(waits).toEqual([APOLLO_RETRY_DEFAULT_WAIT_MS, 60_000]);
    expect(client.stats.requests).toBe(3);
  });
});

describe('client Apollo: ritmo proattivo dagli header x-*-requests-left (per operazione)', () => {
  it('minuto esaurito → la richiesta successiva della stessa operazione attende la fine della finestra', async () => {
    const { client, calls, waits, events, clock } = setup(
      () => jsonResponse(200, { ok: 1 }, rateHeaders({ minute: 0, hourly: 57, daily: 420 })),
      () => jsonResponse(200, { ok: 2 }),
    );

    await client.post(enrichOrganizationsRequest([DOMAIN]));
    expect(waits).toEqual([]);
    expect(client.limits('organizations/bulk_enrich')).toEqual({
      minute: 20,
      hourly: 100,
      daily: 600,
      minuteLeft: 0,
      hourlyLeft: 57,
      dailyLeft: 420,
    });

    clock.t += 15_000;
    await expect(client.post(enrichOrganizationsRequest([DOMAIN]))).resolves.toEqual({ ok: 2 });

    // 60 s dalla risposta meno i 15 s già trascorsi, e l'attesa avviene prima della seconda richiesta.
    expect(waits).toEqual([45_000]);
    expect(events).toEqual(['fetch', 'sleep:45000', 'fetch']);
    expect(calls).toHaveLength(2);
  });

  it('minuto esaurito senza tempo trascorso → attesa di 60 s; le altre operazioni non attendono', async () => {
    const { client, waits } = setup(
      () => jsonResponse(200, {}, rateHeaders({ minute: 0 })),
      () => jsonResponse(200, {}),
    );

    await client.post(matchPeopleRequest([{ id: 'p-1' }]));
    await client.post(companiesRequest());
    expect(waits).toEqual([]);
    expect(client.limits('mixed_companies/search')).toBeUndefined();

    await client.post(matchPeopleRequest([{ id: 'p-2' }]));
    expect(waits).toEqual([60_000]);
  });

  it('limite orario esaurito → la richiesta successiva è rifiutata senza chiamare Apollo né attendere', async () => {
    const { client, calls, waits, clock } = setup(
      () => jsonResponse(200, {}, rateHeaders({ hourly: 0 })),
      () => jsonResponse(200, { ok: true }),
    );

    await client.post(matchPeopleRequest([{ id: 'p-1' }]));
    const err = await rejection(client.post(matchPeopleRequest([{ id: 'p-2' }])));

    expect(err).toBeInstanceOf(ApolloRateLimitError);
    expect(err.message).toBe(
      'actor:apollo:people/bulk_match: limite orario di Apollo esaurito (100 richieste/ora): riprova più tardi',
    );
    expect((err as InstanceType<typeof ApolloRateLimitError>).window).toBe('hourly');
    expect(calls).toHaveLength(1);
    expect(client.stats.requests).toBe(1);
    expect(waits).toEqual([]);

    // Passata l'ora, il dato è vecchio: si torna a chiamare Apollo.
    clock.t += 3_600_000;
    await expect(client.post(matchPeopleRequest([{ id: 'p-2' }]))).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(2);
  });

  it('limite giornaliero esaurito → rifiuto immediato; vale anche su un 429 prima di ritentare', async () => {
    const { client, calls, waits } = setup(() =>
      jsonResponse(429, {}, { ...rateHeaders({ minute: 0, hourly: 0, daily: 0 }), 'retry-after': '30' }),
    );

    const err = await rejection(client.post(companiesRequest()));

    expect(err).toBeInstanceOf(ApolloRateLimitError);
    expect(err.message).toBe(
      'actor:apollo:mixed_companies/search: limite giornaliero di Apollo esaurito (600 richieste/24 ore): riprova più tardi',
    );
    expect((err as InstanceType<typeof ApolloRateLimitError>).window).toBe('daily');
    expect(calls).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  it('header assenti o illeggibili → nessuna attesa e nessun limite noto', async () => {
    const { client, waits } = setup(
      () => jsonResponse(200, {}),
      () => jsonResponse(200, {}, { 'x-minute-requests-left': 'molte', 'x-hourly-requests-left': '-1' }),
      () => jsonResponse(200, {}),
    );

    for (let i = 0; i < 3; i++) await client.post(companiesRequest());

    expect(waits).toEqual([]);
    expect(client.limits('mixed_companies/search')).toBeUndefined();
    expect(client.stats.requests).toBe(3);
  });
});

describe('client Apollo: errori di configurazione', () => {
  it('403 sulla ricerca persone → config: con il rimedio "master key"', async () => {
    const client = createApolloClient({
      apiKey: KEY,
      fetch: async () => jsonResponse(403, { error: 'forbidden' }),
      sleep: async () => {},
    });
    const request = searchPeopleRequest({ domain: 'acme-fittizia.it', perPage: 10 });
    await expect(client.post(request)).rejects.toThrow(/^config: .*master key/);
  });

  it('403: testo completo con l\'operazione, ApolloConfigError, nessun ritentativo', async () => {
    const { client, waits } = setup(() => jsonResponse(403, { error: 'forbidden' }));

    const err = await rejection(client.post(searchPeopleRequest({ domain: DOMAIN, perPage: 10 })));

    expect(err).toBeInstanceOf(ApolloConfigError);
    expect(err.message).toBe(
      'config: la chiave Apollo non ha i permessi per mixed_people/api_search: usa una master key o una chiave con il ' +
        'permesso di ricerca persone (Apollo → Settings → API keys).',
    );
    expect(client.stats.requests).toBe(1);
    expect(waits).toEqual([]);
  });

  it('401 → config: chiave rifiutata', async () => {
    const { client } = setup(() => jsonResponse(401, { error: 'invalid api key' }));

    const err = await rejection(client.post(companiesRequest()));

    expect(err).toBeInstanceOf(ApolloConfigError);
    expect(err.message).toBe('config: chiave Apollo rifiutata (401). Verifica APOLLO_API_KEY nel .env.');
  });

  it('chiave vuota → config: senza alcuna richiesta HTTP', async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse(200, {}));
    const client = createApolloClient({ apiKey: '  ', fetch, sleep: async () => {} });

    await expect(client.post(companiesRequest())).rejects.toThrow(/^config: APOLLO_API_KEY mancante/);
    expect(calls).toHaveLength(0);
    expect(client.stats.requests).toBe(0);
  });
});

describe('client Apollo: errori del provider', () => {
  it('500 → actor:apollo:<op>: HTTP 500 con estratto breve, nessun ritentativo', async () => {
    const { client } = setup(() => jsonResponse(500, { error: 'Internal failure' }));

    const err = await rejection(client.post(matchPeopleRequest([{ linkedin_url: PROFILE }])));

    expect(err).toBeInstanceOf(ApolloProviderError);
    expect(err.message).toBe('actor:apollo:people/bulk_match: HTTP 500 (Internal failure)');
    expect((err as InstanceType<typeof ApolloProviderError>).status).toBe(500);
    expect(client.stats.requests).toBe(1);
  });

  it('errore di rete → actor:apollo:<op>: errore di rete', async () => {
    const { client } = setup(() => {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    });

    const err = await rejection(client.post(companiesRequest()));

    expect(err).toBeInstanceOf(ApolloProviderError);
    expect(err.message).toBe('actor:apollo:mixed_companies/search: errore di rete (fetch failed: ECONNREFUSED)');
  });

  it('timeout → errore di rete con la durata', async () => {
    const { client } = setup(() => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    });

    await expect(client.post(companiesRequest())).rejects.toThrow(
      'actor:apollo:mixed_companies/search: errore di rete (timeout dopo 30 s)',
    );
  });

  it('risposta 200 non JSON → actor:apollo:<op>: risposta non valida', async () => {
    const { client } = setup(() => new Response('<html>gateway</html>', { status: 200 }));

    await expect(client.post(enrichOrganizationsRequest([DOMAIN]))).rejects.toThrow(
      /^actor:apollo:organizations\/bulk_enrich: risposta non valida$/,
    );
  });

  it('la chiave e i body non compaiono mai nei messaggi d\'errore', async () => {
    const echo = `api key ${KEY} non valida per ${PROFILE}`;
    const scenarios: Array<() => Response> = [
      () => jsonResponse(500, { error: echo }),
      () => jsonResponse(422, { message: echo }),
      () => jsonResponse(401, { error: echo }),
      () => jsonResponse(403, { error: echo }),
      () => jsonResponse(429, { error: echo }, { 'retry-after': KEY }),
      () => new Response(echo, { status: 200 }),
      () => {
        throw new Error(echo);
      },
    ];
    for (const scenario of scenarios) {
      const { client } = setup(scenario);
      const err = await rejection(client.post(matchPeopleRequest([{ linkedin_url: PROFILE }])));
      expect(err.message).toMatch(/^(actor:apollo:people\/bulk_match: |config: )/);
      expect(err.message).not.toContain(KEY);
      expect(err.message).not.toContain('reveal_personal_emails');
    }
  });
});

describe('richieste Apollo (unico punto dei body)', () => {
  it('APOLLO_SENIORITIES: le 9 seniority Apollo', () => {
    expect(APOLLO_SENIORITIES).toEqual(['owner', 'founder', 'c_suite', 'vp', 'head', 'director', 'manager', 'senior', 'entry']);
  });

  it('chunk divide in blocchi consecutivi', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 10)).toEqual([]);
    expect(() => chunk([1], 0)).toThrow();
  });

  it('enrichOrganizationsRequest: query domains[], al massimo 10', () => {
    const request = enrichOrganizationsRequest([DOMAIN, 'beta-fittizia.it']);
    expect(request).toEqual<ApolloRequest>({
      op: 'organizations/bulk_enrich',
      path: 'organizations/bulk_enrich',
      query: { domains: [DOMAIN, 'beta-fittizia.it'] },
    });
    expect(request).not.toHaveProperty('body');
    const eleven = Array.from({ length: 11 }, (_, i) => `azienda-${i}.it`);
    expect(() => enrichOrganizationsRequest(eleven)).toThrow(/al massimo 10/);
    expect(() => enrichOrganizationsRequest([])).toThrow();
  });

  it('searchOrganizationsRequest: fasce convertite, liste vuote omesse, per_page ≤ 100', () => {
    expect(
      searchOrganizationsRequest(
        { keywords: ['meccanica', 'automazione'], ranges: ['1-10', '5001-10000', '10001+'], locations: ['Lombardy, Italy'] },
        2,
        100,
      ),
    ).toEqual<ApolloRequest>({
      op: 'mixed_companies/search',
      path: 'mixed_companies/search',
      body: {
        q_organization_keyword_tags: ['meccanica', 'automazione'],
        organization_num_employees_ranges: ['1,10', '5001,10000', '10001,1000000'],
        organization_locations: ['Lombardy, Italy'],
        page: 2,
        per_page: 100,
      },
    });
    expect(searchOrganizationsRequest({ keywords: [], ranges: [], locations: ['Italy'] }, 1, 25).body).toEqual({
      organization_locations: ['Italy'],
      page: 1,
      per_page: 25,
    });
    expect(() => searchOrganizationsRequest({ keywords: [], ranges: [], locations: [] }, 1, 101)).toThrow(/per_page/);
    expect(() => searchOrganizationsRequest({ keywords: [], ranges: [], locations: [] }, 0, 10)).toThrow(/pagina/);
    expect(() => searchOrganizationsRequest({ keywords: [], ranges: ['molti'], locations: [] }, 1, 10)).toThrow(/fascia/);
  });

  it('searchPeopleRequest: una azienda per richiesta, pagina 1 di default, liste vuote omesse', () => {
    expect(
      searchPeopleRequest({
        domain: DOMAIN,
        titles: ['CEO', 'Direttore commerciale'],
        seniorities: ['owner', 'c_suite'],
        locations: ['Italy'],
        perPage: 10,
      }),
    ).toEqual<ApolloRequest>({
      op: 'mixed_people/api_search',
      path: 'mixed_people/api_search',
      body: {
        q_organization_domains_list: [DOMAIN],
        person_titles: ['CEO', 'Direttore commerciale'],
        person_seniorities: ['owner', 'c_suite'],
        person_locations: ['Italy'],
        page: 1,
        per_page: 10,
      },
    });
    expect(searchPeopleRequest({ domain: DOMAIN, titles: [], seniorities: [], locations: [], perPage: 5, page: 3 }).body).toEqual({
      q_organization_domains_list: [DOMAIN],
      page: 3,
      per_page: 5,
    });
    expect(() => searchPeopleRequest({ domain: DOMAIN, seniorities: ['owner', 'ceo'], perPage: 10 })).toThrow(/"ceo"/);
    expect(() => searchPeopleRequest({ domain: ' ', perPage: 10 })).toThrow(/dominio/);
  });

  it('matchPeopleRequest: id o linkedin_url, reveal sempre false, al massimo 10', () => {
    expect(matchPeopleRequest([{ id: 'p-1' }, { linkedin_url: PROFILE }])).toEqual<ApolloRequest>({
      op: 'people/bulk_match',
      path: 'people/bulk_match',
      body: {
        details: [{ id: 'p-1' }, { linkedin_url: PROFILE }],
        reveal_personal_emails: false,
        reveal_phone_number: false,
      },
    });
    const eleven = Array.from({ length: 11 }, (_, i) => ({ id: `p-${i}` }));
    expect(() => matchPeopleRequest(eleven)).toThrow(/al massimo 10/);
    expect(() => matchPeopleRequest([{ id: ' ' }])).toThrow(/né id né linkedin_url/);
  });
});
