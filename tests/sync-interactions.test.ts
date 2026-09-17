import { beforeEach, describe, expect, it } from 'vitest';

// Job "Sync interazioni" (crm-foundation T8): miei post → reazioni + commenti → Inbox.
// Import dinamici: la config (DB_PATH isolato da tests/setup.ts) è letta a import-time.
// Mai Apify reale: le deps sono fake in memoria che simulano la paginazione degli actor.
const { db } = await import('../src/db/index.js');
const { updateSettings } = await import('../src/db/settings.js');
const { syncInteractions } = await import('../src/jobs/sync-interactions.js');

const DAY = 86_400_000;
const NOW = new Date('2026-09-16T10:00:00.000Z');
const PROFILE = 'https://www.linkedin.com/in/omar-test';

/** Id membro fittizio valido (`ACoAA…`) per l'indice `i`. */
function memberId(i: number | string): string {
  return `ACoAAFakeReactor${String(i).padStart(6, '0')}Xy`;
}

function activityId(n: number): string {
  return `74000000000000000${n}`;
}

function postUrl(n: number): string {
  return `https://www.linkedin.com/posts/omar-test_post-${n}-activity-${activityId(n)}-AbCd`;
}

/** Item `apimaestro/linkedin-profile-posts`. */
function postItem(n: number, opts: { reactions?: number; comments?: number; daysAgo?: number; type?: string } = {}) {
  return {
    urn: { activity_urn: activityId(n) },
    url: postUrl(n),
    text: `Testo del post ${n}`,
    post_type: opts.type ?? 'regular',
    posted_at: { timestamp: NOW.getTime() - (opts.daysAgo ?? 3) * DAY },
    stats: { total_reactions: opts.reactions ?? 0, comments: opts.comments ?? 0 },
  };
}

interface Person {
  name: string;
  headline: string;
  profileUrl?: string;
  urn?: string;
}

/** Persona in forma id membro (come arrivano di solito le reazioni). */
function reactor(i: number): Person {
  return { name: `Reattore ${i}`, headline: `Ruolo ${i}`, urn: memberId(i), profileUrl: `https://www.linkedin.com/in/${memberId(i)}` };
}

/** Item `apimaestro/linkedin-post-reactions`. */
function reactionItem(post: string, p: Person, type = 'LIKE') {
  return {
    reaction_type: type,
    reactor: { urn: p.urn, name: p.name, headline: p.headline, profile_url: p.profileUrl },
    _metadata: { post_url: post, page_number: 1, reaction_type: 'ALL' },
  };
}

/** Item `apimaestro/linkedin-post-comments-…`. */
function commentItem(p: Person, text = 'Bel post!') {
  return { text, comment_type: 'comment', author: { name: p.name, headline: p.headline, profile_url: p.profileUrl } };
}

interface World {
  posts: any[];
  /** Reazioni per post URL, in ordine: l'actor fake le pagina. */
  reactions: Record<string, any[]>;
  /** Commenti per id attività. */
  comments: Record<string, any[]>;
}

function fakeDeps(world: World, now = NOW) {
  const calls = {
    posts: [] as Array<{ profileUrl: string; totalPosts?: number }>,
    reactions: [] as Array<{ postUrls: string[]; page: number; limit?: number }>,
    comments: [] as Array<{ postRef: string; limit?: number }>,
  };
  const deps = {
    fetchPosts: async (profileUrl: string, totalPosts?: number) => {
      calls.posts.push({ profileUrl, totalPosts });
      return world.posts;
    },
    fetchReactions: async (postUrls: string[], page: number, limit = 100) => {
      calls.reactions.push({ postUrls: [...postUrls], page, limit });
      return postUrls.flatMap((u) => (world.reactions[u] ?? []).slice((page - 1) * limit, page * limit));
    },
    fetchComments: async (postRef: string, limit?: number) => {
      calls.comments.push({ postRef, limit });
      return world.comments[postRef] ?? [];
    },
    now: () => now,
  };
  return { deps, calls };
}

