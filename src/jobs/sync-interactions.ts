import { extractPost, mapComments } from '../acquisition/mappers/posts.js';
import { mapReactions } from '../acquisition/mappers/reactions.js';
import type { CommentCandidate, ReactionCandidate } from '../acquisition/types.js';
import { ACTORS, postCommentsInput, postReactionsInput, profilePostsApimaestroInput } from '../apify/actors.js';
import { runActor } from '../apify/client.js';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { countPosts, markPostSynced, recentPosts, upsertPost, type Post } from '../db/posts.js';
import { addSource, upsertProspect } from '../db/prospects.js';
import { getSettings } from '../db/settings.js';
import { field } from '../util/fields.js';
import type { JobHandler, JobPreview, JobResult } from './types.js';

/*
 * Job `sync_interactions` (PLAN crm-foundation T8, P1/P4/P6): i miei post → chi ha reagito e
 * commentato → prospect in Inbox (nessuna membership) con le `sources`. Puro rispetto all'I/O
 * esterno: gli actor passano dalle `Deps` (reali qui sotto, fake nei test e in T20).
 * Best-effort per post: un post che fallisce finisce in `post_errors` e non viene marcato,
 * il prossimo sync lo riprende. Fail-fast solo su configurazione (`config:`) e sulla lettura
 * dei post (`actor:`), prima di aver scritto qualunque interazione.
 */

const DAY_MS = 86_400_000;

/** Massimo di reazioni per pagina accettato da `apimaestro/linkedin-post-reactions` (`limit` 1-100). */
export const REACTIONS_PAGE_MAX = 100;

/** Massimo di commenti per run accettato dall'actor dei commenti (`limit` 1-100). */
const COMMENTS_LIMIT_MAX = 100;

/** Parametri salvati sul job (`POST /api/sync/interactions`). */
export interface SyncParams {
  /** Rilegge anche i post già sincronizzati (costa di nuovo). */
  force?: boolean;
  /** Aggiorna solo l'elenco dei post e i conteggi dichiarati, senza leggere le interazioni. */
  postsOnly?: boolean;
}

/** Limiti del sync (default da `src/config.ts`, sovrascrivibili dalle deps). */
export interface SyncConfig {
  postsPerSync: number;
  postRecencyDays: number;
  syncCooldownDays: number;
  reactionsPerPost: number;
  commentsPerPost: number;
}

/** Dipendenze iniettabili: gli item grezzi degli actor, l'orologio e i limiti. */
export interface Deps {
  /** Item di `apimaestro/linkedin-profile-posts` del profilo (al più `totalPosts`). */
  fetchPosts: (profileUrl: string, totalPosts?: number) => Promise<any[]>;
  /**
   * Una pagina di `apimaestro/linkedin-post-reactions` per un **batch** di post: fino a `limit`
   * item per post (default 100), con `_metadata.post_url` che dice a quale post appartengono.
   */
  fetchReactions: (postUrls: string[], page: number, limit?: number) => Promise<any[]>;
  /** Commenti di un post: `postRef` = id attività (o URL del post), al più `limit`. */
  fetchComments: (postRef: string, limit?: number) => Promise<any[]>;
  now?: () => Date;
  config?: Partial<SyncConfig>;
}

/** Esito del job: i conteggi del PLAN + extra (`posts_new`, `posts_skipped_old`, …) ed errori per post. */
export interface SyncResult extends JobResult {
  counts: SyncCounts;
  warnings: string[];
  /** Un elemento per post in errore (il messaggio è attribuito: `actor:<id>: …` / `process: …`). */
  errors: Array<{ post_url: string; error: string }>;
}

export interface SyncCounts {
  [key: string]: number;
  posts: number;
  posts_new: number;
  posts_synced: number;
  posts_skipped_fresh: number;
  posts_skipped_old: number;
  reposts_skipped: number;
  posts_capped: number;
  reactions: number;
  comments: number;
  prospects_new: number;
  prospects_seen: number;
  prospects_merged: number;
  skipped_no_url: number;
  post_errors: number;
}

