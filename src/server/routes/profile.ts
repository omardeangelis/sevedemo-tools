import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { getProfile, PROFILE_FIELD_KEYS } from '../../db/profile.js';
import {
  applyProposal,
  discardProposal,
  ITEM_STATUSES,
  NO_PROPOSAL,
  ProposalItemChangedError,
  ProposalItemNotFoundError,
  ProposalStaleError,
  readProposal,
} from '../../db/profile-proposal.js';
import { generateChoiceSchema, planGenerateProfile, type GenerateChoice } from '../../jobs/generate-profile.js';
import { GENERATION_SOURCES } from '../../profile/sources.js';
import { httpError, readJson, readOptionalJson, readQuery } from '../http.js';
import { launchUnlessBlocked, withRunningBlocker } from '../jobs.js';
import type { AppEnv } from '../types.js';

/**
 * Il profilo dell'utente in una lettura sola (own-profile-services T9, B7) e la generazione di profilo e servizi dalle
 * fonti pubbliche (T24): anteprima e avvio. Le scritture dei valori passano da `PUT /api/settings` e `/api/services`.
 * Montato da `app.ts` con `app.route('/api', profileRoutes)`: path assolute sotto `/api`.
 */
export const profileRoutes = new Hono<AppEnv>();

profileRoutes.get('/profile', (c) => c.json(getProfile()));

/**
 * `GET /api/profile/proposal` → la proposta pendente col confronto di adesso (E3, E4, E9, P-12): per ogni voce stato,
 * valore attuale con la sua provenienza, valore proposto e fonti; 404 `no_proposal` se non c'è. Sola lettura.
 */
profileRoutes.get('/profile/proposal', (c) => {
  const proposal = readProposal();
  if (!proposal) throw httpError(404, NO_PROPOSAL, { code: 'no_proposal' });
  return c.json(proposal);
});

const applyBody = z
  .object({
    proposal_id: z.number().int().positive(),
    field: z.enum(PROFILE_FIELD_KEYS).optional(),
    service: z.string().trim().min(1).optional(),
    all: z.literal(true).optional(),
    /** Lo stato in cui il client ha visto la voce: se nel frattempo è cambiato, nulla si scrive (409). */
    expected_status: z.enum(ITEM_STATUSES).optional(),
  })
  .strict()
  .refine((b) => [b.field, b.service, b.all].filter((v) => v !== undefined).length === 1, {
    message: 'Indica una voce sola: field, service oppure all.',
  });
const discardBody = z.object({ proposal_id: z.number().int().positive() }).strict();

/** Errori della proposta → risposta (`proposal_stale` e `item_changed` 409, voce inesistente 404). */
function proposalError(err: unknown): unknown {
  if (err instanceof ProposalStaleError || err instanceof ProposalItemChangedError) return httpError(409, err.message, { code: err.code });
  if (err instanceof ProposalItemNotFoundError) return httpError(404, err.message);
  return err;
}

/**
 * `POST /api/profile/proposal/apply {proposal_id, field | service | all, expected_status?}` → `{applied, conflicts_left,
 * proposal}` (E7–E10): una voce, o con `all` solo quelle non scritte a mano. `proposal` è `null` quando non resta niente
 * da decidere.
 */
profileRoutes.post('/profile/proposal/apply', async (c) => {
  const body = await readJson(c, applyBody);
  const target = body.field ? { field: body.field } : body.service ? { service: body.service } : { all: true as const };
  try {
    return c.json(applyProposal(body.proposal_id, target, body.expected_status));
  } catch (err) {
    throw proposalError(err);
  }
});

/** `DELETE /api/profile/proposal {proposal_id}` → `{ok: true}`: scarta la proposta intera, nessun valore cambia (E12). */
profileRoutes.delete('/profile/proposal', async (c) => {
  const { proposal_id } = await readJson(c, discardBody);
  try {
    discardProposal(proposal_id);
  } catch (err) {
    throw proposalError(err);
  }
  return c.json({ ok: true });
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
  return launchUnlessBlocked(c, 'generate_profile', plan.params, plan.preview.blockers, 'Generazione non avviata');
});
