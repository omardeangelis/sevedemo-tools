import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { api, isApiError, queryKeys } from '../api/client';
import type { RunDetail } from '../api/types';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { RETRY_HINT, RetryPreviewDialog } from '../components/RetryPreviewDialog';
import { RunLog } from '../components/runs/RunLog';
import { RunParams } from '../components/runs/RunParams';
import { Outcome, countLabel, runDurationText, runStartText, toolNames } from '../components/runs/parts';
import { LoadError } from '../components/settings/parts';
import { Card, Loading } from '../components/ui';
import { toast } from '../components/ui/toaster';
import { useToday } from '../lib/dates';
import { fmtDateTime } from '../lib/format';
import { describeJobError } from '../lib/jobs';

/*
 * Dettaglio di un run (people-first-crm J7, J12, FLOW G.4–G.6): parametri leggibili, tempi, esito con
 * riassunto, conteggi e warning, errore con la sua attribuzione (*"Conta come fallito per: …"*) e il log,
 * che a run in corso si aggiorna da solo. Su un run fallito **Riprova…** apre la preview con gli stessi
 * parametri: il job riparte solo da "Avvia" (nessuna spesa senza preview).
 */

export const Route = createFileRoute('/settings/connections/runs/$runId')({ component: RunPage });

const RUN_POLL_MS = 2_000;

function RunPage() {
  const { runId } = Route.useParams();
  const id = Number(runId);
  const [retryOpen, setRetryOpen] = useState(false);
  const today = useToday();
  const queryClient = useQueryClient();

  const run = useQuery({
    queryKey: queryKeys.run(id),
    queryFn: () => api.runs.get(id),
    retry: false,
    refetchInterval: (query) => (query.state.data?.state === 'running' ? RUN_POLL_MS : false),
  });

  if (run.isPending) return <Loading />;
  if (run.error) {
    if (isApiError(run.error) && run.error.status === 404) return <RunNotFound />;
    return <LoadError error={run.error} onRetry={() => void run.refetch()} />;
  }

  const data = run.data;
  const running = data.state === 'running';
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs
        items={[
          { label: 'Impostazioni', to: '/settings/profile' },
          { label: 'Connessioni', to: '/settings/connections' },
          { label: `${data.operation} · ${runStartText(data.started_at, today)}` },
        ]}
      />
      <Card
        title={`${data.operation} · ${runStartText(data.started_at, today)}`}
        actions={
          <div className="flex items-center gap-2">
            {/* `role="status"`: il passaggio "In corso" → "Completato" va annunciato senza ricaricare. */}
            <Outcome outcome={data.outcome} role="status" />
            {data.state === 'failed' && data.detached === 0 && (
              <Button type="button" variant="outline" size="sm" title={RETRY_HINT} onClick={() => setRetryOpen(true)}>
                Riprova…
              </Button>
            )}
          </div>
        }
      >
        <dl className="divide-y divide-slate-100">
          <Row label="Parametri">
            <RunParams kind={data.kind} params={data.params} />
          </Row>
          <Row label="Tempi">
            <p className="text-sm text-slate-700">
              Avvio {data.started_at ? <time dateTime={data.started_at}>{fmtDateTime(data.started_at)}</time> : '—'}
              {data.finished_at && (
                <>
                  {' · fine '}
                  <time dateTime={data.finished_at}>{fmtDateTime(data.finished_at)}</time>
                </>
              )}
              {' · durata '}
              {running ? 'in corso' : runDurationText(data.duration_ms)}
            </p>
          </Row>
          <Row label="Esito">
            <Result data={data} />
          </Row>
          {/* Run riuscito con una fonte fallita (own-profile-services P-26): conta come fallito per il suo strumento. */}
          {!data.error && data.failed_tools.length > 0 && (
            <Row label="Non riuscito per">
              <ul className="flex flex-col gap-1 text-sm text-red-900">
                {data.failed_tools.map((tool) => (
                  <li key={tool}>
                    {toolNames([tool])}: {describeJobError(data.tool_errors[tool] ?? null).message}
                  </li>
                ))}
              </ul>
            </Row>
          )}
          {data.error && (
            <Row label="Errore">
              <p className="text-sm text-red-900">{data.error}</p>
              {/* J13: un'analisi singola non si riprova da qui, si rilancia dalla scheda della persona. */}
              {data.detached === 1 && <RelaunchFromPerson params={data.params} />}
              <p className="mt-1 text-sm text-slate-600">
                {data.failed_tools.length === data.tools.length && data.tools.length > 1
                  ? `L'errore non nomina uno strumento: conta per ${toolNames(data.failed_tools)}`
                  : `Conta come fallito per: ${toolNames(data.failed_tools, ', ') || '—'}`}
              </p>
            </Row>
          )}
        </dl>
      </Card>
      <Card title="Log">
        {/* `key`: passando da un run all'altro senza ricaricare, le righe già viste non devono mescolarsi. */}
        <RunLog key={id} runId={id} running={running} logged={data.logged} />
      </Card>
      {/* Sempre montato: smontarlo alla chiusura toglierebbe a Radix il focus da restituire a "Riprova…". */}
      {data.state === 'failed' && data.detached === 0 && (
        <RetryPreviewDialog
          job={data}
          open={retryOpen}
          onOpenChange={setRetryOpen}
          onStarted={(started) => {
            toast({ tone: 'neutral', title: `${data.operation} riavviato`, description: `Nuovo run #${started.id} con gli stessi parametri.` });
            void queryClient.invalidateQueries({ queryKey: queryKeys.runs });
          }}
        />
      )}
    </div>
  );
}

