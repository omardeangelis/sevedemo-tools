import { config } from '../config.js';
import { db } from '../db/index.js';
import type { ContactRow } from '../db/contacts.js';

export interface RunRow {
  id: number;
  run_date: string;
  strategy: string;
  actor_run_id: string | null;
  items_in: number;
  items_new: number;
  cost_estimate: number;
  created_at: string;
}

export function listRuns(): RunRow[] {
  return db
    .prepare('SELECT * FROM runs ORDER BY run_date DESC, created_at DESC, id DESC')
    .all() as RunRow[];
}

export interface RunExecutionSelection {
  date: string;
  state: string;
  total: number;
  /** "Pronti" = con email (predicato non-trim, parità con getStats.withEmail). */
  ready: number;
  /** "Da arricchire" = senza email. */
  toEnrich: number;
}

export interface RunExecution {
  /** `run_id` reale dell'esecuzione, o `null` per i run legacy pre-remodel. */
  run_id: string | null;
  run_date: string;
  strategies: string[];
  items_in: number;
  items_new: number;
  created_at: string;
  /** La Selezione figlia di questo Run (stato + conteggi), o `null` se assente. */
  selection: RunExecutionSelection | null;
}

/** Riepilogo della Selezione (stato + conteggi) di una singola esecuzione. */
function selectionForExecution(runId: string | null, runDate: string): RunExecutionSelection | null {
  const where = runId ? 'd.run_id = ?' : 'd.run_id IS NULL AND d.date = ?';
  const row = db
    .prepare(
      `SELECT d.date AS date, d.state AS state,
              COUNT(*) AS total,
              SUM(CASE WHEN c.email IS NOT NULL AND c.email <> '' THEN 1 ELSE 0 END) AS ready
         FROM daily_selection d
         JOIN contacts c ON c.id = d.contact_id
        WHERE ${where}
        GROUP BY d.date, d.state`,
    )
    .get(runId ?? runDate) as
    | { date: string; state: string; total: number; ready: number }
    | undefined;
  if (!row) return null;
  return { date: row.date, state: row.state, total: row.total, ready: row.ready, toEnrich: row.total - row.ready };
}

/**
 * Run raggruppati per esecuzione (`run_id`), non per riga-strategia. I run legacy
 * (senza `run_id`) sono raggruppati per data. Ogni esecuzione porta la sua Selezione
 * con stato e conteggi pronti/da-arricchire.
 */
export function listRunExecutions(): RunExecution[] {
  const rows = db
    .prepare(
      `SELECT run_id,
              run_date,
              GROUP_CONCAT(DISTINCT strategy) AS strategies,
              SUM(items_in) AS items_in,
              SUM(items_new) AS items_new,
              MAX(created_at) AS created_at
         FROM runs
        GROUP BY COALESCE(run_id, 'date:' || run_date)
        ORDER BY run_date DESC, created_at DESC`,
    )
    .all() as Array<{
    run_id: string | null;
    run_date: string;
    strategies: string | null;
    items_in: number;
    items_new: number;
    created_at: string;
  }>;

  return rows.map((r) => ({
    run_id: r.run_id,
    run_date: r.run_date,
    strategies: r.strategies ? r.strategies.split(',') : [],
    items_in: r.items_in,
    items_new: r.items_new,
    created_at: r.created_at,
    selection: selectionForExecution(r.run_id, r.run_date),
  }));
}

/** Provenienza/stato della Selezione di una data (tutte le righe condividono i valori). */
export function getSelectionMeta(date: string): { run_id: string | null; state: string } | null {
  const row = db
    .prepare('SELECT run_id, state FROM daily_selection WHERE date = ? LIMIT 1')
    .get(date) as { run_id: string | null; state: string } | undefined;
  return row ?? null;
}

/** Marca tutta la Selezione del giorno come `exported` (export validato dall'operatore). */
export function setSelectionExported(date: string): void {
  db.prepare("UPDATE daily_selection SET state = 'exported' WHERE date = ?").run(date);
}

export interface SelectionSummary {
  date: string;
  freelance: number;
  azienda: number;
}

export function listSelectionDates(): SelectionSummary[] {
  return db
    .prepare(
      `SELECT date,
              SUM(CASE WHEN bucket = 'freelance' THEN 1 ELSE 0 END) AS freelance,
              SUM(CASE WHEN bucket = 'azienda' THEN 1 ELSE 0 END) AS azienda
         FROM daily_selection
        GROUP BY date
        ORDER BY date DESC`,
    )
    .all() as SelectionSummary[];
}

