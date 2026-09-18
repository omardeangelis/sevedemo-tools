import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { APOLLO_EMPLOYEE_RANGES, normalizeRange } from '../../apollo/similarity.js';
import { config } from '../../config.js';
import { lookalikeRuns } from '../../db/candidates.js';
import { getIcp } from '../../db/icps.js';
import { planLookalike, type LookalikeInput, type LookalikePlan } from '../../jobs/lookalike-companies.js';
import { isLookalikePerPage, LOOKALIKE_PER_PAGE, type LookalikePerPage } from '../../jobs/types.js';
import { httpError, idParam, readJson, readQuery } from '../http.js';
import { launchUnlessBlocked, withRunningBlocker } from '../jobs.js';
import type { AppEnv } from '../types.js';
import { ContactsOptionsBody, readContactsOptionsQuery } from './contacts.js';

/**
 * Ricerca aziende simili: preview, storico delle ricerche, avvio (SPEC D, PLAN T7a; pipeline T9).
 * Montato da `app.ts` con `app.route('/api', lookalikeRoutes)`: path assolute sotto `/api`.
 *
 * Contratto per il frontend:
 *
 * - `GET /api/icps/:id/lookalike/preview?pages=&perPage=&restart=&custom=&keywords=&ranges=&locations=`
 *   - `pages` 1–`APOLLO_MAX_COMPANY_PAGES` (default 1), `perPage` 25 · 50 · 100 (default 25),
 *     `restart=1` = "Ricomincia dalla pagina 1"; valori fuori range → 400 `{error, issues[{path, message}]}`.
 *   - Filtri: senza `custom` valgono i **derivati** (referenze arricchite + ICP) e i parametri dei filtri
 *     sono ignorati. Con `custom=1` valgono **esattamente** i valori passati come parametri ripetuti
 *     (`keywords=hr&keywords=saas&ranges=21-50&locations=Milano`; un parametro assente = lista vuota,
 *     quindi `custom=1` da solo = "ho tolto tutto" → blocker filtri vuoti). Niente separatori a virgola:
 *     una località può contenerne. Valori vuoti ignorati; fascia non Apollo → 400.
 *   - Pipeline (SPEC H, T9): `contacts=1` la attiva; senza, i parametri `contacts*` sono ignorati. Stesse
 *     regole della preview di "Trova contatti" con il prefisso `contacts`:
 *     `contactsListId=7` (assente = blocker "Scegli una lista di destinazione."), `contactsRoles=CTO&
 *     contactsRoles=Head%20of%20Engineering` e `contactsLocations=…` **solo come chiavi ripetute** (chiave
 *     assente = default dell'ICP; `contactsRoles=` vuota = nessun ruolo), `contactsSeniorities=vp,head` (o
 *     ripetuta), `contactsPerCompany=10` (1–100, assente = `APOLLO_PEOPLE_PER_COMPANY`). Valori non validi
 *     → 400 con `issues[].path` = nome del parametro (`contactsPerCompany`).
 *   - Risposta: `{counts: {pages, per_page, start_page, est_credits, requests}, est_cost_usd, warnings,
 *     blockers, filters: {keywords, ranges, locations, origins: {keywords, ranges, locations} (valore →
 *     nomi referenze / 'ICP', [] se aggiunto a mano), notes, custom, derived: {keywords, ranges,
 *     locations}}, resume: {run_id, last_run_at, per_page, last_page, last_page_declared, next_page |
 *     null, exhausted, restart} | null, references: [{company_id, name, domain, linkedin_url, status:
 *     'enriched'|'to_enrich'|'not_found'|'key_conflict'|'no_domain', enriched_at, attempted_at}],
 *     contacts: null}`.
 *   - Con `contacts=1`: `est_credits`/`requests`/`est_cost_usd` sono i **totali** (ricerca + contatti) e
 *     `counts` aggiunge `search_est_credits` (pagine + pagine × dimensione), `search_requests`,
 *     `contacts_companies` (fino a pagine × dimensione), `contacts_per_company`, `contacts_est_credits`
 *     (fino a aziende × tetto = persone), `contacts_requests` (una ricerca per azienda + match a lotti da
 *     10); `contacts: {list_id | null, roles, seniorities, locations, per_company}` = opzioni risolte;
 *     warning in più "Le persone entreranno in lista…" (+ "nessun ruolo" di C); blocker in più: nessuna
 *     lista attiva per l'ICP → "Crea una lista per questo ICP per usare questa opzione.", altrimenti quelli
 *     della lista di C (non scelta, inesistente, di un altro ICP, archiviata).
 * - `GET /api/icps/:id/lookalike/runs` → `{items: [{id, at, state, pages, per_page, start_page, filters,
 *   counts, warnings, stats: {proposed, without_location, buckets: {basso|medio|alto: {proposta,
 *   accettata, scartata}}}}]}` (ultime 5 riuscite, dalla più recente; SPEC D14).
 * - `POST /api/icps/:id/lookalike {pages, perPage?, keywords[], ranges[], locations[], restart?,
 *   autoContacts?: {listId, roles?, seniorities?, locations?, perCompany?} | null}` (body strict, anche
 *   `autoContacts`; i filtri sono sempre quelli confermati nel dialog; campi assenti di `autoContacts` =
 *   stessi default della preview) → 202 `{job}` con i `params` congelati (pagina di partenza e opzioni dei
 *   contatti risolte qui) · 400 `{code:'blocked', blockers}` (chiave mancante, filtri vuoti, lista della
 *   pipeline) · 409 `{code:'job_running', job_id}` · 404 ICP inesistente.
 *   Esito del job con pipeline: `result.counts` = conteggi della ricerca + tutte le chiavi di
 *   `apollo_people` con prefisso `contacts_` (0 se il passo non gira); `summary` su due righe separate da
 *   `\n` ("Aziende simili per …" / "Contatti Apollo: …"), una sola se la ricerca non trova aziende.
 */
