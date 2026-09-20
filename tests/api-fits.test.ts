import { beforeEach, describe, expect, it } from 'vitest';

// Fit manuale per ICP e fit effettivo (people-first-crm T19, SPEC F1–F10, E6, E9). Import dinamici: la config
// (DB_PATH isolato) è letta a import-time.
const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/server/app.js');
const { upsertProspect } = await import('../src/db/prospects.js');
const { createIcp } = await import('../src/db/icps.js');
const { createList, addMembers } = await import('../src/db/lists.js');
const { mergePeopleAuto } = await import('../src/db/person-merge.js');

const app = createApp();

async function send(method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text.startsWith('{') ? JSON.parse(text) : text } as { status: number; body: any };
}

let seq = 0;
function person(fullName?: string): number {
  seq += 1;
  return upsertProspect({ linkedinUrl: `https://www.linkedin.com/in/fit-${seq}`, fullName: fullName ?? `Persona ${seq}` }).id;
}
function withoutLinkedin(email: string): number {
  return Number(db.prepare(`INSERT INTO prospects (full_name, email) VALUES ('Senza LinkedIn', ?)`).run(email).lastInsertRowid);
}
/** Analisi AI salvata (`at` = quando). */
function analysis(prospectId: number, icpId: number, fit: string, at = new Date().toISOString()): void {
  db.prepare(
    `INSERT INTO analyses (prospect_id, icp_id, model, summary, angles, fit, fit_reason, input_hash, created_at)
     VALUES (?, ?, 'm', 'riassunto', '[]', ?, NULL, 'h', ?)`,
  ).run(prospectId, icpId, fit, at);
}
/** Tentativo di analisi fallito (attività `analysis` con `meta.error`). */
function failure(prospectId: number, icpId: number, at: string): void {
  db.prepare(
    `INSERT INTO activities (prospect_id, kind, body, meta, occurred_at, created_at) VALUES (?, 'analysis', 'errore', ?, ?, ?)`,
  ).run(prospectId, JSON.stringify({ icp_id: icpId, error: 'Timeout del modello', error_kind: 'error' }), at, at);
}
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

async function row(id: number, icpId: number) {
  const page = await send('GET', `/api/prospects?icpId=${icpId}&pageSize=100`);
  expect(page.status).toBe(200);
  return page.body.items.find((r: any) => r.id === id);
}
async function idsWithFit(icpId: number, fit: string): Promise<number[]> {
  return (await send('GET', `/api/prospects?icpId=${icpId}&fit=${fit}&pageSize=100`)).body.items.map((r: any) => r.id);
}
const fitChanges = (id: number) =>
  (db.prepare(`SELECT body, meta FROM activities WHERE prospect_id = ? AND kind = 'fit_change' ORDER BY id`).all(id) as Array<{ body: string | null; meta: string }>).map(
    (a) => ({ body: a.body, meta: JSON.parse(a.meta) }),
  );

beforeEach(() => {
  db.exec('DELETE FROM prospects; DELETE FROM lists; DELETE FROM icps; DELETE FROM companies;');
});

