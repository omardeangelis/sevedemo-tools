import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { api, queryKeys } from '../api/client';
import type { IcpListItem, Job, JobPreview } from '../api/types';
import { fmtCount } from '../lib/format';
import { useJobPreview, useJobStart } from '../lib/jobs';
import { joinParts, useDialogFocusReturn, type BulkJobScope } from './BulkBar';
import { JobPreviewDialog } from './JobPreviewDialog';

/*
 * Analisi AI in bulk (crm-foundation T15, FLOW E.3 e H): scelta dell'ICP (`IcpPickerDialog`, solo se
 * serve) e anteprima con costo (`AnalyzeDialog` → `JobPreviewDialog`).
 */

export interface IcpPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** ICP scelto ("Continua"). */
  onPick: (icp: IcpListItem) => void;
  /** Sottotitolo (default: perché serve scegliere). */
  description?: ReactNode;
  /**
   * Chiamata a dialog chiuso, dopo aver restituito il focus al bottone che l'ha aperto: il dialog
   * successivo (anteprima) va aperto qui, non in `onPick`, altrimenti il focus che torna fuori dal
   * nuovo dialog modale lo farebbe chiudere subito.
   */
  onClosed?: () => void;
}

/**
 * "Per quale ICP?" (FLOW H.1): radio con nome + una riga di descrizione, **nessun default** (il fit
 * dipende dall'ICP); con zero ICP un blocco con link a "Crea ICP". Con un solo ICP non va aperto:
 * `AnalyzeDialog` lo sceglie da sé.
 */
