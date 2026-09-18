import { Hono } from 'hono';
import { z } from 'zod';
import { EMPLOYEES_MODES } from '../../config.js';
import {
  CompanyKeyTakenError,
  CompanyKeysError,
  createCompany,
  findCompanyByDomain,
  findCompanyByUrl,
  getCompany,
  getCompanyDetail,
  listCompanies,
  updateCompany,
  withoutApolloJson,
  type Company,
  type CompanyInput,
  type CompanyWithRefs,
} from '../../db/companies.js';
import { mergeCompanies } from '../../db/company-identity.js';
import { getIcp, setReferenceCompany } from '../../db/icps.js';
import { db } from '../../db/index.js';
import { getList } from '../../db/lists.js';
import { REFERENCE_OUTCOMES } from '../../db/schema.js';
import {
  EMPLOYEES_MAX_ITEMS,
  configBlockers as sourcingConfigBlockers,
  estimateSourcingCostUsd,
  resolveFilters,
  type SourceCompanyParams,
} from '../../jobs/source-company.js';
import type { JobPreview } from '../../jobs/types.js';
import { cleanList, cleanText, normalizeCompanyUrl, normalizeDomain } from '../../util/fields.js';
import { httpError, idParam, nonEmptyQuery, readJson, readQuery } from '../http.js';
import { launchUnlessBlocked, withRunningBlocker } from '../jobs.js';
import type { AppEnv } from '../types.js';

/**
 * Aziende: anagrafica (crm-foundation T4), sourcing persone da azienda (T9: `from-url` e `source*`),
 * doppia chiave URL LinkedIn | dominio, 409 `company_exists` e unione esplicita (apollo-lookalike T4b).
 * Montato da `app.ts` con `app.route('/api', companiesRoutes)`: dichiara le path assolute
 * sotto `/api` (es. `/companies/:id` → `/api/companies/:id`).
 */
export const companiesRoutes = new Hono<AppEnv>();

const text = z.string().nullable().optional();
const positiveInt = z.coerce.number().int().positive();

/**
 * Campi scrivibili. Chiavi d'identità (SPEC B1, B11, B13): `linkedin_url` e il dominio, che deriva
 * sempre da `website` (`normalizeDomain`); in modifica `''`/`null` tolgono la chiave.
 */
const CompanyFields = z.object({
  linkedin_url: text,
  name: text,
  website: text,
  industry: text,
  size: text,
  location: text,
  notes: text,
});

/** Testo del 400 per un URL LinkedIn che non è una pagina aziendale (mostrato inline dalla UI). */
const INVALID_COMPANY_URL = 'Inserisci un URL del tipo linkedin.com/company/<nome>';

/** 400 se l'URL non è una pagina aziendale LinkedIn. */
function companyUrlOr400(raw: string): string {
  const url = normalizeCompanyUrl(raw);
  if (!url) throw httpError(400, INVALID_COMPANY_URL, { code: 'invalid_company_url' });
  return url;
}

/** `linkedin_url` del body: assente → `undefined`; vuoto/`null` → `null` (nessun URL); altrimenti validato (400). */
function linkedinUrlOf(raw: string | null | undefined): string | null | undefined {
  if (raw === undefined) return undefined;
  return cleanText(raw) === null ? null : companyUrlOr400(raw!);
}

/** Etichetta leggibile di un'azienda: nome, altrimenti URL o dominio. */
function companyName(company: Company): string {
  return company.name ?? company.linkedin_url ?? company.domain ?? `#${company.id}`;
}

/**
 * 409 `company_exists` (SPEC B4): la chiave è già di `owner`, nessuna scrittura. Il body porta
 * l'identità della proprietaria per il link "apri" e per "Unisci in <nome>" (SPEC B5).
 */
