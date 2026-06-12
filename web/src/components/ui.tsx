import type { ReactNode } from 'react';

export function cls(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export const btn = {
  primary:
    'inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 transition-colors cursor-pointer',
  ghost:
    'inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors cursor-pointer',
  danger:
    'inline-flex items-center rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors cursor-pointer',
};

export const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none';

export function PageHeader(props: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{props.title}</h1>
        {props.subtitle && <p className="mt-1 text-sm text-slate-500">{props.subtitle}</p>}
      </div>
      {props.actions && <div className="flex items-center gap-2">{props.actions}</div>}
    </div>
  );
}

export function Card(props: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cls('rounded-xl border border-slate-200 bg-white shadow-sm', props.className)}>
      {(props.title || props.actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-700">{props.title}</h2>
          {props.actions}
        </header>
      )}
      {props.children}
    </section>
  );
}

export function StatCard(props: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{props.label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{props.value}</p>
      {props.hint && <p className="mt-0.5 text-xs text-slate-400">{props.hint}</p>}
    </div>
  );
}

const BADGE_COLORS: Record<string, string> = {
  sky: 'bg-sky-100 text-sky-800',
  violet: 'bg-violet-100 text-violet-800',
  green: 'bg-emerald-100 text-emerald-800',
  amber: 'bg-amber-100 text-amber-800',
  red: 'bg-red-100 text-red-700',
  gray: 'bg-slate-100 text-slate-600',
  blue: 'bg-blue-100 text-blue-800',
};

export function Badge(props: { color?: keyof typeof BADGE_COLORS; children: ReactNode }) {
  return (
    <span
      className={cls(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        BADGE_COLORS[props.color ?? 'gray'],
      )}
    >
      {props.children}
    </span>
  );
}

export function BucketBadge({ bucket }: { bucket: string | null }) {
  if (!bucket) return <Badge color="gray">—</Badge>;
  const color = bucket === 'freelance' ? 'sky' : bucket === 'azienda' ? 'violet' : 'gray';
  return <Badge color={color}>{bucket}</Badge>;
}

const STATUS_LABEL: Record<string, { label: string; color: keyof typeof BADGE_COLORS }> = {
  new: { label: 'nuovo', color: 'gray' },
  enriched: { label: 'arricchito', color: 'blue' },
  scored: { label: 'valutato', color: 'amber' },
  selected: { label: 'selezionato', color: 'green' },
  exported: { label: 'esportato', color: 'violet' },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_LABEL[status] ?? { label: status, color: 'gray' as const };
  return <Badge color={s.color}>{s.label}</Badge>;
}

export function FitScore({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-slate-400">n/d</span>;
  const color =
    value >= 80
      ? 'bg-emerald-100 text-emerald-800'
      : value >= 65
        ? 'bg-lime-100 text-lime-800'
        : value >= 50
          ? 'bg-amber-100 text-amber-800'
          : 'bg-slate-100 text-slate-500';
  return (
    <span className={cls('inline-flex min-w-9 items-center justify-center rounded-md px-1.5 py-0.5 text-xs font-bold tabular-nums', color)}>
      {value}
    </span>
  );
}

export function Avatar({ name }: { name: string | null }) {
  const init = (name ?? '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600">
      {init || '?'}
    </span>
  );
}

export function Loading({ label = 'Caricamento…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
      <span className="size-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
      {label}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {error instanceof Error ? error.message : 'Errore inatteso.'}
    </div>
  );
}

export function EmptyState(props: { title: string; hint?: ReactNode }) {
  return (
    <div className="py-14 text-center">
      <p className="text-sm font-medium text-slate-600">{props.title}</p>
      {props.hint && <p className="mx-auto mt-1 max-w-md text-sm text-slate-400">{props.hint}</p>}
    </div>
  );
}

export const th = 'px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500';
export const td = 'px-4 py-2.5 text-sm';
