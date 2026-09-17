/**
 * Mapper puro delle organizzazioni Apollo. Nessuna I/O: trasforma gli item delle risposte in aziende con
 * chiavi normalizzate. Lettura tollerante (`field`) perché la forma reale va confermata dallo smoke (T0):
 *
 * - **Organization Search** (`POST /api/v1/mixed_companies/search`, documentazione del 2026-09-17): la
 *   risposta ha `organizations[]` **e** `accounts[]` (aziende già salvate nel team Apollo) + `pagination`.
 *   L'esempio documentato per organizzazione ha solo id, nome, URL, telefoni e `primary_domain`: settore,
 *   parole chiave, dipendenti e sede possono mancare, quindi ogni campo descrittivo è opzionale. Negli
 *   account l'id dell'organizzazione Apollo è `organization_id` (`id` è l'id dell'account).
 * - **Bulk Organization Enrichment** (`POST /api/v1/organizations/bulk_enrich`): `organizations[]` con
 *   anche `industry`, `keywords[]`, `estimated_num_employees`, `city`, `state`, `country`.
 * - **Organization Enrichment** (`/organizations/enrich`): `organization` singola.
 *
 * Riconosciuta = oggetto con almeno un id Apollo, un dominio o un URL LinkedIn aziendale. Un'azienda con id
 * ma senza dominio né URL LinkedIn resta tra gli item: è il job a contarla come "senza chiavi" (SPEC D9).
 */
import { field, normalizeCompanyUrl, normalizeDomain } from '../../util/fields.js';

export interface ApolloOrganization {
  /** Id dell'organizzazione Apollo (`apollo_org_id`). */
  apolloId?: string;
  name?: string;
  /** Dominio normalizzato: `primary_domain`, altrimenti dal sito. */
  domain?: string;
  /** Sito così come lo riporta Apollo. */
  website?: string;
  /** URL della pagina aziendale normalizzato (`normalizeCompanyUrl`). */
  linkedinUrl?: string;
  industry?: string;
  /** Parole chiave pulite, senza doppioni (confronto senza maiuscole). */
  keywords: string[];
  employees?: number;
  country?: string;
  state?: string;
  city?: string;
  description?: string;
  raw: unknown;
}

export interface OrganizationsMapResult {
  items: ApolloOrganization[];
  /** Item presenti nella risposta (organizations + accounts), riconosciuti o no. */
  declared: number;
  /** Item riconosciuti, senza doppioni (= `items.length`). */
  recognized: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim().replace(/\s+/g, ' ');
  return t === '' ? undefined : t;
}

function idOf(v: unknown): string | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return str(v);
}

/** Numero intero non negativo da numero o stringa di cifre (anche con separatori delle migliaia). */
function countOf(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined;
  if (typeof v !== 'string' || !/^\s*\d{1,3}(?:[.,]?\d{3})*\s*$/.test(v)) return undefined;
  return Number(v.replace(/[\s.,]/g, ''));
}

function keywordsOf(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of v) {
    const t = str(k);
    if (t === undefined || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
}

/**
 * Organizzazione (o account, con `{account: true}`) → azienda, oppure `null` se non ha né id Apollo né
 * dominio né URL LinkedIn aziendale.
 */
export function mapOrganization(item: unknown, opts: { account?: boolean } = {}): ApolloOrganization | null {
  if (!isRecord(item)) return null;
  const apolloId = idOf(opts.account ? field(item, 'organization_id') : field(item, 'id'));
  const website = str(field(item, 'website_url', 'website'));
  const domain =
    normalizeDomain(field(item, 'primary_domain')) ?? normalizeDomain(field(item, 'domain')) ?? normalizeDomain(website);
  const linkedinUrl = normalizeCompanyUrl(field(item, 'linkedin_url'));
  if (!apolloId && !domain && !linkedinUrl) return null;
  return {
    apolloId,
    name: str(field(item, 'name')),
    domain,
    website,
    linkedinUrl,
    industry: str(field(item, 'industry')),
    keywords: keywordsOf(field(item, 'keywords')),
    employees: countOf(field(item, 'estimated_num_employees', 'num_employees')),
    country: str(field(item, 'country')),
    state: str(field(item, 'state')),
    city: str(field(item, 'city')),
    description: str(field(item, 'short_description', 'seo_description')),
    raw: item,
  };
}

/**
 * Risposta Apollo (o array di item) → aziende riconosciute. Legge `organizations[]`, `organization` e
 * `accounts[]`; un doppione per id Apollo (o, senza id, per dominio/URL LinkedIn) tiene il primo visto,
 * cioè l'organizzazione prima dell'account. Input non valido → vuoto.
 */
export function mapOrganizations(input: unknown): OrganizationsMapResult {
  const sources: Array<{ items: unknown[]; account: boolean }> = [];
  if (Array.isArray(input)) {
    sources.push({ items: input, account: false });
  } else if (isRecord(input)) {
    const organizations = field(input, 'organizations');
    if (Array.isArray(organizations)) sources.push({ items: organizations, account: false });
    const single = field(input, 'organization');
    if (isRecord(single)) sources.push({ items: [single], account: false });
    const accounts = field(input, 'accounts');
    if (Array.isArray(accounts)) sources.push({ items: accounts, account: true });
  }

  const result: OrganizationsMapResult = { items: [], declared: 0, recognized: 0 };
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  for (const { items, account } of sources) {
    for (const item of items) {
      result.declared += 1;
      const org = mapOrganization(item, { account });
      if (!org) continue;
      const keys = [org.domain && `d:${org.domain}`, org.linkedinUrl && `l:${org.linkedinUrl}`].filter(
        (k): k is string => Boolean(k),
      );
      const duplicate = org.apolloId ? seenIds.has(org.apolloId) : keys.some((k) => seenKeys.has(k));
      if (duplicate) continue;
      if (org.apolloId) seenIds.add(org.apolloId);
      for (const k of keys) seenKeys.add(k);
      result.items.push(org);
    }
  }
  result.recognized = result.items.length;
  return result;
}
