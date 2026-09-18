import { useId, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { api, isApiError } from '../api/client';
import {
  CHANNEL_LABELS,
  CHANNELS,
  DIRECTION_LABELS,
  DIRECTIONS,
  PROSPECT_STATUSES,
  STATUS_LABELS,
  type Channel,
  type Direction,
  type Membership,
  type ProspectStatus,
} from '../api/types';
import { invalidateProspectViews } from './StatusSelect';
import { toast } from './ui/toaster';

export interface TouchpointFormProps {
  prospectId: number;
  /** Stato attuale: serve al suggerimento "Suggerito: Contattato/Risposto". */
  status: ProspectStatus;
  memberships: Membership[];
  /** Lista di contesto di default (`?list` se è una membership, oppure l'unica membership). */
  defaultListId: number | null;
}

type Field = 'channel' | 'direction' | 'occurredAt' | 'listId' | 'body' | 'note' | 'newStatus';

/** `Date` → valore di `<input type="datetime-local">` nell'ora locale ("2026-09-16T14:05"). */
function localInputValue(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Stati prima dei quali ha senso suggerire il cambio (in uscita → Contattato, in entrata → Risposto). */
const BEFORE_CONTACTED: readonly ProspectStatus[] = ['nuovo', 'qualificato', 'da_contattare'];
const BEFORE_REPLIED: readonly ProspectStatus[] = [...BEFORE_CONTACTED, 'contattato'];

function suggestedStatus(direction: Direction, status: ProspectStatus): ProspectStatus | null {
  if (direction === 'outbound') return BEFORE_CONTACTED.includes(status) ? 'contattato' : null;
  return BEFORE_REPLIED.includes(status) ? 'risposto' : null;
}

const fieldCls = 'h-8 w-full rounded-lg border border-input bg-white px-2 text-sm text-slate-900 aria-invalid:border-destructive';

/**
 * Registra un touchpoint (FLOW F.5, P8): canale, direzione (default in uscita), data/ora (default
 * adesso), lista di contesto (obbligatoria solo se la persona è in più liste e manca `?list`), testo
 * **facoltativo**, nota e "Nuovo stato" (default nessun cambio; suggerimento contestuale mai applicato
 * da solo). Touchpoint e cambio stato nascono nella stessa transazione lato server. Dopo il salvataggio
 * il form si ripulisce ma tiene canale e lista (uso ripetuto).
 */
export function TouchpointForm({ prospectId, status, memberships, defaultListId }: TouchpointFormProps) {
  const uid = useId();
  const queryClient = useQueryClient();
  const [channel, setChannel] = useState<Channel>('linkedin_dm');
  const [direction, setDirection] = useState<Direction>('outbound');
  const [occurredAt, setOccurredAt] = useState(() => localInputValue());
  const [listId, setListId] = useState<number | null>(defaultListId);
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [newStatus, setNewStatus] = useState<ProspectStatus | ''>('');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});

  // Una membership rimossa nel frattempo non resta selezionata.
  const validListId = listId !== null && memberships.some((m) => m.list_id === listId) ? listId : null;
  const listRequired = memberships.length > 1;
  const suggestion = suggestedStatus(direction, status);

  const save = useMutation({
    mutationFn: () =>
      api.prospects.addTouchpoint(prospectId, {
        channel,
        direction,
        occurredAt: new Date(occurredAt).toISOString(),
        listId: validListId,
        body: text.trim() || null,
        note: note.trim() || null,
        newStatus: newStatus || null,
      }),
    onSuccess: async () => {
      const changed = newStatus !== '' && newStatus !== status;
      toast({
        title: 'Touchpoint registrato',
        description: changed ? `Stato: ${STATUS_LABELS[newStatus]}` : undefined,
      });
      await invalidateProspectViews(queryClient);
      setOccurredAt(localInputValue());
      setText('');
      setNote('');
      setNewStatus('');
      setErrors({});
    },
    onError: (err) => {
      // Prospect unito o sparito nel frattempo: il dettaglio ricaricato mostra "Prospect non trovato".
      if (isApiError(err) && err.status === 404) void invalidateProspectViews(queryClient);
      const issues = isApiError(err) ? (err.body?.issues ?? []) : [];
      const next: Partial<Record<Field, string>> = {};
      for (const issue of issues) {
        const key = issue.path.split('.')[0] as Field;
        next[key] = issue.message;
      }
      setErrors(next);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Partial<Record<Field, string>> = {};
    if (Number.isNaN(Date.parse(occurredAt))) next.occurredAt = 'Data e ora non valide.';
    if (listRequired && validListId === null) next.listId = 'Scegli la lista di contesto: la persona è in più liste.';
    setErrors(next);
    if (next.occurredAt) document.getElementById(`${uid}-date`)?.focus();
    else if (next.listId) document.getElementById(`${uid}-list`)?.focus();
    else save.mutate();
  };

  const errorId = (f: Field) => (errors[f] ? `${uid}-${f}-error` : undefined);
  const fieldError = (f: Field) =>
    errors[f] && (
      <p id={`${uid}-${f}-error`} className="text-xs text-red-700">
        {errors[f]}
      </p>
    );
  // Errori di validazione (400 `issues`) già mostrati sotto i campi; tutto il resto in un avviso unico.
  const hasIssues = isApiError(save.error) && (save.error.body?.issues?.length ?? 0) > 0;
  const genericError = save.error && !hasIssues ? save.error : null;

  return (
    <form onSubmit={submit} aria-labelledby={`${uid}-title`} className="flex flex-col gap-3" noValidate>
      <h3 id={`${uid}-title`} className="text-sm font-semibold text-slate-900">
        Registra un touchpoint
      </h3>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-channel`} className="text-xs font-medium text-slate-600">
            Canale
          </label>
          <select
            id={`${uid}-channel`}
            value={channel}
            onChange={(e) => setChannel(e.target.value as Channel)}
            className={fieldCls}
          >
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {CHANNEL_LABELS[c]}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-xs font-medium text-slate-600">Direzione</legend>
          <div className="flex h-8 items-center gap-4">
            {DIRECTIONS.map((d) => (
              <label key={d} className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-800">
                <input
                  type="radio"
                  name={`${uid}-direction`}
                  value={d}
                  checked={direction === d}
                  onChange={() => setDirection(d)}
                  className="size-4 accent-slate-900"
                />
                {DIRECTION_LABELS[d]}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-date`} className="text-xs font-medium text-slate-600">
            Data e ora
          </label>
          <Input
            id={`${uid}-date`}
            type="datetime-local"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
            aria-invalid={errors.occurredAt ? true : undefined}
            aria-describedby={errorId('occurredAt')}
            className="bg-white"
          />
          {fieldError('occurredAt')}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-list`} className="text-xs font-medium text-slate-600">
            Lista di contesto{listRequired ? ' (obbligatoria)' : ''}
          </label>
          <select
            id={`${uid}-list`}
            value={validListId ?? ''}
            disabled={memberships.length === 0}
            onChange={(e) => setListId(e.target.value ? Number(e.target.value) : null)}
            aria-invalid={errors.listId ? true : undefined}
            aria-describedby={errorId('listId')}
            aria-required={listRequired || undefined}
            className={cn(fieldCls, 'disabled:bg-slate-50 disabled:text-slate-500')}
          >
            {memberships.length === 0 && <option value="">Nessuna (in Inbox)</option>}
            {listRequired && validListId === null && <option value="">Scegli la lista…</option>}
            {memberships.map((m) => (
              <option key={m.list_id} value={m.list_id}>
                {m.list_name}
              </option>
            ))}
          </select>
          {fieldError('listId')}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${uid}-body`} className="text-xs font-medium text-slate-600">
          Testo del messaggio (facoltativo)
        </label>
        <textarea
          id={`${uid}-body`}
          value={text}
          rows={3}
          maxLength={20000}
          onChange={(e) => setText(e.target.value)}
          aria-invalid={errors.body ? true : undefined}
          aria-describedby={errorId('body')}
          placeholder="Incolla il messaggio inviato o ricevuto, oppure lascia vuoto"
          className="w-full rounded-lg border border-input bg-white px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-400"
        />
        {fieldError('body')}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-note`} className="text-xs font-medium text-slate-600">
            Nota (facoltativa)
          </label>
          <Input
            id={`${uid}-note`}
            value={note}
            maxLength={2000}
            onChange={(e) => setNote(e.target.value)}
            aria-invalid={errors.note ? true : undefined}
            aria-describedby={errorId('note')}
            className="bg-white"
          />
          {fieldError('note')}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-status`} className="text-xs font-medium text-slate-600">
            Nuovo stato
          </label>
          <select
            id={`${uid}-status`}
            value={newStatus}
            onChange={(e) => setNewStatus(e.target.value as ProspectStatus | '')}
            aria-describedby={suggestion ? `${uid}-suggestion` : undefined}
            className={fieldCls}
          >
            <option value="">Nessun cambio</option>
            {PROSPECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
                {s === status ? ' (attuale)' : ''}
              </option>
            ))}
          </select>
          {suggestion && newStatus !== suggestion && (
            <p id={`${uid}-suggestion`} className="flex flex-wrap items-center gap-1 text-xs text-slate-600">
              Suggerito: {STATUS_LABELS[suggestion]}
              <button
                type="button"
                onClick={() => setNewStatus(suggestion)}
                className="cursor-pointer font-medium text-slate-900 underline underline-offset-2"
              >
                Usa
              </button>
            </p>
          )}
        </div>
      </div>

      {genericError && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Touchpoint non registrato: {genericError.message}
        </p>
      )}
      {Object.keys(errors).length > 0 && !genericError && (
        <p role="alert" className="sr-only">
          Correggi i campi evidenziati.
        </p>
      )}

      <div>
        <Button type="submit" disabled={save.isPending} aria-busy={save.isPending}>
          {save.isPending ? 'Registrazione…' : 'Registra touchpoint'}
        </Button>
      </div>
    </form>
  );
}
