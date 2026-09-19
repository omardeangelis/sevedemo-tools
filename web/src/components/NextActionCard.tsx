import { useId, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarClockIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { api, errorText, queryKeys } from '../api/client';
import type { ProspectDetail } from '../api/types';
import { fmtWeekday, nextActionDateText, nextActionStateOf } from '../lib/dates';
import { NextActionFields, type NextActionValue } from './NextActionFields';
import { invalidateProspectViews } from './StatusSelect';
import { toast } from './ui/toaster';

/*
 * Prossima azione in testata alla scheda (people-first-crm G1, G3, G6; FLOW E.4; PLAN P-25): stato in testo
 * (scaduta / oggi / futura) con la data e cosa fare; Imposta · Modifica (dentro: Rimuovi prossima azione). Non
 * cambia stato né liste. Fatto e Rimanda arrivano con la tappa successiva.
 */
export function NextActionCard({ prospect: p, today }: { prospect: ProspectDetail; today: string }) {
  const uid = useId();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<NextActionValue>({ on: p.next_action_on ?? '', text: p.next_action_text ?? '' });
  const [dateError, setDateError] = useState<string | null>(null);
  const done = (next: ProspectDetail) => {
    queryClient.setQueryData(queryKeys.prospect(p.id), next);
    void invalidateProspectViews(queryClient);
  };
  const save = useMutation({
    mutationFn: (v: NextActionValue) => api.prospects.setNextAction(p.id, { on: v.on, text: v.text.trim() || null }),
    onSuccess: (next, v) => {
      done(next);
      setEditing(false);
      toast({ title: `Prossima azione impostata: ${fmtWeekday(v.on)}` });
    },
  });
  const remove = useMutation({
    mutationFn: () => api.prospects.clearNextAction(p.id),
    onSuccess: (next) => {
      done(next);
      setEditing(false);
      toast({ tone: 'neutral', title: 'Prossima azione rimossa' });
    },
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
    if (!value.on) {
      setDateError('Scegli la data della prossima azione.');
      document.getElementById(`${uid}-date`)?.focus();
      return;
    }
    setDateError(null);
    save.mutate(value);
  };
  const state = nextActionStateOf(p.next_action_on, today);
  const error = save.error ?? remove.error;

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
        {!editing && (
          <Button type="button" size="xs" variant="outline" onClick={open}>
            {p.next_action_on ? 'Modifica' : 'Imposta prossima azione'}
          </Button>
        )}
      </div>
      {p.status === 'scartato' && p.next_action_on && (
        <p className="mt-1 text-xs text-amber-800">Persona scartata: la prossima azione resta, ma non compare tra le cose da fare.</p>
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
            <Button type="submit" size="sm" disabled={save.isPending} aria-busy={save.isPending}>
              {save.isPending ? 'Salvataggio…' : 'Salva prossima azione'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Annulla
            </Button>
            {p.next_action_on && (
              <Button type="button" size="sm" variant="ghost" className="text-red-700" onClick={() => remove.mutate()} disabled={remove.isPending} aria-busy={remove.isPending}>
                Rimuovi prossima azione
              </Button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
