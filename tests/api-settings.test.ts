import { describe, expect, it, vi } from 'vitest';

// API Impostazioni e readiness (crm-foundation T4). Import dinamici: la config
// (DB_PATH isolato da tests/setup.ts) è letta a import-time.
const { createApp } = await import('../src/server/app.js');
const { config, requireApollo } = await import('../src/config.js');
const { db } = await import('../src/db/index.js');

const app = createApp();

function send(method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
  });
}

describe('API Impostazioni', () => {
  it('PUT → GET round-trip: URL profilo normalizzato e readiness.profile === true', async () => {
    const before = (await (await send('GET', '/api/settings')).json()) as Record<string, any>;
    expect(before).toMatchObject({ own_profile_url: null, company_description: null });
    expect(before.readiness.profile).toBe(false);

    const put = await send('PUT', '/api/settings', {
      own_profile_url: 'linkedin.com/in/Omar-Test/recent-activity/all/?trk=x',
      company_name: ' SeVedemo ',
    });
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ own_profile_url: 'https://www.linkedin.com/in/omar-test' });

    const res = await send('GET', '/api/settings');
    expect(res.status).toBe(200);
    const s = (await res.json()) as Record<string, any>;
    expect(s).toMatchObject({
      own_profile_url: 'https://www.linkedin.com/in/omar-test',
      company_name: 'SeVedemo',
      company_description: null,
      company_offering: null,
    });
    expect(s.readiness.profile).toBe(true);
  });

  it('URL non LinkedIn o non di una persona → 400 con messaggio leggibile, nulla salvato', async () => {
    await send('PUT', '/api/settings', { own_profile_url: 'https://www.linkedin.com/in/valido' });
    for (const bad of ['https://example.com/in/omar', 'https://www.linkedin.com/company/acme', 'non un url', 'https://www.linkedin.com/in/']) {
      const res = await send('PUT', '/api/settings', { own_profile_url: bad, company_name: 'Non salvato' });
      expect(res.status, bad).toBe(400);
      const body = (await res.json()) as Record<string, any>;
      expect(body).toEqual({
        error: "Inserisci l'URL pubblico del tuo profilo, es. https://www.linkedin.com/in/tuo-nome/",
        code: 'invalid_profile_url',
      });
    }
    const s = (await (await send('GET', '/api/settings')).json()) as Record<string, any>;
    expect(s.own_profile_url).toBe('https://www.linkedin.com/in/valido');
    expect(s.company_name).not.toBe('Non salvato');
    expect((await send('PUT', '/api/settings', { colore: 'blu' })).status).toBe(400);
  });

  it('stringa vuota o null svuotano la chiave; le chiavi assenti restano invariate', async () => {
    await send('PUT', '/api/settings', {
      own_profile_url: 'https://www.linkedin.com/in/omar',
      company_description: 'Consulenza cloud',
      company_offering: 'Migrazioni',
    });
    const res = await send('PUT', '/api/settings', { own_profile_url: '', company_offering: null });
    expect(await res.json()).toMatchObject({
      own_profile_url: null,
      company_description: 'Consulenza cloud',
      company_offering: null,
      readiness: { profile: false, company: true },
    });
  });

  it('readiness: token da config, descrizione azienda, almeno un ICP, almeno un prospect', async () => {
    const saved = { apify: config.apifyToken, anthropic: config.anthropicApiKey };
    try {
      await send('PUT', '/api/settings', { company_description: '   ' });
      config.apifyToken = '';
      let r = ((await (await send('GET', '/api/settings')).json()) as Record<string, any>).readiness;
      expect(r).toEqual({
        apify: false,
        anthropic: true,
        apollo: true,
        profile: expect.any(Boolean),
        company: false,
        icp: false,
        prospects: false,
      });

      config.apifyToken = saved.apify;
      config.anthropicApiKey = '';
      db.prepare(`INSERT INTO icps (name) VALUES ('ICP')`).run();
      db.prepare(`INSERT INTO prospects (linkedin_url) VALUES ('https://www.linkedin.com/in/anna')`).run();
      await send('PUT', '/api/settings', { company_description: 'Consulenza' });
      r = ((await (await send('GET', '/api/settings')).json()) as Record<string, any>).readiness;
      expect(r).toMatchObject({ apify: true, anthropic: false, company: true, icp: true, prospects: true });

      const { getReadiness } = await import('../src/db/settings.js');
      expect(getReadiness()).toEqual(r);
    } finally {
      config.apifyToken = saved.apify;
      config.anthropicApiKey = saved.anthropic;
    }
  });

  it('readiness.apollo (apollo-lookalike A3): false con chiave vuota o di soli spazi, true con chiave', async () => {
    const saved = config.apolloApiKey;
    const readiness = async () => ((await (await send('GET', '/api/settings')).json()) as Record<string, any>).readiness;
    try {
      config.apolloApiKey = '';
      expect((await readiness()).apollo).toBe(false);
      config.apolloApiKey = '   ';
      expect((await readiness()).apollo).toBe(false);
      config.apolloApiKey = 'k';
      const r = await readiness();
      expect(r.apollo).toBe(true);
      // Accanto ad Apify e Anthropic, indipendente da loro.
      expect(r).toMatchObject({ apify: true, anthropic: true, apollo: true });
    } finally {
      config.apolloApiKey = saved;
    }
  });
});

