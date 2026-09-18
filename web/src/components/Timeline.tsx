import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRightLeftIcon,
  DownloadIcon,
  MailIcon,
  MessageCircleIcon,
  MessageSquareTextIcon,
  PhoneIcon,
  SparklesIcon,
  StickyNoteIcon,
  Trash2Icon,
  UserRoundSearchIcon,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { api, isApiError } from '../api/client';
import {
  CHANNEL_LABELS,
  DIRECTION_LABELS,
  STATUS_LABELS,
  type Activity,
  type ActivityKind,
  type Channel,
} from '../api/types';
import { fmtDateTime } from '../lib/format';
import { invalidateProspectViews } from './StatusSelect';
import { toast } from './ui/toaster';

const KIND_ICONS: Record<ActivityKind, LucideIcon> = {
  status_change: ArrowRightLeftIcon,
  touchpoint: MessageSquareTextIcon,
  note: StickyNoteIcon,
  export: DownloadIcon,
  analysis: SparklesIcon,
  enrichment: UserRoundSearchIcon,
};

const CHANNEL_ICONS: Record<Channel, LucideIcon> = {
  email: MailIcon,
  linkedin_dm: MessageSquareTextIcon,
  linkedin_comment: MessageCircleIcon,
  call: PhoneIcon,
  other: MessageSquareTextIcon,
};

/** Nome leggibile del tipo di attività (prima parola della voce, anche per gli screen reader). */
const KIND_LABELS: Record<ActivityKind, string> = {
  status_change: 'Cambio stato',
  touchpoint: 'Touchpoint',
  note: 'Nota',
  export: 'Export',
  analysis: 'Analisi AI',
  enrichment: 'Arricchimento',
};

/** Oltre questa lunghezza il testo parte compresso con "Mostra tutto". */
const LONG_TEXT = 280;

export interface TimelineProps {
  /** Attività dalla più recente (`timeline` del dettaglio). */
  activities: Activity[];
}

/**
 * Timeline del prospect (FLOW F.4, P3): lista semantica `<ol>` dalla più recente, icona e nome per
 * kind, canale/direzione dei touchpoint, chip della lista di contesto, data con `datetime`, testo
 * espandibile. **Elimina** solo su touchpoint e note (errori di registrazione, `DELETE
 * /api/activities/:id`), con conferma in linea perché non si annulla; lo stato non cambia.
 */
export function Timeline({ activities }: TimelineProps) {
  if (activities.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
        Nessuna attività. Registra il primo touchpoint qui sotto o cambia lo stato.
      </p>
    );
  }
  return (
    <ol aria-label="Timeline delle attività" className="flex flex-col">
      {activities.map((activity, i) => (
        <TimelineItem key={activity.id} activity={activity} last={i === activities.length - 1} />
      ))}
    </ol>
  );
}

