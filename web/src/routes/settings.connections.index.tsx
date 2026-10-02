import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { api, queryKeys } from '../api/client';
import { ConnectionCard } from '../components/runs/ConnectionCard';
import { LoadError } from '../components/settings/parts';
import { Loading } from '../components/ui';

/**
 * Connessioni (people-first-crm J2, J5, FLOW G.2): una card per strumento esterno, con cosa abilita, lo
 * stato della chiave, l'ultimo run e il link ai suoi run. Sostituisce le sezioni "Configurazione" e
 * "Ultimi job" delle Impostazioni (J1).
 */
export const Route = createFileRoute('/settings/connections/')({ component: ConnectionsPage });

function ConnectionsPage() {
  const connections = useQuery({ queryKey: queryKeys.connections, queryFn: api.connections.list });

  if (connections.isPending) return <Loading />;
  if (connections.error) return <LoadError error={connections.error} onRetry={() => void connections.refetch()} />;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-slate-600">
        Gli strumenti esterni che il CRM usa, con i loro run e i log. Le chiavi si impostano nel file .env: dopo una
        modifica riavvia il server.
      </p>
      <div className="grid items-stretch gap-4 md:grid-cols-2">
        {connections.data.items.map((connection) => (
          <ConnectionCard key={connection.tool} connection={connection} />
        ))}
      </div>
    </div>
  );
}
