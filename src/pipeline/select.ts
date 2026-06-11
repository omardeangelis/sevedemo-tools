import { db } from '../db/index.js';
import type { ContactRow } from '../db/contacts.js';

/**
 * Seleziona i migliori contatti di un bucket tra quelli con status 'scored',
 * sopra la soglia minima di fit, con un cap per settore per evitare monocultura.
 */
export function selectBucket(bucket: 'freelance' | 'azienda', target: number, minFit: number): ContactRow[] {
  const candidates = db
    .prepare(
      `SELECT * FROM contacts
        WHERE bucket = ? AND status = 'scored' AND fit_score >= ?
        ORDER BY fit_score DESC, last_evaluated_at DESC`,
    )
    .all(bucket, minFit) as ContactRow[];

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
