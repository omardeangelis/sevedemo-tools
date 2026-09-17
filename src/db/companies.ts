import { cleanText, normalizeCompanyUrl } from '../util/fields.js';
import { db, nowIso } from './index.js';
import type { ReferenceOutcome } from './schema.js';

/**
 * Aziende (PLAN crm-foundation §6 `companies`). Identità = `linkedin_url`
 * normalizzato con `normalizeCompanyUrl` (UNIQUE): i chiamanti passano l'URL
 * grezzo, la normalizzazione avviene qui.
 */

/** Riga di `companies` così come salvata. */
export interface Company {
  id: number;
  linkedin_url: string;
  name: string | null;
  website: string | null;
  industry: string | null;
  size: string | null;
  location: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** ICP di cui l'azienda è riferimento, con esito e note del riferimento. */
export interface CompanyReferenceOf {
  icp_id: number;
  icp_name: string;
  outcome: ReferenceOutcome;
  notes: string | null;
}

/** Payload di lista e dettaglio (`GET /api/companies[/:id]`). */
export interface CompanyWithRefs extends Company {
  reference_of: CompanyReferenceOf[];
  /** Prospect collegati (`prospects.company_id`). */
  prospects_count: number;
}

/** Campi scrivibili; `linkedin_url` è l'URL grezzo (normalizzato qui). */
export interface CompanyInput {
  linkedin_url?: string;
  name?: string | null;
  website?: string | null;
  industry?: string | null;
  size?: string | null;
  location?: string | null;
  notes?: string | null;
}

const TEXT_FIELDS = ['name', 'website', 'industry', 'size', 'location', 'notes'] as const;

/** URL normalizzato o eccezione: i chiamanti HTTP validano prima con `normalizeCompanyUrl` (400). */
function requireCompanyUrl(raw: string): string {
  const url = normalizeCompanyUrl(raw);
  if (!url) throw new Error(`URL aziendale LinkedIn non valido: ${raw}`);
  return url;
}

/** Slug leggibile di un URL già normalizzato (decodificato se percent-encoded). */
function companySlug(url: string): string {
  const slug = url.slice(url.lastIndexOf('/') + 1);
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}

export function getCompany(id: number): Company | undefined {
  return db.prepare(`SELECT * FROM companies WHERE id = ?`).get(id) as Company | undefined;
}

/** Azienda con lo stesso URL normalizzato; `undefined` se assente o se l'URL non è una company LinkedIn. */
export function findCompanyByUrl(rawUrl: string): Company | undefined {
  const url = normalizeCompanyUrl(rawUrl);
  if (!url) return undefined;
  return db.prepare(`SELECT * FROM companies WHERE linkedin_url = ?`).get(url) as Company | undefined;
}

/** Aggiunge `reference_of` e `prospects_count` (due query, raggruppate in memoria). */
function withRefs(companies: Company[]): CompanyWithRefs[] {
  if (companies.length === 0) return [];
  const ids = companies.map((c) => c.id);
  const marks = ids.map(() => '?').join(', ');
  const refs = db
    .prepare(
      `SELECT r.company_id, r.icp_id, i.name AS icp_name, r.outcome, r.notes
       FROM icp_reference_companies r JOIN icps i ON i.id = r.icp_id
       WHERE r.company_id IN (${marks})
       ORDER BY i.name COLLATE NOCASE, i.id`,
    )
    .all(...ids) as Array<CompanyReferenceOf & { company_id: number }>;
  const counts = db
    .prepare(`SELECT company_id, COUNT(*) AS n FROM prospects WHERE company_id IN (${marks}) GROUP BY company_id`)
    .all(...ids) as Array<{ company_id: number; n: number }>;
  const countById = new Map(counts.map((r) => [r.company_id, r.n]));
  const refsById = new Map<number, CompanyReferenceOf[]>();
  for (const { company_id, ...ref } of refs) refsById.set(company_id, [...(refsById.get(company_id) ?? []), ref]);
  return companies.map((c) => ({
    ...c,
    reference_of: refsById.get(c.id) ?? [],
    prospects_count: countById.get(c.id) ?? 0,
  }));
}

/** Tutte le aziende per nome; `q` filtra per nome o URL (sottostringa, case-insensitive). */
export function listCompanies(filters: { q?: string } = {}): CompanyWithRefs[] {
  const q = cleanText(filters.q);
  const rows = db
    .prepare(
      `SELECT * FROM companies
       WHERE @q IS NULL OR name LIKE @like OR linkedin_url LIKE @like
       ORDER BY name COLLATE NOCASE, id`,
    )
    .all({ q, like: `%${q ?? ''}%` }) as Company[];
  return withRefs(rows);
}

export function getCompanyDetail(id: number): CompanyWithRefs | undefined {
  const company = getCompany(id);
  return company && withRefs([company])[0];
}

/**
 * Crea l'azienda. Senza `name` usa lo slug dell'URL (modificabile), così la UI e i
 * prompt hanno sempre un'etichetta. URL già presente → errore UNIQUE di SQLite:
 * i chiamanti controllano prima con `findCompanyByUrl`.
 */
export function createCompany(input: CompanyInput & { linkedin_url: string }): Company {
  const linkedin_url = requireCompanyUrl(input.linkedin_url);
  const now = nowIso();
  const values: Record<string, string | null> = { linkedin_url, created_at: now, updated_at: now };
  for (const f of TEXT_FIELDS) values[f] = cleanText(input[f]);
  values.name ??= companySlug(linkedin_url);
  const cols = Object.keys(values);
  const { lastInsertRowid } = db
    .prepare(`INSERT INTO companies (${cols.join(', ')}) VALUES (${cols.map((c) => '@' + c).join(', ')})`)
    .run(values);
  return getCompany(Number(lastInsertRowid))!;
}

/**
 * Aggiorna solo i campi presenti (`linkedin_url` normalizzato). `undefined` se l'azienda
 * non esiste; un URL già usato da un'altra azienda → errore UNIQUE (controllo del chiamante).
 */
export function updateCompany(id: number, patch: CompanyInput): Company | undefined {
  if (!getCompany(id)) return undefined;
  const values: Record<string, string | null> = { updated_at: nowIso() };
  if (patch.linkedin_url !== undefined) values.linkedin_url = requireCompanyUrl(patch.linkedin_url);
  for (const f of TEXT_FIELDS) if (patch[f] !== undefined) values[f] = cleanText(patch[f]);
  const sets = Object.keys(values).map((c) => `${c} = @${c}`);
  db.prepare(`UPDATE companies SET ${sets.join(', ')} WHERE id = @id`).run({ ...values, id });
  return getCompany(id);
}
