import { beforeEach, describe, expect, it } from 'vitest';

// API Prospect, Inbox, stati e attività (crm-foundation T5). Import dinamici: la config
// (DB_PATH isolato da tests/setup.ts) è letta a import-time.
const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/server/app.js');
const { upsertProspect } = await import('../src/db/prospects.js');

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

/** Svuota le tabelle toccate (figli prima dei padri: `sources.post_id` è RESTRICT). */
function reset(): void {
  db.exec('DELETE FROM prospects; DELETE FROM posts; DELETE FROM lists; DELETE FROM companies; DELETE FROM icps;');
}

let seq = 0;
function prospect(fields: Partial<Parameters<typeof upsertProspect>[0]> = {}): number {
  seq += 1;
  return upsertProspect({ linkedinUrl: `https://www.linkedin.com/in/persona-${seq}`, fullName: `Persona ${seq}`, ...fields }).id;
}

beforeEach(reset);

describe('touchpoint e timeline', () => {
  it('touchpoint con newStatus → 201, stato aggiornato e timeline con touchpoint + status_change desc', async () => {
    const id = prospect({ fullName: 'Anna Rossi' });

    const res = await send('POST', `/api/prospects/${id}/touchpoints`, {
      channel: 'linkedin_dm',
      direction: 'outbound',
      body: 'Ciao Anna, ho visto il tuo commento…',
      newStatus: 'contattato',
    });
    expect(res.status).toBe(201);
    const activity = await json(res);
    expect(activity).toMatchObject({ kind: 'touchpoint', channel: 'linkedin_dm', direction: 'outbound' });

    const detail = await json(await send('GET', `/api/prospects/${id}`));
    expect(detail.status).toBe('contattato');
    expect(detail.timeline.map((a: any) => a.kind)).toEqual(['touchpoint', 'status_change']);
    expect(detail.timeline[0].body).toContain('Ciao Anna');
    expect(detail.timeline[1]).toMatchObject({ from_status: 'nuovo', to_status: 'contattato' });
  });
});

describe('stati', () => {
  it('POST status → timeline con status_change from/to; stesso stato → nessuna nuova attività', async () => {
    const id = prospect();
    const res = await send('POST', `/api/prospects/${id}/status`, { status: 'contattato', note: 'DM inviato a mano' });
    expect(res.status).toBe(200);
    const updated = await json(res);
    expect(updated.status).toBe('contattato');
    expect(updated.status_changed_at).toBeTypeOf('string');
    expect(updated.timeline).toHaveLength(1);
    expect(updated.timeline[0]).toMatchObject({
      kind: 'status_change',
      from_status: 'nuovo',
      to_status: 'contattato',
      body: 'DM inviato a mano',
      deletable: false,
    });

    const again = await json(await send('POST', `/api/prospects/${id}/status`, { status: 'contattato' }));
    expect(again.timeline).toHaveLength(1);

    expect((await send('POST', `/api/prospects/${id}/status`, { status: 'selected' })).status).toBe(400);
    expect((await send('POST', '/api/prospects/99999/status', { status: 'contattato' })).status).toBe(404);
    const badList = await send('POST', `/api/prospects/${id}/status`, { status: 'risposto', listId: 99999 });
    expect(badList.status).toBe(400);
    expect(await json(badList)).toMatchObject({ code: 'list_not_found' });
  });

  it('Inbox esclude membri e scartati salvo includeDiscarded; bulk/status → nuovo ripristina', async () => {
    const icpId = Number(db.prepare(`INSERT INTO icps (name) VALUES ('ICP')`).run().lastInsertRowid);
    const listId = Number(db.prepare(`INSERT INTO lists (icp_id, name) VALUES (?, 'L')`).run(icpId).lastInsertRowid);
    const [free, member, discarded] = [prospect(), prospect(), prospect()];
    const { addMembers } = await import('../src/db/lists.js');
    addMembers(listId, [member]);

    const bulk = await send('POST', '/api/prospects/bulk/status', { prospectIds: [discarded, 99999], status: 'scartato' });
    expect(bulk.status).toBe(200);
    expect(await json(bulk)).toEqual({ updated: 1, unchanged: 0, not_found: 1 });

    const inbox = await json(await send('GET', '/api/inbox'));
    expect(inbox.items.map((r: any) => r.id)).toEqual([free]);
    expect(inbox.total).toBe(1);

    const withDiscarded = await json(await send('GET', '/api/inbox?includeDiscarded=1'));
    expect(withDiscarded.items.map((r: any) => r.id).sort()).toEqual([free, discarded].sort());
    // `status=scartato` esplicito mostra solo gli scartati (toggle "Mostra scartati").
    expect((await json(await send('GET', '/api/inbox?status=scartato'))).items.map((r: any) => r.id)).toEqual([discarded]);

    const restore = await json(await send('POST', '/api/prospects/bulk/status', { prospectIds: [discarded, free], status: 'nuovo' }));
    expect(restore).toEqual({ updated: 1, unchanged: 1, not_found: 0 });
    expect((await json(await send('GET', '/api/inbox'))).total).toBe(2);
    expect((await json(await send('GET', `/api/prospects/${discarded}`))).timeline.map((a: any) => a.to_status)).toEqual([
      'nuovo',
      'scartato',
    ]);
  });
});

