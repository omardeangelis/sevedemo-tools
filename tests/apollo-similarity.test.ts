import { describe, expect, it } from 'vitest';
import {
  deriveFilters,
  scoreCandidate,
  bucketOf,
  type SimilarityCompany,
  type SimilarityIcp,
} from '../src/apollo/similarity.js';

// Esempio di riferimento della SPEC ("Regole di somiglianza (v1, deterministiche)"): aziende inventate.
const acme: SimilarityCompany = {
  name: 'Acme',
  keywords: ['software', 'saas', 'hr'],
  employees: 80,
  city: 'Milan',
  state: 'Lombardy',
  country: 'Italy',
};
const beta: SimilarityCompany = {
  name: 'Beta',
  keywords: ['hr', 'payroll', 'human resources'],
  employees: 30,
  city: 'Turin',
  state: 'Piedmont',
  country: 'Italy',
};
const icp: SimilarityIcp = { target_industries: ['hr tech'], company_size: '10-50', target_locations: ['Milano'] };
const references = [acme, beta];

const gamma: SimilarityCompany = {
  name: 'Gamma',
  keywords: ['hr', 'saas', 'fintech'],
  employees: 60,
  city: 'Milan',
  state: 'Lombardy',
  country: 'Italy',
};
const delta: SimilarityCompany = { ...gamma, name: 'Delta', city: 'Bergamo', state: 'Lombardy' };
const epsilon: SimilarityCompany = { ...gamma, name: 'Epsilon', city: undefined, state: undefined };

describe('Regole di somiglianza v1: esempio di riferimento della SPEC', () => {
  it('filtri derivati da Acme, Beta e ICP', () => {
    const filters = deriveFilters(references, icp);
    expect(filters.keywords).toEqual(['hr', 'human resources', 'payroll', 'saas', 'software', 'hr tech']);
    expect(filters.ranges).toEqual(['1-10', '11-20', '21-50', '51-100', '101-200']);
    expect(filters.locations).toEqual(['Italy', 'Milano']);
    expect(filters.notes).toEqual([]);
  });

  it('Gamma: punteggio 0.67 con le tre ragioni nell\'ordine parole chiave → dimensione → località', () => {
    const filters = deriveFilters(references, icp);
    const r = scoreCandidate(gamma, filters, references);
    expect(r.score).toBe(0.67);
    expect(r.parts).toEqual({ keywords: 0.333, size: 1, location: 1 });
    expect(r.reasons).toEqual([
      '2 parole chiave in comune: hr, saas',
      'stessa fascia di dipendenti di Acme (51-100)',
      'stessa città di Acme (Milan)',
    ]);
    expect(bucketOf(r.score)).toBe('alto');
  });

  it('Delta (stessa regione di Acme): 0.57, fascia media', () => {
    const r = scoreCandidate(delta, deriveFilters(references, icp), references);
    expect(r.score).toBe(0.57);
    expect(r.parts).toEqual({ keywords: 0.333, size: 1, location: 0.5 });
    expect(r.reasons[2]).toBe('stessa regione di Acme (Lombardy)');
    expect(bucketOf(r.score)).toBe('medio');
  });

  it('Epsilon senza sede: località esclusa, 0.58 rinormalizzato, fascia media', () => {
    const r = scoreCandidate(epsilon, deriveFilters(references, icp), references);
    expect(r.score).toBe(0.58);
    expect(r.parts.location).toBeNull();
    expect(r.reasons).toEqual([
      '2 parole chiave in comune: hr, saas',
      'stessa fascia di dipendenti di Acme (51-100)',
      'località non disponibile da Apollo',
    ]);
    expect(bucketOf(r.score)).toBe('medio');
  });
});

