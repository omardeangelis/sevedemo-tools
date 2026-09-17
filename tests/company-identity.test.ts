import { describe, expect, it } from 'vitest';

// Identità azienda a doppia chiave (apollo-lookalike T4a): create/update, upsert con le Regole di
// unione, mergeCompanies. Import dinamici: la config (DB_PATH isolato) è letta a import-time.
const { db } = await import('../src/db/index.js');
const {
  CompanyKeyTakenError,
  CompanyKeysError,
  createCompany,
  findCompanyByApolloId,
  findCompanyByDomain,
  getCompany,
  listCompanies,
  updateCompany,
  upsertCompany,
} = await import('../src/db/companies.js');
const { mergeCompanies } = await import('../src/db/company-identity.js');

const url = (slug: string) => `https://www.linkedin.com/company/${slug}`;

let seq = 0;
function insertIcp(): number {
  seq += 1;
  return Number(db.prepare('INSERT INTO icps (name) VALUES (?)').run(`ICP ${seq}`).lastInsertRowid);
}
function insertProspect(companyId: number | null = null): number {
  seq += 1;
  return Number(
    db.prepare('INSERT INTO prospects (linkedin_url, company_id) VALUES (?, ?)').run(`https://www.linkedin.com/in/p-${seq}`, companyId)
      .lastInsertRowid,
  );
}
function reference(icpId: number, companyId: number, outcome = 'riferimento'): void {
  db.prepare('INSERT INTO icp_reference_companies (icp_id, company_id, outcome) VALUES (?, ?, ?)').run(icpId, companyId, outcome);
}
function source(prospectId: number, companyId: number, capturedAt: string): void {
  db.prepare(`INSERT INTO sources (prospect_id, kind, company_id, captured_at) VALUES (?, 'company_employees', ?, ?)`).run(
    prospectId,
    companyId,
    capturedAt,
  );
}
const companies = () => db.prepare('SELECT * FROM companies ORDER BY id').all();
const expectCode = (fn: () => unknown, ErrorClass: new (...args: any[]) => Error) => {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(ErrorClass);
  return caught as any;
};

