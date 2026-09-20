import { Link } from '@tanstack/react-router';
import { cn } from '@/lib/utils';
import type { Connection } from '../../api/types';
import { useToday } from '../../lib/dates';
import { countText } from '../../lib/format';
import { describeJobError } from '../../lib/jobs';
import { Outcome, RunLink, runStartText, toolNames } from './parts';

/*
 * Card di uno strumento in Connessioni (people-first-crm J2, J5, FLOW G.2): cosa abilita, stato della
 * chiave con il nome della variabile, ultimo run ed elenco dei run. La salute è onesta: una chiave
 * presente ma rifiutata non passa per sana.
 */

/** J5: perché lo strumento non è sano, col rimedio quando l'errore ne ha uno (stessa lettura del banner). */
function LastFailure({ error }: { error: string | null }) {
  const info = describeJobError(error);
  return (
    <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900">
      <p>
        Ultimo run fallito: {info.message}
        {info.remedy ? ` ${info.remedy}` : ''}
      </p>
      <p className="mt-0.5 text-red-800">"Configurata" vuol dire solo che la chiave è presente.</p>
    </div>
  );
}

export function ConnectionCard({ connection }: { connection: Connection }) {
  const { last_run: last } = connection;
  const today = useToday();
  return (
    <section className="flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm" data-tool={connection.tool}>
      <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">{connection.label}</h2>
        {last &&
          // Un run fallito per un **altro** strumento non accende il rosso qui: direbbe che è rotto questo (J4).
          (last.outcome === 'failed' && !last.failed_tools.includes(connection.tool) ? (
            <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-slate-700">
              Fallito per {toolNames(last.failed_tools)}
            </span>
          ) : (
            <Outcome outcome={last.outcome} />
          ))}
      </header>
      <div className="flex flex-1 flex-col gap-2 px-4 py-3 text-sm">
        <p className="text-slate-600">{connection.enables}</p>
        <p className={cn('text-sm', connection.configured ? 'text-slate-700' : 'text-red-800')}>
          <span className="font-mono text-xs">{connection.env_var}</span>
          {connection.configured ? ' · Configurata' : ' · Mancante: aggiungila al .env e riavvia il server.'}
        </p>
        {last ? (
          <p className="text-slate-700">
            Ultimo run: <RunLink run={last}>{runStartText(last.started_at, today)}</RunLink> · {last.operation}
            {/* Run di più strumenti fallito per un altro: senza questa riga il "Fallito" in testa sembrerebbe suo (J4). */}
            {last.outcome === 'failed' && !last.failed_tools.includes(connection.tool) && (
              <span className="text-slate-600">
                {' '}
                — fallito per {toolNames(last.failed_tools)}, non per {connection.label}.
              </span>
            )}
          </p>
        ) : (
          <p className="text-slate-500">Nessun run ancora.</p>
        )}
        {connection.health === 'failing' && last && <LastFailure error={last.error} />}
      </div>
      <footer className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5 text-sm">
        <span className="text-slate-600">{countText(connection.runs_count, 'run', 'run')}</span>
        <Link
          to="/settings/connections/$tool"
          params={{ tool: connection.tool }}
          className="font-medium text-slate-700 underline-offset-2 hover:text-slate-900 hover:underline"
        >
          Vedi run
        </Link>
      </footer>
    </section>
  );
}
