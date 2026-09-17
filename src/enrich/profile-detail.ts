import pLimit from 'p-limit';
import { runActor } from '../apify/client.js';
import { ACTORS, profileDetailInput } from '../apify/actors.js';
import { config } from '../config.js';
import { field, profileKeys, truncate } from '../util/fields.js';

/** Dati di profilo letti dall'enrichment: tutti opzionali (lettura tollerante, best-effort). */
export interface Enrichment {
  /**
   * URL canonico restituito dall'actor (normalizzato): lo slug pubblico quando l'item lo espone,
   * anche se l'input era in forma id membro (`/in/ACoAA…`). Chiave d'identità per `setProspectIdentity`.
   */
  canonicalUrl?: string;
  /** Id membro `ACoAA…` letto dall'item (`basic_info.urn` o dall'URL), seconda chiave d'identità. */
  memberUrn?: string;
  fullName?: string;
  headline?: string;
  about?: string;
  location?: string;
  email?: string;
  phone?: string;
  company?: string;
  /** URL LinkedIn dell'azienda corrente (per agganciare `company_id`, best-effort). */
  companyUrl?: string;
  /** Ruolo corrente (esperienza marcata come attuale). */
  title?: string;
  raw?: unknown;
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

/** Primo indirizzo email in un testo libero (fallback su `about`). */
export function firstEmailIn(text: unknown): string | undefined {
  if (typeof text !== 'string') return undefined;
  const m = text.match(EMAIL_RE);
  return m ? m[0] : undefined;
}

/**
 * Ruolo corrente: l'esperienza con `is_current` vero; se l'actor non espone il flag su nessuna
 * esperienza, la prima (ordine dell'actor: dalla più recente). Mai un ruolo passato marcato come tale.
 */
function currentTitle(experience: unknown): string | undefined {
  if (!Array.isArray(experience) || experience.length === 0) return undefined;
  const flagged = experience.filter((e) => field(e, 'is_current', 'isCurrent') !== undefined);
  const current = flagged.length > 0 ? flagged.find((e) => field(e, 'is_current', 'isCurrent') === true) : experience[0];
  const title = field(current, 'title', 'position');
  return typeof title === 'string' ? title : undefined;
}

/**
 * Mappa un item dell'actor apimaestro — output **annidato** (`basic_info.*`,
 * diverso dallo schema piatto di dev_fusion) — in un `Enrichment`.
 * Email da `basic_info.email`, con fallback regex su `basic_info.about` (A6).
 * Ritorna anche l'url normalizzato (= `enrichment.canonicalUrl`): `undefined` se l'item non
 * identifica un profilo, nel qual caso viene omesso a monte.
 */
export function mapProfileDetailItem(it: unknown): { url: string | undefined; enrichment: Enrichment } {
  const basic = field(it, 'basic_info') ?? {};
  const about = field(basic, 'about', 'summary');
  const location = field(basic, 'location');
  const experience = field(it, 'experience', 'experiences');
  // Identità (steering 2026-09-16): slug pubblico se esposto, id membro letto in modo tollerante.
  const { linkedinUrl, memberUrn } = profileKeys({
    url:
      field(basic, 'profile_url', 'profileUrl', 'public_profile_url', 'linkedin_url') ??
      field(it, 'profile_url', 'profileUrl', 'url', 'linkedinUrl'),
    publicIdentifier:
      field(basic, 'public_identifier', 'publicIdentifier') ?? field(it, 'public_identifier', 'publicIdentifier'),
    memberId: field(basic, 'urn', 'profile_urn', 'member_urn') ?? field(it, 'urn', 'profile_urn', 'member_urn'),
  });

  const enrichment: Enrichment = {
    canonicalUrl: linkedinUrl,
    memberUrn,
    fullName: field(basic, 'fullname', 'full_name', 'name'),
    headline: field(basic, 'headline', 'occupation'),
    about: truncate(about, 2000) || undefined,
    location:
      field(location, 'full') ?? (typeof location === 'string' ? location : undefined),
    email: field(basic, 'email') ?? firstEmailIn(about),
    company: field(basic, 'current_company', 'company'),
    companyUrl: field(basic, 'current_company_url', 'company_url', 'company_linkedin_url'),
    title: currentTitle(experience),
    // apimaestro non espone telefono → lasciato fuori (COALESCE non lo azzera).
    raw: {
      source: it,
      experience,
      education: field(it, 'education'),
      certifications: field(it, 'certifications'),
    },
  };
  return { url: linkedinUrl, enrichment };
}

/**
 * Arricchisce una lista di URL profilo via apimaestro/linkedin-profile-detail (no cookie):
 * about, email pubblica best-effort, azienda, location, URL canonico e id membro. Actor
 * single-profile → una chiamata per URL a concorrenza `config.enrichConcurrency`. Ritorna
 * `urlDiInput -> Enrichment`; gli URL non risolti (item senza profilo) vengono omessi.
 * Un fallimento dell'actor rigetta con messaggio attribuito `actor:<actorId>: …`.
 */
export async function enrichProfileDetails(urls: string[]): Promise<Map<string, Enrichment>> {
  const map = new Map<string, Enrichment>();
  if (urls.length === 0) return map;

  const limit = pLimit(Math.max(1, config.enrichConcurrency));
  await Promise.all(
    urls.map((u) =>
      limit(async () => {
        let items: unknown[];
        try {
          ({ items } = await runActor(ACTORS.profileDetail, profileDetailInput([u])));
        } catch (err) {
          const message = (err instanceof Error ? err.message : String(err)).replace(/^Actor "[^"]*" fallito: /, '');
          throw new Error(`actor:${ACTORS.profileDetail}: ${message}`);
        }
        const it = items[0];
        if (!it) return;
        // L'actor canonicalizza l'URL in output (URN `/in/ACwAAA…` → public identifier),
        // quindi NON coincide con l'input. Chiamiamo un URL per volta: la chiave è l'URL
        // di **input** `u`, così il chiamante ritrova l'enrichment con la sua `linkedin_url`;
        // l'URL canonico viaggia in `enrichment.canonicalUrl` (identità, T10).
        const { url, enrichment } = mapProfileDetailItem(it);
        if (url) map.set(u, enrichment);
      }),
    ),
  );
  return map;
}
