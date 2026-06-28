import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const posts = JSON.parse(
  readFileSync(path.join(here, 'fixtures/apimaestro-profile-posts.json'), 'utf8'),
) as any[];
const comments = JSON.parse(
  readFileSync(path.join(here, 'fixtures/apimaestro-post-comments.json'), 'utf8'),
) as any[];

describe('extractPost (T3): post item → activityId/postUrl/people/companies', () => {
  it('estrae activityId, postUrl e le annotation top-level (profile/company)', async () => {
    const { extractPost } = await import('../src/strategies/post-extract.js');
    const r = extractPost(posts[0]);

    expect(r.activityId).toBe('7472928569657225216');
    expect(r.postUrl).toBe(posts[0].url);
    expect(r.people).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Victoria', profileUrn: 'ACoAACB65IgB2pmc36MjOjPI6M9USQKtOi1lqtw' }),
      ]),
    );
    expect(r.companies).toEqual([{ name: 'Welyk', companyUrn: '105729725' }]);
  });

  it('D9: ignora le text_annotations del reshared_post (solo top-level)', async () => {
    const { extractPost } = await import('../src/strategies/post-extract.js');
    // posts[2] è il quote con reshared_post che taggava Michela/Luca/Talentware:
    // SOLO la company Talentware top-level deve emergere, niente persone dal reshared.
    const r = extractPost(posts[2]);
    expect(r.activityId).toBe('7472580694498500608');
    expect(r.people).toEqual([]); // nessuna persona top-level
    expect(r.companies).toEqual([{ name: 'Talentware', companyUrn: '76489042' }]);
  });

  it('estrae activityId da full_urn se urn.activity_urn manca', async () => {
    const { extractPost } = await import('../src/strategies/post-extract.js');
    const r = extractPost({ full_urn: 'urn:li:activity:999', url: 'https://x', text_annotations: [] });
    expect(r.activityId).toBe('999');
  });
});

describe('mapComment (T4): commento → RawCandidate(commenter)', () => {
  it('mappa author.profile_url normalizzato + name + headline + sourceDetail', async () => {
    const { mapComment } = await import('../src/strategies/post-extract.js');
    const postUrl = 'https://www.linkedin.com/posts/guido-penta_x-activity-7472928569657225216';
    const c = mapComment(comments[0], postUrl);
    expect(c).not.toBeNull();
    expect(c!.linkedinUrl).toBe('https://www.linkedin.com/in/johnsmith');
    expect(c!.fullName).toBe('John Smith');
    expect(c!.headline).toBe('CTO @ Acme Tech | Scaling engineering teams');
    expect(c!.sourceDetail).toBe('commenter');
    expect(c!.sourcePostUrl).toBe(postUrl);
  });

  it('include i reply (comment_type=reply) come "chi risponde"', async () => {
    const { mapComment } = await import('../src/strategies/post-extract.js');
    const reply = comments.find((c) => c.comment_type === 'reply');
    const c = mapComment(reply);
    expect(c).not.toBeNull();
    expect(c!.linkedinUrl).toBe('https://www.linkedin.com/in/laura-bianchi-hr');
    expect(c!.sourceDetail).toBe('commenter');
  });

  it('senza postUrl usa post_input come sourcePostUrl di fallback', async () => {
    const { mapComment } = await import('../src/strategies/post-extract.js');
    const c = mapComment(comments[0]);
    expect(c!.sourcePostUrl).toBe('7472928569657225216');
  });

  it('scarta gli item senza profile_url (→ null)', async () => {
    const { mapComment } = await import('../src/strategies/post-extract.js');
    const noUrl = comments.find((c) => !c.author?.profile_url);
    expect(mapComment(noUrl)).toBeNull();
  });

  it('mapComments su lista vuota → [] (nessun throw)', async () => {
    const { mapComments } = await import('../src/strategies/post-extract.js');
    expect(mapComments([])).toEqual([]);
    // sull'intero fixture: 2 validi (comment + reply), 1 scartato.
    expect(mapComments(comments).length).toBe(2);
  });
});

describe('mapTaggedPerson (T5): persona taggata → RawCandidate(tagged-person)', () => {
  it('costruisce un URL membro dal profile_urn, preservando il case', async () => {
    const { extractPost, mapTaggedPerson } = await import('../src/strategies/post-extract.js');
    const victoria = extractPost(posts[0]).people.find((p) => p.name === 'Victoria')!;
    const c = mapTaggedPerson(victoria);
    expect(c).not.toBeNull();
    expect(c!.linkedinUrl).toBe(
      'https://www.linkedin.com/in/ACoAACB65IgB2pmc36MjOjPI6M9USQKtOi1lqtw',
    );
    expect(c!.fullName).toBe('Victoria');
    expect(c!.sourceDetail).toBe('tagged-person');
  });

  it('senza profile_urn → null (non fabbrica URL)', async () => {
    const { mapTaggedPerson } = await import('../src/strategies/post-extract.js');
    expect(mapTaggedPerson({ name: 'Senza URN', profileUrn: '' } as any)).toBeNull();
  });

  it('le aziende restano companyRef, mai candidati persona (extractPost le separa)', async () => {
    const { extractPost } = await import('../src/strategies/post-extract.js');
    const r = extractPost(posts[0]);
    // Welyk è in companies, non in people.
    expect(r.companies.some((c) => c.name === 'Welyk')).toBe(true);
    expect(r.people.some((p) => p.name === 'Welyk')).toBe(false);
  });
});
