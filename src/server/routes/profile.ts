import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { getProfile, PROFILE_FIELD_KEYS } from '../../db/profile.js';
import {
  applyProposal,
  ITEM_STATUSES,
  NO_PROPOSAL,
  ProposalEditError,
  ProposalItemChangedError,
  ProposalItemDecidedError,
  ProposalItemNotFoundError,
  ProposalItemOpenError,
  proposalState,
  ProposalStaleError,
  ProposalUndoBlockedError,
  readProposal,
  rejectProposal,
  undoDecision,
  type ItemTarget,
  type Target,
} from '../../db/profile-proposal.js';
import { ServiceNameTakenError } from '../../db/services.js';
import { generateChoiceSchema, planGenerateProfile, type GenerateChoice } from '../../jobs/generate-profile.js';
import { GENERATION_SOURCES } from '../../profile/sources.js';
import { httpError, readJson, readOptionalJson, readQuery } from '../http.js';
import { launchUnlessBlocked, withRunningBlocker } from '../jobs.js';
import type { AppEnv } from '../types.js';

/**
 * Il profilo dell'utente in una lettura sola (own-profile-services T9, B7) e la generazione di profilo e servizi dalle
 * fonti pubbliche (T24): anteprima e avvio. Le scritture dei valori passano da `PUT /api/settings` e `/api/services`;
 * quelle della proposta (revisione 2026-10-03: applica, modifica, rifiuta, annulla voce per voce) da qui.
 * Montato da `app.ts` con `app.route('/api', profileRoutes)`: path assolute sotto `/api`.
 */
export const profileRoutes = new Hono<AppEnv>();

profileRoutes.get('/profile', (c) => c.json({ ...getProfile(), ...proposalState() }));

/**
 * `GET /api/profile/proposal` → l'ultima proposta, aperta o chiusa (`open`), col confronto di adesso per le voci da
 * decidere e la decisione registrata per le altre (E3, E4, E9, P-12); 404 `no_proposal` se non c'è. Sola lettura.
 */
profileRoutes.get('/profile/proposal', (c) => {
  const proposal = readProposal();
  if (!proposal) throw httpError(404, NO_PROPOSAL, { code: 'no_proposal' });
  return c.json(proposal);
});

const text = z.string().nullable().optional();
/** I valori del dialog dei servizi per "Modifica…" (B2: solo il nome è obbligatorio). */
const serviceValues = z
  .object({
    name: z.string().trim().min(1, 'Inserisci il nome del servizio.'),
    description: text,
    audience: text,
    problem: text,
    proof: text,
    notes: text,
  })
  .strict();

/** Una voce (`field` | `service`) o, dove ammesso, tutte quelle da decidere (`all`, tranne `except`). */
const targetShape = {
  proposal_id: z.number().int().positive(),
  field: z.enum(PROFILE_FIELD_KEYS).optional(),
  service: z.string().trim().min(1).optional(),
  all: z.literal(true).optional(),
  /** Voci lasciate fuori dall'azione di massa: quelle aperte in Modifica (chiavi `field:…` / `service:…`). */
  except: z.array(z.string()).optional(),
  /** Lo stato in cui il client ha visto la voce: se nel frattempo è cambiato, nulla si scrive (409). */
  expected_status: z.enum(ITEM_STATUSES).optional(),
};
const oneTarget = (b: { field?: unknown; service?: unknown; all?: unknown }) =>
  [b.field, b.service, b.all].filter((v) => v !== undefined).length === 1;
const ONE_TARGET = { message: 'Indica una voce sola: field, service oppure all.' };

const applyBody = z
  .object({
    ...targetShape,
    /** "Modifica" di un campo: il testo dell'utente al posto della proposta. */
    value: z.string().optional(),
    /** "Modifica…" di un servizio: i valori del dialog. */
    service_values: serviceValues.optional(),
  })
  .strict()
  .refine(oneTarget, ONE_TARGET)
  .refine((b) => b.value === undefined || b.field !== undefined, { message: 'Un testo modificato vale solo per un campo.' })
  .refine((b) => b.service_values === undefined || b.service !== undefined, { message: 'I valori del servizio valgono solo per un servizio.' })
  .refine((b) => b.except === undefined || b.all !== undefined, { message: 'Le voci escluse valgono solo per tutte le voci.' });
const rejectBody = z
  .object(targetShape)
  .strict()
  .refine(oneTarget, ONE_TARGET)
  .refine((b) => b.except === undefined || b.all !== undefined, { message: 'Le voci escluse valgono solo per tutte le voci.' });