describe('attività', () => {
  it('DELETE /api/activities/:id: status_change → 409, touchpoint e nota → 200', async () => {
    const id = prospect();
    await send('POST', `/api/prospects/${id}/touchpoints`, { channel: 'email', direction: 'inbound', newStatus: 'risposto' });
    const note = await send('POST', `/api/prospects/${id}/notes`, { body: 'Richiamare a ottobre' });
    expect(note.status).toBe(201);
    expect(await json(note)).toMatchObject({ kind: 'note', body: 'Richiamare a ottobre', deletable: true });

    const [noteActivity, touchpoint, statusChange] = (await json(await send('GET', `/api/prospects/${id}`))).timeline;
    expect([noteActivity.kind, touchpoint.kind, statusChange.kind]).toEqual(['note', 'touchpoint', 'status_change']);

    const blocked = await send('DELETE', `/api/activities/${statusChange.id}`);
    expect(blocked.status).toBe(409);
    expect(await json(blocked)).toMatchObject({ code: 'activity_not_deletable' });

    expect((await send('DELETE', `/api/activities/${touchpoint.id}`)).status).toBe(200);
    expect((await send('DELETE', `/api/activities/${noteActivity.id}`)).status).toBe(200);
    expect((await send('DELETE', `/api/activities/${noteActivity.id}`)).status).toBe(404);

    const after = await json(await send('GET', `/api/prospects/${id}`));
    expect(after.timeline.map((a: any) => a.kind)).toEqual(['status_change']);
    // Eliminare il touchpoint non annulla il cambio stato.
    expect(after.status).toBe('risposto');
  });

  it('touchpoint: nota in meta, data normalizzata, lista di contesto nel chip; body non valido → 400', async () => {
    const icpId = Number(db.prepare(`INSERT INTO icps (name) VALUES ('ICP')`).run().lastInsertRowid);
    const listId = Number(db.prepare(`INSERT INTO lists (icp_id, name) VALUES (?, 'Fintech')`).run(icpId).lastInsertRowid);
    const id = prospect();
    const res = await send('POST', `/api/prospects/${id}/touchpoints`, {
      channel: 'call',
      direction: 'outbound',
      occurredAt: '2026-09-10T09:30:00+02:00',
      note: 'Segreteria',
      listId,
    });
    expect(res.status).toBe(201);
    expect(await json(res)).toMatchObject({
      kind: 'touchpoint',
      body: null,
      meta: { note: 'Segreteria' },
      occurred_at: '2026-09-10T07:30:00.000Z',
      list_id: listId,
      list_name: 'Fintech',
    });
    const detail = await json(await send('GET', `/api/prospects/${id}`));
    expect(detail.status).toBe('nuovo');
    expect(detail.last_touchpoint_at).toBe('2026-09-10T07:30:00.000Z');

    expect((await send('POST', `/api/prospects/${id}/touchpoints`, { channel: 'fax', direction: 'outbound' })).status).toBe(400);
    expect((await send('POST', `/api/prospects/${id}/touchpoints`, { channel: 'call', direction: 'outbound', occurredAt: 'ieri' })).status).toBe(400);
    expect((await send('POST', '/api/prospects/99999/touchpoints', { channel: 'call', direction: 'outbound' })).status).toBe(404);
    expect((await send('POST', `/api/prospects/${id}/notes`, { body: '   ' })).status).toBe(400);
  });
});

