import { db, nowIso } from './index.js';
import type { ActivityKind, Channel, Direction, ProspectStatus } from './schema.js';

/*
 * Timeline unica del prospect (P3): cambi stato, touchpoint, note ed eventi di sistema
 * (export, analisi, enrichment) sono righe di `activities`. Il cambio stato vive qui (e
 * `domain/status.ts` lo riesporta) perché il touchpoint lo applica nella stessa transazione.
 */

/** Solo queste attività si eliminano (errori di registrazione); le altre sono storia di sistema. */
export const DELETABLE_ACTIVITY_KINDS: readonly ActivityKind[] = ['touchpoint', 'note'];

/** Voce di timeline come la restituisce l'API (`meta` già parsato, `list_name` per il chip lista). */
export interface Activity {
  id: number;
  prospect_id: number;
  list_id: number | null;
  list_name: string | null;
  kind: ActivityKind;
  channel: Channel | null;
  direction: Direction | null;
  from_status: ProspectStatus | null;
  to_status: ProspectStatus | null;
  body: string | null;
  meta: Record<string, unknown> | null;
  occurred_at: string;
  created_at: string;
  deletable: boolean;
}

export interface ActivityInput {
  prospectId: number;
  kind: ActivityKind;
  listId?: number | null;
  channel?: Channel | null;
  direction?: Direction | null;
  fromStatus?: ProspectStatus | null;
  toStatus?: ProspectStatus | null;
  body?: string | null;
  meta?: Record<string, unknown> | null;
  /** ISO; default adesso. */
  occurredAt?: string;
}

type ActivityRow = Omit<Activity, 'meta' | 'deletable'> & { meta: string | null };

const SELECT_ACTIVITY = `
  SELECT a.id, a.prospect_id, a.list_id, l.name AS list_name, a.kind, a.channel, a.direction,
         a.from_status, a.to_status, a.body, a.meta, a.occurred_at, a.created_at
  FROM activities a LEFT JOIN lists l ON l.id = a.list_id`;

function toActivity(row: ActivityRow): Activity {
  return {
    ...row,
    meta: row.meta ? (JSON.parse(row.meta) as Record<string, unknown>) : null,
    deletable: DELETABLE_ACTIVITY_KINDS.includes(row.kind),
  };
}

