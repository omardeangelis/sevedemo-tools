import { describe, expect, it, vi } from 'vitest';
import type { CompanyRef } from '../src/strategies/post-extract.js';

/** People-search finta: ritorna 1 profilo harvest-shaped per (query). */
function fakeSearch(byQuery: Record<string, any[]>) {
  return vi.fn(async (query: string) => byQuery[query] ?? []);
}

function harvestItem(slug: string, title: string, company: string) {
  return {
    linkedinUrl: `https://www.linkedin.com/in/${slug}`,
    firstName: slug,
    lastName: 'X',
    currentPositions: [{ title, companyName: company }],
  };
}

describe('expandCompanies (T7): companyRef[] → RawCandidate(company-expansion)', () => {
  it('cerca per ruolo, mappa a candidati company-expansion ≤ perCompany, dedup', async () => {
    const { expandCompanies } = await import('../src/strategies/company-expansion.js');
    const companies: CompanyRef[] = [{ name: 'Welyk', companyUrn: '105729725' }];
    const search = fakeSearch({
      'CEO Welyk': [harvestItem('ceo-welyk', 'CEO', 'Welyk')],
      'CTO Welyk': [harvestItem('cto-welyk', 'CTO', 'Welyk'), harvestItem('ceo-welyk', 'CEO', 'Welyk')],
    });

    const out = await expandCompanies(companies, { roles: ['CEO', 'CTO'], perCompany: 3, location: 'Italy', search });

    expect(out.length).toBe(2); // ceo + cto, il duplicato ceo è deduplicato
    expect(out.every((c) => c.sourceDetail === 'company-expansion')).toBe(true);
    expect(out.map((c) => c.linkedinUrl)).toEqual(
      expect.arrayContaining([
        'https://www.linkedin.com/in/ceo-welyk',
        'https://www.linkedin.com/in/cto-welyk',
      ]),
    );
  });

  it('rispetta perCompany come cap (anche con molti risultati per ruolo)', async () => {
    const { expandCompanies } = await import('../src/strategies/company-expansion.js');
    const search = fakeSearch({
      'CEO Acme': [harvestItem('a', 'CEO', 'Acme'), harvestItem('b', 'CEO', 'Acme'), harvestItem('c', 'CEO', 'Acme')],
    });
    const out = await expandCompanies([{ name: 'Acme' }], { roles: ['CEO'], perCompany: 2, search });
    expect(out.length).toBe(2);
  });

  it('la stessa azienda passata 3 volte si espande una sola volta (cross-post dedup)', async () => {
    const { expandCompanies } = await import('../src/strategies/company-expansion.js');
    const search = fakeSearch({ 'CEO Welyk': [harvestItem('ceo-welyk', 'CEO', 'Welyk')] });
    const companies: CompanyRef[] = [
      { name: 'Welyk', companyUrn: '105729725' },
      { name: 'Welyk', companyUrn: '105729725' },
      { name: 'Welyk', companyUrn: '105729725' },
    ];
    const out = await expandCompanies(companies, { roles: ['CEO'], perCompany: 5, search });
    expect(out.length).toBe(1);
    expect(search).toHaveBeenCalledTimes(1); // una sola ricerca, non tre
  });

  it('dedup cross-post per NOME quando manca companyUrn (una sola espansione)', async () => {
    const { expandCompanies } = await import('../src/strategies/company-expansion.js');
    const search = fakeSearch({ 'CEO Acme': [harvestItem('ceo-acme', 'CEO', 'Acme')] });
    const companies: CompanyRef[] = [{ name: 'Acme' }, { name: 'Acme' }];
    const out = await expandCompanies(companies, { roles: ['CEO'], perCompany: 5, search });
    expect(out.length).toBe(1);
    expect(search).toHaveBeenCalledTimes(1); // chiave nome → una sola ricerca
  });

  it('0 aziende → [] (nessuna ricerca)', async () => {
    const { expandCompanies } = await import('../src/strategies/company-expansion.js');
    const search = fakeSearch({});
    const out = await expandCompanies([], { roles: ['CEO'], perCompany: 3, search });
    expect(out).toEqual([]);
    expect(search).not.toHaveBeenCalled();
  });
});
