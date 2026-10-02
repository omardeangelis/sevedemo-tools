import { beforeEach, describe, expect, it } from 'vitest';

// La proposta di profilo e servizi (own-profile-services T27–T28: E3, E4, E7–E12, G-11, H3, H5): confronto ricalcolato a
// ogni lettura (P-12), conflitti con ciò che è scritto a mano, applica, applica tutto, scarto. Import dinamici: la config
// (DB_PATH isolato da tests/setup.ts) è letta a import-time.
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
    });
    expect(body.services).toEqual([
      {
        name: 'MVP in sei settimane',
        status: 'new',
        existing: null,
        proposed: { description: null, audience: 'Startup B2B', problem: null, proof: null },
        changed_fields: ['audience'],
        sources: ['website'],
      },
    ]);
    expect(body.summary).toEqual({ to_review: 7, conflicts: 0, unchanged: 0, filled_without_origin: 0 });
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
    expect(body.summary).toMatchObject({ conflicts: 2, to_review: 5 });
    expect(body.apply_all).toEqual({ count: 5, disabled_reason: null });
  });

  it('G-11: i tre campi legacy valorizzati non sono conflitti, e la risposta dice quanti ne sostituirebbe (3)', async () => {
    updateSettings({ company_name: 'Officina', company_description: 'Software su misura.', company_offering: 'Assessment.' });
    propose();
    const { body } = await proposal();
    expect(statusOf(body).fields).toMatchObject({ company_name: 'changed', company_description: 'changed', company_offering: 'changed' });
    expect(body.summary).toMatchObject({ conflicts: 0, filled_without_origin: 3 });
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

  it('tutte le voci in conflitto ⇒ "Applica tutto" non si può usare, e la risposta dice perché', async () => {
    await send('PUT', '/api/settings', { positioning: 'Mio.' });
    propose({ positioning: FIELDS.positioning }, []);
    const { body } = await proposal();
    expect(body.apply_all).toEqual({
      count: 0,
      disabled_reason: 'Ogni voce della proposta cambierebbe un testo scritto da te: decidili uno per uno.',
    });
  });

  it('GET /api/profile porta la proposta in attesa (id e data) e non scrive niente', async () => {
    const id = propose();
    const profile = (await send('GET', '/api/profile')).body;
    expect(profile.pending_proposal).toMatchObject({ id, created_at: expect.stringMatching(/^\d{4}-/) });
    expect(profile.fields.positioning.value).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Applica, applica tutto, corse e scarto (E7, E8, E10, E11, E12, H3, H5 — T28)
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
    expect(res.body).toMatchObject({ applied: 5, conflicts_left: 2 });
    const settings = getSettings();
    expect(settings.positioning).toBe('Il mio posizionamento.');
    expect(settings.tone_of_voice).toBe('Il mio tono.');
    expect(settings.company_name).toBe('Marta Fiorini');
    expect(origins()).toMatchObject({ positioning: 'manual', tone_of_voice: 'manual', company_name: 'proposal', proof_points: 'proposal' });
    expect(listServices().map((s) => [s.name, s.origin])).toEqual([['MVP in sei settimane', 'proposal']]);
    // La proposta resta (E10) con i due conflitti da decidere; il resto alla rilettura è invariato.
    expect(statusOf(res.body.proposal).fields).toMatchObject({ positioning: 'conflict', tone_of_voice: 'conflict', company_name: 'unchanged' });
    expect(res.body.proposal.summary).toMatchObject({ conflicts: 2, to_review: 0 });
  });

  it('un campo applicato è scritto "dalla proposta" e alla rilettura è invariato; un conflitto si sostituisce solo uno per uno', async () => {
    await send('PUT', '/api/settings', { positioning: 'Il mio posizionamento.' });
    const id = propose();

    const one = await apply({ proposal_id: id, field: 'proof_points', expected_status: 'new' });
    expect(one.status).toBe(200);
    expect(getSettings().proof_points).toBe('14 MVP in quattro anni.');
    expect(origins().proof_points).toBe('proposal');
    expect(one.body.proposal.fields.find((f: any) => f.key === 'proof_points').status).toBe('unchanged');

    const replaced = await apply({ proposal_id: id, field: 'positioning', expected_status: 'conflict' });
    expect(replaced.status).toBe(200);
    expect(getSettings().positioning).toBe('La product engineer del primo prodotto.');
    expect(origins().positioning).toBe('proposal');
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

  it('applicato tutto ciò che c\'era da decidere, la proposta non è più in attesa (A.6)', async () => {
    const id = propose();
    const res = await apply({ proposal_id: id, all: true });
    expect(res.body).toMatchObject({ applied: 7, conflicts_left: 0, proposal: null });
    expect((await proposal()).status).toBe(404);
    expect((await send('GET', '/api/profile')).body.pending_proposal).toBeNull();
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
    expect(res.body).toMatchObject({ code: 'item_changed', error: 'La voce è cambiata dopo che l\'hai vista: rileggi la proposta.' });
    expect(getSettings().positioning).toBe('Scritto ora a mano.');
  });

  it('voce inesistente o richiesta mal formata ⇒ 404 / 400', async () => {
    const id = propose();
    expect((await apply({ proposal_id: id, field: 'tone_of_voice_x' })).status).toBe(400);
    expect((await apply({ proposal_id: id, service: 'Non proposto' })).status).toBe(404);
    expect((await apply({ proposal_id: id })).status).toBe(400);
    expect((await apply({ proposal_id: id, field: 'company_name', all: true })).status).toBe(400);
  });
});

describe('DELETE /api/profile/proposal (E12)', () => {
  it('scarta la proposta intera senza toccare nessun valore del profilo né dei servizi', async () => {
    await send('PUT', '/api/settings', { positioning: 'Mio.' });
    createService({ name: 'Revisione architetturale' });
    const settings = getSettings();
    const services = listServices();
    const id = propose();

    const res = await send('DELETE', '/api/profile/proposal', { proposal_id: id });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(getSettings()).toEqual(settings);
    expect(listServices()).toEqual(services);
    expect((await proposal()).status).toBe(404);
  });

  it('una proposta non più corrente non si scarta: 409 `proposal_stale`, la nuova resta', async () => {
    const old = propose();
    const current = propose();
    expect((await send('DELETE', '/api/profile/proposal', { proposal_id: old })).status).toBe(409);
    expect((await proposal()).body.id).toBe(current);
  });
});
