import { beforeEach, describe, expect, it } from 'vitest';

// API Liste e membership (crm-foundation T5). Import dinamici: la config (DB_PATH isolato
// da tests/setup.ts) è letta a import-time.
const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/server/app.js');
const { upsertProspect } = await import('../src/db/prospects.js');
const { addMembers, isListArchived, getList } = await import('../src/db/lists.js');

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

function reset(): void {
  db.exec('DELETE FROM prospects; DELETE FROM posts; DELETE FROM lists; DELETE FROM companies; DELETE FROM icps;');
}

let seq = 0;
function prospect(fields: Partial<Parameters<typeof upsertProspect>[0]> = {}): number {
  seq += 1;
  return upsertProspect({ linkedinUrl: `https://www.linkedin.com/in/membro-${seq}`, fullName: `Membro ${seq}`, ...fields }).id;
}

/** ICP via SQL diretto: il repo ICP appartiene a T4. */
function icp(name = 'CTO startup IT'): number {
  return Number(db.prepare('INSERT INTO icps (name) VALUES (?)').run(name).lastInsertRowid);
}

async function createList(icpId: number, name = 'CTO Milano'): Promise<any> {
  const res = await send('POST', '/api/lists', { icpId, name, description: 'Prima ondata' });
  expect(res.status).toBe(201);
  return json(res);
}

beforeEach(reset);

describe('membership', () => {
  it('bulk add di 3 prospect di cui 1 già membro → {added:2, skipped:1}', async () => {
    const list = await createList(icp());
    const [a, b, c] = [prospect(), prospect(), prospect()];
    addMembers(list.id, [a]);

    const res = await send('POST', `/api/lists/${list.id}/members`, { prospectIds: [a, b, c] });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ added: 2, skipped: 1 });

    const detail = await json(await send('GET', `/api/lists/${list.id}`));
    expect(detail.members_count).toBe(3);
    expect(detail.counts_by_status.nuovo).toBe(3);
  });

  it('rimuovere dall\'ultima lista riporta il prospect in Inbox con il suo stato', async () => {
    const list = await createList(icp());
    const a = prospect();
    addMembers(list.id, [a]);
    await send('POST', `/api/prospects/${a}/status`, { status: 'contattato' });
    expect((await json(await send('GET', '/api/inbox/ids'))).ids).not.toContain(a);

    const res = await send('DELETE', `/api/lists/${list.id}/members`, { prospectIds: [a] });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true, removed: 1 });

    const inbox = await json(await send('GET', '/api/inbox'));
    expect(inbox.items.map((r: any) => [r.id, r.status])).toEqual([[a, 'contattato']]);
    expect((await json(await send('GET', `/api/lists/${list.id}`))).members_count).toBe(0);
  });

  it('members/ids applica i filtri entro la lista; lista inesistente → 404', async () => {
    const list = await createList(icp());
    const other = await createList(list.icp_id, 'Altra');
    const withEmail = prospect({ email: 'a@acme.it' });
    const without = prospect();
    const elsewhere = prospect({ email: 'b@acme.it' });
    addMembers(list.id, [withEmail, without]);
    addMembers(other.id, [elsewhere]);

    const all = await json(await send('GET', `/api/lists/${list.id}/members/ids`));
    expect(all).toMatchObject({ total: 2, capped: false });
    expect([...all.ids].sort()).toEqual([withEmail, without].sort());
    expect(await json(await send('GET', `/api/lists/${list.id}/members/ids?hasEmail=1`))).toEqual({
      ids: [withEmail],
      total: 1,
      capped: false,
    });

    expect((await send('GET', '/api/lists/99999/members/ids')).status).toBe(404);
    expect((await send('POST', '/api/lists/99999/members', { prospectIds: [withEmail] })).status).toBe(404);
  });

  it('membri via GET /api/prospects?listId= con i conteggi della lista', async () => {
    const list = await createList(icp());
    const a = prospect({ email: 'a@acme.it', enrichedAt: '2026-09-01T10:00:00.000Z' });
    const b = prospect();
    addMembers(list.id, [a, b]);
    await send('POST', `/api/prospects/${b}/status`, { status: 'qualificato' });

    const page = await json(await send('GET', `/api/prospects?listId=${list.id}&status=qualificato,contattato`));
    expect(page).toMatchObject({ total: 1, page: 1, pageSize: 50 });
    expect(page.items[0]).toMatchObject({ id: b, status: 'qualificato', memberships: [{ list_id: list.id, list_name: 'CTO Milano' }] });

    const detail = await json(await send('GET', `/api/lists/${list.id}`));
    expect(detail).toMatchObject({
      icp: { id: list.icp_id, name: 'CTO startup IT' },
      members_count: 2,
      enriched_count: 1,
      with_email_count: 1,
      analyzed_count: 0,
    });
    expect(detail.counts_by_status).toMatchObject({ nuovo: 1, qualificato: 1, contattato: 0 });
  });
});

describe('liste', () => {
  it('POST crea la lista dell\'ICP; ICP inesistente → 400; body non valido → 400', async () => {
    const icpId = icp();
    const list = await createList(icpId);
    expect(list).toMatchObject({ icp_id: icpId, name: 'CTO Milano', description: 'Prima ondata', archived_at: null, members_count: 0 });

    const missing = await send('POST', '/api/lists', { icpId: 99999, name: 'X' });
    expect(missing.status).toBe(400);
    expect(await json(missing)).toMatchObject({ code: 'icp_not_found' });
    expect((await send('POST', '/api/lists', { icpId, name: '  ' })).status).toBe(400);
    expect((await send('POST', '/api/lists', { icpId, name: 'X', extra: true })).status).toBe(400);
    expect((await send('GET', '/api/lists/99999')).status).toBe(404);
  });

  it('GET /api/lists: liste con ICP e conteggi; archiviata nascosta salvo includeArchived', async () => {
    const icpId = icp();
    const a = await createList(icpId, 'A');
    const b = await createList(icpId, 'B');
    addMembers(a.id, [prospect(), prospect()]);

    const listed = await json(await send('GET', '/api/lists'));
    expect(listed.items.map((l: any) => [l.name, l.members_count, l.icp.name])).toEqual([
      ['A', 2, 'CTO startup IT'],
      ['B', 0, 'CTO startup IT'],
    ]);

    const archived = await send('PATCH', `/api/lists/${b.id}`, { archived: true, name: 'B (vecchia)' });
    expect(archived.status).toBe(200);
    const body = await json(archived);
    expect(body.archived_at).toBeTypeOf('string');
    expect(body.name).toBe('B (vecchia)');
    expect(isListArchived(b.id)).toBe(true);

    expect((await json(await send('GET', '/api/lists'))).items.map((l: any) => l.id)).toEqual([a.id]);
    expect((await json(await send('GET', '/api/lists?includeArchived=1'))).items).toHaveLength(2);
    expect((await send('GET', `/api/lists/${b.id}`)).status).toBe(200);

    await send('PATCH', `/api/lists/${b.id}`, { archived: false });
    expect(getList(b.id)?.archived_at).toBeNull();
    expect(isListArchived(b.id)).toBe(false);
    expect((await send('PATCH', '/api/lists/99999', { name: 'X' })).status).toBe(404);
  });
});
