/**
 * Mapper puro per `harvestapi/linkedin-company-employees`. Nessuna I/O: trasforma gli item
 * dell'actor in candidati `company_employees`. Lettura tollerante (`field`) su più layout:
 *
 * - **Full / Full+email** (documentato nel README actor, 2026-09-16): piatto in cima ma con
 *   parti annidate — `linkedinUrl`, `firstName`/`lastName`, `headline`, `about`,
 *   `location.linkedinText`, `currentPosition[].companyName`, `experience[]` con
 *   `position`/`companyName`/`endDate.text` (`Present` = corrente).
 * - **Short** (risultato di ricerca; layout non documentato, dedotto): `name`, `position`
 *   (= headline), `location.linkedinText`, `linkedinUrl`. Niente about/esperienze.
 * - varianti piatte (`fullName`, `profileUrl`, `title`, `companyName`, `location` stringa).
 *
 * Item senza URL LinkedIn normalizzabile (membri nascosti "LinkedIn Member") → scartati e contati.
 */
import { field, profileKeys } from '../../util/fields.js';
import type { EmployeeCandidate, MapResult } from '../types.js';

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

function nonEmptyArray(v: unknown): unknown[] | undefined {
  return Array.isArray(v) && v.length > 0 ? v : undefined;
}

function fullNameOf(item: any): string | undefined {
  const direct = str(field(item, 'name', 'fullName', 'full_name'));
  if (direct) return direct;
  const joined = [str(field(item, 'firstName', 'first_name')), str(field(item, 'lastName', 'last_name'))]
    .filter(Boolean)
    .join(' ');
  return joined || undefined;
}

/** Località: stringa piatta o oggetto `{linkedinText | text | parsed.text}`. */
function locationOf(item: any): string | undefined {
  const loc = field(item, 'location', 'locationName', 'geoLocationName');
  if (typeof loc === 'string') return str(loc);
  return str(field(loc, 'linkedinText', 'text', 'name')) ?? str(field(field(loc, 'parsed'), 'text'));
}

/** Un'esperienza è corrente se non ha data di fine o la fine è "Present"/"Presente". */
function isCurrent(exp: any): boolean {
  const end = field(exp, 'endDate', 'end');
  if (end == null) return true;
  const text = typeof end === 'string' ? end : field(end, 'text');
  return typeof text === 'string' && /present|presente|oggi/i.test(text);
}

/** Ruolo e azienda correnti: posizione corrente, poi esperienza corrente, poi campi piatti. */
function currentRoleOf(item: any): { title?: string; companyName?: string } {
  const positions = nonEmptyArray(field(item, 'currentPosition', 'currentPositions')) ?? [];
  const experience = nonEmptyArray(field(item, 'experience', 'experiences')) ?? [];
  const candidates = [...positions, ...experience.filter(isCurrent)];
  const pick = (...names: string[]) => {
    for (const c of candidates) {
      const v = str(field(c, ...names));
      if (v) return v;
    }
    return undefined;
  };
  return {
    title: pick('position', 'title', 'jobTitle') ?? str(field(item, 'title', 'jobTitle')),
    companyName: pick('companyName', 'company') ?? str(field(item, 'companyName', 'company')),
  };
}

/** Email della modalità Full+email: `email` piatto o primo di `emails[]` (stringhe o `{email}`). */
function emailOf(item: any): string | undefined {
  const direct = str(field(item, 'email'));
  if (direct) return direct;
  const list = nonEmptyArray(field(item, 'emails')) ?? [];
  for (const e of list) {
    const v = typeof e === 'string' ? str(e) : str(field(e, 'email', 'address', 'value'));
    if (v) return v;
  }
  return undefined;
}

/**
 * Dipendente → candidato, o `null` se non ha un URL LinkedIn normalizzabile. Lo slug pubblico
 * (`publicIdentifier`) vince sull'URL in forma id membro; `id` (`ACoAA…`) → `memberUrn`.
 */
export function mapEmployee(item: any): EmployeeCandidate | null {
  if (!item || typeof item !== 'object') return null;
  const { linkedinUrl, memberUrn } = profileKeys({
    url: field(item, 'linkedinUrl', 'profileUrl', 'profile_url', 'linkedin_url', 'url'),
    publicIdentifier: field(item, 'publicIdentifier', 'public_identifier'),
    memberId: field(item, 'id', 'urn', 'profileUrn'),
  });
  if (!linkedinUrl) return null;
  const { title, companyName } = currentRoleOf(item);
  return {
    kind: 'company_employees',
    linkedinUrl,
    memberUrn,
    fullName: fullNameOf(item),
    headline: str(field(item, 'headline', 'position', 'occupation', 'summary')),
    title,
    companyName,
    location: locationOf(item),
    about: str(field(item, 'about', 'bio')),
    experience: nonEmptyArray(field(item, 'experience', 'experiences')),
    email: emailOf(item),
    raw: item,
  };
}

/** Mappa gli item di una run, scartando e contando quelli senza URL. Input non-array → vuoto. */
export function mapEmployees(items: any[]): MapResult<EmployeeCandidate> {
  const result: MapResult<EmployeeCandidate> = { candidates: [], skipped: 0 };
  if (!Array.isArray(items)) return result;
  for (const item of items) {
    const c = mapEmployee(item);
    if (c) result.candidates.push(c);
    else result.skipped += 1;
  }
  return result;
}
