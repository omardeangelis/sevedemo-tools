import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeDomain } from '../src/util/fields.js';
import { mapOrganization, mapOrganizations } from '../src/apollo/mappers/organizations.js';
import { mapPerson, mapPeople } from '../src/apollo/mappers/people.js';
import { deriveFilters, scoreCandidate } from '../src/apollo/similarity.js';

// Fixture ricavate dalla documentazione Apollo (`_source: "docs"`), con aziende e persone inventate.
const fixture = (name: string) =>
  JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures', 'apollo', name), 'utf8')) as any;
const companiesSearch = fixture('mixed-companies-search.json');
const bulkEnrich = fixture('organizations-bulk-enrich.json');
const peopleSearch = fixture('mixed-people-api-search.json');
const peopleMatch = fixture('people-bulk-match.json');

describe('normalizeDomain (SPEC B2)', () => {
  it('minuscolo, senza schema, porta, percorso, query e www.; gli altri sottodomini restano', () => {
    expect(normalizeDomain('https://www.Acme.it/x?y')).toBe('acme.it');
    expect(normalizeDomain('http://acme.it:8080/chi-siamo#team')).toBe('acme.it');
    expect(normalizeDomain('  ACME.IT  ')).toBe('acme.it');
    expect(normalizeDomain('www.acme.it')).toBe('acme.it');
    expect(normalizeDomain('acme.it.')).toBe('acme.it');
    expect(normalizeDomain('shop.acme.it')).toBe('shop.acme.it');
    expect(normalizeDomain('https://shop.acme.it/')).toBe('shop.acme.it');
    expect(normalizeDomain('beta-srl.co.uk')).toBe('beta-srl.co.uk');
  });

  it('host di piattaforme condivise (anche come sottodominio) → undefined', () => {
    for (const raw of [
      'linkedin.com/company/x',
      'https://it.linkedin.com/company/x',
      'https://www.facebook.com/acme',
      'instagram.com/acme',
      'https://google.com',
      'sites.google.com/view/x',
      'acme.wixsite.com',
      'https://acme.wixsite.com/sito',
    ]) {
      expect(normalizeDomain(raw), raw).toBeUndefined();
    }
  });

  it('valori non normalizzabili → undefined', () => {
    for (const raw of ['', '   ', 'non un dominio', 'acme', 'localhost:3000', 'http://', '192.168.1.10', 'ftp://acme.it', 'mailto:info@acme.it', 'acme..it', '-acme.it', 'acme.123', null, undefined, 42, {}]) {
      expect(normalizeDomain(raw), String(raw)).toBeUndefined();
    }
  });
});

