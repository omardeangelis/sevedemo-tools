import { beforeEach, describe, expect, it } from 'vitest';

// Candidate di un ICP (apollo-lookalike T5): API dati di `src/db/candidates.ts`. Import dinamici: la
// config (DB_PATH isolato da tests/setup.ts) è letta a import-time.
const { db } = await import('../src/db/index.js');
const {
  candidateOf,
  countCandidates,
  getCandidate,
  knownCompanyIdsForIcp,
  lastContactsByCompany,
  lastLookalikeRun,
  listCandidates,
  lookalikeRuns,
  removeCandidate,
  runStats,
  setCandidateStatus,
  upsertCandidate,
} = await import('../src/db/candidates.js');
const { createCompany, upsertCompany } = await import('../src/db/companies.js');
const { createIcp, deleteIcp, setReferenceCompany } = await import('../src/db/icps.js');
const { completeJob, insertJob } = await import('../src/db/jobs.js');
const { addMembers, createList } = await import('../src/db/lists.js');
const { addSource, upsertProspect } = await import('../src/db/prospects.js');

const PARTS = { keywords: 0.5, size: 1, location: 1 };
const OLD = '2020-01-01T00:00:00.000Z';

function reset(): void {
  db.exec(`
    DELETE FROM sources; DELETE FROM prospects; DELETE FROM lists;
    DELETE FROM icp_company_candidates; DELETE FROM icp_reference_companies;
    DELETE FROM companies; DELETE FROM icps; DELETE FROM jobs;
  `);
}
beforeEach(reset);

const icp = (name = 'ICP') => createIcp({ name }).id;
const company = (domain: string, name?: string) => createCompany({ website: domain, name: name ?? null }).id;

/** Candidata con valori di default (punteggio 0,5, località presente). */
function candidate(icpId: number, companyId: number, extra: Partial<Parameters<typeof upsertCandidate>[0]> = {}) {
  return upsertCandidate({ icpId, companyId, score: 0.5, parts: PARTS, reasons: ['stesso settore'], jobId: null, ...extra });
}

/** Job `lookalike_companies` terminato nello stato indicato. */
function lookalikeJob(icpId: number, state: 'succeeded' | 'failed' | 'running' = 'succeeded', counts: Record<string, number> = {}) {
  const job = insertJob('lookalike_companies', {
    icpId,
    pages: 1,
    startPage: 1,
    keywords: ['saas'],
    ranges: ['11-20'],
    locations: ['milano'],
    filtersHash: 'hash',
    autoContacts: null,
  });
  if (state === 'succeeded') {
    completeJob(job.id, { state, result: { summary: 'ok', counts: { read: 5, last_page: 1, ...counts }, warnings: ['parziale'] } });
  }
  if (state === 'failed') completeJob(job.id, { state, error: 'actor:apollo:mixed_companies/search: errore' });
  return job.id;
}

