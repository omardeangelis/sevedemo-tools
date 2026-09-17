import { db, nowIso } from './index.js';
import type { ProspectStatus, SourceKind } from './schema.js';

/*
 * Repository della tabella `exports` (PLAN crm-foundation §6, T12). Il CSV non si salva: si
 * rigenera per id da `prospect_ids`, gli id esportati **fissati al momento dell'export** (così
 * "Scarica di nuovo" ripropone le stesse persone anche se la lista cambia); i valori delle righe
 * sono quelli attuali. Regole di ambito, attività e CSV in `exports/list-export.ts`.
 */

/** Riga `exports` con i JSON parsati. `filters` contiene anche le opzioni (`markContacted`, `selection`). */
export interface ExportRecord {
  id: number;
  list_id: number;
  filters: Record<string, unknown>;
  prospect_ids: number[];
  count: number;
  created_at: string;
}

interface ExportRow extends Omit<ExportRecord, 'filters' | 'prospect_ids'> {
  filters: string;
  prospect_ids: string | null;
}

function toRecord(row: ExportRow): ExportRecord {
  return {
    ...row,
    filters: JSON.parse(row.filters) as Record<string, unknown>,
    prospect_ids: row.prospect_ids ? (JSON.parse(row.prospect_ids) as number[]) : [],
  };
}

/** Inserisce la riga di export (`count` = numero di id). Da chiamare dentro la transazione dell'export. */
export function insertExport(input: { listId: number; filters: Record<string, unknown>; prospectIds: number[] }): ExportRecord {
  const info = db
    .prepare('INSERT INTO exports (list_id, filters, prospect_ids, count, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(input.listId, JSON.stringify(input.filters), JSON.stringify(input.prospectIds), input.prospectIds.length, nowIso());
  return getExport(Number(info.lastInsertRowid))!;
}

export function getExport(id: number): ExportRecord | null {
  const row = db.prepare('SELECT * FROM exports WHERE id = ?').get(id) as ExportRow | undefined;
  return row ? toRecord(row) : null;
}

/** Storico degli export della lista, dal più recente. */
export function listExports(listId: number): ExportRecord[] {
  const rows = db
    .prepare('SELECT * FROM exports WHERE list_id = ? ORDER BY created_at DESC, id DESC')
    .all(listId) as ExportRow[];
  return rows.map(toRecord);
}

/** Fonte come serve alla colonna `sources` del CSV. */
export interface ExportSource {
  kind: SourceKind;
  post_url: string | null;
  company_name: string | null;
}

/** Prospect come serve a una riga del CSV (l'analisi si legge a parte, per l'ICP della lista). */
export interface ExportProspect {
  id: number;
  full_name: string | null;
  email: string | null;
  /** `company_name` del prospect, altrimenti il nome dell'azienda collegata. */
  company: string | null;
  title: string | null;
  linkedin_url: string;
  location: string | null;
  status: ProspectStatus;
  last_touchpoint_at: string | null;
  /** Dalla più vecchia alla più recente. */
  sources: ExportSource[];
}

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ');

/** Sotto il limite di variabili di SQLite anche per liste molto grandi. */
const CHUNK = 500;

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

/** Stato attuale per id (gli id inesistenti, ad es. uniti in un altro prospect, mancano dalla mappa). */
export function statusesOf(ids: number[]): Map<number, ProspectStatus> {
  const map = new Map<number, ProspectStatus>();
  for (const part of chunks(ids)) {
    const rows = db
      .prepare(`SELECT id, status FROM prospects WHERE id IN (${placeholders(part.length)})`)
      .all(...part) as Array<{ id: number; status: ProspectStatus }>;
    for (const r of rows) map.set(r.id, r.status);
  }
  return map;
}

/**
 * Prospect per gli id dati, nello stesso ordine. Gli id che non esistono più (uniti in un altro
 * prospect dopo l'export) sono saltati: il chiamante li conta confrontando le lunghezze.
 */
export function loadExportProspects(ids: number[]): ExportProspect[] {
  const byId = new Map<number, ExportProspect>();
  for (const part of chunks(ids)) {
    const marks = placeholders(part.length);
    const bases = db
      .prepare(
        `SELECT p.id, p.full_name, p.email, COALESCE(p.company_name, c.name) AS company, p.title, p.linkedin_url,
                p.location, p.status,
                (SELECT MAX(a.occurred_at) FROM activities a WHERE a.prospect_id = p.id AND a.kind = 'touchpoint')
                  AS last_touchpoint_at
         FROM prospects p LEFT JOIN companies c ON c.id = p.company_id
         WHERE p.id IN (${marks})`,
      )
      .all(...part) as Array<Omit<ExportProspect, 'sources'>>;
    for (const b of bases) byId.set(b.id, { ...b, sources: [] });

    const sources = db
      .prepare(
        `SELECT s.prospect_id, s.kind, po.post_url, COALESCE(c.name, c.linkedin_url) AS company_name
         FROM sources s
         LEFT JOIN posts po ON po.id = s.post_id
         LEFT JOIN companies c ON c.id = s.company_id
         WHERE s.prospect_id IN (${marks})
         ORDER BY s.captured_at, s.id`,
      )
      .all(...part) as Array<ExportSource & { prospect_id: number }>;
    for (const { prospect_id, ...source } of sources) byId.get(prospect_id)?.sources.push(source);
  }
  return ids.flatMap((id) => byId.get(id) ?? []);
}
