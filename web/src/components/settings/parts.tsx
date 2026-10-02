import type { ReactNode } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { api, queryKeys } from '../../api/client';
import { fmtDayMonth } from '../../lib/dates';
import type { FieldOrigin, Profile, Settings } from '../../api/types';
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

/** `short` = "28 set" (senza anno), per le righe di provenienza. */
export function Time({ iso, relative = false, short = false }: { iso: string; relative?: boolean; short?: boolean }) {
  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString('it-IT')}>
      {relative ? fmtRelative(iso) : short ? fmtDayMonth(iso) : fmtDay(iso)}
    </time>
  );
}

export const nf = (value: number | null) => (value === null ? '—' : value.toLocaleString('it-IT'));

/**
 * Provenienza di un valore del profilo o di un servizio (own-profile-services B6), in testo: *"scritto da te il
 * 28 set"* / *"dalla proposta del 20 set"*. Senza provenienza (valori di prima del rilascio, E14) non c'è niente.
 */
export function Origin({ origin, at }: { origin: FieldOrigin | null; at: string | null }) {
  if (origin === null || at === null) return null;
  const day = <Time iso={at} short />;
  return (
    <span className="text-xs text-slate-500">
      {origin === 'manual' ? <>scritto da te il {day}</> : <>dalla proposta del {day}</>}
    </span>
  );
}

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
  return <Loaded query={useQuery({ queryKey: queryKeys.settings, queryFn: api.settings.get })}>{children}</Loaded>;
}

/** Il profilo in una lettura sola (`GET /api/profile`, B7) per la pagina Profilo e azienda. */
export function ProfileData({ children }: { children: (profile: Profile) => ReactNode }) {
  return <Loaded query={useQuery({ queryKey: queryKeys.profile, queryFn: api.profile.get })}>{children}</Loaded>;
}

/**
 * Sezione con i dati caricati: prima i dati, così l'errore di una rilettura in background non toglie la pagina
 * già mostrata (e i testi non salvati nei form); l'avviso con "Riprova" solo se non c'è niente da mostrare.
 */
function Loaded<T>({ query, children }: { query: UseQueryResult<T>; children: (data: T) => ReactNode }) {
  if (query.data !== undefined) return <>{children(query.data)}</>;
  if (query.error) return <LoadError error={query.error} onRetry={() => void query.refetch()} />;
  return <Loading />;
}