function companyExists(key: 'linkedin_url' | 'domain', owner: Company) {
  const name = companyName(owner);
  const error =
    key === 'linkedin_url' ? `Questo URL LinkedIn è già di '${name}'.` : `Il dominio ${owner.domain} è già di '${name}'.`;
  return httpError(409, error, { code: 'company_exists', company_id: owner.id, company_name: name, key });
}

/**
 * Errori d'identità di `createCompany`/`updateCompany` → 400 `company_keys_missing` / 409
 * `company_exists` (entrambi lanciati prima di scrivere). Un sito indicato ma senza dominio proprio
 * (es. piattaforme condivise, SPEC B2) lo dice esplicitamente. Gli altri errori passano invariati.
 */
function identityError(err: unknown, body: CompanyInput): unknown {
  if (err instanceof CompanyKeyTakenError) return companyExists(err.key, err.company);
  if (err instanceof CompanyKeysError) {
    const siteWithoutDomain = cleanText(body.website) !== null && !normalizeDomain(body.website);
    const error = siteWithoutDomain
      ? "Il sito web indicato non ha un dominio proprio: serve almeno l'URL LinkedIn o il sito web"
      : err.message;
    return httpError(400, error, { code: err.code });
  }
  return err;
}

/** Payload di lista e dettaglio: `apollo_json` (risposta Apollo grezza, anche di KB) resta sul server. */
export type CompanyPayload = Omit<CompanyWithRefs, 'apollo_json'>;

function companyOr404(id: number): CompanyPayload {
  const company = getCompanyDetail(id);
  if (!company) throw httpError(404, 'Azienda non trovata.');
  return withoutApolloJson(company);
}

/** Cerca per nome, URL LinkedIn o dominio (SPEC B12); `listCompanies` non legge `apollo_json`. */
companiesRoutes.get('/companies', (c) => c.json({ items: listCompanies({ q: c.req.query('q') }) }));

/** Crea da URL LinkedIn e/o sito web (SPEC B13): nessuna chiave → 400; chiave altrui → 409. */
companiesRoutes.post('/companies', async (c) => {
  const body = await readJson(c, CompanyFields.strict());
  const input: CompanyInput = { ...body, linkedin_url: linkedinUrlOf(body.linkedin_url) };
  let company: Company;
  try {
    company = createCompany(input);
  } catch (err) {
    throw identityError(err, input);
  }
  return c.json(companyOr404(company.id), 201);
});

companiesRoutes.get('/companies/:id', (c) => c.json(companyOr404(idParam(c))));

/**
 * Modifica parziale (SPEC B11): `linkedin_url`/`website` vuoti tolgono la chiave, mai entrambe (400);
 * chiave di un'altra azienda → 409 `company_exists`; nessuna scrittura in caso d'errore.
 */
companiesRoutes.patch('/companies/:id', async (c) => {
  const id = idParam(c);
  const body = await readJson(c, CompanyFields.strict());
  companyOr404(id);
  const input: CompanyInput = { ...body, linkedin_url: linkedinUrlOf(body.linkedin_url) };
  try {
    updateCompany(id, input);
  } catch (err) {
    throw identityError(err, input);
  }
  return c.json(companyOr404(id));
});

// ---------------------------------------------------------------------------
// Unione esplicita (apollo-lookalike T4b, SPEC B5): `:id` è assorbita, `into` resta.
// ---------------------------------------------------------------------------

/** Assorbita e superstite: stessa azienda → 400; una delle due inesistente → 404. */
function mergePair(id: number, into: number): { drop: Company; keep: Company } {
  if (id === into) {
    throw httpError(400, "Scegli un'altra azienda: non si può unire un'azienda con se stessa.", {
      code: 'merge_same_company',
    });
  }
  const drop = getCompany(id);
  const keep = getCompany(into);
  if (!drop || !keep) throw httpError(404, 'Azienda non trovata.');
  return { drop, keep };
}

