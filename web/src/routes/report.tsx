import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client';
import type { StrategyReport, StrategyState } from '../api/types';
import { pct, fmtDateTime } from '../lib/format';
import { Badge, Card, EmptyState, ErrorBox, Loading, PageHeader, btn, cls, td, th } from '../components/ui';

export const Route = createFileRoute('/report')({ component: ReportPage });

/** Soglia sotto la quale mostrare il rapporto n/d invece di una % fuorviante. */
const LOW_VOLUME = 10;

const STATE_META: Record<StrategyState, { label: string; color: 'green' | 'amber' | 'red' | 'gray' }> = {
  ok: { label: 'ok', color: 'green' },
  'clean-0': { label: 'girata, 0 estratti', color: 'amber' },
  'all-duplicates': { label: 'tutti duplicati', color: 'amber' },
  errored: { label: 'errore', color: 'red' },
  'never-ran': { label: 'mai girata', color: 'gray' },
};

function StateBadge({ state }: { state: StrategyState }) {
  const m = STATE_META[state] ?? { label: state, color: 'gray' as const };
  return <Badge color={m.color}>{m.label}</Badge>;
}

/** reply/positive: sotto soglia mostra `n/inviate` (onesto), sopra mostra la %. */
function Rate({ count, sent, rate }: { count: number; sent: number; rate: number }) {
  if (sent === 0) return <span className="text-slate-400">—</span>;
  if (sent < LOW_VOLUME) return <span className="tabular-nums text-slate-500">{count}/{sent}</span>;
  return <span className="tabular-nums text-slate-500">{pct(rate)}</span>;
}

function ReportPage() {
  const [detail, setDetail] = useState(false);
  const report = useQuery({ queryKey: ['report'], queryFn: api.report });
  const breakdown = useQuery({ queryKey: ['report', 'detail'], queryFn: api.reportDetail, enabled: detail });

  if (report.isPending) return <Loading />;
  if (report.isError) return <ErrorBox error={report.error} />;

  const rows = report.data;
  const noOutcomes = rows.length > 0 && rows.every((r) => r.sent === 0);

  return (
    <>
      <PageHeader
        title="Report strategie"
        subtitle="Confronto delle strategie di estrazione: quante estraggono, quanto finisce in selezione e come performano le email."
        actions={
          <button
            className={cls(detail ? btn.primary : btn.ghost)}
            onClick={() => setDetail((d) => !d)}
          >
            {detail ? 'Vista per strategia' : 'Dettaglio per sotto-fonte'}
          </button>
        }
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title="Nessun dato"
            hint="Esegui qualche estrazione: il report si popola con i contatti e, dopo l'invio, con gli esiti importati via eval:import."
          />
        </Card>
      ) : detail ? (
        <SubSourceTable
          isPending={breakdown.isPending}
          isError={breakdown.isError}
          error={breakdown.error}
          rows={breakdown.data ?? []}
        />
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
                    <th className={th}>Stato</th>
                    <th className={`${th} text-right`}>Estratti</th>
                    <th className={`${th} text-right`}>Sourced</th>
                    <th className={`${th} text-right`}>Nuovi</th>
                    <th className={`${th} text-right`}>Selez.</th>
                    <th className={`${th} text-right`}>Sel%</th>
                    <th className={`${th} text-right`}>Inviate</th>
                    <th className={`${th} text-right`}>Reply</th>
                    <th className={`${th} text-right`}>Reply%</th>
                    <th className={`${th} text-right`}>Positive</th>
                    <th className={`${th} text-right`}>Pos%</th>
                    <th className={th}>Ultimo run</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r: StrategyReport) => (
                    <tr key={r.strategy} className={r.state === 'errored' ? 'bg-red-50/40' : undefined}>
                      <td className={`${td} font-medium`}>{r.strategy}</td>
                      <td className={td}><StateBadge state={r.state} /></td>
                      <td className={`${td} text-right tabular-nums`}>{r.extracted}</td>
                      <td className={`${td} text-right tabular-nums text-slate-500`}>{r.sourced}</td>
                      <td className={`${td} text-right tabular-nums text-slate-500`}>{r.new}</td>
                      <td className={`${td} text-right tabular-nums`}>{r.selected}</td>
                      <td className={`${td} text-right tabular-nums text-slate-500`}>{r.extracted ? pct(r.selected_rate) : '—'}</td>
                      <td className={`${td} text-right tabular-nums`}>{r.sent}</td>
                      <td className={`${td} text-right tabular-nums`}>{r.replied}</td>
                      <td className={`${td} text-right`}><Rate count={r.replied} sent={r.sent} rate={r.reply_rate} /></td>
                      <td className={`${td} text-right tabular-nums`}>{r.positive}</td>
                      <td className={`${td} text-right`}><Rate count={r.positive} sent={r.sent} rate={r.positive_rate} /></td>
                      <td className={`${td} text-slate-500`}>{fmtDateTime(r.last_run)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-400">
              <strong>Stato</strong>: mai girata · girata 0 estratti · tutti duplicati · errore · ok.
              <strong> Sourced</strong> = candidati grezzi visti dalla sorgente, <strong>Nuovi</strong> = quelli persistiti.
              Reply% e positive% sono sulle email inviate; sotto {LOW_VOLUME} invii mostriamo il rapporto n/inviate.
              Sel% è la quota di estratti finiti in una selezione.
            </p>
          </Card>
        </>
      )}
    </>
  );
}

function SubSourceTable(props: {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  rows: import('../api/types').SubSourceReport[];
}) {
  if (props.isPending) return <Loading />;
  if (props.isError) return <ErrorBox error={props.error} />;
  if (props.rows.length === 0) {
    return (
      <Card>
        <EmptyState title="Nessuna sotto-fonte" hint="Le sotto-fonti compaiono quando i contatti hanno un source_detail (commenter / tagged-person / company-expansion)." />
      </Card>
    );
  }
  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              <th className={th}>Strategia</th>
              <th className={th}>Sotto-fonte</th>
              <th className={`${th} text-right`}>Estratti</th>
              <th className={`${th} text-right`}>Selez.</th>
              <th className={`${th} text-right`}>Inviate</th>
              <th className={`${th} text-right`}>Reply</th>
              <th className={`${th} text-right`}>Positive</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {props.rows.map((r) => (
              <tr key={`${r.strategy}::${r.source_detail}`}>
                <td className={`${td} font-medium`}>{r.strategy}</td>
                <td className={td}><Badge color="blue">{r.source_detail}</Badge></td>
                <td className={`${td} text-right tabular-nums`}>{r.extracted}</td>
                <td className={`${td} text-right tabular-nums`}>{r.selected}</td>
                <td className={`${td} text-right tabular-nums`}>{r.sent}</td>
                <td className={`${td} text-right tabular-nums`}>{r.replied}</td>
                <td className={`${td} text-right tabular-nums`}>{r.positive}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-400">
        Drill-down per sotto-fonte all'interno di ciascuna strategia. <code className="rounded bg-slate-100 px-1 py-0.5">(non attribuito)</code> = contatti senza source_detail.
      </p>
    </Card>
  );
}
