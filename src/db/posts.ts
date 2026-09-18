import { truncate } from '../util/fields.js';
import { db } from './index.js';

/*
 * Repo dei post del mio profilo (PLAN crm-foundation §6 `posts`, P6). Li scrive il job
 * "Sync interazioni" (`jobs/sync-interactions.ts`): identità = `post_url`, con `activity_id`
 * come ripiego (l'URL di un post può cambiare il suffisso di tracking tra due letture).
 * `last_synced_at` si aggiorna solo quando reazioni e commenti del post sono stati letti davvero.
 */

export interface Post {
  id: number;
  post_url: string;
  activity_id: string | null;
  text_excerpt: string | null;
  posted_at: string | null;
  reactions_count: number | null;
  comments_count: number | null;
  last_synced_at: string | null;
}

export interface PostInput {
  postUrl: string;
  activityId?: string | null;
  /** Testo integrale: si salva troncato a `EXCERPT_MAX`. */
  text?: string | null;
  /** Data di pubblicazione: si salva in ISO se leggibile, altrimenti si ignora. */
  postedAt?: string | null;
  reactionsCount?: number | null;
  commentsCount?: number | null;
}

/** Lunghezza massima dell'estratto salvato. */
export const EXCERPT_MAX = 300;

function isoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function countOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;
}

export function getPost(id: number): Post | undefined {
  return db.prepare('SELECT * FROM posts WHERE id = ?').get(id) as Post | undefined;
}

/**
 * Crea o aggiorna un post letto dall'actor: cerca per `post_url`, poi per `activity_id`.
 * Testo, data e conteggi dichiarati si aggiornano con i valori nuovi quando presenti (i
 * conteggi cambiano nel tempo); `last_synced_at` non si tocca mai qui.
 */
export function upsertPost(input: PostInput): { post: Post; created: boolean } {
  const activityId = input.activityId?.trim() || null;
  const excerpt = typeof input.text === 'string' && input.text.trim() !== '' ? truncate(input.text.trim(), EXCERPT_MAX) : null;
  const values = [excerpt, isoOrNull(input.postedAt), countOrNull(input.reactionsCount), countOrNull(input.commentsCount)];
  return db.transaction(() => {
    const existing =
      (db.prepare('SELECT id FROM posts WHERE post_url = ?').pluck().get(input.postUrl) as number | undefined) ??
      (activityId
        ? (db.prepare('SELECT id FROM posts WHERE activity_id = ? ORDER BY id LIMIT 1').pluck().get(activityId) as
            | number
            | undefined)
        : undefined);
    if (existing === undefined) {
      const info = db
        .prepare(
          `INSERT INTO posts (post_url, activity_id, text_excerpt, posted_at, reactions_count, comments_count)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(input.postUrl, activityId, ...values);
      return { post: getPost(Number(info.lastInsertRowid))!, created: true };
    }
    // L'URL resta quello già salvato se il nuovo è preso da un altro post (vincolo UNIQUE).
    db.prepare(
      `UPDATE posts SET
         post_url = CASE WHEN EXISTS (SELECT 1 FROM posts WHERE post_url = ? AND id <> ?) THEN post_url ELSE ? END,
         activity_id = COALESCE(?, activity_id),
         text_excerpt = COALESCE(?, text_excerpt),
         posted_at = COALESCE(?, posted_at),
         reactions_count = COALESCE(?, reactions_count),
         comments_count = COALESCE(?, comments_count)
       WHERE id = ?`,
    ).run(input.postUrl, existing, input.postUrl, activityId, ...values, existing);
    return { post: getPost(existing)!, created: false };
  })();
}

/** Marca il post come sincronizzato all'istante `at` (ISO). */
export function markPostSynced(id: number, at: string): void {
  db.prepare('UPDATE posts SET last_synced_at = ? WHERE id = ?').run(at, id);
}

export function countPosts(): number {
  return db.prepare('SELECT COUNT(*) FROM posts').pluck().get() as number;
}

/** I post più recenti per data di pubblicazione (senza data in fondo): base della preview del sync. */
export function recentPosts(limit: number): Post[] {
  return db
    .prepare('SELECT * FROM posts ORDER BY posted_at IS NULL, posted_at DESC, id DESC LIMIT ?')
    .all(Math.max(0, Math.trunc(limit))) as Post[];
}

/** Riga di `GET /api/posts`: il post + quanto ha generato (fonti lette, prospect distinti). */
export interface PostWithStats extends Post {
  reactions_read: number;
  comments_read: number;
  prospects_count: number;
}

/** Tutti i post salvati, dal più recente (senza data in fondo). */
export function listPostsWithStats(): PostWithStats[] {
  return db
    .prepare(
      `SELECT p.*,
         (SELECT COUNT(*) FROM sources s WHERE s.post_id = p.id AND s.kind = 'post_reaction') AS reactions_read,
         (SELECT COUNT(*) FROM sources s WHERE s.post_id = p.id AND s.kind = 'post_comment') AS comments_read,
         (SELECT COUNT(DISTINCT s.prospect_id) FROM sources s WHERE s.post_id = p.id) AS prospects_count
       FROM posts p
       ORDER BY p.posted_at IS NULL, p.posted_at DESC, p.id DESC`,
    )
    .all() as PostWithStats[];
}
