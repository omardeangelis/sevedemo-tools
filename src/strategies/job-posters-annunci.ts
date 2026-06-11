import { config } from '../config.js';
import { runActor } from '../apify/client.js';
import { ACTORS, jobsSearchInput } from '../apify/actors.js';
import { field, normalizeLinkedinUrl } from '../util/fields.js';
import { loadJobSearchUrls } from './seeds.js';
import type { RawCandidate, Strategy } from './types.js';

/**
 * COOKIE. Estrae la PERSONA che pubblica annunci (recruiter/hiring) dagli annunci LinkedIn.
 * Soggetta al cap conservativo COOKIE_MAX_PROFILES. Disabilitata se manca LINKEDIN_LI_AT.
 * (Senza cookie gli actor annunci restituiscono solo l'azienda, non la persona.)
 */
export const jobPostersAnnunci: Strategy = {
  id: 'job-posters-annunci',
  description: 'Persona che pubblica annunci (recruiter/hiring) dagli annunci (richiede cookie, cap).',
  requiresCookie: true,
  bucketHint: 'azienda',
  async source(limit: number): Promise<RawCandidate[]> {
    if (!config.linkedinLiAt) {
      throw new Error('Strategia "job-posters-annunci" disabilitata: LINKEDIN_LI_AT non impostato.');
    }
    const cap = Math.min(limit, config.cookieMaxProfiles);
    const searchUrls = loadJobSearchUrls();
    if (searchUrls.length === 0) {
      throw new Error('Nessun URL in data/seeds/job-search-urls.json.');
    }

    const out: RawCandidate[] = [];
    const seen = new Set<string>();
    const perUrl = Math.max(1, Math.ceil(cap / searchUrls.length));

    for (const searchUrl of searchUrls) {
      if (out.length >= cap) break;
      const { items } = await runActor(ACTORS.jobsSearchCookie, jobsSearchInput(searchUrl, config.linkedinLiAt, perUrl));
      for (const job of items) {
        // L'actor restituisce, dove disponibile, il poster/recruiter dell'annuncio.
        const posterUrl = normalizeLinkedinUrl(
          field(job, 'posterProfileUrl', 'recruiterProfileUrl', 'jobPosterProfileUrl', 'hiringPersonProfileUrl'),
        );
        if (!posterUrl || seen.has(posterUrl)) continue;
        seen.add(posterUrl);
        out.push({
          linkedinUrl: posterUrl,
          fullName: field(job, 'posterName', 'recruiterName', 'hiringPersonName'),
          headline: field(job, 'posterHeadline', 'recruiterHeadline'),
          raw: job,
        });
        if (out.length >= cap) break;
      }
    }
    return out;
  },
};
