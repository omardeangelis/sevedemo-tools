import { describe, expect, it } from 'vitest';

// API candidate e collegamenti (apollo-lookalike T11, SPEC E1–E6, F12). Import dinamici: la config
// (DB_PATH isolato da tests/setup.ts) è letta a import-time. Nessuna chiamata ad Apollo.
const { createApp } = await import('../src/server/app.js');
const { db } = await import('../src/db/index.js');
const { createIcp } = await import('../src/db/icps.js');
const { upsertCandidate } = await import('../src/db/candidates.js');
const { completeJob, insertJob } = await import('../src/db/jobs.js');
const { addMembers, createList } = await import('../src/db/lists.js');
const { addSource, upsertProspect } = await import('../src/db/prospects.js');

const app = createApp();
const PARTS = { keywords: 0.5, size: 1, location: 1 };
let seq = 0;

function send(method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
  });
}

const icp = (name = 'ICP') => createIcp({ name: `${name} ${++seq}` }).id;

/** Azienda solo-dominio inserita direttamente (l'API aziende è di T4b). */
function company(name: string, extra: { apolloJson?: object } = {}): number {
  const domain = `${name.toLowerCase().replace(/\W+/g, '')}-${++seq}.it`;
  return Number(
    db
      .prepare('INSERT INTO companies (domain, website, name, apollo_json) VALUES (?, ?, ?, ?)')
      .run(domain, `https://${domain}`, name, extra.apolloJson ? JSON.stringify(extra.apolloJson) : null).lastInsertRowid,
  );
}

function candidate(icpId: number, companyId: number, score = 0.5, reasons = ['stesso settore']) {
  return upsertCandidate({ icpId, companyId, score, parts: PARTS, reasons, jobId: null });
}

/** Fonte `apollo_people` di un prospect nuovo per l'azienda, con `captured_at` fissata. */
function apolloSource(companyId: number, at: string): number {
  const prospectId = upsertProspect({ linkedinUrl: `https://www.linkedin.com/in/contatto-${++seq}` }).id;
  const { id } = addSource(prospectId, { kind: 'apollo_people', companyId });
  db.prepare('UPDATE sources SET captured_at = ? WHERE id = ?').run(at, id);
  return prospectId;
}

async function json(res: Response, status = 200): Promise<Record<string, any>> {
  expect(res.status).toBe(status);
  return (await res.json()) as Record<string, any>;
}

describe('POST /api/icps/:id/candidates/bulk (tdd_target)', () => {
  it('per item: due candidate aggiornate, un id inesistente in failed', async () => {
    const icpId = icp();
    const [a, b] = [company('Alfa'), company('Bravo')];
    candidate(icpId, a);
    candidate(icpId, b);

    const res = await send('POST', `/api/icps/${icpId}/candidates/bulk`, { company_ids: [a, b, 999], status: 'accettata' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 2, failed: [{ company_id: 999, error: 'Candidata non trovata per questo ICP.' }] });
  });
});

describe('POST /api/icps/:id/candidates/bulk: validazione', () => {
  it('stato non valido, lista vuota, id non interi o campi extra → 400; ICP inesistente → 404; id ripetuti contano una volta', async () => {
    const icpId = icp();
    const a = company('Charlie');
    candidate(icpId, a);
    const bulk = (body: unknown, id = icpId) => send('POST', `/api/icps/${id}/candidates/bulk`, body);

    for (const body of [
      { company_ids: [a], status: 'vinta' },
      { company_ids: [], status: 'accettata' },
      { company_ids: [0], status: 'accettata' },
      { company_ids: ['1'], status: 'accettata' },
      { company_ids: Array.from({ length: 501 }, (_, i) => i + 1), status: 'accettata' },
      { company_ids: [a], status: 'accettata', extra: true },
    ]) {
      const body400 = await json(await bulk(body), 400);
      expect(body400).toMatchObject({ error: 'Dati non validi.', issues: expect.any(Array) });
    }
    expect(await json(await bulk({ company_ids: [a], status: 'accettata' }, 999_999), 404)).toEqual({ error: 'ICP non trovato.' });
    expect(await json(await bulk({ company_ids: [a, a], status: 'scartata' }))).toEqual({ updated: 1, failed: [] });
  });
});

