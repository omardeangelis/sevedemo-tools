import { useEffect, useId, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { ChevronDownIcon } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api, errorText, isApiError, queryKeys } from '../api/client';
import type { ProspectDetail } from '../api/types';
import { addDays, fmtWeekday, todayLocal } from '../lib/dates';
import { focusOrPageTitle } from '../lib/focus';
import { NextActionFields, type NextActionValue } from './NextActionFields';
import { invalidateProspectViews } from './StatusSelect';
import { dismissToast, toast } from './ui/toaster';

/*
 * Fatto e Rimanda della prossima azione (people-first-crm G4, G5, FLOW D.2–D.3, E.4), condivisi da scheda persona e
 * Oggi: Fatto senza conferma con il toast *"Fatto: '<testo>' (<persona>)"* e **Imposta la prossima** (dialog
 * *"Prossima azione per <persona>"*); **Rimanda ▾** a domani, tra una settimana (contati da oggi) o a una data scelta.
 * Ogni scrittura manda il `next_action_set_at` letto: cambiata altrove (due schede) → toast e dati ricaricati. Gli
 * altri errori non fanno toast: chi usa gli hook li mostra accanto al controllo (`writeError`, FLOW Error paths).
 */

/** Persona con la prossima azione su cui agire. */
export interface NextActionTarget {
  id: number;
  full_name: string | null;
  next_action_on: string | null;
  next_action_text: string | null;
  next_action_set_at: string | null;
}

const CHANGED_TEXT = 'Questa prossima azione è già stata completata o cambiata: aggiorno la lista.';

const who = (t: { full_name: string | null }) => t.full_name ?? 'questa persona';
/** Nome completo dei bottoni (FLOW Accessibilità): "Fatto: Richiamare per la demo, Mario Rossi". */
export const actionName = (t: NextActionTarget) => `${t.next_action_text ?? 'prossima azione'}, ${who(t)}`;

/** Dopo una scrittura: la scheda aggiornata in cache, le viste (Persone, Oggi, badge) da ricaricare. */
export function refreshAfterWrite(queryClient: QueryClient, detail?: ProspectDetail) {
  if (detail) queryClient.setQueryData(queryKeys.prospect(detail.id), detail);
  return invalidateProspectViews(queryClient);
}

/** "Cambiata altrove" (409) o persona sparita (404): non è un errore del controllo, si ricarica la lista. */
export const isChanged = (err: unknown) => isApiError(err, 'next_action_changed') || (isApiError(err) && err.status === 404);

/** "Cambiata altrove": avviso e dati ricaricati; `onChanged` dopo il refetch (per rimettere il focus). */
export function onChangedElsewhere(queryClient: QueryClient, onChanged?: () => void) {
  toast({ tone: 'warning', title: CHANGED_TEXT });
  void refreshAfterWrite(queryClient).then(() => onChanged?.());
}

/** Errore da mostrare accanto al controllo (FLOW Error paths), `null` per "cambiata altrove" (già nel toast). */
export function writeError(err: unknown, what: string): string | null {
  if (!err || isChanged(err)) return null;
  return `${what} non riuscito: ${errorText(err)}`;
}

interface WriteCallbacks {
  onSuccess?: (target: NextActionTarget) => void;
  /** Dopo il refetch di "cambiata altrove". */
  onChanged?: (target: NextActionTarget) => void;
}

/** **Fatto** (G4): toglie la prossima azione e la scrive in timeline; il toast offre "Imposta la prossima". */
export function useCompleteNextAction(opts: WriteCallbacks = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (t: NextActionTarget) => api.prospects.completeNextAction(t.id, t.next_action_set_at ?? ''),
    onSuccess: (detail, t) => {
      void refreshAfterWrite(queryClient, detail);
      const id = toast({
        tone: 'neutral',
        title: t.next_action_text ? `Fatto: '${t.next_action_text}' (${who(t)})` : `Fatto: prossima azione di ${who(t)}`,
        action: (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              dismissToast(id);
              openNextActionDialog({ id: t.id, full_name: t.full_name });
            }}
          >
            Imposta la prossima
          </Button>
        ),
      });
      opts.onSuccess?.(t);
    },
    onError: (err, t) => {
      if (isChanged(err)) onChangedElsewhere(queryClient, () => opts.onChanged?.(t));
    },
  });
}

/** **Rimanda** (G5): nuova data calcolata dal client da oggi, stesso testo. */
export function usePostponeNextAction(opts: WriteCallbacks = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ target, on }: { target: NextActionTarget; on: string }) =>
      api.prospects.setNextAction(target.id, { on, text: target.next_action_text, expectedSetAt: target.next_action_set_at }),
    onSuccess: (detail, { target, on }) => {
      void refreshAfterWrite(queryClient, detail);
      toast({ tone: 'neutral', title: `Rimandata a ${fmtWeekday(on)}` });
      opts.onSuccess?.(target);
    },
    onError: (err, { target }) => {
      if (isChanged(err)) onChangedElsewhere(queryClient, () => opts.onChanged?.(target));
    },
  });
}

const itemCls =
  'flex cursor-pointer items-center justify-between gap-4 rounded-md px-2 py-1.5 text-sm text-slate-800 outline-none select-none data-[highlighted]:bg-slate-100';

/**
 * **Rimanda ▾** (G5): Domani, Tra una settimana (dalla data di oggi, anche per le scadute) o "Scegli una data…".
 */
