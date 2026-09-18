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