describe('mapOrganizations: ricerca aziende (mixed_companies/search)', () => {
  it('legge organizations e accounts, dichiarate e riconosciute', () => {
    const r = mapOrganizations(companiesSearch);
    expect(r.declared).toBe(5);
    expect(r.recognized).toBe(5);
    expect(r.items.map((o) => [o.apolloId, o.domain, o.linkedinUrl])).toEqual([
      ['64f0a1b2c3d4e5f600000011', 'zeta-gestionali-fittizia.it', 'https://www.linkedin.com/company/zeta-gestionali-fittizia'],
      // dominio primario assente → dal sito (via www. e percorso)
      ['64f0a1b2c3d4e5f600000012', 'eta-paghe-inventata.it', undefined],
      ['64f0a1b2c3d4e5f600000013', 'gamma-hr-fittizia.it', 'https://www.linkedin.com/company/gamma-hr-fittizia'],
      ['64f0a1b2c3d4e5f600000014', 'delta-payroll-esempio.it', 'https://www.linkedin.com/company/delta-payroll-esempio'],
      // senza dominio ma con id e URL LinkedIn: riconosciuta (le chiavi le valuta il job)
      ['64f0a1b2c3d4e5f600000015', undefined, 'https://www.linkedin.com/company/theta-consulenza-inventata'],
    ]);
  });

  it('item con i soli campi documentati: descrittivi assenti, nessun errore, punteggio 0 con località esclusa', () => {
    const [zeta] = mapOrganizations(companiesSearch).items;
    expect(zeta).toMatchObject({
      apolloId: '64f0a1b2c3d4e5f600000011',
      name: 'Zeta Gestionali Fittizia S.r.l.',
      website: 'http://www.zeta-gestionali-fittizia.it',
      keywords: [],
    });
    for (const key of ['industry', 'employees', 'city', 'state', 'country', 'description'] as const) {
      expect(zeta![key], key).toBeUndefined();
    }
    expect(zeta!.raw).toBe(companiesSearch.organizations[0]);
    const refs = [{ name: 'Acme', keywords: ['hr', 'saas'], employees: 80, city: 'Milan', state: 'Lombardy', country: 'Italy' }];
    const r = scoreCandidate(zeta!, deriveFilters(refs, null), refs);
    expect(r).toEqual({ score: 0, parts: { keywords: 0, size: 0, location: null }, reasons: ['località non disponibile da Apollo'] });
  });

  it('item con campi descrittivi: settore, parole chiave (pulite, senza doppioni), dipendenti, sede', () => {
    const gamma = mapOrganizations(companiesSearch).items[2]!;
    expect(gamma).toMatchObject({
      name: 'Gamma HR Fittizia S.p.A.',
      industry: 'human resources',
      keywords: ['hr', 'saas', 'fintech'],
      employees: 60,
      city: 'Milan',
      state: 'Lombardy',
      country: 'Italy',
      description: 'Software HR in cloud per le PMI italiane.',
    });
    const delta = mapOrganizations(companiesSearch).items[3]!;
    expect([delta.city, delta.state, delta.country]).toEqual([undefined, undefined, 'Italy']);
  });

  it('5 dichiarate, 4 riconosciute: item senza id né chiavi scartato', () => {
    const items = [
      ...companiesSearch.organizations.slice(0, 3),
      { name: 'Senza id né chiavi', website_url: 'https://www.linkedin.com/company/finta', industry: 'hr' },
      companiesSearch.organizations[3],
    ];
    const r = mapOrganizations(items);
    expect(r).toMatchObject({ declared: 5, recognized: 4 });
    expect(r.items).toHaveLength(4);
    expect(mapOrganization(items[3])).toBeNull();
    // senza id ma con dominio: riconosciuta
    expect(mapOrganization({ primary_domain: 'Solo-Dominio.it' })).toMatchObject({ apolloId: undefined, domain: 'solo-dominio.it' });
  });

  it('organizations + accounts: account con organization_id già presente deduplicato, account nuovo aggiunto', () => {
    const response = {
      organizations: companiesSearch.organizations.slice(0, 2),
      accounts: [
        { id: 'acc-1', organization_id: '64f0a1b2c3d4e5f600000011', name: 'Zeta (account)', domain: 'zeta-gestionali-fittizia.it' },
        { id: 'acc-2', organization_id: '64f0a1b2c3d4e5f600000099', name: 'Iota Account Fittizio', domain: 'iota-fittizia.it', linkedin_url: null },
        'non un oggetto',
      ],
      pagination: { page: 1, per_page: 5, total_entries: 4, total_pages: 1 },
    };
    const r = mapOrganizations(response);
    expect(r.declared).toBe(5);
    expect(r.recognized).toBe(3);
    expect(r.items.map((o) => [o.apolloId, o.name, o.domain])).toEqual([
      ['64f0a1b2c3d4e5f600000011', 'Zeta Gestionali Fittizia S.r.l.', 'zeta-gestionali-fittizia.it'],
      ['64f0a1b2c3d4e5f600000012', 'Eta Paghe Inventata', 'eta-paghe-inventata.it'],
      ['64f0a1b2c3d4e5f600000099', 'Iota Account Fittizio', 'iota-fittizia.it'],
    ]);
  });

  it('input non valido → vuoto', () => {
    for (const input of [null, undefined, 'x', 42, {}, { organizations: 'x' }]) {
      expect(mapOrganizations(input)).toEqual({ items: [], declared: 0, recognized: 0 });
    }
  });
});

