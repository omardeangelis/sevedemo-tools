import { useEffect, useId, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { api, queryKeys } from '../api/client';
import type { ExportCreated, ExportInput, ExportScopeFilters, ProspectList } from '../api/types';
import { countText } from '../lib/format';
import { joinParts, useDialogFocusReturn } from './BulkBar';
import { toast } from './ui/toaster';

export interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  list: Pick<ProspectList, 'id' | 'name'>;
  /** Selezione: se non vuota l'ambito è "N selezionati" e i filtri della tabella non valgono. */
  prospectIds?: number[];
  /** Filtri correnti della tabella: ambito "lista filtrata" (vuoto = tutta la lista). */
  filters: ExportScopeFilters;
  /** Filtro email della tabella (`true` con, `false` senza): vale quando "Solo con email" è spento. */
  emailFilter?: boolean;
  /** Etichette dei filtri attivi, mostrate in sola lettura (es. "Stato: Da contattare"). */
  filterLabels?: string[];
  onExported?: (created: ExportCreated) => void;
}

/** Scarica un file dall'API senza lasciare la pagina (il server risponde `content-disposition: attachment`). */
export function downloadFile(url: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * "Esporta CSV" (FLOW G): ambito in sola lettura (selezione o lista filtrata), "Solo con email"
 * **on** e "Segna come 'contattato'" **off** di default, conteggio vivo da
 * `GET /api/lists/:id/exports/preview`, bottone disabilitato a 0 → `POST /api/lists/:id/exports` →
 * download del CSV + toast "N esportati · CSV scaricato". Errore → messaggio nel dialog con Riprova.
 */
export function ExportDialog({ open, onOpenChange, list, prospectIds, filters, emailFilter, filterLabels = [], onExported }: ExportDialogProps) {
  const queryClient = useQueryClient();
  const focus = useDialogFocusReturn();
  const uid = useId();
  const [onlyWithEmail, setOnlyWithEmail] = useState(true);
  const [markContacted, setMarkContacted] = useState(false);
  useEffect(() => {
    if (open) {
      setOnlyWithEmail(true);
      setMarkContacted(false);
    }
  }, [open]);

  const selection = prospectIds && prospectIds.length > 0 ? prospectIds : null;
  const hasEmail = onlyWithEmail ? true : emailFilter;
  const scopeInput: ExportInput = selection ? { prospectIds: selection } : { ...filters };
  const input: ExportInput = { ...scopeInput, ...(hasEmail === undefined ? {} : { hasEmail }) };

  const preview = useQuery({
    queryKey: [...queryKeys.exports(list.id), 'preview', input],
    queryFn: () => api.exports.preview(list.id, input),
    enabled: open,
    staleTime: 0,
    placeholderData: keepPreviousData,
  });

  const create = useMutation({
    mutationFn: () => api.exports.create(list.id, { ...input, markContacted }),
    onSuccess: (created) => {
      downloadFile(created.download_url);
      void queryClient.invalidateQueries({ queryKey: queryKeys.lists });
      void queryClient.invalidateQueries({ queryKey: queryKeys.prospects });
      void queryClient.invalidateQueries({ queryKey: queryKeys.inbox });
      toast({
        tone: 'success',
        title: joinParts([
          countText(created.count, 'esportato', 'esportati'),
          'CSV scaricato',
          created.mark_contacted && created.counts.marked_contacted > 0 && 'segnati come contattati',
        ]),
        description: `Export #${created.id} della lista '${list.name}'.`,
        action: (
          <a href={created.download_url} download className="text-sm font-medium underline">
            Scarica di nuovo
          </a>
        ),
      });
      onOpenChange(false);
      onExported?.(created);
    },
  });

  useEffect(() => {
    if (open) create.reset();
    // Si azzera solo all'apertura (`create.reset` è stabile).
  }, [open]);

  const data = preview.data;
  const count = data?.count ?? 0;
  const inScope = data?.counts.in_scope ?? 0;
  const scopeText = selection
    ? countText(selection.length, 'selezionato', 'selezionati')
    : filterLabels.length > 0
      ? `Lista filtrata: ${filterLabels.join(' · ')}`
      : 'Tutta la lista';
  const empty = Boolean(data) && count === 0;
  const hintId = `${uid}-mark-hint`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg" showCloseButton={false} {...focus}>
        <DialogHeader>
          <DialogTitle>Esporta CSV</DialogTitle>
          <DialogDescription>
            Lista '{list.name}': un file con nome, email, azienda, stato, fit, riassunto e angoli dell'analisi.
          </DialogDescription>
        </DialogHeader>

        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
          <span className="font-medium">Ambito:</span> {scopeText}
          {data && !selection && ` (${inScope.toLocaleString('it-IT')})`}
        </p>

        <div className="flex flex-col gap-3">
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={onlyWithEmail} onCheckedChange={(v) => setOnlyWithEmail(v === true)} className="mt-0.5" />
            <span>
              <span className="font-medium text-slate-900">Solo con email</span>
              <span className="block text-slate-500">L'export serve agli email tool: chi non ha email resta fuori.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={markContacted}
              onCheckedChange={(v) => setMarkContacted(v === true)}
              className="mt-0.5"
              aria-describedby={hintId}
            />
            <span>
              <span className="font-medium text-slate-900">Segna come 'contattato' i prospect esportati</span>
              <span id={hintId} className="block text-slate-500">
                Registra un cambio stato per ciascuno. Attivalo se invii subito dopo l'export: evita di ri-esportarli la
                prossima volta filtrando per stato.
              </span>
            </span>
          </label>
        </div>

        <div aria-live="polite" aria-busy={preview.isFetching} className="text-sm">
          {preview.isPending && <p className="text-slate-500">Conteggio in corso…</p>}
          {preview.error && (
            <p role="alert" className="text-red-700">
              Conteggio non disponibile: {preview.error instanceof Error ? preview.error.message : 'errore inatteso.'}
            </p>
          )}
          {data && !empty && (
            <p className="text-slate-800">
              {`${count === 1 ? 'Verrà esportato' : 'Verranno esportati'} ${countText(count, 'prospect', 'prospect')}`}
              {data.counts.excluded_email > 0 &&
                ` (${countText(data.counts.excluded_email, onlyWithEmail ? 'senza email escluso' : 'escluso dal filtro email', onlyWithEmail ? 'senza email esclusi' : 'esclusi dal filtro email')})`}
              .
              {data.counts.not_member + data.counts.not_found > 0 &&
                ` ${countText(data.counts.not_member + data.counts.not_found, 'selezionato non è più nella lista', 'selezionati non sono più nella lista')}.`}
              {markContacted && data.counts.to_mark_contacted > 0 && ` ${countText(data.counts.to_mark_contacted, 'passerà', 'passeranno')} a 'Contattato'.`}
            </p>
          )}
          {empty && (
            <p role="alert" className="font-medium text-slate-700">
              Nessun prospect da esportare con questi filtri
              {data!.counts.excluded_email > 0 && ` (${countText(data!.counts.excluded_email, 'senza email escluso', 'senza email esclusi')})`}.
            </p>
          )}
        </div>

        {create.error && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            <p>Export non riuscito: {create.error instanceof Error ? create.error.message : 'errore inatteso.'} Nessun dato modificato.</p>
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => create.mutate()}>
              Riprova
            </Button>
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Annulla
            </Button>
          </DialogClose>
          <Button
            type="button"
            disabled={!data || empty || preview.isFetching || create.isPending}
            aria-busy={create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'Esportazione…' : empty ? 'Nessun prospect da esportare' : `Esporta ${countText(count, 'prospect', 'prospect')}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
