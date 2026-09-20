import { beforeEach, describe, expect, it } from 'vitest';

// Prossima azione: Fatto, Rimanda, touchpoint (people-first-crm T23, SPEC G2, G4–G6). Import dinamici: la config
// (DB_PATH isolato) è letta a import-time.
const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/server/app.js');
const { upsertProspect } = await import('../src/db/prospects.js');
const { createIcp } = await import('../src/db/icps.js');
const { createList, addMembers } = await import('../src/db/lists.js');

const app = createApp();

async function send(method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

let seq = 0;
function person(): number {
  seq += 1;
  return upsertProspect({ linkedinUrl: `https://www.linkedin.com/in/prossima-${seq}`, fullName: `Persona ${seq}` }).id;
}
const kinds = (id: number) =>
  (db.prepare('SELECT kind, body, meta FROM activities WHERE prospect_id = ? ORDER BY id').all(id) as Array<{ kind: string; body: string | null; meta: string | null }>).map(
    (a) => ({ kind: a.kind, body: a.body, meta: a.meta && JSON.parse(a.meta) }),
  );

beforeEach(() => {
  db.exec('DELETE FROM prospects; DELETE FROM lists; DELETE FROM icps;');
});

describe('Fatto (G4, G6)', () => {
  it('POST …/next-action/done → prossima azione vuota, timeline "completata" col testo, stato e liste invariati; set_at superato → 409', async () => {
    const list = createList({ icpId: createIcp({ name: 'ICP' }).id, name: 'Eventi' })!;
    const id = person();
    addMembers(list.id, [id]);
    const set = await send('PUT', `/api/prospects/${id}/next-action`, { on: '2026-09-15', text: 'Richiamare per la demo' });
    const setAt = set.body.next_action_set_at as string;

    const stale = await send('POST', `/api/prospects/${id}/next-action/done`, { expectedSetAt: '2020-01-01T00:00:00.000Z' });
    expect(stale).toMatchObject({ status: 409, body: { code: 'next_action_changed' } });
    expect(stale.body.error).toBe('La prossima azione è già stata completata o cambiata.');

    const done = await send('POST', `/api/prospects/${id}/next-action/done`, { expectedSetAt: setAt });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ id, next_action_on: null, next_action_text: null, next_action_set_at: null, status: 'nuovo' });
    expect(done.body.memberships.map((m: any) => m.list_id)).toEqual([list.id]);
    expect(done.body.timeline[0]).toMatchObject({ kind: 'next_action_done', body: 'Richiamare per la demo', meta: { on: '2026-09-15' } });
    expect(kinds(id).filter((a) => a.kind === 'status_change')).toEqual([]);

    // Seconda pressione (altra scheda): la prossima azione non c'è più.
    expect(await send('POST', `/api/prospects/${id}/next-action/done`, { expectedSetAt: setAt })).toMatchObject({ status: 409, body: { code: 'next_action_changed' } });
    expect((await send('POST', `/api/prospects/999999/next-action/done`, { expectedSetAt: setAt })).status).toBe(404);
    expect((await send('POST', `/api/prospects/${id}/next-action/done`, {})).status).toBe(400);
  });
});

describe('Rimanda e modifica con controllo (G5)', () => {
  it('PUT con expectedSetAt: Rimanda sposta la data (nessuna voce in timeline); con un valore vecchio → 409 e nulla cambia', async () => {
    const id = person();
    const first = await send('PUT', `/api/prospects/${id}/next-action`, { on: '2026-09-15', text: 'Richiamare' });
    const setAt = first.body.next_action_set_at as string;

    const postponed = await send('PUT', `/api/prospects/${id}/next-action`, { on: '2026-09-20', text: 'Richiamare', expectedSetAt: setAt });
    expect(postponed.status).toBe(200);
    expect(postponed.body).toMatchObject({ next_action_on: '2026-09-20', next_action_text: 'Richiamare' });
    expect(postponed.body.next_action_set_at).not.toBe(setAt);

    const stale = await send('PUT', `/api/prospects/${id}/next-action`, { on: '2026-10-01', expectedSetAt: setAt });
    expect(stale).toMatchObject({ status: 409, body: { code: 'next_action_changed' } });
    expect((await send('GET', `/api/prospects/${id}`)).body.next_action_on).toBe('2026-09-20');

    const staleDelete = await send('DELETE', `/api/prospects/${id}/next-action`, { expectedSetAt: setAt });
    expect(staleDelete.status).toBe(409);
    const removed = await send('DELETE', `/api/prospects/${id}/next-action`, { expectedSetAt: postponed.body.next_action_set_at });
    expect(removed.body.next_action_on).toBeNull();
    // Senza expectedSetAt resta il comportamento di M1 (nessun controllo); nessuna voce di timeline.
    expect((await send('PUT', `/api/prospects/${id}/next-action`, { on: '2026-11-02' })).status).toBe(200);
    expect(kinds(id)).toEqual([]);
    // Impostarla su chi non ne ha: `expectedSetAt: null` = "non ce n'era".
    const other = person();
    expect((await send('PUT', `/api/prospects/${other}/next-action`, { on: '2026-11-02', expectedSetAt: null })).status).toBe(200);
    expect((await send('PUT', `/api/prospects/${other}/next-action`, { on: '2026-11-03', expectedSetAt: null })).status).toBe(409);
  });
});

describe('touchpoint con prossima azione (G2)', () => {
  it('imposta e poi sostituisce la prossima azione nello stesso passo; blocco vuoto = nessun cambio; testo senza data → 400', async () => {
    const id = person();
    const tp = { channel: 'email', direction: 'outbound', body: 'Mandata la presentazione' };

    expect((await send('POST', `/api/prospects/${id}/touchpoints`, { ...tp, nextAction: { on: '2026-09-25', text: 'Richiamare' } })).status).toBe(201);
    let detail = (await send('GET', `/api/prospects/${id}`)).body;
    expect(detail).toMatchObject({ next_action_on: '2026-09-25', next_action_text: 'Richiamare', status: 'nuovo' });

    expect((await send('POST', `/api/prospects/${id}/touchpoints`, { ...tp, nextAction: { on: '2026-10-02', text: 'Proporre la call' } })).status).toBe(201);
    detail = (await send('GET', `/api/prospects/${id}`)).body;
    expect(detail).toMatchObject({ next_action_on: '2026-10-02', next_action_text: 'Proporre la call' });

    expect((await send('POST', `/api/prospects/${id}/touchpoints`, { ...tp, nextAction: { on: null, text: '  ' } })).status).toBe(201);
    expect((await send('POST', `/api/prospects/${id}/touchpoints`, tp)).status).toBe(201);
    expect((await send('GET', `/api/prospects/${id}`)).body.next_action_on).toBe('2026-10-02');

    const noDate = await send('POST', `/api/prospects/${id}/touchpoints`, { ...tp, nextAction: { text: 'Richiamare' } });
    expect(noDate).toMatchObject({ status: 400, body: { code: 'next_action_date_required', error: 'Scegli la data della prossima azione.' } });
    // Il touchpoint rifiutato non si registra.
    expect(kinds(id).filter((a) => a.kind === 'touchpoint')).toHaveLength(4);
  });
});