describe('deriveFilters: origini, ordinamento e casi limite', () => {
  it('origini di ogni valore: nomi delle referenze e/o ICP', () => {
    const { origins } = deriveFilters(references, icp);
    expect(origins.keywords).toEqual({
      hr: ['Acme', 'Beta'],
      'human resources': ['Beta'],
      payroll: ['Beta'],
      saas: ['Acme'],
      software: ['Acme'],
      'hr tech': ['ICP'],
    });
    expect(origins.ranges).toEqual({
      '1-10': ['ICP'],
      '11-20': ['Beta', 'ICP'],
      '21-50': ['Acme', 'Beta', 'ICP'],
      '51-100': ['Acme', 'Beta'],
      '101-200': ['Acme'],
    });
    expect(origins.locations).toEqual({ Italy: ['Acme', 'Beta'], Milano: ['ICP'] });
  });

  it('frequenza decrescente, poi alfabetico; tag normalizzati (maiuscole, spazi, industry) senza doppioni', () => {
    const refs: SimilarityCompany[] = [
      { name: 'Uno', keywords: ['Zeta', 'beta', ' ALFA  uno '], industry: 'zeta' },
      { name: 'Due', keywords: ['zeta', 'gamma'], industry: 'Beta' },
    ];
    expect(deriveFilters(refs, null).keywords).toEqual(['beta', 'zeta', 'alfa uno', 'gamma']);
  });

  it('prime 10 parole chiave; i settori dell\'ICP si aggiungono oltre le 10 se non già presenti', () => {
    const tags = ['a01', 'a02', 'a03', 'a04', 'a05', 'a06', 'a07', 'a08', 'a09', 'a10', 'a11', 'a12'];
    const refs: SimilarityCompany[] = [{ name: 'Molti tag', keywords: tags }];
    const f = deriveFilters(refs, { target_industries: ['A02', 'a12', 'Fintech'], company_size: null, target_locations: [] });
    expect(f.keywords).toEqual([...tags.slice(0, 10), 'a12', 'fintech']);
    expect(f.keywords).toHaveLength(12);
    expect(f.origins.keywords.a02).toEqual(['Molti tag', 'ICP']);
    expect(f.origins.keywords.a12).toEqual(['ICP']);
  });

  it('company_size "10-50" → 1-10, 11-20, 21-50', () => {
    const f = deriveFilters([], { target_industries: [], company_size: '10-50', target_locations: [] });
    expect(f.ranges).toEqual(['1-10', '11-20', '21-50']);
    expect(f.notes).toEqual([]);
  });

  it('company_size "50+" → da 21-50 in su', () => {
    const f = deriveFilters([], { target_industries: [], company_size: '50+', target_locations: [] });
    expect(f.ranges).toEqual(['21-50', '51-100', '101-200', '201-500', '501-1000', '1001-2000', '2001-5000', '5001-10000', '10001+']);
  });

  it('company_size non riconoscibile → ignorata con nota in italiano', () => {
    const f = deriveFilters([acme], { target_industries: [], company_size: 'circa cinquanta', target_locations: [] });
    expect(f.ranges).toEqual(['21-50', '51-100', '101-200']);
    expect(f.notes).toHaveLength(1);
    expect(f.notes[0]).toContain('"circa cinquanta"');
    expect(f.notes[0]).toContain('non è riconoscibile');
  });

  it('fasce sempre in ordine canonico Apollo, anche con referenze in ordine sparso', () => {
    const refs: SimilarityCompany[] = [{ name: 'Grande', employees: 12000 }, { name: 'Piccola', employees: 5 }];
    expect(deriveFilters(refs, null).ranges).toEqual(['1-10', '11-20', '5001-10000', '10001+']);
  });

  it('località senza doppioni (confronto normalizzato), prima grafia vinta; ICP nullo → solo referenze', () => {
    const f = deriveFilters([acme, { ...beta, country: 'ITALY ' }], { target_industries: [], company_size: null, target_locations: ['italy', 'Roma'] });
    expect(f.locations).toEqual(['Italy', 'Roma']);
    expect(f.origins.locations.Italy).toEqual(['Acme', 'Beta', 'ICP']);
    expect(deriveFilters([], null)).toEqual({
      keywords: [],
      ranges: [],
      locations: [],
      origins: { keywords: {}, ranges: {}, locations: {} },
      notes: [],
    });
  });
});

describe('fasce di dipendenti', () => {
  it('rangeOf, neighbours, parseIcpSize, normalizeRange', async () => {
    const { rangeOf, neighbours, parseIcpSize, normalizeRange, APOLLO_EMPLOYEE_RANGES } = await import('../src/apollo/similarity.js');
    expect(APOLLO_EMPLOYEE_RANGES).toHaveLength(11);
    expect([1, 10, 11, 50, 51, 10000, 10001, 250000].map(rangeOf)).toEqual(['1-10', '1-10', '11-20', '21-50', '51-100', '5001-10000', '10001+', '10001+']);
    expect([0, -3, undefined, null, Number.NaN].map((n) => rangeOf(n as number))).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(neighbours('1-10')).toEqual(['11-20']);
    expect(neighbours('51-100')).toEqual(['21-50', '101-200']);
    expect(neighbours('10001+')).toEqual(['5001-10000']);
    expect(neighbours('boh')).toEqual([]);
    expect(parseIcpSize('10-50')).toEqual([10, 50]);
    expect(parseIcpSize(' 50 – 200 dipendenti')).toEqual([50, 200]);
    expect(parseIcpSize('50+')).toEqual([50, null]);
    expect(parseIcpSize('1.000-5.000')).toEqual([1000, 5000]);
    expect(['', 'piccola', '50-10', '10-', null].map((s) => parseIcpSize(s))).toEqual([null, null, null, null, null]);
    expect(['1,10', '51 - 100', '10001,', '10001+', '1-11'].map(normalizeRange)).toEqual(['1-10', '51-100', '10001+', '10001+', undefined]);
  });
});

