/**
 * Aiuti puri per i client HTTP dei fornitori (`src/apollo/client.ts`, `src/cloudflare/client.ts`): nessun accesso a
 * config o DB, così li importano anche gli script di verifica manuale.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Testo su una riga e al più `max` caratteri: gli errori riportano estratti dei messaggi, mai corpi interi. */
export function shorten(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** Millisecondi chiesti da `retry-after` (secondi o data HTTP); assente o illeggibile → `undefined`. */
export function retryAfterMs(header: string | null, now: number): number | undefined {
  const raw = header?.trim() ?? '';
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Number(raw) * 1000;
  if (raw === '') return undefined;
  const at = Date.parse(raw);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

/** Perché una richiesta non ha avuto risposta: timeout, oppure il messaggio con il codice della causa. */
export function networkReason(err: unknown, timeoutMs: number): string {
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return `timeout dopo ${timeoutMs / 1000} s`;
  }
  const message = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error && isRecord(err.cause) && typeof err.cause.code === 'string' ? err.cause.code : '';
  return shorten(cause && !message.includes(cause) ? `${message}: ${cause}` : message);
}