describe('mapOrganizations: arricchimento (organizations/bulk_enrich)', () => {
  it('tutti i campi usati dalle regole di somiglianza', () => {
    const r = mapOrganizations(bulkEnrich);
    expect(r).toMatchObject({ declared: 1, recognized: 1 });
    expect(r.items[0]).toMatchObject({
      apolloId: '64f0a1b2c3d4e5f600000001',
      name: 'Acme Fittizia S.r.l.',
      domain: 'acme-fittizia.it',
      website: 'http://www.acme-fittizia.it',
      linkedinUrl: 'https://www.linkedin.com/company/acme-fittizia',
      industry: 'machinery',
      keywords: ['automazione industriale', 'macchine utensili', 'meccanica di precisione', 'b2b', 'manifattura'],
      employees: 85,
      city: 'Brescia',
      state: 'Lombardy',
      country: 'Italy',
    });
  });

  it('dipendenti come stringa numerica tollerati; valori non numerici ignorati; host condiviso non è dominio', () => {
    expect(mapOrganization({ id: 'o1', estimated_num_employees: '120' })?.employees).toBe(120);
    expect(mapOrganization({ id: 'o2', estimated_num_employees: 'molti' })?.employees).toBeUndefined();
    expect(mapOrganization({ id: 'o3', website_url: 'https://acme.wixsite.com/home' })?.domain).toBeUndefined();
    expect(mapOrganization({ id: 'o4', organization: {} })).toMatchObject({ apolloId: 'o4', keywords: [] });
  });
});

describe('mapPeople: ricerca persone (mixed_people/api_search, forma documentata)', () => {
  it('nessun URL: tutte riconosciute ma senza profilo, cognome offuscato', () => {
    const r = mapPeople(peopleSearch);
    expect(r).toMatchObject({ declared: 5, recognized: 5, skippedNoUrl: 5 });
    expect(r.candidates).toEqual([]);
    expect(r.withoutUrl).toHaveLength(5);
    const [giulia, , sara] = r.withoutUrl;
    expect(giulia).toMatchObject({
      apolloId: '65a0b1c2d3e4f5a600000201',
      firstName: 'Giulia',
      lastNameObfuscated: 'In***a',
      nameObfuscated: true,
      title: 'Chief Operating Officer',
      companyName: 'Gamma HR Fittizia S.p.A.',
      hasEmail: true,
    });
    expect(giulia!.fullName).toBeUndefined();
    for (const key of ['linkedinUrl', 'memberUrn', 'email', 'companyDomain', 'companyLinkedinUrl', 'location'] as const) {
      expect(giulia![key], key).toBeUndefined();
    }
    expect(sara!.hasEmail).toBe(false);
    expect(giulia!.raw).toBe(peopleSearch.people[0]);
  });
});

