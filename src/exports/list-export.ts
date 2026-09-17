import { addActivity, changeStatus } from '../db/activities.js';
import { latestAnalysis } from '../db/analyses.js';
import { getExport, insertExport, listExports, loadExportProspects, statusesOf, type ExportRecord, type ExportSource } from '../db/exports.js';
import { db, nowIso } from '../db/index.js';
import { idsByFilters, prospectExists, type FitFilter, type ProspectQuery } from '../db/prospects.js';
import { PROSPECT_STATUSES, type ProspectStatus, type SourceKind } from '../db/schema.js';
import { STATUS_LABELS } from '../domain/status.js';
import { toCsv } from '../util/csv.js';

/*
 * Export CSV di una lista verso gli email tool (PLAN crm-foundation D7/T12, FLOW G). Ambito =
 * lista filtrata **oppure** selezione di id; "solo con email" vale per entrambi (FLOW G). L'export
 * scrive in una transazione la riga `exports`, un'attività `export` per prospect e, solo con
 * `markContacted`, il cambio stato → `contattato`. Il CSV si rigenera per id (`renderListExportCsv`).
 */

/** Colonne del CSV, nell'ordine del PLAN. */
export const EXPORT_COLUMNS = [
  'full_name',
  'first_name',
  'last_name',
  'email',
  'company',
  'title',
  'linkedin_url',
  'location',
  'status',
  'list',
  'icp',
  'fit',
  'summary',
  'angle_1',
  'angle_2',
  'angle_3',
  'last_touchpoint_at',
  'sources',
] as const;
export type ExportColumn = (typeof EXPORT_COLUMNS)[number];

/** Filtri della tabella Lista che definiscono l'ambito "lista filtrata" (stessa semantica di `ProspectQuery`). */
export interface ExportScopeFilters {
  q?: string;
  status?: ProspectStatus[];
  enriched?: boolean;
  source?: SourceKind[];
  fit?: FitFilter[];
}
export const SCOPE_FILTER_KEYS = ['q', 'status', 'enriched', 'source', 'fit'] as const;

export interface ExportInput {
  /** Ambito "lista filtrata" (vuoto = tutta la lista). Mutuamente esclusivo con `prospectIds`. */
  filters?: ExportScopeFilters;
  /** Ambito "selezione": id richiesti; quelli non (più) membri della lista sono saltati e contati. */
  prospectIds?: number[];
  /** "Solo con email" (`true`) / "solo senza" (`false`), su entrambi gli ambiti. Assente = tutti. */
  hasEmail?: boolean;
  /** Default `false`: registra `status_change → contattato` sui prospect esportati (vedi `isMarkable`). */
  markContacted?: boolean;
}

/** Conteggi dell'ambito, uguali in preview e in creazione. */
export interface ExportCounts {
  /** Prospect nell'ambito prima di "solo con email". */
  in_scope: number;
  /** Esclusi dal filtro email (FLOW G: "6 senza email esclusi"). */
  excluded_email: number;
  /** Id della selezione che non esistono più (es. uniti in un altro prospect). */
  not_found: number;
  /** Id della selezione che esistono ma non sono membri della lista. */
  not_member: number;
}

export interface ExportPreview {
  /** Prospect che verrebbero esportati. */
  count: number;
  counts: ExportCounts & {
    /** Esportati il cui stato passerebbe a `contattato` con `markContacted`. */
    to_mark_contacted: number;
  };
}

/** Export come esce dalle API (storico e creazione). */
export interface ExportView {
  id: number;
  list_id: number;
  scope: 'filters' | 'selection';
  /** Filtri dell'ambito + `hasEmail` usati (vuoto = tutta la lista). */
  filters: ExportScopeFilters & { hasEmail?: boolean };
  /** Id richiesti nella selezione (prima di esclusioni e salti); `null` per la lista filtrata. */
  selected: number | null;
  mark_contacted: boolean;
  count: number;
  created_at: string;
  download_url: string;
}

export interface CreatedExport extends ExportView {
  counts: ExportCounts & {
    /** Prospect passati a `contattato`. */
    marked_contacted: number;
    /** Con `markContacted`: esportati lasciati nel loro stato (già `contattato` o più avanti/finale). */
    status_unchanged: number;
  };
}

/** Errore di dominio dell'export (l'API lo traduce in 400 con `code`). */
export class ExportError extends Error {
  constructor(
    readonly code: 'empty_export',
    message: string,
  ) {
    super(message);
    this.name = 'ExportError';
  }
}

/**
 * `markContacted` porta a `contattato` solo chi è **prima** del contatto (`nuovo`, `qualificato`,
 * `da_contattare`). Chi è già `contattato` non cambia (nessuna attività); chi è più avanti
 * (`risposto`, `in_conversazione`) o in uno stato finale (`chiuso_*`, `scartato`) resta com'è:
 * l'export non è un'evidenza per riportare indietro o riaprire un prospect (D6: niente automatismi
 * oltre l'opt-in esplicito).
 */
