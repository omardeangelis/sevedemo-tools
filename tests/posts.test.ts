import fs from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';

// Post con testo integrale (own-profile-services T5, C6–C9, C15). Import dinamici: la config (DB_PATH
// isolato) è letta a import-time.
const { db } = await import('../src/db/index.js');
const { upsertPost, EXCERPT_MAX } = await import('../src/db/posts.js');
const { upsertProspect, addSource } = await import('../src/db/prospects.js');
const { createIcp, getIcpContext } = await import('../src/db/icps.js');
const { analysisContext, analysisInput } = await import('../src/analysis/analyze.js');
const { createApp } = await import('../src/server/app.js');

/** Post salvati dal vero `upsertPost` di people-first-crm: il testo passato e l'estratto troncato. */
const LEGACY = (
  JSON.parse(fs.readFileSync(new URL('./fixtures/posts-people-first-crm.json', import.meta.url), 'utf8')) as {
    posts: Array<{ key: string; text: string; text_excerpt: string }>;
  }
).posts;
const LONG = LEGACY.find((p) => p.key === 'lungo_500')!;

const app = createApp();
const getJson = async (path: string) => (await (await app.request(path)).json()) as any;

beforeEach(() => {
  db.exec('DELETE FROM prospects; DELETE FROM posts; DELETE FROM icps;');
});

let seq = 0;
const url = () => `https://www.linkedin.com/posts/omar-intero-${++seq}`;

describe('post con testo integrale (C7) e marcatore (C6)', () => {
  it('un post di 500 caratteri sincronizzato si salva intero con text_complete = 1; uno senza testo resta 1', () => {
    const { post } = upsertPost({ postUrl: url(), text: LONG.text });
    expect(post.text_excerpt).toBe(LONG.text.trim());
    expect(post.text_excerpt!.length).toBeGreaterThan(EXCERPT_MAX + 1);
    expect(post.text_complete).toBe(1);
    expect(upsertPost({ postUrl: url() }).post).toMatchObject({ text_excerpt: null, text_complete: 1 });
  });

  it('un post salvato troncato prima del rilascio resta com\'è (C9); il sync successivo lo porta intero e a 1', () => {
    const postUrl = url();
    // Come dopo la migrazione (schema.test.ts la prova): l'estratto vero di `upsertPost` marcato troncato.
    db.prepare('INSERT INTO posts (post_url, text_excerpt, text_complete) VALUES (?, ?, 0)').run(postUrl, LONG.text_excerpt);
    expect(db.prepare('SELECT text_excerpt, text_complete FROM posts WHERE post_url = ?').get(postUrl)).toEqual({
      text_excerpt: LONG.text_excerpt,
      text_complete: 0,
    });
    // Un sync che non porta il testo non cambia né il testo né il marcatore.
    upsertPost({ postUrl, reactionsCount: 12 });
    expect(db.prepare('SELECT text_complete FROM posts WHERE post_url = ?').pluck().get(postUrl)).toBe(0);
    const { post } = upsertPost({ postUrl, text: LONG.text });
    expect(post).toMatchObject({ text_excerpt: LONG.text.trim(), text_complete: 1, reactions_count: 12 });
  });
});

describe('C15: nessuna vista mostra il testo intero dove oggi mostra un estratto', () => {
  /** Un post integrale di 500 caratteri e due persone con una fonte su quel post (una senza LinkedIn, da unire). */
  function seed() {
    const { post } = upsertPost({ postUrl: url(), text: LONG.text });
    const anna = upsertProspect({ linkedinUrl: 'https://www.linkedin.com/in/anna-post', fullName: 'Anna', about: 'CTO' }).id;
    addSource(anna, { kind: 'post_comment', postId: post.id, commentText: 'Ottimo spunto' });
    const other = Number(db.prepare(`INSERT INTO prospects (full_name, email) VALUES ('Anna (email)', 'anna@esempio.it')`).run().lastInsertRowid);
    addSource(other, { kind: 'post_reaction', postId: post.id, reactionType: 'LIKE' });
    return { post, anna, other };
  }

  it('I miei post (corpo e testo al passaggio del mouse): GET /api/posts restituisce l\'estratto di prima, non il testo intero', async () => {
    const { post } = seed();
    const item = (await getJson('/api/posts')).items.find((p: any) => p.id === post.id);
    expect(item.text_excerpt).toBe(LONG.text_excerpt);
    expect(item.text_excerpt.length).toBeLessThanOrEqual(EXCERPT_MAX + 1);
    expect(item.text_complete).toBe(1);
  });

  it('scheda della persona (testo al passaggio del mouse) e riga di Persone: estratto di prima, 120 nella riga', async () => {
    const { anna } = seed();
    // La scheda rende l'estratto nel `title` del riferimento al post: resta quello di prima del rilascio.
    const detail = await getJson(`/api/prospects/${anna}`);
    expect(detail.sources[0].post_excerpt).toBe(LONG.text_excerpt);
    const row = (await getJson('/api/prospects?pageSize=100')).items.find((r: any) => r.id === anna);
    expect(row.sources[0].post_excerpt.length).toBeLessThanOrEqual(121);
  });

  it('anteprima di unione: l\'etichetta di ciò che confluisce cita il post in 30 caratteri', async () => {
    const { anna, other } = seed();
    const preview = await getJson(`/api/prospects/${anna}/merge-preview?otherId=${other}`);
    const label = preview.moving_labels.sources.join(' ');
    expect(label).toMatch(/'[^']{1,31}'/);
    expect(label.length).toBeLessThan(80);
  });

  it('l\'analisi non cambia: input intero e impronta della persona identici con il post intero o troncato (C7, F6)', () => {
    const { post, anna } = seed();
    const icp = createIcp({ name: 'CTO' });
    const hashes = () => {
      const { inputHash, subjectHash } = analysisInput(analysisContext(anna, getIcpContext(icp.id)!)!);
      return { inputHash, subjectHash };
    };
    const whole = hashes();
    db.prepare('UPDATE posts SET text_excerpt = ?, text_complete = 0 WHERE id = ?').run(LONG.text_excerpt, post.id);
    expect(hashes()).toEqual(whole);
  });
});
