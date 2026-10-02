import { beforeEach, describe, expect, it } from 'vitest';

// Servizi dell'utente (own-profile-services T8: B2, B3, B4, B10). Import dinamici: la config
// (DB_PATH isolato da tests/setup.ts) è letta a import-time.
const { createApp } = await import('../src/server/app.js');
const { db } = await import('../src/db/index.js');

const app = createApp();

function send(method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
  });
}

async function create(body: Record<string, unknown>) {
  const res = await send('POST', '/api/services', body);
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

async function names(): Promise<string[]> {
  const res = await send('GET', '/api/services');
  return ((await res.json()) as { items: Array<{ name: string }> }).items.map((s) => s.name);
}

beforeEach(() => {
  db.exec(`DELETE FROM services`);
});

describe('API Servizi', () => {
  it('un servizio esiste col solo nome; un omonimo a meno di maiuscole e spazi → 409 senza scrivere', async () => {
    const created = await create({ name: '  Fractional CTO ' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      id: expect.any(Number),
      name: 'Fractional CTO',
      description: null,
      audience: null,
      problem: null,
      proof: null,
      notes: null,
      origin: 'manual',
      origin_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });

    const dup = await create({ name: 'fractional  cto', audience: 'Non salvato' });
    expect(dup.status).toBe(409);
    expect(dup.body).toMatchObject({
      code: 'service_exists',
      error: 'Hai già un servizio con questo nome: «Fractional CTO». I nomi si distinguono a meno di maiuscole e spazi.',
    });
    expect(await names()).toEqual(['Fractional CTO']);
  });

  it('B10 con accenti e doppi spazi: il confronto piega le maiuscole accentate (non solo ASCII)', async () => {
    expect((await create({ name: 'assessment  architetturale' })).status).toBe(201);
    const dupSpaces = await create({ name: 'Assessment Architetturale' });
    expect(dupSpaces.status).toBe(409);
    expect(dupSpaces.body.error).toContain('«assessment  architetturale»');

    expect((await create({ name: 'Qualità' })).status).toBe(201);
    // Il caso che un indice su `lower()` di SQLite avrebbe accettato (PLAN §7).
    const dupAccent = await create({ name: 'QUALITÀ' });
    expect(dupAccent.status).toBe(409);
    expect(dupAccent.body).toMatchObject({ code: 'service_exists', service: { name: 'Qualità' } });
    // L'accento conta: «Qualita» è un altro nome.
    expect((await create({ name: 'Qualita' })).status).toBe(201);

    expect(await names()).toEqual(['assessment  architetturale', 'Qualità', 'Qualita']);
  });

  it('B2: nome vuoto o solo spazi → 400 col messaggio del FLOW, nulla salvato', async () => {
    for (const name of ['', '   ']) {
      const res = await create({ name, audience: 'Non salvato' });
      expect(res.status).toBe(400);
      expect(res.body.issues).toEqual([{ path: 'name', message: 'Inserisci il nome del servizio.' }]);
    }
    expect((await create({ audience: 'Senza nome' })).status).toBe(400);
    expect((await create({ name: 'Ok', colore: 'blu' })).status).toBe(400);
    expect(await names()).toEqual([]);
  });

  it("B4: l'ordine dichiarato torna in ogni lettura, con posizioni contigue; il nuovo va in fondo", async () => {
    const a = (await create({ name: 'A' })).body.id;
    const b = (await create({ name: 'B' })).body.id;
    const c = (await create({ name: 'C' })).body.id;

    const res = await send('PUT', '/api/services/order', { ids: [c, a, b] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ name: string; position: number }> };
    expect(body.items.map((s) => [s.name, s.position])).toEqual([['C', 1], ['A', 2], ['B', 3]]);
    expect(await names()).toEqual(['C', 'A', 'B']);

    await create({ name: 'D' });
    expect(await names()).toEqual(['C', 'A', 'B', 'D']);
  });

  it("riordino da un'altra scheda: id sconosciuti ignorati, quelli mancanti restano in coda (converge, FLOW)", async () => {
    const a = (await create({ name: 'A' })).body.id;
    const b = (await create({ name: 'B' })).body.id;
    const c = (await create({ name: 'C' })).body.id;
    // La scheda vecchia non conosce C e cita un servizio già eliminato (9999).
    const res = await send('PUT', '/api/services/order', { ids: [b, 9999, a] });
    expect(res.status).toBe(200);
    expect(await names()).toEqual(['B', 'A', 'C']);
    expect(c).toBeGreaterThan(0);

    expect((await send('PUT', '/api/services/order', { ids: [a, a] })).status).toBe(400);
    expect((await send('PUT', '/api/services/order', { ids: ['x'] })).status).toBe(400);
    expect(await names()).toEqual(['B', 'A', 'C']);
  });

  it('PATCH: i campi non nominati restano; ogni modifica scritta a mano aggiorna la provenienza (B6)', async () => {
    const created = (await create({ name: 'Fractional CTO', audience: 'Startup', notes: 'Da rivedere' })).body;
    const OLD = '2026-01-01T00:00:00.000Z';
    // Setup: servizio arrivato da una proposta (M4) mesi fa.
    db.prepare(`UPDATE services SET origin = 'proposal', origin_at = ? WHERE id = ?`).run(OLD, created.id);

    const res = await send('PATCH', `/api/services/${created.id}`, { problem: 'Nessuno guida la tecnica', notes: null });
    expect(res.status).toBe(200);
    const patched = (await res.json()) as Record<string, any>;
    expect(patched).toMatchObject({
      name: 'Fractional CTO',
      audience: 'Startup',
      problem: 'Nessuno guida la tecnica',
      notes: null,
      origin: 'manual',
      position: created.position,
    });
    expect(patched.origin_at > OLD).toBe(true);

    // Salvare senza cambiare nulla non trasforma una voce della proposta in "scritto da te" (FLOW, edge case).
    db.prepare(`UPDATE services SET origin = 'proposal', origin_at = ? WHERE id = ?`).run(OLD, created.id);
    const same = await send('PATCH', `/api/services/${created.id}`, { name: 'Fractional CTO', audience: ' Startup ' });
    expect(await same.json()).toMatchObject({ origin: 'proposal', origin_at: OLD });
  });

  it('PATCH del nome: rinomina, cambio di maiuscole su sé stesso ammesso, omonimo di un altro → 409', async () => {
    const a = (await create({ name: 'Assessment architetturale' })).body.id;
    const b = (await create({ name: 'Fractional CTO' })).body.id;

    const recase = await send('PATCH', `/api/services/${a}`, { name: 'Assessment Architetturale' });
    expect(recase.status).toBe(200);
    expect(await names()).toEqual(['Assessment Architetturale', 'Fractional CTO']);

    const clash = await send('PATCH', `/api/services/${b}`, { name: 'assessment  architetturale', audience: 'No' });
    expect(clash.status).toBe(409);
    expect(await clash.json()).toMatchObject({ code: 'service_exists', service: { id: a } });
    expect((await send('PATCH', `/api/services/${b}`, { name: '  ' })).status).toBe(400);
    expect(await names()).toEqual(['Assessment Architetturale', 'Fractional CTO']);

    // Dopo la rinomina il vecchio nome è di nuovo libero.
    expect((await send('PATCH', `/api/services/${b}`, { name: 'CTO a tempo' })).status).toBe(200);
    expect((await create({ name: 'fractional cto' })).status).toBe(201);
  });

  it('DELETE: {ok:true}, poi 404; PATCH e DELETE di un id inesistente → 404', async () => {
    const id = (await create({ name: 'Da togliere' })).body.id;
    const del = await send('DELETE', `/api/services/${id}`);
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ ok: true });
    expect(await names()).toEqual([]);

    expect((await send('DELETE', `/api/services/${id}`)).status).toBe(404);
    expect((await send('PATCH', `/api/services/${id}`, { notes: 'x' })).status).toBe(404);
    expect((await send('DELETE', '/api/services/abc')).status).toBe(404);
  });
});
