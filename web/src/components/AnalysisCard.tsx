import { useId } from 'react';
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CopyIcon, SparklesIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { api, isApiError, queryKeys } from '../api/client';
import type { AnalysisAngle, FitLevel } from '../api/types';
import { fmtDateTime } from '../lib/format';
import { invalidateProspectViews } from './StatusSelect';
import { ErrorBox, Spinner } from './ui';
import { toast } from './ui/toaster';

const FIT_STYLES: Record<FitLevel, string> = {
  alto: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  medio: 'bg-amber-100 text-amber-900 ring-amber-200',
  basso: 'bg-slate-100 text-slate-700 ring-slate-200',
};

/** Testo FLOW (Error paths) per l'analisi non possibile: profilo senza dati dopo l'arricchimento. */
const NOT_ENRICHABLE_TEXT =
  'Profilo senza dati pubblici: analisi non possibile. Puoi compilare a mano About/ruolo e riprovare.';

export interface AnalysisCardProps {
  prospectId: number;
  /** ICP per cui si mostra l'analisi (`null` = nessun ICP esiste ancora). */
  icpId: number | null;
  /** ICP selezionabili (tutti quelli esistenti): il selettore compare con più di uno. */
  icpOptions: Array<{ id: number; name: string; analyzed: boolean }>;
  onIcpChange: (icpId: number) => void;
}

/** Chiave della mutation: condivisa con `useIsMutating`, così lo stato "in corso" sopravvive a un cambio pagina. */
const analyzeKey = (prospectId: number, icpId: number | null) => ['prospects', 'analyze-one', prospectId, icpId] as const;

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast({ tone: 'neutral', title: 'Copiato', description: what });
  } catch {
    toast({ tone: 'error', title: 'Copia non riuscita', description: 'Il browser non consente di scrivere negli appunti.' });
  }
}

/**
 * Analisi AI del prospect per l'ICP corrente (FLOW F.4, E/H, Error paths): dati da `GET
 * /api/prospects/:id/analyses?icpId=` (unico punto che calcola `stale`). Riassunto e 3 angoli con
 * **Copia**, fit con testo, badge "da aggiornare" se il profilo è cambiato dopo l'analisi. Azione unica:
 * "Analizza" / "Rianalizza" / "Riprova", oppure **"Arricchisci e analizza"** se il profilo non ha dati
 * (`enrichFirst`: una sola chiamata sincrona, fino a ~3 min). Durante l'attesa `aria-busy` e testo
 * esplicito; la pagina resta navigabile e al ritorno la card mostra l'esito. Errori (rifiuto, risposta
 * non valida, profilo senza dati) in un avviso con il testo del server, senza angoli.
 */
