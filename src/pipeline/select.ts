import { db } from '../db/index.js';
import { config } from '../config.js';
import type { ContactRow } from '../db/contacts.js';

/**
 * Seleziona i migliori contatti di un bucket tra quelli con status 'scored',
 * sopra la soglia minima di fit, con un cap per settore per evitare monocultura.
 *
 * Eleggibilità = `scored` **e non già presente in alcuna Selezione** (membership):
 * un contatto proposto da un Run precedente (in revisione o esportato) è escluso da
 * solo; rimuoverlo da una Selezione lo rende di nuovo eleggibile automaticamente.
 */
export function selectBucket(bucket: 'freelance' | 'azienda', target: number, minFit: number): ContactRow[] {
  // Azienda-first (spec influencer-post-respondents): SOLO nel bucket azienda, a parità
  // di fit, la fonte primaria è ordinata per prima (chiave d'ordine leading). Il boost
  // agisce DENTRO l'ordinamento → il cap per settore può comunque mandare in overflow
  // un candidato della primaria. Il bucket freelance resta invariato.
  const aziendaFirst = bucket === 'azienda';
  const order = aziendaFirst
    ? `ORDER BY CASE WHEN source_strategy = ? THEN 0 ELSE 1 END, fit_score DESC, last_evaluated_at DESC`
    : `ORDER BY fit_score DESC, last_evaluated_at DESC`;
  const sql = `SELECT * FROM contacts
        WHERE bucket = ? AND status = 'scored' AND fit_score >= ?
          AND id NOT IN (SELECT contact_id FROM daily_selection)
        ${order}`;
  const params: unknown[] = aziendaFirst ? [bucket, minFit, config.primaryStrategyId] : [bucket, minFit];
  const candidates = db.prepare(sql).all(...params) as ContactRow[];

  // Cap per settore: max ~60% del target da un singolo settore, finché ci sono alternative.
  const perSectorCap = Math.max(1, Math.ceil(target * 0.6));
  const counts = new Map<string, number>();
  const picked: ContactRow[] = [];
  const overflow: ContactRow[] = [];

  for (const c of candidates) {
    if (picked.length >= target) break;
    const sector = c.sector ?? 'other';
    const n = counts.get(sector) ?? 0;
    if (n < perSectorCap) {
      counts.set(sector, n + 1);
      picked.push(c);
    } else {
      overflow.push(c);
    }
  }
  // Completa con l'overflow se non abbiamo raggiunto il target.
  for (const c of overflow) {
    if (picked.length >= target) break;
    picked.push(c);
  }
  return picked;
}
