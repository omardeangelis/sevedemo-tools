import { beforeEach, describe, expect, it } from 'vitest';

// Scritture manuali sulla persona (people-first-crm T3): campi "a mano" (D8), azienda collegata (D1–D5),
// prossima azione (G1, G6). Import dinamici: la config (DB_PATH isolato) è letta a import-time.
const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/server/app.js');
const { upsertProspect, addSource } = await import('../src/db/prospects.js');
const { createCompany } = await import('../src/db/companies.js');
const { mergeCompanies } = await import('../src/db/company-identity.js');

const app = createApp();

function send(method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function json<T = any>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

let seq = 0;
function person(fields: Partial<Parameters<typeof upsertProspect>[0]> = {}): number {
  seq += 1;
  return upsertProspect({ linkedinUrl: `https://www.linkedin.com/in/manuale-${seq}`, fullName: `Persona ${seq}`, ...fields }).id;
}
/** Persona senza LinkedIn (come la creerà il form di T5): inserimento diretto. */
function withoutLinkedin(fields: { email?: string | null; phone?: string | null }): number {
  return Number(
    db.prepare(`INSERT INTO prospects (full_name, email, phone) VALUES ('Senza LinkedIn', ?, ?)`).run(fields.email ?? null, fields.phone ?? null)
      .lastInsertRowid,
  );
}

beforeEach(() => {
  db.exec('DELETE FROM prospects; DELETE FROM posts; DELETE FROM lists; DELETE FROM companies; DELETE FROM icps;');
});

describe('azienda collegata (D1–D5)', () => {
  it('PUT azienda → la persona compare tra le persone di quell\'azienda, chi ha solo la fonte no; collegamento marcato a mano', async () => {
    const acme = createCompany({ name: 'Acme', website: 'acme.it' });
    const linked = person({ fullName: 'Mario Rossi', companyName: 'Acme Srl' });
    const onlySource = person({ fullName: 'Solo fonte' });
    addSource(onlySource, { kind: 'company_employees', companyId: acme.id });

    const res = await send('PUT', `/api/prospects/${linked}/company`, { companyId: acme.id });
    expect(res.status).toBe(200);
    const detail = await json(res);
    expect(detail.company_id).toBe(acme.id);
    expect(detail.manual_fields.company_id).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const page = await json(await send('GET', `/api/prospects?companyId=${acme.id}`));
    expect(page.items.map((r: any) => r.id)).toEqual([linked]);
    expect(page.total).toBe(1);
  });

  it('Cambia e Scollega: lo scollegamento conserva il nome come testo e resta "a mano"; le fonti non cambiano', async () => {
    const acme = createCompany({ name: 'Acme', website: 'acme.it' });
    const beta = createCompany({ name: 'Beta', website: 'beta.io' });
    const id = person();
    addSource(id, { kind: 'company_employees', companyId: acme.id });
    await send('PUT', `/api/prospects/${id}/company`, { companyId: acme.id });
    expect((await json(await send('PUT', `/api/prospects/${id}/company`, { companyId: beta.id }))).company_id).toBe(beta.id);

    const res = await send('DELETE', `/api/prospects/${id}/company`);
    expect(res.status).toBe(200);
    const detail = await json(res);
    expect(detail.company_id).toBeNull();
    expect(detail.company_name).toBe('Beta');
    expect(detail.manual_fields.company_id).toBeTypeOf('string');
    expect(detail.sources.map((s: any) => s.kind)).toEqual(['company_employees']);
    expect((await json(await send('GET', `/api/prospects?companyId=${beta.id}`))).total).toBe(0);
  });

  it('azienda inesistente o unita → 404 company_not_found; persona inesistente → 404', async () => {
    const id = person();
    const keep = createCompany({ name: 'Acme', website: 'acme.it' });
    const drop = createCompany({ name: 'Acme Italia', linkedin_url: 'https://www.linkedin.com/company/acme-italia' });
    mergeCompanies(keep.id, drop.id);

    for (const companyId of [999_999, drop.id]) {
      const res = await send('PUT', `/api/prospects/${id}/company`, { companyId });
      expect(res.status).toBe(404);
      expect(await json(res)).toMatchObject({ code: 'company_not_found', error: "Azienda non trovata: forse è stata unita a un'altra." });
    }
    expect((await send('PUT', '/api/prospects/999999/company', { companyId: keep.id })).status).toBe(404);
    expect((await send('DELETE', '/api/prospects/999999/company')).status).toBe(404);
  });
});

describe('anagrafica "a mano" (D8, E4)', () => {
  it('PATCH marca ogni campo presente nel body, anche svuotato; i campi assenti restano non marcati', async () => {
    const id = person({ title: 'CTO', email: 'vecchia@acme.it' });
    const res = await send('PATCH', `/api/prospects/${id}`, { title: 'Head of Engineering', email: '' });
    expect(res.status).toBe(200);
    const detail = await json(res);
    expect(detail.title).toBe('Head of Engineering');
    expect(detail.email).toBeNull();
    expect(Object.keys(detail.manual_fields).sort()).toEqual(['email', 'title']);
  });

  it('senza LinkedIn non si svuotano insieme email e telefono (400 contact_required); uno solo sì', async () => {
    const id = withoutLinkedin({ email: 'a@b.it', phone: '+39 333 1234567' });
    const both = await send('PATCH', `/api/prospects/${id}`, { email: '', phone: null });
    expect(both.status).toBe(400);
    expect(await json(both)).toMatchObject({
      code: 'contact_required',
      error: 'Serve almeno un recapito: senza profilo LinkedIn tieni l\'email o il telefono.',
    });
    expect((await json(await send('GET', `/api/prospects/${id}`))).email).toBe('a@b.it');

    expect((await send('PATCH', `/api/prospects/${id}`, { email: '' })).status).toBe(200);
    expect((await send('PATCH', `/api/prospects/${id}`, { phone: '' })).status).toBe(400);
  });
});

describe('prossima azione (G1, G3, G6)', () => {
  it('imposta, modifica e rimuove: stato e liste invariati, nessun cambio di stato in timeline', async () => {
    const id = person();
    const set = await send('PUT', `/api/prospects/${id}/next-action`, { on: '2026-10-01', text: 'Proporre la call' });
    expect(set.status).toBe(200);
    const first = await json(set);
    expect(first).toMatchObject({ next_action_on: '2026-10-01', next_action_text: 'Proporre la call', status: 'nuovo' });
    expect(first.next_action_set_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const edited = await json(await send('PUT', `/api/prospects/${id}/next-action`, { on: '2026-09-25', text: '  ' }));
    expect(edited).toMatchObject({ next_action_on: '2026-09-25', next_action_text: null });

    const removed = await send('DELETE', `/api/prospects/${id}/next-action`);
    expect(removed.status).toBe(200);
    expect(await json(removed)).toMatchObject({ next_action_on: null, next_action_text: null, next_action_set_at: null, status: 'nuovo' });
    expect((await json(await send('GET', `/api/prospects/${id}`))).timeline).toEqual([]);
  });

  it('senza data → 400 next_action_date_required; data invalida → 400; persona inesistente → 404', async () => {
    const id = person();
    const noDate = await send('PUT', `/api/prospects/${id}/next-action`, { text: 'Richiamare' });
    expect(noDate.status).toBe(400);
    expect(await json(noDate)).toMatchObject({ code: 'next_action_date_required', error: 'Scegli la data della prossima azione.' });
    expect((await send('PUT', `/api/prospects/${id}/next-action`, { on: '2026-13-40' })).status).toBe(400);
    expect((await send('PUT', `/api/prospects/${id}/next-action`, { on: '1/10/2026' })).status).toBe(400);
    expect((await send('PUT', '/api/prospects/999999/next-action', { on: '2026-10-01' })).status).toBe(404);
    expect((await send('DELETE', '/api/prospects/999999/next-action')).status).toBe(404);
  });
});