export function AnalysisCard({ prospectId, icpId, icpOptions, onIcpChange }: AnalysisCardProps) {
  const uid = useId();
  const queryClient = useQueryClient();
  const analyses = useQuery({
    queryKey: queryKeys.analyses(prospectId, icpId ?? 0),
    queryFn: () => api.analyze.ofProspect(prospectId, icpId!),
    enabled: icpId !== null,
  });

  const mutationKey = analyzeKey(prospectId, icpId);
  const run = useMutation({
    mutationKey,
    mutationFn: (body: { force?: boolean; enrichFirst?: boolean }) => api.analyze.one(prospectId, { icpId: icpId!, ...body }),
    // Nelle opzioni (non in `mutate`): vale anche se nel frattempo la pagina è cambiata.
    onSettled: () => invalidateProspectViews(queryClient),
  });
  const running = useIsMutating({ mutationKey }) > 0;

  if (icpId === null) {
    return (
      <p className="text-sm text-slate-600">
        Crea prima un ICP: l'analisi calcola il fit rispetto a un ICP.{' '}
        <Link to={'/icps' as never} className="font-medium text-slate-900 underline">
          Crea ICP
        </Link>
      </p>
    );
  }

  const data = analyses.data;
  const latest = data?.latest ?? null;
  const enrichFirst = data ? !data.analyzable : false;
  // L'errore della richiesta appena fatta vince; dopo un reload resta l'ultimo fallimento salvato.
  // "Profilo senza dati" decade appena il profilo ha dati (About compilato a mano: recupero FLOW).
  const recovered = data?.analyzable === true && (isApiError(run.error, 'not_enrichable') || isApiError(run.error, 'not_enriched'));
  const requestError = !running && !recovered && run.error instanceof Error ? run.error.message : null;
  const savedError =
    data?.last_error?.message ?? (data && !data.analyzable && data.state === 'non_arricchibile' ? NOT_ENRICHABLE_TEXT : null);
  const errorText = requestError ?? savedError;

  const actionLabel = enrichFirst ? 'Arricchisci e analizza' : latest ? 'Rianalizza' : errorText ? 'Riprova' : 'Analizza';
  const start = () => {
    run.reset();
    run.mutate(enrichFirst ? { enrichFirst: true } : latest ? { force: true } : {});
  };

  return (
    <div className="flex flex-col gap-4" aria-busy={running || analyses.isFetching}>
      {icpOptions.length > 1 && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-icp`} className="text-xs font-medium text-slate-600">
            Analisi per l'ICP
          </label>
          <select
            id={`${uid}-icp`}
            value={icpId}
            onChange={(e) => {
              run.reset();
              onIcpChange(Number(e.target.value));
            }}
            className="h-8 rounded-lg border border-input bg-white px-2 text-sm"
          >
            {icpOptions.map((icp) => (
              <option key={icp.id} value={icp.id}>
                {icp.name}
                {icp.analyzed ? ' · analizzato' : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {analyses.isPending ? (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="size-4 border-slate-300 border-t-slate-600" />
          Caricamento analisi…
        </p>
      ) : analyses.error ? (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Impossibile caricare l'analisi: {analyses.error instanceof Error ? analyses.error.message : 'errore inatteso.'}
          <Button type="button" variant="outline" size="sm" className="ml-2" onClick={() => void analyses.refetch()}>
            Riprova
          </Button>
        </div>
      ) : (
        <>
          {errorText && (
            <div role="alert">
              <ErrorBox error={new Error(errorText)} />
            </div>
          )}

          {latest ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset',
                    FIT_STYLES[latest.fit],
                  )}
                >
                  Fit {latest.fit}
                </span>
                {data?.stale && (
                  <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900 ring-1 ring-amber-300 ring-inset">
                    da aggiornare
                  </span>
                )}
                <span className="text-xs text-slate-500">
                  {latest.model} · {fmtDateTime(latest.created_at)}
                </span>
              </div>
              {data?.stale && <p className="text-sm text-amber-900">Il profilo è cambiato dopo l'analisi.</p>}
              {latest.fit_reason && <p className="text-sm text-slate-700">{latest.fit_reason}</p>}

              <section aria-labelledby={`${uid}-summary`} className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <h4 id={`${uid}-summary`} className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                    Riassunto
                  </h4>
                  <CopyButton label="Copia riassunto" onCopy={() => copy(latest.summary, 'Riassunto negli appunti.')} />
                </div>
                <p className="text-sm whitespace-pre-wrap text-slate-800">{latest.summary}</p>
              </section>

              <section aria-labelledby={`${uid}-angles`} className="flex flex-col gap-2">
                <h4 id={`${uid}-angles`} className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  Angoli di apertura
                </h4>
                <ol className="flex flex-col gap-2">
                  {latest.angles.map((angle, i) => (
                    <AngleItem key={i} n={i + 1} angle={angle} />
                  ))}
                </ol>
              </section>
            </div>
          ) : (
            !errorText && <p className="text-sm text-slate-500">Nessuna analisi per questo ICP.</p>
          )}

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant={latest && !data?.stale ? 'outline' : 'default'}
                onClick={start}
                disabled={running}
                aria-busy={running}
                aria-describedby={`${uid}-hint`}
              >
                {running ? <Spinner className="size-3.5 border-current border-t-transparent" /> : <SparklesIcon aria-hidden="true" />}
                {running ? 'Sto analizzando…' : actionLabel}
              </Button>
            </div>
            <p id={`${uid}-hint`} role="status" className="text-xs text-slate-500">
              {running
                ? "Analisi in corso… può richiedere fino a un minuto, fino a tre se serve anche l'arricchimento. Puoi continuare a usare la pagina."
                : enrichFirst
                  ? 'Il profilo non ha dati: prima lo arricchisce (costo del profilo) e poi lo analizza (≈ $0,03).'
                  : latest
                    ? 'Rianalizza anche con gli stessi dati (≈ $0,03).'
                    : 'Riassunto, 3 angoli di apertura e fit rispetto all\'ICP (≈ $0,03).'}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function AngleItem({ n, angle }: { n: number; angle: AnalysisAngle }) {
  return (
    <li className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-slate-900">
          <span className="text-slate-500">{n}.</span> {angle.title}
        </p>
        <CopyButton label={`Copia angolo ${n}`} onCopy={() => copy(`${angle.title}\n${angle.rationale}`, `Angolo ${n} negli appunti.`)} />
      </div>
      <p className="mt-0.5 text-sm text-slate-700">{angle.rationale}</p>
    </li>
  );
}

function CopyButton({ label, onCopy }: { label: string; onCopy: () => void }) {
  return (
    <Button type="button" variant="ghost" size="xs" aria-label={label} onClick={onCopy} className="shrink-0 text-slate-500">
      <CopyIcon aria-hidden="true" />
      Copia
    </Button>
  );
}