export function isMarkable(status: ProspectStatus): boolean {
  return PROSPECT_STATUSES.indexOf(status) < PROSPECT_STATUSES.indexOf('contattato');
}

/** Nessun cap: l'export copre l'intera lista filtrata (il cap 500 vale per la selezione in UI). */
const NO_CAP = Number.MAX_SAFE_INTEGER;

interface ResolvedScope {
  ids: number[];
  counts: ExportCounts;
}

/** Id da esportare nell'ordine della tabella Lista (aggiunti più di recente prima), con i conteggi. */
function resolveScope(listId: number, input: ExportInput): ResolvedScope {
  const scopeQuery: ProspectQuery = input.prospectIds ? { listId } : { ...input.filters, listId };
  const scope = idsByFilters(scopeQuery, NO_CAP).ids;
  const counts: ExportCounts = { in_scope: scope.length, excluded_email: 0, not_found: 0, not_member: 0 };

  let inScope = scope;
  if (input.prospectIds) {
    const requested = new Set(input.prospectIds);
    const members = new Set(scope);
    inScope = scope.filter((id) => requested.has(id));
    for (const id of requested) {
      if (members.has(id)) continue;
      if (prospectExists(id)) counts.not_member += 1;
      else counts.not_found += 1;
    }
    counts.in_scope = inScope.length;
  }

  if (input.hasEmail === undefined) return { ids: inScope, counts };
  const matching = new Set(idsByFilters({ ...scopeQuery, hasEmail: input.hasEmail }, NO_CAP).ids);
  const ids = inScope.filter((id) => matching.has(id));
  counts.excluded_email = inScope.length - ids.length;
  return { ids, counts };
}

function listInfo(listId: number): { name: string; icp_id: number; icp_name: string } | null {
  return (
    (db
      .prepare('SELECT l.name, l.icp_id, i.name AS icp_name FROM lists l JOIN icps i ON i.id = l.icp_id WHERE l.id = ?')
      .get(listId) as { name: string; icp_id: number; icp_name: string } | undefined) ?? null
  );
}

/** Conteggio vivo del dialog "Esporta CSV" (FLOW G), senza scritture. `null` se la lista non esiste. */
export function previewListExport(listId: number, input: ExportInput): ExportPreview | null {
  if (!listInfo(listId)) return null;
  const { ids, counts } = resolveScope(listId, input);
  const statuses = statusesOf(ids);
  const toMark = ids.filter((id) => {
    const status = statuses.get(id);
    return status !== undefined && isMarkable(status);
  }).length;
  return { count: ids.length, counts: { ...counts, to_mark_contacted: toMark } };
}

/** Filtri + opzioni come si salvano in `exports.filters`. */
function storedFilters(input: ExportInput): Record<string, unknown> {
  const stored: Record<string, unknown> = {};
  if (input.prospectIds) stored.selection = new Set(input.prospectIds).size;
  else Object.assign(stored, input.filters);
  if (input.hasEmail !== undefined) stored.hasEmail = input.hasEmail;
  stored.markContacted = input.markContacted === true;
  return stored;
}

export function exportView(record: ExportRecord): ExportView {
  const { selection, markContacted, hasEmail, ...rest } = record.filters;
  const filters: ExportView['filters'] = {};
  for (const key of SCOPE_FILTER_KEYS) {
    if (rest[key] !== undefined) Object.assign(filters, { [key]: rest[key] });
  }
  if (typeof hasEmail === 'boolean') filters.hasEmail = hasEmail;
  return {
    id: record.id,
    list_id: record.list_id,
    scope: typeof selection === 'number' ? 'selection' : 'filters',
    filters,
    selected: typeof selection === 'number' ? selection : null,
    mark_contacted: markContacted === true,
    count: record.count,
    created_at: record.created_at,
    download_url: `/api/exports/${record.id}.csv`,
  };
}

/** Storico degli export della lista (anche archiviata), dal più recente. `null` se la lista non esiste. */
export function listExportHistory(listId: number): ExportView[] | null {
  if (!listInfo(listId)) return null;
  return listExports(listId).map(exportView);
}

/**
 * Crea l'export in **una** transazione: riga `exports` con gli id esportati, per ogni prospect
 * l'eventuale `status_change → contattato` (solo `markContacted`, vedi `isMarkable`) e poi
 * l'attività `export` (`meta: {export_id}`, + `status_change_id` se lo stato è cambiato; scritta
 * dopo così in timeline sta in cima). Se qualcosa fallisce non resta nulla (FLOW: "Export fallisce").
 * Consentito anche su liste archiviate. `null` se la lista non esiste; `ExportError('empty_export')`
 * se l'ambito è vuoto (nessuna scrittura).
 */