describe('GET /api/icps/:id/candidates', () => {
  it('filtra per stato con conteggi, totale, last_contacts_at, campi Apollo e ultima ricerca', async () => {
    const icpId = icp();
    const acme = company('Acme', { apolloJson: { city: 'Milano', state: 'Lombardia', country: 'Italy', estimated_num_employees: 64 } });
    const beta = company('Beta');
    const gamma = company('Gamma');
    candidate(icpId, acme, 0.67, ['settore in comune', 'stessa città di Ref']);
    candidate(icpId, beta, 0.67);
    candidate(icpId, gamma, 0.82);
    await send('POST', `/api/icps/${icpId}/candidates/bulk`, { company_ids: [gamma], status: 'accettata' });
    apolloSource(acme, '2026-09-10T08:00:00.000Z');
    apolloSource(acme, '2026-09-15T08:00:00.000Z');

    const empty = await json(await send('GET', `/api/icps/${icpId}/candidates?status=scartata`));
    expect(empty).toEqual({ items: [], total: 0, counts: { proposta: 2, accettata: 1, scartata: 0 }, last_run: null });

    const proposte = await json(await send('GET', `/api/icps/${icpId}/candidates?status=proposta`));
    expect(proposte.total).toBe(2);
    expect(proposte.items.map((r: any) => r.name)).toEqual(['Acme', 'Beta']);
    expect(proposte.items[0]).toMatchObject({
      company_id: acme,
      name: 'Acme',
      domain: expect.stringMatching(/\.it$/),
      linkedin_url: null,
      website: expect.stringMatching(/^https:\/\//),
      apollo_city: 'Milano',
      apollo_state: 'Lombardia',
      apollo_country: 'Italy',
      apollo_employees: 64,
      score: 0.67,
      score_parts: PARTS,
      scoring_version: 'v1',
      reasons: ['settore in comune', 'stessa città di Ref'],
      status: 'proposta',
      created_at: expect.any(String),
      decided_at: null,
      last_contacts_at: '2026-09-15T08:00:00.000Z',
    });
    expect(proposte.items[1]).toMatchObject({ company_id: beta, apollo_city: null, apollo_employees: null, last_contacts_at: null });

    // Senza stato (o stato vuoto): tutte, per punteggio decrescente.
    for (const qs of ['', '?status=']) {
      const all = await json(await send('GET', `/api/icps/${icpId}/candidates${qs}`));
      expect(all.items.map((r: any) => r.name)).toEqual(['Gamma', 'Acme', 'Beta']);
      expect(all.total).toBe(3);
    }

    const job = insertJob('lookalike_companies', { icpId, pages: 1 });
    completeJob(job.id, { state: 'succeeded', result: { summary: 'ok', counts: { read: 100, new_candidates: 84, last_page: 1 } } });
    const withRun = await json(await send('GET', `/api/icps/${icpId}/candidates?status=accettata`));
    expect(withRun.last_run).toEqual({ at: expect.any(String), read: 100, new_candidates: 84 });
  });

  it('stato non valido → 400; ICP inesistente o id non valido → 404', async () => {
    const icpId = icp();
    expect(await json(await send('GET', `/api/icps/${icpId}/candidates?status=vinta`), 400)).toMatchObject({
      error: 'Parametri non validi.',
      issues: [expect.objectContaining({ path: 'status' })],
    });
    expect(await json(await send('GET', '/api/icps/999999/candidates'), 404)).toEqual({ error: 'ICP non trovato.' });
    expect((await send('GET', '/api/icps/abc/candidates')).status).toBe(404);
  });
});

describe('PATCH /api/icps/:id/candidates/:companyId', () => {
  it('scartata → decided_at; stesso stato → 200; Riproponi → proposta con decided_at aggiornata', async () => {
    const icpId = icp();
    const acme = company('Delta');
    candidate(icpId, acme, 0.58);
    const patch = (status: string) => send('PATCH', `/api/icps/${icpId}/candidates/${acme}`, { status });

    const discarded = await json(await patch('scartata'));
    expect(discarded).toMatchObject({ company_id: acme, name: 'Delta', status: 'scartata', score: 0.58, last_contacts_at: null });
    expect(discarded.decided_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const OLD = '2020-01-01T00:00:00.000Z';
    db.prepare('UPDATE icp_company_candidates SET decided_at = ? WHERE icp_id = ? AND company_id = ?').run(OLD, icpId, acme);
    const same = await json(await patch('scartata'));
    expect(same.status).toBe('scartata');
    expect(same.decided_at > OLD).toBe(true);

    db.prepare('UPDATE icp_company_candidates SET decided_at = ? WHERE icp_id = ? AND company_id = ?').run(OLD, icpId, acme);
    const reproposed = await json(await patch('proposta'));
    expect(reproposed.status).toBe('proposta');
    expect(reproposed.decided_at > OLD).toBe(true);
  });

  it('ICP o candidata inesistenti → 404; stato non valido o campi extra → 400', async () => {
    const icpId = icp();
    const other = icp('Altro');
    const acme = company('Echo');
    candidate(other, acme);

    expect(await json(await send('PATCH', `/api/icps/999999/candidates/${acme}`, { status: 'accettata' }), 404)).toEqual({ error: 'ICP non trovato.' });
    // Candidata di un altro ICP, azienda inesistente, id non valido.
    for (const id of [acme, 999_999]) {
      expect(await json(await send('PATCH', `/api/icps/${icpId}/candidates/${id}`, { status: 'accettata' }), 404)).toEqual({
        error: 'Candidata non trovata per questo ICP.',
      });
    }
    expect((await send('PATCH', `/api/icps/${icpId}/candidates/abc`, { status: 'accettata' })).status).toBe(404);
    expect((await send('PATCH', `/api/icps/${other}/candidates/${acme}`, { status: 'boh' })).status).toBe(400);
    expect((await send('PATCH', `/api/icps/${other}/candidates/${acme}`, { status: 'accettata', score: 1 })).status).toBe(400);
    expect((await send('PATCH', `/api/icps/${other}/candidates/${acme}`, {})).status).toBe(400);
  });
});

describe('dettaglio azienda: candidate-of e contacts-at', () => {
  it('candidate-of: una riga per ICP con stato, ordinate per nome ICP; nessuna → []; azienda inesistente → 404', async () => {
    const zeta = createIcp({ name: `Zeta ${++seq}` }).id;
    const alfa = createIcp({ name: `Alfa ${++seq}` }).id;
    const acme = company('Foxtrot');
    candidate(zeta, acme, 0.4);
    candidate(alfa, acme, 0.9);
    await send('PATCH', `/api/icps/${alfa}/candidates/${acme}`, { status: 'accettata' });

    const { items } = await json(await send('GET', `/api/companies/${acme}/candidate-of`));
    expect(items).toEqual([
      { icp_id: alfa, icp_name: expect.stringMatching(/^Alfa/), status: 'accettata', score: 0.9, decided_at: expect.any(String) },
      { icp_id: zeta, icp_name: expect.stringMatching(/^Zeta/), status: 'proposta', score: 0.4, decided_at: null },
    ]);
    expect(await json(await send('GET', `/api/companies/${company('Golf')}/candidate-of`))).toEqual({ items: [] });
    expect(await json(await send('GET', '/api/companies/999999/candidate-of'), 404)).toEqual({ error: 'Azienda non trovata.' });
  });

  it('contacts-at: null senza fonti, la data più recente con fonti, con listId solo i membri della lista', async () => {
    const icpId = icp();
    const list = createList({ icpId, name: 'Lista contatti' })!;
    const acme = company('Hotel');
    const at = async (qs = '') => json(await send('GET', `/api/companies/${acme}/contacts-at${qs}`));

    expect(await at()).toEqual({ last_contacts_at: null });
    const inList = apolloSource(acme, '2026-09-10T08:00:00.000Z');
    apolloSource(acme, '2026-09-15T08:00:00.000Z');
    addMembers(list.id, [inList]);

    expect(await at()).toEqual({ last_contacts_at: '2026-09-15T08:00:00.000Z' });
    expect(await at('?listId=')).toEqual({ last_contacts_at: '2026-09-15T08:00:00.000Z' });
    expect(await at(`?listId=${list.id}`)).toEqual({ last_contacts_at: '2026-09-10T08:00:00.000Z' });
    expect(await at('?listId=999999')).toEqual({ last_contacts_at: null });

    expect(await json(await send('GET', `/api/companies/${acme}/contacts-at?listId=abc`), 400)).toMatchObject({
      error: 'Parametri non validi.',
      issues: [expect.objectContaining({ path: 'listId' })],
    });
    expect(await json(await send('GET', '/api/companies/999999/contacts-at'), 404)).toEqual({ error: 'Azienda non trovata.' });
  });
});
