import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { RunExecution } from '../api/types';
import { fmtDate, fmtDateTime } from '../lib/format';
import {
  Badge,
  btn,
  Card,
  EmptyState,
  ErrorBox,
  Loading,
  PageHeader,
  SelectionStateBadge,
} from '../components/ui';

export const Route = createFileRoute('/runs')({ component: RunsPage });

function RunsPage() {
  const runs = useQuery({ queryKey: ['runs'], queryFn: api.runs });

  if (runs.isPending) return <Loading />;
  if (runs.isError) return <ErrorBox error={runs.error} />;

  return (
    <>
      <PageHeader
        title="Run di estrazione"
        subtitle="Ogni esecuzione del run giornaliero genera una Selezione: qui vedi provenienza, stato e quanti contatti sono pronti o da arricchire."
      />

      {runs.data.length === 0 ? (
        <Card>
          <EmptyState
            title="Nessun run registrato"
            hint={
              <>
                Esegui <code className="rounded bg-slate-100 px-1 py-0.5">npm run pipeline -- --daily</code> per
                lanciare la prima estrazione.
              </>
            }
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {runs.data.map((exec) => (
            <RunCard key={exec.run_id ?? `date:${exec.run_date}`} exec={exec} />
          ))}
        </div>
      )}
    </>
  );
}

function RunCard({ exec }: { exec: RunExecution }) {
  const sel = exec.selection;
  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          <span className="capitalize">{fmtDate(exec.run_date)}</span>
          {exec.run_id ? (
            <span className="font-mono text-xs font-normal text-slate-400">{exec.run_id}</span>
          ) : (
            <span className="text-xs font-normal text-slate-400">(run legacy)</span>
          )}
          <span className="font-normal text-slate-400">
            {exec.items_in} estratti · {exec.items_new} nuovi
          </span>
        </span>
      }
      actions={
        sel && (
          <Link to="/selections/$date" params={{ date: sel.date }} className={btn.ghost}>
            Apri selezione
          </Link>
        )
      }
    >
      <div className="flex flex-wrap items-center gap-1.5 px-4 py-3">
        <span className="text-xs font-medium text-slate-500">Strategie:</span>
        {exec.strategies.length === 0 ? (
          <span className="text-xs text-slate-400">—</span>
        ) : (
          exec.strategies.map((s) => (
            <Badge key={s} color="blue">
              {s}
            </Badge>
          ))
        )}
        <span className="ml-auto text-xs text-slate-400">{fmtDateTime(exec.created_at)}</span>
      </div>

      <div className="border-t border-slate-100 px-4 py-3">
        {sel ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-medium text-slate-600">Selezione</span>
            <SelectionStateBadge state={sel.state} />
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
              <span className="text-emerald-600">✉</span>
              {sel.ready} pronti
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
              {sel.toEnrich} da arricchire
            </span>
            <span className="text-xs text-slate-400">{sel.total} totali</span>
          </div>
        ) : (
          <p className="text-xs text-slate-400">Nessuna Selezione generata da questa esecuzione.</p>
        )}
      </div>
    </Card>
  );
}
