import { createRootRoute, Link, Outlet } from '@tanstack/react-router';
import { Building2Icon, InboxIcon, ListIcon, SettingsIcon, TargetIcon, type LucideIcon } from 'lucide-react';
import { JobBanner } from '../components/JobBanner';
import { ToastHost } from '../components/ui';
import { Toaster } from '../components/ui/toaster';

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: () => (
    <div className="py-20 text-center text-sm text-slate-500">
      Pagina inesistente.{' '}
      <Link to="/" className="font-medium text-slate-900 underline">
        Torna alla home
      </Link>
    </div>
  ),
});

/*
 * Voci della nav del CRM (FLOW Entry points). Le route le creano i task delle pagine (T14 Impostazioni
 * e ICP, T15 Inbox e Liste, T19 Aziende): finché non esistono il link porta al "Pagina inesistente".
 * `to` è una stringa semplice, quindi il cast serve solo a non legare la nav al route tree generato.
 */
const NAV: ReadonlyArray<{ to: string; label: string; icon: LucideIcon }> = [
  { to: '/inbox', label: 'Inbox', icon: InboxIcon },
  { to: '/lists', label: 'Liste', icon: ListIcon },
  { to: '/icps', label: 'ICP', icon: TargetIcon },
  { to: '/companies', label: 'Aziende', icon: Building2Icon },
  { to: '/settings', label: 'Impostazioni', icon: SettingsIcon },
];

function RootLayout() {
  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 flex w-56 flex-col bg-slate-950 text-slate-300">
        <Link to="/" className="block px-5 py-6 focus-visible:outline-2 focus-visible:outline-white">
          <p className="text-lg font-bold text-white">SeVedemo</p>
          <p className="text-xs text-slate-500">Prospect CRM</p>
        </Link>
        <nav aria-label="Navigazione principale" className="flex flex-col gap-1 px-3">
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to as never}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-white"
              activeProps={{ className: 'bg-slate-800 text-white', 'aria-current': 'page' }}
              inactiveProps={{ className: 'text-slate-400 hover:bg-slate-900 hover:text-white' }}
            >
              <Icon className="size-4" aria-hidden="true" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto pb-4">
          <JobBanner />
        </div>
      </aside>
      <main className="ml-56 min-w-0 flex-1 px-8 py-8">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>
      <Toaster />
      {/* Host legacy di `pushToast` (components/ui.tsx), montato per compatibilità: usare `toast` di ui/toaster. */}
      <ToastHost />
    </div>
  );
}
