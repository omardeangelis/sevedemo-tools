/**
 * Mapper puro delle persone Apollo. Nessuna I/O. Supporta le due forme documentate (2026-09-17):
 *
 * - **People API Search** (`POST /api/v1/mixed_people/api_search`, 0 crediti): `people[]` con `id`,
 *   `first_name`, `last_name_obfuscated` (es. "Ro***i"), `title`, indicatori `has_email`/`has_city`/…, e
 *   `organization{name, has_*}`. **Niente** `linkedin_url`, dominio né email: queste persone finiscono in
 *   `withoutUrl` (da rivelare eventualmente con il match).
 * - **People Enrichment** (`/people/match` → `person`; `/people/bulk_match` → `matches[]`, 1 credito a
 *   persona): record completo con `linkedin_url`, `name`, `first_name`/`last_name`, `email`, `title`,
 *   `seniority`, sede e `organization{name, primary_domain, website_url, linkedin_url}`.
 *
 * Riconosciuta = oggetto con id Apollo o URL di un profilo persona LinkedIn. Solo le persone con URL sono
 * candidate a diventare prospect (l'identità del prospect resta l'URL LinkedIn).
 */
import { field, memberIdOf, normalizeCompanyUrl, normalizeDomain, normalizeProfileUrl } from '../../util/fields.js';

export interface ApolloPerson {
  /** Id della persona Apollo (`apollo_person_id`, chiave secondaria). */
  apolloId?: string;
  /** Nome completo; assente se Apollo lo restituisce solo offuscato. */
  fullName?: string;
  firstName?: string;
  lastNameObfuscated?: string;
  /** True se il nome completo non è disponibile perché offuscato (ricerca persone). */
  nameObfuscated: boolean;
  /** URL del profilo persona normalizzato (`normalizeProfileUrl`). */
  linkedinUrl?: string;
  /** Id membro (`ACoAA…`) quando l'URL è in quella forma. */
  memberUrn?: string;
  title?: string;
  seniority?: string;
  /** "città, regione, paese" con le parti disponibili. */
  location?: string;
  companyName?: string;
  companyDomain?: string;
  companyLinkedinUrl?: string;
  /** Email di lavoro rivelata; mai il segnaposto `email_not_unlocked@…` di Apollo. */
  email?: string;
  /** Indicatore `has_email` di Apollo (o true se l'email è presente). */
  hasEmail?: boolean;
  raw: unknown;
}

export type ApolloPersonWithUrl = ApolloPerson & { linkedinUrl: string };

export interface PeopleMapResult {
  /** Persone con URL LinkedIn: le uniche che possono diventare prospect. */
  candidates: ApolloPersonWithUrl[];
  /** Persone riconosciute senza URL LinkedIn (es. risultati della ricerca, da rivelare). */
  withoutUrl: ApolloPerson[];
  /** = `withoutUrl.length`. */
  skippedNoUrl: number;
  /** Item presenti nella risposta, riconosciuti o no. */
  declared: number;
  /** Item riconosciuti, senza doppioni. */
  recognized: number;
}

const LOCKED_EMAIL_RE = /^email_not_unlocked@/i;

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

const isObfuscated = (s: string | undefined) => s !== undefined && s.includes('*');

function namesOf(item: Record<string, unknown>) {
  const name = str(field(item, 'name'));
  const firstName = str(field(item, 'first_name'));
  const lastName = str(field(item, 'last_name'));
  const obfuscatedField = str(field(item, 'last_name_obfuscated'));
  const lastNameObfuscated = obfuscatedField ?? (isObfuscated(lastName) ? lastName : undefined);

  let fullName: string | undefined;
  if (name && !isObfuscated(name)) fullName = name;
  else if (lastName && !isObfuscated(lastName)) fullName = [firstName, lastName].filter(Boolean).join(' ');
  else if (!name && !lastName && !lastNameObfuscated) fullName = firstName;

  const nameObfuscated = fullName === undefined && (isObfuscated(name) || lastNameObfuscated !== undefined);
  return { fullName, firstName, lastNameObfuscated, nameObfuscated };
}

function emailOf(v: unknown): string | undefined {
  const email = str(v);
  return email && email.includes('@') && !LOCKED_EMAIL_RE.test(email) ? email : undefined;
}

/** Persona Apollo → dati normalizzati, oppure `null` se non ha né id Apollo né URL di un profilo persona. */
export function mapPerson(item: unknown): ApolloPerson | null {
  if (!isRecord(item)) return null;
  const apolloId = idOf(field(item, 'id'));
  const linkedinUrl = normalizeProfileUrl(field(item, 'linkedin_url'));
  if (!apolloId && !linkedinUrl) return null;

  const org = field(item, 'organization');
  const location = [field(item, 'city'), field(item, 'state'), field(item, 'country')].map(str).filter(Boolean).join(', ');
  const email = emailOf(field(item, 'email'));
  const hasEmailFlag = field(item, 'has_email');

  return {
    apolloId,
    ...namesOf(item),
    linkedinUrl,
    memberUrn: linkedinUrl ? memberIdOf(linkedinUrl) : undefined,
    title: str(field(item, 'title')),
    seniority: str(field(item, 'seniority')),
    location: location || undefined,
    companyName: str(field(org, 'name')) ?? str(field(item, 'organization_name')),
    companyDomain:
      normalizeDomain(field(org, 'primary_domain')) ??
      normalizeDomain(field(org, 'domain')) ??
      normalizeDomain(field(org, 'website_url')),
    companyLinkedinUrl: normalizeCompanyUrl(field(org, 'linkedin_url')),
    email,
    hasEmail: typeof hasEmailFlag === 'boolean' ? hasEmailFlag : email ? true : undefined,
    raw: item,
  };
}

/**
 * Risposta Apollo (o array di item) → persone. Legge `people[]`, `contacts[]`, `matches[]` (anche con
 * elementi nulli) e `person`; un doppione per id Apollo (o, senza id, per URL) tiene il primo visto.
 * Input non valido → vuoto.
 */
export function mapPeople(input: unknown): PeopleMapResult {
  const lists: unknown[][] = [];
  if (Array.isArray(input)) {
    lists.push(input);
  } else if (isRecord(input)) {
    for (const key of ['people', 'contacts', 'matches']) {
      const v = field(input, key);
      if (Array.isArray(v)) lists.push(v);
    }
    const single = field(input, 'person');
    if (isRecord(single)) lists.push([single]);
  }

  const result: PeopleMapResult = { candidates: [], withoutUrl: [], skippedNoUrl: 0, declared: 0, recognized: 0 };
  const seen = new Set<string>();
  for (const list of lists) {
    for (const item of list) {
      result.declared += 1;
      const person = mapPerson(item);
      if (!person) continue;
      const key = person.apolloId ? `id:${person.apolloId}` : `url:${person.linkedinUrl}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (person.linkedinUrl) result.candidates.push(person as ApolloPersonWithUrl);
      else result.withoutUrl.push(person);
    }
  }
  result.skippedNoUrl = result.withoutUrl.length;
  result.recognized = result.candidates.length + result.withoutUrl.length;
  return result;
}
