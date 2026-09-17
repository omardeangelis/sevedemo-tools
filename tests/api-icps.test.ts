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

describe('referenze e candidate (apollo-lookalike T11, SPEC E4)', () => {
  const PARTS = { keywords: 0.5, size: 1, location: null };

  async function candidate(icpId: number, companyId: number) {
    const { upsertCandidate } = await import('../src/db/candidates.js');
    expect(upsertCandidate({ icpId, companyId, score: 0.82, parts: PARTS, reasons: ['stesso settore'], jobId: null }).created).toBe(true);
  }

  async function candidateOf(companyId: number): Promise<Array<Record<string, any>>> {
    const res = await send('GET', `/api/companies/${companyId}/candidate-of`);
    expect(res.status).toBe(200);
    return ((await res.json()) as { items: Array<Record<string, any>> }).items;
  }

  it('promuovere una candidata a referenza la toglie dalle candidate di quell\'ICP (non degli altri); rimuovere la referenza non la ricrea', async () => {
    const icp = await createIcp({ name: 'Promozione' });
    const other = await createIcp({ name: 'Altro ICP' });
    const cid = insertCompany('promossa', 'Promossa');
    await candidate(icp.id, cid);
    await candidate(other.id, cid);
    expect((await candidateOf(cid)).map((r) => r.icp_id).sort()).toEqual([icp.id, other.id].sort());

    const put = await send('PUT', `/api/icps/${icp.id}/reference-companies/${cid}`, { outcome: 'vinta' });
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ icp_id: icp.id, company_id: cid, outcome: 'vinta', candidate_removed: true });
    expect(await candidateOf(cid)).toEqual([expect.objectContaining({ icp_id: other.id, status: 'proposta' })]);
    const list = (await (await send('GET', `/api/icps/${icp.id}/candidates`)).json()) as Record<string, any>;
    expect(list).toMatchObject({ items: [], total: 0, counts: { proposta: 0, accettata: 0, scartata: 0 } });

    // Aggiornare la referenza non tocca più nulla; rimuoverla non riporta la candidata (score e ragioni persi).
    expect(await (await send('PUT', `/api/icps/${icp.id}/reference-companies/${cid}`, { notes: 'x' })).json()).toMatchObject({
      candidate_removed: false,
    });
    expect((await send('DELETE', `/api/icps/${icp.id}/reference-companies/${cid}`)).status).toBe(200);
    expect((await candidateOf(cid)).map((r) => r.icp_id)).toEqual([other.id]);
  });

  it('DELETE /api/icps/:id cancella anche le sue candidate; l\'azienda resta', async () => {
    const icp = await createIcp({ name: 'Da eliminare con candidate' });
    const cid = insertCompany('sopravvive', 'Sopravvive');
    await candidate(icp.id, cid);
    expect(await candidateOf(cid)).toHaveLength(1);

    expect((await send('DELETE', `/api/icps/${icp.id}`)).status).toBe(200);
    expect(await candidateOf(cid)).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) FROM icp_company_candidates WHERE icp_id = ?').pluck().get(icp.id)).toBe(0);
    expect((await send('GET', `/api/companies/${cid}`)).status).toBe(200);
  });
});