function count(sql: string, ...params: unknown[]): number {
  return db.prepare(sql).pluck().get(...params) as number;
}

beforeEach(() => {
  db.exec('DELETE FROM prospects; DELETE FROM posts; DELETE FROM jobs; DELETE FROM settings;');
  updateSettings({ own_profile_url: PROFILE });
});

describe('syncInteractions (deps fake)', () => {
  it('reazioni in batch paginate 100+50, reattore anche commentatore → 1 prospect con 2 fonti; rilancio immediato non rilegge', async () => {
    const both: Person = { name: 'Anna Doppia', headline: 'CTO @ Doppio', profileUrl: 'https://www.linkedin.com/in/anna-doppia' };
    const onA = [reactionItem(postUrl(1), both), ...Array.from({ length: 149 }, (_, i) => reactionItem(postUrl(1), reactor(i + 1)))];
    const world: World = {
      posts: [postItem(1, { reactions: 150, comments: 2 }), postItem(2, { reactions: 0, comments: 1 })],
      reactions: { [postUrl(1)]: onA },
      comments: {
        [activityId(1)]: [commentItem(both), commentItem({ name: 'Carla Commenta', headline: 'CEO', profileUrl: 'https://www.linkedin.com/in/carla' })],
        [activityId(2)]: [commentItem({ name: 'Dario Commenta', headline: 'CFO', profileUrl: 'https://www.linkedin.com/in/dario' })],
      },
    };
    const { deps, calls } = fakeDeps(world);

    const result = await syncInteractions({}, deps);

    expect(calls.reactions.map((c) => [c.postUrls, c.page])).toEqual([
      [[postUrl(1), postUrl(2)], 1],
      [[postUrl(1)], 2],
    ]);
    expect(result.counts).toMatchObject({
      posts: 2,
      posts_synced: 2,
      posts_skipped_fresh: 0,
      reactions: 150,
      comments: 3,
      prospects_new: 152,
      prospects_seen: 0,
      skipped_no_url: 0,
      post_errors: 0,
    });
    expect(result.warnings).toEqual([]);
    expect(result.summary).toBe('Sync completato: 2 post sincronizzati · 150 reazioni e 3 commenti letti · 152 nuovi prospect in Inbox.');
    expect(count('SELECT COUNT(*) FROM prospects')).toBe(152);
    expect(count('SELECT COUNT(*) FROM sources')).toBe(153);
    const anna = db.prepare('SELECT id FROM prospects WHERE linkedin_url = ?').pluck().get(both.profileUrl) as number;
    expect(count('SELECT COUNT(*) FROM sources WHERE prospect_id = ?', anna)).toBe(2);
    expect(count('SELECT COUNT(*) FROM list_members')).toBe(0);
    const { listInbox } = await import('../src/db/prospects.js');
    expect(listInbox().total).toBe(152);

    const again = fakeDeps(world);
    const second = await syncInteractions({}, again.deps);
    expect(again.calls.reactions).toHaveLength(0);
    expect(again.calls.comments).toHaveLength(0);
    expect(second.counts).toMatchObject({ posts: 2, posts_synced: 0, posts_skipped_fresh: 2 });
    expect(second.summary).toBe("Nessun post da sincronizzare: i 2 post sono già sincronizzati. Usa 'Risincronizza tutto' per rileggerli.");
    expect(count('SELECT COUNT(*) FROM sources')).toBe(153);
  });
});

