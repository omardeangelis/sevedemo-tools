import { useEffect, useRef } from 'react';
import { createRootRoute, Link, Outlet } from '@tanstack/react-router';
import type { PipelineStatus } from '../api/types';
import { pushToast, Spinner, ToastHost } from '../components/ui';
import { usePipelineStatus } from '../lib/pipeline';

const NAV = [
  { to: '/', label: 'Dashboard', exact: true },
  { to: '/selections', label: 'Selezioni' },
  { to: '/contacts', label: 'Contatti' },
  { to: '/runs', label: 'Run' },
  { to: '/report', label: 'Report strategie' },
] as const;

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: () => (
    <div className="py-20 text-center text-sm text-slate-500">
      Pagina inesistente.{' '}
      <Link to="/" className="font-medium text-slate-900 underline">
        Torna alla dashboard
      </Link>
    </div>
  ),
});

function RootLayout() {
  const status = usePipelineStatus().data;
  usePipelineOutcomeToasts(status);

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 w-56 bg-slate-950 text-slate-300">
        <div className="px-5 py-6">
          <p className="text-lg font-bold text-white">SeVedemo</p>
          <p className="text-xs text-slate-500">Lead Engine</p>
        </div>
        <nav className="flex flex-col gap-1 px-3">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: 'exact' in item && item.exact }}
              className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-slate-800 hover:text-white"
              activeProps={{ className: 'bg-slate-800 text-white' }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        {status?.state === 'running' && <RunningBadge startedAt={status.started_at} />}
        <p className="absolute bottom-4 px-5 text-[11px] leading-4 text-slate-600">
          Dati locali · data/sevedemo.db
        </p>
      </aside>
      <main className="ml-56 flex-1 px-8 py-8">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>
      <ToastHost />
    </div>
  );
}

function RunningBadge({ startedAt }: { startedAt?: string }) {
  const started = startedAt ? new Date(startedAt).getTime() : Number.NaN;
  // Si aggiorna a ogni poll (2.5s durante il run): basta calcolarlo al render.
  const minutes = Number.isFinite(started)
    ? Math.max(0, Math.floor((Date.now() - started) / 60_000))
    : null;
  return (
    <div className="mx-3 mt-4 flex items-center gap-2 rounded-lg bg-amber-400/10 px-3 py-2 text-xs font-medium text-amber-300">
      <Spinner className="size-3 border-amber-300/40 border-t-amber-300" />
      Run in corso{minutes !== null ? ` · ${minutes} min` : '…'}
    </div>
  );
}

/**
 * Toast sulla transizione running → succeeded|failed. Idempotente rispetto a
 * StrictMode/remount: al mount lo stato precedente è ignoto, quindi nessun
 * toast; scatta solo su un vero cambio osservato dal polling.
 */
function usePipelineOutcomeToasts(status: PipelineStatus | undefined) {
  const prevState = useRef<PipelineStatus['state'] | undefined>(undefined);
  useEffect(() => {
    const next = status?.state;
    if (!next) return;
    const prev = prevState.current;
    prevState.current = next;
    if (prev !== 'running' || next === 'running') return;

    if (next === 'succeeded') {
      const date = status?.run_date;
      pushToast({
        kind: 'success',
        title: 'Run completato',
        description: 'La selezione del giorno è pronta.',
        action: date ? (
          <Link
            to="/selections/$date"
            params={{ date }}
            className="text-sm font-medium text-emerald-800 underline"
          >
            Apri la selezione →
          </Link>
        ) : undefined,
      });
    }
    if (next === 'failed') {
      pushToast({
        kind: 'error',
        title: 'Run fallito',
        description: status?.error ?? 'Errore sconosciuto.',
      });
    }
  }, [status?.state]);
}
