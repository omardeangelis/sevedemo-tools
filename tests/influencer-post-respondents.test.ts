import { describe, expect, it, vi } from 'vitest';
import type { RawCandidate } from '../src/strategies/types.js';
import type { CompanyRef } from '../src/strategies/post-extract.js';

function postItem(
  activityId: string,
  opts: { person?: { name: string; urn: string }; company?: { name: string; urn: string } } = {},
) {
  const anns: any[] = [];
  if (opts.person) anns.push({ type: 'profile', text: opts.person.name, profile_urn: opts.person.urn });
  if (opts.company) anns.push({ type: 'company', text: opts.company.name, company_urn: opts.company.urn });
  return {
    urn: { activity_urn: activityId },
    url: `https://www.linkedin.com/posts/x-activity-${activityId}`,
    text_annotations: anns,
  };
}

function commentItem(slug: string) {
  return {
    comment_type: 'comment',
    author: { name: slug, headline: 'Headline', profile_url: `https://www.linkedin.com/in/${slug}` },
    post_input: 'x',
  };
}

/** Deps di default (tutto vuoto), sovrascrivibili per caso. */
function deps(over: Partial<Parameters<any>[1]> = {}) {
  return {
    influencers: ['https://www.linkedin.com/in/inf-a', 'https://www.linkedin.com/in/inf-b'],
    postsPerInfluencer: 5,
    taggedPersonEnabled: false,
    fetchPosts: vi.fn(async () => [] as any[]),
    fetchComments: vi.fn(async () => [] as any[]),
    expand: vi.fn(async (_c: CompanyRef[]) => [] as RawCandidate[]),
    ...over,
  };
}

describe('collectRespondents (T6): orchestrazione', () => {
  it('produce i 3 sourceDetail (commenter, tagged-person, company-expansion) con flag tagged ON', async () => {
    const { collectRespondents } = await import('../src/strategies/influencer-post-respondents.js');
    const d = deps({
      taggedPersonEnabled: true,
      fetchPosts: vi.fn(async (url: string) =>
        url.endsWith('inf-a')
          ? [postItem('100', { person: { name: 'Tag', urn: 'ACoAAtag1' }, company: { name: 'Welyk', urn: '105729725' } })]
          : [postItem('200', { company: { name: 'Welyk', urn: '105729725' } })],
      ),
      fetchComments: vi.fn(async (id: string) => (id === '100' ? [commentItem('john')] : [commentItem('laura')])),
      expand: vi.fn(async (c: CompanyRef[]) =>
        c.length ? [{ linkedinUrl: 'https://www.linkedin.com/in/dm-1', fullName: 'DM', sourceDetail: 'company-expansion', raw: {} }] : [],
      ),
    });

    const out = await collectRespondents(50, d);
    const details = new Set(out.map((c) => c.sourceDetail));
    expect(details).toEqual(new Set(['commenter', 'tagged-person', 'company-expansion']));
    // azienda Welyk taggata in 2 post → espansa una volta (dedup a carico di expand): expand chiamata una volta con 2 ref
    expect(d.expand).toHaveBeenCalledTimes(1);
    expect((d.expand.mock.calls[0][0] as CompanyRef[]).length).toBe(2);
  });

  it('con flag tagged OFF non emette candidati tagged-person', async () => {
    const { collectRespondents } = await import('../src/strategies/influencer-post-respondents.js');
    const d = deps({
      taggedPersonEnabled: false,
      fetchPosts: vi.fn(async () => [postItem('100', { person: { name: 'Tag', urn: 'ACoAAtag1' } })]),
      fetchComments: vi.fn(async () => [commentItem('john')]),
    });
    const out = await collectRespondents(50, d);
    expect(out.some((c) => c.sourceDetail === 'tagged-person')).toBe(false);
    expect(out.some((c) => c.sourceDetail === 'commenter')).toBe(true);
  });

  it('un post con comments=[] non lancia e contribuisce 0', async () => {
    const { collectRespondents } = await import('../src/strategies/influencer-post-respondents.js');
    const d = deps({ fetchPosts: vi.fn(async () => [postItem('100')]), fetchComments: vi.fn(async () => []) });
    const out = await collectRespondents(50, d);
    expect(out).toEqual([]);
  });

  it('un errore in fetchComments di un post è isolato (non fa fallire source)', async () => {
    const { collectRespondents } = await import('../src/strategies/influencer-post-respondents.js');
    const d = deps({
      fetchPosts: vi.fn(async (url: string) => [postItem(url.endsWith('inf-a') ? '100' : '200')]),
      fetchComments: vi.fn(async (id: string) => {
        if (id === '100') throw new Error('boom comments');
        return [commentItem('laura')];
      }),
    });
    const out = await collectRespondents(50, d);
    expect(out.map((c) => c.linkedinUrl)).toEqual(['https://www.linkedin.com/in/laura']);
  });

  it('tutti i post a 0 e nessuna azienda → [] senza throw', async () => {
    const { collectRespondents } = await import('../src/strategies/influencer-post-respondents.js');
    const out = await collectRespondents(50, deps());
    expect(out).toEqual([]);
  });

  it('rispetta il limit deduplicando per URL', async () => {
    const { collectRespondents } = await import('../src/strategies/influencer-post-respondents.js');
    const d = deps({
      fetchPosts: vi.fn(async () => [postItem('100')]),
      fetchComments: vi.fn(async () => [commentItem('john'), commentItem('mary'), commentItem('john')]),
    });
    const out = await collectRespondents(2, d);
    expect(out.length).toBe(2);
    expect(new Set(out.map((c) => c.linkedinUrl)).size).toBe(2);
  });

  it('seed vuoto → throw coerente', async () => {
    const { collectRespondents } = await import('../src/strategies/influencer-post-respondents.js');
    await expect(collectRespondents(50, deps({ influencers: [] }))).rejects.toThrow();
  });
});

describe('influencerPostRespondents (T6): identità strategia', () => {
  it('id e bucketHint corretti, no cookie', async () => {
    const { influencerPostRespondents } = await import('../src/strategies/influencer-post-respondents.js');
    expect(influencerPostRespondents.id).toBe('influencer-post-respondents');
    expect(influencerPostRespondents.bucketHint).toBe('misto');
    expect(influencerPostRespondents.requiresCookie).toBe(false);
  });
});
