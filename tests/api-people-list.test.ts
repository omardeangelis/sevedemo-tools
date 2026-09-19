import { beforeEach, describe, expect, it } from 'vitest';

// Persone: viste, filtri, ordinamenti, conteggi (people-first-crm T8: B1–B8). Import dinamici: la config
// (DB_PATH isolato) è letta a import-time.
const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/server/app.js');
const { upsertProspect, addSource } = await import('../src/db/prospects.js');
const { createPerson, linkCompany } = await import('../src/db/people.js');
const { createCompany } = await import('../src/db/companies.js');
const { changeStatus } = await import('../src/db/activities.js');
const { setNextAction } = await import('../src/db/next-actions.js');

const app = createApp();

async function get(path: string) {
  const res = await app.request(path);
  return { status: res.status, body: (await res.json()) as any };
}
const ids = (body: any) => body.items.map((r: any) => r.id);

function manual(fields: Parameters<typeof createPerson>[0]): number {
  const r = createPerson(fields);
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.id;
}

beforeEach(() => {
  db.exec('DELETE FROM prospects; DELETE FROM posts; DELETE FROM lists; DELETE FROM companies; DELETE FROM icps;');
});

describe('viste (B1–B3) e conteggi', () => {
  it('Da smistare = dai job, senza liste, non scartata; view-counts; q=devfest trova il contesto dell\'incontro', async () => {
    const post = Number(db.prepare(`INSERT INTO posts (post_url) VALUES ('https://www.linkedin.com/posts/p-1')`).run().lastInsertRowid);
    const fromJobs = upsertProspect({ linkedinUrl: 'https://www.linkedin.com/in/dai-job', fullName: 'Dai Job' }).id;
    addSource(fromJobs, { kind: 'post_reaction', postId: post, reactionType: 'LIKE' });
    const byHand = manual({ fullName: 'Luca Bassi', email: 'luca@x.it', meeting: { context: 'Conosciuto al DevFest Milano', metOn: '2026-09-12' } });
    const discarded = upsertProspect({ linkedinUrl: 'https://www.linkedin.com/in/scartata', fullName: 'Scartata' }).id;
    changeStatus(discarded, 'scartato');

    expect(ids((await get('/api/prospects?view=da_smistare')).body)).toEqual([fromJobs]);
    expect((await get('/api/prospects/view-counts')).body).toEqual({ tutte: 2, da_smistare: 1, con_prossima_azione: 0, scartate: 1 });
    expect(ids((await get('/api/prospects?view=tutte&q=devfest')).body)).toEqual([byHand]);
    expect(ids((await get('/api/prospects?view=scartate')).body)).toEqual([discarded]);
    expect(ids((await get('/api/prospects?view=tutte&sort=name')).body)).toEqual([fromJobs, byHand]);
    // L'alias storico dell'Inbox è la vista Da smistare.
    expect(ids((await get('/api/inbox')).body)).toEqual([fromJobs]);
  });

  it('i conteggi seguono gli altri filtri (B6: scartate con lo stesso testo)', async () => {
    upsertProspect({ linkedinUrl: 'https://www.linkedin.com/in/giulia', fullName: 'Giulia Neri' });
    const gv = upsertProspect({ linkedinUrl: 'https://www.linkedin.com/in/giulia-v', fullName: 'Giulia Verdi' }).id;
    changeStatus(gv, 'scartato');
    upsertProspect({ linkedinUrl: 'https://www.linkedin.com/in/mario', fullName: 'Mario' });
    expect((await get('/api/prospects/view-counts?q=giu')).body).toEqual({ tutte: 1, da_smistare: 1, con_prossima_azione: 0, scartate: 1 });
  });

  it('Con prossima azione: ordinamento di default per data, le più vicine prima', async () => {
    const later = manual({ fullName: 'Dopo', email: 'a@x.it', nextAction: { on: '2026-10-05' } });
    const sooner = manual({ fullName: 'Prima', email: 'b@x.it', nextAction: { on: '2026-09-20', text: 'Richiamare' } });
    manual({ fullName: 'Nessuna', email: 'c@x.it' });
    const res = await get('/api/prospects?view=con_prossima_azione&today=2026-09-18');
    expect(ids(res.body)).toEqual([sooner, later]);
    expect(res.body.items[0]).toMatchObject({ next_action_on: '2026-09-20', next_action_text: 'Richiamare', next_action_state: 'futura' });
  });
});