/** J13: dove si rilancia un'analisi singola fallita (dalla scheda, come sempre). */
function RelaunchFromPerson({ params }: { params: Record<string, unknown> }) {
  const ids = params.prospectIds;
  const personId = Array.isArray(ids) && typeof ids[0] === 'number' ? ids[0] : null;
  const person = useQuery({
    queryKey: queryKeys.prospect(personId ?? 0),
    queryFn: () => api.prospects.get(personId!),
    enabled: personId !== null,
    retry: false,
  });
  return (
    <p className="mt-1 text-sm text-slate-700">
      Le analisi singole si rilanciano dalla scheda della persona.{' '}
      {personId !== null && (
        <Link to="/people/$id" params={{ id: String(personId) }} className="font-medium text-slate-900 underline underline-offset-2">
          Apri la scheda di {person.data?.full_name ?? 'questa persona'}
        </Link>
      )}
    </p>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:gap-4">
      <dt className="w-28 shrink-0 text-xs font-semibold tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}

function Result({ data }: { data: RunDetail }) {
  if (data.state === 'running') return <p className="text-sm text-slate-600">Il run è ancora in corso.</p>;
  if (!data.result) return <p className="text-sm text-slate-600">Nessun esito salvato: il run non è arrivato in fondo.</p>;
  const counts = Object.entries(data.result.counts ?? {}).filter(([, v]) => v !== 0);
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm text-slate-800">{data.result.summary}</p>
      {counts.length > 0 && (
        <p className="text-xs text-slate-600">{counts.map(([key, value]) => `${countLabel(key)}: ${value}`).join(' · ')}</p>
      )}
      {(data.result.warnings ?? []).map((warning, i) => (
        <p key={i} className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {warning}
        </p>
      ))}
    </div>
  );
}

function RunNotFound() {
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs
        items={[{ label: 'Impostazioni', to: '/settings/profile' }, { label: 'Connessioni', to: '/settings/connections' }, { label: 'Run' }]}
      />
      <Card title="Run non trovato">
        <div className="flex flex-col items-start gap-3 px-4 py-4 text-sm">
          <p className="text-slate-600">Questo run non esiste (o è stato cancellato con i suoi dati).</p>
          <Link to="/settings/connections" className="font-medium text-slate-900 underline underline-offset-2">
            Vai a Connessioni
          </Link>
        </div>
      </Card>
    </div>
  );
}