describe('identità: reazione in forma id membro + commento con lo slug (steering)', () => {
  const URN = memberId('marco');
  const asReactor: Person = { name: 'Marco Esempio', headline: 'CTO @ Nebulosa', urn: URN, profileUrl: `https://www.linkedin.com/in/${URN}` };
  const asCommenter: Person = { name: 'Marco Esempio', headline: 'CTO @ Nebulosa', profileUrl: 'https://www.linkedin.com/in/Marco-Esempio/' };
  const SLUG = 'https://www.linkedin.com/in/marco-esempio';

  function onlyProspect() {
    expect(count('SELECT COUNT(*) FROM prospects')).toBe(1);
    return db.prepare('SELECT id, linkedin_url, member_urn FROM prospects').get() as { id: number; linkedin_url: string; member_urn: string };
  }

  it('stesso sync: 1 prospect con linkedin_url = slug e member_urn, 2 fonti', async () => {
    const world: World = {
      posts: [postItem(1, { reactions: 1, comments: 1 })],
      reactions: { [postUrl(1)]: [reactionItem(postUrl(1), asReactor, 'PRAISE')] },
      comments: { [activityId(1)]: [commentItem(asCommenter, 'Concordo!')] },
    };
    const result = await syncInteractions({}, fakeDeps(world).deps);

    const p = onlyProspect();
    expect(p).toMatchObject({ linkedin_url: SLUG, member_urn: URN });
    const sources = db.prepare('SELECT kind, reaction_type, comment_text FROM sources WHERE prospect_id = ? ORDER BY kind').all(p.id);
    expect(sources).toEqual([
      { kind: 'post_comment', reaction_type: null, comment_text: 'Concordo!' },
      { kind: 'post_reaction', reaction_type: 'PRAISE', comment_text: null },
    ]);
    expect(result.counts).toMatchObject({ prospects_new: 1, prospects_seen: 0, reactions: 1, comments: 1 });
  });

  it('ordine inverso (prima il commento, poi la reazione in un sync successivo): stesso esito', async () => {
    const commentsOnly: World = {
      posts: [postItem(1, { reactions: 0, comments: 1 })],
      reactions: {},
      comments: { [activityId(1)]: [commentItem(asCommenter)] },
    };
    await syncInteractions({}, fakeDeps(commentsOnly).deps);
    expect(onlyProspect()).toMatchObject({ linkedin_url: SLUG, member_urn: null });

    const withReaction: World = { ...commentsOnly, posts: [postItem(1, { reactions: 1, comments: 1 })], reactions: { [postUrl(1)]: [reactionItem(postUrl(1), asReactor)] } };
    const result = await syncInteractions({ force: true }, fakeDeps(withReaction).deps);

    const p = onlyProspect();
    expect(p).toMatchObject({ linkedin_url: SLUG, member_urn: URN });
    expect(count('SELECT COUNT(*) FROM sources WHERE prospect_id = ?', p.id)).toBe(2);
    expect(result.counts).toMatchObject({ prospects_new: 0, prospects_seen: 1 });
  });

  it('duplicati già presenti rivelati dalle chiavi → uniti e contati in prospects_merged', async () => {
    const { upsertProspect } = await import('../src/db/prospects.js');
    // Due prospect nati separati (omonimia non verificabile: headline diversa).
    upsertProspect({ linkedinUrl: `https://www.linkedin.com/in/${URN}`, fullName: 'Marco Esempio', headline: 'vecchia headline' });
    upsertProspect({ linkedinUrl: SLUG, fullName: 'Marco Esempio' });
    expect(count('SELECT COUNT(*) FROM prospects')).toBe(2);

    // Il reattore espone slug e id membro insieme: le due righe sono la stessa persona.
    const both: Person = { name: 'Marco Esempio', headline: 'CTO @ Nebulosa', urn: URN, profileUrl: SLUG };
    const world: World = { posts: [postItem(1, { reactions: 1 })], reactions: { [postUrl(1)]: [reactionItem(postUrl(1), both)] }, comments: {} };
    const result = await syncInteractions({}, fakeDeps(world).deps);

    expect(onlyProspect()).toMatchObject({ linkedin_url: SLUG, member_urn: URN });
    expect(result.counts).toMatchObject({ prospects_merged: 1, prospects_new: 0, prospects_seen: 1 });
  });
});

