import { db, nowIso } from './index.js';
import { searchProspects, type ProspectPage, type ProspectQuery } from './prospects.js';
import { PROSPECT_STATUSES, type ProspectStatus } from './schema.js';

/*
 * Liste per ICP e membership many-to-many (D4). Lo stato è del prospect, non della
 * membership: rimuovere da una lista non tocca stato né timeline. Archiviata
 * (`archived_at`) = nascosta dall'elenco e job rifiutati con blocker; lettura/export ok.
 */

export interface ListRecord {
  id: number;
  icp_id: number;
  name: string;
  description: string | null;
  created_at: string;
  archived_at: string | null;
}

/** Lista con ICP e conteggi (stessa forma in `GET /api/lists` e `GET /api/lists/:id`). */
export interface ListView extends ListRecord {
  icp: { id: number; name: string };
  members_count: number;
  /** Tutti i 9 stati, anche a 0. */
  counts_by_status: Record<ProspectStatus, number>;
  enriched_count: number;
  with_email_count: number;
  /** Membri con almeno un'analisi per l'ICP della lista. */
  analyzed_count: number;
}

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ');

function withStats(lists: Array<ListRecord & { icp_name: string }>): ListView[] {
  if (lists.length === 0) return [];
  const ids = lists.map((l) => l.id);
  const rows = db
    .prepare(
      `SELECT lm.list_id, p.status, COUNT(*) AS n,
              SUM(p.enriched_at IS NOT NULL) AS enriched,
              SUM(p.email IS NOT NULL AND TRIM(p.email) <> '') AS with_email,
              SUM(EXISTS (SELECT 1 FROM analyses a WHERE a.prospect_id = p.id AND a.icp_id = l.icp_id)) AS analyzed
       FROM list_members lm
       JOIN lists l ON l.id = lm.list_id
       JOIN prospects p ON p.id = lm.prospect_id
       WHERE lm.list_id IN (${placeholders(ids.length)})
       GROUP BY lm.list_id, p.status`,
    )
    .all(...ids) as Array<{
    list_id: number;
    status: ProspectStatus;
    n: number;
    enriched: number;
    with_email: number;
    analyzed: number;
  }>;

  return lists.map(({ icp_name, ...list }) => {
    const counts = Object.fromEntries(PROSPECT_STATUSES.map((s) => [s, 0])) as Record<ProspectStatus, number>;
    const view: ListView = {
      ...list,
      icp: { id: list.icp_id, name: icp_name },
      members_count: 0,
      counts_by_status: counts,
      enriched_count: 0,
      with_email_count: 0,
      analyzed_count: 0,
    };
    for (const r of rows.filter((row) => row.list_id === list.id)) {
      counts[r.status] = r.n;
      view.members_count += r.n;
      view.enriched_count += r.enriched;
      view.with_email_count += r.with_email;
      view.analyzed_count += r.analyzed;
    }
    return view;
  });
}

const SELECT_LIST = `
  SELECT l.id, l.icp_id, l.name, l.description, l.created_at, l.archived_at, i.name AS icp_name
  FROM lists l JOIN icps i ON i.id = l.icp_id`;

/** Lista con ICP e conteggi, o `null`. Anche se archiviata (il deep-link mostra il banner). */
export function getList(id: number): ListView | null {
  const row = db.prepare(`${SELECT_LIST} WHERE l.id = ?`).get(id) as (ListRecord & { icp_name: string }) | undefined;
  return row ? withStats([row])[0] : null;
}

/** True se la lista esiste (archiviata o no). */
export function listExists(id: number): boolean {
  return db.prepare('SELECT 1 FROM lists WHERE id = ?').get(id) !== undefined;
}

/**
 * True se la lista è archiviata: le preview dei job la trasformano in `blocker`.
 * `false` anche se la lista non esiste: per l'esistenza usare `getList`/`listExists`.
 */
export function isListArchived(id: number): boolean {
  const archivedAt = db.prepare('SELECT archived_at FROM lists WHERE id = ?').pluck().get(id) as string | null | undefined;
  return archivedAt !== undefined && archivedAt !== null;
}