describe('fit manuale e fit effettivo (F1–F7)', () => {
  it('PUT alto su AI medio → riga "alto · tuo" e filtro alto; una nuova analisi non lo cambia; DELETE → "medio · AI"; due fit_change', async () => {
    const icp = createIcp({ name: 'CTO startup IT' });
    const id = person('Giulia Neri');
    analysis(id, icp.id, 'medio', ago(10));

    const set = await send('PUT', `/api/prospects/${id}/fits/${icp.id}`, { fit: 'alto', reason: 'Conosciuta al DevFest: decide lei' });
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({
      fit_state: 'alto',
      fit_origin: 'tuo',
      manual_fit: { icp_id: icp.id, icp_name: 'CTO startup IT', fit: 'alto', reason: 'Conosciuta al DevFest: decide lei' },
    });
    expect(set.body.manual_fit.set_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await row(id, icp.id)).toMatchObject({ fit_state: 'alto', fit_origin: 'tuo', analysis_state: 'medio', manual_fit: { fit: 'alto' } });
    expect(await idsWithFit(icp.id, 'alto')).toEqual([id]);
    expect(await idsWithFit(icp.id, 'medio')).toEqual([]);

    // F5: la nuova analisi dell'AI compare accanto, il fit manuale resta.
    analysis(id, icp.id, 'basso');
    expect(await row(id, icp.id)).toMatchObject({ fit_state: 'alto', fit_origin: 'tuo', analysis_state: 'basso' });

    const removed = await send('DELETE', `/api/prospects/${id}/fits/${icp.id}`);
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ fit_state: 'basso', fit_origin: 'ai', manual_fit: null });
    expect(await row(id, icp.id)).toMatchObject({ fit_state: 'basso', fit_origin: 'ai', manual_fit: null });

    expect(fitChanges(id)).toEqual([
      { body: 'Conosciuta al DevFest: decide lei', meta: { icp_id: icp.id, icp_name: 'CTO startup IT', from: null, to: 'alto' } },
      { body: null, meta: { icp_id: icp.id, icp_name: 'CTO startup IT', from: 'alto', to: null } },
    ]);
    // Rimuovere un fit che non c'è non scrive nulla.
    expect((await send('DELETE', `/api/prospects/${id}/fits/${icp.id}`)).status).toBe(200);
    expect(fitChanges(id)).toHaveLength(2);
  });

  it('Cambia: medio → alto con motivazione nuova; stesso valore e stessa motivazione = nessuna voce; stato e liste invariati', async () => {
    const icp = createIcp({ name: 'CTO startup IT' });
    const list = createList({ icpId: icp.id, name: 'Eventi' })!;
    const id = person();
    addMembers(list.id, [id]);
    await send('PUT', `/api/prospects/${id}/fits/${icp.id}`, { fit: 'medio' });
    await send('PUT', `/api/prospects/${id}/fits/${icp.id}`, { fit: 'medio' });
    const changed = await send('PUT', `/api/prospects/${id}/fits/${icp.id}`, { fit: 'alto', reason: '  Ha budget  ' });
    expect(changed.body.manual_fit).toMatchObject({ fit: 'alto', reason: 'Ha budget' });
    expect(fitChanges(id).map((a) => [a.meta.from, a.meta.to, a.body])).toEqual([
      [null, 'medio', null],
      ['medio', 'alto', 'Ha budget'],
    ]);
    const detail = (await send('GET', `/api/prospects/${id}`)).body;
    expect(detail.status).toBe('nuovo');
    expect(detail.memberships.map((m: any) => m.list_id)).toEqual([list.id]);
    expect(detail.manual_fits).toEqual([expect.objectContaining({ icp_id: icp.id, icp_name: 'CTO startup IT', fit: 'alto', reason: 'Ha budget' })]);
  });

  it('F1: vale anche senza arricchimento, analisi né LinkedIn; 404 persona o ICP, 400 valore non valido', async () => {
    const icp = createIcp({ name: 'CFO' });
    const id = withoutLinkedin('sara@pagamenti.it');
    expect(await row(id, icp.id)).toMatchObject({ fit_state: null, fit_origin: null });
    const set = await send('PUT', `/api/prospects/${id}/fits/${icp.id}`, { fit: 'basso' });
    expect(set.status).toBe(200);
    expect(await row(id, icp.id)).toMatchObject({ fit_state: 'basso', fit_origin: 'tuo', analysis_state: null });

    expect(await send('PUT', `/api/prospects/999999/fits/${icp.id}`, { fit: 'alto' })).toMatchObject({ status: 404, body: { error: 'Persona non trovata.' } });
    expect(await send('PUT', `/api/prospects/${id}/fits/999999`, { fit: 'alto' })).toMatchObject({ status: 404, body: { error: 'ICP non trovato.' } });
    expect(await send('DELETE', `/api/prospects/${id}/fits/999999`)).toMatchObject({ status: 404 });
    expect((await send('PUT', `/api/prospects/${id}/fits/${icp.id}`, { fit: 'altissimo' })).status).toBe(400);
    expect((await send('PUT', `/api/prospects/${id}/fits/${icp.id}`, { fit: 'alto', extra: 1 })).status).toBe(400);
  });

  it('F3: gli stati di errore dell\'AI valgono solo senza fit manuale; il filtro segue la colonna', async () => {
    const icp = createIcp({ name: 'CTO' });
    const failed = person();
    analysis(failed, icp.id, 'medio', ago(20));
    failure(failed, icp.id, ago(5));
    const other = person();
    failure(other, icp.id, ago(5));
    expect(await row(failed, icp.id)).toMatchObject({ fit_state: 'errore', fit_origin: 'ai', analysis_state: 'errore' });
    expect((await idsWithFit(icp.id, 'errore')).sort()).toEqual([failed, other].sort());

    await send('PUT', `/api/prospects/${failed}/fits/${icp.id}`, { fit: 'alto' });
    // F4: l'errore dell'AI resta leggibile (`analysis_state`) accanto al fit tuo.
    expect(await row(failed, icp.id)).toMatchObject({ fit_state: 'alto', fit_origin: 'tuo', analysis_state: 'errore' });
    expect(await idsWithFit(icp.id, 'errore')).toEqual([other]);
    expect(await idsWithFit(icp.id, 'none')).toEqual([]);
  });

  it('F2: ordinamento per fit effettivo ed export CSV con fit effettivo e origine', async () => {
    const icp = createIcp({ name: 'CTO' });
    const list = createList({ icpId: icp.id, name: 'Export fit' })!;
    const aiMedio = person('Ai Medio');
    analysis(aiMedio, icp.id, 'medio');
    const tuoAlto = person('Tuo Alto');
    analysis(tuoAlto, icp.id, 'basso');
    const tuoBasso = person('Tuo Basso');
    analysis(tuoBasso, icp.id, 'alto');
    const nulla = person('Nessun Fit');
    addMembers(list.id, [aiMedio, tuoAlto, tuoBasso, nulla]);
    await send('PUT', `/api/prospects/${tuoAlto}/fits/${icp.id}`, { fit: 'alto' });
    await send('PUT', `/api/prospects/${tuoBasso}/fits/${icp.id}`, { fit: 'basso' });

    const sorted = (await send('GET', `/api/prospects?icpId=${icp.id}&sort=fit`)).body.items.map((r: any) => r.id);
    expect(sorted).toEqual([tuoAlto, aiMedio, tuoBasso, nulla]);

    const created = await send('POST', `/api/lists/${list.id}/exports`, {});
    expect(created.status).toBe(201);
    const [header, ...lines] = (await send('GET', `/api/exports/${created.body.id}.csv`)).body.trim().split('\n');
    const cols = header.split(',');
    expect(cols.slice(cols.indexOf('fit'), cols.indexOf('fit') + 2)).toEqual(['fit', 'fit_origin']);
    const byName = new Map(lines.map((l: string) => {
      const cells = l.split(',');
      return [cells[0], { fit: cells[cols.indexOf('fit')], origin: cells[cols.indexOf('fit_origin')] }];
    }));
    expect(byName.get('Tuo Alto')).toEqual({ fit: 'alto', origin: 'tuo' });
    expect(byName.get('Ai Medio')).toEqual({ fit: 'medio', origin: 'AI' });
    expect(byName.get('Tuo Basso')).toEqual({ fit: 'basso', origin: 'tuo' });
    expect(byName.get('Nessun Fit')).toEqual({ fit: '', origin: '' });
  });

  it('F8: "da aggiornare" resta dell\'AI; la card legge il fit tuo dell\'ICP', async () => {
    const icp = createIcp({ name: 'CTO' });
    const id = person();
    analysis(id, icp.id, 'medio');
    await send('PUT', `/api/prospects/${id}/fits/${icp.id}`, { fit: 'alto', reason: 'Lo conosco' });
    const card = await send('GET', `/api/prospects/${id}/analyses?icpId=${icp.id}`);
    expect(card.status).toBe(200);
    expect(card.body).toMatchObject({ state: 'medio', manual_fit: { fit: 'alto', reason: 'Lo conosco' } });
    expect(card.body.stale).toBe(true);
  });

  it('F10: il dettaglio ICP conta i fit manuali; eliminando l\'ICP spariscono', async () => {
    const icp = createIcp({ name: 'Da eliminare' });
    const keep = createIcp({ name: 'Resta' });
    const a = person();
    const b = person();
    await send('PUT', `/api/prospects/${a}/fits/${icp.id}`, { fit: 'alto' });
    await send('PUT', `/api/prospects/${b}/fits/${icp.id}`, { fit: 'medio' });
    await send('PUT', `/api/prospects/${a}/fits/${keep.id}`, { fit: 'basso' });
    expect((await send('GET', `/api/icps/${icp.id}`)).body.manual_fits_count).toBe(2);
    expect((await send('GET', `/api/icps/${keep.id}`)).body.manual_fits_count).toBe(1);

    expect((await send('DELETE', `/api/icps/${icp.id}`)).status).toBe(200);
    expect(db.prepare('SELECT icp_id FROM manual_fits ORDER BY icp_id').pluck().all()).toEqual([keep.id]);
  });
});

