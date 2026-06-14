import { describe, it, expect } from 'vitest';

describe('normalizeLinkedinUrl', () => {
  it('preserva il case dello slug: gli URL member-ID sono case-sensitive', async () => {
    const { normalizeLinkedinUrl } = await import('../src/util/fields.js');
    expect(
      normalizeLinkedinUrl('https://www.linkedin.com/in/ACwAADxrsTUBISVguSOLpXxc/'),
    ).toBe('https://www.linkedin.com/in/ACwAADxrsTUBISVguSOLpXxc');
  });

  it('normalizza host, query/hash e trailing slash', async () => {
    const { normalizeLinkedinUrl } = await import('../src/util/fields.js');
    expect(
      normalizeLinkedinUrl('http://it.linkedin.com/in/mario-rossi/?utm_source=x#section'),
    ).toBe('https://www.linkedin.com/in/mario-rossi');
  });
});

describe('mapProfileItem', () => {
  it('mappa il payload harvestapi: nome da firstName/lastName, headline dalla posizione corrente', async () => {
    const { mapProfileItem } = await import('../src/strategies/people-search.js');
    const c = mapProfileItem({
      id: 'ACwAADxrsTUB',
      linkedinUrl: 'https://www.linkedin.com/in/ACwAADxrsTUB',
      firstName: 'Anna',
      lastName: 'Luchkovska',
      summary: 'Motivated IT Recruiter with 1.5 years of experience…',
      currentPositions: [{ title: 'IT Recruiter', companyName: 'DICEUS', current: true }],
    });
    expect(c).not.toBeNull();
    expect(c!.linkedinUrl).toBe('https://www.linkedin.com/in/ACwAADxrsTUB');
    expect(c!.fullName).toBe('Anna Luchkovska');
    expect(c!.headline).toBe('IT Recruiter @ DICEUS');
  });

  it('preferisce fullName/headline top-level quando presenti', async () => {
    const { mapProfileItem } = await import('../src/strategies/people-search.js');
    const c = mapProfileItem({
      linkedinUrl: 'https://www.linkedin.com/in/mario-rossi',
      fullName: 'Mario Rossi',
      headline: 'UX Designer freelance',
      firstName: 'NonUsato',
      currentPositions: [{ title: 'Altro', companyName: 'Altrove' }],
    });
    expect(c!.fullName).toBe('Mario Rossi');
    expect(c!.headline).toBe('UX Designer freelance');
  });

  it('lascia undefined i campi non ricostruibili', async () => {
    const { mapProfileItem } = await import('../src/strategies/people-search.js');
    const c = mapProfileItem({ linkedinUrl: 'https://www.linkedin.com/in/ACwAAxyz' });
    expect(c!.fullName).toBeUndefined();
    expect(c!.headline).toBeUndefined();
  });
});
