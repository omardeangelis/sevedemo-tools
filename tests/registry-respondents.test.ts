import { describe, expect, it } from 'vitest';

describe('registry (T8): rename influencer-post-respondents', () => {
  it('getStrategy("influencer-post-respondents") è definita; la vecchia è undefined', async () => {
    const { getStrategy, listStrategies } = await import('../src/strategies/registry.js');
    expect(getStrategy('influencer-post-respondents')).toBeDefined();
    expect(getStrategy('freelance-post-reactors')).toBeUndefined();
    const ids = listStrategies().map((s) => s.id);
    expect(ids).toContain('influencer-post-respondents');
    expect(ids).not.toContain('freelance-post-reactors');
  });

  it('la strategia è abilitata (no-cookie) nel run giornaliero', async () => {
    const { dailyStrategies } = await import('../src/strategies/registry.js');
    expect(dailyStrategies().map((s) => s.id)).toContain('influencer-post-respondents');
  });
});
