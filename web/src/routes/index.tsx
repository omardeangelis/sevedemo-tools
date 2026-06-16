import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { fmtDateShort, fmtDateTime } from '../lib/format';
import { useEraseData, usePipelineStatus, useStartPipeline } from '../lib/pipeline';
import {
  btn,
  Card,
  EmptyState,
  ErrorBox,
  inputCls,
  Loading,
  Modal,
  PageHeader,
  pushToast,
  Spinner,
  StatCard,
  td,
  th,
} from '../components/ui';

export const Route = createFileRoute('/')({ component: Dashboard });

function DangerZoneCard() {
  const { data: status } = usePipelineStatus();
  const erase = useEraseData();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const running = status?.state === 'running';

  const close = () => {
    setOpen(false);
    setConfirmText('');
  };

  return (
    <Card title="Zona pericolosa" className="mt-6 border-red-200">
      <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4">
        <p className="max-w-xl text-sm text-slate-600">
          L'erase cancella <strong>tutti i dati prodotti</strong>: contatti, selezioni
          giornaliere, storico run, outcomes, cursori di rotazione delle query e i file in{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5">exports/</code>. I seed di
          configurazione (query, influencer, job URLs) non vengono toccati. L'azione è{' '}
          <strong>irreversibile</strong>.
        </p>
        <div className="text-right">
          <button
            type="button"
            className={btn.dangerSolid}
            disabled={running || erase.isPending}
            onClick={() => {
              setConfirmText('');
              setOpen(true);
            }}
          >
            Azzera tutti i dati
          </button>
          {running && (
            <p className="mt-1 text-xs text-slate-400">Disabilitato: un run è in corso.</p>
          )}
          {erase.isError && <p className="mt-1 text-xs text-red-600">{erase.error.message}</p>}
        </div>
      </div>

      <Modal
        open={open}
        onClose={close}
        title="Azzerare tutti i dati?"
        footer={
          <>
            <button type="button" className={btn.ghost} onClick={close}>
              Annulla
            </button>
            <button
              type="button"
              className={btn.dangerSolid}
              disabled={confirmText !== 'ERASE'}
              onClick={() => {
                close();
                erase.mutate(undefined, {
                  onSuccess: (r) =>
                    pushToast({
                      kind: 'success',
                      title: 'Dati azzerati',
                      description: `Cancellati ${r.contacts} contatti, ${r.runs} run, ${r.selections} selezioni, ${r.outcomes} outcomes e ${r.exportFiles} file export.`,
                    }),
                });
              }}
            >
              Cancella tutto
            </button>
          </>
        }
      >
        <p>
          Questa azione è <strong>irreversibile</strong>: il prossimo run daily ripartirà da zero,
          inclusa la rotazione delle query.
        </p>
        <label className="mt-3 block">
          <span className="text-xs font-medium text-slate-500">
            Scrivi <code className="rounded bg-slate-100 px-1 py-0.5">ERASE</code> per confermare
          </span>
          <input
            className={`${inputCls} mt-1`}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="ERASE"
            autoFocus
          />
        </label>
      </Modal>
    </Card>
  );
}

function PipelineCard() {
  const { data: status } = usePipelineStatus();
  const start = useStartPipeline();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const running = status?.state === 'running';

  return (
    <Card title="Pipeline" className="mb-6">
      <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4">
        <div className="text-sm">
          {!status || status.state === 'idle' ? (
            <p className="text-slate-500">Nessun run registrato: avvia il primo run daily da qui.</p>
          ) : running ? (
            <p className="flex items-center gap-2 text-slate-700">
              <Spinner className="size-4 border-amber-300 border-t-amber-600" />
              Run in corso, avviato il {fmtDateTime(status.started_at ?? null)}. Durata tipica:
              alcuni minuti.
            </p>
          ) : status.state === 'succeeded' ? (
            <>
              <p className="font-medium text-emerald-700">Ultimo run completato.</p>
              <p className="mt-0.5 text-slate-500">
                Finito il {fmtDateTime(status.finished_at ?? null)}.{' '}
                {status.run_date && (
                  <Link
                    to="/selections/$date"
                    params={{ date: status.run_date }}
                    className="font-medium text-slate-900 underline"
                  >
                    Apri la selezione del giorno →
                  </Link>
                )}
              </p>
            </>
          ) : (
            <>
              <p className="font-medium text-red-700">Ultimo run fallito.</p>
              <p className="mt-0.5 max-w-xl text-red-600">{status.error ?? 'Errore sconosciuto.'}</p>
              <p className="mt-0.5 text-slate-500">
                Finito il {fmtDateTime(status.finished_at ?? null)}.
              </p>
            </>
          )}
          {start.isError && (
            <p className="mt-1 text-red-600">{start.error.message}</p>
          )}
        </div>
        <div className="text-right">
          <button
            type="button"
            className={btn.primary}
            disabled={running || start.isPending}
            onClick={() => setConfirmOpen(true)}
          >
            Avvia run daily
          </button>
          {running && (
            <p className="mt-1 text-xs text-slate-400">Disabilitato: un run è già in corso.</p>
          )}
        </div>
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Avviare il run daily?"
        footer={
          <>
            <button type="button" className={btn.ghost} onClick={() => setConfirmOpen(false)}>
              Annulla
            </button>
            <button
              type="button"
              className={btn.primary}
              onClick={() => {
                setConfirmOpen(false);
                start.mutate();
              }}
            >
              Avvia il run
            </button>
          </>
        }
      >
        Il run estrae, valuta e seleziona nuovi contatti: dura alcuni minuti e consuma{' '}
        <strong>~2 $ di credito Apify</strong> più chiamate LLM. L'avvio è una scelta deliberata:
        confermi?
      </Modal>
    </Card>
  );
}

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

      <PipelineCard />

      {s.total === 0 ? (
        <Card>
          <EmptyState
            title="Il database è vuoto"
            hint={
              <>
                Usa il bottone <strong>«Avvia run daily»</strong> qui sopra per la prima
                estrazione, oppure esegui{' '}
                <code className="rounded bg-slate-100 px-1 py-0.5">npm run seed:demo</code> per
                provare l'interfaccia con dati demo.
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
                      <th className={th}>Strategie</th>
                      <th className={`${th} text-right`}>Estratti</th>
                      <th className={`${th} text-right`}>Nuovi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {latestRuns.map((r) => (
                      <tr key={r.run_id ?? `date:${r.run_date}`}>
                        <td className={`${td} whitespace-nowrap text-slate-500`}>{fmtDateShort(r.run_date)}</td>
                        <td className={`${td} font-medium`}>{r.strategies.join(', ') || '—'}</td>
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

      <DangerZoneCard />
    </>
  );
}