export interface SelectionItem extends ContactRow {
  sel_bucket: string;
  rank: number;
}

export function getSelectionItems(date: string): SelectionItem[] {
  return db
    .prepare(
      `SELECT c.*, d.bucket AS sel_bucket, d.rank
         FROM daily_selection d
         JOIN contacts c ON c.id = d.contact_id
        WHERE d.date = ?
        ORDER BY d.bucket, d.rank`,
    )
    .all(date) as SelectionItem[];
}

/** Rinumera i rank di un bucket in modo compatto (1..n) preservando l'ordine. */
function renumberBucket(date: string, bucket: string): void {
  const rows = db
    .prepare('SELECT id FROM daily_selection WHERE date = ? AND bucket = ? ORDER BY rank')
    .all(date, bucket) as Array<{ id: number }>;
  const upd = db.prepare('UPDATE daily_selection SET rank = ? WHERE id = ?');
  rows.forEach((r, i) => upd.run(i + 1, r.id));
}

export function addToSelection(date: string, contactId: number, bucket: string): void {
  const max = db
    .prepare('SELECT COALESCE(MAX(rank), 0) AS max FROM daily_selection WHERE date = ? AND bucket = ?')
    .get(date, bucket) as { max: number };
  db.prepare('INSERT INTO daily_selection (date, bucket, contact_id, rank) VALUES (?, ?, ?, ?)').run(
    date,
    bucket,
    contactId,
    max.max + 1,
  );
}

export function removeFromSelection(date: string, contactId: number): boolean {
  const row = db
    .prepare('SELECT bucket FROM daily_selection WHERE date = ? AND contact_id = ?')
    .get(date, contactId) as { bucket: string } | undefined;
  if (!row) return false;
  db.prepare('DELETE FROM daily_selection WHERE date = ? AND contact_id = ?').run(date, contactId);
  renumberBucket(date, row.bucket);
  return true;
}

/**
 * Contatti eleggibili da aggiungere a mano a una Selezione: `scored` del bucket e
 * **non già membri di alcuna Selezione** (eleggibilità = membership, coerente con
 * `selectBucket`). Il param `date` è mantenuto per compat di firma ma non filtra più
 * per data: un contatto già proposto altrove non è ri-proponibile.
 */