describe('mapPerson / mapPeople: match persona (people/match, bulk_match)', () => {
  it('forma completa: URL normalizzato, nome, email di lavoro, azienda con dominio e pagina LinkedIn', () => {
    const r = mapPeople(peopleMatch);
    expect(r).toMatchObject({ declared: 3, recognized: 2, skippedNoUrl: 0, withoutUrl: [] });
    expect(r.candidates[0]).toMatchObject({
      apolloId: '65a0b1c2d3e4f5a600000201',
      fullName: 'Giulia Inventata',
      firstName: 'Giulia',
      nameObfuscated: false,
      linkedinUrl: 'https://www.linkedin.com/in/giulia-inventata-esempio',
      title: 'Chief Operating Officer',
      seniority: 'c_suite',
      location: 'Milan, Lombardy, Italy',
      companyName: 'Gamma HR Fittizia S.p.A.',
      companyDomain: 'gamma-hr-fittizia.it',
      companyLinkedinUrl: 'https://www.linkedin.com/company/gamma-hr-fittizia',
      email: 'giulia.inventata@gamma-hr-fittizia.it',
      hasEmail: true,
    });
    expect(r.candidates[0]!.memberUrn).toBeUndefined();
  });

  it('bulk_match: matches[] con elementi nulli; URL in forma id membro → memberUrn; nome composto', () => {
    const r = mapPeople({
      status: 'success',
      matches: [
        {
          id: 'p-1',
          first_name: 'Paola',
          last_name: 'Immaginaria',
          linkedin_url: 'http://www.linkedin.com/in/ACoAAFakeApolloPaolaImmag01/',
          organization: { name: 'Beta Fittizia', website_url: 'https://www.beta-fittizia.it/contatti' },
        },
        null,
        { id: 'p-2', name: 'Senza Profilo', linkedin_url: 'https://www.linkedin.com/company/non-persona' },
      ],
    });
    expect(r).toMatchObject({ declared: 3, recognized: 2, skippedNoUrl: 1 });
    expect(r.candidates[0]).toMatchObject({
      fullName: 'Paola Immaginaria',
      linkedinUrl: 'https://www.linkedin.com/in/ACoAAFakeApolloPaolaImmag01',
      memberUrn: 'ACoAAFakeApolloPaolaImmag01',
      companyDomain: 'beta-fittizia.it',
    });
    // un URL LinkedIn che non è un profilo persona non vale come profilo
    expect(r.withoutUrl.map((p) => p.apolloId)).toEqual(['p-2']);
  });

  it('email bloccata di Apollo non è un\'email; senza id né URL → non riconosciuta; nome offuscato in name', () => {
    expect(mapPerson({ id: 'p-3', email: 'email_not_unlocked@domain.com' })).toMatchObject({ email: undefined, hasEmail: undefined });
    expect(mapPerson({ first_name: 'Anonimo', title: 'CTO' })).toBeNull();
    expect(mapPerson(null)).toBeNull();
    expect(mapPerson({ linkedin_url: 'linkedin.com/in/solo-url' })).toMatchObject({ apolloId: undefined, linkedinUrl: 'https://www.linkedin.com/in/solo-url' });
    expect(mapPerson({ id: 'p-4', name: 'Marco Fi***o' })).toMatchObject({ fullName: undefined, nameObfuscated: true });
    expect(mapPerson({ id: 'p-5', first_name: 'Solo' })).toMatchObject({ fullName: 'Solo', nameObfuscated: false });
  });

  it('input non valido → vuoto; persone ripetute tra people e contacts contate una volta', () => {
    for (const input of [null, 'x', {}, { people: 'x' }]) {
      expect(mapPeople(input)).toEqual({ candidates: [], withoutUrl: [], skippedNoUrl: 0, declared: 0, recognized: 0 });
    }
    const person = { id: 'p-9', name: 'Ripetuta Fittizia', linkedin_url: 'https://www.linkedin.com/in/ripetuta' };
    const r = mapPeople({ people: [person], contacts: [{ ...person }] });
    expect(r).toMatchObject({ declared: 2, recognized: 1 });
    expect(r.candidates).toHaveLength(1);
  });
});

