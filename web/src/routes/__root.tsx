import { createRootRoute, Link, Outlet } from '@tanstack/react-router';

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
        <p className="absolute bottom-4 px-5 text-[11px] leading-4 text-slate-600">
          Dati locali · data/sevedemo.db
        </p>
      </aside>
      <main className="ml-56 flex-1 px-8 py-8">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
