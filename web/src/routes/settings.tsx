import { Link, Outlet, createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '../components/ui';

export const Route = createFileRoute('/settings')({ component: SettingsLayout });

/*
 * Impostazioni in tre sezioni, ciascuna con il suo indirizzo (people-first-crm J1, A5, T31):
 * **Profilo e azienda** (`/settings/profile`, ancore `#profilo` e `#azienda`) · **I miei post**
 * (`/settings/posts`) · **Connessioni** (`/settings/connections`). "Configurazione" e "Ultimi job" non
 * sono più sezioni a sé: il loro contenuto sta in Connessioni. `/settings` reindirizza al profilo
 * conservando l'ancora (`settings.index.tsx`), così i vecchi link restano validi.
 */

const SECTIONS = [
  { to: '/settings/profile', label: 'Profilo e azienda' },
  { to: '/settings/posts', label: 'I miei post' },
  { to: '/settings/connections', label: 'Connessioni' },
] as const;

function SettingsLayout() {
  return (
    <>
      <PageHeader title="Impostazioni" subtitle="Il tuo profilo, la tua azienda, i tuoi post e gli strumenti esterni." />
      <nav aria-label="Sezioni delle impostazioni" className="mb-6 border-b border-slate-200">
        <ul className="-mb-px flex flex-wrap gap-1">
          {SECTIONS.map((section) => (
            <li key={section.to}>
              {/* `aria-current="page"` lo mette il Link quando è attivo (anche sulle pagine figlie). */}
              <Link
                to={section.to}
                className="inline-block border-b-2 border-transparent px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 aria-[current=page]:border-slate-900 aria-[current=page]:text-slate-900"
              >
                {section.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <Outlet />
    </>
  );
}