describe('forme reali (smoke 2026-09-17)', () => {
  // Copie anonimizzate delle risposte reali (`_source: "smoke"`, sola lettura): si verificano solo fatti di
  // forma, mai valori personali.
  const smoke = (name: string) => fixture(`smoke/${name}`);

  // Esempio di riferimento della SPEC (Regole di somiglianza).
  const specReferences = [
    { name: 'Acme', keywords: ['software', 'saas', 'hr'], employees: 80, city: 'Milan', state: 'Lombardy', country: 'Italy' },
    { name: 'Beta', keywords: ['hr', 'payroll', 'human resources'], employees: 30, city: 'Turin', state: 'Piedmont', country: 'Italy' },
  ];
  const specFilters = deriveFilters(specReferences, { target_industries: ['hr tech'], company_size: '10-50', target_locations: ['Milano'] });

  it('ricerca aziende: tutte riconosciute con dominio e URL LinkedIn, nessun campo descrittivo, punteggio 0 con località esclusa', () => {
    const response = smoke('mixed-companies-search.json');
    expect(response._source).toBe('smoke');
    const r = mapOrganizations(response);
    expect(response.organizations.length).toBeGreaterThan(0);
    expect(r.declared).toBe(response.organizations.length + response.accounts.length);
    expect(r.recognized).toBe(response.organizations.length);
    for (const org of r.items) {
      expect(org.apolloId).toEqual(expect.any(String));
      expect(org.domain).toEqual(expect.any(String));
      expect(org.linkedinUrl).toMatch(/^https:\/\/www\.linkedin\.com\/company\/[^/]+$/);
      expect([org.industry, org.employees, org.city, org.state, org.country]).toEqual([undefined, undefined, undefined, undefined, undefined]);
      expect(org.keywords).toHaveLength(0);
      const score = scoreCandidate(org, specFilters, specReferences);
      expect(score.parts).toEqual({ keywords: 0, size: 0, location: null });
      expect(score.score).toBe(0);
    }
  });

  it('ricerca persone: tutte riconosciute, senza URL LinkedIn, nome offuscato', () => {
    const response = smoke('mixed-people-api-search.json');
    expect(response._source).toBe('smoke');
    const r = mapPeople(response);
    expect(response.people.length).toBeGreaterThan(0);
    expect(r.declared).toBe(response.people.length);
    expect(r.recognized).toBe(response.people.length);
    expect(r.candidates).toEqual([]);
    expect(r.withoutUrl).toHaveLength(response.people.length);
    expect(r.skippedNoUrl).toBe(response.people.length);
    for (const person of r.withoutUrl) {
      expect(person.apolloId).toEqual(expect.any(String));
      expect(person.linkedinUrl).toBeUndefined();
      expect(person.fullName).toBeUndefined();
      expect(person.nameObfuscated).toBe(true);
      expect(person.companyName).toEqual(expect.any(String));
      expect(person.companyDomain).toBeUndefined();
      expect(typeof person.hasEmail).toBe('boolean');
    }
  });

  it('match persone (bulk_match): candidate con URL LinkedIn, dominio aziendale ed email di lavoro', () => {
    const response = smoke('people-bulk-match.json');
    expect(response._source).toBe('smoke');
    const r = mapPeople(response);
    const matched = response.matches.filter(Boolean);
    expect(matched.length).toBeGreaterThan(0);
    // Dettagli diversi (id Apollo e URL) possono risolversi nella stessa persona: `matches[]` la ripete e
    // Apollo addebita un solo credito (`unique_enriched_records`); `mapPeople` la conta una volta.
    const uniqueIds = new Set(matched.map((m: any) => m.id));
    expect(r.declared).toBe(response.matches.length);
    expect(r.recognized).toBe(uniqueIds.size);
    expect(r.candidates).toHaveLength(uniqueIds.size);
    expect(r.withoutUrl).toEqual([]);
    for (const person of r.candidates) {
      expect(person.linkedinUrl).toMatch(/^https:\/\/www\.linkedin\.com\/in\/[^/]+$/);
      expect(person.companyDomain).toEqual(expect.any(String));
      expect(person.companyLinkedinUrl).toMatch(/^https:\/\/www\.linkedin\.com\/company\/[^/]+$/);
      expect(person.fullName).toEqual(expect.any(String));
      expect(person.nameObfuscated).toBe(false);
      expect(person.email).toMatch(/@/);
    }
    // L'organizzazione annidata del match ha i campi descrittivi: mappabile come un arricchimento.
    const org = mapOrganization(matched[0].organization);
    expect(org?.industry).toEqual(expect.any(String));
    expect(org?.keywords.length).toBeGreaterThan(0);
  });

  it('arricchimento (bulk_enrich): settore, parole chiave, dipendenti, città e paese', () => {
    const response = smoke('organizations-bulk-enrich.json');
    expect(response._source).toBe('smoke');
    const r = mapOrganizations(response);
    expect(r.recognized).toBe(response.organizations.length);
    for (const org of r.items) {
      expect(org.apolloId).toEqual(expect.any(String));
      expect(org.domain).toEqual(expect.any(String));
      expect(org.industry).toEqual(expect.any(String));
      expect(org.keywords.length).toBeGreaterThan(0);
      expect(org.employees).toEqual(expect.any(Number));
      expect(org.city).toEqual(expect.any(String));
      expect(org.country).toEqual(expect.any(String));
    }
  });
});
