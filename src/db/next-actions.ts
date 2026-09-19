import { db, nowIso } from './index.js';

/*
 * Prossima azione (people-first-crm G1, G6): al più una per persona, data di calendario `YYYY-MM-DD`
 * obbligatoria + testo breve facoltativo + quando è stata impostata. Impostarla o toglierla non cambia lo
 * stato né le liste e non scrive in timeline (solo "Fatto" lo fa, G4). Scaduta/oggi/futura è un derivato.
 */

export interface NextActionInput {
  /** `YYYY-MM-DD` già validata. */
  on: string;
  text?: string | null;
}

function cleanText(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** Imposta o sostituisce la prossima azione. `false` se la persona non esiste. */
export function setNextAction(prospectId: number, input: NextActionInput): boolean {
  const now = nowIso();
  const info = db
    .prepare('UPDATE prospects SET next_action_on = ?, next_action_text = ?, next_action_set_at = ?, updated_at = ? WHERE id = ?')
    .run(input.on, cleanText(input.text), now, now, prospectId);
  return info.changes > 0;
}

/** Rimuove la prossima azione (errore di inserimento, senza timeline). `false` se la persona non esiste. */
export function clearNextAction(prospectId: number): boolean {
  const info = db
    .prepare('UPDATE prospects SET next_action_on = NULL, next_action_text = NULL, next_action_set_at = NULL, updated_at = ? WHERE id = ?')
    .run(nowIso(), prospectId);
  return info.changes > 0;
}
