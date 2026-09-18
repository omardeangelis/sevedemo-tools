import { Hono } from 'hono';
import { z } from 'zod';
import { listPostsWithStats } from '../../db/posts.js';
import { configBlockers, previewSync, syncConfig, syncDecision, type SyncParams } from '../../jobs/sync-interactions.js';
import type { JobPreview } from '../../jobs/types.js';
import { readJson } from '../http.js';
import { launchUnlessBlocked, listJobs, withRunningBlocker } from '../jobs.js';
import type { AppEnv } from '../types.js';

/**
 * Sync interazioni (preview, avvio, i miei post) — crm-foundation T8.
 * Montato da `app.ts` con `app.route('/api', syncRoutes)`: dichiara le path assolute
 * sotto `/api` (es. `/sync/preview` → `/api/sync/preview`).
 */
export const syncRoutes = new Hono<AppEnv>();

function flag(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

syncRoutes.get('/sync/preview', (c) => {
  const params: SyncParams = { force: flag(c.req.query('force')), postsOnly: flag(c.req.query('postsOnly')) };
  const preview: JobPreview = { ...previewSync(params), blockers: configBlockers(params) };
  return c.json(withRunningBlocker(preview));
});

/** `__fixture` pilota le deps fake del server e2e (T20); le deps reali lo ignorano. */
const SyncBody = z
  .object({ force: z.boolean().optional(), postsOnly: z.boolean().optional(), __fixture: z.string().optional() })
  .strict();

syncRoutes.post('/sync/interactions', async (c) => {
  // Body facoltativo: un POST senza body vale `{}`.
  const hasBody = (await c.req.raw.clone().text()).trim() !== '';
  const body = hasBody ? await readJson(c, SyncBody) : {};
  const params: Record<string, unknown> = { force: body.force === true, postsOnly: body.postsOnly === true };
  if (body.__fixture !== undefined) params.__fixture = body.__fixture;
  // Job già in corso → 409 `job_running` da `launchJob`.
  return launchUnlessBlocked(c, 'sync_interactions', params, configBlockers(), 'Sync non avviato');
});

/**
 * Stato di sync di un post per la tabella "I miei post": `error` se l'ultimo sync riuscito
 * l'ha lasciato in errore (e non è stato risincronizzato dopo), altrimenti la regola P6.
 */
type PostSyncState = 'synced' | 'to_sync' | 'archived' | 'error';

syncRoutes.get('/posts', (c) => {
  const now = new Date();
  const cfg = syncConfig();
  const lastSync = listJobs(100).find((j) => j.kind === 'sync_interactions' && j.state === 'succeeded');
  const errors = new Map<string, string>();
  const reported = (lastSync?.result as { errors?: Array<{ post_url?: unknown; error?: unknown }> } | null)?.errors;
  for (const e of Array.isArray(reported) ? reported : []) {
    if (typeof e?.post_url === 'string' && typeof e.error === 'string' && !errors.has(e.post_url)) errors.set(e.post_url, e.error);
  }

  const items = listPostsWithStats().map((post) => {
    const error = errors.get(post.post_url);
    const stillFailing = error !== undefined && (!post.last_synced_at || post.last_synced_at < (lastSync?.started_at ?? ''));
    const decision = syncDecision(post, { now, config: cfg });
    const sync_state: PostSyncState = stillFailing
      ? 'error'
      : decision === 'fresh'
        ? 'synced'
        : decision === 'old'
          ? 'archived'
          : 'to_sync';
    return { ...post, sync_state, sync_error: stillFailing ? error : null };
  });
  return c.json({ items });
});
