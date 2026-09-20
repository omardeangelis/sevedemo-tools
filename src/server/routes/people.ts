import { Hono } from 'hono';
import { z } from 'zod';
import {
  addMeeting,
  createPerson,
  findDuplicates,
  linkCompany,
  profileKeysOf,
  unlinkCompany,
  type AddMeetingResult,
  type CreatePersonResult,
} from '../../db/people.js';
import { manualMergeCheck, mergePeopleManual, mergePreview, type MergePatch } from '../../db/person-merge.js';
import { PROSPECT_STATUSES } from '../../db/schema.js';
import { httpError, idParam, readJson, readQuery } from '../http.js';
import type { AppEnv } from '../types.js';
import { patchFields, requireProspect } from './prospects.js';

/**
 * Persone gestite a mano (people-first-crm): collegamento all'azienda (T3), creazione, doppioni e incontri
 * (T5), modifiche d'identità e Unisci (T7). Montato in `app.ts` **prima** di `prospectsRoutes`: le path
 * statiche sotto `/prospects/` devono precedere `/prospects/:id` (PLAN §12).
 */
export const peopleRoutes = new Hono<AppEnv>();

const COMPANY_NOT_FOUND = "Azienda non trovata: forse è stata unita a un'altra.";

const linkSchema = z.object({ companyId: z.coerce.number().int().positive() }).strict();

peopleRoutes.put('/prospects/:id/company', async (c) => {
  const id = idParam(c);
  const body = await readJson(c, linkSchema);
  const outcome = linkCompany(id, body.companyId);
  if (outcome === 'not_found') requireProspect(id);
  if (outcome === 'company_not_found') throw httpError(404, COMPANY_NOT_FOUND, { code: 'company_not_found' });
  return c.json(requireProspect(id));
});

peopleRoutes.delete('/prospects/:id/company', (c) => {
  const id = idParam(c);
  unlinkCompany(id);
  return c.json(requireProspect(id));
});

// ---------------------------------------------------------------------------
// Aggiungi persona (C1–C11), doppioni, "Aggiungi l'incontro" (C9)
// ---------------------------------------------------------------------------

const optionalText = (max: number) => z.string().max(max).nullable().optional();
const positiveInt = z.number().int().positive();
const nextActionSchema = z.object({ on: optionalText(10), text: optionalText(500) }).strict().nullable().optional();

const createSchema = z
  .object({
    fullName: optionalText(300),
    title: optionalText(300),
    companyId: positiveInt.nullable().optional(),
    companyName: optionalText(300),
    linkedinUrl: optionalText(500),
    email: optionalText(300),
    phone: optionalText(100),
    location: optionalText(300),
    meeting: z.object({ context: optionalText(5000), metOn: optionalText(10) }).strict().nullable().optional(),
    listId: positiveInt.nullable().optional(),
    status: z.enum(PROSPECT_STATUSES).nullable().optional(),
    nextAction: nextActionSchema,
    createAnyway: z.boolean().optional(),
  })
  .strict();

const meetingSchema = z
  .object({
    context: optionalText(5000),
    metOn: optionalText(10),
    listId: positiveInt.nullable().optional(),
    nextAction: nextActionSchema,
  })
  .strict();

const names = (refs: Array<{ full_name: string | null }>) => refs.map((r) => r.full_name ?? 'senza nome').join('; ');

/** Errori comuni di creazione e incontro → HTTP (`{error, code, …}` o `{error, issues}`). */
function failure(result: Exclude<CreatePersonResult | AddMeetingResult, { ok: true }>): never {
  switch (result.code) {
    case 'invalid':
      throw httpError(400, 'Dati non validi.', { issues: result.issues });
    case 'linkedin_taken':
      throw httpError(409, `Questo profilo LinkedIn è già nel CRM: ${result.prospect.full_name ?? 'senza nome'}.`, {
        code: 'linkedin_taken',
        prospect: result.prospect,
      });
    case 'email_taken':
      throw httpError(409, `Questa email è già di: ${names(result.prospects)}. Scegli come procedere.`, {
        code: 'email_taken',
        prospects: result.prospects,
      });
    case 'list_archived':
      throw httpError(400, `La lista '${result.listName}' è archiviata: scegline un'altra.`, { code: 'list_archived' });
    case 'list_not_found':
      throw httpError(400, 'Lista inesistente.', { code: 'list_not_found' });
    case 'company_not_found':
      throw httpError(404, COMPANY_NOT_FOUND, { code: 'company_not_found' });
    case 'prospect_not_found':
      throw httpError(404, "Questa persona non è più nel CRM (forse unita a un'altra persona).", { code: 'prospect_not_found' });
  }
}

