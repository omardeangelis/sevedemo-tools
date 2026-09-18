/*
 * Testi degli esiti dei job: attribuzione degli errori (FLOW: actor / configurazione / processo) e piccoli
 * formati condivisi. Nessuna dipendenza dal server: `server/job-entry.ts` importa da qui.
 */

const ATTRIBUTED_RE = /^(actor|config|process):/;

/**
 * Messaggio attribuito di un errore: i messaggi già prefissati `actor:`/`config:`/`process:` restano, il
 * resto prende `fallbackPrefix` (default `process`, es. `actor:apollo:<op>`). Vuoto → "errore sconosciuto".
 */
export function attributeError(err: unknown, fallbackPrefix = 'process'): string {
  const message = (err instanceof Error ? err.message : String(err)).trim() || 'errore sconosciuto';
  return ATTRIBUTED_RE.test(message) ? message : `${fallbackPrefix}: ${message}`;
}

/** Errore di un'operazione Apollo (SPEC D13): i prefissi esistenti restano, il resto è di `actor:apollo:<op>:`. */
export function attributeApolloError(err: unknown, op: string): string {
  return attributeError(err, `actor:apollo:${op}`);
}

/** Accoda una frase al messaggio: spazio dopo la punteggiatura finale, altrimenti ". ". */
export function withTail(message: string, tail: string): string {
  return `${message}${/[.!?)]$/.test(message) ? ' ' : '. '}${tail}`;
}

/** "1 azienda" / "3 aziende". */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
