import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { api, csvUrl } from '../api/client';
import { fmtDate } from '../lib/format';
import { btn, Card, EmptyState, ErrorBox, Loading, PageHeader } from '../components/ui';

export const Route = createFileRoute('/selections/')({ component: SelectionsPage });

function SelectionsPage() {
  const selections = useQuery({ queryKey: ['selections'], queryFn: api.selections });

  if (selections.isPending) return <Loading />;
  if (selections.isError) return <ErrorBox error={selections.error} />;

  return (
    <>
      <PageHeader
        title="Selezioni giornaliere"
        subtitle="Le liste di contatti scelte da ogni run. Apri una selezione per modificarla prima dell'export."
      />

      {selections.data.length === 0 ? (
        <Card>
          <EmptyState
            title="Nessuna selezione"
            hint={
              <>
                Le selezioni vengono create dal run giornaliero:{' '}
                <code className="rounded bg-slate-100 px-1 py-0.5">npm run pipeline -- --daily</code>
              </>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {selections.data.map((sel) => (
            <Card key={sel.date} className="flex flex-col">
              <div className="flex flex-1 flex-col gap-3 p-5">
                <p className="text-base font-semibold capitalize text-slate-900">{fmtDate(sel.date)}</p>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="inline-flex items-center rounded-full bg-sky-50 px-2.5 py-1 font-medium text-sky-700">
                    {sel.freelance} freelance
                  </span>
                  <span className="inline-flex items-center rounded-full bg-violet-50 px-2.5 py-1 font-medium text-violet-700">
                    {sel.azienda} azienda
                  </span>
                </div>
                <div className="mt-auto flex items-center gap-2 pt-2">
                  <Link to="/selections/$date" params={{ date: sel.date }} className={btn.primary}>
                    Apri
                  </Link>
                  <a href={csvUrl(sel.date)} download className={btn.ghost}>
                    CSV
                  </a>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
