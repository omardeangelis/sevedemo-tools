import { config } from '../config.js';
import { runActor } from '../apify/client.js';
import { ACTORS, followersSearchInput } from '../apify/actors.js';
import { field, normalizeLinkedinUrl } from '../util/fields.js';
import { loadInfluencers } from './seeds.js';
import type { RawCandidate, Strategy } from './types.js';

/**
 * COOKIE. Estrae i follower di profili influenti nel freelancing via filtro "Followers of".
 * Soggetta al cap conservativo COOKIE_MAX_PROFILES. Disabilitata se manca LINKEDIN_LI_AT.
 */
export const influencerFollowers: Strategy = {
  id: 'influencer-followers',
  description: 'Follower di profili influenti nel freelancing (richiede cookie, cap conservativo).',
  requiresCookie: true,
  bucketHint: 'freelance',
  async source(limit: number): Promise<RawCandidate[]> {
    if (!config.linkedinLiAt) {
      throw new Error('Strategia "influencer-followers" disabilitata: LINKEDIN_LI_AT non impostato.');
    }
    const cap = Math.min(limit, config.cookieMaxProfiles);
    const influencers = loadInfluencers();
    if (influencers.length === 0) {
      throw new Error('Nessun influencer in data/seeds/influencers.json.');
    }

    const out: RawCandidate[] = [];
    const seen = new Set<string>();
    const perInfluencer = Math.max(1, Math.ceil(cap / influencers.length));

    for (const profile of influencers) {
      if (out.length >= cap) break;
      const { items } = await runActor(
        ACTORS.peopleSearchCookie,
        followersSearchInput(profile, config.linkedinLiAt, perInfluencer),
      );
      for (const it of items) {
        const url = normalizeLinkedinUrl(field(it, 'profileUrl', 'linkedinUrl', 'url'));
        if (!url || seen.has(url)) continue;
        seen.add(url);
        out.push({
          linkedinUrl: url,
          fullName: field(it, 'name', 'fullName'),
          headline: field(it, 'headline', 'subtitle', 'occupation'),
          raw: it,
        });
        if (out.length >= cap) break;
      }
    }
    return out;
  },
};
