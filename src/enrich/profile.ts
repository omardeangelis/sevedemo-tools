import { runActor } from '../apify/client.js';
import { ACTORS, profileScraperInput } from '../apify/actors.js';
import { field, normalizeLinkedinUrl, truncate } from '../util/fields.js';
import type { Enrichment } from '../db/contacts.js';

/**
 * Arricchisce una lista di URL profilo via dev_fusion (no cookie): about, esperienze, email best-effort.
 * Ritorna una mappa urlNormalizzato -> Enrichment. Gli URL non risolti vengono semplicemente omessi.
 */
export async function enrichProfiles(urls: string[]): Promise<Map<string, Enrichment>> {
  const map = new Map<string, Enrichment>();
  if (urls.length === 0) return map;

  const { items } = await runActor(ACTORS.profileScraper, profileScraperInput(urls));

  for (const it of items) {
    const url = normalizeLinkedinUrl(
      field(it, 'linkedinUrl', 'profileUrl', 'url', 'inputUrl', 'publicProfileUrl'),
    );
    if (!url) continue;

    const experienceRaw = field(it, 'experience', 'experiences', 'positions');
    map.set(url, {
      fullName: field(it, 'fullName', 'name'),
      headline: field(it, 'headline', 'occupation', 'subtitle'),
      about: truncate(field(it, 'about', 'summary', 'bio'), 2000) || undefined,
      location: field(it, 'location', 'addressWithCountry', 'geoLocation', 'addressWithoutCountry'),
      email: field(it, 'email', 'emailAddress'),
      phone: field(it, 'mobileNumber', 'phone', 'phoneNumber'),
      company: field(it, 'companyName', 'currentCompany', 'company', 'organization'),
      raw: { experience: experienceRaw, source: it },
    });
  }
  return map;
}
