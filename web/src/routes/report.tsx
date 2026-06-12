import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { pct } from '../lib/format';
import { Card, EmptyState, ErrorBox, Loading, PageHeader, td, th } from '../components/ui';

export const Route = createFileRoute('/report')({ component: ReportPage });

function ReportPage() {
  const report = useQuery({ queryKey: ['report'], queryFn: api.report });

  if (report.isPending) return <Loading />;
  if (report.isError) return <ErrorBox error={report.error} />;

  const rows = report.data;
  const noOutcomes = rows.length > 0 && rows.every((r) => r.sent === 0);

  return (
    <>
      <PageHeader
        title="Report strategie"
        subtitle="Confronto delle strategie di estrazione: quante estraggono, quanto finisce in selezione e come performano le email."
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title="Nessun dato"
            hint="Esegui qualche estrazione: il report si popola con i contatti e, dopo l'invio, con gli esiti importati via eval:import."
          />
        </Card>
      ) : (
        <>
          {noOutcomes && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Nessun esito email importato: reply% e positive% sono a zero. Dopo l'invio, importa il CSV degli esiti
              con <code className="rounded bg-amber-100 px-1 py-0.5">npm run cli -- eval:import &lt;file&gt;</code>.
            </div>
          )}
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className={th}>Strategia</th>
                    <th className={`${th} text-right`}>Estratti</th>
                    <th className={`${th} text-right`}>Selezionati</th>
                    <th className={`${th} text-right`}>Sel%</th>
                    <th className={`${th} text-right`}>Inviate</th>
                    <th className={`${th} text-right`}>Reply</th>
                    <th className={`${th} text-right`}>Reply%</th>
                    <th className={`${th} text-right`}>Positive</th>
                    <th className={`${th} text-right`}>Pos%</th>
                    <th className={`${th} text-right`}>Convertiti</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => (
                    <tr key={r.strategy}>
                      <td className={`${td} font-medium`}>{r.strategy}</td>
                      <td className={`${td} text-right tabular-nums`}>{r.extracted}</td>
                      <td className={`${td} text-right tabular-nums`}>{r.selected}</td>
                      <td className={`${td} text-right tabular-nums text-slate-500`}>{pct(r.selected_rate)}</td>
                      <td className={`${td} text-right tabular-nums`}>{r.sent}</td>
                      <td className={`${td} text-right tabular-nums`}>{r.replied}</td>
                      <td className={`${td} text-right tabular-nums text-slate-500`}>{pct(r.reply_rate)}</td>
                      <td className={`${td} text-right tabular-nums`}>{r.positive}</td>
                      <td className={`${td} text-right tabular-nums text-slate-500`}>{pct(r.positive_rate)}</td>
                      <td className={`${td} text-right tabular-nums`}>{r.converted}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-400">
              Reply% e positive% sono calcolate sulle email inviate. Sel% è la quota di estratti finiti in una
              selezione giornaliera.
            </p>
          </Card>
        </>
      )}
    </>
  );
}
