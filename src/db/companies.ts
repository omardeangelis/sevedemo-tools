import { cleanText, normalizeCompanyUrl, normalizeDomain } from '../util/fields.js';
import { mergeCompanies } from './company-identity.js';
import { db, nowIso } from './index.js';
import type { ReferenceOutcome } from './schema.js';

/**
 * Aziende (PLAN crm-foundation §6 `companies`, doppia chiave da apollo-lookalike D-A). Identità =
 * `linkedin_url` normalizzato con `normalizeCompanyUrl` e/o `domain` normalizzato con
 * `normalizeDomain`: almeno uno dei due, ciascuno unico. `apollo_org_id` è unico se presente. I
 * chiamanti passano i valori grezzi, la normalizzazione avviene qui.
 */

/** Riga di `companies` così come salvata. */
export interface Company {
  id: number;
  /** https://www.linkedin.com/company/<slug>; `null` = "Senza pagina LinkedIn". */
  linkedin_url: string | null;
  /** Dominio normalizzato (`acme.it`); `null` se ignoto. */
  domain: string | null;
  name: string | null;
  website: string | null;
  industry: string | null;
  size: string | null;
  location: string | null;
  notes: string | null;
  apollo_org_id: string | null;
  /** Risposta Apollo grezza (o esito del tentativo) come testo JSON, non parsato. */
  apollo_json: string | null;
  /** Data dell'ultimo esito Apollo, anche negativo. */
  apollo_enriched_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Chiavi d'identità di un'azienda. */
export type CompanyKey = 'linkedin_url' | 'domain' | 'apollo_org_id';

/** ICP di cui l'azienda è riferimento, con esito e note del riferimento. */
export interface CompanyReferenceOf {
  icp_id: number;
  icp_name: string;
  outcome: ReferenceOutcome;
  notes: string | null;
}

/** Payload di lista e dettaglio (`GET /api/companies[/:id]`). */
export interface CompanyWithRefs extends Company {
  reference_of: CompanyReferenceOf[];
  /** Prospect collegati (`prospects.company_id`). */
  prospects_count: number;
}

/**
 * Campi scrivibili, valori grezzi. `linkedin_url`: URL della pagina aziendale (normalizzato qui).
 * `domain`: dominio esplicito; se assente il dominio deriva da `website` (`normalizeDomain`, un sito
 * non riconoscibile non dà dominio). In aggiornamento `null`/`''` toglie la chiave.
 */
export interface CompanyInput {
  linkedin_url?: string | null;
  domain?: string | null;
  name?: string | null;
  website?: string | null;
  industry?: string | null;
  size?: string | null;
  location?: string | null;
  notes?: string | null;
}

/** Nessuna chiave d'identità: né URL LinkedIn né dominio (SPEC B1, B11). */
export class CompanyKeysError extends Error {
  readonly code = 'company_keys_missing';
  constructor(message = "Serve almeno l'URL LinkedIn o il sito web") {
    super(message);
    this.name = 'CompanyKeysError';
  }
}

/** Una chiave dell'input è già di un'altra azienda (SPEC B4): nessuna scrittura. */
export class CompanyKeyTakenError extends Error {
  readonly code = 'company_exists';
  constructor(
    readonly key: Exclude<CompanyKey, 'apollo_org_id'>,
    readonly company: Company,
  ) {
    super(`Azienda già presente: ${company.name ?? company.linkedin_url ?? company.domain}.`);
    this.name = 'CompanyKeyTakenError';
  }
}

const TEXT_FIELDS = ['name', 'website', 'industry', 'size', 'location', 'notes'] as const;

/** Campi descrittivi che Apollo (o un altro upsert) riempie solo se vuoti (SPEC C3). */
const DESCRIPTIVE_FIELDS = ['name', 'website', 'industry', 'size', 'location'] as const;

/** URL normalizzato o eccezione: i chiamanti HTTP validano prima con `normalizeCompanyUrl` (400). */
function requireCompanyUrl(raw: string): string {
  const url = normalizeCompanyUrl(raw);
  if (!url) throw new Error(`URL aziendale LinkedIn non valido: ${raw}`);
  return url;
}

/** Dominio normalizzato o eccezione (dominio scritto esplicitamente). */
function requireDomain(raw: string): string {
  const domain = normalizeDomain(raw);
  if (!domain) throw new Error(`Dominio non valido: ${raw}`);
  return domain;
}

/** Slug leggibile di un URL già normalizzato (decodificato se percent-encoded). */
function companySlug(url: string): string {
  const slug = url.slice(url.lastIndexOf('/') + 1);
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}

export function getCompany(id: number): Company | undefined {
  return db.prepare(`SELECT * FROM companies WHERE id = ?`).get(id) as Company | undefined;
}

/** Azienda con lo stesso URL normalizzato; `undefined` se assente o se l'URL non è una company LinkedIn. */
export function findCompanyByUrl(rawUrl: string): Company | undefined {
  const url = normalizeCompanyUrl(rawUrl);
  if (!url) return undefined;
  return db.prepare(`SELECT * FROM companies WHERE linkedin_url = ?`).get(url) as Company | undefined;
}

/** Azienda con lo stesso dominio normalizzato (accetta un sito o un dominio); `undefined` se assente o non valido. */
export function findCompanyByDomain(raw: unknown): Company | undefined {
  const domain = normalizeDomain(raw);
  if (!domain) return undefined;
  return db.prepare(`SELECT * FROM companies WHERE domain = ?`).get(domain) as Company | undefined;
}

/** Azienda con questo id organizzazione Apollo. */
export function findCompanyByApolloId(orgId: string): Company | undefined {
  const id = cleanText(orgId);
  if (!id) return undefined;
  return db.prepare(`SELECT * FROM companies WHERE apollo_org_id = ?`).get(id) as Company | undefined;
}

/** Aggiunge `reference_of` e `prospects_count` (due query, raggruppate in memoria). */
function withRefs(companies: Company[]): CompanyWithRefs[] {
  if (companies.length === 0) return [];
  const ids = companies.map((c) => c.id);
  const marks = ids.map(() => '?').join(', ');
  const refs = db
    .prepare(
      `SELECT r.company_id, r.icp_id, i.name AS icp_name, r.outcome, r.notes
       FROM icp_reference_companies r JOIN icps i ON i.id = r.icp_id
       WHERE r.company_id IN (${marks})
       ORDER BY i.name COLLATE NOCASE, i.id`,
    )
    .all(...ids) as Array<CompanyReferenceOf & { company_id: number }>;
  const counts = db
    .prepare(`SELECT company_id, COUNT(*) AS n FROM prospects WHERE company_id IN (${marks}) GROUP BY company_id`)
    .all(...ids) as Array<{ company_id: number; n: number }>;
  const countById = new Map(counts.map((r) => [r.company_id, r.n]));
  const refsById = new Map<number, CompanyReferenceOf[]>();
  for (const { company_id, ...ref } of refs) refsById.set(company_id, [...(refsById.get(company_id) ?? []), ref]);
  return companies.map((c) => ({
    ...c,
    reference_of: refsById.get(c.id) ?? [],
    prospects_count: countById.get(c.id) ?? 0,
  }));
}

/** Tutte le aziende per nome; `q` filtra per nome, URL o dominio (sottostringa, case-insensitive). */
export function listCompanies(filters: { q?: string } = {}): CompanyWithRefs[] {
  const q = cleanText(filters.q);
  const rows = db
    .prepare(
      `SELECT * FROM companies
       WHERE @q IS NULL OR name LIKE @like OR linkedin_url LIKE @like OR domain LIKE @like
       ORDER BY name COLLATE NOCASE, id`,
    )
    .all({ q, like: `%${q ?? ''}%` }) as Company[];
  return withRefs(rows);
}

export function getCompanyDetail(id: number): CompanyWithRefs | undefined {
  const company = getCompany(id);
  return company && withRefs([company])[0];
}

/** Lancia `CompanyKeyTakenError` se URL o dominio sono già di un'azienda diversa da `exceptId`. */
function assertKeysFree(keys: { linkedin_url: string | null; domain: string | null }, exceptId = 0): void {
  for (const key of ['linkedin_url', 'domain'] as const) {
    const value = keys[key];
    if (!value) continue;
    const owner = db.prepare(`SELECT * FROM companies WHERE ${key} = ? AND id <> ?`).get(value, exceptId) as Company | undefined;
    if (owner) throw new CompanyKeyTakenError(key, owner);
  }
}

/**
 * Crea l'azienda da URL LinkedIn e/o sito/dominio (SPEC B13). Senza `name` usa lo slug dell'URL, o in
 * mancanza il dominio. Nessuna chiave → `CompanyKeysError`; chiave già di un'altra azienda →
 * `CompanyKeyTakenError` (l'indice unico resta l'ultima difesa); URL o dominio esplicito non valido → Error.
 */
export function createCompany(input: CompanyInput): Company {
  const linkedin_url = cleanText(input.linkedin_url) === null ? null : requireCompanyUrl(input.linkedin_url!);
  const domain =
    cleanText(input.domain) !== null ? requireDomain(input.domain!) : (normalizeDomain(input.website) ?? null);
  if (!linkedin_url && !domain) throw new CompanyKeysError();
  return db.transaction(() => {
    assertKeysFree({ linkedin_url, domain });
    const now = nowIso();
    const values: Record<string, string | null> = { linkedin_url, domain, created_at: now, updated_at: now };
    for (const f of TEXT_FIELDS) values[f] = cleanText(input[f]);
    values.name ??= linkedin_url ? companySlug(linkedin_url) : domain;
    const cols = Object.keys(values);
    const { lastInsertRowid } = db
      .prepare(`INSERT INTO companies (${cols.join(', ')}) VALUES (${cols.map((c) => '@' + c).join(', ')})`)
      .run(values);
    return getCompany(Number(lastInsertRowid))!;
  })();
}

/**
 * Aggiorna solo i campi presenti. `linkedin_url`/`domain` a `null` o `''` tolgono la chiave; se `domain`
 * non è nel patch e `website` cambia, il dominio segue il nuovo sito (non riconoscibile → nessun
 * dominio). Mai senza chiavi (`CompanyKeysError`); chiave di un'altra azienda → `CompanyKeyTakenError`.
 * Se URL o dominio cambiano davvero, i dati Apollo (`apollo_org_id`, `apollo_json`,
 * `apollo_enriched_at`) si azzerano (SPEC C3). `undefined` se l'azienda non esiste.
 */
export function updateCompany(id: number, patch: CompanyInput): Company | undefined {
  return db.transaction(() => {
    const current = getCompany(id);
    if (!current) return undefined;
    let { linkedin_url, domain } = current;
    if (patch.linkedin_url !== undefined) {
      linkedin_url = cleanText(patch.linkedin_url) === null ? null : requireCompanyUrl(patch.linkedin_url!);
    }
    if (patch.domain !== undefined) {
      domain = cleanText(patch.domain) === null ? null : requireDomain(patch.domain!);
    } else if (patch.website !== undefined && cleanText(patch.website) !== current.website) {
      domain = normalizeDomain(patch.website) ?? null;
    }
    if (!linkedin_url && !domain) throw new CompanyKeysError();
    assertKeysFree({ linkedin_url, domain }, id);

    const values: Record<string, string | null> = { linkedin_url, domain, updated_at: nowIso() };
    for (const f of TEXT_FIELDS) if (patch[f] !== undefined) values[f] = cleanText(patch[f]);
    if (linkedin_url !== current.linkedin_url || domain !== current.domain) {
      values.apollo_org_id = null;
      values.apollo_json = null;
      values.apollo_enriched_at = null;
    }
    const sets = Object.keys(values).map((c) => `${c} = @${c}`);
    db.prepare(`UPDATE companies SET ${sets.join(', ')} WHERE id = @id`).run({ ...values, id });
    return getCompany(id);
  })();
}

// ---------------------------------------------------------------------------
// Upsert con le Regole di unione (apollo-lookalike T4a, PLAN P-2): usato dai job Apollo.
// ---------------------------------------------------------------------------

/** Dati Apollo da salvare sull'azienda (sovrascrivono quelli più vecchi). */
export interface CompanyApolloData {
  /** Id organizzazione Apollo: chiave secondaria, unica. */
  orgId?: string | null;
  /** Risposta grezza (serializzata in `apollo_json`). */
  json: unknown;
  /** Data dell'esito; default adesso. */
  enrichedAt?: string;
}

export interface UpsertCompanyInput {
  /** URL LinkedIn grezzo (`normalizeCompanyUrl`). */
  linkedinUrl?: unknown;
  /** Dominio grezzo (per Apollo il dominio primario); se manca o non è valido si deriva da `website`. */
  domain?: unknown;
  website?: string | null;
  name?: string | null;
  industry?: string | null;
  size?: string | null;
  location?: string | null;
  apollo?: CompanyApolloData;
}

export interface UpsertCompanyOptions {
  /** True: i valori descrittivi nuovi non vuoti sostituiscono quelli salvati. Default: riempie solo i vuoti (SPEC C3). */
  refresh?: boolean;
}

/** Una chiave dell'input che trova una riga la cui altra chiave è piena e diversa. */
export interface CompanyKeyConflictDetail {
  company_id: number;
  company_name: string | null;
  /** Chiave dell'input con cui la riga è stata trovata. */
  matched_by: CompanyKey;
  /** Chiave discordante. */
  key: CompanyKey;
  /** Valore dell'input (normalizzato). */
  input: string;
  /** Valore in anagrafica. */
  existing: string;
}

export interface CompanyKeyConflict {
  /** `discordant_keys`: chiavi piene e diverse; `too_many_companies`: le chiavi trovano più di due aziende. */
  reason: 'discordant_keys' | 'too_many_companies';
  /** Chiavi dell'input in conflitto (distinte): discordanti, oppure tutte quelle che trovano un'azienda. */
  keys: CompanyKey[];
  details: CompanyKeyConflictDetail[];
  /** Aziende trovate dalle chiavi dell'input. */
  company_ids: number[];
}

export interface UpsertCompanyResult {
  /** Azienda scritta; `undefined` se `keyConflict` o `noKeys`. */
  id: number | undefined;
  created: boolean;
  /** Aziende assorbite nel superstite `id` (Regole di unione, B6). */
  mergedIds: number[];
  /** L'URL LinkedIn è stato preso dall'input: nessuna delle righe trovate lo aveva (B7; non conta quello avuto dall'unione). */
  linkedinAcquired: boolean;
  /** Idem per il dominio. */
  domainAcquired: boolean;
  /** Chiavi in conflitto: nessuna scrittura. */
  keyConflict: false | CompanyKeyConflict;
  /** Nessuna chiave utilizzabile (né URL né dominio né un id Apollo già noto): nessuna scrittura. */
  noKeys: boolean;
}

const KEYS: readonly CompanyKey[] = ['linkedin_url', 'domain', 'apollo_org_id'];

function upsertResult(extra: Partial<UpsertCompanyResult>): UpsertCompanyResult {
  return {
    id: undefined,
    created: false,
    mergedIds: [],
    linkedinAcquired: false,
    domainAcquired: false,
    keyConflict: false,
    noKeys: false,
    ...extra,
  };
}

/** Superstite nei job: chi ha l'URL LinkedIn se solo una lo ha, altrimenti id minore. */
function jobSurvivor(a: Company, b: Company): [keep: Company, drop: Company] {
  if ((a.linkedin_url === null) !== (b.linkedin_url === null)) return a.linkedin_url !== null ? [a, b] : [b, a];
  return a.id < b.id ? [a, b] : [b, a];
}

/**
 * Crea o aggiorna un'azienda dalle chiavi dell'input (SPEC "Regole di unione", B6/B7, C3), in una
 * transazione. Risolve per URL LinkedIn, dominio e `apollo_org_id`:
 * - una chiave trova una riga in cui un'altra chiave presente nell'input è piena e diversa, oppure le
 *   chiavi trovano più di due righe → `keyConflict`, nessuna scrittura (una chiave assente
 *   nell'input non è mai in conflitto);
 * - due righe compatibili → `mergeCompanies` (superstite: chi ha l'URL, altrimenti id minore);
 * - nessuna riga → nuova azienda (serve URL o dominio, altrimenti `noKeys`);
 * poi acquisizione delle chiavi mancanti (libere per costruzione), campi descrittivi solo se vuoti
 * (`refresh` li sostituisce) e dati Apollo sovrascritti se non più vecchi di quelli salvati.
 */
export function upsertCompany(input: UpsertCompanyInput, opts: UpsertCompanyOptions = {}): UpsertCompanyResult {
  const keys: Record<CompanyKey, string | null> = {
    linkedin_url: normalizeCompanyUrl(input.linkedinUrl) ?? null,
    domain: normalizeDomain(input.domain) ?? normalizeDomain(input.website) ?? null,
    apollo_org_id: cleanText(input.apollo?.orgId),
  };
  if (!keys.linkedin_url && !keys.domain && !keys.apollo_org_id) return upsertResult({ noKeys: true });

  return db.transaction((): UpsertCompanyResult => {
    const matches: Array<{ by: CompanyKey; row: Company }> = [];
    for (const key of KEYS) {
      if (!keys[key]) continue;
      const row = db.prepare(`SELECT * FROM companies WHERE ${key} = ?`).get(keys[key]) as Company | undefined;
      if (row) matches.push({ by: key, row });
    }
    const rows = [...new Map(matches.map((m) => [m.row.id, m.row])).values()];

    const details: CompanyKeyConflictDetail[] = [];
    for (const row of rows) {
      const by = matches.find((m) => m.row.id === row.id)!.by;
      for (const key of KEYS) {
        const wanted = keys[key];
        const existing = row[key];
        if (!wanted || existing === null || existing === wanted) continue;
        details.push({ company_id: row.id, company_name: row.name, matched_by: by, key, input: wanted, existing });
      }
    }
    if (details.length > 0 || rows.length > 2) {
      return upsertResult({
        keyConflict: {
          reason: details.length > 0 ? 'discordant_keys' : 'too_many_companies',
          keys: [...new Set(details.length > 0 ? details.map((d) => d.key) : matches.map((m) => m.by))],
          details,
          company_ids: rows.map((r) => r.id),
        },
      });
    }

    const now = nowIso();
    const apolloAt = input.apollo ? (input.apollo.enrichedAt ?? now) : null;
    const apolloJson = input.apollo && input.apollo.json !== undefined ? JSON.stringify(input.apollo.json) : null;

    if (rows.length === 0) {
      if (!keys.linkedin_url && !keys.domain) return upsertResult({ noKeys: true });
      const values: Record<string, string | null> = {
        linkedin_url: keys.linkedin_url,
        domain: keys.domain,
        apollo_org_id: keys.apollo_org_id,
        apollo_json: apolloJson,
        apollo_enriched_at: apolloAt,
        created_at: now,
        updated_at: now,
      };
      for (const f of DESCRIPTIVE_FIELDS) values[f] = cleanText(input[f]);
      values.name ??= keys.linkedin_url ? companySlug(keys.linkedin_url) : keys.domain;
      const cols = Object.keys(values);
      const { lastInsertRowid } = db
        .prepare(`INSERT INTO companies (${cols.join(', ')}) VALUES (${cols.map((c) => '@' + c).join(', ')})`)
        .run(values);
      return upsertResult({ id: Number(lastInsertRowid), created: true });
    }

    const [keep, drop] = rows.length === 2 ? jobSurvivor(rows[0], rows[1]) : [rows[0], undefined];
    const mergedIds: number[] = [];
    if (drop) {
      mergeCompanies(keep.id, drop.id);
      mergedIds.push(drop.id);
    }
    const target = getCompany(keep.id)!;

    const values: Record<string, string | null> = {};
    // Acquisizione (B7): le chiavi dell'input sono libere, altrimenti la risoluzione le avrebbe trovate.
    for (const key of KEYS) if (keys[key] && target[key] === null) values[key] = keys[key];
    for (const f of DESCRIPTIVE_FIELDS) {
      const value = cleanText(input[f]);
      if (value !== null && (opts.refresh ? value !== target[f] : target[f] === null)) values[f] = value;
    }
    if (input.apollo && (target.apollo_enriched_at === null || apolloAt! >= target.apollo_enriched_at)) {
      values.apollo_org_id = keys.apollo_org_id ?? target.apollo_org_id;
      values.apollo_json = apolloJson;
      values.apollo_enriched_at = apolloAt;
    }
    if (Object.keys(values).length > 0) {
      values.updated_at = now;
      const sets = Object.keys(values).map((c) => `${c} = @${c}`);
      db.prepare(`UPDATE companies SET ${sets.join(', ')} WHERE id = @id`).run({ ...values, id: keep.id });
    }
    // Acquisita = presa dall'input: nessuna delle righe la aveva prima (non conta quella avuta dall'unione).
    const acquired = (key: 'linkedin_url' | 'domain') => keep[key] === null && (drop?.[key] ?? null) === null && values[key] != null;
    return upsertResult({
      id: keep.id,
      mergedIds,
      linkedinAcquired: acquired('linkedin_url'),
      domainAcquired: acquired('domain'),
    });
  })();
}