export const lookalikeRoutes = new Hono<AppEnv>();

/** Ricerche mostrate in "Ricerche precedenti". */
const RUNS_LIMIT = 5;
/** Valori massimi per filtro (i derivati sono ≤ 10 parole chiave + settori dell'ICP). */
const MAX_FILTER_VALUES = 100;

// ---------------------------------------------------------------------------
// Validazione
// ---------------------------------------------------------------------------

const keywordValue = z.string().max(100, 'Parola chiave troppo lunga (massimo 100 caratteri).');
const locationValue = z.string().max(200, 'Località troppo lunga (massimo 200 caratteri).');
const rangeValue = z
  .string()
  .refine(
    (v) => v.trim() === '' || normalizeRange(v) !== undefined,
    `Fascia di dipendenti non valida: ammesse ${APOLLO_EMPLOYEE_RANGES.join(', ')}.`,
  );
const filterLists = {
  keywords: z.array(keywordValue).max(MAX_FILTER_VALUES, `Al massimo ${MAX_FILTER_VALUES} parole chiave.`),
  ranges: z.array(rangeValue).max(APOLLO_EMPLOYEE_RANGES.length),
  locations: z.array(locationValue).max(MAX_FILTER_VALUES, `Al massimo ${MAX_FILTER_VALUES} località.`),
};

const PER_PAGE_MESSAGE = `Aziende per pagina: ${LOOKALIKE_PER_PAGE.join(', ')}.`;
const perPageValue = z
  .number(PER_PAGE_MESSAGE)
  .refine(isLookalikePerPage, PER_PAGE_MESSAGE)
  .transform((n) => n as LookalikePerPage);

/** Pagine 1–tetto: il tetto si legge a ogni richiesta (config mutabile nei test). */
function pagesValue() {
  const max = config.apolloMaxCompanyPages;
  const message = `Pagine di ricerca: da 1 a ${max} (APOLLO_MAX_COMPANY_PAGES).`;
  return z.number(message).int(message).min(1, message).max(max, message);
}

