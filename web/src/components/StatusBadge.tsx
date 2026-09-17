import { STATUS_LABELS, type ProspectStatus } from '../api/types';
import { cn } from '@/lib/utils';

/** Colori per stato: il testo (label italiana) è sempre presente, il colore è solo un aiuto. */
const STATUS_COLORS: Record<ProspectStatus, string> = {
  nuovo: 'bg-sky-100 text-sky-800 ring-sky-200',
  qualificato: 'bg-violet-100 text-violet-800 ring-violet-200',
  da_contattare: 'bg-amber-100 text-amber-900 ring-amber-200',
  contattato: 'bg-blue-100 text-blue-800 ring-blue-200',
  risposto: 'bg-teal-100 text-teal-800 ring-teal-200',
  in_conversazione: 'bg-indigo-100 text-indigo-800 ring-indigo-200',
  chiuso_vinto: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  chiuso_perso: 'bg-stone-200 text-stone-700 ring-stone-300',
  scartato: 'bg-slate-100 text-slate-500 ring-slate-200',
};

export interface StatusBadgeProps {
  status: ProspectStatus;
  className?: string;
}

/**
 * Badge dello stato del prospect (9 stati, label italiane da `STATUS_LABELS`). Lo stato è unico per
 * persona (D4): lo stesso badge vale in tutte le liste. Accessibile: testo sempre visibile.
 *
 * @example <StatusBadge status={prospect.status} />
 */
export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span
      data-status={status}
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
        STATUS_COLORS[status] ?? 'bg-slate-100 text-slate-600 ring-slate-200',
        className,
      )}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