describe('filtri (B4, B5)', () => {
  it('prossima azione ai bordi di oggi: scaduta, oggi, 7g, nessuna', async () => {
    const make = (name: string, on?: string) => manual({ fullName: name, email: `${name}@x.it`, ...(on ? { nextAction: { on } } : {}) });
    const overdue = make('scaduta', '2026-09-17');
    const today = make('oggi', '2026-09-18');
    const tomorrow = make('domani', '2026-09-19');
    const edge = make('settimo', '2026-09-25');
    make('ottavo', '2026-09-26');
    const none = make('nessuna');
    const q = (next: string) => get(`/api/prospects?view=tutte&next=${next}&today=2026-09-18&sort=name`);
    expect(ids((await q('scaduta')).body)).toEqual([overdue]);
    expect(ids((await q('oggi')).body)).toEqual([today]);
    expect(ids((await q('7g')).body).sort()).toEqual([tomorrow, edge].sort());
    expect(ids((await q('nessuna')).body)).toEqual([none]);
    const states = (await get('/api/prospects?view=tutte&today=2026-09-18&sort=next_action')).body.items.map((r: any) => r.next_action_state);
    expect(states.slice(0, 3)).toEqual(['scaduta', 'oggi', 'futura']);
    expect(states.at(-1)).toBeNull();
  });

  it('testo su nome dell\'azienda collegata, telefono ed email; recapiti; nessuna lista; fonte manuale', async () => {
    const nuvola = createCompany({ name: 'Nuvola Srl', website: 'nuvola.io' });
    const linked = manual({ fullName: 'Anna', phone: '+39 347 000111' });
    linkCompany(linked, nuvola.id);
    const withLinkedin = upsertProspect({ linkedinUrl: 'https://www.linkedin.com/in/bruno', fullName: 'Bruno', email: 'bruno@beta.it' }).id;
    const icp = Number(db.prepare(`INSERT INTO icps (name) VALUES ('ICP')`).run().lastInsertRowid);
    const list = Number(db.prepare(`INSERT INTO lists (icp_id, name) VALUES (?, 'L')`).run(icp).lastInsertRowid);
    db.prepare('INSERT INTO list_members (list_id, prospect_id) VALUES (?, ?)').run(list, withLinkedin);

    expect(ids((await get('/api/prospects?view=tutte&q=nuvola')).body)).toEqual([linked]);
    expect(ids((await get('/api/prospects?view=tutte&q=347')).body)).toEqual([linked]);
    expect(ids((await get('/api/prospects?view=tutte&q=beta.it')).body)).toEqual([withLinkedin]);
    // URL incollato così com'è (slash finale, maiuscole, senza schema): conta il profilo normalizzato.
    const byUrl = (url: string) => get(`/api/prospects?view=tutte&q=${encodeURIComponent(url)}`);
    expect(ids((await byUrl('https://www.linkedin.com/in/Bruno/')).body)).toEqual([withLinkedin]);
    expect(ids((await byUrl('linkedin.com/in/bruno?trk=x')).body)).toEqual([withLinkedin]);
    expect(ids((await get('/api/prospects?view=tutte&contact=no_linkedin')).body)).toEqual([linked]);
    expect(ids((await get('/api/prospects?view=tutte&contact=linkedin')).body)).toEqual([withLinkedin]);
    expect(ids((await get('/api/prospects?view=tutte&contact=email')).body)).toEqual([withLinkedin]);
    expect(ids((await get('/api/prospects?view=tutte&list=none')).body)).toEqual([linked]);
    expect(ids((await get('/api/prospects?view=tutte&source=manual')).body)).toEqual([linked]);
    const row = (await get(`/api/prospects?view=tutte&companyId=${nuvola.id}`)).body.items[0];
    expect(row).toMatchObject({ id: linked, linked_company_name: 'Nuvola Srl', manual_fields: { company_id: expect.any(String) } });
    expect(row.created_at).toBeTypeOf('string');
    const member = upsertProspect({ linkedinUrl: 'https://www.linkedin.com/in/carla', memberUrn: 'ACoAAFakeCarla0001AbCdEfGh', fullName: 'Carla' }).id;
    expect(ids((await byUrl('https://www.linkedin.com/in/ACoAAFakeCarla0001AbCdEfGh/')).body)).toEqual([member]);
  });

  it('ordinamento per data di aggiunta; parametri non validi → 400', async () => {
    const first = manual({ fullName: 'Primo', email: 'p@x.it' });
    db.prepare(`UPDATE prospects SET created_at = '2026-01-01T00:00:00.000Z' WHERE id = ?`).run(first);
    const second = manual({ fullName: 'Secondo', email: 's@x.it' });
    expect(ids((await get('/api/prospects?view=tutte&sort=added')).body)).toEqual([second, first]);
    for (const qs of ['view=boh', 'next=ieri', 'contact=fax', 'list=qualcuna', 'today=18-09-2026', 'sort=boh']) {
      expect((await get(`/api/prospects?${qs}`)).status, qs).toBe(400);
    }
    expect((await get('/api/prospects/ids?view=tutte')).body).toMatchObject({ total: 2 });
  });
});