/** Tutte le liste ordinate per ICP e nome; le archiviate solo con `includeArchived`. */
export function listLists(opts: { includeArchived?: boolean } = {}): ListView[] {
  const rows = db
    .prepare(
      `${SELECT_LIST} ${opts.includeArchived ? '' : 'WHERE l.archived_at IS NULL'}
       ORDER BY i.name COLLATE NOCASE, l.name COLLATE NOCASE, l.id`,
    )
    .all() as Array<ListRecord & { icp_name: string }>;
  return withStats(rows);
}

/** Crea una lista dell'ICP dato. `null` se l'ICP non esiste. */
export function createList(input: { icpId: number; name: string; description?: string | null }): ListView | null {
  const icp = db.prepare('SELECT 1 FROM icps WHERE id = ?').get(input.icpId);
  if (!icp) return null;
  const info = db
    .prepare('INSERT INTO lists (icp_id, name, description, created_at) VALUES (?, ?, ?, ?)')
    .run(input.icpId, input.name.trim(), input.description?.trim() || null, nowIso());
  return getList(Number(info.lastInsertRowid));
}

/**
 * Modifica nome/descrizione e archiviazione (`archived: true` imposta `archived_at` se non
 * già impostato, `false` lo azzera). `null` se la lista non esiste.
 */
export function updateList(
  id: number,
  patch: { name?: string; description?: string | null; archived?: boolean },
): ListView | null {
  if (!listExists(id)) return null;
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.name !== undefined) {
    sets.push('name = ?');
    params.push(patch.name.trim());
  }
  if (patch.description !== undefined) {
    sets.push('description = ?');
    params.push(patch.description?.trim() || null);
  }
  if (patch.archived !== undefined) {
    sets.push(patch.archived ? 'archived_at = COALESCE(archived_at, ?)' : 'archived_at = NULL');
    if (patch.archived) params.push(nowIso());
  }
  if (sets.length > 0) db.prepare(`UPDATE lists SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  return getList(id);
}

/**
 * Aggiunge prospect alla lista in modo idempotente: `added` nuovi, `skipped` già membri,
 * `not_found` id inesistenti (id duplicati nell'input contano una volta). Non tocca lo stato.
 * Lancia se la lista non esiste.
 */
export function addMembers(listId: number, prospectIds: number[]): { added: number; skipped: number; not_found: number } {
  if (!listExists(listId)) throw new Error(`Lista inesistente: ${listId}`);
  return db.transaction(() => {
    const insert = db.prepare(
      `INSERT INTO list_members (list_id, prospect_id, added_at)
       SELECT ?, id, ? FROM prospects WHERE id = ?
       ON CONFLICT(list_id, prospect_id) DO NOTHING`,
    );
    const exists = db.prepare('SELECT 1 FROM prospects WHERE id = ?');
    const now = nowIso();
    const counts = { added: 0, skipped: 0, not_found: 0 };
    for (const prospectId of new Set(prospectIds)) {
      if (insert.run(listId, now, prospectId).changes === 1) counts.added += 1;
      else if (exists.get(prospectId)) counts.skipped += 1;
      else counts.not_found += 1;
    }
    return counts;
  })();
}

/** Toglie prospect dalla lista (stato e timeline restano; senza altre liste tornano in Inbox). */
export function removeMembers(listId: number, prospectIds: number[]): { removed: number } {
  return db.transaction(() => {
    const del = db.prepare('DELETE FROM list_members WHERE list_id = ? AND prospect_id = ?');
    let removed = 0;
    for (const prospectId of new Set(prospectIds)) removed += del.run(listId, prospectId).changes;
    return { removed };
  })();
}

/** Membri della lista come righe di tabella: `searchProspects` con `listId` fissato. */
export function listMembers(listId: number, filters: Omit<ProspectQuery, 'listId' | 'inbox'> = {}): ProspectPage {
  return searchProspects({ ...filters, listId });
}