describe('regola di ri-sync (P6)', () => {
  function world(): World {
    return {
      posts: [postItem(1, { reactions: 1, comments: 0, daysAgo: 3 }), postItem(2, { reactions: 1, comments: 0, daysAgo: 85 })],
      reactions: { [postUrl(1)]: [reactionItem(postUrl(1), reactor(1))], [postUrl(2)]: [reactionItem(postUrl(2), reactor(2))] },
      comments: {},
    };
  }

  it('entro il cooldown salta; con now +8 gg rilegge i post entro la recency; oltre la recency solo con force', async () => {
    await syncInteractions({}, fakeDeps(world()).deps);
    const syncedAt = db.prepare('SELECT post_url, last_synced_at FROM posts ORDER BY post_url').all();
    expect(syncedAt.every((p: any) => p.last_synced_at === NOW.toISOString())).toBe(true);

    const soon = fakeDeps(world(), new Date(NOW.getTime() + 6 * DAY));
    expect((await syncInteractions({}, soon.deps)).counts).toMatchObject({ posts_skipped_fresh: 2, posts_synced: 0 });
    expect(soon.calls.reactions).toHaveLength(0);

    // +8 gg: il post 1 ha 11 giorni (rilegge), il post 2 ne ha 93 (oltre i 90: mai senza force).
    const later = new Date(NOW.getTime() + 8 * DAY);
    const after = fakeDeps(world(), later);
    const result = await syncInteractions({}, after.deps);
    expect(after.calls.reactions.map((c) => c.postUrls)).toEqual([[postUrl(1)]]);
    expect(result.counts).toMatchObject({ posts_synced: 1, posts_skipped_old: 1, posts_skipped_fresh: 0, prospects_seen: 1, prospects_new: 0 });
    expect(db.prepare('SELECT last_synced_at FROM posts WHERE post_url = ?').pluck().get(postUrl(1))).toBe(later.toISOString());

    const forced = fakeDeps(world(), later);
    expect((await syncInteractions({ force: true }, forced.deps)).counts).toMatchObject({ posts_synced: 2 });
    expect(forced.calls.reactions[0].postUrls).toEqual([postUrl(1), postUrl(2)]);
    expect(count('SELECT COUNT(*) FROM sources')).toBe(2);
  });

  it('postsOnly: salva post e conteggi dichiarati senza leggere interazioni né marcare', async () => {
    const { deps, calls } = fakeDeps(world());
    const result = await syncInteractions({ postsOnly: true }, deps);
    expect(calls.reactions).toHaveLength(0);
    expect(calls.comments).toHaveLength(0);
    expect(result.counts).toMatchObject({ posts: 2, posts_new: 2, reactions: 0 });
    expect(db.prepare('SELECT reactions_count, last_synced_at FROM posts ORDER BY post_url').all()).toEqual([
      { reactions_count: 1, last_synced_at: null },
      { reactions_count: 1, last_synced_at: null },
    ]);
  });
});