describe('scoreCandidate: casi limite', () => {
  const filters = deriveFilters(references, icp);

  it('filtro senza parole chiave → componente 0, nessuna ragione sulle parole chiave', () => {
    const r = scoreCandidate(gamma, { ...filters, keywords: [] }, references);
    expect(r.parts).toEqual({ keywords: 0, size: 1, location: 1 });
    expect(r.score).toBe(0.5);
    expect(r.reasons).toEqual(['stessa fascia di dipendenti di Acme (51-100)', 'stessa città di Acme (Milan)']);
  });

  it('candidata senza tag → componente 0', () => {
    const r = scoreCandidate({ ...gamma, keywords: [], industry: null }, filters, references);
    expect(r.parts.keywords).toBe(0);
    expect(r.score).toBe(0.5);
  });

  it('tag confrontati normalizzati; una sola parola chiave → ragione al singolare; industry conta come tag', () => {
    const r = scoreCandidate({ name: 'Zeta', keywords: [' HR '], industry: 'Payroll', employees: 60, city: 'Milan' }, filters, references);
    expect(r.parts.keywords).toBe(0.333);
    expect(r.reasons[0]).toBe('2 parole chiave in comune: hr, payroll');
    const one = scoreCandidate({ name: 'Eta', keywords: ['SaaS'], employees: 60, city: 'Milan' }, filters, references);
    expect(one.reasons[0]).toBe('1 parola chiave in comune: saas');
  });

  it('fascia adiacente → 0,5 "fascia vicina a"; nessun dato → 0; più referenze nella stessa città elencate', () => {
    const refs: SimilarityCompany[] = [
      { name: 'Acme', employees: 80, city: 'Milan', state: 'Lombardy' },
      { name: 'Omega', employees: 90, city: 'milan', state: 'Lombardy' },
    ];
    const f = deriveFilters(refs, null);
    const near = scoreCandidate({ name: 'Theta', employees: 150, city: 'Milan' }, f, refs);
    expect(near.parts).toEqual({ keywords: 0, size: 0.5, location: 1 });
    expect(near.reasons).toEqual(['fascia vicina a Acme, Omega', 'stessa città di Acme, Omega (Milan)']);
    expect(near.score).toBe(0.35);
    const far = scoreCandidate({ name: 'Iota', employees: 5000, city: 'Rome', state: 'Lazio' }, f, refs);
    expect(far.parts).toEqual({ keywords: 0, size: 0, location: 0 });
    expect(far.reasons).toEqual([]);
    expect(far.score).toBe(0);
  });

  it('referenze senza città né regione → località null per tutte le candidate', () => {
    const refs: SimilarityCompany[] = [{ ...acme, city: null, state: undefined }, { ...beta, city: '', state: '  ' }];
    for (const c of [gamma, delta, epsilon]) {
      const r = scoreCandidate(c, deriveFilters(refs, icp), refs);
      expect(r.parts.location).toBeNull();
      expect(r.reasons).toContain('località non disponibile da Apollo');
    }
  });

  it('bucketOf ai bordi', () => {
    expect([0, 0.33, 0.34, 0.5, 0.66, 0.67, 1].map(bucketOf)).toEqual(['basso', 'basso', 'medio', 'medio', 'medio', 'alto', 'alto']);
  });

  it('costanti esportate', async () => {
    const m = await import('../src/apollo/similarity.js');
    expect(m.SCORING_VERSION).toBe('v1');
    expect(m.TOP_KEYWORDS).toBe(10);
    expect(m.SCORE_WEIGHTS).toEqual({ keywords: 0.5, size: 0.3, location: 0.2 });
    expect(m.SCORE_BUCKETS.map((b) => [b.bucket, b.min])).toEqual([['basso', 0], ['medio', 0.34], ['alto', 0.67]]);
  });
});

describe('filtersEqual e filtersHash (ripartenza, SPEC D6)', () => {
  it('insensibili a ordine, maiuscole, spazi, doppioni e formato delle fasce', async () => {
    const { filtersEqual, filtersHash } = await import('../src/apollo/similarity.js');
    const a = { keywords: ['hr', 'SaaS'], ranges: ['51-100', '1-10'], locations: ['Italy', 'Milano'] };
    const b = { keywords: ['saas ', 'HR', 'hr'], ranges: ['1,10', '51-100'], locations: ['milano', 'ITALY'] };
    expect(filtersEqual(a, b)).toBe(true);
    expect(filtersHash(a)).toBe(filtersHash(b));
    expect(filtersHash(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(filtersHash(a)).toBe(filtersHash({ ...a }));
    // Con origini e note (output di deriveFilters) conta solo il contenuto dei filtri.
    const derived = deriveFilters(references, icp);
    expect(filtersEqual(derived, { keywords: [...derived.keywords].reverse(), ranges: derived.ranges, locations: derived.locations })).toBe(true);
  });

  it('insiemi diversi → diversi', async () => {
    const { filtersEqual, filtersHash } = await import('../src/apollo/similarity.js');
    const a = { keywords: ['hr'], ranges: ['1-10'], locations: ['Italy'] };
    for (const b of [
      { ...a, keywords: ['hr', 'saas'] },
      { ...a, ranges: ['11-20'] },
      { ...a, locations: [] },
      { keywords: [], ranges: ['1-10'], locations: ['hr', 'Italy'] },
    ]) {
      expect(filtersEqual(a, b)).toBe(false);
      expect(filtersHash(a)).not.toBe(filtersHash(b));
    }
  });
});