const duplicatesQuery = z.object({
  linkedinUrl: z.string().max(500).optional(),
  email: z.string().max(300).optional(),
  name: z.string().max(300).optional(),
  excludeId: z.coerce.number().int().positive().optional(),
});

/** Doppioni per il form (all'uscita dal campo) e per le modifiche della scheda: `{linkedin, email[], name[]}`. */
peopleRoutes.get('/prospects/duplicates', (c) => {
  const query = readQuery(c, duplicatesQuery, 'Parametri non validi.');
  return c.json(findDuplicates(query));
});

peopleRoutes.post('/prospects', async (c) => {
  const body = await readJson(c, createSchema);
  const result = createPerson(body);
  if (!result.ok) failure(result);
  return c.json(requireProspect(result.id), 201);
});

peopleRoutes.post('/prospects/:id/meetings', async (c) => {
  const id = idParam(c);
  const body = await readJson(c, meetingSchema);
  const result = addMeeting(id, body);
  if (!result.ok) failure(result);
  return c.json({
    prospect: requireProspect(id),
    replaced_next_action: result.replacedNextAction,
    source_created: result.sourceCreated,
  });
});

// ---------------------------------------------------------------------------
// Unisci (E6–E8): anteprima e conferma. Resta la persona della scheda (`:id`).
// ---------------------------------------------------------------------------

const mergePatchSchema = z.object(patchFields).strict();

/** `patch` validata; URL LinkedIn già normalizzato (il caso LinkedIn di E5/E7). 400 se non valida. */
function readMergePatch(raw: unknown): { patch: MergePatch; patchUrl: string | null } {
  const parsed = mergePatchSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw httpError(400, 'Dati non validi.', { issues: parsed.error.issues.map((i) => ({ path: `patch.${i.path.join('.')}`, message: i.message })) });
  }
  const url = parsed.data.linkedin_url?.trim();
  const keys = url ? profileKeysOf(url) : undefined;
  if (url && !keys) throw httpError(400, 'Non è il profilo di una persona.', { code: 'invalid_linkedin' });
  return { patch: parsed.data, patchUrl: keys?.url ?? null };
}

const OTHER_NOT_FOUND = "L'altra persona non è più nel CRM (forse unita da un job). Nessuna modifica.";

const previewQuery = z.object({ otherId: z.coerce.number().int().positive(), patch: z.string().max(40_000).optional() });

peopleRoutes.get('/prospects/:id/merge-preview', (c) => {
  const id = idParam(c);
  const query = readQuery(c, previewQuery, 'Parametri non validi.');
  let rawPatch: unknown = {};
  if (query.patch) {
    try {
      rawPatch = JSON.parse(query.patch);
    } catch {
      throw httpError(400, 'patch non è JSON valido.');
    }
  }
  const { patch, patchUrl } = readMergePatch(rawPatch);
  const check = manualMergeCheck(id, query.otherId, patch, patchUrl);
  if (!check.ok && check.code === 'not_found') requireProspect(id);
  if (!check.ok && check.code === 'other_not_found') throw httpError(404, OTHER_NOT_FOUND, { code: 'other_not_found' });
  return c.json(mergePreview(check as Parameters<typeof mergePreview>[0]));
});

const mergeSchema = z.object({ otherId: positiveInt, patch: z.unknown().optional() }).strict();

peopleRoutes.post('/prospects/:id/merge', async (c) => {
  const id = idParam(c);
  const body = await readJson(c, mergeSchema);
  const { patch, patchUrl } = readMergePatch(body.patch);
  const outcome = mergePeopleManual(id, body.otherId, patch, patchUrl);
  if (outcome === 'not_found') requireProspect(id);
  if (outcome === 'other_not_found') throw httpError(404, OTHER_NOT_FOUND, { code: 'other_not_found' });
  if (typeof outcome === 'object') throw httpError(409, outcome.notMergeable, { code: 'not_mergeable' });
  return c.json(requireProspect(id));
});
