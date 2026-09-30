import { beforeEach, describe, expect, it } from 'vitest';

// Profilo esteso e lettura unica (own-profile-services T9: B1, B5, B6, B7, B8, C11, G-11). Import dinamici: la
// config (DB_PATH isolato da tests/setup.ts) è letta a import-time.
const { createApp } = await import('../src/server/app.js');
const { db } = await import('../src/db/index.js');
const { updateSettings } = await import('../src/db/settings.js');

const app = createApp();

function send(method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
  });
}

const json = async (res: Response) => (await res.json()) as Record<string, any>;
const profile = async () => json(await send('GET', '/api/profile'));

/** I tre campi dell'azienda come li ha il DB reale prima del rilascio: scritti senza provenienza (G-11). */
function seedLegacyCompany(): void {
  updateSettings({
    company_name: 'Officina Codice Srl',
    company_description: 'Software su misura per PMI manifatturiere.',
    company_offering: 'Assessment di due settimane.',
  });
}

beforeEach(() => {
  db.exec(`DELETE FROM settings; DELETE FROM profile_field_origin; DELETE FROM services; DELETE FROM profile_sources;`);
});

describe('GET /api/profile (B7)', () => {
  it('una risposta sola: profilo, servizi in ordine e provenienza di ogni valore; i tre campi legacy senza provenienza', async () => {
    seedLegacyCompany();
    for (const name of ['Fractional CTO', 'Assessment architetturale']) await send('POST', '/api/services', { name });
    expect((await send('PUT', '/api/settings', { positioning: 'Il CTO che le PMI non possono assumere.' })).status).toBe(200);

    const res = await send('GET', '/api/profile');
    expect(res.status).toBe(200);
    const p = await json(res);
    expect(p.fields.company_description).toEqual({
      value: 'Software su misura per PMI manifatturiere.',
      origin: null,
      origin_at: null,
    });
    expect(p.fields.positioning).toEqual({
      value: 'Il CTO che le PMI non possono assumere.',
      origin: 'manual',
      origin_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect(p.services.map((s: { name: string; origin: string }) => [s.name, s.origin])).toEqual([
      ['Fractional CTO', 'manual'],
      ['Assessment architetturale', 'manual'],
    ]);
  });

  it('B5: a DB vuoto risponde 200 con tutti i campi null, nessun servizio e le chiavi di M4 presenti a null (P-21)', async () => {
    const res = await send('GET', '/api/profile');
    expect(res.status).toBe(200);
    const empty = { value: null, origin: null, origin_at: null };
    expect(await json(res)).toEqual({
      inputs: { own_profile_url: empty, website_url: { ...empty, domain: null, warning: null } },
      fields: {
        company_name: empty,
        company_description: empty,
        company_offering: empty,
        positioning: empty,
        proof_points: empty,
        tone_of_voice: empty,
      },
      filled_without_origin: 0,
      services: [],
      readiness: expect.objectContaining({ profile: false, company: false }),
      apollo_record: null,
      sources: null,
      last_generation: null,
      pending_proposal: null,
    });
  });

  it('G-11: i tre campi legacy restano senza provenienza (3); riscritto uno a mano, provenienza solo su quello (2)', async () => {
    seedLegacyCompany();
    expect((await profile()).filled_without_origin).toBe(3);

    // Il form dell'azienda manda sempre tutti e tre i campi: cambia solo la descrizione.
    const put = await send('PUT', '/api/settings', {
      company_name: 'Officina Codice Srl',
      company_description: 'Software su misura e migrazioni al cloud per PMI manifatturiere.',
      company_offering: ' Assessment di due settimane. ',
    });
    expect(put.status).toBe(200);
    const p = await profile();
    expect(p.filled_without_origin).toBe(2);
    expect(p.fields.company_description.origin).toBe('manual');
    expect(p.fields.company_name).toMatchObject({ origin: null, origin_at: null });
    expect(p.fields.company_offering).toMatchObject({ origin: null, origin_at: null });

    // Un campo svuotato a mano non è più "compilato" e non porta provenienza.
    await send('PUT', '/api/settings', { company_name: '' });
    const cleared = await profile();
    expect(cleared.fields.company_name).toEqual({ value: null, origin: null, origin_at: null });
    expect(cleared.filled_without_origin).toBe(1);
  });

  it('B6: i campi nuovi salvati a mano tornano con provenienza e data, aggiornata a ogni modifica', async () => {
    const put = await send('PUT', '/api/settings', {
      website_url: 'https://www.officinacodice.it/chi-siamo',
      positioning: 'Il CTO che le PMI non possono assumere.',
      proof_points: '12 migrazioni senza fermo macchina.',
      tone_of_voice: 'Diretto, concreto, niente gergo.',
    });
    expect(put.status).toBe(200);
    expect(await json(put)).toMatchObject({ warnings: [] });
    const p = await profile();
    expect(p.inputs.website_url).toMatchObject({
      value: 'https://www.officinacodice.it/chi-siamo',
      domain: 'officinacodice.it',
      warning: null,
      origin: 'manual',
    });
    for (const key of ['positioning', 'proof_points', 'tone_of_voice']) {
      expect(p.fields[key]).toMatchObject({ origin: 'manual', origin_at: expect.stringMatching(/^\d{4}-/) });
    }
    expect(p.filled_without_origin).toBe(0);

    const OLD = '2026-01-01T00:00:00.000Z';
    db.prepare(`UPDATE profile_field_origin SET origin = 'proposal', origin_at = ?`).run(OLD);
    await send('PUT', '/api/settings', { positioning: 'Il CTO a tempo per le PMI.', tone_of_voice: 'Diretto, concreto, niente gergo.' });
    const again = await profile();
    expect(again.fields.positioning.origin).toBe('manual');
    expect(again.fields.positioning.origin_at > OLD).toBe(true);
    // Riscritto uguale: resta com'era (un valore applicato da una proposta non diventa "scritto da te").
    expect(again.fields.tone_of_voice).toMatchObject({ origin: 'proposal', origin_at: OLD });
  });

  it('C11: un sito da cui non si ricava un dominio si salva comunque e lo dichiara, nella risposta e nella lettura', async () => {
    const put = await send('PUT', '/api/settings', { website_url: 'il mio sito' });
    expect(put.status).toBe(200);
    const warning = "Non riesco a ricavare un dominio da questo indirizzo: il record d'impresa resterà non disponibile.";
    expect((await json(put)).warnings).toEqual([warning]);
    expect((await profile()).inputs.website_url).toMatchObject({ value: 'il mio sito', domain: null, warning });

    // Anche un indirizzo di una piattaforma condivisa non è un dominio proprio.
    expect((await json(await send('PUT', '/api/settings', { website_url: 'https://www.linkedin.com/company/acme' }))).warnings).toEqual([warning]);
    // Un PUT che non tocca il sito non ripete l'avviso.
    expect((await json(await send('PUT', '/api/settings', { positioning: 'x' }))).warnings).toEqual([]);
  });

  it('B9: il record d\'impresa Apollo arriva così com\'è, in sola lettura; non è un\'azienda del CRM', async () => {
    const record = { id: 'org_1', name: 'Officina Codice Srl', primary_domain: 'officinacodice.it', estimated_num_employees: 12 };
    db.prepare(
      `INSERT INTO profile_sources (kind, read_at, outcome, content) VALUES ('apollo', '2026-09-20T09:00:00.000Z', 'read', ?)`,
    ).run(JSON.stringify(record));
    expect((await profile()).apollo_record).toEqual({ read_at: '2026-09-20T09:00:00.000Z', record });
    expect((db.prepare(`SELECT COUNT(*) AS n FROM companies`).get() as { n: number }).n).toBe(0);
  });
});

describe('B8: i consumatori di oggi non cambiano', () => {
  it('GET /api/settings e la readiness restano identici per le quattro chiavi di prima', async () => {
    seedLegacyCompany();
    await send('PUT', '/api/settings', { own_profile_url: 'https://www.linkedin.com/in/omar' });
    const OLD_KEYS = ['own_profile_url', 'company_name', 'company_description', 'company_offering'];
    const pick = (s: Record<string, any>) => Object.fromEntries(OLD_KEYS.map((k) => [k, s[k]]));
    const before = await json(await send('GET', '/api/settings'));

    await send('PUT', '/api/settings', {
      website_url: 'https://officinacodice.it',
      positioning: 'Il CTO che le PMI non possono assumere.',
      proof_points: '12 migrazioni.',
      tone_of_voice: 'Diretto.',
    });
    await send('POST', '/api/services', { name: 'Fractional CTO' });
    const after = await json(await send('GET', '/api/settings'));
    expect(pick(after)).toEqual(pick(before));
    expect(after.readiness).toEqual(before.readiness);

    // Il sito non rende "pronto" il profilo LinkedIn e i campi nuovi non rendono "pronta" l'azienda.
    await send('PUT', '/api/settings', { own_profile_url: '', company_description: '' });
    expect((await json(await send('GET', '/api/settings'))).readiness).toMatchObject({ profile: false, company: false });
  });

  it('F6/F7: con i campi nuovi vuoti l\'input dell\'analisi è identico; profilo e servizi non segnano nessuna analisi', async () => {
    const { upsertProspect } = await import('../src/db/prospects.js');
    const { createIcp, getIcpContext } = await import('../src/db/icps.js');
    const { analysisContext, analysisInput, analyzeProspect } = await import('../src/analysis/analyze.js');
    db.exec(`DELETE FROM prospects; DELETE FROM icps;`);
    seedLegacyCompany();
    const icp = createIcp({ name: 'CTO di PMI', target_roles: ['CTO'] }).id;
    const anna = upsertProspect({ linkedinUrl: 'https://www.linkedin.com/in/anna-f6', fullName: 'Anna', about: 'CTO di una PMI.' }).id;
    const hash = () => analysisInput(analysisContext(anna, getIcpContext(icp)!)!).inputHash;
    const before = hash();

    await send('PUT', '/api/settings', { website_url: '', positioning: '', proof_points: null, tone_of_voice: '  ' });
    expect(hash()).toBe(before);

    const text = JSON.stringify({ summary: 's', angles: [{ title: 't', rationale: 'r' }], fit: 'medio', fit_reason: 'f' });
    const client = {
      messages: { create: async () => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_details: null }) },
    };
    await analyzeProspect(anna, icp, { client: client as never });
    const stale = async () => (await json(await send('GET', `/api/prospects/${anna}/analyses?icpId=${icp}`))).stale;
    expect(await stale()).toBe(false);

    await send('PUT', '/api/settings', { positioning: 'Il CTO a tempo.', website_url: 'https://officinacodice.it' });
    const id = (await json(await send('POST', '/api/services', { name: 'Fractional CTO' }))).id;
    await send('PATCH', `/api/services/${id}`, { audience: 'PMI' });
    expect(await stale()).toBe(false);
    await send('DELETE', `/api/services/${id}`);
    expect(await stale()).toBe(false);
  });
});
