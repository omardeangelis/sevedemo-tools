import { useEffect, useState, type ReactNode } from 'react';
import { XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/*
 * Notifiche in-app a quattro toni (FLOW "Esito a tre toni" + errore): `success` (verde),
 * `neutral` (grigio: zero risultati, mai rosso), `warning` (ambra), `error` (rosso, solo per
 * `failed`). Avvisi ed errori hanno un prefisso visibile ("Attenzione:", "Errore:") così il tono
 * si legge anche senza colore. Sostituisce `pushToast`/`ToastHost` di `components/ui.tsx`, che resta
 * montato nel layout solo per compatibilità.
 */

export type ToastTone = 'success' | 'neutral' | 'warning' | 'error';

export interface ToastOptions {
  /** Id stabile: un secondo `toast` con lo stesso id sostituisce il primo; serve a `dismissToast`. */
  id?: string;
  tone?: ToastTone;
  title: string;
  description?: ReactNode;
  /** Azione (link o bottone) sotto il testo, es. "Apri Inbox". */
  action?: ReactNode;
  /** Resta finché l'utente non lo chiude (esiti dei job). Default: si chiude da solo (8 s, errori 20 s). */
  persistent?: boolean;
  /** Chiamata quando l'utente lo chiude (non allo scadere automatico). */
  onDismiss?: () => void;
}

interface ToastEntry extends ToastOptions {
  id: string;
  tone: ToastTone;
}

type Listener = (event: { type: 'add'; toast: ToastEntry } | { type: 'dismiss'; id: string }) => void;

let seq = 0;
const listeners = new Set<Listener>();

/** Mostra una notifica da qualunque punto dell'app (il `Toaster` vive nel layout root). Ritorna l'id. */
export function toast(options: ToastOptions): string {
  const entry: ToastEntry = { ...options, id: options.id ?? `toast-${++seq}`, tone: options.tone ?? 'success' };
  for (const listener of listeners) listener({ type: 'add', toast: entry });
  return entry.id;
}

/** Chiude una notifica per id (nessun effetto se non c'è), senza chiamare `onDismiss`. */
export function dismissToast(id: string): void {
  for (const listener of listeners) listener({ type: 'dismiss', id });
}

/** Prefisso visibile solo dove il colore non basta (avvisi ed errori); i successi hanno già un titolo esplicito. */
const TONE: Record<ToastTone, { box: string; title: string; text: string; prefix: string | null }> = {
  success: { box: 'border-emerald-200 bg-emerald-50', title: 'text-emerald-900', text: 'text-emerald-800', prefix: null },
  neutral: { box: 'border-slate-200 bg-white', title: 'text-slate-900', text: 'text-slate-600', prefix: null },
  warning: { box: 'border-amber-200 bg-amber-50', title: 'text-amber-900', text: 'text-amber-800', prefix: 'Attenzione' },
  error: { box: 'border-red-200 bg-red-50', title: 'text-red-900', text: 'text-red-800', prefix: 'Errore' },
};

/** Host delle notifiche: montarlo una volta nel layout root. */
export function Toaster() {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  useEffect(() => {
    const listener: Listener = (event) => {
      if (event.type === 'dismiss') setToasts((cur) => cur.filter((t) => t.id !== event.id));
      else setToasts((cur) => [...cur.filter((t) => t.id !== event.toast.id), event.toast]);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  const remove = (id: string) => setToasts((cur) => cur.filter((t) => t.id !== id));

  return (
    <section
      aria-label="Notifiche"
      className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2"
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onExpire={() => remove(t.id)} />
      ))}
    </section>
  );
}

function ToastCard({ toast: t, onExpire }: { toast: ToastEntry; onExpire: () => void }) {
  useEffect(() => {
    if (t.persistent) return;
    const handle = setTimeout(onExpire, t.tone === 'error' ? 20_000 : 8_000);
    return () => clearTimeout(handle);
    // Il timer riparte solo se cambia la notifica (stesso id sostituito).
  }, [t]);
  const tone = TONE[t.tone];
  return (
    <div
      role={t.tone === 'error' ? 'alert' : 'status'}
      className={cn('pointer-events-auto rounded-xl border p-3 shadow-lg', tone.box)}
    >
      <div className="flex items-start justify-between gap-2">
        <p className={cn('text-sm font-semibold', tone.title)}>
          {tone.prefix && <span>{tone.prefix}: </span>}
          {t.title}
        </p>
        <button
          type="button"
          onClick={() => {
            onExpire();
            t.onDismiss?.();
          }}
          aria-label="Chiudi notifica"
          className="-mt-0.5 cursor-pointer rounded p-0.5 text-slate-400 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:outline-none"
        >
          <XIcon className="size-4" />
        </button>
      </div>
      {t.description && <div className={cn('mt-1 text-sm break-words', tone.text)}>{t.description}</div>}
      {t.action && <div className="mt-2 flex flex-wrap gap-2">{t.action}</div>}
    </div>
  );
}