describe('esito onesto: warning, errori per post, errori attribuiti', () => {
  it('post con reactions_count:30 e 0 reazioni lette → 1 warning e last_synced_at invariato', async () => {
    const world: World = {
      posts: [postItem(1, { reactions: 30, comments: 1 }), postItem(2, { reactions: 0, comments: 0 })],
      reactions: {},
      comments: { [activityId(1)]: [commentItem({ name: 'Carla', headline: 'CEO', profileUrl: 'https://www.linkedin.com/in/carla' })] },
    };
    const result = await syncInteractions({}, fakeDeps(world).deps);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/^0 reazioni lette da 1 post che ne dichiara 30: .*apimaestro\/linkedin-post-reactions/);
    expect(result.counts).toMatchObject({ posts_synced: 1, comments: 1, prospects_new: 1 });
    expect(db.prepare('SELECT last_synced_at FROM posts WHERE post_url = ?').pluck().get(postUrl(1))).toBeNull();
    expect(db.prepare('SELECT last_synced_at FROM posts WHERE post_url = ?').pluck().get(postUrl(2))).toBe(NOW.toISOString());

    // Il prossimo sync lo riprende.
    const again = fakeDeps(world);
    await syncInteractions({}, again.deps);
    expect(again.calls.reactions.map((c) => c.postUrls)).toEqual([[postUrl(1)]]);
  });

  it('un post fallisce sui commenti → gli altri salvati e marcati, lui in post_errors e non marcato', async () => {
    const world: World = {
      posts: [postItem(1, { reactions: 1, comments: 1 }), postItem(2, { reactions: 1, comments: 1 })],
      reactions: { [postUrl(1)]: [reactionItem(postUrl(1), reactor(1))], [postUrl(2)]: [reactionItem(postUrl(2), reactor(2))] },
      comments: { [activityId(1)]: [commentItem({ name: 'Carla', headline: 'CEO', profileUrl: 'https://www.linkedin.com/in/carla' })] },
    };
    const { deps } = fakeDeps(world);
    const result = await syncInteractions({}, {
      ...deps,
      fetchComments: async (ref: string) => {
        if (ref === activityId(2)) throw new Error('Actor "x" fallito: timeout');
        return deps.fetchComments(ref);
      },
    });

    expect(result.counts).toMatchObject({ post_errors: 1, posts_synced: 1, reactions: 2, comments: 1, prospects_new: 3 });
    expect(result.errors).toEqual([
      { post_url: postUrl(2), error: 'actor:apimaestro/linkedin-post-comments-replies-engagements-scraper-no-cookies: Actor "x" fallito: timeout' },
    ]);
    expect(result.summary).toContain("1 post in errore (vedi 'I miei post')");
    expect(db.prepare('SELECT last_synced_at FROM posts WHERE post_url = ?').pluck().get(postUrl(2))).toBeNull();
    expect(count('SELECT COUNT(*) FROM sources')).toBe(3);
  });

  it('pagina di reazioni in errore → tutti i post del batch in errore, commenti letti comunque, job non fallito', async () => {
    const world: World = {
      posts: [postItem(1, { reactions: 5, comments: 1 })],
      reactions: {},
      comments: { [activityId(1)]: [commentItem({ name: 'Carla', headline: 'CEO', profileUrl: 'https://www.linkedin.com/in/carla' })] },
    };
    const { deps } = fakeDeps(world);
    const result = await syncInteractions({}, {
      ...deps,
      fetchReactions: async () => {
        throw new Error('actor:apimaestro/linkedin-post-reactions: 502');
      },
    });
    expect(result.errors).toEqual([{ post_url: postUrl(1), error: 'actor:apimaestro/linkedin-post-reactions: 502' }]);
    expect(result.warnings).toEqual([]);
    expect(result.counts).toMatchObject({ post_errors: 1, posts_synced: 0, comments: 1 });
  });

  it('lettura dei post fallita → il job rigetta con `actor:<id>:` e nessun dato scritto; profilo mancante → `config:`', async () => {
    const failing = { ...fakeDeps({ posts: [], reactions: {}, comments: {} }).deps, fetchPosts: async () => { throw new Error('Actor "y" fallito: 403'); } };
    await expect(syncInteractions({}, failing)).rejects.toThrow(
      /^actor:apimaestro\/linkedin-profile-posts: Impossibile leggere i post di https:\/\/www\.linkedin\.com\/in\/omar-test \(Actor "y" fallito: 403\)\. Nessun dato modificato\.$/,
    );
    expect(count('SELECT COUNT(*) FROM posts')).toBe(0);

    updateSettings({ own_profile_url: null });
    const { deps, calls } = fakeDeps({ posts: [postItem(1)], reactions: {}, comments: {} });
    await expect(syncInteractions({}, deps)).rejects.toThrow(/^config: Salva il tuo profilo LinkedIn/);
    expect(calls.posts).toHaveLength(0);
  });

  it('cap per post, repost ignorati, reazioni senza URL contate in skipped_no_url', async () => {
    const anonymous = { reaction_type: 'LIKE', reactor: { name: 'LinkedIn Member', headline: '' }, _metadata: { post_url: postUrl(1) } };
    const many = [anonymous, ...Array.from({ length: 30 }, (_, i) => reactionItem(postUrl(1), reactor(i + 1)))];
    const world: World = {
      posts: [postItem(1, { reactions: 31 }), postItem(9, { reactions: 500, type: 'repost' })],
      reactions: { [postUrl(1)]: many, [postUrl(9)]: [reactionItem(postUrl(9), reactor(99))] },
      comments: {},
    };
    const { deps, calls } = fakeDeps(world);
    const result = await syncInteractions({}, { ...deps, config: { reactionsPerPost: 25 } });

    expect(calls.reactions).toEqual([{ postUrls: [postUrl(1)], page: 1, limit: 25 }]);
    expect(result.counts).toMatchObject({ posts: 1, reposts_skipped: 1, reactions: 25, skipped_no_url: 1, prospects_new: 24, posts_capped: 1, posts_synced: 1 });
    expect(result.summary).toContain('limite di 25 reazioni raggiunto su 1 post');
    expect(count('SELECT COUNT(*) FROM posts')).toBe(1);
  });
});

