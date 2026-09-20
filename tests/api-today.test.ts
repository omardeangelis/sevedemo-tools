import { beforeEach, describe, expect, it } from 'vitest';

// Oggi (people-first-crm T25, SPEC H1–H8): prossime azioni da fare e in arrivo, persone da smistare, ultime aggiunte,
// configurazione incompleta. Import dinamici: la config (DB_PATH isolato) è letta a import-time.
const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/server/app.js');
const { upsertProspect, addSource } = await import('../src/db/prospects.js');
const { createPerson, addMeeting } = await import('../src/db/people.js');
const { setNextAction } = await import('../src/db/next-actions.js');
const { createCompany } = await import('../src/db/companies.js');
const { createIcp } = await import('../src/db/icps.js');
const { updateSettings } = await import('../src/db/settings.js');
const { config } = await import('../src/config.js');

const app = createApp();

async function today(day?: string) {
  const res = await app.request(day ? `/api/today?today=${day}` : '/api/today');
  expect(res.status).toBe(200);
  return (await res.json()) as any;
}

let seq = 0;
function person(fullName: string, fields: Partial<Parameters<typeof upsertProspect>[0]> = {}): number {
  seq += 1;
  return upsertProspect({ linkedinUrl: `https://www.linkedin.com/in/oggi-${seq}`, fullName, ...fields }).id;
}
function withAction(fullName: string, on: string, text: string | null = 'Richiamare'): number {
  const id = person(fullName);
  setNextAction(id, { on, text });
  return id;
}

beforeEach(() => {
  db.exec('DELETE FROM prospects; DELETE FROM companies; DELETE FROM icps; DELETE FROM jobs;');
  updateSettings({ own_profile_url: null, company_description: null });
});