describe('upsert e fonti (P4)', () => {
  it('upsertProspect: identità sull\'URL normalizzato, created vs già visto, backfill senza azzerare', async () => {
    const first = upsertProspect({ linkedinUrl: 'linkedin.com/in/mario-bianchi/?utm=x', headline: 'CTO', email: 'm@acme.it' });
    expect(first.created).toBe(true);
    const seen = upsertProspect({ linkedinUrl: 'https://www.linkedin.com/in/mario-bianchi', fullName: 'Mario Bianchi', email: '', headline: 'Head of Eng' });
    expect(seen).toEqual({ id: first.id, created: false, mergedIds: [] });

    let detail = await json(await send('GET', `/api/prospects/${first.id}`));
    expect(detail).toMatchObject({ linkedin_url: 'https://www.linkedin.com/in/mario-bianchi', full_name: 'Mario Bianchi', headline: 'CTO', email: 'm@acme.it' });

    // refresh: i valori nuovi non vuoti vincono, i vuoti non azzerano.
    upsertProspect({ linkedinUrl: 'https://www.linkedin.com/in/mario-bianchi', headline: 'VP Engineering', email: null, raw: { about: 'x' } }, { refresh: true });
    detail = await json(await send('GET', `/api/prospects/${first.id}`));
    expect(detail).toMatchObject({ headline: 'VP Engineering', email: 'm@acme.it', raw: { about: 'x' } });

    expect(() => upsertProspect({ linkedinUrl: 'https://example.com/in/x' })).toThrow();
  });

  it('addSource: la stessa fonte due volte non si duplica; reazione e commento sullo stesso post sono due fonti', async () => {
    const { addSource } = await import('../src/db/prospects.js');
    const id = prospect();
    const postId = Number(
      db.prepare(`INSERT INTO posts (post_url, text_excerpt) VALUES ('https://www.linkedin.com/posts/omar-1', 'Kubernetes in produzione')`).run().lastInsertRowid,
    );
    const companyId = Number(db.prepare(`INSERT INTO companies (linkedin_url, name) VALUES ('https://www.linkedin.com/company/acme', 'Acme')`).run().lastInsertRowid);

    expect(addSource(id, { kind: 'post_reaction', postId, reactionType: 'LIKE' }).created).toBe(true);
    expect(addSource(id, { kind: 'post_reaction', postId, reactionType: 'PRAISE' })).toMatchObject({ created: false });
    expect(addSource(id, { kind: 'post_comment', postId, commentText: 'Anche noi stiamo migrando a Kubernetes' }).created).toBe(true);
    expect(addSource(id, { kind: 'post_comment', postId }).created).toBe(false);
    expect(addSource(id, { kind: 'company_employees', companyId }).created).toBe(true);
    expect(addSource(id, { kind: 'company_employees', companyId }).created).toBe(false);
    expect(addSource(id, { kind: 'manual' }).created).toBe(true);
    expect(addSource(id, { kind: 'manual' }).created).toBe(false);

    const detail = await json(await send('GET', `/api/prospects/${id}`));
    expect(detail.sources).toHaveLength(4);
    const byKind = Object.fromEntries(detail.sources.map((s: any) => [s.kind, s]));
    expect(byKind.post_reaction).toMatchObject({ reaction_type: 'PRAISE', post_url: 'https://www.linkedin.com/posts/omar-1', post_excerpt: 'Kubernetes in produzione' });
    expect(byKind.post_comment.comment_text).toBe('Anche noi stiamo migrando a Kubernetes');
    expect(byKind.company_employees).toMatchObject({ company_id: companyId, company_name: 'Acme' });

    const row = (await json(await send('GET', '/api/inbox'))).items[0];
    expect(row).toMatchObject({ id, sources_count: 4, source_counts: { post_reaction: 1, post_comment: 1, company_employees: 1, manual: 1 } });
    expect([...row.source_kinds].sort()).toEqual(['company_employees', 'manual', 'post_comment', 'post_reaction']);
    expect(row).not.toHaveProperty('raw_json');
    expect((await json(await send('GET', `/api/inbox?postId=${postId}&source=post_comment`))).total).toBe(1);
    expect((await json(await send('GET', `/api/prospects?companyId=${companyId}`))).total).toBe(1);
  });
});

