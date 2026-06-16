import { useEffect, useState, type ReactNode } from 'react';

export function cls(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export interface ToastItem {
  id: number;
  kind: 'success' | 'error';
  title: string;
  description?: string;
  action?: ReactNode;
}

let toastSeq = 0;
const toastListeners = new Set<(t: ToastItem) => void>();

/** Notifica in-app, visibile da qualunque pagina (il ToastHost vive nel layout root). */
export function pushToast(toast: Omit<ToastItem, 'id'>): void {
  const item = { ...toast, id: ++toastSeq };
  for (const listener of toastListeners) listener(item);
}

export function ToastHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  useEffect(() => {
    const add = (t: ToastItem) => setToasts((cur) => [...cur, t]);
    toastListeners.add(add);
    return () => {
      toastListeners.delete(add);
    };
  }, []);
  const dismiss = (id: number) => setToasts((cur) => cur.filter((t) => t.id !== id));
  return (
    <div className="fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function Toast({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  useEffect(() => {
    const handle = setTimeout(onDismiss, toast.kind === 'error' ? 20_000 : 8_000);
    return () => clearTimeout(handle);
  }, []);
  const isError = toast.kind === 'error';
  const longDescription = (toast.description?.length ?? 0) > 180;
  return (
    <div
      role="status"
      className={cls(
        'rounded-xl border p-3 shadow-lg',
        isError ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className={cls('text-sm font-semibold', isError ? 'text-red-800' : 'text-emerald-800')}>
          {toast.title}
        </p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Chiudi notifica"
          className="-mt-0.5 cursor-pointer rounded p-0.5 text-slate-400 hover:text-slate-700"
        >
          ✕
        </button>
      </div>
      {toast.description &&
        (longDescription ? (
          <details className={cls('mt-1 text-sm', isError ? 'text-red-700' : 'text-emerald-700')}>
            <summary className="cursor-pointer">Dettagli dell'errore</summary>
            <pre className="mt-1 max-h-40 overflow-auto text-xs whitespace-pre-wrap">
              {toast.description}
            </pre>
          </details>
        ) : (
          <p className={cls('mt-1 text-sm', isError ? 'text-red-700' : 'text-emerald-700')}>
            {toast.description}
          </p>
        ))}
      {toast.action && <div className="mt-2">{toast.action}</div>}
    </div>
  );
}

export const btn = {
  primary:
    'inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 transition-colors cursor-pointer',
  ghost:
    'inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors cursor-pointer',
  danger:
    'inline-flex items-center rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors cursor-pointer',
  dangerSolid:
    'inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50 transition-colors cursor-pointer',
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
  scored: { label: 'valutato', color: 'green' },
  discarded: { label: 'scartato', color: 'gray' },
  rejected_geo: { label: 'fuori Italia', color: 'red' },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_LABEL[status] ?? { label: status, color: 'gray' as const };
  return <Badge color={s.color}>{s.label}</Badge>;
}

/** Stato del ciclo di una Selezione (figlia del Run): in revisione → esportata. */
export function SelectionStateBadge({ state }: { state: string | null }) {
  if (state === 'exported') return <Badge color="violet">esportata</Badge>;
  if (state === 'in_review') return <Badge color="amber">in revisione</Badge>;
  return <Badge color="gray">—</Badge>;
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

/** Spinner di base: dimensioni e colori dei bordi via className. */
export function Spinner({ className }: { className: string }) {
  return <span className={cls('shrink-0 animate-spin rounded-full border-2', className)} />;
}

export function Loading({ label = 'Caricamento…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
      <Spinner className="size-4 border-slate-300 border-t-slate-600" />
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

export function Modal(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  if (!props.open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
      onClick={props.onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-slate-900">{props.title}</h2>
        <div className="mt-2 text-sm text-slate-600">{props.children}</div>
        {props.footer && <div className="mt-5 flex justify-end gap-2">{props.footer}</div>}
      </div>
    </div>
  );
}

export const th = 'px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500';
export const td = 'px-4 py-2.5 text-sm';
