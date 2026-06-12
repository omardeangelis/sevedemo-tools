import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { RunRow } from '../api/types';
import { fmtDate, fmtDateTime } from '../lib/format';
import { btn, Card, EmptyState, ErrorBox, Loading, PageHeader, td, th } from '../components/ui';

export const Route = createFileRoute('/runs')({ component: RunsPage });

function RunsPage() {
  const runs = useQuery({ queryKey: ['runs'], queryFn: api.runs });
  const selections = useQuery({ queryKey: ['selections'], queryFn: api.selections });

  if (runs.isPending) return <Loading />;
  if (runs.isError) return <ErrorBox error={runs.error} />;

  const byDate = new Map<string, RunRow[]>();
  for (const r of runs.data) {
    const list = byDate.get(r.run_date) ?? [];
    list.push(r);
    byDate.set(r.run_date, list);
  }
  const selectionDates = new Set((selections.data ?? []).map((s) => s.date));

  return (
    <>
      <PageHeader
        title="Run di estrazione"
        subtitle="Ogni run giornaliero registra una riga per strategia: quanti profili sono entrati e quanti erano nuovi."
      />

      {byDate.size === 0 ? (
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
          {[...byDate.entries()].map(([date, rows]) => {
            const totIn = rows.reduce((acc, r) => acc + r.items_in, 0);
            const totNew = rows.reduce((acc, r) => acc + r.items_new, 0);
            return (
              <Card
                key={date}
                title={
                  <span className="capitalize">
                    {fmtDate(date)}{' '}
                    <span className="ml-2 font-normal text-slate-400">
                      {totIn} estratti · {totNew} nuovi
                    </span>
                  </span>
                }
                actions={
                  selectionDates.has(date) && (
                    <Link to="/selections/$date" params={{ date }} className={btn.ghost}>
                      Apri selezione
                    </Link>
                  )
                }
              >
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className={th}>Strategia</th>
                      <th className={`${th} text-right`}>Estratti</th>
                      <th className={`${th} text-right`}>Nuovi</th>
                      <th className={`${th} text-right`}>Costo stimato</th>
                      <th className={`${th} text-right`}>Ora</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td className={`${td} font-medium`}>{r.strategy}</td>
                        <td className={`${td} text-right tabular-nums`}>{r.items_in}</td>
                        <td className={`${td} text-right tabular-nums`}>{r.items_new}</td>
                        <td className={`${td} text-right tabular-nums text-slate-500`}>
                          {r.cost_estimate ? `$${r.cost_estimate.toFixed(2)}` : '—'}
                        </td>
                        <td className={`${td} text-right text-slate-500`}>{fmtDateTime(r.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