/** Pipeline nel body dell'avvio: le opzioni di "Trova contatti" con la lista obbligatoria (SPEC H1). */
const LIST_REQUIRED = 'Scegli una lista di destinazione per i contatti.';
const AutoContactsBody = ContactsOptionsBody.extend({
  listId: z.number(LIST_REQUIRED).int(LIST_REQUIRED).positive(LIST_REQUIRED),
}).strict();

/** Query della preview → input del piano (formato nel commento del router). */
function previewInput(c: Context<AppEnv>): LookalikeInput {
  const one = (name: string) => {
    const v = c.req.query(name);
    return v === undefined || v.trim() === '' ? undefined : v;
  };
  const many = (name: string) => (c.req.queries(name) ?? []).filter((v) => v.trim() !== '');
  const schema = z.object({
    pages: z.coerce.number().pipe(pagesValue()).optional(),
    perPage: z.coerce.number().pipe(perPageValue).optional(),
    restart: z.stringbool().optional(),
    custom: z.stringbool().optional(),
    contacts: z.stringbool().optional(),
    ...filterLists,
  });
  const { pages, perPage, restart, custom, contacts, keywords, ranges, locations } = readQuery(c, schema, undefined, {
    raw: {
      pages: one('pages'),
      perPage: one('perPage'),
      restart: one('restart'),
      custom: one('custom'),
      contacts: one('contacts'),
      keywords: many('keywords'),
      ranges: many('ranges'),
      locations: many('locations'),
    },
  });
  return {
    pages,
    perPage,
    restart,
    filters: custom ? { keywords, ranges, locations } : null,
    autoContacts: contacts ? readContactsOptionsQuery(c, 'contacts') : null,
  };
}

function requirePlan(icpId: number, input: LookalikeInput): LookalikePlan {
  const plan = planLookalike(icpId, input);
  if (!plan) throw httpError(404, 'ICP non trovato.');
  return plan;
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

lookalikeRoutes.get('/icps/:id/lookalike/preview', (c) => {
  const icpId = idParam(c);
  // 404 prima della validazione della query (400); `requirePlan` copre un ICP eliminato nel frattempo.
  if (!getIcp(icpId)) throw httpError(404, 'ICP non trovato.');
  const plan = requirePlan(icpId, previewInput(c));
  return c.json({
    ...withRunningBlocker(plan.preview),
    filters: plan.filters,
    resume: plan.resume,
    references: plan.references,
    contacts: plan.contacts,
  });
});

lookalikeRoutes.get('/icps/:id/lookalike/runs', (c) => {
  const icpId = idParam(c);
  if (!getIcp(icpId)) throw httpError(404, 'ICP non trovato.');
  return c.json({ items: lookalikeRuns(icpId, RUNS_LIMIT) });
});

lookalikeRoutes.post('/icps/:id/lookalike', async (c) => {
  const icpId = idParam(c);
  // 404 prima della validazione del body (400), come nella preview.
  if (!getIcp(icpId)) throw httpError(404, 'ICP non trovato.');
  const body = await readJson(
    c,
    z
      .object({
        pages: pagesValue(),
        perPage: perPageValue.optional(),
        ...filterLists,
        restart: z.boolean().optional(),
        // Pipeline opt-in (SPEC H): `null`/assente = solo ricerca aziende.
        autoContacts: AutoContactsBody.nullable().optional(),
      })
      .strict(),
  );
  const { params, preview } = requirePlan(icpId, {
    pages: body.pages,
    perPage: body.perPage,
    restart: body.restart,
    filters: { keywords: body.keywords, ranges: body.ranges, locations: body.locations },
    autoContacts: body.autoContacts ?? null,
  });
  // Stessi blocker della preview senza "job in corso" (lo gestisce `launchJob` con 409): qui la lista della
  // pipeline c'è sempre, quindi coincidono con `configBlockers(params)` usati da "Riprova".
  return launchUnlessBlocked(c, 'lookalike_companies', params, preview.blockers, 'Ricerca non avviata');
});
