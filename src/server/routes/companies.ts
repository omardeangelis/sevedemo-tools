import { Hono } from 'hono';
import { z } from 'zod';
import { EMPLOYEES_MODES } from '../../config.js';
import {
  createCompany,
  findCompanyByUrl,
  getCompanyDetail,
  listCompanies,
  updateCompany,
  type Company,
} from '../../db/companies.js';
import { getIcp, setReferenceCompany } from '../../db/icps.js';
import { getList } from '../../db/lists.js';
import { REFERENCE_OUTCOMES } from '../../db/schema.js';
import { getReadiness } from '../../db/settings.js';
import {
  EMPLOYEES_MAX_ITEMS,
  archivedListText,
  estimateSourcingCostUsd,
  resolveFilters,
  type SourceCompanyParams,
} from '../../jobs/source-company.js';
import type { JobPreview } from '../../jobs/types.js';
import { cleanList, normalizeCompanyUrl } from '../../util/fields.js';
import { httpError, idParam, readJson } from '../http.js';
import { launchJob, runningJobBlocker } from '../jobs.js';
import type { AppEnv } from '../types.js';

/**
 * Aziende: anagrafica (crm-foundation T4) e sourcing persone da azienda (T9, che estende
 * questo file con `from-url` e `source*`).
 * Montato da `app.ts` con `app.route('/api', companiesRoutes)`: dichiara le path assolute
 * sotto `/api` (es. `/companies/:id` → `/api/companies/:id`).
 */
export const companiesRoutes = new Hono<AppEnv>();

const text = z.string().nullable().optional();

const CompanyFields = z.object({
  linkedin_url: z.string(),
  name: text,
  website: text,
  industry: text,
  size: text,
  location: text,
  notes: text,
});

/** 400 se l'URL non è una pagina aziendale LinkedIn (testo mostrato inline dalla UI). */
function companyUrlOr400(raw: string): string {
  const url = normalizeCompanyUrl(raw);
  if (!url) {
    throw httpError(400, 'Inserisci un URL del tipo linkedin.com/company/<nome>', { code: 'invalid_company_url' });
  }
  return url;
}

/** 409 `duplicate` con l'id dell'azienda esistente. */
function duplicateCompany(existing: Company) {
  return httpError(409, `Azienda già presente: ${existing.name ?? existing.linkedin_url}.`, {
    code: 'duplicate',
    existing_id: existing.id,
  });
}

function companyOr404(id: number) {
  const company = getCompanyDetail(id);
  if (!company) throw httpError(404, 'Azienda non trovata.');
  return company;
}

companiesRoutes.get('/companies', (c) => c.json({ items: listCompanies({ q: c.req.query('q') }) }));

companiesRoutes.post('/companies', async (c) => {
  const body = await readJson(c, CompanyFields.strict());
  const existing = findCompanyByUrl(companyUrlOr400(body.linkedin_url));
  if (existing) throw duplicateCompany(existing);
  const company = createCompany(body);
  return c.json(companyOr404(company.id), 201);
});

companiesRoutes.get('/companies/:id', (c) => c.json(companyOr404(idParam(c))));

companiesRoutes.patch('/companies/:id', async (c) => {
  const id = idParam(c);
  const body = await readJson(c, CompanyFields.partial().strict());
  companyOr404(id);
  if (body.linkedin_url !== undefined) {
    const existing = findCompanyByUrl(companyUrlOr400(body.linkedin_url));
    if (existing && existing.id !== id) throw duplicateCompany(existing);
  }
  updateCompany(id, body);
  return c.json(companyOr404(id));
});

// ---------------------------------------------------------------------------
// Aggiunta da URL e sourcing persone (T9)
// ---------------------------------------------------------------------------

const positiveInt = z.coerce.number().int().positive();

const FromUrlBody = z
  .object({ url: z.string(), icpId: positiveInt.optional(), outcome: z.enum(REFERENCE_OUTCOMES).optional() })
  .strict()
  .refine((b) => b.outcome === undefined || b.icpId !== undefined, {
    message: "L'esito del riferimento richiede un ICP.",
    path: ['outcome'],
  });

/**
 * "Incolla e vai": crea l'azienda dall'URL o ritorna quella esistente (201/200, `created`), e se
 * c'è `icpId` la rende riferimento dell'ICP (default esito `riferimento`). ICP inesistente → 400
 * senza creare nulla.
 */
