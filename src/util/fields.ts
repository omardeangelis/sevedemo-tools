/** Utility tolleranti per leggere campi da output di actor con schemi non garantiti. */

/** Ritorna il primo campo non vuoto tra quelli indicati. */
export function field(obj: unknown, ...names: string[]): any {
  if (!obj || typeof obj !== 'object') return undefined;
  const rec = obj as Record<string, unknown>;
  for (const n of names) {
    const v = rec[n];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

/**
 * Normalizza un URL LinkedIn in una chiave stabile per il dedup:
 * https://www.linkedin.com/in/<slug> (senza query/hash/trailing slash).
 * Il case dello slug è preservato: gli URL member-ID (/in/ACwAA...) sono
 * case-sensitive e abbassarli di caso li rende irrisolvibili dall'enrichment.
 * Ritorna undefined se non è un URL valido.
 */
export function normalizeLinkedinUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  let u = raw.trim();
  if (!u) return undefined;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try {
    const url = new URL(u);
    if (!/linkedin\.com$/i.test(url.hostname) && !/\.linkedin\.com$/i.test(url.hostname)) {
      // non è un host linkedin: non lo usiamo come chiave
      return undefined;
    }
    const path = url.pathname.replace(/\/+$/, '');
    return 'https://www.linkedin.com' + path;
  } catch {
    return undefined;
  }
}

/**
 * True se l'email è presente: non null/undefined e non vuota dopo `.trim()`.
 * Definizione unica di "senza email" (assente / vuota / soli spazi); nessuna
 * validazione di sintassi — conta solo la presenza.
 */
export function hasEmail(email: string | null | undefined): boolean {
  return typeof email === 'string' && email.trim() !== '';
}

/** Tronca una stringa a maxLen caratteri (per non gonfiare i prompt). */
export function truncate(s: unknown, maxLen: number): string {
  if (typeof s !== 'string') {
    if (s == null) return '';
    try { s = JSON.stringify(s); } catch { s = String(s); }
  }
  const str = s as string;
  return str.length > maxLen ? str.slice(0, maxLen) + '…' : str;
}
