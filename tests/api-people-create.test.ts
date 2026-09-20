import { beforeEach, describe, expect, it } from 'vitest';

// Aggiungi persona (people-first-crm T5: C1–C11, E1, E2): creazione, doppioni, "Aggiungi l'incontro".
// Import dinamici: la config (DB_PATH isolato) è letta a import-time.
const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/server/app.js');
const { upsertProspect, addSource } = await import('../src/db/prospects.js');
const { createCompany } = await import('../src/db/companies.js');

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

function icpAndList(opts: { archived?: boolean } = {}): number {
  const icp = Number(db.prepare(`INSERT INTO icps (name) VALUES ('CTO startup')`).run().lastInsertRowid);
  return Number(
    db.prepare(`INSERT INTO lists (icp_id, name, archived_at) VALUES (?, 'Eventi autunno', ?)`).run(icp, opts.archived ? '2026-09-01T00:00:00.000Z' : null)
      .lastInsertRowid,
  );
}

const MEETING = { context: 'DevFest Milano: talk su Kubernetes', metOn: '2026-09-12' };

beforeEach(() => {
  db.exec('DELETE FROM prospects; DELETE FROM posts; DELETE FROM lists; DELETE FROM companies; DELETE FROM icps; DELETE FROM jobs;');
});

describe('POST /api/prospects: creazione a mano', () => {
  it('nome + sola email → 201: LinkedIn nullo, fonte manuale con met_on, nota del contesto datata all\'incontro, nessun job', async () => {
    const res = await send('POST', '/api/prospects', { fullName: 'Luca Bassi', email: 'luca@nuvola.io', meeting: MEETING });
    expect(res.status).toBe(201);
    const person = await json(res);
    expect(person).toMatchObject({ full_name: 'Luca Bassi', email: 'luca@nuvola.io', linkedin_url: null, status: 'nuovo' });
    expect(person.sources).toHaveLength(1);
    expect(person.sources[0]).toMatchObject({ kind: 'manual', met_on: '2026-09-12' });
    expect(person.timeline).toHaveLength(1);
    expect(person.timeline[0]).toMatchObject({
      kind: 'note',
      body: 'DevFest Milano: talk su Kubernetes',
      occurred_at: '2026-09-12T12:00:00.000Z',
      meta: { meeting: { met_on: '2026-09-12' } },
    });
    expect(Object.keys(person.manual_fields).sort()).toEqual(['email', 'full_name']);
    expect(db.prepare('SELECT COUNT(*) FROM jobs').pluck().get()).toBe(0);
  });

  it('lo stesso POST con un URL LinkedIn già presente → 409 linkedin_taken con la persona esistente, nulla creato', async () => {
    const marco = upsertProspect({ linkedinUrl: 'https://www.linkedin.com/in/marco-riva', fullName: 'Marco Riva', title: 'Head of Engineering' }).id;
    for (const url of ['https://www.linkedin.com/in/marco-riva/', 'http://linkedin.com/in/Marco-Riva', 'www.linkedin.com/in/marco-riva?trk=x']) {
      const res = await send('POST', '/api/prospects', { fullName: 'Marco R.', linkedinUrl: url, meeting: MEETING });
      expect(res.status).toBe(409);
      const body = await json(res);
      expect(body).toMatchObject({ code: 'linkedin_taken', prospect: { id: marco, full_name: 'Marco Riva', title: 'Head of Engineering' } });
    }
    expect(db.prepare('SELECT COUNT(*) FROM prospects').pluck().get()).toBe(1);
  });

  it('LinkedIn in forma id membro già noto come member_urn → 409', async () => {
    const urn = 'ACoAAFakeMember0001AbCdEfGhIjKl';
    const id = upsertProspect({ linkedinUrl: 'https://www.linkedin.com/in/anna-b', memberUrn: urn }).id;
    const res = await send('POST', '/api/prospects', { fullName: 'Anna', linkedinUrl: `https://www.linkedin.com/in/${urn}` });
    expect(res.status).toBe(409);
    expect((await json(res)).prospect.id).toBe(id);
  });

  it('tutti i campi: azienda collegata, stato iniziale con cambio di stato, lista, prossima azione, campi marcati a mano', async () => {
    const listId = icpAndList();
    const nuvola = createCompany({ name: 'Nuvola Srl', website: 'nuvola.io' });
    const res = await send('POST', '/api/prospects', {
      fullName: '  Luca Bassi ',
      title: 'CTO',
      companyId: nuvola.id,
      linkedinUrl: 'linkedin.com/in/Luca-Bassi/',
      phone: '+39 333 1234567',
      location: 'Milano',
      meeting: MEETING,
      listId,
      status: 'contattato',
      nextAction: { on: '2026-10-01', text: 'Proporre la call' },
    });
    expect(res.status).toBe(201);
    const p = await json(res);
    expect(p).toMatchObject({
      full_name: 'Luca Bassi',
      linkedin_url: 'https://www.linkedin.com/in/luca-bassi',
      company_id: nuvola.id,
      status: 'contattato',
      next_action_on: '2026-10-01',
      next_action_text: 'Proporre la call',
    });
    expect(p.memberships.map((m: any) => m.list_id)).toEqual([listId]);
    expect(p.timeline.map((a: any) => a.kind).sort()).toEqual(['note', 'status_change']);
    expect(p.timeline.find((a: any) => a.kind === 'status_change')).toMatchObject({ from_status: 'nuovo', to_status: 'contattato' });
    expect(Object.keys(p.manual_fields).sort()).toEqual(['company_id', 'full_name', 'location', 'phone', 'title']);
  });

  it('azienda solo testo e nessun contesto: niente nota; data dell\'incontro di default = oggi', async () => {
    const p = await json(await send('POST', '/api/prospects', { fullName: 'Sara Conti', companyName: 'Pagamenti Srl', phone: '0212345' }));
    expect(p).toMatchObject({ company_id: null, company_name: 'Pagamenti Srl' });
    expect(p.timeline).toEqual([]);
    expect(p.sources[0].met_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('errori di C3 con issues per campo; testo della prossima azione senza data', async () => {
    const cases: Array<[Record<string, unknown>, string, RegExp]> = [
      [{ email: 'a@b.it' }, 'fullName', /Inserisci il nome/],
      [{ fullName: '   ', email: 'a@b.it' }, 'fullName', /Inserisci il nome/],
      [{ fullName: 'X' }, 'contacts', /Serve almeno un recapito: profilo LinkedIn, email o telefono/],
      [{ fullName: 'X', linkedinUrl: 'https://www.linkedin.com/company/acme' }, 'linkedinUrl', /Non è il profilo di una persona/],
      [{ fullName: 'X', linkedinUrl: 'https://example.com/in/x' }, 'linkedinUrl', /Non è il profilo di una persona/],
      [{ fullName: 'X', email: 'non-una-email' }, 'email', /Email non valida \(es\. nome@azienda\.it\)/],
      [{ fullName: 'X', email: 'a@b.it', nextAction: { text: 'Richiamare' } }, 'nextAction.on', /Scegli la data della prossima azione/],
      [{ fullName: 'X', email: 'a@b.it', meeting: { metOn: '2026-02-30' } }, 'meeting.metOn', /Data non valida/],
    ];
    for (const [body, path, message] of cases) {
      const res = await send('POST', '/api/prospects', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      const err = await json(res);
      expect(err.issues, JSON.stringify(body)).toContainEqual({ path, message: expect.stringMatching(message) });
    }
    expect(db.prepare('SELECT COUNT(*) FROM prospects').pluck().get()).toBe(0);
  });

  it('email già usata (senza maiuscole, con spazi) → 409 email_taken con le persone; createAnyway → 201', async () => {
    const anna = upsertProspect({ linkedinUrl: 'https://www.linkedin.com/in/anna', fullName: 'Anna Bianchi', email: 'Info@Beta.it' }).id;
    const ufficio = upsertProspect({ linkedinUrl: 'https://www.linkedin.com/in/ufficio', fullName: 'Ufficio Beta', email: ' info@beta.it' }).id;
    const res = await send('POST', '/api/prospects', { fullName: 'Nuova', email: 'info@beta.it ' });
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.code).toBe('email_taken');
    expect(body.prospects.map((p: any) => p.id).sort()).toEqual([anna, ufficio].sort());

    const again = await send('POST', '/api/prospects', { fullName: 'Nuova', email: 'info@beta.it', createAnyway: true });
    expect(again.status).toBe(201);
  });

  it('lista archiviata → 400 list_archived; azienda sparita → 404 company_not_found', async () => {
    const archived = icpAndList({ archived: true });
    const res = await send('POST', '/api/prospects', { fullName: 'X', email: 'x@y.it', listId: archived });
    expect(res.status).toBe(400);
    expect(await json(res)).toMatchObject({ code: 'list_archived', error: "La lista 'Eventi autunno' è archiviata: scegline un'altra." });
    const gone = await send('POST', '/api/prospects', { fullName: 'X', email: 'x@y.it', companyId: 999_999 });
    expect(gone.status).toBe(404);
    expect(await json(gone)).toMatchObject({ code: 'company_not_found' });
    expect(db.prepare('SELECT COUNT(*) FROM prospects').pluck().get()).toBe(0);
  });
});

describe('GET /api/prospects/duplicates', () => {
  it('LinkedIn, email e nome (senza LinkedIn o email in comune), con il riepilogo della persona', async () => {
    const acme = createCompany({ name: 'Beta', website: 'beta.io' });
    const post = Number(db.prepare(`INSERT INTO posts (post_url) VALUES ('https://www.linkedin.com/posts/p-1')`).run().lastInsertRowid);
    const marco = upsertProspect({ linkedinUrl: 'https://www.linkedin.com/in/marco-riva', fullName: 'Marco Riva', title: 'Head of Engineering', companyId: acme.id }).id;
    addSource(marco, { kind: 'post_comment', postId: post, commentText: 'ciao' });
    const sara = Number(db.prepare(`INSERT INTO prospects (full_name, title, company_name, phone) VALUES ('Sara  Conti', 'CFO', 'Pagamenti Srl', '02')`).run().lastInsertRowid);
    const saraLinked = upsertProspect({ linkedinUrl: 'https://www.linkedin.com/in/sara-conti', fullName: 'sara conti', email: 'sara@x.it' }).id;

    const q = new URLSearchParams({ linkedinUrl: 'linkedin.com/in/Marco-Riva/', email: 'SARA@x.it', name: ' Sara Conti ' });
    const res = await json(await send('GET', `/api/prospects/duplicates?${q}`));
    expect(res.linkedin).toMatchObject({
      id: marco,
      full_name: 'Marco Riva',
      title: 'Head of Engineering',
      company_name: 'Beta',
      first_source: { kind: 'post_comment', label: 'commento' },
    });
    expect(res.email.map((p: any) => p.id)).toEqual([saraLinked]);
    // Stesso nome ma con l'email in comune: già tra i doppioni per email, non ripetuto per nome.
    expect(res.name.map((p: any) => p.id)).toEqual([sara]);

    const none = await json(await send('GET', `/api/prospects/duplicates?name=Sara%20Conti&excludeId=${sara}`));
    expect(none.name.map((p: any) => p.id)).toEqual([saraLinked]);
    expect(await json(await send('GET', '/api/prospects/duplicates'))).toEqual({ linkedin: null, email: [], name: [] });
  });
});

describe('POST /api/prospects/:id/meetings ("Aggiungi l\'incontro", C9)', () => {
  it('fonte manuale se manca, nota, lista, prossima azione sostituita; data di aggiunta invariata', async () => {
    const listId = icpAndList();
    const marco = upsertProspect({ linkedinUrl: 'https://www.linkedin.com/in/marco-riva', fullName: 'Marco Riva' }).id;
    await send('PUT', `/api/prospects/${marco}/next-action`, { on: '2026-09-25', text: 'Richiamare' });
    const createdAt = (await json(await send('GET', `/api/prospects/${marco}`))).created_at;

    const res = await send('POST', `/api/prospects/${marco}/meetings`, { ...MEETING, listId, nextAction: { on: '2026-10-01', text: 'Proporre la call' } });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toMatchObject({ replaced_next_action: true, source_created: true });
    expect(body.prospect).toMatchObject({ id: marco, next_action_on: '2026-10-01', created_at: createdAt, status: 'nuovo' });
    expect(body.prospect.sources.map((s: any) => [s.kind, s.met_on])).toEqual([['manual', '2026-09-12']]);
    expect(body.prospect.memberships.map((m: any) => m.list_id)).toEqual([listId]);

    // Secondo incontro: la fonte resta con la sua data, arriva una seconda nota.
    const second = await json(await send('POST', `/api/prospects/${marco}/meetings`, { context: 'Meetup Go', metOn: '2026-09-15' }));
    expect(second).toMatchObject({ replaced_next_action: false, source_created: false });
    expect(second.prospect.sources.map((s: any) => s.met_on)).toEqual(['2026-09-12']);
    expect(second.prospect.timeline.filter((a: any) => a.kind === 'note').map((a: any) => a.body)).toEqual(['Meetup Go', MEETING.context]);
  });

  it('persona sparita → 404 prospect_not_found; lista archiviata → 400', async () => {
    const res = await send('POST', '/api/prospects/999999/meetings', MEETING);
    expect(res.status).toBe(404);
    expect(await json(res)).toMatchObject({ code: 'prospect_not_found' });
    const id = upsertProspect({ linkedinUrl: 'https://www.linkedin.com/in/x' }).id;
    const archived = icpAndList({ archived: true });
    expect((await send('POST', `/api/prospects/${id}/meetings`, { ...MEETING, listId: archived })).status).toBe(400);
  });
});
