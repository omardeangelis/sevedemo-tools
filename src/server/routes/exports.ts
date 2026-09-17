import { Hono } from 'hono';
import { z } from 'zod';
import {
  ExportError,
  SCOPE_FILTER_KEYS,
  createListExport,
  listExportHistory,
  previewListExport,
  renderListExportCsv,
  type ExportInput,
} from '../../exports/list-export.js';
import { FIT_FILTERS } from '../../db/prospects.js';
import { PROSPECT_STATUSES, SOURCE_KINDS } from '../../db/schema.js';
import { httpError, idParam, readJson } from '../http.js';
import type { AppEnv } from '../types.js';
import { prospectQuerySchema } from './prospects.js';

/**
 * Export CSV per lista (crm-foundation T12, FLOW G). Montato da `app.ts` con
 * `app.route('/api', exportsRoutes)`: dichiara le path assolute sotto `/api`.
 * - `POST /lists/:id/exports` → 201 export + `counts`; `GET /lists/:id/exports` → `{items}` storico;
 * - `GET /lists/:id/exports/preview` → conteggio vivo del dialog, nessuna scrittura;
 * - `GET /exports/:id.csv` → CSV rigenerato (anche per liste archiviate: lettura/export permessi).
 */
export const exportsRoutes = new Hono<AppEnv>();

const MAX_IDS = 1000;
const positiveInt = z.coerce.number().int().positive();

const SELECTION_WITH_FILTERS =
  'Esporta una selezione oppure la lista filtrata, non entrambe: con prospectIds è ammesso solo hasEmail.';

const ExportBody = z
  .object({
    q: z.string().max(200).optional(),
    status: z.array(z.enum(PROSPECT_STATUSES)).optional(),
    hasEmail: z.boolean().optional(),
    enriched: z.boolean().optional(),
    source: z.array(z.enum(SOURCE_KINDS)).optional(),
    fit: z.array(z.enum(FIT_FILTERS)).optional(),
    prospectIds: z.array(positiveInt).min(1).max(MAX_IDS).optional(),
    markContacted: z.boolean().optional(),
  })
  .strict();

/**
 * Da body/query validati a `ExportInput`: filtri vuoti = assenti; 400 `selection_with_filters` se
 * `prospectIds` arriva insieme a un filtro dell'ambito (`hasEmail` vale per entrambi, FLOW G).
 */
function toInput(parsed: z.infer<typeof ExportBody>): ExportInput {
  const filters: NonNullable<ExportInput['filters']> = {};
  if (parsed.q?.trim()) filters.q = parsed.q.trim();
  if (parsed.status?.length) filters.status = parsed.status;
  if (parsed.enriched !== undefined) filters.enriched = parsed.enriched;
  if (parsed.source?.length) filters.source = parsed.source;
  if (parsed.fit?.length) filters.fit = parsed.fit;

  if (parsed.prospectIds && SCOPE_FILTER_KEYS.some((key) => filters[key] !== undefined)) {
    throw httpError(400, SELECTION_WITH_FILTERS, { code: 'selection_with_filters' });
  }
  return {
    ...(parsed.prospectIds ? { prospectIds: parsed.prospectIds } : { filters }),
    hasEmail: parsed.hasEmail,
    markContacted: parsed.markContacted,
  };
}

function notFoundList(): never {
  throw httpError(404, 'Lista non trovata.');
}

exportsRoutes.post('/lists/:id/exports', async (c) => {
  const id = idParam(c);
  const input = toInput(await readJson(c, ExportBody));
  try {
    const created = createListExport(id, input);
    if (!created) notFoundList();
    return c.json(created, 201);
  } catch (err) {
    if (err instanceof ExportError) throw httpError(400, err.message, { code: err.code });
    throw err;
  }
});

exportsRoutes.get('/lists/:id/exports', (c) => {
  const items = listExportHistory(idParam(c));
  if (!items) notFoundList();
  return c.json({ items });
});

/** Stessa sintassi di `/lists/:id/members/ids` (valori separati da virgola) + `prospectIds=1,2,3`. */
const PreviewQuery = prospectQuerySchema
  .pick({ q: true, status: true, hasEmail: true, enriched: true, source: true, fit: true })
  .extend({
    prospectIds: z
      .string()
      .transform((s) => s.split(',').map((v) => v.trim()).filter(Boolean).map(Number))
      .pipe(z.array(z.number().int().positive()).min(1).max(MAX_IDS))
      .optional(),
  });

exportsRoutes.get('/lists/:id/exports/preview', (c) => {
  const id = idParam(c);
  const raw = Object.fromEntries(Object.entries(c.req.query()).filter(([, v]) => v !== ''));
  const parsed = PreviewQuery.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw httpError(400, 'Parametri di export non validi.', { issues });
  }
  const preview = previewListExport(id, toInput(parsed.data));
  if (!preview) notFoundList();
  return c.json(preview);
});

// `:id.csv` in Hono diventerebbe un parametro chiamato "id.csv" che accetta qualsiasi cosa: il
// suffisso si vincola con una regex e l'id si estrae a mano (404 per id non numerici o senza `.csv`).
exportsRoutes.get('/exports/:file{[0-9]+\\.csv}', (c) => {
  const exportId = Number(c.req.param('file').replace(/\.csv$/, ''));
  const file = Number.isSafeInteger(exportId) && exportId > 0 ? renderListExportCsv(exportId) : null;
  if (!file) throw httpError(404, 'Export non trovato.');
  return c.body(file.csv, 200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="${file.filename}"`,
    'cache-control': 'no-store',
  });
});
