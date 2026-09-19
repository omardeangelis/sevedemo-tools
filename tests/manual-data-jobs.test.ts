import { beforeEach, describe, expect, it } from 'vitest';

// I job rispettano i dati impostati a mano (people-first-crm T4: D7, D8, D9, E9, E10). Un test per ogni
// scrittore dei job sulla persona. Mai provider reali: deps sempre finte. Import dinamici (config a import-time).
const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/server/app.js');
const { upsertProspect, addSource, updateProspect } = await import('../src/db/prospects.js');
const { linkCompany, unlinkCompany } = await import('../src/db/people.js');
const { setNextAction } = await import('../src/db/next-actions.js');
const { markManual } = await import('../src/db/manual-fields.js');
const { createCompany } = await import('../src/db/companies.js');
const { enrichProspects } = await import('../src/jobs/enrich.js');
const { sourceCompany } = await import('../src/jobs/source-company.js');
const { applyApolloMatch } = await import('../src/enrich/apollo-match.js');

type Enrichment = import('../src/enrich/profile-detail.js').Enrichment;

const app = createApp();

function row(id: number): any {
  return db.prepare('SELECT * FROM prospects WHERE id = ?').get(id);
}
function manual(id: number): Record<string, string> {
  return JSON.parse(row(id).manual_fields);
}

function fakeEnrich(data: Record<string, Enrichment>) {
  return {
    enrich: async (urls: string[]) => {
      const map = new Map<string, Enrichment>();
      for (const u of urls) if (data[u]) map.set(u, data[u]);
      return map;
    },
  };
}

beforeEach(() => {
  db.exec('DELETE FROM prospects; DELETE FROM posts; DELETE FROM lists; DELETE FROM companies; DELETE FROM icps; DELETE FROM jobs;');
});

describe('arricchimento Apify (applyEnrichment)', () => {
  it('ruolo impostato a mano ed email svuotata a mano restano; la headline mai toccata si aggiorna', async () => {
    const url = 'https://www.linkedin.com/in/mario-rossi';
    const id = upsertProspect({ linkedinUrl: url, fullName: 'Mario Rossi', headline: 'CTO @ Acme', title: 'CTO', email: 'vecchia@acme.it' }).id;
    expect(updateProspect(id, { title: 'Head of Engineering', email: '' })).toBe('ok');

    await enrichProspects(
      { prospectIds: [id] },
      fakeEnrich({ [url]: { title: 'VP Engineering', email: 'nuova@acme.it', headline: 'VP Engineering @ Acme', about: 'Bio' } }),
    );

    expect(row(id)).toMatchObject({ title: 'Head of Engineering', email: null, headline: 'VP Engineering @ Acme', about: 'Bio' });
    expect(row(id).enriched_at).toBeTruthy();
    expect(Object.keys(manual(id)).sort()).toEqual(['email', 'title']);
  });

  it('azienda scollegata a mano: l\'arricchimento non la ricollega; nome azienda scritto a mano non cambia', async () => {
    const url = 'https://www.linkedin.com/in/anna';
    const acme = createCompany({ name: 'Acme', linkedin_url: 'https://www.linkedin.com/company/acme' });
    const id = upsertProspect({ linkedinUrl: url, fullName: 'Anna' }).id;
    unlinkCompany(id);
    updateProspect(id, { company_name: 'Acme Robotica' });

    await enrichProspects({ prospectIds: [id] }, fakeEnrich({ [url]: { company: 'Acme', companyUrl: acme.linkedin_url! } }));

    expect(row(id)).toMatchObject({ company_id: null, company_name: 'Acme Robotica' });
  });
});

describe('persone di un\'azienda con profilo completo (source_company, refresh)', () => {
  it('non cambia il collegamento né il ruolo marcati; aggiorna il resto', async () => {
    const icp = Number(db.prepare(`INSERT INTO icps (name, target_roles) VALUES ('ICP', '["CTO"]')`).run().lastInsertRowid);
    const listId = Number(db.prepare(`INSERT INTO lists (icp_id, name) VALUES (?, 'Lista')`).run(icp).lastInsertRowid);
    const acme = createCompany({ name: 'Acme', linkedin_url: 'https://www.linkedin.com/company/acme' });
    const beta = createCompany({ name: 'Beta', website: 'beta.io' });
    const id = upsertProspect({ linkedinUrl: 'https://www.linkedin.com/in/luca-test', fullName: 'Luca', title: 'CTO' }).id;
    linkCompany(id, beta.id);
    updateProspect(id, { title: 'Fondatore' });

    await sourceCompany(
      { companyId: acme.id, listId, mode: 'Full' } as any,
      {
        fetchEmployees: async () => [
          {
            id: 'ACoAAFakeMemberLuca0001AbCd',
            publicIdentifier: 'luca-test',
            linkedinUrl: 'https://www.linkedin.com/in/luca-test',
            firstName: 'Luca',
            lastName: 'Test',
            headline: 'CTO @ Acme',
            about: 'Bio di Luca',
            experience: [{ position: 'CTO', companyName: 'Acme', endDate: { text: 'Present' } }],
          },
        ],
      },
    );

    expect(row(id)).toMatchObject({ company_id: beta.id, title: 'Fondatore', about: 'Bio di Luca' });
  });
});