describe('handler', () => {
  it('via wrapper dei job (runJob): succeeded con result.summary; realDeps senza token → errore `config:`', async () => {
    const { runJob } = await import('../src/server/job-entry.js');
    const { insertJob } = await import('../src/db/jobs.js');
    const { realDeps } = await import('../src/jobs/sync-interactions.js');
    const { config } = await import('../src/config.js');
    const { deps } = fakeDeps({ posts: [postItem(1, { comments: 1 })], reactions: {}, comments: { [activityId(1)]: [commentItem(reactor(1))] } });

    const done = await runJob(insertJob('sync_interactions', { force: false }).id, { resolveDeps: () => deps });
    expect(done.state).toBe('succeeded');
    expect(done.result).toMatchObject({ counts: { posts_synced: 1, prospects_new: 1 }, warnings: [] });

    const token = config.apifyToken;
    config.apifyToken = '';
    try {
      expect(() => realDeps()).toThrow(/^config: APIFY_TOKEN mancante/);
      const failed = await runJob(insertJob('sync_interactions', {}).id, { resolveDeps: () => realDeps() });
      expect(failed.error).toMatch(/^config: APIFY_TOKEN mancante/);
    } finally {
      config.apifyToken = token;
    }
    expect(Object.keys(realDeps()).sort()).toEqual(['fetchComments', 'fetchPosts', 'fetchReactions']);
  });

  it('HANDLERS.sync_interactions usa i params salvati (force/postsOnly) e le deps passate', async () => {
    const { HANDLERS } = await import('../src/jobs/handlers.js');
    const { deps, calls } = fakeDeps({ posts: [postItem(1, { reactions: 1 })], reactions: {}, comments: {} });
    const result = await HANDLERS.sync_interactions({ postsOnly: true, __fixture: 'ignorato' }, deps);
    expect(result.summary).toMatch(/^Elenco post aggiornato: 1 post letto \(1 nuovo\)/);
    expect(calls.reactions).toHaveLength(0);
  });
});

