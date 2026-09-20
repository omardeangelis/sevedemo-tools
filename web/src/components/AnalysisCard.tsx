import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CopyIcon, SparklesIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { api, errorText, isApiError, queryKeys } from '../api/client';
import { FIT_LEVELS, type AnalysisAngle, type AnalysisState, type FitLevel, type ManualFit } from '../api/types';
import { fmtDateTime } from '../lib/format';
import { ANALYSIS_STATE_LABELS } from './ProspectTable';
import { invalidateProspectViews } from './StatusSelect';
import { ErrorBox, Spinner } from './ui';
import { toast } from './ui/toaster';

const FIT_STYLES: Record<FitLevel, string> = {
  alto: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  medio: 'bg-amber-100 text-amber-900 ring-amber-200',
  basso: 'bg-slate-100 text-slate-700 ring-slate-200',
};

const FIT_OPTION_LABELS: Record<FitLevel, string> = { alto: 'Alto', medio: 'Medio', basso: 'Basso' };

/** Segmento della route del form di un nuovo ICP (`/icps/nuovo`). */
const NEW_ICP = 'nuovo';

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
  /** Analisi non possibile per questa persona (es. senza LinkedIn, E11): bottone disabilitato con il motivo scritto. */
  disabledReason?: string | null;
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
 * Card "Fit e analisi AI" della persona per l'ICP scelto (people-first-crm FLOW E.1–E.2, F1–F9): in testa l'ICP e la
 * riga del fit (*"Tuo: alto · AI: medio"*, "da aggiornare" solo sull'AI), **Imposta / Cambia / Rimuovi il mio
 * fit**; sotto l'analisi AI da `GET /api/prospects/:id/analyses?icpId=` (unico punto che calcola `stale`). Riassunto
 * e 3 angoli con **Copia**, badge "da aggiornare" se il profilo è cambiato dopo l'analisi. Azione unica:
 * "Analizza" / "Rianalizza" / "Riprova", oppure **"Arricchisci e analizza"** se il profilo non ha dati
 * (`enrichFirst`: una sola chiamata sincrona, fino a ~3 min). Durante l'attesa `aria-busy` e testo
 * esplicito; la pagina resta navigabile e al ritorno la card mostra l'esito. Errori (rifiuto, risposta
 * non valida, profilo senza dati) in un avviso con il testo del server, senza angoli.
 */
