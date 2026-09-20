import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarClockIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { api, errorText } from '../api/client';
import type { ProspectDetail } from '../api/types';
import { fmtWeekday, nextActionDateText, nextActionStateOf } from '../lib/dates';
import {
  actionName,
  isChanged,
  onChangedElsewhere,
  PostponeMenu,
  refreshAfterWrite,
  useCompleteNextAction,
  usePostponeNextAction,
  writeError,
} from './NextActionActions';
import { NextActionFields, type NextActionValue } from './NextActionFields';
import { toast } from './ui/toaster';

/*
 * Prossima azione in testata alla scheda (people-first-crm G1, G3–G6; FLOW E.4): stato in testo (scaduta / oggi /
 * futura) con la data e cosa fare; **Fatto** · **Rimanda ▾** · **Modifica** (dentro: Rimuovi prossima azione), oppure
 * **Imposta prossima azione**. Non cambia stato né liste. Ogni scrittura manda il `next_action_set_at` letto: se è
 * cambiata altrove (due schede) arriva il toast e la scheda si ricarica; gli altri errori restano accanto ai bottoni.
 * Dopo ogni scrittura il focus torna sulla testata: su "Fatto" se c'è ancora una prossima azione, altrimenti su
 * "Imposta prossima azione".
 */
export function NextActionCard({ prospect: p, today }: { prospect: ProspectDetail; today: string }) {
  const uid = useId();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<NextActionValue>({ on: p.next_action_on ?? '', text: p.next_action_text ?? '' });
  const [dateError, setDateError] = useState<string | null>(null);
  // Focus dopo una scrittura (FLOW Accessibilità): sul controllo che resta in testata, a dati aggiornati.
  const [refocus, setRefocus] = useState(0);
  const setRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (refocus > 0) (doneRef.current ?? setRef.current)?.focus();
  }, [refocus]);
  const focusHeader = () => setRefocus((n) => n + 1);
  const done = (next: ProspectDetail) => void refreshAfterWrite(queryClient, next);
  /** Cambiata altrove mentre il form era aperto: toast e scheda ricaricata (come Fatto/Rimanda). */
  const changedElsewhere = (err: unknown) => {
    if (!isChanged(err)) return;
    setEditing(false);
    onChangedElsewhere(queryClient, focusHeader);
  };
  const complete = useCompleteNextAction({ onSuccess: focusHeader, onChanged: focusHeader });
  const postpone = usePostponeNextAction({ onSuccess: focusHeader, onChanged: focusHeader });
  const save = useMutation({
    mutationFn: (v: NextActionValue) =>
      api.prospects.setNextAction(p.id, { on: v.on, text: v.text.trim() || null, expectedSetAt: p.next_action_set_at }),
    onSuccess: (next, v) => {
      done(next);
      setEditing(false);
      focusHeader();
      toast({ title: `Prossima azione impostata: ${fmtWeekday(v.on)}` });
    },
    onError: changedElsewhere,
  });
  const remove = useMutation({
    mutationFn: () => api.prospects.clearNextAction(p.id, p.next_action_set_at),
    onSuccess: (next) => {
      done(next);
      setEditing(false);
      focusHeader();
      toast({ tone: 'neutral', title: 'Prossima azione rimossa' });
    },
    onError: changedElsewhere,
  });
  const open = () => {
    setValue({ on: p.next_action_on ?? '', text: p.next_action_text ?? '' });
    setDateError(null);
    save.reset();
    remove.reset();
    setEditing(true);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (save.isPending) return;
    if (!value.on) {
      setDateError('Scegli la data della prossima azione.');
      document.getElementById(`${uid}-date`)?.focus();
      return;
    }
    setDateError(null);
    save.mutate(value);
  };
  const state = nextActionStateOf(p.next_action_on, today);
  const error = [save.error, remove.error].find((e) => e && !isChanged(e)) ?? null;
  const busy = complete.isPending || postpone.isPending;
  const actionError = writeError(complete.error, 'Fatto') ?? writeError(postpone.error, 'Rimanda');

  return (
    <section aria-labelledby={`${uid}-title`} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id={`${uid}-title`} className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
          <CalendarClockIcon className="size-3.5" aria-hidden="true" />
          Prossima azione
        </h2>
        {p.next_action_on ? (
          <p className="text-sm text-slate-800">
            <time
              dateTime={p.next_action_on}
              className={cn('font-semibold', state === 'scaduta' ? 'text-red-700' : state === 'oggi' ? 'text-amber-800' : 'text-slate-900')}
            >
              {nextActionDateText(p.next_action_on, today)}
            </time>
            {p.next_action_text && <> — {p.next_action_text}</>}
          </p>
        ) : (
          <p className="text-sm text-slate-500">Nessuna prossima azione.</p>
        )}
        {!editing && p.next_action_on && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              ref={doneRef}
              type="button"
              size="xs"
              data-next-action-primary
              onClick={() => {
                if (busy) return;
                postpone.reset();
                complete.mutate(p);
              }}
              aria-disabled={busy}
              aria-busy={complete.isPending}
              aria-label={`Fatto: ${actionName(p)}`}
            >
              Fatto
            </Button>
            <PostponeMenu
              target={p}
              today={today}
              busy={busy}
              onPick={(on) => {
                complete.reset();
                postpone.mutate({ target: p, on });
              }}
            />
            <Button type="button" size="xs" variant="outline" onClick={open}>
              Modifica
            </Button>
          </div>
        )}
        {!editing && !p.next_action_on && (
          <Button ref={setRef} type="button" size="xs" variant="outline" data-next-action-primary onClick={open}>
            Imposta prossima azione
          </Button>
        )}
      </div>
      {actionError && (
        <p role="alert" className="mt-1 text-sm text-red-700">
          {actionError}
        </p>
      )}
      {p.status === 'scartato' && p.next_action_on && (
        <p className="mt-1 text-xs text-amber-800">Persona scartata: la prossima azione non compare in Oggi.</p>
      )}
      {editing && (
        <form onSubmit={submit} noValidate className="mt-3 flex flex-col gap-3 border-t border-slate-100 pt-3" aria-label="Prossima azione">
          <NextActionFields value={value} onChange={setValue} today={today} dateError={dateError} dateId={`${uid}-date`} disabled={save.isPending || remove.isPending} />
          {error && (
            <p role="alert" className="text-sm text-red-700">
              Salvataggio non riuscito: {errorText(error)}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" aria-disabled={save.isPending} aria-busy={save.isPending}>
              {save.isPending ? 'Salvataggio…' : 'Salva prossima azione'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Annulla
            </Button>
            {p.next_action_on && (
              <Button type="button" size="sm" variant="ghost" className="text-red-700" onClick={() => !remove.isPending && remove.mutate()} aria-disabled={remove.isPending} aria-busy={remove.isPending}>
                Rimuovi prossima azione
              </Button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