/** Cosa comporta unire `drop` in `keep` (conferma di SPEC B5). */
export interface MergePreview {
  /**
   * Cosa l'assorbita perde: `domain`/`linkedin_url` quando la superstite ne ha già uno diverso (la
   * chiave dell'assorbita è scartata); `notes` = note dell'assorbita accodate a quelle della superstite.
   */
  loses: { domain?: string; linkedin_url?: string; notes?: string };
  /** Righe che passano alla superstite, esclusi i doppioni che l'unione scarta (Regole di unione). */
  absorbed: { references: number; candidates: number; prospects: number; sources: number };
}

/**
 * Anteprima in sola lettura, con le stesse regole di `mergeCompanies`: un riferimento allo stesso ICP
 * resta quello della superstite; una candidatura cade se l'ICP ha la referenza (dell'una o dell'altra)
 * o se la superstite ha già una candidatura per lo stesso ICP, salvo che quella sia `proposta` e
 * l'assorbita decisa; una fonte cade se la superstite ne ha una dello stesso prospect e tipo non più vecchia.
 */
function mergePreview(drop: Company, keep: Company): MergePreview {
  const loses: MergePreview['loses'] = {};
  if (drop.domain && keep.domain && drop.domain !== keep.domain) loses.domain = drop.domain;
  if (drop.linkedin_url && keep.linkedin_url && drop.linkedin_url !== keep.linkedin_url) {
    loses.linkedin_url = drop.linkedin_url;
  }
  const notes = cleanText(drop.notes);
  if (notes !== null && notes !== cleanText(keep.notes)) loses.notes = drop.notes!;

  const ids = { keep: keep.id, drop: drop.id };
  const count = (sql: string) => (db.prepare(sql).get(ids) as { n: number }).n;
  const absorbed = {
    references: count(
      `SELECT COUNT(*) AS n FROM icp_reference_companies d
       WHERE d.company_id = @drop
         AND d.icp_id NOT IN (SELECT icp_id FROM icp_reference_companies WHERE company_id = @keep)`,
    ),
    candidates: count(
      `SELECT COUNT(*) AS n FROM icp_company_candidates d
       WHERE d.company_id = @drop
         AND d.icp_id NOT IN (SELECT icp_id FROM icp_reference_companies WHERE company_id IN (@keep, @drop))
         AND NOT EXISTS (SELECT 1 FROM icp_company_candidates k
                         WHERE k.company_id = @keep AND k.icp_id = d.icp_id
                           AND NOT (k.status = 'proposta' AND d.status <> 'proposta'))`,
    ),
    prospects: count(`SELECT COUNT(*) AS n FROM prospects WHERE company_id = @drop`),
    sources: count(
      `SELECT COUNT(*) AS n FROM sources d
       WHERE d.company_id = @drop
         AND NOT EXISTS (SELECT 1 FROM sources k
                         WHERE k.company_id = @keep AND k.prospect_id = d.prospect_id
                           AND k.kind = d.kind AND k.captured_at >= d.captured_at)`,
    ),
  };
  return { loses, absorbed };
}

companiesRoutes.get('/companies/:id/merge/preview', (c) => {
  const id = idParam(c);
  const into = positiveInt.safeParse(c.req.query('into'));
  if (!into.success) throw httpError(400, "Indica l'azienda in cui unire (into).", { code: 'merge_target_missing' });
  const { drop, keep } = mergePair(id, into.data);
  return c.json(mergePreview(drop, keep));
});

const MergeBody = z.object({ into: positiveInt }).strict();

/** Unisce `:id` in `into` (irreversibile): 200 `{company}` = la superstite; `:id` non esiste più. */
companiesRoutes.post('/companies/:id/merge', async (c) => {
  const id = idParam(c);
  const { into } = await readJson(c, MergeBody);
  mergePair(id, into);
  mergeCompanies(into, id);
  return c.json({ company: companyOr404(into) });
});

// ---------------------------------------------------------------------------
// Aggiunta da URL e sourcing persone (T9)
// ---------------------------------------------------------------------------