const undoBody = z
  .object({ proposal_id: targetShape.proposal_id, field: targetShape.field, service: targetShape.service })
  .strict()
  .refine((b) => (b.field === undefined) !== (b.service === undefined), { message: 'Indica una voce sola: field oppure service.' });

function targetOf(b: { field?: (typeof PROFILE_FIELD_KEYS)[number]; service?: string; except?: string[] }): Target {
  if (b.field) return { field: b.field };
  if (b.service) return { service: b.service };
  return { all: true, except: b.except };
}

/** Errori della proposta → risposta: conflitti di stato 409 con il loro `code`, testo da rifare 400, voce inesistente 404. */
function proposalError(err: unknown): unknown {
  if (
    err instanceof ProposalStaleError ||
    err instanceof ProposalItemChangedError ||
    err instanceof ProposalItemDecidedError ||
    err instanceof ProposalItemOpenError ||
    err instanceof ProposalUndoBlockedError
  ) {
    return httpError(409, err.message, { code: err.code });
  }
  if (err instanceof ProposalEditError) return httpError(400, err.message, { code: err.code });
  if (err instanceof ServiceNameTakenError) {
    return httpError(409, err.message, { code: err.code, service: { id: err.existing.id, name: err.existing.name } });
  }
  if (err instanceof ProposalItemNotFoundError) return httpError(404, err.message);
  return err;
}

function withProposalErrors<T>(write: () => T): T {
  try {
    return write();
  } catch (err) {
    throw proposalError(err);
  }
}

/**
 * `POST /api/profile/proposal/apply {proposal_id, field | service | all, except?, expected_status?, value?,
 * service_values?}` → `{applied, fields, services, proposal}`: una voce — com'è, o con il testo dell'utente (`value`,
 * scritto a mano) o i valori del dialog (`service_values`) —, oppure con `all` le nuove e modificate da decidere (E8).
 * `proposal` è la proposta riletta, aperta o chiusa.
 */
profileRoutes.post('/profile/proposal/apply', async (c) => {
  const body = await readJson(c, applyBody);
  const edit = body.value ?? body.service_values;
  return c.json(withProposalErrors(() => applyProposal(body.proposal_id, targetOf(body), { expected: body.expected_status, edit })));
});

/**
 * `POST /api/profile/proposal/reject {proposal_id, field | service | all, except?, expected_status?}` →
 * `{rejected, proposal}`: una voce, o con `all` tutte quelle da decidere, conflitti compresi (E12). Nessun valore cambia.
 */
profileRoutes.post('/profile/proposal/reject', async (c) => {
  const body = await readJson(c, rejectBody);
  return c.json(withProposalErrors(() => rejectProposal(body.proposal_id, targetOf(body), body.expected_status)));
});

/**
 * `POST /api/profile/proposal/undo {proposal_id, field | service}` → `{proposal}`: la voce torna da decidere e il valore
 * di prima torna con la sua provenienza; 409 `undo_blocked` se è cambiato dopo la decisione.
 */
profileRoutes.post('/profile/proposal/undo', async (c) => {
  const body = await readJson(c, undoBody);
  return c.json({ proposal: withProposalErrors(() => undoDecision(body.proposal_id, targetOf(body) as ItemTarget)) });
});

/** Fonti in querystring: `exclude=website,posts`; vuoto = nessuna. */
const sourcesCsv = z
  .string()
  .transform((s) => s.split(',').map((v) => v.trim()).filter(Boolean))
  .pipe(z.array(z.enum(GENERATION_SOURCES)));
const previewQuery = z.object({ exclude: sourcesCsv.optional(), force: sourcesCsv.optional() }).strict();

/** La scelta dalla querystring: il client manda le fonti separate da virgola (`qs`). */
const choiceFromQuery = (c: Context<AppEnv>): GenerateChoice => readQuery(c, previewQuery);

/**
 * `GET /api/profile/generate/preview?exclude=&force=` → anteprima con le fonti una per una (D3, D8, D9): gli avvisi
 * di una fonte stanno nella sua riga di `sources`, `warnings` porta solo quelli che non sono di una fonte (P-28).
 */
profileRoutes.get('/profile/generate/preview', (c) => c.json(withRunningBlocker(planGenerateProfile(choiceFromQuery(c)).preview)));

/** `POST /api/profile/generate {exclude?, force?}` → 202 `{job}` | 400 `blocked` | 409 `job_running`. */
profileRoutes.post('/profile/generate', async (c) => {
  const plan = planGenerateProfile(await readOptionalJson(c, generateChoiceSchema));
  return launchUnlessBlocked(c, 'generate_profile', plan.params, plan.preview.blockers, 'Analisi non avviata');
});