describe('fit manuale nelle unioni (E6, E9)', () => {
  const setAt = (prospectId: number, icpId: number, at: string) =>
    db.prepare('UPDATE manual_fits SET set_at = ? WHERE prospect_id = ? AND icp_id = ?').run(at, prospectId, icpId);
  const fitsOf = (id: number) =>
    Object.fromEntries((db.prepare('SELECT icp_id, fit FROM manual_fits WHERE prospect_id = ?').all(id) as Array<{ icp_id: number; fit: string }>).map((r) => [r.icp_id, r.fit]));

  it('automatica (E9): per ogni ICP vince il fit impostato più di recente, gli ICP mancanti si aggiungono', async () => {
    const one = createIcp({ name: 'Uno' });
    const two = createIcp({ name: 'Due' });
    const three = createIcp({ name: 'Tre' });
    const keep = person();
    const drop = person();
    await send('PUT', `/api/prospects/${keep}/fits/${one.id}`, { fit: 'medio' });
    await send('PUT', `/api/prospects/${drop}/fits/${one.id}`, { fit: 'alto' });
    await send('PUT', `/api/prospects/${keep}/fits/${two.id}`, { fit: 'basso' });
    await send('PUT', `/api/prospects/${drop}/fits/${two.id}`, { fit: 'alto' });
    await send('PUT', `/api/prospects/${drop}/fits/${three.id}`, { fit: 'medio' });
    setAt(keep, one.id, ago(30));
    setAt(drop, one.id, ago(10));
    setAt(keep, two.id, ago(5));
    setAt(drop, two.id, ago(50));

    mergePeopleAuto(keep, drop);
    expect(fitsOf(keep)).toEqual({ [one.id]: 'alto', [two.id]: 'basso', [three.id]: 'medio' });
  });

  it('manuale (E6): resta il fit della persona tenuta, l\'altra riempie gli ICP mancanti; conflitto in anteprima', async () => {
    const one = createIcp({ name: 'CTO startup IT' });
    const two = createIcp({ name: 'CFO' });
    const keep = person();
    const other = withoutLinkedin('altra@esempio.it');
    await send('PUT', `/api/prospects/${keep}/fits/${one.id}`, { fit: 'medio' });
    await send('PUT', `/api/prospects/${other}/fits/${one.id}`, { fit: 'alto' });
    await send('PUT', `/api/prospects/${other}/fits/${two.id}`, { fit: 'basso' });
    setAt(keep, one.id, ago(60));

    const preview = await send('GET', `/api/prospects/${keep}/merge-preview?otherId=${other}`);
    expect(preview.status).toBe(200);
    expect(preview.body.conflicts).toContainEqual({ field: 'manual_fit', label: "Fit tuo per 'CTO startup IT'", keep: 'medio', lose: 'alto' });
    expect(preview.body.filled).toContain('manual_fit');

    expect((await send('POST', `/api/prospects/${keep}/merge`, { otherId: other })).status).toBe(200);
    expect(fitsOf(keep)).toEqual({ [one.id]: 'medio', [two.id]: 'basso' });
  });
});
