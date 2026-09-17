import { describe, expect, it } from 'vitest';

// API Impostazioni e readiness (crm-foundation T4). Import dinamici: la config
// (DB_PATH isolato da tests/setup.ts) è letta a import-time.
const { createApp } = await import('../src/server/app.js');
const { config } = await import('../src/config.js');
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
      expect(r).toEqual({ apify: false, anthropic: true, profile: expect.any(Boolean), company: false, icp: false, prospects: false });

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
});
