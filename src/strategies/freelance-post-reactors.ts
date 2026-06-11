import { runActor } from '../apify/client.js';
import { ACTORS, profilePostsInput, postReactionsInput } from '../apify/actors.js';
import { field, normalizeLinkedinUrl } from '../util/fields.js';
import { loadInfluencers } from './seeds.js';
import type { RawCandidate, Strategy } from './types.js';

const MAX_POSTS_PER_INFLUENCER = 2;

/**
 * No-cookie. Per ogni profilo influente nel freelancing prende i post recenti e poi i reactors
 * (chi ha messo like/reazioni). Porta con sé `source_post_url` come riferimento.
 * Il bucket finale lo decide Claude: un reactor può risultare freelance o recruiter.
 */
export const freelancePostReactors: Strategy = {
  id: 'freelance-post-reactors',
  description: 'Reactors (like) dei post di influencer freelance. Intento/segnale caldo.',
  requiresCookie: false,
  bucketHint: 'misto',
  async source(limit: number): Promise<RawCandidate[]> {
    const influencers = loadInfluencers();
    if (influencers.length === 0) {
      throw new Error(
        'Nessun influencer in data/seeds/influencers.json: aggiungi gli URL dei profili da cui pescare i reactors.',
      );
    }

    const out: RawCandidate[] = [];
    const seen = new Set<string>();
    const totalPostsTarget = influencers.length * MAX_POSTS_PER_INFLUENCER;
    const perPost = Math.max(10, Math.ceil(limit / totalPostsTarget));

    for (const profile of influencers) {
      if (out.length >= limit) break;

      const { items: posts } = await runActor(
        ACTORS.profilePosts,
        profilePostsInput(profile, MAX_POSTS_PER_INFLUENCER),
      );
      const postUrls = posts
        .map((p: any) => field(p, 'postUrl', 'url', 'link', 'postLink'))
        .filter((u: unknown): u is string => typeof u === 'string')
        .slice(0, MAX_POSTS_PER_INFLUENCER);

      for (const postUrl of postUrls) {
        if (out.length >= limit) break;
        const { items: reactors } = await runActor(ACTORS.postReactions, postReactionsInput(postUrl, perPost));
        for (const r of reactors) {
          const url = normalizeLinkedinUrl(field(r, 'profileUrl', 'linkedinUrl', 'url', 'publicProfileUrl'));
          if (!url || seen.has(url)) continue;
          seen.add(url);
          out.push({
            linkedinUrl: url,
            fullName: field(r, 'name', 'fullName', 'displayName'),
            headline: field(r, 'headline', 'subtitle', 'occupation'),
            sourcePostUrl: postUrl,
            raw: r,
          });
          if (out.length >= limit) break;
        }
      }
    }
    return out;
  },
};
