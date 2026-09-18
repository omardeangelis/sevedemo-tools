import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { api, queryKeys } from '../api/client';
import type { IcpListItem } from '../api/types';
import { Card, ErrorBox, Loading, PageHeader } from '../components/ui';

export const Route = createFileRoute('/icps/')({ component: IcpsPage });

/*
 * Elenco ICP (crm-foundation T14, FLOW A.3): nome, ruoli target, liste e aziende di riferimento.
 * "Nuovo ICP" apre il form su `/icps/nuovo` (stessa pagina del dettaglio, in modalità creazione).
 */

/** Segmento del dettaglio in modalità creazione (vedi `icps.$id.tsx`). */
const NEW_ICP = 'nuovo';

const th = 'px-4 py-2 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase';
const td = 'px-4 py-3 align-top text-sm';

function IcpsPage() {
  const icps = useQuery({ queryKey: queryKeys.icpsIndex, queryFn: api.icps.list });
  const newIcpLink = (
    <Link to="/icps/$id" params={{ id: NEW_ICP }} className={buttonVariants()}>
      <PlusIcon aria-hidden="true" />
      Nuovo ICP
    </Link>
  );

  return (
    <>
      <PageHeader
        title="ICP"
        subtitle="Profili cliente ideale: ruoli, settori e aziende di riferimento. Ogni lista appartiene a un ICP."
        actions={newIcpLink}
      />
      {icps.isPending ? (
        <Loading />
      ) : icps.error ? (
        <div className="flex flex-col items-start gap-3">
          <ErrorBox error={icps.error} />
          <Button type="button" variant="outline" onClick={() => void icps.refetch()}>
            Riprova
          </Button>
        </div>
      ) : icps.data.items.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-3 px-4 py-14 text-center">
            <p className="text-sm font-medium text-slate-700">Nessun ICP ancora.</p>
            <p className="max-w-md text-sm text-slate-500">
              Crea il primo: ruoli target, settori e aziende con cui hai trattato bene. Servono per le liste, la
              ricerca di persone nelle aziende e il fit dell'analisi AI.
            </p>
            {newIcpLink}
          </div>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-slate-100">
                <tr>
                  <th scope="col" className={th}>
                    ICP
                  </th>
                  <th scope="col" className={th}>
                    Ruoli target
                  </th>
                  <th scope="col" className={cn(th, 'text-right')}>
                    Liste
                  </th>
                  <th scope="col" className={cn(th, 'text-right')}>
                    Aziende di riferimento
                  </th>
                  <th scope="col" className={th}>
                    Aggiornato
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {icps.data.items.map((icp) => (
                  <IcpRow key={icp.id} icp={icp} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

const MAX_ROLES = 4;

function IcpRow({ icp }: { icp: IcpListItem }) {
  const roles = icp.target_roles.slice(0, MAX_ROLES);
  const more = icp.target_roles.length - roles.length;
  return (
    <tr>
      <td className={cn(td, 'max-w-sm')}>
        <Link to="/icps/$id" params={{ id: String(icp.id) }} className="font-medium text-slate-900 hover:underline">
          {icp.name}
        </Link>
        {icp.description && <p className="mt-0.5 line-clamp-2 text-slate-500">{icp.description}</p>}
      </td>
      <td className={td}>
        {icp.target_roles.length === 0 ? (
          <span className="text-slate-500">Nessun ruolo</span>
        ) : (
          <ul className="flex flex-wrap gap-1" aria-label={`Ruoli target di ${icp.name}`}>
            {roles.map((role) => (
              <li key={role} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-800">
                {role}
              </li>
            ))}
            {more > 0 && <li className="px-1 py-0.5 text-xs text-slate-500">+{more}</li>}
          </ul>
        )}
      </td>
      <td className={cn(td, 'text-right tabular-nums')}>{icp.lists_count}</td>
      <td className={cn(td, 'text-right tabular-nums')}>{icp.reference_companies_count}</td>
      <td className={cn(td, 'whitespace-nowrap text-slate-600')}>
        <time dateTime={icp.updated_at}>
          {new Date(icp.updated_at).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })}
        </time>
      </td>
    </tr>
  );
}