describe('createCompany / updateCompany a doppia chiave', () => {
  it('senza URL LinkedIn né dominio riconoscibile lancia CompanyKeysError', () => {
    const before = companies();
    const err = expectCode(() => createCompany({}), CompanyKeysError);
    expect(err.message).toBe("Serve almeno l'URL LinkedIn o il sito web");
    // Un sito su una piattaforma condivisa non è un dominio (SPEC B2).
    expectCode(() => createCompany({ name: 'Solo pagina', website: 'https://www.facebook.com/acme' }), CompanyKeysError);
    expect(companies()).toEqual(before);
  });

  it('crea da sito (dominio derivato, nome = dominio) o da URL (nome = slug)', () => {
    const bySite = createCompany({ website: 'https://www.Crea-Uno.it/chi-siamo' });
    expect(bySite).toMatchObject({
      linkedin_url: null,
      domain: 'crea-uno.it',
      name: 'crea-uno.it',
      website: 'https://www.Crea-Uno.it/chi-siamo',
      apollo_org_id: null,
      apollo_json: null,
      apollo_enriched_at: null,
    });
    const byUrl = createCompany({ linkedin_url: 'linkedin.com/company/Crea-Due/about' });
    expect(byUrl).toMatchObject({ linkedin_url: url('crea-due'), domain: null, name: 'crea-due' });
    expect(createCompany({ domain: 'WWW.crea-tre.io', name: 'Tre' })).toMatchObject({ domain: 'crea-tre.io', name: 'Tre' });
  });

  it('una chiave già di un\'altra azienda lancia CompanyKeyTakenError con l\'azienda, senza scrivere', () => {
    const owner = createCompany({ linkedin_url: url('presa'), website: 'presa.io' });
    const before = companies();
    const byDomain = expectCode(() => createCompany({ website: 'https://presa.io/contatti' }), CompanyKeyTakenError);
    expect(byDomain).toMatchObject({ key: 'domain', code: 'company_exists', company: { id: owner.id } });
    expect(byDomain.message).toBe('Azienda già presente: presa.');
    const byUrl = expectCode(() => createCompany({ linkedin_url: url('presa'), website: 'libero.io' }), CompanyKeyTakenError);
    expect(byUrl).toMatchObject({ key: 'linkedin_url', company: { id: owner.id } });

    const other = createCompany({ website: 'altra-presa.io' });
    expectCode(() => updateCompany(other.id, { website: 'presa.io' }), CompanyKeyTakenError);
    expect(getCompany(other.id)).toMatchObject({ domain: 'altra-presa.io', website: 'altra-presa.io' });
    expect(companies()).toHaveLength(before.length + 1);
  });

  it('updateCompany: mai senza chiavi; togliere una delle due è ammesso', () => {
    const company = createCompany({ linkedin_url: url('due-chiavi'), website: 'due-chiavi.io' });
    expectCode(() => updateCompany(company.id, { linkedin_url: null, website: '' }), CompanyKeysError);
    expectCode(() => updateCompany(company.id, { linkedin_url: '', domain: null }), CompanyKeysError);
    expect(getCompany(company.id)).toMatchObject({ linkedin_url: url('due-chiavi'), domain: 'due-chiavi.io' });

    expect(updateCompany(company.id, { linkedin_url: null })).toMatchObject({ linkedin_url: null, domain: 'due-chiavi.io' });
    expect(updateCompany(999_999, { name: 'x' })).toBeUndefined();
  });

  it('cambiare dominio o URL LinkedIn azzera i dati Apollo; gli altri campi no', () => {
    const { id } = upsertCompany({ domain: 'reset.io', apollo: { orgId: 'org-reset', json: { id: 'org-reset' } } });
    const apollo = { apollo_org_id: 'org-reset', apollo_json: '{"id":"org-reset"}' };
    expect(getCompany(id!)).toMatchObject(apollo);

    // Stesso dominio (cambia solo il percorso del sito) o campi descrittivi: dati Apollo intatti.
    expect(updateCompany(id!, { website: 'https://www.reset.io/chi-siamo', name: 'Reset' })).toMatchObject({ domain: 'reset.io', ...apollo });
    expect(findCompanyByApolloId('org-reset')?.id).toBe(id);

    expect(updateCompany(id!, { website: 'https://reset-nuovo.io' })).toMatchObject({
      domain: 'reset-nuovo.io',
      apollo_org_id: null,
      apollo_json: null,
      apollo_enriched_at: null,
    });

    upsertCompany({ domain: 'reset-nuovo.io', apollo: { orgId: 'org-reset', json: {} } });
    expect(updateCompany(id!, { linkedin_url: url('reset') })).toMatchObject({ linkedin_url: url('reset'), apollo_enriched_at: null });
  });

  it('ricerca per dominio: listCompanies(q) e findCompanyByDomain', () => {
    const company = createCompany({ name: 'Cercami Spa', website: 'https://cercami-dominio.it' });
    expect(listCompanies({ q: 'cercami-dominio' }).map((c) => c.id)).toEqual([company.id]);
    expect(findCompanyByDomain('WWW.Cercami-Dominio.it/prodotti')?.id).toBe(company.id);
    expect(findCompanyByDomain('https://www.facebook.com/x')).toBeUndefined();
  });
});

