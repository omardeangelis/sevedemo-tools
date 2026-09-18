import { beforeEach, describe, expect, it } from 'vitest';

// Export CSV per lista (crm-foundation T12). Import dinamici: la config (DB_PATH isolato
// da tests/setup.ts) è letta a import-time.
const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/server/app.js');
const { upsertProspect } = await import('../src/db/prospects.js');
const { addMembers } = await import('../src/db/lists.js');

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
  return upsertProspect({ linkedinUrl: `https://www.linkedin.com/in/export-${seq}`, fullName: `Membro ${seq}`, ...fields }).id;
}

/** ICP e lista via SQL diretto: i repo appartengono a T4/T5. */
function icp(name = 'CTO startup IT'): number {
  return Number(db.prepare('INSERT INTO icps (name) VALUES (?)').run(name).lastInsertRowid);
}

function list(icpId: number, name = 'CTO Milano'): number {
  return Number(db.prepare('INSERT INTO lists (icp_id, name) VALUES (?, ?)').run(icpId, name).lastInsertRowid);
}

function activities(prospectId: number, kind: string): any[] {
  return db.prepare('SELECT * FROM activities WHERE prospect_id = ? AND kind = ? ORDER BY id').all(prospectId, kind) as any[];
}

/** Parser CSV RFC 4180 minimale (virgolette raddoppiate, newline nei campi quotati). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

/** Righe del CSV come oggetti `{colonna: valore}`. */
async function downloadRows(url: string): Promise<Array<Record<string, string>>> {
  const [header, ...rows] = parseCsv(await (await send('GET', url)).text());
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

function analysis(prospectId: number, icpId: number, fit: string, summary: string): void {
  const angles = [1, 2, 3].map((n) => ({ title: `Angolo ${n}`, rationale: `Perché ${n}` }));
  db.prepare(
    `INSERT INTO analyses (prospect_id, icp_id, model, summary, angles, fit, fit_reason, input_hash, created_at)
     VALUES (?, ?, 'claude-opus-5', ?, ?, ?, 'Motivo', 'hash-1', ?)`,
  ).run(prospectId, icpId, summary, JSON.stringify(angles), fit, new Date().toISOString());
}

const HEADER =
  'full_name,first_name,last_name,email,company,title,linkedin_url,location,status,list,icp,fit,summary,angle_1,angle_2,angle_3,last_touchpoint_at,sources';

/** Lista con 3 membri, 2 con email (scenario della validation del PLAN). */
function seedList() {
  const listId = list(icp());
  const anna = prospect({ fullName: 'Anna Maria Rossi', email: 'anna@acme.it', companyName: 'Acme', title: 'CTO' });
  const bruno = prospect({ fullName: 'Bruno Bianchi', email: 'bruno@beta.it' });
  const carla = prospect({ fullName: 'Carla Verdi' });
  addMembers(listId, [anna, bruno, carla]);
  return { listId, anna, bruno, carla };
}

beforeEach(reset);

describe('export CSV della lista', () => {
  it('POST {hasEmail:true} → 201 {count:2}; il CSV ha header esatto e 2 righe; attività export', async () => {
    const { listId, anna, bruno, carla } = seedList();

    const res = await send('POST', `/api/lists/${listId}/exports`, { hasEmail: true });
    expect(res.status).toBe(201);
    const created = await json(res);
    expect(created).toMatchObject({ count: 2, download_url: `/api/exports/${created.id}.csv` });

    const csv = await send('GET', created.download_url);
    expect(csv.status).toBe(200);
    const lines = (await csv.text()).split('\n');
    expect(lines[0]).toBe(HEADER);
    expect(lines).toHaveLength(3);

    expect(activities(anna, 'export')).toHaveLength(1);
    expect(JSON.parse(activities(anna, 'export')[0].meta)).toEqual({ export_id: created.id });
    expect(activities(bruno, 'export')).toHaveLength(1);
    expect(activities(carla, 'export')).toHaveLength(0);
  });

  it('POST {prospectIds:[x]} → count 1; id non membri o inesistenti saltati e contati; filtri + selezione → 400', async () => {
    const { listId, carla } = seedList();
    const outsider = prospect({ email: 'fuori@lista.it' });

    const res = await send('POST', `/api/lists/${listId}/exports`, { prospectIds: [carla, outsider, 999999, carla] });
    expect(res.status).toBe(201);
    const created = await json(res);
    expect(created).toMatchObject({
      count: 1,
      scope: 'selection',
      selected: 3,
      mark_contacted: false,
      counts: { in_scope: 1, excluded_email: 0, not_member: 1, not_found: 1 },
    });
    expect(activities(carla, 'export')).toHaveLength(1);
    expect(activities(outsider, 'export')).toHaveLength(0);

    // "Solo con email" vale anche per la selezione (FLOW G): Carla non ha email → nulla da esportare.
    const empty = await send('POST', `/api/lists/${listId}/exports`, { prospectIds: [carla], hasEmail: true });
    expect(empty.status).toBe(400);
    expect(await json(empty)).toMatchObject({ code: 'empty_export' });

    const mixed = await send('POST', `/api/lists/${listId}/exports`, { prospectIds: [carla], status: ['nuovo'] });
    expect(mixed.status).toBe(400);
    expect(await json(mixed)).toMatchObject({ code: 'selection_with_filters' });
    expect(db.prepare('SELECT COUNT(*) FROM exports').pluck().get()).toBe(1);
  });

  it('righe CSV: nome diviso, fonti, stato, analisi solo per l\'ICP della lista, quoting e formule neutralizzate', async () => {
    const cto = icp('CTO startup IT');
    const fintech = icp('Fintech');
    const listId = list(cto, 'CTO Milano');
    const { addSource } = await import('../src/db/prospects.js');
    const { addTouchpoint } = await import('../src/db/activities.js');

    const postUrl = 'https://www.linkedin.com/posts/omar-kubernetes';
    const postId = Number(db.prepare('INSERT INTO posts (post_url) VALUES (?)').run(postUrl).lastInsertRowid);
    const companyId = Number(
      db.prepare('INSERT INTO companies (linkedin_url, name) VALUES (?, ?)').run('https://www.linkedin.com/company/beta', 'Beta Srl').lastInsertRowid,
    );

    const anna = prospect({
      fullName: 'Anna Maria Rossi',
      email: 'anna@acme.it',
      companyName: 'Acme, S.p.A.',
      title: 'CTO',
      location: 'Milano',
    });
    addSource(anna, { kind: 'post_reaction', postId, reactionType: 'LIKE' });
    addSource(anna, { kind: 'post_comment', postId, commentText: 'Anche noi' });
    addSource(anna, { kind: 'company_employees', companyId });
    analysis(anna, cto, 'alto', 'Guida il team "platform"\nsu due sedi');
    addTouchpoint(anna, { channel: 'linkedin_dm', direction: 'outbound', occurredAt: '2026-09-10T10:00:00.000Z' });

    const bruno = prospect({ fullName: 'Bruno', email: 'bruno@beta.it' });
    analysis(bruno, fintech, 'basso', 'Analisi di un altro ICP');

    const mallory = prospect({ fullName: '=HYPERLINK("http://evil.example","clic")', email: '@SUM(1+1)', title: '-2+3', location: '+39 Roma' });
    db.prepare(`UPDATE prospects SET status = 'da_contattare' WHERE id = ?`).run(mallory);
    addMembers(listId, [anna, bruno, mallory]);

    const created = await json(await send('POST', `/api/lists/${listId}/exports`, {}));
    expect(created.count).toBe(3);
    const rows = await downloadRows(created.download_url);
    const byEmail = new Map(rows.map((r) => [r.email, r]));

    expect(byEmail.get('anna@acme.it')).toEqual({
      full_name: 'Anna Maria Rossi',
      first_name: 'Anna',
      last_name: 'Maria Rossi',
      email: 'anna@acme.it',
      company: 'Acme, S.p.A.',
      title: 'CTO',
      linkedin_url: expect.stringMatching(/^https:\/\/www\.linkedin\.com\/in\/export-\d+$/),
      location: 'Milano',
      status: 'Nuovo',
      list: 'CTO Milano',
      icp: 'CTO startup IT',
      fit: 'alto',
      summary: 'Guida il team "platform"\nsu due sedi',
      angle_1: 'Angolo 1 — Perché 1',
      angle_2: 'Angolo 2 — Perché 2',
      angle_3: 'Angolo 3 — Perché 3',
      last_touchpoint_at: '2026-09-10T10:00:00.000Z',
      sources: `reazione a ${postUrl}; commento a ${postUrl}; dipendente di Beta Srl`,
    });
    // Analizzato solo per un altro ICP → colonne dell'analisi vuote, cognome vuoto.
    expect(byEmail.get('bruno@beta.it')).toMatchObject({ first_name: 'Bruno', last_name: '', fit: '', summary: '', angle_1: '', angle_2: '', angle_3: '', sources: '' });
    // Testo non fidato che inizia con = + - @ → prefisso apice: il foglio lo tratta come testo.
    expect(byEmail.get("'@SUM(1+1)")).toMatchObject({
      full_name: `'=HYPERLINK("http://evil.example","clic")`,
      title: "'-2+3",
      location: "'+39 Roma",
      status: 'Da contattare',
    });
  });

  it('fonte apollo_people → "Apollo · <azienda>" nella colonna sources (apollo-lookalike SPEC F11)', async () => {
    const { addSource } = await import('../src/db/prospects.js');
    const listId = list(icp());
    const acme = Number(db.prepare('INSERT INTO companies (domain, name) VALUES (?, ?)').run('acme.it', 'Acme').lastInsertRowid);
    const beta = Number(
      db.prepare('INSERT INTO companies (linkedin_url, name) VALUES (?, ?)').run('https://www.linkedin.com/company/beta', 'Beta Srl').lastInsertRowid,
    );
    const anna = prospect({ fullName: 'Anna Apollo', email: 'anna@acme.it' });
    addSource(anna, { kind: 'company_employees', companyId: beta });
    addSource(anna, { kind: 'apollo_people', companyId: acme });
    addMembers(listId, [anna]);

    const created = await json(await send('POST', `/api/lists/${listId}/exports`, {}));
    const [row] = await downloadRows(created.download_url);
    expect(row.sources).toBe('dipendente di Beta Srl; Apollo · Acme');
  });

  it('markContacted:true → i 2 esportati diventano contattato nella stessa transazione; stati successivi o finali restano', async () => {
    const { listId, anna, bruno, carla } = seedList();
    const res = await send('POST', `/api/lists/${listId}/exports`, { hasEmail: true, markContacted: true });
    expect(res.status).toBe(201);
    const created = await json(res);
    expect(created).toMatchObject({ count: 2, mark_contacted: true, counts: { marked_contacted: 2, status_unchanged: 0, excluded_email: 1 } });

    const { getProspect } = await import('../src/db/prospects.js');
    expect(getProspect(anna)!.status).toBe('contattato');
    expect(getProspect(bruno)!.status).toBe('contattato');
    expect(getProspect(carla)!.status).toBe('nuovo');

    // Timeline desc: l'export in cima, poi il cambio stato che lo referenzia.
    const [exportActivity, statusActivity] = getProspect(anna)!.timeline;
    expect(statusActivity).toMatchObject({ kind: 'status_change', from_status: 'nuovo', to_status: 'contattato', list_id: listId, meta: { export_id: created.id } });
    expect(exportActivity).toMatchObject({
      kind: 'export',
      list_id: listId,
      body: `Esportato (lista CTO Milano, export #${created.id})`,
      meta: { export_id: created.id, status_change_id: statusActivity.id },
    });
    const rows = await downloadRows(created.download_url);
    expect(rows.map((r) => r.status)).toEqual(['Contattato', 'Contattato']);

    // Già contattato → nessun cambio; più avanti (risposto) o finale (scartato) → invariato.
    const dario = prospect({ email: 'dario@x.it' });
    const eva = prospect({ email: 'eva@x.it' });
    db.prepare(`UPDATE prospects SET status = 'risposto' WHERE id = ?`).run(dario);
    db.prepare(`UPDATE prospects SET status = 'scartato' WHERE id = ?`).run(eva);
    addMembers(listId, [dario, eva]);
    const again = await json(await send('POST', `/api/lists/${listId}/exports`, { hasEmail: true, markContacted: true }));
    expect(again).toMatchObject({ count: 4, counts: { marked_contacted: 0, status_unchanged: 4 } });
    expect(getProspect(dario)!.status).toBe('risposto');
    expect(getProspect(eva)!.status).toBe('scartato');
    expect(activities(anna, 'status_change')).toHaveLength(1);
    expect(activities(anna, 'export')).toHaveLength(2);
  });

  it('download: text/csv utf-8, attachment con nome della lista e data; storico desc; lista archiviata esportabile', async () => {
    const icpId = icp();
    const listId = list(icpId, 'CTO Milano – Più città');
    const anna = prospect({ fullName: 'Nicolò Bianchi', email: 'nicolo@acme.it' });
    addMembers(listId, [anna]);
    db.prepare('UPDATE lists SET archived_at = ? WHERE id = ?').run(new Date().toISOString(), listId);

    const first = await json(await send('POST', `/api/lists/${listId}/exports`, { status: ['nuovo'], hasEmail: true }));
    const second = await json(await send('POST', `/api/lists/${listId}/exports`, {}));
    expect(second.id).toBeGreaterThan(first.id);

    const res = await send('GET', `/api/exports/${first.id}.csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    const today = new Date().toISOString().slice(0, 10);
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename="cto-milano-piu-citta-${today}-export-${first.id}.csv"`);
    expect((await res.text()).split('\n')[1]).toContain('Nicolò Bianchi');

    const history = await send('GET', `/api/lists/${listId}/exports`);
    expect(history.status).toBe(200);
    const { items } = await json(history);
    expect(items.map((e: any) => e.id)).toEqual([second.id, first.id]);
    expect(items[1]).toEqual({
      id: first.id,
      list_id: listId,
      scope: 'filters',
      filters: { status: ['nuovo'], hasEmail: true },
      selected: null,
      mark_contacted: false,
      count: 1,
      created_at: expect.any(String),
      download_url: `/api/exports/${first.id}.csv`,
    });
    // Export ripetuto: la timeline accumula un'attività per export (FLOW, edge case).
    expect(activities(anna, 'export')).toHaveLength(2);
  });

  it('404 per lista o export inesistenti; nessuna scrittura con ambito vuoto', async () => {
    expect((await send('POST', '/api/lists/999999/exports', {})).status).toBe(404);
    expect((await send('GET', '/api/lists/999999/exports')).status).toBe(404);
    expect((await send('GET', '/api/lists/999999/exports/preview')).status).toBe(404);
    expect((await send('GET', '/api/exports/999999.csv')).status).toBe(404);
    expect((await send('GET', '/api/exports/abc.csv')).status).toBe(404);

    const listId = list(icp());
    const empty = await send('POST', `/api/lists/${listId}/exports`, { hasEmail: true });
    expect(empty.status).toBe(400);
    expect(await json(empty)).toEqual({ error: 'Nessun prospect da esportare con questi filtri.', code: 'empty_export' });
    expect(db.prepare('SELECT COUNT(*) FROM exports').pluck().get()).toBe(0);

    const invalid = await send('POST', `/api/lists/${listId}/exports`, { status: ['boh'] });
    expect(invalid.status).toBe(400);
  });

  it('il CSV riscaricato ripropone gli id dell\'export anche se la lista cambia; i prospect spariti sono saltati', async () => {
    const { listId, anna, bruno, carla } = seedList();
    const created = await json(await send('POST', `/api/lists/${listId}/exports`, { hasEmail: true }));

    const { removeMembers } = await import('../src/db/lists.js');
    removeMembers(listId, [anna]);
    addMembers(listId, [prospect({ email: 'nuovo@x.it' })]);
    db.prepare(`UPDATE prospects SET email = 'carla@x.it' WHERE id = ?`).run(carla);
    db.prepare('DELETE FROM prospects WHERE id = ?').run(bruno);

    const rows = await downloadRows(created.download_url);
    expect(rows.map((r) => r.full_name)).toEqual(['Anna Maria Rossi']);
  });

  it('preview: conteggio vivo del dialog senza scritture, con gli stessi filtri della tabella Lista', async () => {
    const { listId, anna, bruno, carla } = seedList();
    db.prepare(`UPDATE prospects SET status = 'risposto' WHERE id = ?`).run(bruno);
    analysis(anna, db.prepare('SELECT icp_id FROM lists WHERE id = ?').pluck().get(listId) as number, 'alto', 'Riassunto');

    const all = await send('GET', `/api/lists/${listId}/exports/preview?hasEmail=true`);
    expect(all.status).toBe(200);
    expect(await json(all)).toEqual({
      count: 2,
      counts: { in_scope: 3, excluded_email: 1, not_found: 0, not_member: 0, to_mark_contacted: 1 },
    });

    const byStatus = await json(await send('GET', `/api/lists/${listId}/exports/preview?status=nuovo,risposto&hasEmail=false`));
    expect(byStatus).toMatchObject({ count: 1, counts: { in_scope: 3, excluded_email: 2 } });
    expect((await json(await send('GET', `/api/lists/${listId}/exports/preview?fit=alto`))).count).toBe(1);

    const selection = await json(await send('GET', `/api/lists/${listId}/exports/preview?prospectIds=${anna},${carla},999999&hasEmail=true`));
    expect(selection).toEqual({
      count: 1,
      counts: { in_scope: 2, excluded_email: 1, not_found: 1, not_member: 0, to_mark_contacted: 1 },
    });
    const mixed = await send('GET', `/api/lists/${listId}/exports/preview?prospectIds=${anna}&status=nuovo`);
    expect(mixed.status).toBe(400);
    expect(await json(mixed)).toMatchObject({ code: 'selection_with_filters' });
    expect((await send('GET', `/api/lists/${listId}/exports/preview?prospectIds=abc`)).status).toBe(400);

    // Il POST con gli stessi filtri esporta esattamente il conteggio della preview.
    expect((await json(await send('POST', `/api/lists/${listId}/exports`, { fit: ['alto'] }))).count).toBe(1);
    expect(db.prepare('SELECT COUNT(*) FROM exports').pluck().get()).toBe(1);
    expect(activities(anna, 'export')).toHaveLength(1);
  });

  it('export fallito a metà → 500 e nessuna traccia: né riga exports, né attività, né cambi stato', async () => {
    const { listId, anna, bruno } = seedList();
    // Il secondo prospect fa fallire l'INSERT dell'attività export (trigger temporaneo sulla connessione dei test).
    db.exec(`CREATE TEMP TRIGGER boom BEFORE INSERT ON activities WHEN NEW.kind = 'export' AND NEW.prospect_id = ${bruno}
             BEGIN SELECT RAISE(ABORT, 'export simulato in errore'); END;`);
    try {
      const res = await send('POST', `/api/lists/${listId}/exports`, { hasEmail: true, markContacted: true });
      expect(res.status).toBe(500);
    } finally {
      db.exec('DROP TRIGGER IF EXISTS temp.boom');
    }
    expect(db.prepare('SELECT COUNT(*) FROM exports').pluck().get()).toBe(0);
    expect(db.prepare('SELECT COUNT(*) FROM activities').pluck().get()).toBe(0);
    const { getProspect } = await import('../src/db/prospects.js');
    expect([getProspect(anna)!.status, getProspect(bruno)!.status]).toEqual(['nuovo', 'nuovo']);
  });
});