describe('ricerca, fit e /ids', () => {
  function seedIcp(name: string): number {
    return Number(db.prepare('INSERT INTO icps (name) VALUES (?)').run(name).lastInsertRowid);
  }
  function analysis(prospectId: number, icpId: number, fit: string, createdAt: string): void {
    db.prepare(
      `INSERT INTO analyses (prospect_id, icp_id, model, summary, angles, fit, fit_reason, input_hash, created_at)
       VALUES (?, ?, 'claude-opus-5', 'Riassunto', ?, ?, 'Perché sì', 'hash-1', ?)`,
    ).run(prospectId, icpId, JSON.stringify([{ title: 'A', rationale: 'r' }, { title: 'B', rationale: 'r' }, { title: 'C', rationale: 'r' }]), fit, createdAt);
  }

  it('il filtro fit vale solo entro l\'icpId; latest_analysis segue lo stesso ICP; senza ICP con 2 ICP → 400', async () => {
    const cto = seedIcp('CTO startup IT');
    const fintech = seedIcp('Fintech');
    const anna = prospect({ fullName: 'Anna' });
    const bruno = prospect({ fullName: 'Bruno' });
    analysis(anna, cto, 'alto', '2026-09-01T10:00:00.000Z');
    analysis(anna, fintech, 'basso', '2026-09-05T10:00:00.000Z');
    analysis(bruno, fintech, 'alto', '2026-09-02T10:00:00.000Z');

    const ctoAlto = await json(await send('GET', `/api/inbox?fit=alto&icpId=${cto}`));
    expect(ctoAlto.items.map((r: any) => r.id)).toEqual([anna]);
    expect(ctoAlto.items[0].latest_analysis).toMatchObject({ icp_id: cto, icp_name: 'CTO startup IT', fit: 'alto', input_hash: 'hash-1' });

    const fintechAlto = await json(await send('GET', `/api/inbox?fit=alto&icpId=${fintech}`));
    expect(fintechAlto.items.map((r: any) => r.id)).toEqual([bruno]);
    expect((await json(await send('GET', `/api/inbox?fit=none&icpId=${cto}`))).items.map((r: any) => r.id)).toEqual([bruno]);

    // Senza icpId: nessun filtro fit possibile con 2 ICP, latest_analysis = la più recente di qualsiasi ICP.
    const ambiguous = await send('GET', '/api/inbox?fit=alto');
    expect(ambiguous.status).toBe(400);
    expect(await json(ambiguous)).toMatchObject({ code: 'fit_requires_icp' });
    const anyIcp = await json(await send('GET', `/api/inbox?q=Anna`));
    expect(anyIcp.items[0].latest_analysis).toMatchObject({ icp_id: fintech, fit: 'basso' });

    // In una lista l'ICP è implicito.
    const listId = Number(db.prepare(`INSERT INTO lists (icp_id, name) VALUES (?, 'CTO')`).run(cto).lastInsertRowid);
    const { addMembers } = await import('../src/db/lists.js');
    addMembers(listId, [anna, bruno]);
    const inList = await json(await send('GET', `/api/prospects?listId=${listId}&fit=alto`));
    expect(inList.items.map((r: any) => [r.id, r.latest_analysis.icp_id])).toEqual([[anna, cto]]);
    const byFit = await json(await send('GET', `/api/prospects?listId=${listId}&sort=fit`));
    expect(byFit.items.map((r: any) => r.id)).toEqual([anna, bruno]);

    const detail = await json(await send('GET', `/api/prospects/${anna}`));
    expect(detail.latest_analysis).toMatchObject({ icp_id: fintech, fit: 'basso' });
    expect(detail.latest_analysis.angles).toHaveLength(3);
    expect(detail.latest_analyses.map((a: any) => [a.icp_id, a.fit])).toEqual([
      [fintech, 'basso'],
      [cto, 'alto'],
    ]);
    expect(detail.memberships).toEqual([
      expect.objectContaining({ list_id: listId, list_name: 'CTO', icp_id: cto, icp_name: 'CTO startup IT' }),
    ]);
  });

  it('ordinamenti Inbox: commenti prima e più interazioni', async () => {
    const { addSource } = await import('../src/db/prospects.js');
    const post = (n: number) =>
      Number(db.prepare('INSERT INTO posts (post_url) VALUES (?)').run(`https://www.linkedin.com/posts/p-${n}`).lastInsertRowid);
    const [p1, p2] = [post(1), post(2)];
    const liker = prospect();
    const commenter = prospect();
    const fan = prospect();
    addSource(commenter, { kind: 'post_comment', postId: p1, commentText: 'Interessante' });
    addSource(fan, { kind: 'post_reaction', postId: p1 });
    addSource(fan, { kind: 'post_reaction', postId: p2 });
    addSource(liker, { kind: 'post_reaction', postId: p2 });
    // Catture esplicite: nello stesso millisecondo l'ordine "recent" dipenderebbe dall'id.
    db.prepare(`UPDATE sources SET captured_at = '2026-09-01T10:00:00.000Z'`).run();
    db.prepare(`UPDATE sources SET captured_at = '2026-09-02T10:00:00.000Z' WHERE prospect_id = ?`).run(liker);

    expect((await json(await send('GET', '/api/inbox?sort=comments_first'))).items[0].id).toBe(commenter);
    expect((await json(await send('GET', '/api/inbox?sort=most_interactions'))).items[0].id).toBe(fan);
    expect((await json(await send('GET', '/api/inbox?sort=recent'))).items[0].id).toBe(liker);
  });

  it('/ids: tutti i filtrati fino al cap 500 con total e capped', async () => {
    const insert = db.transaction(() => {
      for (let i = 0; i < 501; i++) prospect({ fullName: `Massivo ${i}` });
    });
    insert();
    prospect({ fullName: 'Fuori filtro' });

    const capped = await json(await send('GET', '/api/inbox/ids?q=massivo'));
    expect(capped.total).toBe(501);
    expect(capped.ids).toHaveLength(500);
    expect(capped.capped).toBe(true);

    const small = await json(await send('GET', '/api/prospects/ids?q=fuori'));
    expect(small).toMatchObject({ total: 1, capped: false });

    const page = await json(await send('GET', '/api/prospects?q=massivo&page=6&pageSize=100'));
    expect(page).toMatchObject({ total: 501, page: 6, pageSize: 100 });
    expect(page.items).toHaveLength(1);
  });

  it('query non valida → 400', async () => {
    for (const qs of ['pageSize=1000', 'page=0', 'sort=a_caso', 'status=selected', 'hasEmail=forse', 'listId=abc', 'fit=altissimo&icpId=1']) {
      const res = await send('GET', `/api/prospects?${qs}`);
      expect(res.status, qs).toBe(400);
    }
    expect((await send('GET', '/api/inbox?includeDiscarded=boh')).status).toBe(400);
    // Parametri vuoti = assenti.
    expect((await send('GET', '/api/inbox?q=&status=&page=')).status).toBe(200);
  });
});

