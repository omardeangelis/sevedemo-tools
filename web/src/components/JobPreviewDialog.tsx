import { useId, useRef, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { JobPreview } from '../api/types';
import { formatCost } from '../lib/jobs';
import { Spinner } from './ui';

/** Forma minima della query di preview: il risultato di `useJobPreview` va bene così com'è. */
export interface JobPreviewQuery {
  data?: JobPreview;
  isPending: boolean;
  isFetching?: boolean;
  error: unknown;
  refetch: () => unknown;
}

export interface JobPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Titolo del dialog, es. "Sincronizza interazioni". */
  title: string;
  /** Sottotitolo (ambito, ICP, lista…). */
  description?: ReactNode;
  /** Preview del job: tipicamente `useJobPreview(kind, params, {enabled: open})`. */
  preview: JobPreviewQuery;
  /**
   * Etichette dei conteggi da mostrare, nell'ordine (es. `{targets: 'Da arricchire'}`); le chiavi
   * senza etichetta non si mostrano e i conteggi a 0 si nascondono tranne il primo. Senza mappa si
   * mostrano tutti con la chiave grezza. Ignorato se c'è `summary`.
   */
  countLabels?: Record<string, string>;
  /** Sostituisce l'elenco dei conteggi con un testo su misura (es. il riepilogo del sync). */
  summary?: (preview: JobPreview) => ReactNode;
  /** Opzioni del job (spunte, campi) mostrate sopra l'anteprima; cambiarle deve cambiare la preview. */
  children?: ReactNode;
  /** Azioni secondarie a sinistra nel footer (es. "Aggiorna solo l'elenco dei post"). */
  secondaryActions?: ReactNode;
  /** Testo del bottone primario (default "Avvia"). */
  startLabel?: string;
  /** Avvio: di solito `useJobStart(...).mutate(...)`; il dialog lo chiude chi riceve `onStarted`. */
  onStart: () => void;
  /** Avvio in corso (bottone disabilitato con `aria-busy`). */
  starting?: boolean;
}

/**
 * Anteprima uniforme di un job prima dell'avvio (FLOW "Preview obbligatoria", P7): conteggi,
 * costo stimato **o** "stima non disponibile" (mai inventato), avvisi in giallo, blocchi in rosso
 * (`role="alert"`) con **Avvia disabilitato** finché `blockers` non è vuoto. Radix Dialog: focus
 * trap, Escape chiude, focus restituito al bottone che l'ha aperto.
 *
 * @example
 * const preview = useJobPreview('enrich', { listId, onlyMissing: true }, { enabled: open });
 * const start = useJobStart(() => api.enrich.startList(listId, { onlyMissing: true }), { onStarted: () => setOpen(false) });
 * <JobPreviewDialog open={open} onOpenChange={setOpen} title="Arricchisci la lista" preview={preview}
 *   countLabels={{ targets: 'Da arricchire', skipped_enriched: 'Già arricchiti (saltati)' }}
 *   onStart={() => start.mutate()} starting={start.isPending} />
 */
export function JobPreviewDialog(props: JobPreviewDialogProps) {
  const { preview, starting = false } = props;
  const blockersId = useId();
  // Dialog controllato senza `DialogTrigger`: Radix non sa dove restituire il focus alla chiusura,
  // quindi si ricorda l'elemento attivo all'apertura (il bottone che l'ha aperto).
  const returnFocus = useRef<HTMLElement | null>(null);
  const data = preview.data;
  const blocked = (data?.blockers.length ?? 0) > 0;
  const loading = preview.isPending || Boolean(preview.isFetching && !data);
  // Mai avviare su una preview in aggiornamento: riaprendo il dialog i dati vecchi restano visibili finché il refetch non torna.
  const canStart = Boolean(data) && !blocked && !loading && !preview.isFetching && !preview.error && !starting;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg"
        showCloseButton={false}
        onOpenAutoFocus={() => {
          returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(event) => {
          const target = returnFocus.current;
          if (target?.isConnected && target !== document.body) {
            event.preventDefault();
            target.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription>{props.description ?? 'Controlla cosa farà il job e quanto costa prima di avviarlo.'}</DialogDescription>
        </DialogHeader>

        {props.children && <div className="flex flex-col gap-3">{props.children}</div>}

        <section aria-label="Anteprima del job" aria-busy={loading} className="flex flex-col gap-3">
          {loading && (
            <p className="flex items-center gap-2 text-sm text-slate-500">
              <Spinner className="size-4 border-slate-300 border-t-slate-600" />
              Calcolo dell'anteprima…
            </p>
          )}

          {!loading && preview.error != null && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <p>
                Anteprima non disponibile:{' '}
                {preview.error instanceof Error ? preview.error.message : 'errore inatteso.'}
              </p>
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => void preview.refetch()}>
                Riprova
              </Button>
            </div>
          )}

          {!loading && data && !preview.error && (
            <>
              {props.summary ? props.summary(data) : <CountList counts={data.counts} labels={props.countLabels} />}

              <p className="text-sm text-slate-700">
                <span className="font-medium">Costo stimato:</span> {formatCost(data.est_cost_usd)}
                {data.model && <span className="text-slate-500"> · Modello: {data.model}</span>}
              </p>

              {data.warnings.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <p className="font-medium">Attenzione</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {data.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {blocked && (
                <div
                  id={blockersId}
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
                >
                  <p className="font-medium">Il job non può partire:</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {data.blockers.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>

        <DialogFooter className="items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">{props.secondaryActions}</div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Annulla
              </Button>
            </DialogClose>
            <Button
              type="button"
              onClick={props.onStart}
              disabled={!canStart}
              aria-busy={starting}
              aria-describedby={blocked ? blockersId : undefined}
            >
              {starting ? 'Avvio…' : (props.startLabel ?? 'Avvia')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CountList({ counts, labels }: { counts: Record<string, number>; labels?: Record<string, string> }) {
  const entries = labels
    ? Object.entries(labels)
        .filter(([key]) => typeof counts[key] === 'number')
        .map(([key, label], i) => ({ key, label, value: counts[key], always: i === 0 }))
    : Object.entries(counts).map(([key, value], i) => ({ key, label: key, value, always: i === 0 }));
  const visible = entries.filter((e) => e.always || e.value !== 0);
  if (visible.length === 0) return null;
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-sm">
      {visible.map((e) => (
        <div key={e.key} className="contents">
          <dt className="text-slate-600">{e.label}</dt>
          <dd className="text-right font-medium tabular-nums text-slate-900">{e.value.toLocaleString('it-IT')}</dd>
        </div>
      ))}
    </dl>
  );
}