export function syncConfig(overrides: Partial<SyncConfig> = {}): SyncConfig {
  return {
    postsPerSync: config.postsPerSync,
    postRecencyDays: config.postRecencyDays,
    syncCooldownDays: config.syncCooldownDays,
    reactionsPerPost: config.reactionsPerPost,
    commentsPerPost: config.commentsPerPost,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Regola di ri-sync (P6), condivisa con la preview
// ---------------------------------------------------------------------------

/**
 * `never_synced` e `stale` (sync più vecchio del cooldown, post entro la recency) si
 * sincronizzano; `forced` solo con `force`; `fresh` (entro il cooldown) e `old` (oltre la
 * recency o senza data leggibile: anti-spesa) si saltano.
 */
export type SyncDecision = 'never_synced' | 'stale' | 'forced' | 'fresh' | 'old';

export function syncDecision(
  post: Pick<Post, 'posted_at' | 'last_synced_at'>,
  opts: { force?: boolean; now: Date; config: SyncConfig },
): SyncDecision {
  if (!post.last_synced_at) return 'never_synced';
  if (opts.force) return 'forced';
  const now = opts.now.getTime();
  const synced = Date.parse(post.last_synced_at);
  if (Number.isFinite(synced) && now - synced <= opts.config.syncCooldownDays * DAY_MS) return 'fresh';
  const posted = post.posted_at ? Date.parse(post.posted_at) : Number.NaN;
  if (!Number.isFinite(posted) || now - posted > opts.config.postRecencyDays * DAY_MS) return 'old';
  return 'stale';
}

export function shouldSync(decision: SyncDecision): boolean {
  return decision === 'never_synced' || decision === 'stale' || decision === 'forced';
}

// ---------------------------------------------------------------------------
// Preview (P7): conteggi, stima e warning; i `blockers` li aggiunge la route
// ---------------------------------------------------------------------------

/**
 * Blocker di configurazione del kind: con uno di questi il job non parte (400 `blocked`). Li usano la
 * preview, l'avvio e "Riprova" (registry `CONFIG_BLOCKERS`, apollo-lookalike T6); non dipendono dai `params`.
 */
export function configBlockers(_params?: SyncParams): string[] {
  const blockers: string[] = [];
  if (!getSettings().own_profile_url) blockers.push('Salva prima il tuo profilo LinkedIn nelle Impostazioni.');
  if (!config.apifyToken.trim()) blockers.push('APIFY_TOKEN mancante nel .env — nessun job avviato.');
  return blockers;
}

function usd(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function formatNumber(value: number): string {
  return value.toLocaleString('it-IT', { maximumFractionDigits: 2 });
}

/**
 * Anteprima del sync sui post già noti: i più recenti `postsPerSync` passati per la regola P6.
 * Stima = lettura dei post + `min(dichiarate, cap)` reazioni e commenti per post da sincronizzare.
 * Al primo sync (nessun post noto) o con conteggi mancanti `est_cost_usd` è `null` (mai inventato).
 */
export function previewSync(
  params: SyncParams,
  opts: { now?: Date; config?: Partial<SyncConfig> } = {},
): Omit<JobPreview, 'blockers'> {
  const cfg = syncConfig(opts.config);
  const now = opts.now ?? new Date();
  const prices = config.prices;
  const commentsCap = Math.min(COMMENTS_LIMIT_MAX, cfg.commentsPerPost);
  const postsCost = (cfg.postsPerSync * prices.postsPer1000Usd) / 1000;
  const counts: Record<string, number> = {
    posts_per_sync: cfg.postsPerSync,
    posts_known: countPosts(),
    posts_to_sync: 0,
    posts_never_synced: 0,
    posts_resync: 0,
    posts_skipped_fresh: 0,
    posts_skipped_old: 0,
    reactions_per_post: cfg.reactionsPerPost,
    reactions_max: 0,
    comments_max: 0,
  };
  const warnings: string[] = [];

  if (params.postsOnly) return { counts, est_cost_usd: usd(postsCost), warnings };

  if (counts.posts_known === 0) {
    counts.posts_to_sync = cfg.postsPerSync;
    counts.reactions_max = cfg.postsPerSync * cfg.reactionsPerPost;
    counts.comments_max = cfg.postsPerSync * commentsCap;
    warnings.push(
      `Prima sincronizzazione: stima non disponibile. Limite massimo: ${cfg.postsPerSync} post × ${formatNumber(cfg.reactionsPerPost)} reazioni = ` +
        `${formatNumber(counts.reactions_max)} reazioni (≈ $${formatNumber((counts.reactions_max * prices.reactionsPer1000Usd) / 1000)}). ` +
        `In pratica costa quanto le interazioni reali dei tuoi post: "Aggiorna solo l'elenco dei post" (postsOnly) rende la stima reale.`,
    );
    return { counts, est_cost_usd: null, warnings };
  }

  let unknownCounts = 0;
  let capped = 0;
  for (const post of recentPosts(cfg.postsPerSync)) {
    const decision = syncDecision(post, { force: params.force, now, config: cfg });
    if (decision === 'fresh') counts.posts_skipped_fresh += 1;
    else if (decision === 'old') counts.posts_skipped_old += 1;
    else {
      counts.posts_to_sync += 1;
      if (decision === 'never_synced') counts.posts_never_synced += 1;
      else counts.posts_resync += 1;
      if (post.reactions_count === null || post.comments_count === null) unknownCounts += 1;
      if ((post.reactions_count ?? 0) > cfg.reactionsPerPost) capped += 1;
      counts.reactions_max += Math.min(post.reactions_count ?? cfg.reactionsPerPost, cfg.reactionsPerPost);
      counts.comments_max += Math.min(post.comments_count ?? commentsCap, commentsCap);
    }
  }

  if (capped > 0) {
    warnings.push(
      `${capped} post ${capped === 1 ? 'supera' : 'superano'} il limite di ${cfg.reactionsPerPost} reazioni per post: si leggono solo le prime ${cfg.reactionsPerPost}.`,
    );
  }
  if (counts.posts_to_sync === 0) {
    warnings.push("Tutti i post noti sono già sincronizzati: si leggeranno solo eventuali post nuovi. Usa 'Risincronizza tutto' per rileggerli.");
  }
  if (unknownCounts > 0) {
    warnings.push(
      `Stima non disponibile: ${unknownCounts} post senza conteggi dichiarati. "Aggiorna solo l'elenco dei post" (postsOnly) li aggiorna.`,
    );
    return { counts, est_cost_usd: null, warnings };
  }
  const estimate =
    postsCost + (counts.reactions_max * prices.reactionsPer1000Usd) / 1000 + (counts.comments_max * prices.commentsPer1000Usd) / 1000;
  return { counts, est_cost_usd: usd(estimate), warnings };
}

// ---------------------------------------------------------------------------
// Errori attribuiti
// ---------------------------------------------------------------------------

const ATTRIBUTED = /^(actor|config|process):/;

function messageOf(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).trim() || 'errore sconosciuto';
}

/** Errore di un actor: i messaggi già attribuiti restano, gli altri diventano `actor:<id>: …`. */
function actorMessage(actorId: string, err: unknown): string {
  const message = messageOf(err);
  return ATTRIBUTED.test(message) ? message : `actor:${actorId}: ${message}`;
}

// ---------------------------------------------------------------------------
// Job
// ---------------------------------------------------------------------------

/** Chiave del post per l'abbinamento degli item: l'id attività nell'URL (o l'id nudo). */
function activityKey(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (/^\d{10,}$/.test(value)) return value;
  return /(?:activity|ugcPost)[-:](\d{10,})/.exec(value)?.[1];
}

/** Post ripubblicati di altri: le reazioni non sono ai miei contenuti. */
function isRepost(item: any): boolean {
  const type = field(item, 'post_type', 'postType');
  return typeof type === 'string' && type.toLowerCase() === 'repost';
}

interface PostRun {
  post: Post;
  /** Item di reazione letti (scarti senza URL inclusi), entro il cap per post. */
  reactions: number;
  errors: string[];
}

interface Upserted {
  id: number;
  created: boolean;
  mergedIds: number[];
}

/**
 * Sync delle interazioni. Passi: post del profilo (fino a `postsPerSync`, upsert); con
 * `postsOnly` si ferma; selezione P6; reazioni in batch per pagina fino a `reactionsPerPost`
 * per post; commenti per post; per ogni candidato `upsertProspect(…, {linkByName})` +
 * `addSource` idempotente; marca i post letti, tranne i sospetti (reazioni dichiarate, 0 lette).
 */
export async function syncInteractions(params: SyncParams, deps: Deps): Promise<SyncResult> {
  const cfg = syncConfig(deps.config);
  const now = deps.now?.() ?? new Date();
  const counts: SyncCounts = {
    posts: 0,
    posts_new: 0,
    posts_synced: 0,
    posts_skipped_fresh: 0,
    posts_skipped_old: 0,
    reposts_skipped: 0,
    posts_capped: 0,
    reactions: 0,
    comments: 0,
    prospects_new: 0,
    prospects_seen: 0,
    prospects_merged: 0,
    skipped_no_url: 0,
    post_errors: 0,
  };

  const profileUrl = getSettings().own_profile_url;
  if (!profileUrl) throw new Error('config: Salva il tuo profilo LinkedIn nelle Impostazioni.');

  // 1. Post del profilo: se l'actor fallisce il job fallisce, senza aver scritto nulla.
  let items: any[];
  try {
    items = await deps.fetchPosts(profileUrl, cfg.postsPerSync);
  } catch (err) {
    const message = actorMessage(ACTORS.profilePostsApimaestro, err);
    const m = /^actor:(\S+?): ([\s\S]*)$/.exec(message);
    if (!m) throw new Error(message);
    throw new Error(`actor:${m[1]}: Impossibile leggere i post di ${profileUrl} (${m[2]}). Nessun dato modificato.`);
  }

  const posts = new Map<number, Post>();
  for (const item of Array.isArray(items) ? items : []) {
    if (posts.size >= cfg.postsPerSync) break;
    if (isRepost(item)) {
      counts.reposts_skipped += 1;
      continue;
    }
    const p = extractPost(item);
    const postUrl =
      typeof p.postUrl === 'string' && p.postUrl.trim() !== ''
        ? p.postUrl.trim()
        : p.activityId
          ? `https://www.linkedin.com/feed/update/urn:li:activity:${p.activityId}/`
          : undefined;
    if (!postUrl) continue;
    const { post, created } = upsertPost({
      postUrl,
      activityId: p.activityId,
      text: p.text,
      postedAt: p.postedAt,
      reactionsCount: p.reactionsCount,
      commentsCount: p.commentsCount,
    });
    if (created) counts.posts_new += 1;
    posts.set(post.id, post);
  }
  counts.posts = posts.size;

  if (params.postsOnly) {
    return {
      summary:
        `Elenco post aggiornato: ${counts.posts} post ${plural(counts.posts, 'letto', 'letti')} ` +
        `(${counts.posts_new} ${plural(counts.posts_new, 'nuovo', 'nuovi')}). ` +
        `Nessuna interazione letta: riapri "Sincronizza interazioni" per vedere la stima.`,
      counts,
      warnings: [],
      errors: [],
    };
  }

  // 2. Selezione dei post da sincronizzare (P6).
  const runs: PostRun[] = [];
  for (const post of posts.values()) {
    const decision = syncDecision(post, { force: params.force, now, config: cfg });
    if (shouldSync(decision)) runs.push({ post, reactions: 0, errors: [] });
    else if (decision === 'fresh') counts.posts_skipped_fresh += 1;
    else counts.posts_skipped_old += 1;
  }
  if (runs.length === 0) return nothingToSync(counts, profileUrl, cfg);

  // Prospect toccati in questo sync (distinti), per `prospects_new` / `prospects_seen`.
  const created = new Set<number>();
  const touched = new Set<number>();
  const apply = (events: Upserted[]): void => {
    for (const e of events) {
      for (const id of e.mergedIds) {
        created.delete(id);
        touched.delete(id);
      }
      counts.prospects_merged += e.mergedIds.length;
      if (e.created) created.add(e.id);
      touched.add(e.id);
    }
  };

  /** Salva i candidati di un post in una transazione: o tutti o nessuno (errore → post in errore). */
  const save = (post: Post, candidates: Array<ReactionCandidate | CommentCandidate>): Upserted[] =>
    db.transaction(() =>
      candidates.map((c) => {
        const up = upsertProspect(
          { linkedinUrl: c.linkedinUrl, memberUrn: c.memberUrn, fullName: c.fullName, headline: c.headline },
          { linkByName: true },
        );
        addSource(up.id, {
          kind: c.kind,
          postId: post.id,
          reactionType: c.kind === 'post_reaction' ? c.reactionType : null,
          commentText: c.kind === 'post_comment' ? c.commentText : null,
          raw: c.raw,
        });
        return up;
      }),
    )();

  // 3. Reazioni: una run per pagina su tutti i post ancora aperti; un post è esaurito quando
  // torna meno di `limit` item, chiuso quando raggiunge il cap.
  let reactionsSkipped = 0;
  if (cfg.reactionsPerPost > 0) {
    const limit = Math.min(REACTIONS_PAGE_MAX, cfg.reactionsPerPost);
    let open = runs;
    for (let page = 1; open.length > 0; page += 1) {
      let pageItems: any[];
      try {
        pageItems = await deps.fetchReactions(open.map((r) => r.post.post_url), page, limit);
      } catch (err) {
        const message = actorMessage(ACTORS.postReactions, err);
        for (const r of open) r.errors.push(message);
        break;
      }
      const byPost = groupByPost(Array.isArray(pageItems) ? pageItems : [], open);
      const next: PostRun[] = [];
      for (const r of open) {
        const postItems = byPost.get(r.post.id) ?? [];
        const taken = postItems.slice(0, Math.max(0, cfg.reactionsPerPost - r.reactions));
        const mapped = mapReactions(taken);
        try {
          apply(save(r.post, mapped.candidates));
        } catch (err) {
          r.errors.push(`process: ${messageOf(err)}`);
          continue;
        }
        r.reactions += taken.length;
        counts.reactions += taken.length;
        reactionsSkipped += mapped.skipped;
        if (postItems.length < limit) continue;
        if (r.reactions >= cfg.reactionsPerPost) counts.posts_capped += 1;
        else next.push(r);
      }
      open = next;
    }
  }
  counts.skipped_no_url += reactionsSkipped;

  // 4. Commenti, un post alla volta.
  const commentsCap = Math.min(COMMENTS_LIMIT_MAX, cfg.commentsPerPost);
  if (commentsCap > 0) {
    for (const r of runs) {
      let commentItems: any[];
      try {
        commentItems = await deps.fetchComments(r.post.activity_id ?? r.post.post_url, commentsCap);
      } catch (err) {
        r.errors.push(actorMessage(ACTORS.postComments, err));
        continue;
      }
      const taken = (Array.isArray(commentItems) ? commentItems : []).slice(0, commentsCap);
      const candidates = mapComments(taken, r.post.post_url);
      try {
        apply(save(r.post, candidates));
      } catch (err) {
        r.errors.push(`process: ${messageOf(err)}`);
        continue;
      }
      counts.comments += taken.length;
      counts.skipped_no_url += taken.length - candidates.length;
    }
  }

  // 5. Marcatura: solo i post letti senza errori e non sospetti.
  const suspicious = runs.filter(
    (r) => cfg.reactionsPerPost > 0 && r.errors.length === 0 && (r.post.reactions_count ?? 0) > 0 && r.reactions === 0,
  );
  const syncedAt = now.toISOString();
  for (const r of runs) {
    if (r.errors.length > 0 || suspicious.includes(r)) continue;
    markPostSynced(r.post.id, syncedAt);
    counts.posts_synced += 1;
  }
  counts.post_errors = runs.filter((r) => r.errors.length > 0).length;
  counts.prospects_new = created.size;
  counts.prospects_seen = [...touched].filter((id) => !created.has(id)).length;

  const warnings: string[] = [];
  if (suspicious.length > 0) {
    const declared = suspicious.reduce((sum, r) => sum + (r.post.reactions_count ?? 0), 0);
    const n = suspicious.length;
    warnings.push(
      `0 reazioni lette da ${n} post che ne ${n === 1 ? 'dichiara' : 'dichiarano'} ${declared}: probabile cambio dello schema ` +
        `dell'actor ${ACTORS.postReactions}. ${n === 1 ? 'Il post NON è stato marcato come sincronizzato' : `I ${n} post NON sono stati marcati come sincronizzati`}: ` +
        `il prossimo sync ${n === 1 ? 'lo riprende' : 'li riprende'}. Verifica l'actor prima di rilanciare.`,
    );
  }

  return {
    summary: summaryOf(counts, cfg, reactionsSkipped),
    counts,
    warnings,
    errors: runs.flatMap((r) => r.errors.map((error) => ({ post_url: r.post.post_url, error }))),
  };
}

/**
 * Raggruppa gli item di una pagina per post: URL echeggiato identico, poi id attività
 * nell'URL; con un solo post nel batch gli item senza URL riconoscibile sono suoi.
 */
function groupByPost(items: any[], open: PostRun[]): Map<number, any[]> {
  const byUrl = new Map(open.map((r) => [r.post.post_url, r.post.id]));
  const byActivity = new Map<string, number>();
  for (const r of open) {
    const key = r.post.activity_id ?? activityKey(r.post.post_url);
    if (key) byActivity.set(key, r.post.id);
  }
  const grouped = new Map<number, any[]>();
  for (const item of items) {
    const url = Object.keys(mapReactions([item]).itemsByPost)[0];
    const postId =
      (url !== undefined ? (byUrl.get(url) ?? byActivity.get(activityKey(url) ?? '')) : undefined) ??
      (open.length === 1 ? open[0].post.id : undefined);
    if (postId === undefined) continue;
    const list = grouped.get(postId) ?? [];
    list.push(item);
    grouped.set(postId, list);
  }
  return grouped;
}

/** Esito zero, tono neutro: nessun post letto o tutti già sincronizzati. */
function nothingToSync(counts: SyncCounts, profileUrl: string, cfg: SyncConfig): SyncResult {
  let summary: string;
  if (counts.posts === 0) {
    summary = `Nessun post trovato sul profilo ${profileUrl}.`;
  } else {
    const old = counts.posts_skipped_old > 0 ? ` (${counts.posts_skipped_old} oltre ${cfg.postRecencyDays} giorni)` : '';
    const which = counts.posts === 1 ? 'il post è già sincronizzato' : `i ${counts.posts} post sono già sincronizzati`;
    summary = `Nessun post da sincronizzare: ${which}${old}. Usa 'Risincronizza tutto' per rileggerli.`;
  }
  return { summary, counts, warnings: [], errors: [] };
}

/** Accordo di numero per i testi dei summary (`1 post sincronizzato`, `2 post sincronizzati`). */
function plural(n: number, singular: string, pluralForm: string): string {
  return n === 1 ? singular : pluralForm;
}

function summaryOf(counts: SyncCounts, cfg: SyncConfig, reactionsSkipped: number): string {
  const skipped = counts.posts_skipped_fresh + counts.posts_skipped_old;
  const read = counts.reactions + counts.comments;
  const parts = [
    `Sync completato: ${counts.posts_synced} post ${plural(counts.posts_synced, 'sincronizzato', 'sincronizzati')}` +
      (skipped > 0 ? ` (${skipped} già ${plural(skipped, 'fatto', 'fatti')})` : ''),
    `${counts.reactions} ${plural(counts.reactions, 'reazione', 'reazioni')} e ${counts.comments} ` +
      `${plural(counts.comments, 'commento', 'commenti')} ${plural(read, 'letto', 'letti')}`,
    `${counts.prospects_new} ${plural(counts.prospects_new, 'nuovo prospect', 'nuovi prospect')} in Inbox`,
  ];
  if (counts.prospects_seen > 0) {
    parts.push(`${counts.prospects_seen} già ${plural(counts.prospects_seen, 'presente', 'presenti')} (fonte aggiunta)`);
  }
  if (counts.skipped_no_url > 0) parts.push(`${counts.skipped_no_url} senza profilo pubblico (saltati)`);
  if (counts.prospects_merged > 0) {
    parts.push(`${counts.prospects_merged} ${plural(counts.prospects_merged, 'doppione unito', 'doppioni uniti')}`);
  }
  if (counts.posts_capped > 0) parts.push(`limite di ${cfg.reactionsPerPost} reazioni raggiunto su ${counts.posts_capped} post`);
  if (counts.post_errors > 0) parts.push(`${counts.post_errors} post in errore (vedi 'I miei post')`);
  let summary = `${parts.join(' · ')}.`;
  if (counts.reactions > 0 && reactionsSkipped / counts.reactions > 0.5) {
    summary += ' Molte reazioni senza profilo pubblico: valutare un actor alternativo.';
  }
  return summary;
}

/** Handler registrato in `HANDLERS.sync_interactions`: i `params` arrivano dalla riga `jobs`. */
export const handler: JobHandler<SyncParams | undefined, Deps> = (params, deps) =>
  syncInteractions({ force: params?.force === true, postsOnly: params?.postsOnly === true }, deps);

/** Item di una run Apify, con l'errore attribuito all'actor. */
async function actorItems(actorId: string, input: Record<string, unknown>): Promise<any[]> {
  try {
    return (await runActor(actorId, input)).items;
  } catch (err) {
    throw new Error(`actor:${actorId}: ${messageOf(err).replace(/^Actor "[^"]*" fallito: /, '')}`);
  }
}

/** Deps reali (Apify) usate fuori da `E2E_FAKE_JOBS`. Senza token: errore di configurazione. */
export function realDeps(): Deps {
  if (!config.apifyToken.trim()) throw new Error('config: APIFY_TOKEN mancante nel .env: nessun job avviato.');
  return {
    fetchPosts: (profileUrl, totalPosts = config.postsPerSync) =>
      actorItems(ACTORS.profilePostsApimaestro, profilePostsApimaestroInput(profileUrl, totalPosts)),
    fetchReactions: (postUrls, page, limit = REACTIONS_PAGE_MAX) =>
      actorItems(ACTORS.postReactions, postReactionsInput(postUrls, { pageNumber: page, limit })),
    fetchComments: (postRef, limit = config.commentsPerPost) =>
      actorItems(ACTORS.postComments, postCommentsInput([postRef], Math.min(COMMENTS_LIMIT_MAX, Math.max(1, limit)))),
  };
}
