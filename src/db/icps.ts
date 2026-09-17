import { db, nowIso } from './index.js';
import type { ReferenceOutcome } from './schema.js';
import type { Company } from './companies.js';
import { getSettings } from './settings.js';
import { cleanList, cleanText } from '../util/fields.js';

/**
 * ICP e aziende di riferimento (PLAN crm-foundation §6 `icps`,
 * `icp_reference_companies`). Le colonne JSON (`target_*`) escono come array.
 */

export interface Icp {
  id: number;
  name: string;
  description: string | null;
  target_roles: string[];
  target_industries: string[];
  target_locations: string[];
  company_size: string | null;
  pains: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Riga di `GET /api/icps`. `lists_count` conta anche le liste archiviate (bloccano la cancellazione). */
export interface IcpListItem extends Icp {
  lists_count: number;
  reference_companies_count: number;
}

/** Azienda di riferimento di un ICP: esito e note del riferimento + l'azienda completa. */
export interface ReferenceCompany {
  icp_id: number;
  company_id: number;
  outcome: ReferenceOutcome;
  notes: string | null;
  company: Company;
}

export interface IcpListRef {
  id: number;
  name: string;
  archived_at: string | null;
}

/** `GET /api/icps/:id`: l'ICP con riferimenti e liste. */
export interface IcpDetail extends Icp {
  reference_companies: ReferenceCompany[];
  lists: IcpListRef[];
}

/** Campi scrivibili (create: `name` obbligatorio; patch: tutti facoltativi). */
export interface IcpInput {
  name?: string;
  description?: string | null;
  target_roles?: string[];
  target_industries?: string[];
  target_locations?: string[];
  company_size?: string | null;
  pains?: string | null;
  notes?: string | null;
}

const JSON_FIELDS = ['target_roles', 'target_industries', 'target_locations'] as const;
const TEXT_FIELDS = ['description', 'company_size', 'pains', 'notes'] as const;

type IcpRow = Omit<Icp, (typeof JSON_FIELDS)[number]> & Record<(typeof JSON_FIELDS)[number], string>;

function parseIcp<T extends IcpRow>(row: T): Omit<T, (typeof JSON_FIELDS)[number]> & Icp {
  return {
    ...row,
    target_roles: JSON.parse(row.target_roles),
    target_industries: JSON.parse(row.target_industries),
    target_locations: JSON.parse(row.target_locations),
  };
}

/** Valori di colonna normalizzati (trim, vuoti → null, array puliti) per i soli campi presenti. */
function columnValues(input: IcpInput): Record<string, string | null> {
  const values: Record<string, string | null> = {};
  if (input.name !== undefined) values.name = input.name.trim();
  for (const f of TEXT_FIELDS) if (input[f] !== undefined) values[f] = cleanText(input[f]);
  for (const f of JSON_FIELDS) if (input[f] !== undefined) values[f] = JSON.stringify(cleanList(input[f]));
  return values;
}

export function listIcps(): IcpListItem[] {
  const rows = db
    .prepare(
      `SELECT i.*,
         (SELECT COUNT(*) FROM lists l WHERE l.icp_id = i.id) AS lists_count,
         (SELECT COUNT(*) FROM icp_reference_companies r WHERE r.icp_id = i.id) AS reference_companies_count
       FROM icps i
       ORDER BY i.name COLLATE NOCASE, i.id`,
    )
    .all() as Array<IcpRow & { lists_count: number; reference_companies_count: number }>;
  return rows.map(parseIcp);
}

export function getIcp(id: number): Icp | undefined {
  const row = db.prepare(`SELECT * FROM icps WHERE id = ?`).get(id) as IcpRow | undefined;
  return row && parseIcp(row);
}

export function getIcpDetail(id: number): IcpDetail | undefined {
  const icp = getIcp(id);
  if (!icp) return undefined;
  const lists = db
    .prepare(
      `SELECT id, name, archived_at FROM lists WHERE icp_id = ?
       ORDER BY archived_at IS NOT NULL, name COLLATE NOCASE, id`,
    )
    .all(id) as IcpListRef[];
  return { ...icp, reference_companies: listReferenceCompanies(id), lists };
}

/** Crea un ICP; `name` (trim) deve essere non vuoto — la validazione è della route. */
export function createIcp(input: IcpInput & { name: string }): Icp {
  const values = columnValues(input);
  const now = nowIso();
  const cols = [...Object.keys(values), 'created_at', 'updated_at'];
  const { lastInsertRowid } = db
    .prepare(`INSERT INTO icps (${cols.join(', ')}) VALUES (${cols.map((c) => '@' + c).join(', ')})`)
    .run({ ...values, created_at: now, updated_at: now });
  return getIcp(Number(lastInsertRowid))!;
}

/** Aggiorna solo i campi presenti. `undefined` se l'ICP non esiste. */
export function updateIcp(id: number, patch: IcpInput): Icp | undefined {
  if (!getIcp(id)) return undefined;
  const values = { ...columnValues(patch), updated_at: nowIso() };
  const sets = Object.keys(values).map((c) => `${c} = @${c}`);
  db.prepare(`UPDATE icps SET ${sets.join(', ')} WHERE id = @id`).run({ ...values, id });
  return getIcp(id);
}

/** Liste dell'ICP, archiviate incluse: finché ce n'è almeno una l'ICP non si cancella (FK RESTRICT). */
export function countIcpLists(id: number): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM lists WHERE icp_id = ?`).get(id) as { n: number }).n;
}

/**
 * Cancella l'ICP (a cascata riferimenti e analisi). Il chiamante controlla prima
 * `countIcpLists`: con liste presenti la FK RESTRICT fa fallire il DELETE.
 * Ritorna `false` se l'ICP non esiste.
 */
export function deleteIcp(id: number): boolean {
  return db.prepare(`DELETE FROM icps WHERE id = ?`).run(id).changes > 0;
}

/** Aziende di riferimento dell'ICP, ordinate per nome azienda. */
export function listReferenceCompanies(icpId: number): ReferenceCompany[] {
  const rows = db
    .prepare(
      `SELECT r.icp_id, r.company_id, r.outcome, r.notes AS ref_notes, c.*
       FROM icp_reference_companies r
       JOIN companies c ON c.id = r.company_id
       WHERE r.icp_id = ?
       ORDER BY c.name COLLATE NOCASE, c.id`,
    )
    .all(icpId) as Array<Company & { icp_id: number; company_id: number; outcome: ReferenceOutcome; ref_notes: string | null }>;
  return rows.map(({ icp_id, company_id, outcome, ref_notes, ...company }) => ({
    icp_id,
    company_id,
    outcome,
    notes: ref_notes,
    company,
  }));
}

/** Riferimento singolo, o `undefined` se l'azienda non è tra i riferimenti dell'ICP. */
export function getReferenceCompany(icpId: number, companyId: number): ReferenceCompany | undefined {
  return listReferenceCompanies(icpId).find((r) => r.company_id === companyId);
}

/**
 * Crea o aggiorna il riferimento (upsert su PK `(icp_id, company_id)`): alla creazione
 * `outcome` vale `'riferimento'` se assente; in aggiornamento cambiano solo i campi
 * presenti. ICP e azienda devono esistere (FK): il controllo è del chiamante.
 */
export function setReferenceCompany(
  icpId: number,
  companyId: number,
  input: { outcome?: ReferenceOutcome; notes?: string | null } = {},
): ReferenceCompany {
  db.prepare(
    `INSERT INTO icp_reference_companies (icp_id, company_id, outcome, notes)
     VALUES (@icpId, @companyId, COALESCE(@outcome, 'riferimento'), @notes)
     ON CONFLICT (icp_id, company_id) DO UPDATE SET
       outcome = COALESCE(@outcome, outcome),
       notes = CASE WHEN @setNotes THEN @notes ELSE notes END`,
  ).run({
    icpId,
    companyId,
    outcome: input.outcome ?? null,
    notes: cleanText(input.notes),
    setNotes: input.notes !== undefined ? 1 : 0,
  });
  return getReferenceCompany(icpId, companyId)!;
}

/** Rimuove il riferimento; `false` se non c'era. */
export function removeReferenceCompany(icpId: number, companyId: number): boolean {
  return (
    db.prepare(`DELETE FROM icp_reference_companies WHERE icp_id = ? AND company_id = ?`).run(icpId, companyId).changes > 0
  );
}

/** Contesto dell'analisi AI (T11): l'ICP, l'azienda dell'utente (da `settings`) e i riferimenti con esito. */
export interface IcpContext {
  icp: Icp;
  company: { name: string | null; description: string | null; offering: string | null };
  referenceCompanies: ReferenceCompany[];
}

/** `null` se l'ICP non esiste. */
export function getIcpContext(icpId: number): IcpContext | null {
  const icp = getIcp(icpId);
  if (!icp) return null;
  const s = getSettings();
  return {
    icp,
    company: { name: s.company_name, description: s.company_description, offering: s.company_offering },
    referenceCompanies: listReferenceCompanies(icpId),
  };
}

