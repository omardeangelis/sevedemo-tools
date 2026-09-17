import { describe, expect, it } from 'vitest';

describe('apimaestro actor IDs', () => {
  it('espone gli id degli actor posts + comments', async () => {
    const { ACTORS } = await import('../src/apify/actors.js');
    expect(ACTORS.profilePostsApimaestro).toBe('apimaestro/linkedin-profile-posts');
    expect(ACTORS.postComments).toBe(
      'apimaestro/linkedin-post-comments-replies-engagements-scraper-no-cookies',
    );
  });
});

describe('profilePostsApimaestroInput', () => {
  it('mappa username (accetta URL) + total_posts', async () => {
    const { profilePostsApimaestroInput } = await import('../src/apify/actors.js');
    expect(profilePostsApimaestroInput('https://www.linkedin.com/in/guido-penta/', 5)).toEqual({
      username: 'https://www.linkedin.com/in/guido-penta/',
      total_posts: 5,
    });
  });
});

describe('postCommentsInput', () => {
  it('mappa postIds + limit + sortOrder default "most recent"', async () => {
    const { postCommentsInput } = await import('../src/apify/actors.js');
    expect(postCommentsInput(['7472928569657225216'], 100)).toEqual({
      postIds: ['7472928569657225216'],
      limit: 100,
      sortOrder: 'most recent',
    });
  });

  it('consente di sovrascrivere sortOrder', async () => {
    const { postCommentsInput } = await import('../src/apify/actors.js');
    expect(postCommentsInput(['1', '2'], 50, 'most relevant')).toEqual({
      postIds: ['1', '2'],
      limit: 50,
      sortOrder: 'most relevant',
    });
  });
});

describe('postReactionsInput (T7)', () => {
  it('batch di post_urls + page_number + limit default 100', async () => {
    const { ACTORS, postReactionsInput } = await import('../src/apify/actors.js');
    expect(ACTORS.postReactions).toBe('apimaestro/linkedin-post-reactions');
    expect(postReactionsInput(['a', 'b'], { pageNumber: 2 })).toEqual({
      post_urls: ['a', 'b'],
      page_number: 2,
      limit: 100,
    });
  });

  it('senza opzioni parte da pagina 1; limit sovrascrivibile', async () => {
    const { postReactionsInput } = await import('../src/apify/actors.js');
    expect(postReactionsInput(['a'])).toEqual({ post_urls: ['a'], page_number: 1, limit: 100 });
    expect(postReactionsInput(['a'], { pageNumber: 3, limit: 50 })).toEqual({
      post_urls: ['a'],
      page_number: 3,
      limit: 50,
    });
  });
});

describe('companyEmployeesInput (T7)', () => {
  it('mappa companies + filtri + maxItems + modalità con il valore letterale dell\'enum actor', async () => {
    const { ACTORS, companyEmployeesInput } = await import('../src/apify/actors.js');
    expect(ACTORS.companyEmployees).toBe('harvestapi/linkedin-company-employees');
    expect(
      companyEmployeesInput(['https://www.linkedin.com/company/acme-fittizia'], {
        jobTitles: ['CTO', 'Head of Engineering'],
        locations: ['Italia'],
        maxItems: 50,
        mode: 'Full',
      }),
    ).toEqual({
      companies: ['https://www.linkedin.com/company/acme-fittizia'],
      jobTitles: ['CTO', 'Head of Engineering'],
      locations: ['Italia'],
      maxItems: 50,
      profileScraperMode: 'Full ($8 per 1k)',
    });
  });

  it('default Short; filtri vuoti omessi (nessun filtro ≠ filtro vuoto)', async () => {
    const { companyEmployeesInput } = await import('../src/apify/actors.js');
    expect(
      companyEmployeesInput(['https://www.linkedin.com/company/acme-fittizia'], {
        jobTitles: [],
        maxItems: 10,
      }),
    ).toEqual({
      companies: ['https://www.linkedin.com/company/acme-fittizia'],
      maxItems: 10,
      profileScraperMode: 'Short ($4 per 1k)',
    });
  });

  it('Full+email → valore enum con email search', async () => {
    const { companyEmployeesInput } = await import('../src/apify/actors.js');
    expect(companyEmployeesInput(['x'], { maxItems: 5, mode: 'Full+email' }).profileScraperMode).toBe(
      'Full + email search ($12 per 1k)',
    );
  });
});
