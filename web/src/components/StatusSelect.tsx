import { useId, useRef, useState } from 'react';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, isApiError, queryKeys } from '../api/client';
import { PROSPECT_STATUSES, STATUS_LABELS, type ProspectStatus } from '../api/types';
import { StatusBadge } from './StatusBadge';
import { toast } from './ui/toaster';

/**
 * Dopo una scrittura sul prospect (stato, touchpoint, anagrafica, analisi): ricarica dettaglio,
 * analisi (`stale` dipende dall'anagrafica), tabelle Inbox/Lista (stato, fit, ultimo touchpoint) e
 * conteggi per stato delle liste.
 */
export function invalidateProspectViews(queryClient: QueryClient): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.prospects }),
    queryClient.invalidateQueries({ queryKey: queryKeys.inbox }),
    queryClient.invalidateQueries({ queryKey: queryKeys.lists }),
  ]);
}

export interface StatusSelectProps {
  prospectId: number;
  status: ProspectStatus;
  /** Lista di contesto registrata sull'attività `status_change` (chip lista in timeline). */
  listId?: number | null;
}

/**
 * Stato del prospect (FLOW F.1–F.2): badge con label italiana (colore + testo) e select "Cambia
 * stato" con i 9 stati. Scelto uno stato si apre un pannello "Nota (opzionale)" + **Conferma**: nessuna
 * macchina a stati (D6), ogni transizione è permessa e logga un `status_change`. Escape annulla.
 *
 * @example <StatusSelect prospectId={p.id} status={p.status} listId={contextListId} />
 */
export function StatusSelect({ prospectId, status, listId }: StatusSelectProps) {
  const uid = useId();
  const queryClient = useQueryClient();
  const selectRef = useRef<HTMLSelectElement>(null);
  const [pending, setPending] = useState<ProspectStatus | null>(null);
  const [note, setNote] = useState('');

  const change = useMutation({
    mutationFn: (to: ProspectStatus) =>
      api.prospects.changeStatus(prospectId, { status: to, note: note.trim() || null, listId: listId ?? null }),
    onSuccess: (prospect, to) => {
      queryClient.setQueryData(queryKeys.prospect(prospectId), prospect);
      void invalidateProspectViews(queryClient);
      toast({ title: `Stato aggiornato: ${STATUS_LABELS[to]}` });
      setPending(null);
      setNote('');
      selectRef.current?.focus();
    },
    onError: (err) => {
      // Prospect unito o sparito nel frattempo: il dettaglio ricaricato mostra "Prospect non trovato".
      if (isApiError(err) && err.status === 404) void invalidateProspectViews(queryClient);
    },
  });

  const cancel = () => {
    setPending(null);
    setNote('');
    change.reset();
    selectRef.current?.focus();
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium tracking-wide text-slate-500 uppercase" id={`${uid}-label`}>
          Stato
        </span>
        <StatusBadge status={status} className="text-sm" />
        <label htmlFor={`${uid}-select`} className="sr-only">
          Cambia stato
        </label>
        <select
          id={`${uid}-select`}
          ref={selectRef}
          value={pending ?? ''}
          disabled={change.isPending}
          aria-describedby={`${uid}-label`}
          onChange={(e) => {
            const value = e.target.value as ProspectStatus | '';
            change.reset();
            setPending(value === '' ? null : value);
          }}
          className="h-8 rounded-lg border border-input bg-white px-2 text-sm text-slate-700"
        >
          <option value="">Cambia stato…</option>
          {PROSPECT_STATUSES.map((s) => (
            <option key={s} value={s} disabled={s === status}>
              {STATUS_LABELS[s]}
              {s === status ? ' (attuale)' : ''}
            </option>
          ))}
        </select>
      </div>

      {pending && (
        <div
          role="group"
          aria-label="Conferma il cambio di stato"
          className="flex max-w-md flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              cancel();
            }
          }}
        >
          <p className="flex flex-wrap items-center gap-1.5 text-sm text-slate-700">
            <StatusBadge status={status} /> <span aria-hidden="true">→</span>
            <span className="sr-only">diventa</span> <StatusBadge status={pending} />
          </p>
          <label htmlFor={`${uid}-note`} className="text-xs font-medium text-slate-600">
            Nota (opzionale)
          </label>
          <Input
            id={`${uid}-note`}
            autoFocus
            value={note}
            maxLength={2000}
            placeholder="es. risponde solo via email"
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                change.mutate(pending);
              }
            }}
          />
          {change.error && (
            <p role="alert" className="text-sm text-red-700">
              Stato non aggiornato: {change.error instanceof Error ? change.error.message : 'errore inatteso.'}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={() => change.mutate(pending)} disabled={change.isPending} aria-busy={change.isPending}>
              {change.isPending ? 'Salvataggio…' : 'Conferma'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={cancel} disabled={change.isPending}>
              Annulla
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