/** Testo facoltativo: stringhe vuote o di soli spazi valgono "assente". */
function clean(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** Una voce di timeline per id, o `null`. */
export function getActivity(id: number): Activity | null {
  const row = db.prepare(`${SELECT_ACTIVITY} WHERE a.id = ?`).get(id) as ActivityRow | undefined;
  return row ? toActivity(row) : null;
}

/**
 * Inserisce un'attività generica e la ritorna. È l'helper per gli eventi di sistema dei job
 * (T10 `enrichment`, T11 `analysis` con `meta.error`, T12 `export` con `meta.export_id`):
 * `meta` si passa come oggetto e si salva come JSON. Nessuna validazione di dominio oltre ai CHECK.
 */
export function addActivity(input: ActivityInput): Activity {
  const now = nowIso();
  const info = db
    .prepare(
      `INSERT INTO activities
         (prospect_id, list_id, kind, channel, direction, from_status, to_status, body, meta, occurred_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.prospectId,
      input.listId ?? null,
      input.kind,
      input.channel ?? null,
      input.direction ?? null,
      input.fromStatus ?? null,
      input.toStatus ?? null,
      input.body ?? null,
      input.meta ? JSON.stringify(input.meta) : null,
      input.occurredAt ?? now,
      now,
    );
  return getActivity(Number(info.lastInsertRowid))!;
}

export interface StatusChangeResult {
  changed: boolean;
  from: ProspectStatus;
  to: ProspectStatus;
  /** Attività `status_change` creata; `null` se lo stato era già quello richiesto. */
  activity: Activity | null;
}

/**
 * Cambio stato manuale e libero (D6: nessuna macchina a stati). Aggiorna `status` e
 * `status_changed_at` e logga `status_change` con from/to (`note` → `body`). Se lo stato è già
 * `to` non scrive nulla (`changed:false`). `null` se il prospect non esiste. Transazionale e
 * annidabile (dentro un'altra `db.transaction` diventa un savepoint: T12 `markContacted`).
 */
export function changeStatus(
  prospectId: number,
  to: ProspectStatus,
  opts: { note?: string | null; listId?: number | null; occurredAt?: string; meta?: Record<string, unknown> | null } = {},
): StatusChangeResult | null {
  return db.transaction((): StatusChangeResult | null => {
    const current = db.prepare('SELECT status FROM prospects WHERE id = ?').pluck().get(prospectId) as
      | ProspectStatus
      | undefined;
    if (current === undefined) return null;
    if (current === to) return { changed: false, from: current, to, activity: null };
    const occurredAt = opts.occurredAt ?? nowIso();
    db.prepare('UPDATE prospects SET status = ?, status_changed_at = ?, updated_at = ? WHERE id = ?').run(
      to,
      occurredAt,
      nowIso(),
      prospectId,
    );
    const activity = addActivity({
      prospectId,
      kind: 'status_change',
      listId: opts.listId,
      fromStatus: current,
      toStatus: to,
      body: clean(opts.note),
      meta: opts.meta,
      occurredAt,
    });
    return { changed: true, from: current, to, activity };
  })();
}

export interface TouchpointInput {
  listId?: number | null;
  channel: Channel;
  direction: Direction;
  /** ISO; default adesso. */
  occurredAt?: string;
  /** Testo del messaggio (facoltativo: "ho mandato un DM" senza testo è legittimo). */
  body?: string | null;
  /** Nota libera, salvata in `meta.note`. */
  note?: string | null;
  /** Cambio stato opzionale (P8), applicato nella stessa transazione. */
  newStatus?: ProspectStatus | null;
}

/**
 * Registra un touchpoint e, se `newStatus` differisce dallo stato attuale, il `status_change`
 * nella **stessa transazione** (stesso `occurred_at` e lista). Il cambio stato si scrive per
 * primo così, a parità di `occurred_at`, la timeline desc mostra il touchpoint in cima.
 * `null` se il prospect non esiste.
 */
export function addTouchpoint(
  prospectId: number,
  input: TouchpointInput,
): { activity: Activity; statusChange: StatusChangeResult | null } | null {
  return db.transaction(() => {
    const exists = db.prepare('SELECT 1 FROM prospects WHERE id = ?').get(prospectId);
    if (!exists) return null;
    const occurredAt = input.occurredAt ?? nowIso();
    const statusChange = input.newStatus
      ? changeStatus(prospectId, input.newStatus, { listId: input.listId, occurredAt })
      : null;
    const meta: Record<string, unknown> = {};
    const note = clean(input.note);
    if (note) meta.note = note;
    if (statusChange?.activity) meta.status_change_id = statusChange.activity.id;
    const activity = addActivity({
      prospectId,
      kind: 'touchpoint',
      listId: input.listId,
      channel: input.channel,
      direction: input.direction,
      body: clean(input.body),
      meta: Object.keys(meta).length > 0 ? meta : null,
      occurredAt,
    });
    return { activity, statusChange };
  })();
}

/** Nota libera sulla timeline (`kind:'note'`). `null` se il prospect non esiste. */
export function addNote(
  prospectId: number,
  input: { body: string; listId?: number | null; occurredAt?: string },
): Activity | null {
  const exists = db.prepare('SELECT 1 FROM prospects WHERE id = ?').get(prospectId);
  if (!exists) return null;
  return addActivity({
    prospectId,
    kind: 'note',
    listId: input.listId,
    body: clean(input.body),
    occurredAt: input.occurredAt,
  });
}

/**
 * Elimina una voce registrata per errore: solo `touchpoint`/`note` (FLOW, edge "touchpoint due
 * volte"). Non tocca lo stato del prospect, nemmeno se il touchpoint aveva causato un cambio.
 */
export function deleteActivity(id: number): 'deleted' | 'not_found' | 'not_deletable' {
  const kind = db.prepare('SELECT kind FROM activities WHERE id = ?').pluck().get(id) as ActivityKind | undefined;
  if (kind === undefined) return 'not_found';
  if (!DELETABLE_ACTIVITY_KINDS.includes(kind)) return 'not_deletable';
  db.prepare('DELETE FROM activities WHERE id = ?').run(id);
  return 'deleted';
}

/** Timeline del prospect, dalla più recente (`occurred_at` desc, poi id desc). */
export function timeline(prospectId: number): Activity[] {
  const rows = db
    .prepare(`${SELECT_ACTIVITY} WHERE a.prospect_id = ? ORDER BY a.occurred_at DESC, a.id DESC`)
    .all(prospectId) as ActivityRow[];
  return rows.map(toActivity);
}
