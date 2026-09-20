import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { api, queryKeys } from '../../api/client';
import type { Job, Post, PostSyncState, Readiness } from '../../api/types';
import { SyncDialog } from '../SyncDialog';
import { Card, Loading, Spinner } from '../ui';
import { describeJobError, useCurrentJob } from '../../lib/jobs';
import { LoadError, Time, nf, td, th } from './parts';

/*
 * I miei post e "Sincronizza interazioni" (crm-foundation T14, FLOW B): la sezione "I miei post"
 * delle Impostazioni.
 */

const POST_STATE: Record<PostSyncState, { label: string; className: string }> = {
  synced: { label: 'Sincronizzato', className: 'bg-emerald-100 text-emerald-800' },
  to_sync: { label: 'Da sincronizzare', className: 'bg-sky-100 text-sky-800' },
  archived: { label: 'Archiviato', className: 'bg-slate-100 text-slate-600' },
  error: { label: 'Errore', className: 'bg-red-100 text-red-800' },
};

export function PostsCard({ readiness }: { readiness: Readiness }) {
  const [syncOpen, setSyncOpen] = useState(false);
  const hintId = useId();
  const posts = useQuery({ queryKey: queryKeys.posts, queryFn: api.sync.posts });
  const current = useCurrentJob();
  const job = current.data?.job ?? null;
  const syncJob = job?.state === 'running' && job.kind === 'sync_interactions' ? job : null;

  const items = posts.data?.items ?? [];
  const hasArchived = items.some((p) => p.sync_state === 'archived');

  return (
    <Card
      title="I miei post"
      actions={
        <div className="flex flex-col items-end gap-1">
          <Button
            type="button"
            onClick={() => setSyncOpen(true)}
            disabled={!readiness.profile}
            aria-describedby={readiness.profile ? undefined : hintId}
          >
            Sincronizza interazioni
          </Button>
          {!readiness.profile && (
            <p id={hintId} className="text-xs text-slate-500">
              Salva prima il tuo profilo LinkedIn.
            </p>
          )}
        </div>
      }
    >
      {syncJob && (
        <p role="status" className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2 text-sm text-slate-700">
          <Spinner className="size-3.5 border-slate-300 border-t-slate-600" />
          {syncJob.params.postsOnly
            ? "Aggiornamento dell'elenco dei post in corso: la tabella si aggiorna al termine."
            : 'Sync in corso: la tabella si aggiorna al termine.'}
        </p>
      )}

      {posts.isPending ? (
        <Loading label="Caricamento post…" />
      ) : posts.error ? (
        <LoadError error={posts.error} onRetry={() => void posts.refetch()} />
      ) : items.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-slate-500">
          {readiness.profile ? (
            <>
              <p className="font-medium text-slate-700">Nessun post ancora.</p>
              <p className="mt-1">
                Sincronizza per leggere i tuoi ultimi post e chi ha interagito. Al primo sync puoi anche aggiornare solo
                l'elenco dei post e vedere la stima reale prima di spendere.
              </p>
            </>
          ) : (
            <p>Salva il tuo profilo LinkedIn qui sopra: poi potrai sincronizzare i tuoi post.</p>
          )}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-slate-100">
                <tr>
                  <th scope="col" className={th}>
                    Data
                  </th>
                  <th scope="col" className={th}>
                    Post
                  </th>
                  <th scope="col" className={cn(th, 'text-right')}>
                    Reazioni
                  </th>
                  <th scope="col" className={cn(th, 'text-right')}>
                    Commenti
                  </th>
                  <th scope="col" className={cn(th, 'text-right')}>
                    Persone
                  </th>
                  <th scope="col" className={th}>
                    Ultimo sync
                  </th>
                  <th scope="col" className={th}>
                    Stato
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((post) => (
                  <PostRow key={post.id} post={post} syncJob={syncJob} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
            Reazioni e commenti: dichiarati dal post (sotto, quanti ne sono stati letti).
            {hasArchived &&
              " Archiviato = post più vecchio di POST_RECENCY_DAYS (default 90 giorni): si rilegge solo con 'Risincronizza tutto'."}
          </p>
        </>
      )}

      <SyncDialog open={syncOpen} onOpenChange={setSyncOpen} />
    </Card>
  );
}

function PostRow({ post, syncJob }: { post: Post; syncJob: Job | null }) {
  // Righe toccate dal sync in corso: quelle da sincronizzare (tutte con "Risincronizza tutto").
  const syncing =
    syncJob !== null &&
    !syncJob.params.postsOnly &&
    (syncJob.params.force === true || post.sync_state === 'to_sync' || post.sync_state === 'error');
  const state = POST_STATE[post.sync_state];
  const err = post.sync_error ? describeJobError(post.sync_error) : null;
  // Letti: anche su un post non marcato (errore o warning) se qualcosa è stato letto.
  const read = post.last_synced_at !== null || post.reactions_read + post.comments_read > 0;

  return (
    <tr>
      <td className={cn(td, 'whitespace-nowrap text-slate-600')}>{post.posted_at ? <Time iso={post.posted_at} /> : '—'}</td>
      <td className={cn(td, 'max-w-md')}>
        <a
          href={post.post_url}
          target="_blank"
          rel="noreferrer"
          className="line-clamp-2 text-slate-900 hover:underline"
          title={post.text_excerpt ?? undefined}
        >
          {post.text_excerpt || 'Post senza testo'}
        </a>
      </td>
      <td className={cn(td, 'text-right tabular-nums')}>
        {nf(post.reactions_count)}
        {read && <span className="block text-xs text-slate-500">{nf(post.reactions_read)} lette</span>}
      </td>
      <td className={cn(td, 'text-right tabular-nums')}>
        {nf(post.comments_count)}
        {read && <span className="block text-xs text-slate-500">{nf(post.comments_read)} letti</span>}
      </td>
      <td className={cn(td, 'text-right tabular-nums')}>{nf(post.prospects_count)}</td>
      <td className={cn(td, 'whitespace-nowrap text-slate-600')}>
        {post.last_synced_at ? <Time iso={post.last_synced_at} relative /> : 'mai'}
      </td>
      <td className={td}>
        {syncing ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
            <Spinner className="size-3 border-slate-300 border-t-slate-600" />
            sync in corso…
          </span>
        ) : (
          <>
            <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', state.className)}>
              {state.label}
            </span>
            {err && (
              <p className="mt-1 max-w-xs text-xs break-words text-red-800" title={post.sync_error ?? undefined}>
                {err.label && <span className="font-semibold">{err.label}: </span>}
                <span className="line-clamp-3">{err.message}</span>
                <span className="block text-slate-500">Il prossimo sync lo riprende.</span>
              </p>
            )}
          </>
        )}
      </td>
    </tr>
  );
}