describe('upsertCandidate / setCandidateStatus (tdd_target)', () => {
  it('upsertCandidate ripetuto dopo "accettata" lascia stato, decisione, job e punteggio della prima ricerca', () => {
    const icpId = icp();
    const acme = company('acme.it');
    const first = lookalikeJob(icpId);
    const second = lookalikeJob(icpId);

    expect(candidate(icpId, acme, { score: 0.67, reasons: ['prima'], jobId: first })).toEqual({ created: true, reference: false });
    expect(setCandidateStatus(icpId, [acme], 'accettata')).toEqual({ updated: 1, failed: [] });
    const decidedAt = getCandidate(icpId, acme)!.decided_at;
    expect(decidedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    for (let i = 0; i < 2; i++) {
      const again = candidate(icpId, acme, { score: 0.1, parts: { keywords: 0, size: 0, location: null }, reasons: ['dopo'], jobId: second, scoringVersion: 'v2' });
      expect(again).toEqual({ created: false, reference: false });
    }
    expect(getCandidate(icpId, acme)).toMatchObject({
      status: 'accettata',
      decided_at: decidedAt,
      job_id: first,
      score: 0.67,
      score_parts: PARTS,
      reasons: ['prima'],
      scoring_version: 'v1',
    });
  });

  it('setCandidateStatus per item: un id inesistente finisce in failed, gli altri si aggiornano', () => {
    const icpId = icp();
    const other = icp('Altro ICP');
    const [a, b, notCandidate] = [company('a.it'), company('b.it'), company('c.it')];
    candidate(icpId, a);
    candidate(icpId, b);
    candidate(other, notCandidate);

    const result = setCandidateStatus(icpId, [a, b, 999_999, notCandidate], 'accettata');
    expect(result).toEqual({
      updated: 2,
      failed: [
        { company_id: 999_999, error: expect.any(String) },
        { company_id: notCandidate, error: expect.any(String) },
      ],
    });
    expect(result.failed[0].error).toBe('Candidata non trovata per questo ICP.');
    expect(getCandidate(icpId, a)!.status).toBe('accettata');
    expect(getCandidate(icpId, b)!.status).toBe('accettata');
    expect(getCandidate(other, notCandidate)!.status).toBe('proposta');
  });
});

describe('candidate: scrittura', () => {
  it('nuova candidata: proposta, JSON parsati, versione di default v1, decided_at nullo', () => {
    const icpId = icp();
    const acme = company('acme.it');
    const jobId = lookalikeJob(icpId);
    candidate(icpId, acme, { score: 0.58, parts: { keywords: 0.4, size: 1, location: null }, reasons: ['r1', 'r2'], jobId });
    expect(getCandidate(icpId, acme)).toMatchObject({
      icp_id: icpId,
      company_id: acme,
      status: 'proposta',
      score: 0.58,
      score_parts: { keywords: 0.4, size: 1, location: null },
      scoring_version: 'v1',
      reasons: ['r1', 'r2'],
      job_id: jobId,
      decided_at: null,
    });
    expect(getCandidate(icpId, 999_999)).toBeUndefined();
  });

  it('una referenza dello stesso ICP non diventa candidata (flag reference); di un altro ICP sì', () => {
    const icpId = icp();
    const other = icp('Altro');
    const ref = company('ref.it');
    setReferenceCompany(icpId, ref);
    expect(candidate(icpId, ref)).toEqual({ created: false, reference: true });
    expect(getCandidate(icpId, ref)).toBeUndefined();
    expect(candidate(other, ref)).toEqual({ created: true, reference: false });
  });

  it('setCandidateStatus è idempotente, aggiorna decided_at a ogni chiamata (anche Riproponi) e rifiuta stati ignoti', () => {
    const icpId = icp();
    const acme = company('acme.it');
    candidate(icpId, acme);
    const setOld = () => db.prepare('UPDATE icp_company_candidates SET decided_at = ?').run(OLD);

    for (const status of ['scartata', 'scartata', 'proposta'] as const) {
      setOld();
      expect(setCandidateStatus(icpId, [acme, acme], status)).toEqual({ updated: 1, failed: [] });
      const row = getCandidate(icpId, acme)!;
      expect(row.status).toBe(status);
      expect(row.decided_at).not.toBe(OLD);
    }
    expect(() => setCandidateStatus(icpId, [acme], 'decisa' as never)).toThrow(/Stato candidata non valido/);
    expect(setCandidateStatus(icpId, [], 'accettata')).toEqual({ updated: 0, failed: [] });
  });

  it('removeCandidate toglie la riga (false se non c\'era)', () => {
    const icpId = icp();
    const acme = company('acme.it');
    candidate(icpId, acme);
    expect(removeCandidate(icpId, acme)).toBe(true);
    expect(removeCandidate(icpId, acme)).toBe(false);
    expect(getCandidate(icpId, acme)).toBeUndefined();
  });

  it('cascade: eliminare ICP o azienda elimina le candidate; eliminare il job azzera job_id', () => {
    const icpId = icp();
    const keep = icp('Resta');
    const [a, b] = [company('a.it'), company('b.it')];
    const jobId = lookalikeJob(keep);
    candidate(icpId, a);
    candidate(keep, a, { jobId });
    candidate(keep, b, { jobId });

    expect(deleteIcp(icpId)).toBe(true);
    expect(db.prepare('SELECT COUNT(*) FROM icp_company_candidates WHERE icp_id = ?').pluck().get(icpId)).toBe(0);
    db.prepare('DELETE FROM companies WHERE id = ?').run(b);
    expect(getCandidate(keep, b)).toBeUndefined();
    db.prepare('DELETE FROM jobs WHERE id = ?').run(jobId);
    expect(getCandidate(keep, a)).toMatchObject({ job_id: null });
  });
});

describe('candidate: lettura', () => {
  it('listCandidates: per stato, punteggio decrescente poi nome, campi azienda e Apollo, last_contacts_at', () => {
    const icpId = icp();
    const beta = company('beta.it', 'Beta');
    const acme = company('acme.it', 'Acme');
    const gamma = upsertCompany({
      domain: 'gamma.io',
      linkedinUrl: 'https://www.linkedin.com/company/gamma',
      name: 'Gamma',
      industry: 'Software',
      size: '11-50',
      location: 'Milano',
      apollo: { orgId: 'org-gamma', json: { city: 'Milano', state: 'Lombardia', country: 'Italy', estimated_num_employees: 42 } },
    }).id!;
    candidate(icpId, beta, { score: 0.5 });
    candidate(icpId, acme, { score: 0.5 });
    candidate(icpId, gamma, { score: 0.9, reasons: ['stessa città di Acme'] });
    setCandidateStatus(icpId, [gamma], 'accettata');

    const prospect = upsertProspect({ linkedinUrl: 'https://www.linkedin.com/in/mario-rossi' }).id;
    addSource(prospect, { kind: 'apollo_people', companyId: gamma });
    db.prepare(`UPDATE sources SET captured_at = '2026-09-16T10:00:00.000Z'`).run();

    expect(listCandidates(icpId).map((c) => c.name)).toEqual(['Gamma', 'Acme', 'Beta']);
    expect(listCandidates(icpId, 'proposta').map((c) => c.name)).toEqual(['Acme', 'Beta']);
    expect(listCandidates(icpId, 'scartata')).toEqual([]);
    expect(listCandidates(icpId, 'accettata')).toEqual([
      {
        icp_id: icpId,
        company_id: gamma,
        name: 'Gamma',
        domain: 'gamma.io',
        linkedin_url: 'https://www.linkedin.com/company/gamma',
        website: null,
        industry: 'Software',
        size: '11-50',
        location: 'Milano',
        apollo_city: 'Milano',
        apollo_state: 'Lombardia',
        apollo_country: 'Italy',
        apollo_employees: 42,
        score: 0.9,
        score_parts: PARTS,
        scoring_version: 'v1',
        reasons: ['stessa città di Acme'],
        status: 'accettata',
        job_id: null,
        created_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        decided_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        last_contacts_at: '2026-09-16T10:00:00.000Z',
      },
    ]);
    expect(listCandidates(icpId, 'proposta')[0]).toMatchObject({ website: 'acme.it', apollo_city: null, last_contacts_at: null });
  });

  it('countCandidates per stato (zeri per un ICP senza candidate)', () => {
    const icpId = icp();
    const [a, b, c] = [company('a.it'), company('b.it'), company('c.it')];
    candidate(icpId, a);
    candidate(icpId, b);
    candidate(icpId, c);
    setCandidateStatus(icpId, [c], 'scartata');
    expect(countCandidates(icpId)).toEqual({ proposta: 2, accettata: 0, scartata: 1 });
    expect(countCandidates(icp('Vuoto'))).toEqual({ proposta: 0, accettata: 0, scartata: 0 });
  });

  it('candidateOf: gli ICP di cui l\'azienda è candidata, per nome ICP', () => {
    const zeta = icp('Zeta');
    const alfa = icp('Alfa');
    const acme = company('acme.it');
    candidate(zeta, acme, { score: 0.3 });
    candidate(alfa, acme, { score: 0.8 });
    setCandidateStatus(alfa, [acme], 'accettata');
    expect(candidateOf(acme)).toEqual([
      { icp_id: alfa, icp_name: 'Alfa', status: 'accettata', score: 0.8, decided_at: expect.any(String) },
      { icp_id: zeta, icp_name: 'Zeta', status: 'proposta', score: 0.3, decided_at: null },
    ]);
    expect(candidateOf(company('solo.it'))).toEqual([]);
  });

  it('knownCompanyIdsForIcp: candidate in qualunque stato + referenze, solo di quell\'ICP', () => {
    const icpId = icp();
    const other = icp('Altro');
    const [ref, proposed, discarded, elsewhere] = [company('r.it'), company('p.it'), company('d.it'), company('e.it')];
    setReferenceCompany(icpId, ref);
    candidate(icpId, proposed);
    candidate(icpId, discarded);
    setCandidateStatus(icpId, [discarded], 'scartata');
    candidate(other, elsewhere);
    expect(knownCompanyIdsForIcp(icpId)).toEqual(new Set([ref, proposed, discarded]));
    expect(knownCompanyIdsForIcp(icp('Vuoto'))).toEqual(new Set());
  });
});

describe('ricerche lookalike derivate dai job', () => {
  it('lastLookalikeRun e lookalikeRuns: solo job lookalike riusciti di quell\'ICP, dal più recente', () => {
    const icpId = icp();
    const other = icp('Altro');
    expect(lastLookalikeRun(icpId)).toBeNull();
    expect(lookalikeRuns(icpId)).toEqual([]);

    const older = lookalikeJob(icpId, 'succeeded', { pages_read: 1 });
    lookalikeJob(other, 'succeeded');
    const newer = lookalikeJob(icpId, 'succeeded', { pages_read: 2, last_page: 2 });
    lookalikeJob(icpId, 'failed');
    insertJob('enrich_companies', { companyIds: [1], icpId, retryNotFound: false });
    lookalikeJob(icpId, 'running');

    expect(lastLookalikeRun(icpId)).toEqual({
      id: newer,
      at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      params: expect.objectContaining({ icpId, keywords: ['saas'], filtersHash: 'hash', autoContacts: null }),
      result: { summary: 'ok', counts: { read: 5, last_page: 2, pages_read: 2 }, warnings: ['parziale'] },
    });

    const runs = lookalikeRuns(icpId);
    expect(runs.map((r) => r.id)).toEqual([newer, older]);
    expect(runs[0]).toEqual({
      id: newer,
      at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      state: 'succeeded',
      // `perPage` assente nei params (job anteriori a S-7) → 25.
      pages: 1,
      per_page: 25,
      start_page: 1,
      filters: { keywords: ['saas'], ranges: ['11-20'], locations: ['milano'] },
      counts: { read: 5, last_page: 2, pages_read: 2 },
      warnings: ['parziale'],
      stats: {
        proposed: 0,
        without_location: 0,
        buckets: {
          basso: { proposta: 0, accettata: 0, scartata: 0 },
          medio: { proposta: 0, accettata: 0, scartata: 0 },
          alto: { proposta: 0, accettata: 0, scartata: 0 },
        },
      },
    });

    for (let i = 0; i < 5; i++) lookalikeJob(icpId);
    expect(lookalikeRuns(icpId)).toHaveLength(5);
    expect(lookalikeRuns(icpId, 7)).toHaveLength(7);
  });

  it('runStats: 5 candidate di due ricerche (una senza località, una accettata) → fasce × stato; job senza candidate → zeri', () => {
    const icpId = icp();
    const first = lookalikeJob(icpId);
    const second = lookalikeJob(icpId);
    const empty = lookalikeJob(icpId);
    const [a, b, c, d, e] = ['a.it', 'b.it', 'c.it', 'd.it', 'e.it'].map((domain) => company(domain));
    candidate(icpId, a, { jobId: first, score: 0.2 });
    candidate(icpId, b, { jobId: first, score: 0.34, parts: { keywords: 0.2, size: 0.5, location: null } });
    candidate(icpId, c, { jobId: first, score: 0.67 });
    candidate(icpId, d, { jobId: second, score: 0.66 });
    candidate(icpId, e, { jobId: second, score: 0.9 });
    setCandidateStatus(icpId, [c], 'accettata');
    setCandidateStatus(icpId, [a], 'scartata');

    expect(runStats(first)).toEqual({
      proposed: 3,
      without_location: 1,
      buckets: {
        basso: { proposta: 0, accettata: 0, scartata: 1 },
        medio: { proposta: 1, accettata: 0, scartata: 0 },
        alto: { proposta: 0, accettata: 1, scartata: 0 },
      },
    });
    expect(runStats(second)).toEqual({
      proposed: 2,
      without_location: 0,
      buckets: {
        basso: { proposta: 0, accettata: 0, scartata: 0 },
        medio: { proposta: 1, accettata: 0, scartata: 0 },
        alto: { proposta: 1, accettata: 0, scartata: 0 },
      },
    });
    const zeros = { proposta: 0, accettata: 0, scartata: 0 };
    expect(runStats(empty)).toEqual({ proposed: 0, without_location: 0, buckets: { basso: zeros, medio: zeros, alto: zeros } });
    expect(lookalikeRuns(icpId).find((r) => r.id === first)!.stats).toEqual(runStats(first));
  });
});

describe('lastContactsByCompany', () => {
  it('data più recente delle fonti apollo_people per azienda; con listId solo sui membri della lista', () => {
    const icpId = icp();
    const list = createList({ icpId, name: 'Lista' })!;
    const [acme, beta, gamma] = [company('acme.it'), company('beta.it'), company('gamma.it')];
    const inList = upsertProspect({ linkedinUrl: 'https://www.linkedin.com/in/in-lista' }).id;
    const outside = upsertProspect({ linkedinUrl: 'https://www.linkedin.com/in/fuori-lista' }).id;
    addMembers(list.id, [inList]);

    const source = (prospectId: number, companyId: number, kind: 'apollo_people' | 'company_employees', at: string) => {
      const { id } = addSource(prospectId, { kind, companyId });
      db.prepare('UPDATE sources SET captured_at = ? WHERE id = ?').run(at, id);
    };
    source(inList, acme, 'apollo_people', '2026-09-10T08:00:00.000Z');
    source(outside, acme, 'apollo_people', '2026-09-15T08:00:00.000Z');
    source(outside, beta, 'apollo_people', '2026-09-12T08:00:00.000Z');
    source(inList, gamma, 'company_employees', '2026-09-16T08:00:00.000Z');

    expect(lastContactsByCompany([acme, beta, gamma])).toEqual(
      new Map([
        [acme, '2026-09-15T08:00:00.000Z'],
        [beta, '2026-09-12T08:00:00.000Z'],
      ]),
    );
    expect(lastContactsByCompany([acme, beta, gamma], list.id)).toEqual(new Map([[acme, '2026-09-10T08:00:00.000Z']]));
    expect(lastContactsByCompany([beta])).toEqual(new Map([[beta, '2026-09-12T08:00:00.000Z']]));
    expect(lastContactsByCompany([])).toEqual(new Map());
  });
});
