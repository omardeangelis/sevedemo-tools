import { beforeEach, describe, expect, it } from 'vitest';

// La proposta di profilo e servizi (own-profile-services T27–T28: E3, E4, E7–E12, G-11, H3, H5; revisione 2026-10-03):
// confronto ricalcolato a ogni lettura (P-12) per le voci da decidere, conflitti con ciò che è scritto a mano, e le
// decisioni voce per voce — applica (anche con il testo dell'utente), rifiuta, annulla —, salvate con la proposta, che
// si chiude da sé quando non resta niente da decidere. Import dinamici: la config (DB_PATH isolato da tests/setup.ts) è
// letta a import-time.
const { createApp } = await import('../src/server/app.js');
const { db } = await import('../src/db/index.js');
const { updateSettings } = await import('../src/db/settings.js');
const { createService, deleteService, listServices } = await import('../src/db/services.js');
const { saveProposal } = await import('../src/profile/generate.js');

const app = createApp();

async function send(method: string, url: string, body?: unknown) {
  const res = await app.request(url, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
  });
  return { status: res.status, body: (await res.json()) as any };
}

const READ = [
  { kind: 'linkedin', outcome: 'read', reused: false, reason: null, content: 'x', readAt: '2026-10-02T09:00:00.000Z', meta: {}, warnings: [] },
  { kind: 'website', outcome: 'read', reused: false, reason: null, content: 'x', readAt: '2026-10-02T09:00:00.000Z', meta: {}, warnings: [] },
  { kind: 'posts', outcome: 'unavailable', reused: false, reason: 'Nessun post sincronizzato.', content: null, readAt: '2026-10-02T09:00:00.000Z', meta: {}, warnings: [] },
] as const;

const v = (value: string, sources: Array<'linkedin' | 'website' | 'posts'> = ['website']) => ({ value, sources });
const svc = (name: string, extra: Record<string, string | null> = {}) => ({
  name,
  description: null,
  audience: null,
  problem: null,
  proof: null,
  ...extra,
  sources: ['website' as const],
});

const FIELDS = {
  company_name: v('Marta Fiorini', ['linkedin']),
  company_description: v('Product engineering freelance per startup B2B.'),
  company_offering: v('MVP in sei settimane e affiancamento del primo CTO.'),
  positioning: v('La product engineer del primo prodotto.', ['linkedin', 'website']),
  proof_points: v('14 MVP in quattro anni.'),
  tone_of_voice: v('Diretto e concreto.'),
};

function propose(fields: Record<string, unknown> = FIELDS, services: unknown[] = [svc('MVP in sei settimane', { audience: 'Startup B2B' })]) {
  return saveProposal({ fields, services, discarded: [{ kind: 'field', name: 'x', reason: 'no_source' }] } as never, READ as never, 'claude-opus-5');
}

const proposal = () => send('GET', '/api/profile/proposal');
const statusOf = (body: any) => ({
  fields: Object.fromEntries(body.fields.map((f: any) => [f.key, f.status])),
  services: Object.fromEntries(body.services.map((s: any) => [s.name, s.status])),
});

beforeEach(() => {
  db.exec(`DELETE FROM settings; DELETE FROM profile_field_origin; DELETE FROM services; DELETE FROM profile_proposals;`);
});

