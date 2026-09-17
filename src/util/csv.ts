/**
 * Primo carattere che Excel/LibreOffice/Sheets interpretano come formula (CSV injection, OWASP):
 * `=`, `+`, `-`, `@`, tab e ritorno a capo.
 */
const FORMULA_START = /^[=+\-@\t\r]/;
/** Numeri semplici (`-5`, `+3.2`): nessuna formula possibile, restano invariati. */
const PLAIN_NUMBER = /^[+-]?\d+(?:[.,]\d+)?$/;

/**
 * Cella CSV: null/undefined → vuota; le stringhe che inizierebbero una formula ricevono un apice
 * iniziale (il foglio le mostra come testo: i dati dei profili LinkedIn non sono fidati); quoting
 * RFC 4180 se contiene virgole, virgolette o newline.
 */
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && FORMULA_START.test(s) && !PLAIN_NUMBER.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/**
 * Serializza le righe in CSV con header = `columns`, nell'ordine indicato.
 * Le colonne computate (es. `email_ready`) vanno aggiunte alle righe dal chiamante.
 */
export function toCsv<T extends object>(rows: readonly T[], columns: ReadonlyArray<keyof T & string>): string {
  const header = columns.map(csvCell).join(',');
  const lines = rows.map((r) => columns.map((col) => csvCell(r[col])).join(','));
  return [header, ...lines].join('\n');
}
