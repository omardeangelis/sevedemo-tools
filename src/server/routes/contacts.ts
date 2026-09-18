import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { APOLLO_SENIORITIES } from '../../apollo/requests.js';
import { getIcp, type Icp } from '../../db/icps.js';
import {
  APOLLO_PEOPLE_PER_COMPANY_MAX,
  CONTACTS_COMPANIES_MAX,
  planContacts,
  type ContactsInput,
} from '../../jobs/apollo-people.js';
import { httpError, idParam, readJson, readQuery } from '../http.js';
import { launchUnlessBlocked, withRunningBlocker } from '../jobs.js';
import type { AppEnv } from '../types.js';

/**
 * Contatti Apollo nelle aziende scelte: preview e avvio (SPEC F, S-6, PLAN T8); anche dal dettaglio
 * azienda (SPEC F12) con `:id` = ICP della lista scelta e `companyIds=[id]`. Montato da `app.ts` con
 * `app.route('/api', contactsRoutes)`: path assolute sotto `/api`.
 *
 * `GET /api/icps/:id/contacts/preview` — liste nella querystring:
 * - `companyIds`: chiave ripetuta e/o valori separati da virgola (`companyIds=1,2&companyIds=3`);
 * - `seniorities`: come `companyIds` (valori di `APOLLO_SENIORITIES`);
 * - `roles`, `locations`: **solo chiave ripetuta**, un valore per chiave (un titolo o una località può
 *   contenere virgole: "Milano, Italia"). Chiave assente = default dell'ICP; `roles=` (vuota) = nessuno;
 * - `listId`, `perCompany` (1–100): valori singoli; assenti = nessuna lista (blocker) / default config.
 *
 * `POST /api/icps/:id/contacts {companyIds, listId, roles?, seniorities?, locations?, perCompany?}` → 202
 * `{job}` | 400 `blocked` | 409 `job_running`; campi assenti = stessi default della preview.
 */
export const contactsRoutes = new Hono<AppEnv>();

const positiveInt = z.number().int().positive();
const perCompanyText = `Il massimo di persone per azienda va da 1 a ${APOLLO_PEOPLE_PER_COMPANY_MAX}.`;
const senioritiesText = `Seniority Apollo non valida (ammesse: ${APOLLO_SENIORITIES.join(', ')}).`;

/**
 * Opzioni del passo contatti (SPEC F1): riusabili dalla pipeline `autoContacts` (T9), dove la lista è
 * obbligatoria con `.required({listId: true})` o equivalente.
 */
export const ContactsOptionsBody = z.object({
  listId: positiveInt.optional(),
  roles: z.array(z.string().max(200)).max(100).optional(),
  seniorities: z.array(z.enum(APOLLO_SENIORITIES, { error: senioritiesText })).max(APOLLO_SENIORITIES.length).optional(),
  locations: z.array(z.string().max(200)).max(100).optional(),
  perCompany: z.number().int(perCompanyText).min(1, perCompanyText).max(APOLLO_PEOPLE_PER_COMPANY_MAX, perCompanyText).optional(),
});

const ContactsBody = ContactsOptionsBody.extend({
  companyIds: z.array(positiveInt).max(CONTACTS_COMPANIES_MAX),
}).strict();

const PreviewQuery = ContactsOptionsBody.extend({
  companyIds: z.array(positiveInt).max(CONTACTS_COMPANIES_MAX),
});

function icpOr404(id: number): Icp {
  const icp = getIcp(id);
  if (!icp) throw httpError(404, 'ICP non trovato.');
  return icp;
}

/** Valori separati da virgola e/o chiave ripetuta, senza vuoti. */
function splitValues(values: string[] | undefined): string[] {
  return (values ?? []).flatMap((v) => v.split(',')).map((v) => v.trim()).filter((v) => v !== '');
}

/** Numero intero dalla querystring: `undefined` se assente o vuoto, `NaN` se non numerico (→ 400). */
function numberValue(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  return /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : Number.NaN;
}

/** Nome del parametro con il prefisso (`contacts` + `listId` → `contactsListId`; path annidati inclusi). */
function prefixed(prefix: string, name: string): string {
  return prefix === '' ? name : `${prefix}${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

/** Opzioni dei contatti grezze dalla querystring (regole nel commento del router), con i nomi prefissati. */
function contactsOptionsRaw(c: Context<AppEnv>, prefix: string) {
  const queries = c.req.queries();
  const seniorities = queries[prefixed(prefix, 'seniorities')];
  return {
    listId: numberValue(c.req.query(prefixed(prefix, 'listId'))),
    roles: queries[prefixed(prefix, 'roles')],
    seniorities: seniorities === undefined ? undefined : splitValues(seniorities),
    locations: queries[prefixed(prefix, 'locations')],
    perCompany: numberValue(c.req.query(prefixed(prefix, 'perCompany'))),
  };
}

/**
 * Opzioni del passo contatti dalla querystring, con le regole della preview di "Trova contatti": usata dalla
 * preview della ricerca simili con `prefix` `contacts` (`contactsListId`, `contactsRoles`, …). 400 con
 * `issues[].path` = nome del parametro (`contactsPerCompany`).
 */
export function readContactsOptionsQuery(c: Context<AppEnv>, prefix = '') {
  return readQuery(c, ContactsOptionsBody, undefined, {
    raw: contactsOptionsRaw(c, prefix),
    pathName: (path) => prefixed(prefix, path),
  });
}

/** Preview uniforme `{counts, est_cost_usd, warnings, blockers}` (FLOW C.2), con il blocker "job in corso". */
contactsRoutes.get('/icps/:id/contacts/preview', (c) => {
  const icp = icpOr404(idParam(c));
  const companyIds = splitValues(c.req.queries('companyIds')).map((v) => (/^\d+$/.test(v) ? Number(v) : Number.NaN));
  const input: ContactsInput = readQuery(c, PreviewQuery, undefined, { raw: { companyIds, ...contactsOptionsRaw(c, '') } });
  return c.json(withRunningBlocker(planContacts(icp.id, input).preview));
});

/**
 * Avvio: ricalcola il piano; con blocker 400 `{error, code:'blocked', blockers}`, altrimenti `launchJob`
 * con i `params` risolti (202 `{job}`, o 409 `job_running`).
 */
contactsRoutes.post('/icps/:id/contacts', async (c) => {
  const id = idParam(c);
  const body = await readJson(c, ContactsBody);
  const icp = icpOr404(id);
  const { preview, params } = planContacts(icp.id, body);
  return launchUnlessBlocked(c, 'apollo_people', params, preview.blockers, 'Contatti non avviati');
});
