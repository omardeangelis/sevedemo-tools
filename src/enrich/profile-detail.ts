import pLimit from 'p-limit';
import { runActor } from '../apify/client.js';
import { ACTORS, profileDetailInput } from '../apify/actors.js';
import { field, normalizeLinkedinUrl, truncate } from '../util/fields.js';
import type { Enrichment } from '../db/contacts.js';

// Concorrenza limitata: l'actor è single-profile, una chiamata per URL.
const CONCURRENCY = 3;

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

/** Primo indirizzo email in un testo libero (fallback su `about`). */
export function firstEmailIn(text: unknown): string | undefined {
  if (typeof text !== 'string') return undefined;
  const m = text.match(EMAIL_RE);
  return m ? m[0] : undefined;
}

/**
 * Mappa un item dell'actor apimaestro — output **annidato** (`basic_info.*`,
 * diverso dallo schema piatto di dev_fusion) — in un `Enrichment`.
 * Email da `basic_info.email`, con fallback regex su `basic_info.about` (A6).
 * Ritorna anche l'url normalizzato (chiave della mappa): `undefined` se assente,
 * nel qual caso l'item viene omesso a monte.
 */
export function mapProfileDetailItem(it: unknown): { url: string | undefined; enrichment: Enrichment } {
  const basic = field(it, 'basic_info') ?? {};
  const about = field(basic, 'about', 'summary');
  const location = field(basic, 'location');
  const url = normalizeLinkedinUrl(
    field(basic, 'profile_url', 'profileUrl', 'public_profile_url', 'linkedin_url') ??
      field(it, 'profile_url', 'profileUrl', 'url', 'linkedinUrl'),
  );

  const enrichment: Enrichment = {
    fullName: field(basic, 'fullname', 'full_name', 'name'),
    headline: field(basic, 'headline', 'occupation'),
    about: truncate(about, 2000) || undefined,
    location:
      field(location, 'full') ?? (typeof location === 'string' ? location : undefined),
    email: field(basic, 'email') ?? firstEmailIn(about),
    company: field(basic, 'current_company', 'company'),
    // apimaestro non espone telefono → lasciato fuori (COALESCE non lo azzera).
    raw: {
      source: it,
      experience: field(it, 'experience', 'experiences'),
      education: field(it, 'education'),
      certifications: field(it, 'certifications'),
    },
  };
  return { url, enrichment };
}

/**
 * Arricchisce una lista di URL profilo via apimaestro/linkedin-profile-detail (no cookie):
 * about, email pubblica best-effort, azienda, location. Actor single-profile → una
 * chiamata per URL a concorrenza limitata. Ritorna `urlNormalizzato -> Enrichment`;
 * gli URL non risolti (item senza profilo) vengono omessi.
 */
export async function enrichProfileDetails(urls: string[]): Promise<Map<string, Enrichment>> {
  const map = new Map<string, Enrichment>();
  if (urls.length === 0) return map;

  const limit = pLimit(CONCURRENCY);
  await Promise.all(
    urls.map((u) =>
      limit(async () => {
        const { items } = await runActor(ACTORS.profileDetail, profileDetailInput([u]));
        const it = items[0];
        if (!it) return;
        // L'actor canonicalizza l'URL in output (URN `/in/ACwAAA…` → public identifier),
        // quindi NON coincide con l'input. Chiamiamo un URL per volta: la chiave è l'URL
        // di **input** `u`, così il chiamante ritrova l'enrichment con la sua `linkedin_url`.
        // `mapProfileDetailItem(...).url` serve solo a scartare gli item senza profilo.
        const { url, enrichment } = mapProfileDetailItem(it);
        if (url) map.set(u, enrichment);
      }),
    ),
  );
  return map;
}
