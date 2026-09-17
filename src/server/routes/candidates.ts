import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  CANDIDATES_CAP,
  candidateOf,
  countCandidates,
  getCandidate,
  lastContactsByCompany,
  lastLookalikeRun,
  listCandidates,
  setCandidateStatus,
} from '../../db/candidates.js';
import { getCompany } from '../../db/companies.js';
import { getIcp } from '../../db/icps.js';
import { CANDIDATE_STATUSES } from '../../db/schema.js';
import { httpError, idParam, readJson } from '../http.js';
import type { AppEnv } from '../types.js';

/**
 * Candidate di un ICP e collegamenti dal dettaglio azienda (apollo-lookalike T11, SPEC E1–E6/F12, PLAN
 * §12). Montato da `app.ts` con `app.route('/api', candidatesRoutes)`: path assolute sotto `/api`, tutte
 * con un segmento dopo `:id` (`/candidates…`, `/candidate-of`, `/contacts-at`), quindi nessuna
 * sovrapposizione con `/icps/:id` e `/companies/:id`. API dati: `src/db/candidates.ts`.
 */
export const candidatesRoutes = new Hono<AppEnv>();

const positiveInt = z.coerce.number().int().positive();
const status = z.enum(CANDIDATE_STATUSES);

/** Valida la query string (parametri vuoti = assenti, sconosciuti ignorati): 400 `{error, issues}`. */
function readQuery<S extends z.ZodType>(c: Context<AppEnv>, schema: S): z.infer<S> {
  const raw = Object.fromEntries(Object.entries(c.req.query()).filter(([, v]) => v !== ''));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw httpError(400, 'Parametri non validi.', { issues });
  }
  return parsed.data;
}

function requireIcp(id: number): void {
  if (!getIcp(id)) throw httpError(404, 'ICP non trovato.');
}

function requireCompany(id: number): void {
  if (!getCompany(id)) throw httpError(404, 'Azienda non trovata.');
}

/**
 * `GET /api/icps/:id/candidates?status=` → `{items, total, counts, last_run}`. Senza `status` tutte le
 * candidate (la FE parte da `proposta`). `items` al massimo `CANDIDATES_CAP` righe (punteggio desc, poi
 * nome); `total` = candidate dell'ICP nello stato richiesto (o in tutti) **senza** il cap: se supera
 * `items.length` la tabella mostra solo le prime 500 (P-17). `last_run` = ultima ricerca lookalike
 * riuscita (anche parziale), `null` se mai fatta.
 */
candidatesRoutes.get('/icps/:id/candidates', (c) => {
  const icpId = idParam(c);
  const query = readQuery(c, z.object({ status: status.optional() }));
  requireIcp(icpId);
  const counts = countCandidates(icpId);
  const total = query.status ? counts[query.status] : Object.values(counts).reduce((sum, n) => sum + n, 0);
  const run = lastLookalikeRun(icpId);
  return c.json({
    items: listCandidates(icpId, query.status),
    total,
    counts,
    last_run: run && { at: run.at, read: run.result?.counts.read ?? 0, new_candidates: run.result?.counts.new_candidates ?? 0 },
  });
});

const PatchBody = z.object({ status }).strict();

/**
 * `PATCH /api/icps/:id/candidates/:companyId {status}` → 200 con la candidata aggiornata. Idempotente
 * (stesso stato → 200); `decided_at` si aggiorna a ogni chiamata, anche per "Riproponi" (SPEC E2).
 */
candidatesRoutes.patch('/icps/:id/candidates/:companyId', async (c) => {
  const icpId = idParam(c);
  const companyId = idParam(c, 'companyId');
  const body = await readJson(c, PatchBody);
  requireIcp(icpId);
  const { failed } = setCandidateStatus(icpId, [companyId], body.status);
  // L'azienda può essere sparita dopo un'unione (id assorbito): stessa risposta di una non candidata.
  const updated = failed.length === 0 ? getCandidate(icpId, companyId) : undefined;
  if (!updated) throw httpError(404, 'Candidata non trovata per questo ICP.');
  return c.json(updated);
});

const BulkBody = z
  .object({
    company_ids: z.array(z.number().int().positive()).min(1).max(CANDIDATES_CAP),
    status,
  })
  .strict();

/**
 * `POST /api/icps/:id/candidates/bulk {company_ids, status}` → 200 `{updated, failed: [{company_id,
 * error}]}` per item, non tutto-o-niente (SPEC E3): un id che non è candidata dell'ICP finisce in
 * `failed` senza fermare gli altri. Id ripetuti contano una volta.
 */
candidatesRoutes.post('/icps/:id/candidates/bulk', async (c) => {
  const icpId = idParam(c);
  const body = await readJson(c, BulkBody);
  requireIcp(icpId);
  return c.json(setCandidateStatus(icpId, body.company_ids, body.status));
});

/** `GET /api/companies/:id/candidate-of` → `{items: [{icp_id, icp_name, status, score, decided_at}]}` (SPEC E5). */
candidatesRoutes.get('/companies/:id/candidate-of', (c) => {
  const companyId = idParam(c);
  requireCompany(companyId);
  return c.json({ items: candidateOf(companyId) });
});

/**
 * `GET /api/companies/:id/contacts-at?listId=` → `{last_contacts_at: iso | null}`: data della fonte
 * `apollo_people` più recente dell'azienda ("contatti cercati il <data>", SPEC E5/F12). Con `listId`
 * contano solo le fonti dei prospect membri di quella lista (una lista inesistente non ha membri: `null`).
 */
candidatesRoutes.get('/companies/:id/contacts-at', (c) => {
  const companyId = idParam(c);
  const query = readQuery(c, z.object({ listId: positiveInt.optional() }));
  requireCompany(companyId);
  return c.json({ last_contacts_at: lastContactsByCompany([companyId], query.listId).get(companyId) ?? null });
});
