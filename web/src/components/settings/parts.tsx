import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { api, queryKeys } from '../../api/client';
import type { Settings } from '../../api/types';
import { ErrorBox, Loading } from '../ui';

/*
 * Pezzi condivisi dalle sezioni delle Impostazioni (people-first-crm T31): classi dei form e delle tabelle,
 * formati di data di "I miei post" e il caricamento delle impostazioni, uguale per le tre pagine.
 */

export const labelCls = 'text-xs font-medium text-slate-600';
export const textareaCls =
  'min-h-20 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';
export const th = 'px-4 py-2 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase';
export const td = 'px-4 py-2.5 align-top text-sm';

const rtf = new Intl.RelativeTimeFormat('it', { numeric: 'auto' });

/** "5 minuti fa", "ieri", "3 giorni fa"; oltre un mese la data. */
export function fmtRelative(iso: string, now = Date.now()): string {
  const diff = (Date.parse(iso) - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return 'adesso';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 30 * 86_400) return rtf.format(Math.round(diff / 86_400), 'day');
  return fmtDay(iso);
}

export function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function Time({ iso, relative = false }: { iso: string; relative?: boolean }) {
  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString('it-IT')}>
      {relative ? fmtRelative(iso) : fmtDay(iso)}
    </time>
  );
}

export const nf = (value: number | null) => (value === null ? '—' : value.toLocaleString('it-IT'));

/** Caricamento non riuscito di una sezione: avviso e "Riprova" (FLOW: error path di ogni sezione). */
export function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 px-4 py-3">
      <ErrorBox error={error} />
      <Button type="button" variant="outline" onClick={onRetry}>
        Riprova
      </Button>
    </div>
  );
}

/**
 * Impostazioni già caricate per le sezioni (una sola query condivisa da React Query): finché non ci sono
 * mostra il caricamento, e in caso d'errore l'avviso con "Riprova".
 */
export function SettingsData({ children }: { children: (settings: Settings) => ReactNode }) {
  const settings = useQuery({ queryKey: queryKeys.settings, queryFn: api.settings.get });
  if (settings.isPending) return <Loading />;
  if (settings.error) return <LoadError error={settings.error} onRetry={() => void settings.refetch()} />;
  return <>{children(settings.data)}</>;
}