describe('GET /api/profile/proposal: sola lettura, confronto adesso (E3, E4, E9, P-12)', () => {
  it('senza proposta ⇒ 404 "Nessuna proposta in attesa."', async () => {
    const res = await proposal();
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Nessuna proposta in attesa.', code: 'no_proposal' });
  });

  it('profilo vuoto ⇒ tutte le voci nuove e applicabili, zero conflitti; ogni riga con il valore attuale e le fonti', async () => {
    const id = propose();
    const { status, body } = await proposal();
    expect(status).toBe(200);
    expect(body).toMatchObject({ id, model: 'claude-opus-5', discarded: [{ kind: 'field', name: 'x', reason: 'no_source' }] });
    expect(body.sources.map((s: any) => [s.kind, s.outcome])).toEqual([
      ['linkedin', 'read'],
      ['website', 'read'],
      ['posts', 'unavailable'],
    ]);
    expect(body.fields[0]).toEqual({
      key: 'company_name',
      status: 'new',
      current: null,
      current_origin: null,
      current_origin_at: null,
      proposed: 'Marta Fiorini',
      sources: ['linkedin'],
      decision: null,
    });
    expect(body.services).toEqual([
      {
        name: 'MVP in sei settimane',
        status: 'new',
        existing: null,
        proposed: { description: null, audience: 'Startup B2B', problem: null, proof: null },
        changed_fields: ['audience'],
        sources: ['website'],
        decision: null,
      },
    ]);
    expect(body.open).toBe(true);
    expect(body.summary).toEqual({
      total: 7,
      decided: 0,
      to_decide: 7,
      conflicts: 0,
      applicable: 7,
      unchanged: 0,
      applied: 0,
      edited: 0,
      rejected: 0,
      without_origin: [],
    });
    expect(body.apply_all).toEqual({ count: 7, disabled_reason: null });
  });

  it('tdd_target: su un profilo con due campi scritti a mano, la lettura li marca come conflitti e lascia applicabili gli altri', async () => {
    await send('PUT', '/api/settings', { positioning: 'Il mio posizionamento.', tone_of_voice: 'Il mio tono.' });
    propose();
    const { body } = await proposal();
    expect(statusOf(body).fields).toEqual({
      company_name: 'new',
      company_description: 'new',
      company_offering: 'new',
      positioning: 'conflict',
      proof_points: 'new',
      tone_of_voice: 'conflict',
    });
    expect(body.fields.find((f: any) => f.key === 'positioning')).toMatchObject({
      current: 'Il mio posizionamento.',
      current_origin: 'manual',
      current_origin_at: expect.stringMatching(/^\d{4}-/),
    });
    expect(body.summary).toMatchObject({ conflicts: 2, to_decide: 7, applicable: 5 });
    expect(body.apply_all).toEqual({ count: 5, disabled_reason: null });
  });

  it('G-11: i tre campi legacy valorizzati non sono conflitti, e la risposta li nomina (finding 5)', async () => {
    updateSettings({ company_name: 'Officina', company_description: 'Software su misura.', company_offering: 'Assessment.' });
    propose();
    const { body } = await proposal();
    expect(statusOf(body).fields).toMatchObject({ company_name: 'changed', company_description: 'changed', company_offering: 'changed' });
    expect(body.summary).toMatchObject({ conflicts: 0, without_origin: ['company_name', 'company_description', 'company_offering'] });
  });

  it('un valore uguale è invariato (a meno di spazi ai bordi) e non conta fra le voci da rivedere', async () => {
    await send('PUT', '/api/settings', { proof_points: '14 MVP in quattro anni.' });
    propose({ ...FIELDS, proof_points: v('  14 MVP in quattro anni. ') });
    const { body } = await proposal();
    expect(statusOf(body).fields.proof_points).toBe('unchanged');
    expect(body.summary).toMatchObject({ unchanged: 1, conflicts: 0 });
  });

  it('servizi: eliminato dopo la generazione ⇒ di nuovo "nuovo"; scritto a mano e diverso ⇒ conflitto; uguale ⇒ invariato', async () => {
    const mvp = createService({ name: 'MVP in sei settimane' });
    createService({ name: 'Revisione architetturale', audience: 'Team che crescono' });
    propose(FIELDS, [
      svc('mvp in sei SETTIMANE', { audience: 'Startup B2B' }),
      svc('Revisione architetturale', { audience: 'Team che crescono' }),
    ]);

    let body = (await proposal()).body;
    expect(statusOf(body).services).toEqual({ 'mvp in sei SETTIMANE': 'conflict', 'Revisione architetturale': 'unchanged' });
    const conflict = body.services[0];
    expect(conflict.existing).toMatchObject({ id: mvp.id, name: 'MVP in sei settimane', origin: 'manual' });
    expect(conflict.changed_fields).toEqual(['audience']);

    deleteService(mvp.id);
    body = (await proposal()).body;
    expect(statusOf(body).services['mvp in sei SETTIMANE']).toBe('new');
    expect(listServices()).toHaveLength(1);
  });

  it('tutte le voci da decidere in conflitto ⇒ l\'azione di massa non si può usare, e la risposta dice perché', async () => {
    await send('PUT', '/api/settings', { positioning: 'Mio.' });
    propose({ positioning: FIELDS.positioning }, []);
    expect((await proposal()).body.apply_all).toEqual({
      count: 0,
      disabled_reason: 'La voce rimasta cambierebbe un testo scritto da te: decidila da sola.',
    });
    await send('PUT', '/api/settings', { tone_of_voice: 'Il mio tono.' });
    propose({ positioning: FIELDS.positioning, tone_of_voice: FIELDS.tone_of_voice }, []);
    expect((await proposal()).body.apply_all.disabled_reason).toBe('Le 2 voci rimaste cambierebbero testi scritti da te: decidile una per una.');
  });

  it('GET /api/profile porta la proposta aperta (id, data, voci da decidere) e l\'ultima proposta, e non scrive niente', async () => {
    const id = propose();
    const profile = (await send('GET', '/api/profile')).body;
    expect(profile.pending_proposal).toEqual({ id, created_at: expect.stringMatching(/^\d{4}-/), model: 'claude-opus-5', to_decide: 7, conflicts: 0 });
    expect(profile.last_proposal).toMatchObject({ id, open: true, summary: { to_decide: 7, decided: 0 } });
    expect(profile.fields.positioning.value).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Applica, applica tutto e corse (E7, E8, E10, E11, H3, H5 — T28; rev. 2026-10-03: ogni voce applicata è una decisione)
// ---------------------------------------------------------------------------

const { getSettings } = await import('../src/db/settings.js');

const apply = (body: Record<string, unknown>) => send('POST', '/api/profile/proposal/apply', body);
const origins = () =>
  Object.fromEntries((db.prepare(`SELECT field, origin FROM profile_field_origin`).all() as Array<{ field: string; origin: string }>).map((r) => [r.field, r.origin]));

describe('POST /api/profile/proposal/apply (T28)', () => {
  it('tdd_target: su un profilo con due campi scritti a mano, apply {all:true} applica solo gli altri e lascia i due come conflitti', async () => {
    await send('PUT', '/api/settings', { positioning: 'Il mio posizionamento.', tone_of_voice: 'Il mio tono.' });
    const id = propose();

    const res = await apply({ proposal_id: id, all: true });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ applied: 5, fields: 4, services: 1 });
    const settings = getSettings();
    expect(settings.positioning).toBe('Il mio posizionamento.');
    expect(settings.tone_of_voice).toBe('Il mio tono.');
    expect(settings.company_name).toBe('Marta Fiorini');
    expect(origins()).toMatchObject({ positioning: 'manual', tone_of_voice: 'manual', company_name: 'proposal', proof_points: 'proposal' });
    expect(listServices().map((s) => [s.name, s.origin])).toEqual([['MVP in sei settimane', 'proposal']]);
    // La proposta resta aperta (E10) con i due conflitti da decidere; le altre sono decise, con lo stato di allora.
    const decisionOf = (key: string) => res.body.proposal.fields.find((f: any) => f.key === key).decision;
    expect(decisionOf('positioning')).toBeNull();
    expect(decisionOf('company_name')).toMatchObject({ decision: 'applied', status: 'new', value: 'Marta Fiorini', before: { value: null, origin: null } });
    expect(res.body.proposal).toMatchObject({ open: true, summary: { conflicts: 2, to_decide: 2, applicable: 0, decided: 5, applied: 5, total: 7 } });
  });

  it('un campo applicato è scritto "dalla proposta" e resta una decisione; un conflitto si sostituisce solo uno per uno', async () => {
    await send('PUT', '/api/settings', { positioning: 'Il mio posizionamento.' });
    const id = propose();

    const one = await apply({ proposal_id: id, field: 'proof_points', expected_status: 'new' });
    expect(one.status).toBe(200);
    expect(getSettings().proof_points).toBe('14 MVP in quattro anni.');
    expect(origins().proof_points).toBe('proposal');
    expect(one.body.proposal.fields.find((f: any) => f.key === 'proof_points')).toMatchObject({ status: 'new', decision: { decision: 'applied' } });
    // Le decisioni sono salvate con la proposta: una rilettura (un ricarico) le ritrova.
    expect((await proposal()).body.summary).toMatchObject({ decided: 1, applied: 1, to_decide: 6 });

    const replaced = await apply({ proposal_id: id, field: 'positioning', expected_status: 'conflict' });
    expect(replaced.status).toBe(200);
    expect(getSettings().positioning).toBe('La product engineer del primo prodotto.');
    expect(origins().positioning).toBe('proposal');
    // Il testo sostituito resta nella decisione, con la sua provenienza: "prima: …" e Annulla (rev. 2026-10-03).
    expect(replaced.body.proposal.fields.find((f: any) => f.key === 'positioning').decision).toMatchObject({
      decision: 'applied',
      status: 'conflict',
      before: { value: 'Il mio posizionamento.', origin: 'manual', origin_at: expect.stringMatching(/^\d{4}-/) },
    });
  });

  it('E7: un servizio modificato applicato aggiorna solo i campi proposti; nome e note restano dell\'utente', async () => {
    const existing = createService({ name: 'MVP in sei settimane', notes: 'Le mie note.', proof: 'Le mie prove.' });
    db.prepare(`UPDATE services SET origin = 'proposal'`).run();
    const id = propose(FIELDS, [svc('mvp IN SEI settimane', { audience: 'Startup B2B', problem: 'Primo cliente pagante' })]);

    const res = await apply({ proposal_id: id, service: 'mvp IN SEI settimane', expected_status: 'changed' });

    expect(res.status).toBe(200);
    const [after] = listServices();
    expect(after).toMatchObject({
      id: existing.id,
      name: 'MVP in sei settimane',
      audience: 'Startup B2B',
      problem: 'Primo cliente pagante',
      proof: 'Le mie prove.',
      notes: 'Le mie note.',
      origin: 'proposal',
    });
  });

  it('un servizio nuovo si aggiunge in fondo (B4), con la provenienza della proposta', async () => {
    createService({ name: 'Revisione architetturale' });
    const id = propose(FIELDS, [svc('MVP in sei settimane', { audience: 'Startup B2B' })]);
    await apply({ proposal_id: id, service: 'MVP in sei settimane', expected_status: 'new' });
    expect(listServices().map((s) => [s.name, s.position, s.origin])).toEqual([
      ['Revisione architetturale', 1, 'manual'],
      ['MVP in sei settimane', 2, 'proposal'],
    ]);
  });

  it('G-11: "Applica tutto" sostituisce i tre campi legacy senza provenienza', async () => {
    updateSettings({ company_name: 'Officina', company_description: 'Software su misura.', company_offering: 'Assessment.' });
    const id = propose();
    await apply({ proposal_id: id, all: true });
    expect(getSettings()).toMatchObject({ company_name: 'Marta Fiorini', company_offering: 'MVP in sei settimane e affiancamento del primo CTO.' });
  });

  it('applicato tutto ciò che c\'era da decidere, la proposta si chiude da sé ma resta l\'ultima (A.7)', async () => {
    const id = propose();
    const res = await apply({ proposal_id: id, all: true });
    expect(res.body).toMatchObject({ applied: 7, fields: 6, services: 1, proposal: { id, open: false, summary: { to_decide: 0, applied: 7 } } });
    expect((await proposal()).body).toMatchObject({ id, open: false });
    const profile = (await send('GET', '/api/profile')).body;
    expect(profile.pending_proposal).toBeNull();
    expect(profile.last_proposal).toMatchObject({ id, open: false, summary: { decided: 7, applied: 7 } });
  });

  it('una voce già decisa (in un\'altra scheda) non si decide di nuovo: 409 `item_decided`, nulla scritto', async () => {
    const id = propose();
    await send('POST', '/api/profile/proposal/reject', { proposal_id: id, field: 'company_name' });
    const res = await apply({ proposal_id: id, field: 'company_name', expected_status: 'new' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Questa voce l'hai già decisa in un'altra scheda: la pagina si aggiorna.", code: 'item_decided' });
    expect(getSettings().company_name).toBeNull();
  });

  it('una nuova generazione sostituisce la proposta: le decisioni della vecchia non passano alla nuova (E11, OQ-R1)', async () => {
    const first = propose();
    await send('POST', '/api/profile/proposal/reject', { proposal_id: first, field: 'company_name' });
    const second = propose();
    const { body } = await proposal();
    expect(body.id).toBe(second);
    expect(body.fields.find((f: any) => f.key === 'company_name')).toMatchObject({ status: 'new', decision: null });
  });

  it('una proposta non più corrente ⇒ 409 `proposal_stale`, nulla scritto (due schede)', async () => {
    const old = propose();
    propose({ company_name: v('Altro nome', ['linkedin']) }, []);
    const res = await apply({ proposal_id: old, field: 'company_name' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Questa proposta non è più quella corrente: la pagina si aggiorna.', code: 'proposal_stale' });
    expect(getSettings().company_name).toBeNull();
  });

  it('un servizio eliminato nel frattempo ⇒ 409 `item_changed` col suo testo, e alla rilettura torna "nuovo"', async () => {
    const existing = createService({ name: 'MVP in sei settimane' });
    db.prepare(`UPDATE services SET origin = 'proposal'`).run();
    const id = propose();
    deleteService(existing.id);

    const res = await apply({ proposal_id: id, service: 'MVP in sei settimane', expected_status: 'changed' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      error: 'Il servizio «MVP in sei settimane» non è più nel CRM: la voce torna «Nuovo».',
      code: 'item_changed',
    });
    expect(listServices()).toEqual([]);
    expect(statusOf((await proposal()).body).services['MVP in sei settimane']).toBe('new');
  });

  it('un campo scritto a mano dopo la lettura della proposta non si sovrascrive senza saperlo', async () => {
    const id = propose();
    await send('PUT', '/api/settings', { positioning: 'Scritto ora a mano.' });
    const res = await apply({ proposal_id: id, field: 'positioning', expected_status: 'new' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'item_changed', error: 'La voce è cambiata dopo che l\'hai vista: ora è «In conflitto».' });
    expect(getSettings().positioning).toBe('Scritto ora a mano.');
  });

  it('voce inesistente o richiesta mal formata ⇒ 404 / 400', async () => {
    const id = propose();
    expect((await apply({ proposal_id: id, field: 'tone_of_voice_x' })).status).toBe(400);
    expect((await apply({ proposal_id: id, service: 'Non proposto' })).status).toBe(404);
    expect((await apply({ proposal_id: id })).status).toBe(400);
    expect((await apply({ proposal_id: id, field: 'company_name', all: true })).status).toBe(400);
    expect((await apply({ proposal_id: id, all: true, value: 'x' })).status).toBe(400);
    expect((await apply({ proposal_id: id, service: 'MVP in sei settimane', value: 'x' })).status).toBe(400);
    expect((await apply({ proposal_id: id, field: 'company_name', except: ['field:positioning'] })).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Rifiuta, Modifica, Annulla (FLOW C rev. 2026-10-03: ogni voce si decide da sola e ogni decisione si annulla)
// ---------------------------------------------------------------------------

const reject = (body: Record<string, unknown>) => send('POST', '/api/profile/proposal/reject', body);
const undo = (body: Record<string, unknown>) => send('POST', '/api/profile/proposal/undo', body);
const fieldOf = (body: any, key: string) => body.proposal.fields.find((f: any) => f.key === key);
const serviceOf = (body: any, name: string) => body.proposal.services.find((s: any) => s.name === name);

describe('POST /api/profile/proposal/reject (E12 per voce e in blocco)', () => {
  it('tdd_target: rifiutare una voce non scrive niente, la chiude come "rifiutata" e la toglie dalle azioni di massa', async () => {
    updateSettings({ company_name: 'Officina Codice' });
    const id = propose();

    const res = await reject({ proposal_id: id, field: 'company_name', expected_status: 'changed' });

    expect(res.status).toBe(200);
    expect(res.body.rejected).toBe(1);
    expect(getSettings().company_name).toBe('Officina Codice');
    expect(fieldOf(res.body, 'company_name').decision).toMatchObject({
      decision: 'rejected',
      status: 'changed',
      value: null,
      before: { value: 'Officina Codice', origin: null },
    });
    expect(res.body.proposal).toMatchObject({ open: true, summary: { decided: 1, rejected: 1, to_decide: 6, applicable: 6 } });
    // "Applica le 6 voci rimaste" non tocca la voce rifiutata.
    await apply({ proposal_id: id, all: true });
    expect(getSettings().company_name).toBe('Officina Codice');
  });

  it('rifiutare un conflitto è "tieni il tuo testo": il testo scritto a mano resta, con la sua provenienza', async () => {
    await send('PUT', '/api/settings', { positioning: 'Il mio posizionamento.' });
    const id = propose({ positioning: FIELDS.positioning }, []);
    const before = origins();

    const res = await reject({ proposal_id: id, field: 'positioning', expected_status: 'conflict' });

    expect(fieldOf(res.body, 'positioning').decision).toMatchObject({ decision: 'rejected', status: 'conflict' });
    expect(getSettings().positioning).toBe('Il mio posizionamento.');
    expect(origins()).toEqual(before);
    // Era l'unica voce: la proposta si chiude da sé.
    expect(res.body.proposal.open).toBe(false);
    expect((await send('GET', '/api/profile')).body.pending_proposal).toBeNull();
  });

  it('rifiuta in blocco tutte le voci da decidere, conflitti compresi, tranne quelle in Modifica: nessun valore cambia', async () => {
    await send('PUT', '/api/settings', { positioning: 'Il mio posizionamento.' });
    const id = propose();
    await apply({ proposal_id: id, field: 'proof_points', expected_status: 'new' });
    const settings = getSettings();

    const res = await reject({ proposal_id: id, all: true, except: ['field:tone_of_voice'] });

    expect(res.body.rejected).toBe(5);
    expect(getSettings()).toEqual(settings);
    expect(listServices()).toEqual([]);
    expect(fieldOf(res.body, 'proof_points').decision.decision).toBe('applied');
    expect(fieldOf(res.body, 'tone_of_voice').decision).toBeNull();
    expect(res.body.proposal).toMatchObject({ open: true, summary: { to_decide: 1, applied: 1, rejected: 5 } });

    const last = await reject({ proposal_id: id, all: true });
    expect(last.body).toMatchObject({ rejected: 1, proposal: { open: false } });
  });

  it('una proposta non più corrente non si rifiuta: 409 `proposal_stale`, la nuova resta intatta', async () => {
    const old = propose();
    const current = propose();
    expect((await reject({ proposal_id: old, all: true })).body.code).toBe('proposal_stale');
    expect((await proposal()).body).toMatchObject({ id: current, summary: { decided: 0 } });
  });
});

describe('Modifica prima di applicare (FLOW C.6)', () => {
  it('tdd_target: il testo dell\'utente al posto della proposta è "scritto da te" e la decisione è "con le tue modifiche"', async () => {
    const id = propose();

    const res = await apply({ proposal_id: id, field: 'company_offering', expected_status: 'new', value: '  MVP in sei settimane.  ' });

    expect(res.status).toBe(200);
    expect(getSettings().company_offering).toBe('MVP in sei settimane.');
    expect(origins().company_offering).toBe('manual');
    expect(fieldOf(res.body, 'company_offering').decision).toMatchObject({ decision: 'edited', value: 'MVP in sei settimane.' });
    expect(res.body.proposal.summary).toMatchObject({ edited: 1, applied: 0 });
  });

  it('un testo identico alla proposta vale come Applica (provenienza "dalla proposta")', async () => {
    const id = propose();
    const res = await apply({ proposal_id: id, field: 'tone_of_voice', value: 'Diretto e concreto. ' });
    expect(fieldOf(res.body, 'tone_of_voice').decision.decision).toBe('applied');
    expect(origins().tone_of_voice).toBe('proposal');
  });

  it('testo vuoto o uguale a quello di oggi ⇒ 400 col suo motivo, nulla scritto, la voce resta da decidere', async () => {
    await send('PUT', '/api/settings', { positioning: 'Il mio posizionamento.' });
    const id = propose();

    const empty = await apply({ proposal_id: id, field: 'positioning', value: '   ' });
    expect(empty.status).toBe(400);
    // Con la casella aperta i verbi sono nascosti: il motivo dice come tornarci, e per un conflitto il "no" è tenere il tuo.
    expect(empty.body).toEqual({ error: 'Scrivi un testo, oppure annulla la modifica e scegli «Tieni il tuo testo».', code: 'edit_empty' });

    const same = await apply({ proposal_id: id, field: 'positioning', value: 'Il mio posizionamento.' });
    expect(same.status).toBe(400);
    expect(same.body).toEqual({
      error: 'È uguale al testo di oggi: niente da applicare. Se va bene così, annulla la modifica e scegli «Tieni il tuo testo».',
      code: 'edit_same',
    });
    expect((await proposal()).body.summary).toMatchObject({ decided: 0 });
  });

  it('Modifica… di un servizio nuovo: i valori del dialog (anche nome e note) si salvano come scritti da te', async () => {
    const id = propose();

    const res = await apply({
      proposal_id: id,
      service: 'MVP in sei settimane',
      expected_status: 'new',
      service_values: { name: 'MVP in 6 settimane', audience: 'Startup B2B in seed', notes: 'Solo da remoto.' },
    });

    expect(res.status).toBe(200);
    expect(listServices()).toEqual([
      expect.objectContaining({ name: 'MVP in 6 settimane', audience: 'Startup B2B in seed', notes: 'Solo da remoto.', origin: 'manual' }),
    ]);
    expect(serviceOf(res.body, 'MVP in sei settimane').decision).toMatchObject({
      decision: 'edited',
      before: null,
      after: { name: 'MVP in 6 settimane' },
      changed: ['name', 'audience', 'notes'],
    });
  });

  it('Modifica… con un nome già usato da un altro servizio ⇒ 409 `service_exists`, nulla scritto (B10)', async () => {
    createService({ name: 'Revisione architetturale' });
    const id = propose();
    const res = await apply({ proposal_id: id, service: 'MVP in sei settimane', service_values: { name: 'revisione  ARCHITETTURALE' } });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('service_exists');
    expect(listServices()).toHaveLength(1);
    expect((await proposal()).body.summary.decided).toBe(0);
  });
});

describe('POST /api/profile/proposal/undo (FLOW C.7)', () => {
  it('tdd_target: Annulla di un conflitto sostituito rimette il testo di prima con la sua provenienza e la voce da decidere', async () => {
    await send('PUT', '/api/settings', { positioning: 'Il mio posizionamento.' });
    const id = propose();
    const originAt = db.prepare(`SELECT origin_at FROM profile_field_origin WHERE field = 'positioning'`).pluck().get();
    await apply({ proposal_id: id, field: 'positioning', expected_status: 'conflict' });

    const res = await undo({ proposal_id: id, field: 'positioning' });

    expect(res.status).toBe(200);
    expect(getSettings().positioning).toBe('Il mio posizionamento.');
    expect(db.prepare(`SELECT origin, origin_at FROM profile_field_origin WHERE field = 'positioning'`).get()).toEqual({ origin: 'manual', origin_at: originAt });
    expect(fieldOf(res.body, 'positioning')).toMatchObject({ status: 'conflict', decision: null });
  });

  it('Annulla di un campo di prima del rilascio (E14) lo rimette senza provenienza', async () => {
    updateSettings({ company_name: 'Officina Codice' });
    const id = propose();
    await apply({ proposal_id: id, all: true });
    await undo({ proposal_id: id, field: 'company_name' });
    expect(getSettings().company_name).toBe('Officina Codice');
    expect(origins().company_name).toBeUndefined();
  });

  it('Annulla di un servizio aggiunto lo toglie; di uno aggiornato rimette nome, campi e provenienza di prima', async () => {
    const existing = createService({ name: 'Revisione architetturale', audience: 'Team che crescono' });
    db.prepare(`UPDATE services SET origin = 'proposal', origin_at = '2026-09-20T10:00:00.000Z'`).run();
    const id = propose(FIELDS, [svc('MVP in sei settimane', { audience: 'Startup B2B' }), svc('Revisione architetturale', { audience: 'Scaleup' })]);
    await apply({ proposal_id: id, all: true });
    expect(listServices().map((s) => [s.name, s.audience])).toEqual([
      ['Revisione architetturale', 'Scaleup'],
      ['MVP in sei settimane', 'Startup B2B'],
    ]);

    await undo({ proposal_id: id, service: 'MVP in sei settimane' });
    const res = await undo({ proposal_id: id, service: 'Revisione architetturale' });

    expect(listServices()).toEqual([
      expect.objectContaining({ id: existing.id, audience: 'Team che crescono', origin: 'proposal', origin_at: '2026-09-20T10:00:00.000Z' }),
    ]);
    expect(serviceOf(res.body, 'MVP in sei settimane')).toMatchObject({ status: 'new', decision: null });
    expect(serviceOf(res.body, 'Revisione architetturale')).toMatchObject({ status: 'changed', decision: null });
  });

  it('Annulla di un rifiuto riapre la voce, e riapre una proposta già chiusa', async () => {
    const id = propose({ company_name: FIELDS.company_name }, []);
    expect((await reject({ proposal_id: id, all: true })).body.proposal.open).toBe(false);

    const res = await undo({ proposal_id: id, field: 'company_name' });

    expect(res.body.proposal).toMatchObject({ open: true, summary: { to_decide: 1, decided: 0 } });
    expect((await send('GET', '/api/profile')).body.pending_proposal).toMatchObject({ id, to_decide: 1 });
  });

  it('il campo o il servizio cambiato dopo la decisione ⇒ 409 `undo_blocked`, niente si tocca e la decisione resta', async () => {
    const id = propose();
    await apply({ proposal_id: id, all: true });
    await send('PUT', '/api/settings', { company_offering: 'Riscritto a mano dopo.' });
    const service = listServices()[0]!;
    await send('PATCH', `/api/services/${service.id}`, { audience: 'Cambiata a mano.' });

    const field = await undo({ proposal_id: id, field: 'company_offering' });
    expect(field.status).toBe(409);
    expect(field.body.code).toBe('undo_blocked');
    expect(getSettings().company_offering).toBe('Riscritto a mano dopo.');

    const svcRes = await undo({ proposal_id: id, service: 'MVP in sei settimane' });
    expect(svcRes.status).toBe(409);
    expect(svcRes.body).toMatchObject({
      code: 'undo_blocked',
      error: "Il servizio «MVP in sei settimane» è cambiato dopo che l'hai aggiunto: modificalo o eliminalo da «I miei servizi».",
    });
    expect(listServices()).toHaveLength(1);
    expect((await proposal()).body.summary.decided).toBe(7);
  });

  it('Annulla su una voce già da decidere ⇒ 409 `item_open`; richiesta mal formata ⇒ 400', async () => {
    const id = propose();
    const res = await undo({ proposal_id: id, field: 'company_name' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('item_open');
    expect((await undo({ proposal_id: id })).status).toBe(400);
    expect((await undo({ proposal_id: id, all: true })).status).toBe(400);
  });
});