describe('upsertCompany (Regole di unione)', () => {
  it('per dominio, poi per URL + dominio: stessa riga, URL acquisito, descrittivi solo se vuoti, Apollo più recente', () => {
    const first = upsertCompany({ domain: 'up-uno.io', name: 'Up Uno' });
    expect(first).toMatchObject({ created: true, mergedIds: [], keyConflict: false, noKeys: false });

    const second = upsertCompany({
      linkedinUrl: url('up-uno'),
      domain: 'https://www.up-uno.io',
      name: 'Nome Apollo',
      industry: 'Software',
      apollo: { orgId: 'org-up-uno', json: { name: 'Nome Apollo' }, enrichedAt: '2026-09-01T00:00:00.000Z' },
    });
    expect(second).toEqual({
      id: first.id,
      created: false,
      mergedIds: [],
      linkedinAcquired: true,
      domainAcquired: false,
      keyConflict: false,
      noKeys: false,
    });
    expect(getCompany(first.id!)).toMatchObject({
      linkedin_url: url('up-uno'),
      domain: 'up-uno.io',
      name: 'Up Uno',
      industry: 'Software',
      apollo_org_id: 'org-up-uno',
      apollo_json: '{"name":"Nome Apollo"}',
      apollo_enriched_at: '2026-09-01T00:00:00.000Z',
    });

    upsertCompany({ domain: 'up-uno.io', apollo: { orgId: 'org-up-uno', json: { v: 2 } } });
    expect(getCompany(first.id!)?.apollo_json).toBe('{"v":2}');
    // Dati Apollo più vecchi di quelli salvati non sovrascrivono.
    upsertCompany({ domain: 'up-uno.io', apollo: { json: { v: 0 }, enrichedAt: '2020-01-01T00:00:00.000Z' } });
    expect(getCompany(first.id!)?.apollo_json).toBe('{"v":2}');

    expect(upsertCompany({ linkedinUrl: url('up-uno'), name: 'Rinominata' }, { refresh: true }).id).toBe(first.id);
    expect(getCompany(first.id!)?.name).toBe('Rinominata');
  });

  it('nuova azienda dal solo URL: nome = slug; dal solo sito: nome = dominio', () => {
    const byUrl = upsertCompany({ linkedinUrl: 'https://it.linkedin.com/company/Solo-Url/' });
    expect(getCompany(byUrl.id!)).toMatchObject({ linkedin_url: url('solo-url'), domain: null, name: 'solo-url' });
    const bySite = upsertCompany({ website: 'https://www.solo-sito.it/home', industry: 'Retail' });
    expect(getCompany(bySite.id!)).toMatchObject({ domain: 'solo-sito.it', name: 'solo-sito.it', industry: 'Retail' });
  });

  it('due righe compatibili (solo dominio, solo URL): unione nel superstite con l\'URL, relazioni e fonti spostate', () => {
    // La riga col dominio ha l'id minore: il superstite è comunque quella con l'URL.
    const byDomain = createCompany({ website: 'merge.io', industry: 'Manifattura', notes: 'nota dominio' });
    const byUrl = createCompany({ linkedin_url: url('merge'), name: 'Merge Srl', notes: 'nota URL' });
    const icp1 = insertIcp();
    const icp2 = insertIcp();
    reference(icp1, byUrl.id, 'vinta');
    reference(icp1, byDomain.id, 'persa');
    reference(icp2, byDomain.id, 'in_trattativa');
    const linked = insertProspect(byDomain.id);
    const newerOnDrop = insertProspect();
    const newerOnKeep = insertProspect();
    source(linked, byDomain.id, '2026-03-01T00:00:00.000Z');
    source(newerOnDrop, byUrl.id, '2026-01-01T00:00:00.000Z');
    source(newerOnDrop, byDomain.id, '2026-06-01T00:00:00.000Z');
    source(newerOnKeep, byUrl.id, '2026-06-01T00:00:00.000Z');
    source(newerOnKeep, byDomain.id, '2026-01-01T00:00:00.000Z');

    const result = upsertCompany({ linkedinUrl: url('merge'), domain: 'merge.io', apollo: { orgId: 'org-merge', json: {} } });

    expect(result).toMatchObject({ id: byUrl.id, created: false, mergedIds: [byDomain.id], keyConflict: false });
    expect(result.linkedinAcquired).toBe(false);
    expect(result.domainAcquired).toBe(false);
    expect(getCompany(byDomain.id)).toBeUndefined();
    expect(getCompany(byUrl.id)).toMatchObject({
      linkedin_url: url('merge'),
      domain: 'merge.io',
      name: 'Merge Srl',
      industry: 'Manifattura',
      notes: 'nota URL\n\nnota dominio',
      apollo_org_id: 'org-merge',
    });
    expect(
      db.prepare('SELECT icp_id, company_id, outcome FROM icp_reference_companies WHERE icp_id IN (?, ?) ORDER BY icp_id').all(icp1, icp2),
    ).toEqual([
      { icp_id: icp1, company_id: byUrl.id, outcome: 'vinta' },
      { icp_id: icp2, company_id: byUrl.id, outcome: 'in_trattativa' },
    ]);
    expect(db.prepare('SELECT company_id FROM prospects WHERE id = ?').pluck().get(linked)).toBe(byUrl.id);
    const sourcesOf = (prospectId: number) =>
      db.prepare('SELECT company_id, captured_at FROM sources WHERE prospect_id = ?').all(prospectId);
    expect(sourcesOf(linked)).toEqual([{ company_id: byUrl.id, captured_at: '2026-03-01T00:00:00.000Z' }]);
    expect(sourcesOf(newerOnDrop)).toEqual([{ company_id: byUrl.id, captured_at: '2026-06-01T00:00:00.000Z' }]);
    expect(sourcesOf(newerOnKeep)).toEqual([{ company_id: byUrl.id, captured_at: '2026-06-01T00:00:00.000Z' }]);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('chiavi piene in conflitto: nessuna scrittura, chiavi discordanti nell\'esito; una chiave assente non è in conflitto', () => {
    const company = createCompany({ linkedin_url: url('conf'), website: 'conf.io' });
    const before = companies();

    const result = upsertCompany({ linkedinUrl: url('conf'), domain: 'conf-altro.io', name: 'Altro nome', industry: 'X' });
    expect(result).toMatchObject({ id: undefined, created: false, mergedIds: [], noKeys: false });
    expect(result.keyConflict).toEqual({
      reason: 'discordant_keys',
      keys: ['domain'],
      details: [
        {
          company_id: company.id,
          company_name: 'conf',
          matched_by: 'linkedin_url',
          key: 'domain',
          input: 'conf-altro.io',
          existing: 'conf.io',
        },
      ],
      company_ids: [company.id],
    });
    expect(companies()).toEqual(before);

    expect(upsertCompany({ domain: 'conf.io', industry: 'Logistica' })).toMatchObject({ id: company.id, keyConflict: false });
  });

  it('apollo_org_id di un\'altra azienda con dominio diverso → conflitto; id Apollo diverso su un dominio noto → conflitto', () => {
    const owner = upsertCompany({ domain: 'apollo-d.io', apollo: { orgId: 'org-d', json: {} } });
    const before = companies();

    const foreignOrg = upsertCompany({ domain: 'apollo-nuovo.io', apollo: { orgId: 'org-d', json: {} } });
    expect(foreignOrg.keyConflict).toMatchObject({ keys: ['domain'], company_ids: [owner.id] });
    const otherOrg = upsertCompany({ domain: 'apollo-d.io', apollo: { orgId: 'org-altro', json: {} } });
    expect(otherOrg.keyConflict).toMatchObject({ keys: ['apollo_org_id'], company_ids: [owner.id] });
    expect(companies()).toEqual(before);

    // Solo l'id Apollo, già noto: aggiorna quella riga.
    expect(upsertCompany({ apollo: { orgId: 'org-d', json: { v: 3 } } })).toMatchObject({ id: owner.id, keyConflict: false });
    expect(getCompany(owner.id!)?.apollo_json).toBe('{"v":3}');
  });

  it('due righe di cui una con l\'altra chiave diversa → conflitto, nessuna unione', () => {
    const withUrl = createCompany({ linkedin_url: url('e-srl'), website: 'e-vecchio.io' });
    const withDomain = createCompany({ website: 'e-nuovo.io' });
    const before = companies();
    const result = upsertCompany({ linkedinUrl: url('e-srl'), domain: 'e-nuovo.io' });
    expect(result.keyConflict).toMatchObject({ reason: 'discordant_keys', keys: ['domain'], company_ids: [withUrl.id, withDomain.id] });
    expect(result.mergedIds).toEqual([]);
    expect(companies()).toEqual(before);
  });

  it('senza chiavi utilizzabili: noKeys, nessuna scrittura', () => {
    const before = companies();
    expect(upsertCompany({ name: 'Senza chiavi', website: 'https://www.facebook.com/x' })).toMatchObject({ id: undefined, noKeys: true });
    expect(upsertCompany({ apollo: { orgId: 'org-sconosciuto', json: {} } })).toMatchObject({ id: undefined, noKeys: true });
    expect(companies()).toEqual(before);
  });
});

describe('mergeCompanies (unione esplicita)', () => {
  it('il superstite indicato tiene le sue chiavi e prende quelle mancanti; l\'assorbita sparisce', () => {
    const keep = createCompany({ website: 'keep.io', name: 'Keep' });
    const drop = createCompany({ linkedin_url: url('drop-me'), website: 'drop.io', size: '11-50', notes: 'solo drop' });
    const merged = mergeCompanies(keep.id, drop.id);
    expect(merged).toMatchObject({
      id: keep.id,
      linkedin_url: url('drop-me'),
      domain: 'keep.io',
      name: 'Keep',
      website: 'keep.io',
      size: '11-50',
      notes: 'solo drop',
    });
    expect(getCompany(drop.id)).toBeUndefined();
    // La chiave scartata è libera di nuovo.
    expect(createCompany({ website: 'drop.io' }).domain).toBe('drop.io');
    expect(() => mergeCompanies(keep.id, 999_999)).toThrow('Azienda inesistente: 999999');
  });

  it('dati Apollo: un\'organizzazione trovata vince su un tentativo senza esito; tra due trovate la più recente', () => {
    const found = upsertCompany({ domain: 'ap-trovata.io', apollo: { orgId: 'org-trovata', json: { ok: 1 }, enrichedAt: '2026-01-01T00:00:00.000Z' } });
    const notFound = upsertCompany({ domain: 'ap-tentata.io', apollo: { json: { outcome: 'not_found' }, enrichedAt: '2026-09-01T00:00:00.000Z' } });
    expect(mergeCompanies(notFound.id!, found.id!)).toMatchObject({
      domain: 'ap-tentata.io',
      apollo_org_id: 'org-trovata',
      apollo_json: '{"ok":1}',
      apollo_enriched_at: '2026-01-01T00:00:00.000Z',
    });

    const older = upsertCompany({ domain: 'ap-vecchia.io', apollo: { orgId: 'org-vecchia', json: {}, enrichedAt: '2026-01-01T00:00:00.000Z' } });
    const newer = upsertCompany({ domain: 'ap-nuova.io', apollo: { orgId: 'org-nuova', json: {}, enrichedAt: '2026-05-01T00:00:00.000Z' } });
    expect(mergeCompanies(older.id!, newer.id!)).toMatchObject({ apollo_org_id: 'org-nuova', apollo_enriched_at: '2026-05-01T00:00:00.000Z' });
  });

  it('candidature (se la tabella esiste): la referenza vince, lo stato deciso vince su proposta, a parità il superstite', () => {
    // DDL di PLAN §6 (la tabella arriva con T5): qui serve solo a esercitare il ramo `hasTable`.
    db.exec(`CREATE TABLE IF NOT EXISTS icp_company_candidates (
      icp_id     INTEGER NOT NULL REFERENCES icps(id) ON DELETE CASCADE,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      status     TEXT NOT NULL DEFAULT 'proposta' CHECK (status IN ('proposta','accettata','scartata')),
      score      REAL NOT NULL DEFAULT 0,
      reasons    TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(reasons)),
      job_id     INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
      score_parts     TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(score_parts)),
      scoring_version TEXT NOT NULL DEFAULT 'v1',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      decided_at TEXT,
      PRIMARY KEY (icp_id, company_id)
    )`);
    const candidate = (icpId: number, companyId: number, status: string, score: number) =>
      db.prepare('INSERT INTO icp_company_candidates (icp_id, company_id, status, score) VALUES (?, ?, ?, ?)').run(icpId, companyId, status, score);

    const keep = createCompany({ website: 'cand-keep.io' });
    const drop = createCompany({ website: 'cand-drop.io' });
    const [refKeep, refDrop, decidedDrop, tieDecided, tieProposed, onlyDrop] = Array.from({ length: 6 }, insertIcp);
    reference(refKeep, keep.id);
    candidate(refKeep, drop.id, 'accettata', 0.9);
    reference(refDrop, drop.id, 'vinta');
    candidate(refDrop, keep.id, 'proposta', 0.8);
    candidate(decidedDrop, keep.id, 'proposta', 0.1);
    candidate(decidedDrop, drop.id, 'scartata', 0.2);
    candidate(tieDecided, keep.id, 'accettata', 0.3);
    candidate(tieDecided, drop.id, 'scartata', 0.4);
    candidate(tieProposed, keep.id, 'proposta', 0.5);
    candidate(tieProposed, drop.id, 'proposta', 0.6);
    candidate(onlyDrop, drop.id, 'proposta', 0.7);

    mergeCompanies(keep.id, drop.id);

    expect(
      db.prepare('SELECT icp_id, company_id, outcome FROM icp_reference_companies WHERE icp_id IN (?, ?) ORDER BY icp_id').all(refKeep, refDrop),
    ).toEqual([
      { icp_id: refKeep, company_id: keep.id, outcome: 'riferimento' },
      { icp_id: refDrop, company_id: keep.id, outcome: 'vinta' },
    ]);
    expect(db.prepare('SELECT icp_id, company_id, status, score FROM icp_company_candidates ORDER BY icp_id').all()).toEqual([
      { icp_id: decidedDrop, company_id: keep.id, status: 'scartata', score: 0.2 },
      { icp_id: tieDecided, company_id: keep.id, status: 'accettata', score: 0.3 },
      { icp_id: tieProposed, company_id: keep.id, status: 'proposta', score: 0.5 },
      { icp_id: onlyDrop, company_id: keep.id, status: 'proposta', score: 0.7 },
    ]);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });
});