function TimelineItem({ activity: a, last }: { activity: Activity; last: boolean }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const failed = a.kind === 'analysis' && typeof a.meta?.error === 'string';
  const Icon = a.kind === 'touchpoint' && a.channel ? CHANNEL_ICONS[a.channel] : KIND_ICONS[a.kind];
  // Articolo concordato: "questa nota", "questo touchpoint".
  const what = a.kind === 'note' ? { noun: 'nota', the: 'la nota', this: 'questa nota' } : { noun: 'touchpoint', the: 'il touchpoint', this: 'questo touchpoint' };

  const remove = useMutation({
    mutationFn: () => api.prospects.deleteActivity(a.id),
    onSuccess: () => {
      toast({ tone: 'neutral', title: a.kind === 'note' ? 'Nota eliminata' : 'Touchpoint eliminato' });
      void invalidateProspectViews(queryClient);
    },
    onError: (err) => {
      if (isApiError(err) && err.status === 404) void invalidateProspectViews(queryClient);
      toast({ tone: 'error', title: `Impossibile eliminare ${what.the}`, description: err instanceof Error ? err.message : undefined });
    },
  });

  return (
    <li className="relative flex gap-3 pb-4" data-kind={a.kind}>
      {!last && <span aria-hidden="true" className="absolute top-8 bottom-0 left-4 w-px bg-slate-200" />}
      <span
        aria-hidden="true"
        className={cn(
          'relative flex size-8 shrink-0 items-center justify-center rounded-full ring-1 ring-inset',
          failed ? 'bg-red-50 text-red-600 ring-red-200' : a.kind === 'touchpoint' ? 'bg-blue-50 text-blue-700 ring-blue-200' : 'bg-slate-50 text-slate-500 ring-slate-200',
        )}
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1 pt-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <p className="text-sm font-medium text-slate-900">{title(a, failed)}</p>
          {a.list_name && (
            <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
              <span className="sr-only">Lista: </span>
              {a.list_name}
            </span>
          )}
          <time dateTime={a.occurred_at} className="text-xs text-slate-500">
            {fmtDateTime(a.occurred_at)}
          </time>
        </div>
        {body(a)}
        {a.deletable && (
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {confirming ? (
              <>
                <span className="text-xs text-slate-600">
                  Eliminare {what.this}? Non si può annullare
                  {typeof a.meta?.status_change_id === 'number' ? '; lo stato resta com\'è' : ''}.
                </span>
                <Button
                  type="button"
                  size="xs"
                  variant="destructive"
                  onClick={() => remove.mutate()}
                  disabled={remove.isPending}
                  aria-busy={remove.isPending}
                >
                  {remove.isPending ? 'Eliminazione…' : 'Elimina'}
                </Button>
                <Button type="button" size="xs" variant="ghost" onClick={() => setConfirming(false)} disabled={remove.isPending}>
                  Annulla
                </Button>
              </>
            ) : (
              <Button
                type="button"
                size="xs"
                variant="ghost"
                className="text-slate-500 hover:text-red-700"
                aria-label={`Elimina ${what.noun} del ${fmtDateTime(a.occurred_at)}`}
                onClick={() => setConfirming(true)}
              >
                <Trash2Icon aria-hidden="true" />
                Elimina
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function title(a: Activity, failed: boolean): ReactNode {
  switch (a.kind) {
    case 'status_change':
      return (
        <>
          Stato: {a.from_status ? STATUS_LABELS[a.from_status] : '—'} → {a.to_status ? STATUS_LABELS[a.to_status] : '—'}
        </>
      );
    case 'touchpoint':
      return [KIND_LABELS.touchpoint, a.channel && CHANNEL_LABELS[a.channel], a.direction && DIRECTION_LABELS[a.direction].toLowerCase()]
        .filter(Boolean)
        .join(' · ');
    case 'analysis':
      return failed ? 'Analisi AI non riuscita' : KIND_LABELS.analysis;
    default:
      return KIND_LABELS[a.kind];
  }
}

function body(a: Activity): ReactNode {
  const note = a.kind === 'touchpoint' && typeof a.meta?.note === 'string' ? a.meta.note : null;
  if (!a.body && !note) {
    return a.kind === 'touchpoint' ? <p className="mt-0.5 text-sm text-slate-500">Nessun testo registrato.</p> : null;
  }
  return (
    <div className="mt-0.5 flex flex-col gap-1">
      {a.body && (
        <ExpandableText
          text={a.kind === 'status_change' ? `Nota: ${a.body}` : a.body}
          className={a.kind === 'touchpoint' ? 'text-slate-800' : 'text-slate-600'}
        />
      )}
      {note && <ExpandableText text={`Nota: ${note}`} className="text-slate-600" />}
    </div>
  );
}

function ExpandableText({ text, className }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > LONG_TEXT;
  return (
    <div>
      <p className={cn('text-sm break-words whitespace-pre-wrap', !open && long && 'line-clamp-4', className)}>{text}</p>
      {long && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="mt-0.5 cursor-pointer text-xs font-medium text-slate-600 underline underline-offset-2 hover:text-slate-900"
        >
          {open ? 'Mostra meno' : 'Mostra tutto'}
        </button>
      )}
    </div>
  );
}