export function createListExport(listId: number, input: ExportInput): CreatedExport | null {
  return db.transaction((): CreatedExport | null => {
    const list = listInfo(listId);
    if (!list) return null;
    const { ids, counts } = resolveScope(listId, input);
    if (ids.length === 0) throw new ExportError('empty_export', 'Nessun prospect da esportare con questi filtri.');

    const record = insertExport({ listId, filters: storedFilters(input), prospectIds: ids });
    const occurredAt = nowIso();
    const body = `Esportato (lista ${list.name}, export #${record.id})`;
    const statuses = input.markContacted ? statusesOf(ids) : new Map<number, ProspectStatus>();
    let marked = 0;
    let unchanged = 0;

    for (const prospectId of ids) {
      const meta: Record<string, unknown> = { export_id: record.id };
      if (input.markContacted) {
        const status = statuses.get(prospectId);
        const change =
          status !== undefined && isMarkable(status)
            ? changeStatus(prospectId, 'contattato', {
                listId,
                occurredAt,
                note: `Segnato come contattato con l'export #${record.id}.`,
                meta: { export_id: record.id },
              })
            : null;
        if (change?.activity) {
          marked += 1;
          meta.status_change_id = change.activity.id;
        } else {
          unchanged += 1;
        }
      }
      addActivity({ prospectId, kind: 'export', listId, body, meta, occurredAt });
    }

    return {
      ...exportView(record),
      counts: { ...counts, marked_contacted: marked, status_unchanged: unchanged },
    };
  })();
}

/** `first_name`/`last_name` best-effort: tutto prima del primo spazio / tutto il resto. */
export function splitName(fullName: string | null): { first: string; last: string } {
  const name = (fullName ?? '').trim().replace(/\s+/g, ' ');
  const space = name.indexOf(' ');
  return space < 0 ? { first: name, last: '' } : { first: name.slice(0, space), last: name.slice(space + 1) };
}

/** Colonna `sources`: "reazione a <url>; commento a <url>; dipendente di <azienda>". */
export function sourcesText(sources: ExportSource[]): string {
  return sources
    .map((s) => {
      switch (s.kind) {
        case 'post_reaction':
          return `reazione a ${s.post_url ?? 'un post'}`;
        case 'post_comment':
          return `commento a ${s.post_url ?? 'un post'}`;
        case 'company_employees':
          return `dipendente di ${s.company_name ?? 'un\'azienda'}`;
        default:
          return 'inserito a mano';
      }
    })
    .join('; ');
}

/** Nome file ASCII: `<lista-slug>-<data export>-export-<id>.csv`. */
function exportFilename(listName: string, record: ExportRecord): string {
  const slug = listName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 60)
    .replace(/^-+|-+$/g, '');
  return `${slug || 'lista'}-${record.created_at.slice(0, 10)}-export-${record.id}.csv`;
}

/**
 * Rigenera il CSV di un export: le persone sono gli id fissati all'export (quelli uniti o
 * cancellati nel frattempo mancano), i valori sono quelli attuali. `fit`, `summary` e `angle_*`
 * vengono dall'ultima analisi salvata **per l'ICP della lista** (vuoti se non analizzato per quell'ICP;
 * un'analisi "stantia" si esporta comunque). `null` se l'export non esiste.
 */
export function renderListExportCsv(exportId: number): { filename: string; csv: string; rows: number } | null {
  const record = getExport(exportId);
  if (!record) return null;
  const list = listInfo(record.list_id);
  if (!list) return null;

  const rows = loadExportProspects(record.prospect_ids).map((p): Record<ExportColumn, string | null> => {
    const analysis = latestAnalysis(p.id, list.icp_id);
    const angle = (i: number) => {
      const a = analysis?.angles[i];
      if (!a) return null;
      return a.rationale?.trim() ? `${a.title} — ${a.rationale}` : a.title;
    };
    const { first, last } = splitName(p.full_name);
    return {
      full_name: p.full_name,
      first_name: first,
      last_name: last,
      email: p.email,
      company: p.company,
      title: p.title,
      linkedin_url: p.linkedin_url,
      location: p.location,
      status: STATUS_LABELS[p.status],
      list: list.name,
      icp: list.icp_name,
      fit: analysis?.fit ?? null,
      summary: analysis?.summary ?? null,
      angle_1: angle(0),
      angle_2: angle(1),
      angle_3: angle(2),
      last_touchpoint_at: p.last_touchpoint_at,
      sources: sourcesText(p.sources),
    };
  });
  return { filename: exportFilename(list.name, record), csv: toCsv(rows, EXPORT_COLUMNS), rows: rows.length };
}
