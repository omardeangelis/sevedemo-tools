import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { api } from '../api/client';
import type { Job, JobPreview } from '../api/types';
import { useJobPreview, useJobStart } from '../lib/jobs';
import { JobPreviewDialog } from './JobPreviewDialog';

/*
 * Barra delle azioni bulk (crm-foundation T15, FLOW C.2–C.3, E.1) e dialog dei job bulk che apre:
 * "Arricchisci…" (`EnrichDialog`). L'analisi vive in `IcpPickerDialog.tsx` (serve la scelta dell'ICP).
 */

export interface BulkBarProps {
  /** Numero di prospect selezionati (anche fuori dalla pagina visibile). */
  count: number;
  /** "Deseleziona": azzera la selezione. */
  onClear: () => void;
  /** Azioni (bottoni) sulla selezione. */
  children: ReactNode;
  /** Riga informativa sotto le azioni (es. cap dei 500 raggiunto). */
  notice?: ReactNode;
  /** Nome accessibile della regione (default "Azioni sui selezionati"). */
  label?: string;
}

/**
 * Barra delle azioni sulla selezione, fissa in basso finché c'è almeno un selezionato. Va montata
 * **sempre**: il contatore "N selezionati" è una live region che esiste anche a selezione vuota, così
 * lo screen reader annuncia ogni cambio (FLOW "Accessibilità").
 *
 * @example
 * <BulkBar count={selected.size} onClear={() => setSelected(new Set())}>
 *   <Button onClick={openAddToList}>Aggiungi a lista</Button>
 * </BulkBar>
 */
export function BulkBar({ count, onClear, children, notice, label = 'Azioni sui selezionati' }: BulkBarProps) {
  const active = count > 0;
  return (
    <div
      role="region"
      aria-label={label}
      className={
        active
          ? 'sticky bottom-4 z-30 mt-4 flex flex-col gap-1 rounded-xl border border-slate-300 bg-white px-4 py-2.5 shadow-lg'
          : 'sr-only'
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <p role="status" aria-live="polite" className="text-sm font-semibold text-slate-900 tabular-nums">
          {active ? `${count.toLocaleString('it-IT')} ${count === 1 ? 'selezionato' : 'selezionati'}` : ''}
        </p>
        {active && (
          <>
            <Button type="button" variant="ghost" size="sm" onClick={onClear}>
              Deseleziona
            </Button>
            <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden="true" />
            <div className="flex flex-wrap items-center gap-2">{children}</div>
          </>
        )}
      </div>
      {active && notice && <p className="text-xs text-slate-600">{notice}</p>}
    </div>
  );
}

/**
 * Props per `DialogContent` di Radix che restituiscono il focus al bottone che ha aperto il dialog
 * (senza `DialogTrigger` Radix lo manderebbe a `body`; FLOW "Accessibilità": restore focus).
 */
export function useDialogFocusReturn() {
  const target = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => {
      target.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    },
    onCloseAutoFocus: (event: Event) => {
      const el = target.current;
      if (el?.isConnected && el !== document.body) {
        event.preventDefault();
        el.focus();
      }
    },
  };
}

/** Parti di un riepilogo separate da " · " (le vuote si saltano). */
export function joinParts(parts: Array<string | false | null | undefined>): string {
  return parts.filter((p): p is string => typeof p === 'string' && p !== '').join(' · ');
}

const n = (value: number | undefined) => (value ?? 0).toLocaleString('it-IT');

/** Ambito di un job bulk: selezione di prospect o intera lista. */
export type BulkJobScope = { prospectIds: number[] } | { listId: number };

export interface EnrichDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: BulkJobScope;
  /** Sottotitolo (es. "Lista filtrata: …"). */
  description?: ReactNode;
  onStarted?: (job: Job) => void;
}

/**
 * "Arricchisci…" (FLOW E.2, C.3): `JobPreviewDialog` alimentato da `GET /api/enrich/preview` con
 * "Riprova anche quelli senza risultato" (`retryFailed`). Selezione → `POST /api/enrich`, lista →
 * `POST /api/lists/:id/enrich` (solo i mancanti). L'esito arriva dal `JobBanner`.
 */
export function EnrichDialog({ open, onOpenChange, scope, description, onStarted }: EnrichDialogProps) {
  const [retryFailed, setRetryFailed] = useState(false);
  useEffect(() => {
    if (open) setRetryFailed(false);
  }, [open]);

  const isList = 'listId' in scope;
  const preview = useJobPreview('enrich', { ...scope, retryFailed }, { enabled: open });
  const start = useJobStart(
    () =>
      'listId' in scope
        ? api.enrich.startList(scope.listId, { onlyMissing: true, retryFailed })
        : api.enrich.startSelection(scope.prospectIds, { retryFailed }),
    {
      onStarted: (job) => {
        onOpenChange(false);
        onStarted?.(job);
      },
    },
  );

  return (
    <JobPreviewDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Arricchisci profili"
      description={description ?? 'Legge about, esperienze ed email dal profilo LinkedIn di ogni persona.'}
      preview={preview}
      summary={(data: JobPreview) => {
        const c = data.counts;
        return (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {joinParts([
              `${n(c.selected)} ${isList ? 'nella lista' : c.selected === 1 ? 'selezionato' : 'selezionati'}`,
              `${n(c.targets)} da arricchire`,
              (c.skipped_enriched ?? 0) > 0 && `${n(c.skipped_enriched)} già arricchiti (saltati)`,
              (c.skipped_fresh ?? 0) > 0 && `${n(c.skipped_fresh)} tentati di recente senza risultato (saltati)`,
              (c.not_found ?? 0) > 0 && `${n(c.not_found)} non più presenti`,
            ])}
          </p>
        );
      }}
      startLabel="Avvia arricchimento"
      starting={start.isPending}
      onStart={() => start.mutate()}
    >
      <label className="flex items-start gap-2 text-sm">
        <Checkbox checked={retryFailed} onCheckedChange={(v) => setRetryFailed(v === true)} className="mt-0.5" />
        <span>
          <span className="font-medium text-slate-900">Riprova anche quelli senza risultato</span>
          <span className="block text-slate-500">Include i profili già tentati di recente che non hanno restituito dati: costa di nuovo.</span>
        </span>
      </label>
    </JobPreviewDialog>
  );
}