describe('API sync', () => {
  async function api() {
    const { createApp } = await import('../src/server/app.js');
    const app = createApp({ jobs: { command: 'node', args: ['-e', 'setTimeout(() => {}, 300)'] } });
    const send = (method: string, path: string, body?: unknown) =>
      app.request(path, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      });
    return { send };
  }

  async function waitIdle() {
    const { getCurrentJob } = await import('../src/server/jobs.js');
    const deadline = Date.now() + 5000;
    while (getCurrentJob()?.state === 'running') {
      if (Date.now() > deadline) throw new Error('job ancora running');
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  it('preview senza profilo → blockers non vuoto; POST → 400 `blocked` con i blockers e nessun job', async () => {
    updateSettings({ own_profile_url: null });
    const { send } = await api();

    const res = await send('GET', '/api/sync/preview');
    expect(res.status).toBe(200);
    const preview = (await res.json()) as any;
    expect(Object.keys(preview).sort()).toEqual(['blockers', 'counts', 'est_cost_usd', 'warnings']);
    expect(preview.blockers).toEqual(['Salva prima il tuo profilo LinkedIn nelle Impostazioni.']);

    const post = await send('POST', '/api/sync/interactions', {});
    expect(post.status).toBe(400);
    expect(await post.json()).toMatchObject({ code: 'blocked', blockers: preview.blockers });
    expect(count('SELECT COUNT(*) FROM jobs')).toBe(0);
  });

  it('token Apify mancante → blocker in preview e 400 al POST', async () => {
    const { config } = await import('../src/config.js');
    const { send } = await api();
    const token = config.apifyToken;
    config.apifyToken = '';
    try {
      const preview = (await (await send('GET', '/api/sync/preview')).json()) as any;
      expect(preview.blockers).toEqual(['APIFY_TOKEN mancante nel .env — nessun job avviato.']);
      expect((await send('POST', '/api/sync/interactions', { force: true })).status).toBe(400);
    } finally {
      config.apifyToken = token;
    }
  });

  it('primo sync: est_cost_usd null con warning; con post noti stima dai conteggi (cap per post) e salta i freschi', async () => {
    const { send } = await api();
    const first = (await (await send('GET', '/api/sync/preview')).json()) as any;
    expect(first).toMatchObject({ est_cost_usd: null, blockers: [], counts: { posts_known: 0, posts_to_sync: 10, reactions_max: 3000 } });
    expect(first.warnings).toHaveLength(1);
    expect(first.warnings[0]).toMatch(/^Prima sincronizzazione: stima non disponibile/);

    const { upsertPost, markPostSynced } = await import('../src/db/posts.js');
    const at = (days: number) => new Date(Date.now() - days * DAY).toISOString();
    upsertPost({ postUrl: postUrl(1), postedAt: at(2), reactionsCount: 412, commentsCount: 37 });
    upsertPost({ postUrl: postUrl(2), postedAt: at(20), reactionsCount: 10, commentsCount: 3 });
    const { post: fresh } = upsertPost({ postUrl: postUrl(3), postedAt: at(5), reactionsCount: 50, commentsCount: 5 });
    markPostSynced(fresh.id, at(1));

    const preview = (await (await send('GET', '/api/sync/preview')).json()) as any;
    expect(preview.counts).toMatchObject({ posts_known: 3, posts_to_sync: 2, posts_skipped_fresh: 1, reactions_max: 310, comments_max: 40 });
    // 10 post letti + 310 reazioni + 40 commenti, $5/1000 ciascuno.
    expect(preview.est_cost_usd).toBeCloseTo(1.8, 6);
    expect(preview.warnings.some((w: string) => w.includes('limite di 300 reazioni'))).toBe(true);

    const forced = (await (await send('GET', '/api/sync/preview?force=1')).json()) as any;
    expect(forced.counts).toMatchObject({ posts_to_sync: 3, reactions_max: 360 });

    const postsOnly = (await (await send('GET', '/api/sync/preview?postsOnly=1')).json()) as any;
    expect(postsOnly).toMatchObject({ est_cost_usd: 0.05, counts: { posts_to_sync: 0, reactions_max: 0 } });
  });

  it('POST valido → 202 con job `sync_interactions` e params; body non valido → 400; job in corso → 409 in POST e blocker in preview', async () => {
    const { send } = await api();
    expect((await send('POST', '/api/sync/interactions', { force: 'si' })).status).toBe(400);
    expect((await send('POST', '/api/sync/interactions', { altro: 1 })).status).toBe(400);

    const res = await send('POST', '/api/sync/interactions', { postsOnly: true });
    expect(res.status).toBe(202);
    const { job } = (await res.json()) as any;
    expect(job).toMatchObject({ kind: 'sync_interactions', state: 'running', params: { force: false, postsOnly: true } });

    const busy = await send('POST', '/api/sync/interactions');
    expect(busy.status).toBe(409);
    expect(await busy.json()).toMatchObject({ code: 'job_running' });
    const preview = (await (await send('GET', '/api/sync/preview')).json()) as any;
    expect(preview.blockers).toHaveLength(1);
    expect(preview.blockers[0]).toMatch(/^C'è già un job in corso: Sync interazioni/);
    await waitIdle();
  });

  it('GET /api/posts → post con prospect generati e stato di sync; Inbox mostra i prospect del sync', async () => {
    const world: World = {
      posts: [postItem(1, { reactions: 2, comments: 1 }), postItem(2, { reactions: 1, comments: 0, daysAgo: 1 })],
      reactions: { [postUrl(1)]: [reactionItem(postUrl(1), reactor(1)), reactionItem(postUrl(1), reactor(2))] },
      comments: { [activityId(1)]: [commentItem({ ...reactor(1), profileUrl: `https://www.linkedin.com/in/${memberId(1)}` })] },
    };
    // Post 2: reazioni dichiarate ma 0 lette → resta "da sincronizzare".
    const result = await syncInteractions({}, { ...fakeDeps(world).deps, now: () => new Date() });
    const { insertJob, completeJob } = await import('../src/db/jobs.js');
    completeJob(insertJob('sync_interactions', {}).id, { state: 'succeeded', result });

    const { send } = await api();
    const res = await send('GET', '/api/posts');
    expect(res.status).toBe(200);
    const { items } = (await res.json()) as any;
    expect(items.map((p: any) => p.post_url)).toEqual([postUrl(2), postUrl(1)]);
    expect(items[1]).toMatchObject({ reactions_count: 2, comments_count: 1, reactions_read: 2, comments_read: 1, prospects_count: 2, sync_state: 'synced', sync_error: null });
    expect(items[0]).toMatchObject({ prospects_count: 0, sync_state: 'to_sync', last_synced_at: null });

    const inbox = (await (await send('GET', '/api/inbox')).json()) as any;
    expect(inbox.total).toBe(2);
  });
});

describe('API posts: stato errore', () => {
  it("post in errore nell'ultimo sync riuscito → sync_state 'error' con il messaggio; dopo un sync ok torna 'synced'", async () => {
    const { createApp } = await import('../src/server/app.js');
    const { insertJob, completeJob } = await import('../src/db/jobs.js');
    const app = createApp();
    const world: World = { posts: [postItem(1, { comments: 1 })], reactions: {}, comments: { [activityId(1)]: [commentItem(reactor(1))] } };
    const { deps } = fakeDeps(world);
    const run = async (d: typeof deps) => {
      const job = insertJob('sync_interactions', {});
      completeJob(job.id, { state: 'succeeded', result: await syncInteractions({}, { ...d, now: () => new Date() }) });
    };
    const firstPost = async () => ((await (await app.request('/api/posts')).json()) as any).items[0];

    await run({ ...deps, fetchComments: async () => { throw new Error('actor:apimaestro/x: 500'); } });
    expect(await firstPost()).toMatchObject({ sync_state: 'error', sync_error: 'actor:apimaestro/x: 500', last_synced_at: null });

    await new Promise((r) => setTimeout(r, 5));
    await run(deps);
    expect(await firstPost()).toMatchObject({ sync_state: 'synced', sync_error: null, comments_read: 1 });
  });
});
