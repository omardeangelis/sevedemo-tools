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
  it('POST /api/companies → 201 con URL normalizzato; lo stesso URL scritto diversamente → 409 `company_exists`', async () => {
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
    expect(body).toEqual({
      error: "Questo URL LinkedIn è già di 'Acme'.",
      code: 'company_exists',
      company_id: company.id,
      company_name: 'Acme',
      key: 'linkedin_url',
    });
    expect((db.prepare(`SELECT COUNT(*) AS n FROM companies`).get() as { n: number }).n).toBe(1);
  });

  it('URL non LinkedIn o non /company/ → 400 invalid_company_url; senza chiavi → 400 company_keys_missing; nulla creato', async () => {
    for (const bad of ['https://acme.it', 'https://www.linkedin.com/in/mario', 'https://www.linkedin.com/company/']) {
      const res = await send('POST', '/api/companies', { linkedin_url: bad });
      expect(res.status, bad).toBe(400);
      expect(await res.json()).toEqual({
        error: 'Inserisci un URL del tipo linkedin.com/company/<nome>',
        code: 'invalid_company_url',
      });
    }
    for (const empty of [{ name: 'Senza URL' }, { linkedin_url: '', website: ' ' }, { linkedin_url: null }]) {
      const res = await send('POST', '/api/companies', empty);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Serve almeno l'URL LinkedIn o il sito web", code: 'company_keys_missing' });
    }
    // Un sito su una piattaforma condivisa non è un dominio (SPEC B2): lo si dice.
    const shared = await send('POST', '/api/companies', { website: 'https://acme.wixsite.com/home' });
    expect(shared.status).toBe(400);
    expect(await shared.json()).toEqual({
      error: "Il sito web indicato non ha un dominio proprio: serve almeno l'URL LinkedIn o il sito web",
      code: 'company_keys_missing',
    });
    expect((db.prepare(`SELECT COUNT(*) AS n FROM companies`).get() as { n: number }).n).toBe(1);
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

  it('PATCH /api/companies/:id: campi parziali; URL di un\'altra azienda → 409 `company_exists`; URL non valido → 400', async () => {
    const a = (await (await send('POST', '/api/companies', { linkedin_url: 'linkedin.com/company/initech' })).json()) as Record<string, any>;
    const b = (await (await send('POST', '/api/companies', { linkedin_url: 'linkedin.com/company/umbrella' })).json()) as Record<string, any>;

    const res = await send('PATCH', `/api/companies/${a.id}`, { name: 'Initech', website: 'https://initech.example', notes: '' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: 'Initech', website: 'https://initech.example', notes: null, reference_of: [] });

    const same = await send('PATCH', `/api/companies/${a.id}`, { linkedin_url: 'https://www.linkedin.com/company/Initech/' });
    expect(same.status).toBe(200);

    const dup = await send('PATCH', `/api/companies/${a.id}`, { linkedin_url: 'linkedin.com/company/umbrella' });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ code: 'company_exists', company_id: b.id, company_name: 'umbrella', key: 'linkedin_url' });

    expect((await send('PATCH', `/api/companies/${a.id}`, { linkedin_url: 'https://initech.example' })).status).toBe(400);
    expect((await send('PATCH', '/api/companies/999999', { name: 'X' })).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// apollo-lookalike T4b: doppia chiave (URL LinkedIn | dominio), 409 `company_exists`, unione esplicita.
// ---------------------------------------------------------------------------

describe('API Aziende a doppia chiave', () => {
  const countCompanies = () => (db.prepare(`SELECT COUNT(*) AS n FROM companies`).get() as { n: number }).n;
  const json = async (res: Response) => (await res.json()) as Record<string, any>;

  it('POST {website} → 201 con il dominio (nome = dominio, senza URL); ripetuto → 409 `company_exists`, nulla creato', async () => {
    const res = await send('POST', '/api/companies', { website: 'https://www.acme.it' });
    expect(res.status).toBe(201);
    const company = await json(res);
    expect(company).toMatchObject({
      domain: 'acme.it',
      name: 'acme.it',
      linkedin_url: null,
      website: 'https://www.acme.it',
      apollo_org_id: null,
      apollo_enriched_at: null,
      reference_of: [],
      prospects_count: 0,
    });
    // La risposta Apollo grezza resta sul server.
    expect(company).not.toHaveProperty('apollo_json');

    const before = countCompanies();
    const dup = await send('POST', '/api/companies', { website: 'acme.it' });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toEqual({
      error: "Il dominio acme.it è già di 'acme.it'.",
      code: 'company_exists',
      company_id: company.id,
      company_name: 'acme.it',
      key: 'domain',
    });
    // URL nuovo ma dominio altrui: nessuna scrittura.
    const both = await send('POST', '/api/companies', { linkedin_url: 'linkedin.com/company/acme-nuova', website: 'acme.it/contatti' });
    expect(both.status).toBe(409);
    expect(await both.json()).toMatchObject({ code: 'company_exists', company_id: company.id, key: 'domain' });
    expect(countCompanies()).toBe(before);
  });

  it('GET ?q= cerca anche per dominio; lista e dettaglio con dominio e campi Apollo, senza `apollo_json`', async () => {
    const created = await json(await send('POST', '/api/companies', { linkedin_url: 'linkedin.com/company/dominiotest', website: 'shop.dominiotest.com' }));
    db.prepare(`UPDATE companies SET apollo_org_id = 'org-1', apollo_json = '{"id":"org-1"}', apollo_enriched_at = '2026-09-16T10:00:00.000Z' WHERE id = ?`).run(created.id);

    const { items } = await json(await send('GET', '/api/companies?q=shop.dominiotest'));
    expect(items.map((i: any) => i.id)).toEqual([created.id]);
    expect(items[0]).not.toHaveProperty('apollo_json');

    const detail = await json(await send('GET', `/api/companies/${created.id}`));
    expect(detail).toMatchObject({
      domain: 'shop.dominiotest.com',
      linkedin_url: 'https://www.linkedin.com/company/dominiotest',
      apollo_org_id: 'org-1',
      apollo_enriched_at: '2026-09-16T10:00:00.000Z',
    });
    expect(detail).not.toHaveProperty('apollo_json');
  });

  it('PATCH chiavi: togliere una chiave ok, entrambe vuote → 400 `company_keys_missing`, chiave altrui → 409; nessuna scrittura sugli errori', async () => {
    const a = await json(await send('POST', '/api/companies', { linkedin_url: 'linkedin.com/company/patch-a', website: 'https://patch-a.it' }));
    const b = await json(await send('POST', '/api/companies', { linkedin_url: 'linkedin.com/company/patch-b', website: 'patch-b.it', name: 'Patch B' }));
    const row = (id: number) => db.prepare(`SELECT name, linkedin_url, website, domain FROM companies WHERE id = ?`).get(id);

    // Entrambe vuote in un colpo solo.
    const both = await send('PATCH', `/api/companies/${a.id}`, { linkedin_url: '', website: null, name: 'Mai scritto' });
    expect(both.status).toBe(400);
    expect(await both.json()).toEqual({ error: "Serve almeno l'URL LinkedIn o il sito web", code: 'company_keys_missing' });
    expect(row(a.id)).toEqual({ name: 'patch-a', linkedin_url: 'https://www.linkedin.com/company/patch-a', website: 'https://patch-a.it', domain: 'patch-a.it' });

    // Via l'URL: resta il dominio.
    const noUrl = await send('PATCH', `/api/companies/${a.id}`, { linkedin_url: '' });
    expect(noUrl.status).toBe(200);
    expect(await noUrl.json()).toMatchObject({ linkedin_url: null, domain: 'patch-a.it' });

    // Poi via anche il sito: l'ultima chiave non si toglie.
    const lastKey = await send('PATCH', `/api/companies/${a.id}`, { website: '' });
    expect(lastKey.status).toBe(400);
    expect((await json(lastKey)).code).toBe('company_keys_missing');
    expect(row(a.id)).toMatchObject({ website: 'https://patch-a.it', domain: 'patch-a.it' });

    // Sito con il dominio di B → 409 sul dominio.
    const takenDomain = await send('PATCH', `/api/companies/${a.id}`, { website: 'https://www.patch-b.it/chi-siamo', name: 'Mai scritto' });
    expect(takenDomain.status).toBe(409);
    expect(await takenDomain.json()).toEqual({
      error: "Il dominio patch-b.it è già di 'Patch B'.",
      code: 'company_exists',
      company_id: b.id,
      company_name: 'Patch B',
      key: 'domain',
    });

    // URL di B → 409 sull'URL.
    const takenUrl = await send('PATCH', `/api/companies/${a.id}`, { linkedin_url: 'https://it.linkedin.com/company/Patch-B/', name: 'Mai scritto' });
    expect(takenUrl.status).toBe(409);
    expect(await takenUrl.json()).toMatchObject({ code: 'company_exists', company_id: b.id, company_name: 'Patch B', key: 'linkedin_url' });
    expect(row(a.id)).toEqual({ name: 'patch-a', linkedin_url: null, website: 'https://patch-a.it', domain: 'patch-a.it' });

    // Aggiungere l'URL libero sblocca: torna con entrambe le chiavi.
    const relink = await send('PATCH', `/api/companies/${a.id}`, { linkedin_url: 'linkedin.com/company/patch-a-srl' });
    expect(relink.status).toBe(200);
    expect(await relink.json()).toMatchObject({ linkedin_url: 'https://www.linkedin.com/company/patch-a-srl', domain: 'patch-a.it' });
  });

  it('merge: preview (chiave scartata, note, righe che passano) → POST sposta riferimenti, candidature, prospect e fonti; l\'assorbita → 404', async () => {
    // Superstite con URL e dominio; assorbita solo-dominio con note e relazioni.
    const keep = await json(await send('POST', '/api/companies', { linkedin_url: 'linkedin.com/company/acme-robotica', website: 'acme-robotica.it', name: 'Acme Robotica', notes: 'Cliente storico' }));
    const drop = await json(await send('POST', '/api/companies', { website: 'acme-old.it', notes: 'Vecchio sito' }));

    const icp = (name: string) => Number(db.prepare(`INSERT INTO icps (name) VALUES (?)`).run(name).lastInsertRowid);
    const [icpOnlyDrop, icpBoth, icpCandDecided, icpCandKeepDecided, icpRefVsCand] = ['M1', 'M2', 'M3', 'M4', 'M5'].map(icp);
    const ref = db.prepare(`INSERT INTO icp_reference_companies (icp_id, company_id) VALUES (?, ?)`);
    ref.run(icpOnlyDrop, drop.id); // passa
    ref.run(icpBoth, drop.id); // resta quello della superstite
    ref.run(icpBoth, keep.id);
    ref.run(icpRefVsCand, keep.id); // la referenza vince sulla candidatura dell'assorbita
    const cand = db.prepare(`INSERT INTO icp_company_candidates (icp_id, company_id, status) VALUES (?, ?, ?)`);
    cand.run(icpCandDecided, drop.id, 'accettata'); // vince sulla proposta della superstite: passa
    cand.run(icpCandDecided, keep.id, 'proposta');
    cand.run(icpCandKeepDecided, drop.id, 'accettata'); // a parità (entrambe decise) vince la superstite
    cand.run(icpCandKeepDecided, keep.id, 'scartata');
    cand.run(icpRefVsCand, drop.id, 'proposta');

    const prospect = db.prepare(`INSERT INTO prospects (linkedin_url, company_id) VALUES (?, ?)`);
    const p1 = Number(prospect.run('https://www.linkedin.com/in/merge-p1', drop.id).lastInsertRowid);
    const p2 = Number(prospect.run('https://www.linkedin.com/in/merge-p2', drop.id).lastInsertRowid);
    const p3 = Number(prospect.run('https://www.linkedin.com/in/merge-p3', keep.id).lastInsertRowid);
    const source = db.prepare(`INSERT INTO sources (prospect_id, kind, company_id, captured_at) VALUES (?, ?, ?, ?)`);
    source.run(p1, 'company_employees', drop.id, '2026-09-10T00:00:00.000Z'); // passa
    source.run(p3, 'company_employees', drop.id, '2026-09-12T00:00:00.000Z'); // più recente di quella della superstite: passa
    source.run(p3, 'company_employees', keep.id, '2026-09-11T00:00:00.000Z');
    source.run(p2, 'apollo_people', drop.id, '2026-09-10T00:00:00.000Z'); // più vecchia: cade
    source.run(p2, 'apollo_people', keep.id, '2026-09-15T00:00:00.000Z');

    const preview = await send('GET', `/api/companies/${drop.id}/merge/preview?into=${keep.id}`);
    expect(preview.status).toBe(200);
    expect(await preview.json()).toEqual({
      loses: { domain: 'acme-old.it', notes: 'Vecchio sito' },
      absorbed: { references: 1, candidates: 1, prospects: 2, sources: 2 },
    });
    // La preview non scrive nulla.
    expect((await send('GET', `/api/companies/${drop.id}`)).status).toBe(200);

    // Errori: stessa azienda, `into` mancante/inesistente, `:id` inesistente.
    const same = await send('POST', `/api/companies/${keep.id}/merge`, { into: keep.id });
    expect(same.status).toBe(400);
    expect((await json(same)).code).toBe('merge_same_company');
    expect((await send('GET', `/api/companies/${keep.id}/merge/preview?into=${keep.id}`)).status).toBe(400);
    expect((await send('GET', `/api/companies/${drop.id}/merge/preview`)).status).toBe(400);
    expect((await send('POST', `/api/companies/${drop.id}/merge`, {})).status).toBe(400);
    expect((await send('GET', `/api/companies/${drop.id}/merge/preview?into=999999`)).status).toBe(404);
    expect((await send('POST', `/api/companies/${drop.id}/merge`, { into: 999999 })).status).toBe(404);
    expect((await send('POST', `/api/companies/999999/merge`, { into: keep.id })).status).toBe(404);

    const merged = await send('POST', `/api/companies/${drop.id}/merge`, { into: keep.id });
    expect(merged.status).toBe(200);
    const { company } = await json(merged);
    expect(company).toMatchObject({
      id: keep.id,
      name: 'Acme Robotica',
      linkedin_url: 'https://www.linkedin.com/company/acme-robotica',
      domain: 'acme-robotica.it',
      notes: 'Cliente storico\n\nVecchio sito',
      prospects_count: 3,
    });
    expect(company.reference_of.map((r: any) => r.icp_id).sort()).toEqual([icpOnlyDrop, icpBoth, icpRefVsCand].sort());
    expect(company).not.toHaveProperty('apollo_json');
    expect((await send('GET', `/api/companies/${drop.id}`)).status).toBe(404);

    const candidates = db.prepare(`SELECT icp_id, status FROM icp_company_candidates WHERE company_id = ? ORDER BY icp_id`).all(keep.id);
    expect(candidates).toEqual([
      { icp_id: icpCandDecided, status: 'accettata' },
      { icp_id: icpCandKeepDecided, status: 'scartata' },
    ]);
    const sources = db.prepare(`SELECT prospect_id, kind, captured_at FROM sources WHERE company_id = ? ORDER BY prospect_id, kind`).all(keep.id);
    expect(sources).toEqual([
      { prospect_id: p1, kind: 'company_employees', captured_at: '2026-09-10T00:00:00.000Z' },
      { prospect_id: p2, kind: 'apollo_people', captured_at: '2026-09-15T00:00:00.000Z' },
      { prospect_id: p3, kind: 'company_employees', captured_at: '2026-09-12T00:00:00.000Z' },
    ]);

    // Due URL LinkedIn diversi: la chiave dell'assorbita è scartata.
    const x = await json(await send('POST', '/api/companies', { linkedin_url: 'linkedin.com/company/merge-x' }));
    const y = await json(await send('POST', '/api/companies', { linkedin_url: 'linkedin.com/company/merge-y', website: 'merge-y.it' }));
    expect(await (await send('GET', `/api/companies/${y.id}/merge/preview?into=${x.id}`)).json()).toEqual({
      loses: { linkedin_url: 'https://www.linkedin.com/company/merge-y' },
      absorbed: { references: 0, candidates: 0, prospects: 0, sources: 0 },
    });
    const xy = await json(await send('POST', `/api/companies/${y.id}/merge`, { into: x.id }));
    expect(xy.company).toMatchObject({ id: x.id, linkedin_url: 'https://www.linkedin.com/company/merge-x', domain: 'merge-y.it' });
  });
});