companiesRoutes.post('/companies/from-url', async (c) => {
  const body = await readJson(c, FromUrlBody);
  const url = companyUrlOr400(body.url);
  if (body.icpId !== undefined && !getIcp(body.icpId)) {
    throw httpError(400, 'ICP inesistente.', { code: 'icp_not_found' });
  }
  const existing = findCompanyByUrl(url);
  const company = existing ?? createCompany({ linkedin_url: url });
  if (body.icpId !== undefined) setReferenceCompany(body.icpId, company.id, { outcome: body.outcome });
  return c.json({ ...companyOr404(company.id), created: !existing }, existing ? 200 : 201);
});

const maxItems = z.coerce.number().int().min(1).max(EMPLOYEES_MAX_ITEMS);

const PreviewQuery = z.object({
  listId: positiveInt.optional(),
  mode: z.enum(EMPLOYEES_MODES).optional(),
  maxItems: maxItems.optional(),
  /** Ruoli del dialog separati da virgola; presente ma vuoto = nessun ruolo (assente = ruoli dell'ICP). */
  roles: z.string().optional(),
});

const SourceBody = z
  .object({
    listId: positiveInt,
    roles: z.array(z.string()).max(100).optional(),
    locations: z.array(z.string()).max(100).optional(),
    maxItems: maxItems.optional(),
    mode: z.enum(EMPLOYEES_MODES).optional(),
  })
  .strict();

type SourcingInput = Omit<SourceCompanyParams, 'companyId' | 'listId'> & { listId?: number };

/**
 * Preview uniforme del sourcing e `params` completi da salvare sul job (ruoli, località, tetto e
 * modalità risolti ora: il job e il "Riprova" usano esattamente ciò che la preview ha mostrato).
 * `params` è `null` se manca la lista (c'è comunque un blocker).
 */
function planSourcing(
  company: Company,
  input: SourcingInput,
): { preview: JobPreview; configBlockers: string[]; params: SourceCompanyParams | null } {
  const list = input.listId !== undefined ? getList(input.listId) : null;
  const filters = resolveFilters(input, list ? getIcp(list.icp_id) : undefined);

  // Blocchi di configurazione (400 all'avvio); il job in corso è solo in preview: all'avvio risponde `launchJob` (409).
  const configBlockers: string[] = [];
  if (!getReadiness().apify) configBlockers.push('APIFY_TOKEN mancante nel .env — nessun job avviato.');
  if (input.listId === undefined) configBlockers.push('Scegli la lista di destinazione.');
  else if (!list) configBlockers.push('La lista di destinazione non esiste.');
  else if (list.archived_at) configBlockers.push(archivedListText(list.name));
  const running = runningJobBlocker();
  const blockers = running ? [...configBlockers, running] : configBlockers;

  const warnings: string[] = [];
  if (list && filters.jobTitles.length === 0) {
    const anyone = `verranno estratte le prime ${filters.maxItems} persone qualunque.`;
    warnings.push(
      input.roles === undefined
        ? `L'ICP non ha ruoli target: ${anyone} Aggiungi ruoli qui o nell'ICP.`
        : `Nessun ruolo indicato: ${anyone}`,
    );
  }

  return {
    preview: {
      counts: { max_items: filters.maxItems },
      est_cost_usd: estimateSourcingCostUsd(filters.maxItems, filters.mode),
      warnings,
      blockers,
    },
    configBlockers,
    params: list
      ? {
          companyId: company.id,
          listId: list.id,
          roles: filters.jobTitles,
          locations: filters.locations,
          maxItems: filters.maxItems,
          mode: filters.mode,
        }
      : null,
  };
}

companiesRoutes.get('/companies/:id/source/preview', (c) => {
  const company = companyOr404(idParam(c));
  const { roles, ...rest } = c.req.query();
  const raw = { ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== '')), roles };
  const parsed = PreviewQuery.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw httpError(400, 'Parametri della preview non validi.', { issues });
  }
  const { roles: rolesText, ...query } = parsed.data;
  const input: SourcingInput = { ...query, roles: rolesText === undefined ? undefined : cleanList(rolesText.split(',')) };
  return c.json(planSourcing(company, input).preview);
});

/**
 * Avvia il sourcing: 400 `blocked` con i blocchi di configurazione, altrimenti `launchJob`
 * (202 `{job}`, o 409 `job_running` se c'è già un job in corso).
 */
companiesRoutes.post('/companies/:id/source', async (c) => {
  const id = idParam(c);
  const body = await readJson(c, SourceBody);
  const company = companyOr404(id);
  const { configBlockers, params } = planSourcing(company, body);
  if (configBlockers.length > 0 || !params) {
    throw httpError(400, configBlockers.join(' '), { code: 'blocked', blockers: configBlockers });
  }
  return launchJob(c, 'source_company', params);
});