describe('GET /api/today (H1–H8)', () => {
  it('today=2026-09-18: 15 e 18 in "da fare" (prima il 15), 25 in "in arrivo", 26 in nessuno, scartato in nessuno', async () => {
    const acme = createCompany({ name: 'Acme', website: 'acme.it' });
    const overdue = withAction('Mario Rossi', '2026-09-15', 'Richiamare per la demo');
    db.prepare('UPDATE prospects SET company_id = ? WHERE id = ?').run(acme.id, overdue);
    const todayOne = withAction('Anna Bianchi', '2026-09-18', null);
    const tomorrow = withAction('Luca Bassi', '2026-09-19');
    const lastDay = withAction('Sara Conti', '2026-09-25', 'Follow-up dopo l\'evento');
    withAction('Troppo In Là', '2026-09-26');
    const discarded = withAction('Scartato Conti', '2026-09-16');
    db.prepare(`UPDATE prospects SET status = 'scartato' WHERE id = ?`).run(discarded);

    const res = await today('2026-09-18');
    expect(res.empty).toBe(false);
    expect(res.due.map((r: any) => r.id)).toEqual([overdue, todayOne]);
    expect(res.due[0]).toMatchObject({
      full_name: 'Mario Rossi',
      company_name: 'Acme',
      company_id: acme.id,
      next_action_on: '2026-09-15',
      next_action_text: 'Richiamare per la demo',
      next_action_state: 'scaduta',
    });
    expect(res.due[0].next_action_set_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(res.due[1]).toMatchObject({ next_action_state: 'oggi', next_action_text: null });
    expect(res.upcoming.map((r: any) => r.id)).toEqual([tomorrow, lastDay]);
    expect(res.failed_runs).toEqual([]);

    // Bordo: il giorno dopo la scaduta del 15 resta scaduta, il 19 diventa "oggi".
    const next = await today('2026-09-19');
    expect(next.due.map((r: any) => r.id)).toEqual([overdue, todayOne, tomorrow]);
    expect(next.upcoming.map((r: any) => r.id)).toEqual([lastDay, expect.any(Number)]);
    expect((await app.request('/api/today?today=2026-13-01')).status).toBe(400);
  });

  it('da smistare, ultime 10 aggiunte con fonte e data; "Aggiungi l\'incontro" non sposta una persona già presente', async () => {
    const old = person('Vecchio Contatto');
    db.prepare(`UPDATE prospects SET created_at = '2026-01-01T10:00:00.000Z' WHERE id = ?`).run(old);
    addSource(old, { kind: 'company_employees', companyId: createCompany({ name: 'Beta', website: 'beta.it' }).id });
    const ids: number[] = [];
    for (let i = 0; i < 11; i++) {
      const id = person(`Nuovo ${i}`);
      db.prepare(`UPDATE prospects SET created_at = ? WHERE id = ?`).run(`2026-09-${String(i + 1).padStart(2, '0')}T10:00:00.000Z`, id);
      ids.push(id);
    }
    const manual = createPerson({ fullName: 'Luca Bassi', email: 'luca@nuvola.io', meeting: { context: 'DevFest', metOn: '2026-09-12' } });
    if (!manual.ok) throw new Error(manual.code);

    let res = await today('2026-09-18');
    expect(res.to_triage).toBe(12);
    expect(res.recent).toHaveLength(10);
    expect(res.recent[0]).toMatchObject({ id: manual.id, full_name: 'Luca Bassi', first_source: { kind: 'manual', met_on: '2026-09-12' } });
    expect(res.recent[0].created_at).toMatch(/^\d{4}-/);
    expect(res.recent.map((r: any) => r.id)).not.toContain(old);

    // L'incontro aggiunto a una persona già presente non la porta in cima (H4) ma la toglie da Da smistare (B3).
    expect(addMeeting(old, { context: 'Fiera', metOn: '2026-09-17' })).toMatchObject({ ok: true });
    res = await today('2026-09-18');
    expect(res.recent.map((r: any) => r.id)).not.toContain(old);
    expect(res.to_triage).toBe(11);
  });

  it('run falliti per strumento (H5): una riga per run con gli strumenti coinvolti; un run riuscito dopo toglie l\'avviso', async () => {
    const { insertJob, completeJob } = await import('../src/db/jobs.js');
    const failRun = (kind: any, tools: string[], error: string) => {
      const job = insertJob(kind, {}, tools);
      completeJob(job.id, { state: 'failed', error });
      return job.id;
    };

    const apollo = failRun('apollo_people', ['apollo'], 'actor:apollo:mixed_people/api_search: chiave rifiutata (401)');
    let res = await today('2026-09-18');
    expect(res.failed_runs).toHaveLength(1);
    expect(res.failed_runs[0]).toMatchObject({ tools: ['apollo'] });
    expect(res.failed_runs[0].run).toMatchObject({ id: apollo, outcome: 'failed', operation: 'Contatti Apollo' });

    // Un run fallito senza colpevole conta per entrambi i suoi strumenti: una riga sola con tutti e due.
    const both = failRun('analyze', ['anthropic', 'apify'], 'process: Job interrotto senza esito (exit 1).');
    res = await today('2026-09-18');
    // Gli strumenti dell'avviso seguono l'ordine del catalogo (Apify · Apollo · Anthropic), non quello del run.
    expect(res.failed_runs.map((r: any) => r.tools)).toEqual([['apify', 'anthropic'], ['apollo']]);
    expect(res.failed_runs[0].run.id).toBe(both);

    // L'analisi riuscita dopo toglie l'avviso di Anthropic e Apify; Apollo resta.
    const ok = insertJob('analyze', {}, ['anthropic', 'apify']);
    completeJob(ok.id, { state: 'succeeded', result: { summary: 'Analisi: 1 analizzata.', counts: {}, warnings: [] } });
    res = await today('2026-09-18');
    expect(res.failed_runs.map((r: any) => r.tools)).toEqual([['apollo']]);
  });

  it('CRM vuoto → empty; configurazione incompleta nelle voci mancanti', async () => {
    const saved = config.apolloApiKey;
    config.apolloApiKey = '';
    try {
      const res = await today('2026-09-18');
      expect(res).toMatchObject({ empty: true, due: [], upcoming: [], to_triage: 0, recent: [], failed_runs: [] });
      expect(res.setup_missing).toEqual(['profile', 'company', 'icp', 'apollo']);
    } finally {
      config.apolloApiKey = saved;
    }
    updateSettings({ own_profile_url: 'https://www.linkedin.com/in/omar', company_description: 'Software su misura' });
    createIcp({ name: 'CTO' });
    person('Qualcuno');
    const done = await today();
    expect(done).toMatchObject({ empty: false, setup_missing: [] });
  });
});
