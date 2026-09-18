/** "2026-06-11" → "giovedì 11 giugno 2026" */
export function fmtDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('it-IT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function fmtDateShort(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('it-IT', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/** Conteggio in italiano: `1234` → `"1.234"`; `undefined` → `"0"`. */
export function fmtCount(value: number | undefined): string {
  return (value ?? 0).toLocaleString('it-IT');
}

/** Conteggio con il nome al singolare o al plurale: `countText(2, 'lista', 'liste')` → `"2 liste"`. */
export function countText(n: number | undefined, one: string, many: string): string {
  return `${fmtCount(n)} ${n === 1 ? one : many}`;
}

/** Nome di una riga azienda (candidata, referenza, ambito): nome, altrimenti dominio, altrimenti "Azienda #id". */
export function companyRowName(c: { company_id: number; name: string | null; domain: string | null }): string {
  return c.name ?? c.domain ?? `Azienda #${c.company_id}`;
}

/** Testo di un campo del form: `null` se vuoto, altrimenti senza spazi ai bordi. */
export const orNull = (value: string) => (value.trim() === '' ? null : value.trim());

export function initials(name: string | null): string {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}