describe('anagrafica', () => {
  it('PATCH modifica solo i campi ammessi (strict); vuoto azzera; 404 se inesistente', async () => {
    const id = prospect({ email: 'vecchia@acme.it', title: 'CTO' });
    const res = await send('PATCH', `/api/prospects/${id}`, { email: 'nuova@acme.it', phone: '+39 333', title: '' });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ email: 'nuova@acme.it', phone: '+39 333', title: null, has_email: true });

    expect((await send('PATCH', `/api/prospects/${id}`, { status: 'contattato' })).status).toBe(400);
    expect((await send('PATCH', `/api/prospects/${id}`, { linkedin_url: 'https://www.linkedin.com/in/altro' })).status).toBe(400);
    expect((await send('PATCH', '/api/prospects/99999', { email: 'x@y.it' })).status).toBe(404);
    expect((await send('GET', '/api/prospects/99999')).status).toBe(404);
    expect((await send('GET', '/api/prospects/abc')).status).toBe(404);
  });
});

describe('stato analisi per riga e filtro fit esteso (T11, FLOW E.4)', () => {
  function seedIcp(name: string): number {
    return Number(db.prepare('INSERT INTO icps (name) VALUES (?)').run(name).lastInsertRowid);
  }
  function analysis(prospectId: number, icpId: number, fit: string, createdAt: string): void {
    db.prepare(
      `INSERT INTO analyses (prospect_id, icp_id, model, summary, angles, fit, fit_reason, input_hash, created_at)
       VALUES (?, ?, 'claude-opus-5', 'Riassunto', '[]', ?, 'Perché', 'h', ?)`,
    ).run(prospectId, icpId, fit, createdAt);
  }
  /** Attività `analysis` fallita come la scrive T11 (`meta.error`, `error_kind`, `icp_id`). */
  function failure(prospectId: number, icpId: number, kind: string, error: string, createdAt: string): void {
    db.prepare(`INSERT INTO activities (prospect_id, kind, body, meta, occurred_at, created_at) VALUES (?, 'analysis', ?, ?, ?, ?)`).run(
      prospectId,
      error,
      JSON.stringify({ icp_id: icpId, error, error_kind: kind, model: 'claude-opus-5' }),
      createdAt,
      createdAt,
    );
  }

  it('analysis_state: fit, rifiutata/errore se il fallimento è più recente, non_arricchibile, null; filtri fit per ICP', async () => {
    const cto = seedIcp('CTO');
    const fintech = seedIcp('Fintech');
    const anna = prospect({ fullName: 'Anna' });
    const bruno = prospect({ fullName: 'Bruno' });
    const carla = prospect({ fullName: 'Carla', enrichmentAttemptedAt: '2026-09-01T10:00:00.000Z' });
    const dario = prospect({ fullName: 'Dario' });
    const elena = prospect({ fullName: 'Elena' });
    analysis(anna, cto, 'alto', '2026-09-01T10:00:00.000Z');
    failure(anna, cto, 'refusal', 'Il modello ha rifiutato di analizzare questo profilo.', '2026-09-02T10:00:00.000Z');
    failure(bruno, cto, 'invalid_output', 'Risposta del modello non valida (2 tentativi). Riprova tra poco.', '2026-09-02T10:00:00.000Z');
    failure(dario, cto, 'error', 'Vecchio errore', '2026-09-01T10:00:00.000Z');
    analysis(dario, cto, 'medio', '2026-09-03T10:00:00.000Z');
    failure(elena, fintech, 'max_tokens', 'Risposta troncata', '2026-09-02T10:00:00.000Z');
    // Un'analisi riuscita scrive anche lei un'attività `analysis`, senza `meta.error`: non conta come fallimento.
    db.prepare(`INSERT INTO activities (prospect_id, kind, meta, created_at) VALUES (?, 'analysis', ?, '2026-09-04T10:00:00.000Z')`).run(
      dario,
      JSON.stringify({ icp_id: cto, analysis_id: 1, fit: 'medio' }),
    );

    const rows = (await json(await send('GET', `/api/inbox?icpId=${cto}`))).items;
    const state = Object.fromEntries(rows.map((r: any) => [r.full_name, [r.analysis_state, r.analysis_error]]));
    expect(state).toEqual({
      Anna: ['rifiutata', 'Il modello ha rifiutato di analizzare questo profilo.'],
      Bruno: ['errore', 'Risposta del modello non valida (2 tentativi). Riprova tra poco.'],
      Carla: ['non_arricchibile', null],
      Dario: ['medio', null],
      Elena: [null, null],
    });

    const ids = async (qs: string) => (await json(await send('GET', `/api/inbox?${qs}`))).items.map((r: any) => r.full_name).sort();
    expect(await ids(`fit=rifiutata&icpId=${cto}`)).toEqual(['Anna']);
    expect(await ids(`fit=errore&icpId=${cto}`)).toEqual(['Bruno']);
    expect(await ids(`fit=non_arricchibile&icpId=${cto}`)).toEqual(['Carla']);
    expect(await ids(`fit=rifiutata,errore,non_arricchibile&icpId=${cto}`)).toEqual(['Anna', 'Bruno', 'Carla']);
    expect(await ids(`fit=medio,alto&icpId=${cto}`)).toEqual(['Dario']);
    expect(await ids(`fit=none&icpId=${cto}`)).toEqual(['Elena']);
    expect(await ids(`fit=errore&icpId=${fintech}`)).toEqual(['Elena']);
    expect((await json(await send('GET', `/api/inbox/ids?fit=errore&icpId=${fintech}`))).ids).toEqual([elena]);

    const ambiguous = await send('GET', '/api/inbox?fit=errore');
    expect(ambiguous.status).toBe(400);
    expect(await json(ambiguous)).toMatchObject({ code: 'fit_requires_icp' });

    // In una lista l'ICP è implicito.
    const listId = Number(db.prepare(`INSERT INTO lists (icp_id, name) VALUES (?, 'CTO')`).run(cto).lastInsertRowid);
    const { addMembers } = await import('../src/db/lists.js');
    addMembers(listId, [anna, bruno, carla]);
    expect((await json(await send('GET', `/api/prospects?listId=${listId}&fit=non_arricchibile,rifiutata`))).items.map((r: any) => r.id).sort()).toEqual(
      [anna, carla].sort(),
    );
    expect((await json(await send('GET', `/api/lists/${listId}/members/ids?fit=errore`))).ids).toEqual([bruno]);
  });
});