const FromUrlBody = z
  .object({ url: z.string(), icpId: positiveInt.optional(), outcome: z.enum(REFERENCE_OUTCOMES).optional() })
  .strict()
  .refine((b) => b.outcome === undefined || b.icpId !== undefined, {
    message: "L'esito del riferimento richiede un ICP.",
    path: ['outcome'],
  });

/**
 * Chiave dal campo unico "URL LinkedIn o sito web" (FLOW F.1): `linkedin.com/company/…` → URL; un
 * altro URL LinkedIn → 400 con il testo storico; altrimenti il dominio del sito; nulla → 400.
 */
function keyOfUrlOr400(raw: string): { linkedin_url: string } | { domain: string; website: string } {
  const url = normalizeCompanyUrl(raw);
  if (url) return { linkedin_url: url };
  if (/linkedin\.com/i.test(raw)) throw httpError(400, INVALID_COMPANY_URL, { code: 'invalid_company_url' });
  const domain = normalizeDomain(raw);
  if (domain) return { domain, website: raw.trim() };
  throw httpError(400, "Inserisci l'URL LinkedIn dell'azienda (linkedin.com/company/<nome>) o il suo sito web (es. acme.it)", {
    code: 'invalid_company_url',
  });
}

/**
 * "Incolla e vai": crea l'azienda da URL LinkedIn o sito/dominio, o ritorna quella che ha già la
 * chiave (201/200, `created`), e se c'è `icpId` la rende riferimento dell'ICP (default esito
 * `riferimento`). ICP inesistente → 400 senza creare nulla.
 */
companiesRoutes.post('/companies/from-url', async (c) => {
  const body = await readJson(c, FromUrlBody);
  const key = keyOfUrlOr400(body.url);
  if (body.icpId !== undefined && !getIcp(body.icpId)) {
    throw httpError(400, 'ICP inesistente.', { code: 'icp_not_found' });
  }
  const existing = 'linkedin_url' in key ? findCompanyByUrl(key.linkedin_url) : findCompanyByDomain(key.domain);
  let company = existing;
  if (!company) {
    const input: CompanyInput = 'linkedin_url' in key ? key : { website: key.website };
    try {
      company = createCompany(input);
    } catch (err) {
      throw identityError(err, input);
    }
  }
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
 * `preview.blockers` = blocchi di configurazione (400 all'avvio): il job in corso lo aggiunge la preview
 * (`withRunningBlocker`), all'avvio risponde `launchJob` (409). `params` è `null` se manca la lista (c'è
 * comunque un blocker).
 */
function planSourcing(company: CompanyPayload, input: SourcingInput): { preview: JobPreview; params: SourceCompanyParams | null } {
  const list = input.listId !== undefined ? getList(input.listId) : null;
  const filters = resolveFilters(input, list ? getIcp(list.icp_id) : undefined);

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
      blockers: sourcingConfigBlockers({ companyId: company.id, listId: input.listId }),
    },
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
  // `roles` vuoto resta: vale "nessun ruolo" (vedi `PreviewQuery`).
  const { roles: rolesText, ...query } = readQuery(c, PreviewQuery, undefined, {
    raw: { ...nonEmptyQuery(c), roles: c.req.query('roles') },
  });
  const input: SourcingInput = { ...query, roles: rolesText === undefined ? undefined : cleanList(rolesText.split(',')) };
  return c.json(withRunningBlocker(planSourcing(company, input).preview));
});

/**
 * Avvia il sourcing: 400 `blocked` con i blocchi di configurazione, altrimenti `launchJob`
 * (202 `{job}`, o 409 `job_running` se c'è già un job in corso).
 */
companiesRoutes.post('/companies/:id/source', async (c) => {
  const id = idParam(c);
  const body = await readJson(c, SourceBody);
  const company = companyOr404(id);
  const { preview, params } = planSourcing(company, body);
  return launchUnlessBlocked(c, 'source_company', params, preview.blockers);
});
