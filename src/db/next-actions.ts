import { addActivity, addTouchpoint, type TouchpointInput } from './activities.js';
import { db, nowIso } from './index.js';

/*
 * Prossima azione (people-first-crm G1–G6): al più una per persona, data di calendario `YYYY-MM-DD`
 * obbligatoria + testo breve facoltativo + quando è stata impostata. Impostarla, rimandarla o toglierla non
 * cambia lo stato né le liste e non scrive in timeline; solo "Fatto" lo fa (G4). Scaduta/oggi/futura è un
 * derivato. `next_action_set_at` fa anche da controllo di concorrenza: chi agisce da una vista vecchia (due
 * schede) manda quello che ha letto e, se nel frattempo è cambiato, riceve `changed`.
 */

export interface NextActionInput {
  /** `YYYY-MM-DD` già validata. */
  on: string;
  text?: string | null;
}

/** Esito di una scrittura con controllo: `changed` = la prossima azione non è più quella letta dal client. */
export type NextActionOutcome = 'ok' | 'not_found' | 'changed';

function cleanText(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** Nuovo `set_at`, sempre successivo al precedente (due scritture nello stesso millisecondo restano distinte). */
function nextSetAt(previous: string | null): string {
  const now = nowIso();
  return previous && now <= previous ? new Date(Date.parse(previous) + 1).toISOString() : now;
}

function currentSetAt(prospectId: number): { set_at: string | null } | undefined {
  const row = db.prepare('SELECT next_action_set_at FROM prospects WHERE id = ?').get(prospectId) as
    | { next_action_set_at: string | null }
    | undefined;
  return row && { set_at: row.next_action_set_at };
}

/** Imposta o sostituisce la prossima azione. `false` se la persona non esiste. */
export function setNextAction(prospectId: number, input: NextActionInput): boolean {
  const current = currentSetAt(prospectId);
  if (!current) return false;
  db.prepare('UPDATE prospects SET next_action_on = ?, next_action_text = ?, next_action_set_at = ?, updated_at = ? WHERE id = ?').run(
    input.on,
    cleanText(input.text),
    nextSetAt(current.set_at),
    nowIso(),
    prospectId,
  );
  return true;
}

/** Rimuove la prossima azione (errore di inserimento, senza timeline). `false` se la persona non esiste. */
export function clearNextAction(prospectId: number): boolean {
  const info = db
    .prepare('UPDATE prospects SET next_action_on = NULL, next_action_text = NULL, next_action_set_at = NULL, updated_at = ? WHERE id = ?')
    .run(nowIso(), prospectId);
  return info.changes > 0;
}

/** `expectedSetAt` assente = nessun controllo; `null` = "non ce n'era"; una data = quella letta dal client. */
function check(prospectId: number, expectedSetAt: string | null | undefined): NextActionOutcome {
  const current = currentSetAt(prospectId);
  if (!current) return 'not_found';
  return expectedSetAt !== undefined && current.set_at !== expectedSetAt ? 'changed' : 'ok';
}

/**
 * Imposta, modifica o **Rimanda** (G5: la nuova data la calcola il client da oggi) con il controllo di
 * concorrenza; `input` `null` = rimuovi.
 */
export function changeNextAction(prospectId: number, input: NextActionInput | null, expectedSetAt?: string | null): NextActionOutcome {
  return db
    .transaction((): NextActionOutcome => {
      const outcome = check(prospectId, expectedSetAt);
      if (outcome !== 'ok') return outcome;
      if (input) setNextAction(prospectId, input);
      else clearNextAction(prospectId);
      return 'ok';
    })
    .immediate();
}

/**
 * **Fatto** (G4): toglie la prossima azione e scrive in timeline *"Prossima azione completata"* col suo testo
 * (`meta.on` = la data che aveva). Stato e liste non cambiano (G6). Nessuna prossima azione o una diversa da
 * quella letta → `changed`.
 */
export function completeNextAction(prospectId: number, expectedSetAt: string): NextActionOutcome {
  return db
    .transaction((): NextActionOutcome => {
      const row = db.prepare('SELECT next_action_on, next_action_text, next_action_set_at FROM prospects WHERE id = ?').get(prospectId) as
        | { next_action_on: string | null; next_action_text: string | null; next_action_set_at: string | null }
        | undefined;
      if (!row) return 'not_found';
      if (row.next_action_on === null || row.next_action_set_at !== expectedSetAt) return 'changed';
      addActivity({ prospectId, kind: 'next_action_done', body: row.next_action_text, meta: { on: row.next_action_on } });
      clearNextAction(prospectId);
      return 'ok';
    })
    .immediate();
}

/**
 * Touchpoint con la prossima azione nello stesso passo (G2): la imposta o la sostituisce se `nextAction` c'è
 * (blocco vuoto = nessun cambio), in un'unica transazione. `null` se la persona non esiste.
 */
export function recordTouchpoint(prospectId: number, input: TouchpointInput, nextAction?: NextActionInput | null) {
  return db
    .transaction(() => {
      const result = addTouchpoint(prospectId, input);
      if (result && nextAction) setNextAction(prospectId, nextAction);
      return result;
    })
    .immediate();
}
