import { useEffect, useState } from 'react';
import type { NextActionState } from '../api/types';

/*
 * Date di calendario nel fuso del computer dell'utente (people-first-crm Terminologia, PLAN P-4): "oggi", "scaduta",
 * "prossimi 7 giorni" si calcolano qui e il server riceve `today=YYYY-MM-DD`.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** Oggi locale `YYYY-MM-DD`. */
export function todayLocal(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Giorno `YYYY-MM-DD` spostato di `days` (calendario). */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return todayLocal(new Date(y, m - 1, d + days));
}

const asDate = (day: string) => new Date(`${day}T00:00:00`);
const weekdayFmt = new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
const shortFmt = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' });
const longFmt = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });

/** "lun 15 set" */
export function fmtWeekday(day: string): string {
  return weekdayFmt.format(asDate(day)).replace(',', '');
}

/** "12 set" (giorno `YYYY-MM-DD` o ISO). */
export function fmtDayMonth(dayOrIso: string): string {
  const d = dayOrIso.length === 10 ? asDate(dayOrIso) : new Date(dayOrIso);
  return Number.isNaN(d.getTime()) ? '—' : shortFmt.format(d);
}

/** "giovedì 18 settembre" */
export function fmtLongDay(day: string): string {
  return longFmt.format(asDate(day));
}

/** Stato della prossima azione rispetto a oggi (G3), calcolato come sul server. */
export function nextActionStateOf(on: string | null, today: string): NextActionState | null {
  if (!on) return null;
  return on < today ? 'scaduta' : on === today ? 'oggi' : 'futura';
}

/** Testo della data della prossima azione, mai solo colore (G3): "Scaduta · lun 15 set" · "Oggi" · "ven 19 set". */
export function nextActionDateText(on: string, today: string): string {
  const state = nextActionStateOf(on, today);
  if (state === 'scaduta') return `Scaduta · ${fmtWeekday(on)}`;
  if (state === 'oggi') return 'Oggi';
  return fmtWeekday(on);
}

/** Oggi locale che si aggiorna quando la pagina torna visibile (FLOW Edge "Date"). */
export function useToday(): string {
  const [today, setToday] = useState(todayLocal);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') setToday(todayLocal());
    };
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, []);
  return today;
}
