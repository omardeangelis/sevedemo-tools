import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { addNote, addTouchpoint, changeStatus, deleteActivity } from '../../db/activities.js';
import { listExists } from '../../db/lists.js';
import {
  EDITABLE_PROSPECT_FIELDS,
  FIT_FILTERS,
  IDS_CAP,
  MAX_PAGE_SIZE,
  PROSPECT_SORTS,
  ProspectQueryError,
  getProspect,
  idsByFilters,
  listInbox,
  searchProspects,
  updateProspect,
  type ProspectQuery,
} from '../../db/prospects.js';
import { CHANNELS, DIRECTIONS, PROSPECT_STATUSES, SOURCE_KINDS } from '../../db/schema.js';
import { db } from '../../db/index.js';
import { httpError, idParam, readJson } from '../http.js';
import type { AppEnv } from '../types.js';

/**
 * Inbox, prospect, stati e attività (crm-foundation T5). Montato da `app.ts` con
 * `app.route('/api', prospectsRoutes)`: path assolute sotto `/api`. Le path statiche
 * (`/prospects/ids`, `/prospects/bulk/status`) sono registrate prima di `/prospects/:id…`.
 */
export const prospectsRoutes = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// Query string condivisa (anche da `routes/lists.ts` per `/lists/:id/members/ids`)
// ---------------------------------------------------------------------------

const positiveInt = z.coerce.number().int().positive();
const flag = z.stringbool();
/** Valori separati da virgola, ognuno tra quelli ammessi. */
const csvOf = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .transform((s) => s.split(',').map((v) => v.trim()).filter(Boolean))
    .pipe(z.array(z.enum(values)).min(1));

/** Filtri di `GET /api/inbox`, `/api/prospects` e dei relativi `/ids` (vedi `ProspectQuery`). */
export const prospectQuerySchema = z.object({
  q: z.string().max(200).optional(),
  status: csvOf(PROSPECT_STATUSES).optional(),
  listId: positiveInt.optional(),
  companyId: positiveInt.optional(),
  hasEmail: flag.optional(),
  enriched: flag.optional(),
  source: csvOf(SOURCE_KINDS).optional(),
  postId: positiveInt.optional(),
  fit: csvOf(FIT_FILTERS).optional(),
  icpId: positiveInt.optional(),
  includeDiscarded: flag.optional(),
  sort: z.enum(PROSPECT_SORTS).optional(),
  page: positiveInt.optional(),
  pageSize: positiveInt.max(MAX_PAGE_SIZE).optional(),
});

/** Valida la query string (parametri vuoti = assenti; sconosciuti ignorati): 400 se non valida. */
export function readProspectQuery(c: Context<AppEnv>): ProspectQuery {
  const raw = Object.fromEntries(Object.entries(c.req.query()).filter(([, v]) => v !== ''));
  const parsed = prospectQuerySchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw httpError(400, 'Parametri di ricerca non validi.', { issues });
  }
  return parsed.data;
}

/** Esegue una ricerca traducendo gli errori di combinazione dei filtri in 400 `{error, code}`. */
export function runQuery<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof ProspectQueryError) throw httpError(400, err.message, { code: err.code });
    throw err;
  }
}

/** 400 se la lista di contesto indicata nel body non esiste. */
function assertListExists(listId: number | null | undefined): void {
  if (listId != null && !listExists(listId)) throw httpError(400, 'Lista inesistente.', { code: 'list_not_found' });
}

function requireProspect(id: number) {
  const prospect = getProspect(id);
  if (!prospect) throw httpError(404, 'Prospect non trovato.');
  return prospect;
}

// ---------------------------------------------------------------------------
// Inbox e ricerca
// ---------------------------------------------------------------------------

prospectsRoutes.get('/inbox', (c) => {
  const query = readProspectQuery(c);
  return c.json(runQuery(() => listInbox(query)));
});

prospectsRoutes.get('/inbox/ids', (c) => {
  const query = readProspectQuery(c);
  return c.json(runQuery(() => idsByFilters({ ...query, inbox: true }, IDS_CAP)));
});

prospectsRoutes.get('/prospects', (c) => {
  const query = readProspectQuery(c);
  return c.json(runQuery(() => searchProspects(query)));
});

prospectsRoutes.get('/prospects/ids', (c) => {
  const query = readProspectQuery(c);
  return c.json(runQuery(() => idsByFilters(query, IDS_CAP)));
});

