import { db, nowIso } from './index.js';

/*
 * Dati impostati a mano (people-first-crm D7, D8, E9; PLAN P-3). `prospects.manual_fields` = `{colonna: ISO}`:
 * chiave presente = l'utente ha scritto, scelto o svuotato quel campo (o il collegamento all'azienda) dalla UI,
 * con la data; assente = mai toccato a mano. I job scrivono le colonne della persona **solo** con `jobAssign`,
 * così un campo marcato non si sovrascrive né si riempie, in ogni scrittore.
 */

/** Anagrafica e collegamento all'azienda che l'utente può impostare a mano (D8 + D7). */
export const MANUAL_COLUMNS = [
  'full_name',
  'headline',
  'about',
  'location',
  'email',
  'phone',
  'company_name',
  'title',
  'company_id',
] as const;
export type ManualColumn = (typeof MANUAL_COLUMNS)[number];
export type ManualFields = Partial<Record<ManualColumn, string>>;

/** `manual_fields` letto dal DB (JSON) come oggetto; valori non stringa o JSON rotto → ignorati. */
export function parseManualFields(json: string | null | undefined): ManualFields {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [ManualColumn, string] => (MANUAL_COLUMNS as readonly string[]).includes(entry[0]) && typeof entry[1] === 'string',
      ),
    );
  } catch {
    return {};
  }
}

/** Marca `columns` come impostate a mano adesso (o `at`). Da chiamare nella stessa transazione della scrittura. */
export function markManual(prospectId: number, columns: readonly ManualColumn[], at: string = nowIso()): void {
  if (columns.length === 0) return;
  const paths = columns.flatMap((c) => [`$.${c}`, at]);
  db.prepare(`UPDATE prospects SET manual_fields = json_set(manual_fields, ${columns.map(() => '?, ?').join(', ')}) WHERE id = ?`).run(
    ...paths,
    prospectId,
  );
}

/**
 * Espressione SQL per `SET <col> = …` negli scrittori dei job: il valore attuale se la colonna è marcata a
 * mano, altrimenti `valueSql` (es. `COALESCE(?, col)`). `col` è una costante di `MANUAL_COLUMNS`, mai input.
 */
export function jobAssign(col: ManualColumn, valueSql: string): string {
  return `CASE WHEN json_type(manual_fields, '$.${col}') IS NOT NULL THEN ${col} ELSE ${valueSql} END`;
}
