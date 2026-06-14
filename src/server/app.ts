import { Hono } from 'hono';
import { z } from 'zod';
import { config } from '../config.js';
import { getById, type ContactRow } from '../db/contacts.js';
import { eraseAllData, type EraseDeps } from '../db/erase.js';
import { reportByStrategy } from '../db/runs.js';
import { toCsv } from '../export/csv.js';
import { getJobStatus, RunInProgressError, startDailyRun, type StartOptions } from './jobs.js';
import {
  addToSelection,
  type ContactFilters,
  getSelectionItems,
  getStats,
  listCandidates,
  listContactsForExport,
  listRuns,
  listSelectionDates,
  removeFromSelection,
  searchContacts,
  updateContactFields,
} from './queries.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface AppOptions {
  /** Override del comando job per test/smoke: mai la pipeline reale nei test. */
  job?: StartOptions;
  /** Override delle dipendenze dell'erase (nei test: exports dir temporanea). */
  erase?: EraseDeps;
}

export function createApp(opts: AppOptions = {}): Hono {
  const app = new Hono();
  const api = new Hono();

  api.get('/health', (c) => c.json({ ok: true, db: config.paths.db }));

  api.get('/stats', (c) => c.json(getStats()));

  api.get('/runs', (c) => c.json(listRuns()));

  api.get('/report', (c) => c.json(reportByStrategy()));

  api.get('/pipeline/status', (c) => c.json(getJobStatus()));

  api.post('/pipeline/run', (c) => {
    try {
      return c.json(startDailyRun(opts.job), 202);
    } catch (err) {
      if (err instanceof RunInProgressError) return c.json({ error: err.message }, 409);
      throw err;
    }
  });

  const eraseSchema = z.object({ confirm: z.literal('ERASE') });

  api.post('/data/erase', async (c) => {
    const parsed = eraseSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'Conferma mancante: invia {"confirm":"ERASE"}.' }, 400);
    }
    if (getJobStatus().state === 'running') {
      return c.json({ error: 'Un run è in corso: attendi la fine prima di azzerare i dati.' }, 409);
    }
    return c.json(eraseAllData(opts.erase));
  });

  api.get('/selections', (c) => c.json(listSelectionDates()));

  api.get('/selections/:date', (c) => {
    const date = c.req.param('date');
    if (!DATE_RE.test(date)) return c.json({ error: 'Data non valida (YYYY-MM-DD).' }, 400);
    return c.json({ date, items: getSelectionItems(date) });
  });

  const addSchema = z.object({
    contactId: z.number().int().positive(),
    bucket: z.enum(['freelance', 'azienda']),
  });

  api.post('/selections/:date/contacts', async (c) => {
    const date = c.req.param('date');
    if (!DATE_RE.test(date)) return c.json({ error: 'Data non valida (YYYY-MM-DD).' }, 400);
    const parsed = addSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Body non valido: servono contactId e bucket.' }, 400);
    const { contactId, bucket } = parsed.data;
    if (!getById(contactId)) return c.json({ error: `Contatto ${contactId} inesistente.` }, 404);
    try {
      addToSelection(date, contactId, bucket);
    } catch {
      return c.json({ error: 'Contatto già presente nella selezione.' }, 409);
    }
    return c.json({ date, items: getSelectionItems(date) }, 201);
  });

  api.delete('/selections/:date/contacts/:contactId', (c) => {
    const date = c.req.param('date');
    const contactId = Number.parseInt(c.req.param('contactId'), 10);
    if (!DATE_RE.test(date) || !Number.isFinite(contactId)) {
      return c.json({ error: 'Parametri non validi.' }, 400);
    }
    if (!removeFromSelection(date, contactId)) {
      return c.json({ error: 'Contatto non presente nella selezione.' }, 404);
    }
    return c.json({ date, items: getSelectionItems(date) });
  });

  api.get('/selections/:date/candidates', (c) => {
    const date = c.req.param('date');
    if (!DATE_RE.test(date)) return c.json({ error: 'Data non valida (YYYY-MM-DD).' }, 400);
    const bucket = c.req.query('bucket') ?? '';
    if (bucket !== 'freelance' && bucket !== 'azienda') {
      return c.json({ error: 'bucket deve essere freelance o azienda.' }, 400);
    }
    const q = c.req.query('q') ?? '';
    return c.json(listCandidates(date, bucket, q, 30, emailFilter(c.req.query('email'))));
  });

  api.get('/selections/:date/export.csv', (c) => {
    const date = c.req.param('date');
    if (!DATE_RE.test(date)) return c.json({ error: 'Data non valida (YYYY-MM-DD).' }, 400);
    const rows = filterByEmail(getSelectionItems(date), emailFilter(c.req.query('email')));
    if (rows.length === 0) return c.json({ error: `Nessuna selezione per ${date}.` }, 404);
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="daily-${date}.csv"`);
    return c.body(toCsv(rows));
  });

  api.get('/selections/:date/export.json', (c) => {
    const date = c.req.param('date');
    if (!DATE_RE.test(date)) return c.json({ error: 'Data non valida (YYYY-MM-DD).' }, 400);
    const rows = filterByEmail(getSelectionItems(date), emailFilter(c.req.query('email')));
    if (rows.length === 0) return c.json({ error: `Nessuna selezione per ${date}.` }, 404);
    c.header('Content-Disposition', `attachment; filename="daily-${date}.json"`);
    return c.json(rows.map(toJsonRow));
  });

  api.get('/contacts', (c) => {
    const result = searchContacts(contactFiltersFromQuery(c.req));
    return c.json(result);
  });

  // Registrati prima di `/contacts/:id` così `export.csv|.json` non viene catturato dal param.
  api.get('/contacts/export.csv', (c) => {
    const rows = listContactsForExport(contactFiltersFromQuery(c.req));
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', 'attachment; filename="contacts-export.csv"');
    return c.body(toCsv(rows));
  });

  api.get('/contacts/export.json', (c) => {
    const rows = listContactsForExport(contactFiltersFromQuery(c.req));
    c.header('Content-Disposition', 'attachment; filename="contacts-export.json"');
    return c.json(rows.map(toJsonRow));
  });

  api.get('/contacts/:id', (c) => {
    const id = Number.parseInt(c.req.param('id'), 10);
    const row = Number.isFinite(id) ? getById(id) : undefined;
    if (!row) return c.json({ error: 'Contatto non trovato.' }, 404);
    return c.json(row);
  });

  const patchSchema = z
    .object({
      full_name: z.string().nullable(),
      headline: z.string().nullable(),
      email: z.string().nullable(),
      phone: z.string().nullable(),
      company: z.string().nullable(),
      role: z.string().nullable(),
      bucket: z.enum(['freelance', 'azienda', 'scarta']).nullable(),
      sector: z.enum(['tech', 'design', 'marketing', 'other']).nullable(),
      fit_score: z.number().int().min(0).max(100).nullable(),
      short_description: z.string().nullable(),
      email_subject: z.string().nullable(),
      email_body: z.string().nullable(),
      status: z.enum(['new', 'enriched', 'scored', 'selected', 'exported']),
    })
    .partial()
    .strict();

  api.patch('/contacts/:id', async (c) => {
    const id = Number.parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || !getById(id)) return c.json({ error: 'Contatto non trovato.' }, 404);
    const parsed = patchSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: `Campi non validi: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}` }, 400);
    }
    updateContactFields(id, parsed.data);
    return c.json(getById(id));
  });

  app.route('/api', api);
  app.notFound((c) =>
    c.req.path.startsWith('/api') ? c.json({ error: 'Endpoint inesistente.' }, 404) : c.text('Not found', 404),
  );

  return app;
}

/** Normalizza il query param `email`: accetta solo `with`/`without`, altrimenti ignora. */
function emailFilter(v: string | undefined): 'with' | 'without' | undefined {
  return v === 'with' || v === 'without' ? v : undefined;
}

/**
 * Estrae i ContactFilters dalla query. Condiviso da `/contacts` e dagli export Contatti:
 * stessi parametri di filtro; `page`/`pageSize` sono ignorati dagli export (no LIMIT/OFFSET).
 */
function contactFiltersFromQuery(req: { query: (k: string) => string | undefined }): ContactFilters {
  const num = (v: string | undefined) => {
    const n = v ? Number.parseInt(v, 10) : Number.NaN;
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    q: req.query('q') || undefined,
    bucket: req.query('bucket') || undefined,
    status: req.query('status') || undefined,
    strategy: req.query('strategy') || undefined,
    sector: req.query('sector') || undefined,
    minFit: num(req.query('minFit')),
    email: emailFilter(req.query('email')),
    page: Math.max(1, num(req.query('page')) ?? 1),
    pageSize: Math.min(100, Math.max(1, num(req.query('pageSize')) ?? 25)),
  };
}

/** Readiness email: presenza non-trim, parità con `getStats().withEmail`. */
function isEmailReady(email: string | null): boolean {
  return email != null && email !== '';
}

/** Filtra le righe per presenza email con lo stesso predicato non-trim degli altri layer. */
function filterByEmail<T extends ContactRow>(rows: T[], email: 'with' | 'without' | undefined): T[] {
  if (email === 'with') return rows.filter((r) => isEmailReady(r.email));
  if (email === 'without') return rows.filter((r) => !isEmailReady(r.email));
  return rows;
}

/** Mappa una riga nell'oggetto JSON di export (signals parsato, raw_json escluso, email_ready). */
function toJsonRow(r: ContactRow): Record<string, unknown> {
  return { ...r, signals: safeParse(r.signals), raw_json: undefined, email_ready: isEmailReady(r.email) };
}

function safeParse(s: string | null): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