export function AnalysisCard({ prospectId, icpId, icpOptions, onIcpChange, disabledReason }: AnalysisCardProps) {
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
    // F9: senza ICP il fit non si esprime.
    return (
      <p className="text-sm text-slate-600">
        Il fit si esprime rispetto a un ICP: crea il primo ICP per impostarlo.{' '}
        <Link to="/icps/$id" params={{ id: NEW_ICP }} className="font-medium text-slate-900 underline">
          Crea ICP
        </Link>
      </p>
    );
  }
  const icpName = icpOptions.find((icp) => icp.id === icpId)?.name ?? 'questo ICP';

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
      {icpOptions.length > 1 ? (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-icp`} className="text-xs font-medium text-slate-600">
            ICP
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
      ) : (
        <p className="text-xs font-medium text-slate-600">
          ICP: <span className="text-slate-900">{icpName}</span>
        </p>
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
          <FitRow manual={data?.manual_fit ?? null} ai={data?.state ?? null} stale={Boolean(data?.stale)} />
          <ManualFitControls key={icpId} prospectId={prospectId} icpId={icpId} icpName={icpName} manual={data?.manual_fit ?? null} />

          {errorText && (
            <div role="alert">
              <ErrorBox error={new Error(errorText)} />
            </div>
          )}

          {latest ? (
            <div className="flex flex-col gap-4 border-t border-slate-100 pt-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Analisi AI</span>
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset',
                    FIT_STYLES[latest.fit],
                  )}
                >
                  Fit {latest.fit}
                </span>
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
            !errorText && <p className="text-sm text-slate-500">Nessuna analisi AI per questo ICP.</p>
          )}

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant={latest && !data?.stale ? 'outline' : 'default'}
                onClick={start}
                disabled={running || Boolean(disabledReason)}
                aria-busy={running}
                aria-describedby={`${uid}-hint`}
              >
                {running ? <Spinner className="size-3.5 border-current border-t-transparent" /> : <SparklesIcon aria-hidden="true" />}
                {running ? 'Sto analizzando…' : actionLabel}
              </Button>
            </div>
            <p id={`${uid}-hint`} role="status" className="text-xs text-slate-500">
              {disabledReason
                ? disabledReason
                : running
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

/**
 * Riga del fit per l'ICP (FLOW E.1, F4, F8): *"Non analizzata"* · *"AI: medio"* · *"Tuo: alto · AI: medio"*;
 * "da aggiornare" accompagna solo il fit dell'AI.
 */
function FitRow({ manual, ai, stale }: { manual: ManualFit | null; ai: AnalysisState | null; stale: boolean }) {
  const aiText = ai ? ANALYSIS_STATE_LABELS[ai] : 'non analizzata';
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-slate-800">
      <p>
        {manual ? (
          <>
            <span className="font-semibold">Tuo: {manual.fit}</span> · AI: {aiText}
          </>
        ) : ai ? (
          <>AI: {aiText}</>
        ) : (
          'Non analizzata'
        )}
      </p>
      {stale && (
        <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900 ring-1 ring-amber-300 ring-inset">
          da aggiornare
        </span>
      )}
    </div>
  );
}

/**
 * "Il mio fit" per l'ICP (F1, F6, F7, FLOW E.2): **Imposta il mio fit** / **Cambia il mio fit** aprono un form
 * inline (radiogroup con legend che nomina l'ICP, motivazione facoltativa, **Salva fit**); **Rimuovi il mio fit**
 * senza conferma. Esito con toast; un errore resta accanto al controllo con i valori inseriti (Error paths).
 */
function ManualFitControls({ prospectId, icpId, icpName, manual }: { prospectId: number; icpId: number; icpName: string; manual: ManualFit | null }) {
  const uid = useId();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [fit, setFit] = useState<FitLevel | null>(manual?.fit ?? null);
  const [reason, setReason] = useState(manual?.reason ?? '');
  // Dopo Salva/Rimuovi il focus va sul controllo che resta (Cambia o Imposta), non si perde sul body.
  const focusAfter = useRef(false);
  const primaryRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!editing && focusAfter.current) {
      focusAfter.current = false;
      primaryRef.current?.focus();
    }
  });

  const refresh = () => invalidateProspectViews(queryClient);
  const save = useMutation({
    mutationFn: (body: { fit: FitLevel; reason: string | null }) => api.fits.set(prospectId, icpId, body),
    onSuccess: (result) => {
      toast({ tone: 'neutral', title: `Fit impostato: ${result.manual_fit?.fit ?? fit} (tuo)` });
      focusAfter.current = true;
      setEditing(false);
      void refresh();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.fits.remove(prospectId, icpId),
    onSuccess: () => {
      toast({ tone: 'neutral', title: "Fit rimosso: vale di nuovo l'analisi AI" });
      focusAfter.current = true;
      void refresh();
    },
  });

  const open = () => {
    save.reset();
    remove.reset();
    setFit(manual?.fit ?? null);
    setReason(manual?.reason ?? '');
    setEditing(true);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (fit && !save.isPending) save.mutate({ fit, reason: reason.trim() || null });
  };

  if (editing) {
    return (
      <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3" aria-busy={save.isPending}>
        <fieldset className="flex flex-col gap-2">
          <legend id={`${uid}-legend`} className="mb-1 text-sm font-medium text-slate-900">
            Il tuo fit per '{icpName}'
          </legend>
          <div role="radiogroup" aria-labelledby={`${uid}-legend`} className="flex flex-wrap gap-4">
            {FIT_LEVELS.map((level, i) => (
              <label key={level} className="flex items-center gap-1.5 text-sm text-slate-800">
                <input
                  type="radio"
                  name={`${uid}-fit`}
                  value={level}
                  checked={fit === level}
                  onChange={() => setFit(level)}
                  autoFocus={fit ? fit === level : i === 0}
                  className="size-4 accent-slate-900"
                />
                {FIT_OPTION_LABELS[level]}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-reason`} className="text-xs font-medium text-slate-600">
            Motivazione (facoltativa)
          </label>
          <textarea
            id={`${uid}-reason`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={2000}
            className="rounded-lg border border-input bg-white px-2 py-1.5 text-sm"
          />
        </div>
        {save.error && (
          <p role="alert" className="text-sm text-red-700">
            Fit non salvato: {errorText(save.error)} I valori scelti sono ancora qui.
          </p>
        )}
        <div className="flex gap-2">
          {/* In salvataggio `aria-disabled`, non `disabled`: dopo un errore il focus resta sul bottone. */}
          <Button type="submit" size="sm" disabled={!fit} aria-disabled={save.isPending} aria-busy={save.isPending}>
            {save.isPending ? 'Salvataggio…' : 'Salva fit'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              focusAfter.current = true;
              setEditing(false);
            }}
          >
            Annulla
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {manual?.reason && (
        <p className="text-sm text-slate-700">
          <span className="font-medium">La tua motivazione:</span> {manual.reason}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button ref={primaryRef} type="button" size="sm" variant="outline" onClick={open}>
          {manual ? 'Cambia il mio fit' : 'Imposta il mio fit'}
        </Button>
        {manual && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => !remove.isPending && remove.mutate()}
            aria-disabled={remove.isPending}
            aria-busy={remove.isPending}
          >
            {remove.isPending ? 'Rimozione…' : 'Rimuovi il mio fit'}
          </Button>
        )}
      </div>
      {remove.error && (
        <p role="alert" className="text-sm text-red-700">
          Fit non rimosso: {errorText(remove.error)}
        </p>
      )}
    </div>
  );
}