describe('upsert in backfill (contatti Apollo, sync) e match Apollo', () => {
  it('un\'email svuotata a mano non si riempie e un\'azienda scollegata non si ricollega', () => {
    const acme = createCompany({ name: 'Acme', website: 'acme.it' });
    const url = 'https://www.linkedin.com/in/sara';
    const id = upsertProspect({ linkedinUrl: url, fullName: 'Sara', email: 'sara@vecchia.it' }).id;
    updateProspect(id, { email: '' });
    unlinkCompany(id);

    upsertProspect({ linkedinUrl: url, email: 'sara@acme.it', companyId: acme.id, title: 'CFO' });

    expect(row(id)).toMatchObject({ email: null, company_id: null, title: 'CFO' });
  });

  it('il match Apollo non riempie un\'email svuotata a mano né un ruolo scritto a mano', () => {
    const id = upsertProspect({ linkedinUrl: 'https://www.linkedin.com/in/pia' }).id;
    updateProspect(id, { email: '', title: 'Consulente' });

    applyApolloMatch(id, { email: 'pia@azienda.it', title: 'CEO', companyName: 'Azienda', apolloId: 'ap-pia' } as any);

    expect(row(id)).toMatchObject({ email: null, title: 'Consulente', company_name: 'Azienda' });
    expect(row(id).apollo_matched_at).toBeTruthy();
  });
});

describe('unione automatica (E9) e aggancio per nome (E1)', () => {
  it('id membro rivelato da un upsert: resta il ruolo marcato più recente dell\'assorbita e la prossima azione più recente', () => {
    const slug = 'https://www.linkedin.com/in/giulia-neri';
    const urn = 'ACoAAFakeGiulia0001AbCdEfGh';
    const bySlug = upsertProspect({ linkedinUrl: slug, fullName: 'Giulia Neri', title: 'CFO' }).id;
    const byUrn = upsertProspect({ linkedinUrl: `https://www.linkedin.com/in/${urn}`, fullName: 'Giulia Neri' }).id;
    markManual(bySlug, ['title'], '2026-09-01T10:00:00.000Z');
    db.prepare(`UPDATE prospects SET title = 'Direttrice finanziaria' WHERE id = ?`).run(byUrn);
    markManual(byUrn, ['title'], '2026-09-10T10:00:00.000Z');
    setNextAction(bySlug, { on: '2026-09-20', text: 'Vecchia' });
    db.prepare(`UPDATE prospects SET next_action_set_at = '2026-09-02T00:00:00.000Z' WHERE id = ?`).run(bySlug);
    setNextAction(byUrn, { on: '2026-10-01', text: 'Nuova' });

    const result = upsertProspect({ linkedinUrl: slug, memberUrn: urn });

    expect(result.id).toBe(bySlug);
    expect(result.mergedIds).toEqual([byUrn]);
    expect(row(bySlug)).toMatchObject({
      member_urn: urn,
      title: 'Direttrice finanziaria',
      next_action_on: '2026-10-01',
      next_action_text: 'Nuova',
    });
    expect(manual(bySlug).title).toBe('2026-09-10T10:00:00.000Z');
    expect(row(byUrn)).toBeUndefined();
  });

  it('una reazione non si aggancia per nome a una persona aggiunta a mano senza LinkedIn', () => {
    const manualId = Number(
      db.prepare(`INSERT INTO prospects (full_name, headline, email) VALUES ('Marco Riva', 'Head of Engineering', 'marco@beta.it')`).run()
        .lastInsertRowid,
    );
    const reaction = upsertProspect(
      { linkedinUrl: 'https://www.linkedin.com/in/ACoAAFakeMarco0001AbCdEfGhIj', fullName: 'Marco Riva', headline: 'Head of Engineering' },
      { linkByName: true },
    );
    expect(reaction.created).toBe(true);
    expect(reaction.id).not.toBe(manualId);
  });

  it('E10: un job con l\'URL di una persona aggiunta a mano la aggiorna e ne aggiunge la fonte, senza crearne un\'altra', () => {
    const url = 'https://www.linkedin.com/in/elena-bianchi';
    const manualId = Number(
      db.prepare(`INSERT INTO prospects (linkedin_url, full_name, title, email) VALUES (?, 'Elena B.', 'CTO', 'elena@x.it')`).run(url)
        .lastInsertRowid,
    );
    markManual(manualId, ['full_name', 'title', 'email']);
    addSource(manualId, { kind: 'manual' });
    const post = Number(db.prepare(`INSERT INTO posts (post_url) VALUES ('https://www.linkedin.com/posts/p-e10')`).run().lastInsertRowid);

    const up = upsertProspect({ linkedinUrl: url, fullName: 'Elena Bianchi', headline: 'CTO @ Nuvola', title: 'VP' }, { linkByName: true });
    addSource(up.id, { kind: 'post_reaction', postId: post, reactionType: 'LIKE' });

    expect(up).toMatchObject({ id: manualId, created: false });
    expect(row(manualId)).toMatchObject({ full_name: 'Elena B.', title: 'CTO', headline: 'CTO @ Nuvola' });
    expect(db.prepare('SELECT kind FROM sources WHERE prospect_id = ? ORDER BY kind').pluck().all(manualId)).toEqual(['manual', 'post_reaction']);
    expect(db.prepare('SELECT COUNT(*) FROM prospects').pluck().get()).toBe(1);
  });
});

describe('preview Apollo solo email (D9)', () => {
  it('chi ha l\'email svuotata a mano è escluso dalla stima e contato a parte', async () => {
    const a = upsertProspect({ linkedinUrl: 'https://www.linkedin.com/in/da-cercare' }).id;
    const b = upsertProspect({ linkedinUrl: 'https://www.linkedin.com/in/svuotata', email: 'x@y.it' }).id;
    updateProspect(b, { email: null });

    const res = await app.request(`/api/enrich/preview?prospectIds=${a},${b}&provider=apollo`);
    const preview = (await res.json()) as any;

    expect(preview.counts).toMatchObject({ selected: 2, targets: 1, email_cleared: 1, est_credits: 1 });
    expect(preview.warnings).toContain('1 con email svuotata a mano: esclusa.');
  });
});