export function IcpPickerDialog({ open, onOpenChange, onPick, description, onClosed }: IcpPickerDialogProps) {
  const uid = useId();
  const focus = useDialogFocusReturn();
  const icps = useQuery({ queryKey: queryKeys.icpsIndex, queryFn: api.icps.list, enabled: open });
  const [choice, setChoice] = useState<number | null>(null);
  useEffect(() => {
    if (open) setChoice(null);
  }, [open]);

  const items = icps.data?.items ?? [];
  const chosen = items.find((i) => i.id === choice) ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg"
        showCloseButton={false}
        onOpenAutoFocus={focus.onOpenAutoFocus}
        onCloseAutoFocus={(event) => {
          focus.onCloseAutoFocus(event);
          onClosed?.();
        }}
      >
        <DialogHeader>
          <DialogTitle>Analizza con l'AI: scegli l'ICP</DialogTitle>
          <DialogDescription>
            {description ?? "Il fit si calcola rispetto a un ICP: scegli quello con cui confrontare i prospect selezionati."}
          </DialogDescription>
        </DialogHeader>

        {icps.isPending && <p className="text-sm text-slate-500">Caricamento ICP…</p>}
        {icps.error && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            Impossibile caricare gli ICP: {(icps.error as Error).message}
            <Button type="button" variant="outline" size="sm" className="ml-2" onClick={() => void icps.refetch()}>
              Riprova
            </Button>
          </div>
        )}
        {icps.isSuccess && items.length === 0 && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            Crea prima un ICP: l'analisi calcola il fit rispetto a un ICP.{' '}
            <Link to={'/icps' as never} className="font-medium underline" onClick={() => onOpenChange(false)}>
              Crea ICP
            </Link>
          </div>
        )}
        {items.length > 0 && (
          <fieldset className="flex min-w-0 flex-col gap-1">
            <legend className="sr-only">ICP</legend>
            {items.map((icp) => (
              <label
                key={icp.id}
                className={cn(
                  'flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-slate-50',
                  choice === icp.id ? 'border-slate-500 bg-slate-50' : 'border-slate-200',
                )}
              >
                <input
                  type="radio"
                  name={`${uid}-icp`}
                  value={icp.id}
                  checked={choice === icp.id}
                  onChange={() => setChoice(icp.id)}
                  className="mt-0.5 size-4 shrink-0 accent-slate-900"
                />
                <span className="min-w-0">
                  <span className="block font-medium text-slate-900">{icp.name}</span>
                  <span className="line-clamp-2 text-slate-500">{icp.description || 'Nessuna descrizione'}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Annulla
            </Button>
          </DialogClose>
          <Button type="button" disabled={!chosen} onClick={() => chosen && onPick(chosen)}>
            Continua
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface AnalyzeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Selezione di prospect oppure intera lista (su lista l'ICP è sempre quello della lista). */
  scope: BulkJobScope;
  /**
   * ICP fisso (pagina Lista: l'ICP della lista). Senza, l'ICP si sceglie con `IcpPickerDialog`:
   * automatico se ne esiste uno solo, blocco se nessuno.
   */
  icp?: { id: number; name: string };
  /** Solo i non ancora analizzati (default del server: `true` su lista, `false` sulla selezione). */
  onlyMissing?: boolean;
  /** Sottotitolo aggiuntivo (es. "Lista filtrata: …"). */
  scopeLabel?: ReactNode;
  onStarted?: (job: Job, icpId: number) => void;
}

/**
 * "Analizza…" (FLOW E.3, H): passo ICP se serve, poi `JobPreviewDialog` con "Analisi per ICP: X",
 * conteggi (da arricchire prima, da analizzare, saltate), costo, modello, warning (azienda vuota,
 * prezzo profilo assente) e blocchi; "Rianalizza anche quelle già fatte" = `force`.
 */
export function AnalyzeDialog({ open, onOpenChange, scope, icp, onlyMissing, scopeLabel, onStarted }: AnalyzeDialogProps) {
  const icps = useQuery({ queryKey: queryKeys.icpsIndex, queryFn: api.icps.list, enabled: open && !icp });
  const [picked, setPicked] = useState<{ id: number; name: string } | null>(null);
  // ICP scelto mentre il passo ICP si sta chiudendo: l'anteprima si apre a chiusura completata.
  // Ref oltre allo stato: se il dialog si smonta senza animazione, `onClosed` arriva con le props del
  // render precedente e vedrebbe ancora `pending === null`.
  const [pending, setPending] = useState<{ id: number; name: string } | null>(null);
  const pendingRef = useRef<{ id: number; name: string } | null>(null);
  const [force, setForce] = useState(false);
  useEffect(() => {
    if (open) {
      setPicked(null);
      setPending(null);
      pendingRef.current = null;
      setForce(false);
    }
  }, [open]);

  const single = !icp && icps.data?.items.length === 1 ? icps.data.items[0] : null;
  const chosen = icp ?? picked ?? (single ? { id: single.id, name: single.name } : null);
  const isList = 'listId' in scope;
  // Il passo ICP si apre solo quando si sa quanti ICP ci sono (con uno solo si salta).
  const needsPicker = open && !chosen && !pending && !isList && (icps.isSuccess || icps.isError);

  const params =
    'listId' in scope
      ? { listId: scope.listId, force, ...(onlyMissing === undefined ? {} : { onlyMissing }) }
      : { prospectIds: scope.prospectIds, icpId: chosen?.id ?? 0, force, ...(onlyMissing === undefined ? {} : { onlyMissing }) };
  const preview = useJobPreview('analyze', params, { enabled: open && (isList || chosen !== null) });

  const start = useJobStart(
    () =>
      'listId' in scope
        ? api.analyze.startList(scope.listId, { force, ...(onlyMissing === undefined ? {} : { onlyMissing }) })
        : api.analyze.startSelection({
            prospectIds: scope.prospectIds,
            icpId: chosen!.id,
            force,
            ...(onlyMissing === undefined ? {} : { onlyMissing }),
          }),
    {
      onStarted: (job) => {
        onOpenChange(false);
        if (chosen) onStarted?.(job, chosen.id);
      },
    },
  );

  const icpLine = chosen ? `Analisi per ICP: ${chosen.name}${single && !icp ? ' (unico)' : ''}` : 'Analisi per l\'ICP della lista';

  return (
    <>
      <IcpPickerDialog
        open={needsPicker}
        onOpenChange={onOpenChange}
        onPick={(i) => {
          pendingRef.current = { id: i.id, name: i.name };
          setPending(pendingRef.current);
        }}
        onClosed={() => {
          if (pendingRef.current) {
            setPicked(pendingRef.current);
            pendingRef.current = null;
            setPending(null);
          }
        }}
      />
      <JobPreviewDialog
        open={open && (isList || chosen !== null)}
        onOpenChange={onOpenChange}
        title="Analizza con l'AI"
        description={
          <>
            <span className="block font-medium text-slate-700">{icpLine}</span>
            {scopeLabel && <span className="block">{scopeLabel}</span>}
          </>
        }
        preview={preview}
        summary={(data: JobPreview) => {
          const c = data.counts;
          return (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
              {joinParts([
                `${fmtCount(c.selected)} ${isList ? 'nella lista' : c.selected === 1 ? 'selezionato' : 'selezionati'}`,
                (c.to_enrich ?? 0) > 0 && `${fmtCount(c.to_enrich)} da arricchire prima`,
                `${fmtCount(c.to_analyze)} da analizzare`,
                (c.skipped_same_input ?? 0) > 0 && `${fmtCount(c.skipped_same_input)} già analizzate con gli stessi dati (saltate)`,
                (c.skipped_analyzed ?? 0) > 0 && `${fmtCount(c.skipped_analyzed)} già analizzate (saltate)`,
                (c.not_enrichable ?? 0) > 0 && `${fmtCount(c.not_enrichable)} senza dati sul profilo (saltati)`,
                (c.not_found ?? 0) > 0 && `${fmtCount(c.not_found)} non più presenti`,
              ])}
            </p>
          );
        }}
        startLabel="Avvia analisi"
        starting={start.isPending}
        onStart={() => start.mutate()}
      >
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={force} onCheckedChange={(v) => setForce(v === true)} className="mt-0.5" />
          <span>
            <span className="font-medium text-slate-900">Rianalizza anche quelle già fatte</span>
            <span className="block text-slate-500">Ricalcola anche le analisi con gli stessi dati: costa di nuovo.</span>
          </span>
        </label>
      </JobPreviewDialog>
    </>
  );
}
