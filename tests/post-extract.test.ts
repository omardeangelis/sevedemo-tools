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

describe('extractPost: post item → activityId/postUrl/testo/conteggi/aziende', () => {
  it('estrae activityId, postUrl e le aziende taggate top-level', async () => {
    const { extractPost } = await import('../src/acquisition/mappers/posts.js');
    const r = extractPost(posts[0]);

    expect(r.activityId).toBe('7472928569657225216');
    expect(r.postUrl).toBe(posts[0].url);
    expect(r.companies).toEqual([{ name: 'Welyk', companyUrn: '105729725' }]);
  });

  it('estrae testo, data di pubblicazione (ISO) e conteggi dichiarati per la tabella posts', async () => {
    const { extractPost } = await import('../src/acquisition/mappers/posts.js');
    const r = extractPost(posts[0]);
    expect(r.text).toBe(posts[0].text);
    expect(r.postedAt).toBe(new Date(1781685011305).toISOString());
    expect(r.reactionsCount).toBe(31);
    expect(r.commentsCount).toBe(2);
    // conteggi a zero restano 0, non undefined
    expect(extractPost(posts[2]).commentsCount).toBe(0);
  });

  it('D9: ignora le text_annotations del reshared_post (solo top-level)', async () => {
    const { extractPost } = await import('../src/acquisition/mappers/posts.js');
    // posts[2] è il quote con reshared_post che taggava persone e aziende:
    // SOLO la company Talentware top-level deve emergere.
    const r = extractPost(posts[2]);
    expect(r.activityId).toBe('7472580694498500608');
    expect(r.companies).toEqual([{ name: 'Talentware', companyUrn: '76489042' }]);
  });

  it('estrae activityId da full_urn se urn.activity_urn manca; campi assenti → undefined', async () => {
    const { extractPost } = await import('../src/acquisition/mappers/posts.js');
    const r = extractPost({ full_urn: 'urn:li:activity:999', url: 'https://x', text_annotations: [] });
    expect(r.activityId).toBe('999');
    expect(r.postedAt).toBeUndefined();
    expect(r.reactionsCount).toBeUndefined();
  });
});

describe('mapComment: commento → candidato post_comment', () => {
  it('mappa author.profile_url normalizzato + name + headline + testo del commento', async () => {
    const { mapComment } = await import('../src/acquisition/mappers/posts.js');
    const postUrl = 'https://www.linkedin.com/posts/guido-penta_x-activity-7472928569657225216';
    const c = mapComment(comments[0], postUrl);
    expect(c).not.toBeNull();
    expect(c!.kind).toBe('post_comment');
    expect(c!.linkedinUrl).toBe('https://www.linkedin.com/in/johnsmith');
    expect(c!.fullName).toBe('John Smith');
    expect(c!.headline).toBe('CTO @ Acme Tech | Scaling engineering teams');
    expect(c!.commentText).toBe(comments[0].text);
    expect(c!.postUrl).toBe(postUrl);
  });

  it("id membro dell'autore: assente nel layout documentato, letto da author.urn o dalla query miniProfileUrn", async () => {
    const { mapComment } = await import('../src/acquisition/mappers/posts.js');
    expect(mapComment(comments[0])!.memberUrn).toBeUndefined();
    const urn = 'ACoAACB65IgB2pmc36MjOjPI6M9USQKtOi1lqtw';
    const withUrn = mapComment({ author: { name: 'V', profile_url: 'https://www.linkedin.com/in/victoria-demo', urn } });
    expect(withUrn).toMatchObject({ linkedinUrl: 'https://www.linkedin.com/in/victoria-demo', memberUrn: urn });
    const withQuery = mapComment({
      author: { profile_url: `https://www.linkedin.com/in/Victoria-Demo?miniProfileUrn=urn%3Ali%3Afsd_profile%3A${urn}` },
    });
    expect(withQuery).toMatchObject({ linkedinUrl: 'https://www.linkedin.com/in/victoria-demo', memberUrn: urn });
  });

  it('include i reply (comment_type=reply) come "chi risponde"', async () => {
    const { mapComment } = await import('../src/acquisition/mappers/posts.js');
    const reply = comments.find((c) => c.comment_type === 'reply');
    const c = mapComment(reply);
    expect(c).not.toBeNull();
    expect(c!.linkedinUrl).toBe('https://www.linkedin.com/in/laura-bianchi-hr');
    expect(c!.kind).toBe('post_comment');
  });

  it('senza postUrl usa post_input come postUrl di fallback', async () => {
    const { mapComment } = await import('../src/acquisition/mappers/posts.js');
    const c = mapComment(comments[0]);
    expect(c!.postUrl).toBe('7472928569657225216');
  });

  it('scarta gli item senza profile_url (→ null)', async () => {
    const { mapComment } = await import('../src/acquisition/mappers/posts.js');
    const noUrl = comments.find((c) => !c.author?.profile_url);
    expect(mapComment(noUrl)).toBeNull();
  });

  it('mapComments su lista vuota → [] (nessun throw)', async () => {
    const { mapComments } = await import('../src/acquisition/mappers/posts.js');
    expect(mapComments([])).toEqual([]);
    // sull'intero fixture: 2 validi (comment + reply), 1 scartato.
    expect(mapComments(comments).length).toBe(2);
  });
});
