import { beforeEach, describe, expect, it } from 'vitest';

// Persone senza LinkedIn nei job e nell'export (people-first-crm T6: E11, E12). Mai provider reali: le deps
// finte falliscono se ricevono un URL nullo. Import dinamici: la config (DB_PATH isolato) è letta a import-time.
const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/server/app.js');
const { upsertProspect } = await import('../src/db/prospects.js');
const { createIcp } = await import('../src/db/icps.js');
const { createPerson } = await import('../src/db/people.js');
const { enrichProspects } = await import('../src/jobs/enrich.js');
const { analyzeMany } = await import('../src/jobs/analyze.js');
const { createListExport, renderListExportCsv } = await import('../src/exports/list-export.js');

const app = createApp();

const GOOD = {
  summary: 'CTO di una scale-up.',
  angles: [
    { title: 'A', rationale: 'r' },
    { title: 'B', rationale: 'r' },
    { title: 'C', rationale: 'r' },
  ],
  fit: 'alto',
  fit_reason: 'Coincide.',
};

/** Deps che falliscono se ricevono un URL nullo o una persona senza LinkedIn. */
const strictEnrich = {
  calls: [] as string[][],
  enrich: async (urls: Array<string | null>) => {
    if (urls.some((u) => !u)) throw new Error('URL nullo passato al provider');
    strictEnrich.calls.push(urls as string[]);
    return new Map(urls.map((u) => [u as string, { about: 'Bio', headline: 'CTO' }]));
  },
};
const client = {
  messages: {
    create: async (body: any) => {
      if (JSON.stringify(body).includes('Senza LinkedIn')) throw new Error('analizzata una persona senza LinkedIn');
      return { content: [{ type: 'text', text: JSON.stringify(GOOD) }], stop_reason: 'end_turn', stop_details: null };
    },
  },
};

let icpId = 0;
let listId = 0;
let withLinkedin = 0;
let without = 0;

beforeEach(() => {
  db.exec('DELETE FROM prospects; DELETE FROM posts; DELETE FROM lists; DELETE FROM companies; DELETE FROM icps; DELETE FROM jobs;');
  strictEnrich.calls = [];
  icpId = createIcp({ name: 'CTO startup', description: 'CTO', target_roles: ['CTO'], pains: 'Costi' }).id;
  listId = Number(db.prepare(`INSERT INTO lists (icp_id, name) VALUES (?, 'Eventi')`).run(icpId).lastInsertRowid);
  withLinkedin = upsertProspect({ linkedinUrl: 'https://www.linkedin.com/in/con-linkedin', fullName: 'Con LinkedIn' }).id;
  const created = createPerson({ fullName: 'Senza LinkedIn', email: 'senza@x.it', listId });
  if (!created.ok) throw new Error('creazione fallita');
  without = created.id;
  db.prepare('INSERT INTO list_members (list_id, prospect_id) VALUES (?, ?)').run(listId, withLinkedin);
});

async function get(path: string) {
  const res = await app.request(path);
  return { status: res.status, body: (await res.json()) as any };
}

describe('preview: le persone senza LinkedIn sono contate a parte e fuori dalla stima (E11)', () => {
  it('arricchimento su una selezione: counts.no_linkedin = 1, fuori da to_enrich e dalla stima', async () => {
    const { body } = await get(`/api/enrich/preview?prospectIds=${withLinkedin},${without}`);
    expect(body.counts).toMatchObject({ selected: 2, targets: 1, no_linkedin: 1 });
    expect(body.warnings).toContain('1 senza LinkedIn: esclusa.');
  });

  it('arricchimento Apollo e su una lista: stesso conteggio', async () => {
    const apollo = await get(`/api/enrich/preview?prospectIds=${without}&provider=apollo`);
    expect(apollo.body.counts).toMatchObject({ selected: 1, targets: 0, no_linkedin: 1, est_credits: 0 });
    const byList = await get(`/api/enrich/preview?listId=${listId}`);
    expect(byList.body.counts).toMatchObject({ selected: 2, targets: 1, no_linkedin: 1 });
  });

  it('analisi su una selezione e su una lista', async () => {
    const selection = await get(`/api/analyze/preview?prospectIds=${withLinkedin},${without}&icpId=${icpId}`);
    expect(selection.body.counts).toMatchObject({ selected: 2, to_analyze: 1, no_linkedin: 1 });
    expect(selection.body.warnings).toContain('1 senza LinkedIn: esclusa.');
    const list = await get(`/api/analyze/preview?listId=${listId}`);
    expect(list.body.counts).toMatchObject({ selected: 2, no_linkedin: 1 });
  });
});

describe('job reali in-process con deps finte severe', () => {
  it('arricchimento: il provider non riceve mai un URL nullo', async () => {
    const result = await enrichProspects({ prospectIds: [withLinkedin, without] }, strictEnrich as any);
    expect(result.counts).toMatchObject({ enriched: 1, no_linkedin: 1, errors: 0 });
    expect(strictEnrich.calls).toEqual([['https://www.linkedin.com/in/con-linkedin']]);
    expect(result.summary).toContain('1 senza LinkedIn (esclusa)');
  });

  it('analisi della lista (con arricchimento prima): la persona senza LinkedIn non si arricchisce né si analizza', async () => {
    const result = await analyzeMany({ listId, onlyMissing: true, force: false }, { client, enrich: strictEnrich } as any);
    expect(result.counts).toMatchObject({ selected: 2, analyzed: 1, no_linkedin: 1, errors: 0 });
    expect(db.prepare('SELECT COUNT(*) FROM analyses WHERE prospect_id = ?').pluck().get(without)).toBe(0);
  });
});

describe('azioni singole e export (E11, E12)', () => {
  it('arricchisci e analizza singoli → 409 no_linkedin con il motivo', async () => {
    for (const [path, body] of [
      [`/api/prospects/${without}/enrich`, {}],
      [`/api/prospects/${without}/analyze`, { icpId }],
    ] as const) {
      const res = await app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      expect(res.status, path).toBe(409);
      expect(await res.json()).toMatchObject({
        code: 'no_linkedin',
        error: 'Serve il profilo LinkedIn: aggiungilo per arricchire o analizzare questa persona.',
      });
    }
  });

  it('il CSV include la persona con la colonna LinkedIn vuota', () => {
    const created = createListExport(listId, {});
    expect(created).not.toBeNull();
    const csv = renderListExportCsv(created!.id)!;
    const lines = csv.csv.trim().split(/\r?\n/);
    const header = lines[0].split(',');
    const col = header.indexOf('linkedin_url');
    const row = lines.find((l) => l.includes('Senza LinkedIn'))!;
    expect(row).toBeDefined();
    expect(row.split(',')[col]).toBe('');
    expect(csv.rows).toBe(2);
  });
});
