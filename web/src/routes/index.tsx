import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { fmtDateShort } from '../lib/format';
import { btn, Card, EmptyState, ErrorBox, Loading, PageHeader, StatCard, td, th } from '../components/ui';

export const Route = createFileRoute('/')({ component: Dashboard });

function Dashboard() {
  const stats = useQuery({ queryKey: ['stats'], queryFn: api.stats });
  const selections = useQuery({ queryKey: ['selections'], queryFn: api.selections });
  const runs = useQuery({ queryKey: ['runs'], queryFn: api.runs });

  if (stats.isPending) return <Loading />;
  if (stats.isError) return <ErrorBox error={stats.error} />;

  const s = stats.data;
  const toScore = (s.byStatus.new ?? 0) + (s.byStatus.enriched ?? 0);
  const latestSelections = (selections.data ?? []).slice(0, 5);
  const latestRuns = (runs.data ?? []).slice(0, 6);

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Panoramica del Lead Engine: contatti estratti, selezioni giornaliere e ultime estrazioni."
      />

      {s.total === 0 ? (
        <Card>
          <EmptyState
            title="Il database è vuoto"
            hint={
              <>
                Esegui <code className="rounded bg-slate-100 px-1 py-0.5">npm run pipeline -- --daily</code> per la
                prima estrazione, oppure <code className="rounded bg-slate-100 px-1 py-0.5">npm run seed:demo</code>{' '}
                per provare l'interfaccia con dati demo.
              </>
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Contatti totali" value={s.total} hint={`${s.withEmail} con email`} />
            <StatCard
              label="Per bucket"
              value={`${s.byBucket.freelance ?? 0} / ${s.byBucket.azienda ?? 0}`}
              hint="freelance / azienda"
            />
            <StatCard label="Da valutare" value={toScore} hint={`${s.byStatus.scored ?? 0} valutati in attesa`} />
            <StatCard
              label="Selezioni"
              value={s.selectionsCount}
              hint={s.lastRunDate ? `ultima estrazione ${fmtDateShort(s.lastRunDate)}` : 'nessuna estrazione'}
            />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card
              title="Ultime selezioni"
              actions={
                <Link to="/selections" className="text-xs font-medium text-slate-500 hover:text-slate-900">
                  Vedi tutte →
                </Link>
              }
            >
              {latestSelections.length === 0 ? (
                <EmptyState title="Nessuna selezione" hint="Le selezioni vengono create dal run giornaliero." />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {latestSelections.map((sel) => (
                    <li key={sel.date} className="flex items-center justify-between px-4 py-3">
                      <div>
                        <p className="text-sm font-medium">{fmtDateShort(sel.date)}</p>
                        <p className="text-xs text-slate-500">
                          {sel.freelance} freelance · {sel.azienda} azienda
                        </p>
                      </div>
                      <Link to="/selections/$date" params={{ date: sel.date }} className={btn.ghost}>
                        Apri
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card
              title="Ultime estrazioni"
              actions={
                <Link to="/runs" className="text-xs font-medium text-slate-500 hover:text-slate-900">
                  Vedi tutte →
                </Link>
              }
            >
              {latestRuns.length === 0 ? (
                <EmptyState title="Nessun run registrato" />
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className={th}>Data</th>
                      <th className={th}>Strategia</th>
                      <th className={`${th} text-right`}>Estratti</th>
                      <th className={`${th} text-right`}>Nuovi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {latestRuns.map((r) => (
                      <tr key={r.id}>
                        <td className={`${td} whitespace-nowrap text-slate-500`}>{fmtDateShort(r.run_date)}</td>
                        <td className={`${td} font-medium`}>{r.strategy}</td>
                        <td className={`${td} text-right tabular-nums`}>{r.items_in}</td>
                        <td className={`${td} text-right tabular-nums`}>{r.items_new}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