export function PostponeMenu({
  target,
  today,
  onPick,
  busy,
  size = 'xs',
}: {
  target: NextActionTarget;
  today: string;
  onPick: (on: string) => void;
  /** Scrittura in corso: la scelta si ignora ma il bottone resta a fuoco (niente `disabled`, che lo toglierebbe). */
  busy?: boolean;
  size?: 'xs' | 'sm';
}) {
  const pick = (on: string) => {
    if (!busy) onPick(on);
  };
  const [choosing, setChoosing] = useState(false);
  const tomorrow = addDays(today, 1);
  const nextWeek = addDays(today, 7);
  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button type="button" size={size} variant="outline" aria-disabled={busy} aria-label={`Rimanda: ${actionName(target)}`}>
            Rimanda
            <ChevronDownIcon aria-hidden="true" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="start" sideOffset={4} className="z-50 min-w-56 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
            <DropdownMenu.Item className={itemCls} onSelect={() => pick(tomorrow)}>
              Domani <span className="text-xs text-slate-500">{fmtWeekday(tomorrow)}</span>
            </DropdownMenu.Item>
            <DropdownMenu.Item className={itemCls} onSelect={() => pick(nextWeek)}>
              Tra una settimana <span className="text-xs text-slate-500">{fmtWeekday(nextWeek)}</span>
            </DropdownMenu.Item>
            <DropdownMenu.Item className={itemCls} onSelect={() => setChoosing(true)}>
              Scegli una data…
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {choosing && <PickDateDialog target={target} today={today} onClose={() => setChoosing(false)} onPick={pick} />}
    </>
  );
}

function PickDateDialog({ target, today, onClose, onPick }: { target: NextActionTarget; today: string; onClose: () => void; onPick: (on: string) => void }) {
  const uid = useId();
  const [on, setOn] = useState(addDays(today, 1));
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!on) {
      setError('Scegli la data della prossima azione.');
      return;
    }
    onClose();
    onPick(on);
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Rimanda a una data</DialogTitle>
            <DialogDescription>{actionName(target)}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${uid}-date`} className="text-xs font-medium text-slate-600">
              Nuova data
            </label>
            <Input
              id={`${uid}-date`}
              type="date"
              value={on}
              onChange={(e) => setOn(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${uid}-error` : on && on < today ? `${uid}-past` : undefined}
              autoFocus
              className="w-auto"
            />
            {error && (
              <p id={`${uid}-error`} className="text-xs text-red-700">
                {error}
              </p>
            )}
            {!error && on && on < today && (
              <p id={`${uid}-past`} className="text-xs text-amber-800">
                Data passata: comparirà come scaduta.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Annulla
            </Button>
            <Button type="submit">Rimanda</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// "Imposta la prossima" dal toast di Fatto: dialog globale (la riga di Oggi può essere già sparita)
// ---------------------------------------------------------------------------

type DialogTarget = { id: number; full_name: string | null };
const listeners = new Set<(t: DialogTarget) => void>();

/** Apre il dialog *"Prossima azione per <persona>"* (host montato nel layout). */
export function openNextActionDialog(target: DialogTarget): void {
  for (const listener of listeners) listener(target);
}

/** Host del dialog di "Imposta la prossima": una volta nel layout. */
export function NextActionDialogHost() {
  const [target, setTarget] = useState<DialogTarget | null>(null);
  useEffect(() => {
    listeners.add(setTarget);
    return () => {
      listeners.delete(setTarget);
    };
  }, []);
  if (!target) return null;
  return <SetNextActionDialog key={target.id} target={target} onClose={() => setTarget(null)} />;
}

function SetNextActionDialog({ target, onClose }: { target: DialogTarget; onClose: () => void }) {
  const uid = useId();
  const queryClient = useQueryClient();
  const today = todayLocal();
  const [value, setValue] = useState<NextActionValue>({ on: '', text: '' });
  const [dateError, setDateError] = useState<string | null>(null);
  const save = useMutation({
    // Dopo Fatto non c'è una prossima azione: se nel frattempo qualcuno l'ha impostata, 409 invece di sovrascriverla.
    mutationFn: (v: NextActionValue) => api.prospects.setNextAction(target.id, { on: v.on, text: v.text.trim() || null, expectedSetAt: null }),
    onSuccess: (detail, v) => {
      void refreshAfterWrite(queryClient, detail);
      toast({ title: `Prossima azione impostata: ${fmtWeekday(v.on)}` });
      onClose();
    },
    onError: (err) => {
      if (isChanged(err)) {
        onChangedElsewhere(queryClient);
        onClose();
      }
    },
  });
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
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="sm:max-w-lg"
        onCloseAutoFocus={(event) => {
          // Aperto dal toast (già chiuso): il focus va sulla prossima azione della scheda, altrimenti sul titolo della pagina.
          event.preventDefault();
          focusOrPageTitle(document.querySelector<HTMLElement>('[data-next-action-primary]'));
        }}
      >
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Prossima azione per {who(target)}</DialogTitle>
            <DialogDescription>Una data e, se vuoi, cosa fare.</DialogDescription>
          </DialogHeader>
          <NextActionFields value={value} onChange={setValue} today={today} dateError={dateError} dateId={`${uid}-date`} disabled={save.isPending} />
          {save.error && !isChanged(save.error) && (
            <p role="alert" className="text-sm text-red-700">
              Salvataggio non riuscito: {errorText(save.error)}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Annulla
            </Button>
            <Button type="submit" disabled={save.isPending} aria-busy={save.isPending}>
              {save.isPending ? 'Salvataggio…' : 'Salva prossima azione'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
