import { cleanText, normalizeCompanyUrl, normalizeDomain } from '../util/fields.js';
import { db } from './index.js';
import { personTextCondition } from './prospects.js';
import type { ProspectStatus } from './schema.js';

/*
 * Ricerca globale (people-first-crm SPEC I2–I3, PLAN P-18, T21): persone con la stessa condizione del filtro
 * testo di Persone (`personTextCondition`, B5 = I2; scartate comprese, con lo stato) e aziende per nome, dominio
 * e pagina LinkedIn (normalizzati, regola d'identità). Al più `SEARCH_LIMIT` risultati per gruppo con i totali;
 * sotto `SEARCH_MIN_CHARS` caratteri nessun risultato.
 */

export const SEARCH_LIMIT = 5;
export const SEARCH_MIN_CHARS = 2;

/** Persona trovata: seconda riga = ruolo e azienda (collegata o scritta), altrimenti la headline o l'email. */
export interface PersonHit {
  id: number;
  full_name: string | null;
  headline: string | null;
  email: string | null;
  title: string | null;
  company_name: string | null;
  linked_company_name: string | null;
  status: ProspectStatus;
}

/** Azienda trovata: seconda riga = dominio (o la pagina LinkedIn). */
export interface CompanyHit {
  id: number;
  name: string | null;
  domain: string | null;
  linkedin_url: string | null;
}

export interface SearchResult {
  people: PersonHit[];
  people_total: number;
  companies: CompanyHit[];
  companies_total: number;
}

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (m) => `\\${m}`);

/** Righe con il totale di tutte le corrispondenze (`COUNT(*) OVER ()`: una sola lettura per gruppo). */
function withTotal<T>(rows: Array<T & { total: number }>): { hits: T[]; total: number } {
  return { hits: rows.map(({ total: _, ...hit }) => hit as T), total: rows[0]?.total ?? 0 };
}

function searchPeople(q: string): Pick<SearchResult, 'people' | 'people_total'> {
  const cond = personTextCondition(q)!;
  const like = escapeLike(q);
  // Prima chi ha un nome (o un cognome) che inizia col testo, poi il resto; le scartate dopo, a parità.
  const rows = db
    .prepare(
      `SELECT p.id, p.full_name, p.headline, p.email, p.title, p.company_name, c.name AS linked_company_name, p.status,
              COUNT(*) OVER () AS total
       FROM prospects p LEFT JOIN companies c ON c.id = p.company_id
       WHERE ${cond.sql}
       ORDER BY CASE WHEN p.full_name LIKE ? ESCAPE '\\' THEN 0 WHEN p.full_name LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END,
                p.status = 'scartato', p.full_name COLLATE NOCASE, p.id
       LIMIT ?`,
    )
    .all(...cond.params, `${like}%`, `% ${like}%`, SEARCH_LIMIT) as Array<PersonHit & { total: number }>;
  const { hits, total } = withTotal(rows);
  return { people: hits, people_total: total };
}

function searchCompanies(q: string): Pick<SearchResult, 'companies' | 'companies_total'> {
  const where = `name LIKE @like ESCAPE '\\' OR domain LIKE @like ESCAPE '\\' OR linkedin_url LIKE @like ESCAPE '\\'
    OR linkedin_url = @linkedin OR domain = @domain`;
  const params = {
    like: `%${escapeLike(q)}%`,
    prefix: `${escapeLike(q)}%`,
    linkedin: normalizeCompanyUrl(q) ?? null,
    domain: /[.:/]/.test(q) ? (normalizeDomain(q) ?? null) : null,
  };
  const rows = db
    .prepare(
      `SELECT id, name, domain, linkedin_url, COUNT(*) OVER () AS total FROM companies WHERE ${where}
       ORDER BY name LIKE @prefix ESCAPE '\\' DESC, name COLLATE NOCASE, id LIMIT ${SEARCH_LIMIT}`,
    )
    .all(params) as Array<CompanyHit & { total: number }>;
  const { hits, total } = withTotal(rows);
  return { companies: hits, companies_total: total };
}

/** Ricerca globale (I2, I3): vuota sotto i 2 caratteri. */
export function searchAll(raw: string | undefined): SearchResult {
  const q = cleanText(raw);
  if (!q || q.length < SEARCH_MIN_CHARS) return { people: [], people_total: 0, companies: [], companies_total: 0 };
  return { ...searchPeople(q), ...searchCompanies(q) };
}