export function listCandidates(
  date: string,
  bucket: string,
  q: string,
  limit: number,
  email?: 'with' | 'without',
): ContactRow[] {
  void date;
  const params: unknown[] = [bucket];
  let where = `c.bucket = ? AND c.fit_score IS NOT NULL
    AND c.status = 'scored'
    AND c.id NOT IN (SELECT contact_id FROM daily_selection)`;
  if (q) {
    where += ` AND (c.full_name LIKE ? COLLATE NOCASE OR c.headline LIKE ? COLLATE NOCASE OR c.company LIKE ? COLLATE NOCASE)`;
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  if (email === 'with') {
    where += " AND c.email IS NOT NULL AND c.email <> ''";
  } else if (email === 'without') {
    where += " AND (c.email IS NULL OR c.email = '')";
  }
  params.push(limit);
  return db
    .prepare(`SELECT c.* FROM contacts c WHERE ${where} ORDER BY c.fit_score DESC, c.last_evaluated_at DESC LIMIT ?`)
    .all(...params) as ContactRow[];
}

export interface ContactFilters {
  q?: string;
  bucket?: string;
  status?: string;
  strategy?: string;
  sector?: string;
  minFit?: number;
  email?: 'with' | 'without';
  page: number;
  pageSize: number;
}

/** Costruisce la clausola WHERE condivisa da searchContacts e listContactsForExport. */
function contactsWhere(f: ContactFilters): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (f.q) {
    clauses.push(
      '(full_name LIKE ? COLLATE NOCASE OR headline LIKE ? COLLATE NOCASE OR company LIKE ? COLLATE NOCASE OR email LIKE ? COLLATE NOCASE)',
    );
    const like = `%${f.q}%`;
    params.push(like, like, like, like);
  }
  if (f.bucket) {
    clauses.push('bucket = ?');
    params.push(f.bucket);
  }
  if (f.status) {
    clauses.push('status = ?');
    params.push(f.status);
  }
  if (f.strategy) {
    clauses.push('source_strategy = ?');
    params.push(f.strategy);
  }
  if (f.sector) {
    clauses.push('sector = ?');
    params.push(f.sector);
  }
  if (f.minFit !== undefined) {
    clauses.push('fit_score >= ?');
    params.push(f.minFit);
  }
  if (f.email === 'with') {
    clauses.push("email IS NOT NULL AND email <> ''");
  } else if (f.email === 'without') {
    clauses.push("(email IS NULL OR email = '')");
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

const CONTACTS_ORDER = 'ORDER BY fit_score IS NULL, fit_score DESC, first_seen_at DESC';

export function searchContacts(f: ContactFilters): { items: ContactRow[]; total: number } {
  const { where, params } = contactsWhere(f);

  const { total } = db
    .prepare(`SELECT COUNT(*) AS total FROM contacts ${where}`)
    .get(...params) as { total: number };

  const items = db
    .prepare(`SELECT * FROM contacts ${where} ${CONTACTS_ORDER} LIMIT ? OFFSET ?`)
    .all(...params, f.pageSize, (f.page - 1) * f.pageSize) as ContactRow[];

  return { items, total };
}

/** Stesso filtro di searchContacts (incluso email) ma senza LIMIT/OFFSET: intero set filtrato. */
export function listContactsForExport(f: ContactFilters): ContactRow[] {
  const { where, params } = contactsWhere(f);
  return db.prepare(`SELECT * FROM contacts ${where} ${CONTACTS_ORDER}`).all(...params) as ContactRow[];
}

const EDITABLE_FIELDS = new Set([
  'full_name',
  'headline',
  'email',
  'phone',
  'company',
  'role',
  'bucket',
  'sector',
  'fit_score',
  'short_description',
  'email_subject',
  'email_body',
  'status',
]);

export function updateContactFields(id: number, fields: Record<string, unknown>): boolean {
  const keys = Object.keys(fields).filter((k) => EDITABLE_FIELDS.has(k));
  if (keys.length === 0) return false;
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => fields[k] ?? null);
  const info = db.prepare(`UPDATE contacts SET ${sets} WHERE id = ?`).run(...values, id);
  return info.changes > 0;
}

export interface Stats {
  total: number;
  withEmail: number;
  byStatus: Record<string, number>;
  byBucket: Record<string, number>;
  /** Selezioni (distinte per data) per stato del ciclo: in_review / exported. */
  selectionsByState: Record<string, number>;
  lastRunDate: string | null;
  selectionsCount: number;
  /** Finestra di freshness (giorni) usata da scoring ed enrichment progressivo. */
  freshnessDays: number;
  strategies: string[];
}

export function getStats(): Stats {
  const { total } = db.prepare('SELECT COUNT(*) AS total FROM contacts').get() as { total: number };
  const { withEmail } = db
    .prepare("SELECT COUNT(*) AS withEmail FROM contacts WHERE email IS NOT NULL AND email <> ''")
    .get() as { withEmail: number };

  const byStatus: Record<string, number> = {};
  for (const r of db.prepare('SELECT status, COUNT(*) AS n FROM contacts GROUP BY status').all() as Array<{
    status: string;
    n: number;
  }>) {
    byStatus[r.status] = r.n;
  }

  const byBucket: Record<string, number> = {};
  for (const r of db
    .prepare('SELECT bucket, COUNT(*) AS n FROM contacts WHERE bucket IS NOT NULL GROUP BY bucket')
    .all() as Array<{ bucket: string; n: number }>) {
    byBucket[r.bucket] = r.n;
  }

  const selectionsByState: Record<string, number> = {};
  for (const r of db
    .prepare('SELECT state, COUNT(DISTINCT date) AS n FROM daily_selection GROUP BY state')
    .all() as Array<{ state: string; n: number }>) {
    selectionsByState[r.state] = r.n;
  }

  const last = db.prepare('SELECT MAX(run_date) AS d FROM runs').get() as { d: string | null };
  const { selectionsCount } = db
    .prepare('SELECT COUNT(DISTINCT date) AS selectionsCount FROM daily_selection')
    .get() as { selectionsCount: number };

  const strategies = (
    db
      .prepare('SELECT DISTINCT source_strategy AS s FROM contacts WHERE source_strategy IS NOT NULL ORDER BY s')
      .all() as Array<{ s: string }>
  ).map((r) => r.s);

  return {
    total,
    withEmail,
    byStatus,
    byBucket,
    selectionsByState,
    lastRunDate: last.d,
    selectionsCount,
    freshnessDays: config.freshnessDays,
    strategies,
  };
}
