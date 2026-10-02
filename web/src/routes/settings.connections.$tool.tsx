import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { cn } from '@/lib/utils';
import { api, isApiError, queryKeys } from '../api/client';
import type { RunView, ToolId } from '../api/types';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { Outcome, RunLink, TOOL_LABELS, runDurationText, runStartText, toolNames } from '../components/runs/parts';
import { LoadError, td, th } from '../components/settings/parts';
import { Card, Loading } from '../components/ui';
import { useToday } from '../lib/dates';
import { countText } from '../lib/format';
import { describeJobError } from '../lib/jobs';

/*
 * Run di uno strumento (people-first-crm J6, FLOW G.3): dal più recente, con il filtro **Tutti · Falliti**
 * nell'URL (sopravvive al reload e si può condividere) e le colonne Operazione · Avvio · Durata · Esito ·
 * Riassunto. Strumento sconosciuto → "Strumento non trovato" con il ritorno a Connessioni.
 */

const search = z.object({
  outcome: z.enum(['all', 'failed']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
});

export const Route = createFileRoute('/settings/connections/$tool')({
  validateSearch: search,
  component: ToolRunsPage,
});

const FILTERS = [
  { value: 'all', label: 'Tutti' },
  { value: 'failed', label: 'Falliti' },
] as const;

function ToolRunsPage() {
  // Lo strumento sconosciuto lo intercetta il 404 del server, che porta a "Strumento non trovato".
  const tool = Route.useParams().tool as ToolId;
  const { outcome, page } = Route.useSearch();
  const runs = useQuery({
    queryKey: queryKeys.toolRuns(tool, outcome, page),
    queryFn: () => api.connections.runs(tool, { outcome, page }),
    retry: false,
  });
  const label = TOOL_LABELS[tool] ?? tool;
  const today = useToday();

  if (runs.error) {
    if (isApiError(runs.error) && runs.error.status === 404) return <ToolNotFound />;
    return <LoadError error={runs.error} onRetry={() => void runs.refetch()} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs
        items={[{ label: 'Impostazioni', to: '/settings/profile' }, { label: 'Connessioni', to: '/settings/connections' }, { label }]}
      />
      <Card
        title={`Run di ${label}${runs.data ? ` (${runs.data.total})` : ''}`}
        actions={
          <div className="flex gap-1" role="group" aria-label="Filtro degli esiti">
            {FILTERS.map((filter) => (
              <Link
                key={filter.value}
                to="/settings/connections/$tool"
                params={{ tool }}
                search={{ outcome: filter.value, page: 1 }}
                className={cn(
                  'rounded-lg px-2.5 py-1 text-sm font-medium',
                  outcome === filter.value ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100',
                )}
              >
                {filter.label}
              </Link>
            ))}
          </div>
        }
      >
        {runs.isPending ? (
          <Loading />
        ) : runs.data.items.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500">
            {outcome === 'failed' ? `Nessun run fallito di ${label}.` : `${label} non ha ancora run.`}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <caption className="sr-only">{`Run di ${label}${outcome === 'failed' ? ', solo falliti' : ''}, dal più recente`}</caption>
              <thead className="border-b border-slate-100 bg-slate-50">
                <tr>
                  <th scope="col" className={th}>
                    Operazione
                  </th>
                  <th scope="col" className={th}>
                    Avvio
                  </th>
                  <th scope="col" className={th}>
                    Durata
                  </th>
                  <th scope="col" className={th}>
                    Esito
                  </th>
                  <th scope="col" className={th}>
                    Riassunto
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {runs.data.items.map((run) => (
                  <RunRow key={run.id} run={run} tool={tool} today={today} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {runs.data && runs.data.total > runs.data.pageSize && (
          <Pages tool={tool} outcome={outcome} page={page} total={runs.data.total} pageSize={runs.data.pageSize} />
        )}
      </Card>
    </div>
  );
}

function RunRow({ run, tool, today }: { run: RunView; tool: ToolId; today: string }) {
  const failedElsewhere = run.failed_tools.length > 0 && !run.failed_tools.includes(tool);
  // Riuscito, ma non per questo strumento: la sua fonte è fallita (own-profile-services P-26).
  const failedHereOnly = run.outcome !== 'failed' && run.failed_tools.includes(tool);
  return (
    <tr>
      <td className={td}>
        <RunLink run={run}>{run.operation}</RunLink>
      </td>
      <td className={cn(td, 'whitespace-nowrap text-slate-600')}>
        {run.started_at ? <time dateTime={run.started_at}>{runStartText(run.started_at, today)}</time> : '—'}
      </td>
      <td className={cn(td, 'whitespace-nowrap text-slate-600')}>{runDurationText(run.duration_ms)}</td>
      <td className={td}>
        <Outcome outcome={run.outcome} />
        {failedElsewhere && (
          <p className="mt-1 text-xs text-slate-600">Errore di {toolNames(run.failed_tools)}</p>
        )}
        {failedHereOnly && <p className="mt-1 text-xs text-red-800">Non riuscito per {toolNames([tool])}</p>}
      </td>
      {/* Riassunto: l'errore si legge come nelle card (il prefisso tecnico resta nel dettaglio, FLOW G.4). */}
      <td className={cn(td, 'text-slate-700')}>{run.summary ?? (run.error ? describeJobError(run.error).message : '—')}</td>
    </tr>
  );
}

function Pages({
  tool,
  outcome,
  page,
  total,
  pageSize,
}: {
  tool: ToolId;
  outcome: 'all' | 'failed';
  page: number;
  total: number;
  pageSize: number;
}) {
  const last = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav aria-label="Pagine dei run" className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-2.5 text-sm">
      <span className="text-slate-600">
        Pagina {page} di {last} · {countText(total, 'run', 'run')}
      </span>
      <span className="flex gap-2">
        {page > 1 && (
          <Link to="/settings/connections/$tool" params={{ tool }} search={{ outcome, page: page - 1 }} className="font-medium text-slate-700 hover:underline">
            ← Più recenti
          </Link>
        )}
        {page < last && (
          <Link to="/settings/connections/$tool" params={{ tool }} search={{ outcome, page: page + 1 }} className="font-medium text-slate-700 hover:underline">
            Più vecchi →
          </Link>
        )}
      </span>
    </nav>
  );
}

function ToolNotFound() {
  return (
    <Card title="Strumento non trovato">
      <div className="flex flex-col items-start gap-3 px-4 py-4 text-sm">
        <p className="text-slate-600">Questo indirizzo non corrisponde a nessuno strumento del CRM.</p>
        <Link to="/settings/connections" className="font-medium text-slate-900 underline underline-offset-2">
          Vai a Connessioni
        </Link>
      </div>
    </Card>
  );
}
