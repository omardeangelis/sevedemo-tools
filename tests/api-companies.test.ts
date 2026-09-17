import { describe, expect, it } from 'vitest';

// API Aziende (crm-foundation T4). Import dinamici: la config (DB_PATH isolato da
// tests/setup.ts) è letta a import-time.
const { createApp } = await import('../src/server/app.js');
const { db } = await import('../src/db/index.js');

const app = createApp();

function send(method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
  });
}

describe('API Aziende', () => {
  it('POST /api/companies → 201 con URL normalizzato; lo stesso URL scritto diversamente → 409 con existing_id', async () => {
    const res = await send('POST', '/api/companies', {
      linkedin_url: 'https://it.linkedin.com/company/Acme-Srl/about/?viewAsMember=true',
      name: ' Acme ',
      industry: 'Software',
    });
    expect(res.status).toBe(201);
    const company = (await res.json()) as Record<string, any>;
    expect(company).toMatchObject({
      linkedin_url: 'https://www.linkedin.com/company/acme-srl',
      name: 'Acme',
      industry: 'Software',
      website: null,
      reference_of: [],
      prospects_count: 0,
    });

    const dup = await send('POST', '/api/companies', { linkedin_url: 'linkedin.com/company/acme-srl/people' });
    expect(dup.status).toBe(409);
    const body = (await dup.json()) as Record<string, any>;
    expect(body).toMatchObject({ code: 'duplicate', existing_id: company.id });
    expect(body.error).toBeTypeOf('string');
    expect((db.prepare(`SELECT COUNT(*) AS n FROM companies`).get() as { n: number }).n).toBe(1);
  });

  it('URL non LinkedIn o non /company/ → 400 invalid_company_url; nulla creato', async () => {
    for (const bad of ['https://acme.it', 'https://www.linkedin.com/in/mario', 'https://www.linkedin.com/company/', '']) {
      const res = await send('POST', '/api/companies', { linkedin_url: bad });
      expect(res.status, bad).toBe(400);
      expect(await res.json()).toEqual({
        error: 'Inserisci un URL del tipo linkedin.com/company/<nome>',
        code: 'invalid_company_url',
      });
    }
    expect((await send('POST', '/api/companies', { name: 'Senza URL' })).status).toBe(400);
  });

  it('GET lista e dettaglio con reference_of e prospects_count; nome di default = slug; 404 su id inesistente', async () => {
    const created = (await (await send('POST', '/api/companies', { linkedin_url: 'linkedin.com/company/globex' })).json()) as Record<string, any>;
    expect(created.name).toBe('globex');

    const icpA = Number(db.prepare(`INSERT INTO icps (name) VALUES ('Zeta ICP')`).run().lastInsertRowid);
    const icpB = Number(db.prepare(`INSERT INTO icps (name) VALUES ('Alfa ICP')`).run().lastInsertRowid);
    await send('PUT', `/api/icps/${icpA}/reference-companies/${created.id}`, { outcome: 'vinta', notes: 'Chiusa' });
    await send('PUT', `/api/icps/${icpB}/reference-companies/${created.id}`, {});
    const insertProspect = db.prepare(`INSERT INTO prospects (linkedin_url, company_id) VALUES (?, ?)`);
    insertProspect.run('https://www.linkedin.com/in/p1', created.id);
    insertProspect.run('https://www.linkedin.com/in/p2', created.id);

    const expected = {
      id: created.id,
      reference_of: [
        { icp_id: icpB, icp_name: 'Alfa ICP', outcome: 'riferimento', notes: null },
        { icp_id: icpA, icp_name: 'Zeta ICP', outcome: 'vinta', notes: 'Chiusa' },
      ],
      prospects_count: 2,
    };
    const detail = await send('GET', `/api/companies/${created.id}`);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject(expected);

    const { items } = (await (await send('GET', '/api/companies')).json()) as { items: Array<Record<string, any>> };
    expect(items.find((i) => i.id === created.id)).toMatchObject(expected);
    const acme = items.find((i) => i.name === 'Acme');
    expect(acme).toMatchObject({ reference_of: [], prospects_count: 0 });

    const filtered = (await (await send('GET', '/api/companies?q=glob')).json()) as { items: Array<Record<string, any>> };
    expect(filtered.items.map((i) => i.id)).toEqual([created.id]);

    expect((await send('GET', '/api/companies/999999')).status).toBe(404);
  });

  it('PATCH /api/companies/:id: campi parziali; URL di un\'altra azienda → 409; URL non valido → 400', async () => {
    const a = (await (await send('POST', '/api/companies', { linkedin_url: 'linkedin.com/company/initech' })).json()) as Record<string, any>;
    const b = (await (await send('POST', '/api/companies', { linkedin_url: 'linkedin.com/company/umbrella' })).json()) as Record<string, any>;

    const res = await send('PATCH', `/api/companies/${a.id}`, { name: 'Initech', website: 'https://initech.example', notes: '' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: 'Initech', website: 'https://initech.example', notes: null, reference_of: [] });

    const same = await send('PATCH', `/api/companies/${a.id}`, { linkedin_url: 'https://www.linkedin.com/company/Initech/' });
    expect(same.status).toBe(200);

    const dup = await send('PATCH', `/api/companies/${a.id}`, { linkedin_url: 'linkedin.com/company/umbrella' });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ code: 'duplicate', existing_id: b.id });

    expect((await send('PATCH', `/api/companies/${a.id}`, { linkedin_url: 'https://initech.example' })).status).toBe(400);
    expect((await send('PATCH', '/api/companies/999999', { name: 'X' })).status).toBe(404);
  });
});
