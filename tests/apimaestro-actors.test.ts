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
