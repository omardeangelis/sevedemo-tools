import { defaultParseSearch } from '@tanstack/react-router';

/*
 * Origine della scheda persona (people-first-crm A7, PLAN P-9): il search param `from` porta path + query della
 * vista da cui la si è aperta, così "indietro" riporta lì con filtri e pagina anche dopo un reload. Sono ammessi
 * solo percorsi interni: `/` (Oggi), `/people`, `/lists/<id>`, `/companies/<id>`, ciascuno con la sua query; tutto
 * il resto (`//host`, schemi, altri percorsi) si ignora: niente open redirect.
 */

export type OriginKind = 'today' | 'people' | 'list' | 'company';

export interface Origin {
  kind: OriginKind;
  /** Path interno (`/`, `/people`, `/lists/3`, `/companies/5`). */
  path: string;
  /** Query già interpretata come fa il router (numeri e booleani tipizzati). */
  search: Record<string, unknown>;
  /** Id della lista o dell'azienda (`list` / `company`). */
  id?: number;
}

/** `from` validato, `undefined` se non è un'origine ammessa. */
export function parseOrigin(from: unknown): Origin | undefined {
  if (typeof from !== 'string' || from.length > 2000) return undefined;
  if (!from.startsWith('/') || from.startsWith('//') || from.includes('\\') || /^[a-z][a-z0-9+.-]*:/i.test(from)) return undefined;
  const q = from.indexOf('?');
  const path = q === -1 ? from : from.slice(0, q);
  const query = q === -1 ? '' : from.slice(q);
  const search = query ? (defaultParseSearch(query) as Record<string, unknown>) : {};
  if (path === '/') return { kind: 'today', path, search };
  if (path === '/people') return { kind: 'people', path, search };
  const list = /^\/lists\/(\d+)$/.exec(path);
  if (list) return { kind: 'list', path, search, id: Number(list[1]) };
  const company = /^\/companies\/(\d+)$/.exec(path);
  if (company) return { kind: 'company', path, search, id: Number(company[1]) };
  return undefined;
}

/** Valore di `from` per un link alla scheda aperto dalla posizione corrente (path + query grezza). */
export function originOf(location: { pathname: string; searchStr: string }): string | undefined {
  const from = `${location.pathname}${location.searchStr}`;
  return parseOrigin(from) ? from : undefined;
}
