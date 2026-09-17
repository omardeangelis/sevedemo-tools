import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { api, queryKeys } from '../api/client';
import type { Job, JobPreview } from '../api/types';
import { formatCost, useJobPreview, useJobStart } from '../lib/jobs';
import { JobPreviewDialog } from './JobPreviewDialog';

export interface SyncDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Chiamata dopo l'avvio (il dialog si chiude da solo; l'esito arriva dal JobBanner). */
  onStarted?: (job: Job) => void;
}

/** "https://www.linkedin.com/in/omar-test/" → "linkedin.com/in/omar-test". */
export function shortProfileUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
}

const n = (value: number | undefined) => (value ?? 0).toLocaleString('it-IT');

/**
 * Dialog "Sincronizza interazioni" (FLOW B): `JobPreviewDialog` alimentato da `GET /api/sync/preview`
 * con l'opzione "Risincronizza tutto" (`force`) e, quando la stima non è disponibile (primo sync),
 * l'azione economica "Aggiorna solo l'elenco dei post" (`postsOnly`). Unico componente usato da
 * onboarding, Impostazioni (T14) e Inbox vuota (T15): il trigger lo rende la pagina.
 *
 * @example
 * const [open, setOpen] = useState(false);
 * <Button onClick={() => setOpen(true)} disabled={!readiness.profile}>Sincronizza interazioni</Button>
 * <SyncDialog open={open} onOpenChange={setOpen} />
 */
export function SyncDialog({ open, onOpenChange, onStarted }: SyncDialogProps) {
  const [force, setForce] = useState(false);
  const settings = useQuery({ queryKey: queryKeys.settings, queryFn: api.settings.get, enabled: open });
  const preview = useJobPreview('sync_interactions', { force }, { enabled: open });
  const firstSync = preview.data !== undefined && preview.data.est_cost_usd === null;
  const postsOnlyPreview = useJobPreview('sync_interactions', { postsOnly: true }, { enabled: open && firstSync });

  const close = (job: Job) => {
    onOpenChange(false);
    setForce(false);
    onStarted?.(job);
  };
  const start = useJobStart((vars: { force?: boolean; postsOnly?: boolean }) => api.sync.start(vars), { onStarted: close });

  const blocked = (preview.data?.blockers.length ?? 0) > 0;
  const profileUrl = settings.data?.own_profile_url;

  return (
    <JobPreviewDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Sincronizza interazioni"
      description="Legge reazioni e commenti ai tuoi post e porta le persone nell'Inbox."
      preview={preview}
      summary={(data) => <SyncSummary data={data} profileUrl={profileUrl ?? null} />}
      startLabel="Avvia sync"
      starting={start.isPending && !start.variables?.postsOnly}
      onStart={() => start.mutate({ force })}
      secondaryActions={
        firstSync && (
          <Button
            type="button"
            variant="outline"
            disabled={blocked || start.isPending}
            aria-busy={start.isPending && start.variables?.postsOnly === true}
            onClick={() => start.mutate({ postsOnly: true })}
          >
            Aggiorna solo l'elenco dei post
            {postsOnlyPreview.data && ` (${formatCost(postsOnlyPreview.data.est_cost_usd)})`}
          </Button>
        )
      }
    >
      <label className="flex items-start gap-2 text-sm">
        <Checkbox checked={force} onCheckedChange={(v) => setForce(v === true)} className="mt-0.5" />
        <span>
          <span className="font-medium text-slate-900">Risincronizza tutto</span>
          <span className="block text-slate-500">Rilegge anche i post già sincronizzati: costa di nuovo.</span>
        </span>
      </label>
    </JobPreviewDialog>
  );
}

function SyncSummary({ data, profileUrl }: { data: JobPreview; profileUrl: string | null }) {
  const c = data.counts;
  const known = (c.posts_known ?? 0) > 0;
  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
      <p>
        <span className="font-medium">Profilo:</span>{' '}
        {profileUrl ? shortProfileUrl(profileUrl) : <span className="text-slate-500">non salvato</span>}
      </p>
      <p>
        <span className="font-medium">Post:</span> verranno letti gli ultimi {n(c.posts_per_sync)} post.
      </p>
      {known && (
        <p>
          Post già sincronizzati: {n(c.posts_skipped_fresh)} (saltati) · Da sincronizzare: {n(c.posts_to_sync)} (
          {n(c.posts_never_synced)} nuovi, {n(c.posts_resync)} con sync scaduto)
          {(c.posts_skipped_old ?? 0) > 0 && ` · ${n(c.posts_skipped_old)} oltre il limite di età (archiviati)`}.
        </p>
      )}
      {data.est_cost_usd !== null ? (
        (c.posts_to_sync ?? 0) > 0 && (
          <p>
            <span className="font-medium">Stima:</span> fino a ~{n(c.reactions_max)} reazioni e ~{n(c.comments_max)} commenti
            (limite {n(c.reactions_per_post)} reazioni per post).
          </p>
        )
      ) : (
        // Al primo sync il limite massimo lo spiega l'avviso del server: qui solo il perché.
        <p>
          <span className="font-medium">Stima:</span>{' '}
          {known
            ? `non disponibile: alcuni post non hanno i conteggi di reazioni e commenti (massimo ${n(c.reactions_max)} reazioni).`
            : 'non disponibile al primo sync.'}
        </p>
      )}
    </div>
  );
}
