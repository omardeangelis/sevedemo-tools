import { useId, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createRootRoute, Link, Outlet, useRouterState } from '@tanstack/react-router';
import { Building2Icon, ListIcon, SettingsIcon, SunIcon, TargetIcon, UsersIcon, type LucideIcon } from 'lucide-react';
import { api, queryKeys } from '../api/client';
import { CommandSearch } from '../components/CommandSearch';
import { JobBanner } from '../components/JobBanner';
import { NextActionDialogHost } from '../components/NextActionActions';
import { ToastHost } from '../components/ui';
import { Toaster } from '../components/ui/toaster';
import { fmtCount } from '../lib/format';

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
 * Navigazione principale (people-first-crm A1, FLOW "Architettura della sidebar"): **Oggi** in cima (la home, attiva
 * solo su `/`), gruppo Contatti (Persone con il
 * badge delle persone da smistare, Aziende), gruppo Prospecting (Liste, ICP), in fondo Impostazioni. La voce resta
 * attiva anche nei dettagli della sezione (A6: `/people/12` → Persone). Sopra le voci il bottone **Cerca** (⌘K /
 * Ctrl+K, I1), fuori dall'elenco della navigazione.
 */
type NavItem = { to: string; label: string; icon: LucideIcon };

const CONTACTS: readonly NavItem[] = [
  { to: '/people', label: 'Persone', icon: UsersIcon },
  { to: '/companies', label: 'Aziende', icon: Building2Icon },
];
const PROSPECTING: readonly NavItem[] = [
  { to: '/lists', label: 'Liste', icon: ListIcon },
  { to: '/icps', label: 'ICP', icon: TargetIcon },
];

const itemCls =
  'flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-white';

/**
 * Voce della sidebar. `section`: la voce porta a una pagina che ha una **sotto-navigazione** (Impostazioni),
 * ed è quella a marcare la pagina corrente. Qui la voce resta evidenziata per tutta la sezione ma senza
 * `aria-current`, altrimenti due link alla stessa destinazione si annuncerebbero entrambi "pagina corrente".
 */
function NavLink({ item, exact, section }: { item: NavItem; exact?: boolean; section?: boolean }) {
  const Icon = item.icon;
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const inSection = section === true && pathname.startsWith(item.to);
  return (
    <Link
      to={item.to as never}
      // Con `section` il match esatto non scatta mai (`/settings` reindirizza): l'evidenza la mette `inSection`.
      activeOptions={exact || section ? { exact: true } : undefined}
      className={itemCls}
      activeProps={{ className: 'bg-slate-800 text-white', 'aria-current': 'page' }}
      inactiveProps={{ className: inSection ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-900 hover:text-white' }}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {item.label}
    </Link>
  );
}

/** Badge "N persone da smistare" (A2): link a sé verso la vista Da smistare; a 0 sparisce. */
function ToTriageBadge() {
  const counts = useQuery({ queryKey: queryKeys.toTriageCount, queryFn: () => api.prospects.viewCounts({}) });
  const n = counts.data?.da_smistare ?? 0;
  if (n === 0) return null;
  return (
    <Link
      to="/people"
      search={{ view: 'da_smistare' } as never}
      activeOptions={{ exact: true, includeSearch: true }}
      aria-label={`${fmtCount(n)} ${n === 1 ? 'persona da smistare' : 'persone da smistare'}`}
      className="mr-1 shrink-0 rounded-full bg-sky-500/20 px-2 py-0.5 text-xs font-semibold text-sky-200 tabular-nums hover:bg-sky-500/35 focus-visible:outline-2 focus-visible:outline-white"
    >
      {fmtCount(n)}
    </Link>
  );
}

function NavGroup({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-1">
      <p id={id} className="px-3 pt-3 pb-1 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
        {label}
      </p>
      {children}
    </div>
  );
}

function RootLayout() {
  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 flex w-56 flex-col bg-slate-950 text-slate-300">
        {/* Marchio come testo: la home è la voce "Oggi" (un link a `/` qui sarebbe una seconda "pagina corrente"). */}
        <div className="px-5 py-6">
          <p className="text-lg font-bold text-white">SeVedemo</p>
          <p className="text-xs text-slate-500">CRM personale</p>
        </div>
        <div className="px-3 pb-2">
          <CommandSearch />
        </div>
        <nav aria-label="Navigazione principale" className="flex flex-1 flex-col gap-1 px-3">
          <div className="flex">
            <NavLink item={{ to: '/', label: 'Oggi', icon: SunIcon }} exact />
          </div>
          <NavGroup label="Contatti">
            <div className="flex items-center">
              <NavLink item={CONTACTS[0]} />
              <ToTriageBadge />
            </div>
            <NavLink item={CONTACTS[1]} />
          </NavGroup>
          <NavGroup label="Prospecting">
            {PROSPECTING.map((item) => (
              <NavLink key={item.to} item={item} />
            ))}
          </NavGroup>
          <div className="mt-auto pt-3">
            <NavLink item={{ to: '/settings', label: 'Impostazioni', icon: SettingsIcon }} section />
          </div>
        </nav>
        <div className="pt-2 pb-4">
          <JobBanner />
        </div>
      </aside>
      <main className="ml-56 min-w-0 flex-1 px-8 py-8">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>
      <Toaster />
      {/* "Imposta la prossima" dal toast di Fatto (people-first-crm G4): il dialog vive oltre la riga che l'ha aperto. */}
      <NextActionDialogHost />
      {/* Host legacy di `pushToast` (components/ui.tsx), montato per compatibilità: usare `toast` di ui/toaster. */}
      <ToastHost />
    </div>
  );
}
