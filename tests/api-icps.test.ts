import { describe, expect, it } from 'vitest';

// API ICP e aziende di riferimento (crm-foundation T4). Import dinamici: la config
// (DB_PATH isolato da tests/setup.ts) è letta a import-time.
const { createApp } = await import('../src/server/app.js');
const { db } = await import('../src/db/index.js');

const app = createApp();

async function createIcp(body: Record<string, unknown>): Promise<Record<string, any>> {
  const res = await send('POST', '/api/icps', body);
  expect(res.status).toBe(201);
  return (await res.json()) as Record<string, any>;
}

/** Azienda inserita direttamente: i test dell'API aziende stanno in api-companies.test.ts. */
function insertCompany(slug: string, name: string): number {
  const url = `https://www.linkedin.com/company/${slug}`;
  return Number(db.prepare(`INSERT INTO companies (linkedin_url, name) VALUES (?, ?)`).run(url, name).lastInsertRowid);
}

function send(method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
  });
}

describe('API ICP', () => {
  it('POST /api/icps → 201 con array normalizzati; compare in GET /api/icps con i conteggi', async () => {
    const res = await send('POST', '/api/icps', {
      name: 'CTO startup',
      target_roles: ['CTO', ' Head of Engineering ', '', 'cto'],
    });
    expect(res.status).toBe(201);
    const icp = (await res.json()) as Record<string, any>;
    expect(icp).toMatchObject({
      name: 'CTO startup',
      target_roles: ['CTO', 'Head of Engineering'],
      target_industries: [],
      target_locations: [],
      description: null,
      reference_companies: [],
      lists: [],
    });
    expect(icp.id).toBeTypeOf('number');

    const list = await send('GET', '/api/icps');
    expect(list.status).toBe(200);
    const { items } = (await list.json()) as { items: Array<Record<string, any>> };
    expect(items.find((i) => i.id === icp.id)).toMatchObject({
      name: 'CTO startup',
      target_roles: ['CTO', 'Head of Engineering'],
      lists_count: 0,
      reference_companies_count: 0,
    });
  });

  it('PUT reference-companies con outcome vinta → nel GET dell\'ICP; un secondo PUT aggiorna; DELETE rimuove', async () => {
    const icp = await createIcp({ name: 'CTO startup', target_roles: ['CTO', 'Head of Engineering'] });
    const cid = insertCompany('acme', 'Acme');

    const put = await send('PUT', `/api/icps/${icp.id}/reference-companies/${cid}`, { outcome: 'vinta' });
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ icp_id: icp.id, company_id: cid, outcome: 'vinta', notes: null });

    const detail = (await (await send('GET', `/api/icps/${icp.id}`)).json()) as Record<string, any>;
    expect(detail.reference_companies).toHaveLength(1);
    expect(detail.reference_companies[0]).toMatchObject({
      company_id: cid,
      outcome: 'vinta',
      company: { id: cid, name: 'Acme', linkedin_url: 'https://www.linkedin.com/company/acme' },
    });

    // Aggiornamento parziale: le note cambiano, l'esito resta.
    const again = await send('PUT', `/api/icps/${icp.id}/reference-companies/${cid}`, { notes: ' Chiusa a marzo ' });
    expect(await again.json()).toMatchObject({ outcome: 'vinta', notes: 'Chiusa a marzo' });

    const { items } = (await (await send('GET', '/api/icps')).json()) as { items: Array<Record<string, any>> };
    expect(items.find((i) => i.id === icp.id)?.reference_companies_count).toBe(1);

    const del = await send('DELETE', `/api/icps/${icp.id}/reference-companies/${cid}`);
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ ok: true });
    const after = (await (await send('GET', `/api/icps/${icp.id}`)).json()) as Record<string, any>;
    expect(after.reference_companies).toEqual([]);
  });

  it('riferimenti: esito non valido → 400; ICP o azienda inesistenti → 404', async () => {
    const icp = await createIcp({ name: 'Fintech' });
    const cid = insertCompany('globex', 'Globex');
    expect((await send('PUT', `/api/icps/${icp.id}/reference-companies/${cid}`, { outcome: 'boh' })).status).toBe(400);
    expect((await send('PUT', `/api/icps/999999/reference-companies/${cid}`, {})).status).toBe(404);
    const missingCompany = await send('PUT', `/api/icps/${icp.id}/reference-companies/999999`, {});
    expect(missingCompany.status).toBe(404);
    expect(await missingCompany.json()).toEqual({ error: 'Azienda non trovata.' });
    expect((await send('DELETE', `/api/icps/${icp.id}/reference-companies/${cid}`)).status).toBe(404);
  });

  it('PATCH /api/icps/:id aggiorna solo i campi presenti; nome vuoto → 400; id inesistente → 404', async () => {
    const icp = await createIcp({ name: 'PMI manifattura', target_roles: ['COO'], pains: 'Scarti' });
    const res = await send('PATCH', `/api/icps/${icp.id}`, {
      target_locations: ['Lombardia', ' Veneto'],
      description: '  ',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      name: 'PMI manifattura',
      target_roles: ['COO'],
      target_locations: ['Lombardia', 'Veneto'],
      description: null,
      pains: 'Scarti',
    });
    expect((await send('PATCH', `/api/icps/${icp.id}`, { name: ' ' })).status).toBe(400);
    expect((await send('PATCH', `/api/icps/${icp.id}`, { colore: 'blu' })).status).toBe(400);
    expect((await send('PATCH', '/api/icps/999999', { name: 'X' })).status).toBe(404);
  });

  it('DELETE /api/icps/:id: con liste → 409 icp_has_lists e nulla cancellato; senza liste → ok e 404 dopo', async () => {
    const icp = await createIcp({ name: 'Con liste' });
    db.prepare(`INSERT INTO lists (icp_id, name, archived_at) VALUES (?, 'Archiviata', ?)`).run(icp.id, new Date().toISOString());

    const blocked = await send('DELETE', `/api/icps/${icp.id}`);
    expect(blocked.status).toBe(409);
    const body = (await blocked.json()) as Record<string, any>;
    expect(body).toMatchObject({ code: 'icp_has_lists', lists_count: 1 });
    expect(body.error).toBeTypeOf('string');
    const detail = (await (await send('GET', `/api/icps/${icp.id}`)).json()) as Record<string, any>;
    expect(detail.lists).toEqual([expect.objectContaining({ name: 'Archiviata', archived_at: expect.any(String) })]);

    const free = await createIcp({ name: 'Senza liste' });
    const cid = insertCompany('initech', 'Initech');
    await send('PUT', `/api/icps/${free.id}/reference-companies/${cid}`, { outcome: 'persa' });
    const del = await send('DELETE', `/api/icps/${free.id}`);
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ ok: true });
    expect((await send('GET', `/api/icps/${free.id}`)).status).toBe(404);
    expect((await send('DELETE', `/api/icps/${free.id}`)).status).toBe(404);
  });
});

describe('getIcpContext', () => {
  it('ICP + azienda utente dalle impostazioni + riferimenti con esito; null se l\'ICP non esiste', async () => {
    const { getIcpContext } = await import('../src/db/icps.js');
    const icp = await createIcp({ name: 'Contesto', target_roles: ['CTO'], pains: 'Costi cloud' });
    const cid = insertCompany('hooli', 'Hooli');
    await send('PUT', `/api/icps/${icp.id}/reference-companies/${cid}`, { outcome: 'vinta', notes: 'Migrazione' });
    const put = await send('PUT', '/api/settings', { company_name: 'SeVedemo', company_description: 'Consulenza cloud' });
    expect(put.status).toBe(200);

    const ctx = getIcpContext(icp.id);
    expect(ctx).toMatchObject({
      icp: { id: icp.id, name: 'Contesto', target_roles: ['CTO'], pains: 'Costi cloud' },
      company: { name: 'SeVedemo', description: 'Consulenza cloud', offering: null },
      referenceCompanies: [{ company_id: cid, outcome: 'vinta', notes: 'Migrazione', company: { name: 'Hooli' } }],
    });
    expect(getIcpContext(999999)).toBeNull();
  });
});