// ---------------------------------------------------------------------------
// Stati
// ---------------------------------------------------------------------------

const optionalText = (max: number) => z.string().max(max).nullable().optional();
const optionalListId = positiveInt.nullable().optional();

const bulkStatusSchema = z
  .object({
    prospectIds: z.array(positiveInt).min(1).max(1000),
    status: z.enum(PROSPECT_STATUSES),
    note: optionalText(2000),
    listId: optionalListId,
  })
  .strict();

// Registrata prima di `/prospects/:id/status`, che altrimenti catturerebbe `bulk` come id.
prospectsRoutes.post('/prospects/bulk/status', async (c) => {
  const body = await readJson(c, bulkStatusSchema);
  assertListExists(body.listId);
  const counts = db.transaction(() => {
    let updated = 0;
    let unchanged = 0;
    let notFound = 0;
    for (const id of new Set(body.prospectIds)) {
      const result = changeStatus(id, body.status, { note: body.note, listId: body.listId });
      if (!result) notFound += 1;
      else if (result.changed) updated += 1;
      else unchanged += 1;
    }
    return { updated, unchanged, not_found: notFound };
  })();
  return c.json(counts);
});

const statusSchema = z
  .object({ status: z.enum(PROSPECT_STATUSES), note: optionalText(2000), listId: optionalListId })
  .strict();

prospectsRoutes.post('/prospects/:id/status', async (c) => {
  const id = idParam(c);
  const body = await readJson(c, statusSchema);
  requireProspect(id);
  assertListExists(body.listId);
  changeStatus(id, body.status, { note: body.note, listId: body.listId });
  return c.json(requireProspect(id));
});

// ---------------------------------------------------------------------------
// Dettaglio e anagrafica
// ---------------------------------------------------------------------------

prospectsRoutes.get('/prospects/:id', (c) => c.json(requireProspect(idParam(c))));

const patchSchema = z
  .object(
    Object.fromEntries(
      EDITABLE_PROSPECT_FIELDS.map((f) => [f, optionalText(f === 'about' ? 20000 : 500)]),
    ) as Record<(typeof EDITABLE_PROSPECT_FIELDS)[number], ReturnType<typeof optionalText>>,
  )
  .strict();

prospectsRoutes.patch('/prospects/:id', async (c) => {
  const id = idParam(c);
  const body = await readJson(c, patchSchema);
  if (!updateProspect(id, body)) throw httpError(404, 'Prospect non trovato.');
  return c.json(requireProspect(id));
});

// ---------------------------------------------------------------------------
// Touchpoint, note, eliminazione attività
// ---------------------------------------------------------------------------

/** Data/ora in qualunque formato accettato da `Date.parse`, normalizzata in ISO UTC. */
const isoDate = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), 'Data non valida.')
  .transform((s) => new Date(s).toISOString());

const touchpointSchema = z
  .object({
    listId: optionalListId,
    channel: z.enum(CHANNELS),
    direction: z.enum(DIRECTIONS),
    occurredAt: isoDate.optional(),
    body: optionalText(20000),
    note: optionalText(2000),
    newStatus: z.enum(PROSPECT_STATUSES).nullable().optional(),
  })
  .strict();

prospectsRoutes.post('/prospects/:id/touchpoints', async (c) => {
  const id = idParam(c);
  const body = await readJson(c, touchpointSchema);
  assertListExists(body.listId);
  const result = addTouchpoint(id, body);
  if (!result) throw httpError(404, 'Prospect non trovato.');
  return c.json(result.activity, 201);
});

const noteSchema = z
  .object({
    body: z.string().trim().min(1, 'La nota è vuota.').max(20000),
    listId: optionalListId,
    occurredAt: isoDate.optional(),
  })
  .strict();

prospectsRoutes.post('/prospects/:id/notes', async (c) => {
  const id = idParam(c);
  const body = await readJson(c, noteSchema);
  assertListExists(body.listId);
  const activity = addNote(id, body);
  if (!activity) throw httpError(404, 'Prospect non trovato.');
  return c.json(activity, 201);
});

prospectsRoutes.delete('/activities/:id', (c) => {
  const outcome = deleteActivity(idParam(c));
  if (outcome === 'not_found') throw httpError(404, 'Attività non trovata.');
  if (outcome === 'not_deletable') {
    throw httpError(409, 'Si possono eliminare solo touchpoint e note.', { code: 'activity_not_deletable' });
  }
  return c.json({ ok: true });
});