describe('Config Apollo (apollo-lookalike A1/A4)', () => {
  const APOLLO_VARS = [
    'APOLLO_API_KEY',
    'APOLLO_MAX_COMPANY_PAGES',
    'APOLLO_PEOPLE_PER_COMPANY',
    'APOLLO_RATE_LIMIT_PER_MINUTE',
    'APOLLO_CREDIT_USD',
  ] as const;

  /** Rilegge `src/config.ts` da zero con le variabili Apollo indicate (le altre vuote = default). */
  async function loadConfig(env: Partial<Record<(typeof APOLLO_VARS)[number], string>>) {
    const saved = Object.fromEntries(APOLLO_VARS.map((k) => [k, process.env[k]]));
    try {
      for (const k of APOLLO_VARS) process.env[k] = env[k] ?? '';
      vi.resetModules();
      return (await import('../src/config.js')).config;
    } finally {
      for (const k of APOLLO_VARS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  }

  it('default dei tetti e prezzo del credito assente → null (stima non disponibile)', async () => {
    const c = await loadConfig({});
    expect(c.apolloApiKey).toBe('');
    expect(c.apolloMaxCompanyPages).toBe(3);
    expect(c.apolloPeoplePerCompany).toBe(10);
    expect(c.apolloRateLimitPerMinute).toBe(20);
    expect(c.prices.apolloCreditUsd).toBeNull();
  });

  it('valori validi letti; fuori intervallo → clamp; non numerici → default', async () => {
    let c = await loadConfig({
      APOLLO_API_KEY: 'chiave',
      APOLLO_MAX_COMPANY_PAGES: '5',
      APOLLO_PEOPLE_PER_COMPANY: '25',
      APOLLO_RATE_LIMIT_PER_MINUTE: '1000',
      APOLLO_CREDIT_USD: '0.025',
    });
    expect(c).toMatchObject({
      apolloApiKey: 'chiave',
      apolloMaxCompanyPages: 5,
      apolloPeoplePerCompany: 25,
      apolloRateLimitPerMinute: 1000,
    });
    expect(c.prices.apolloCreditUsd).toBe(0.025);

    c = await loadConfig({ APOLLO_MAX_COMPANY_PAGES: '0', APOLLO_PEOPLE_PER_COMPANY: '-4', APOLLO_RATE_LIMIT_PER_MINUTE: '0' });
    expect([c.apolloMaxCompanyPages, c.apolloPeoplePerCompany, c.apolloRateLimitPerMinute]).toEqual([1, 1, 1]);

    c = await loadConfig({ APOLLO_MAX_COMPANY_PAGES: '500', APOLLO_PEOPLE_PER_COMPANY: '101' });
    expect([c.apolloMaxCompanyPages, c.apolloPeoplePerCompany]).toEqual([100, 100]);

    c = await loadConfig({
      APOLLO_MAX_COMPANY_PAGES: 'tre',
      APOLLO_PEOPLE_PER_COMPANY: 'x',
      APOLLO_RATE_LIMIT_PER_MINUTE: 'molti',
      APOLLO_CREDIT_USD: 'gratis',
    });
    expect([c.apolloMaxCompanyPages, c.apolloPeoplePerCompany, c.apolloRateLimitPerMinute]).toEqual([3, 10, 20]);
    expect(c.prices.apolloCreditUsd).toBeNull();
  });

  it('tests/setup.ts maschera la chiave reale con una finta; requireApollo() blocca solo senza chiave', async () => {
    expect(config.apolloApiKey).toBe('test-apollo-key');
    const saved = config.apolloApiKey;
    try {
      expect(() => requireApollo()).not.toThrow();
      config.apolloApiKey = ' ';
      expect(() => requireApollo()).toThrow(/^APOLLO_API_KEY mancante nel \.env/);
    } finally {
      config.apolloApiKey = saved;
    }
  });
});
