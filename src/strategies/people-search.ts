import { runActor } from '../apify/client.js';
import { ACTORS, profileSearchInput } from '../apify/actors.js';
import { field, normalizeLinkedinUrl } from '../util/fields.js';
import { loadQueries } from './seeds.js';
import type { RawCandidate, Strategy } from './types.js';

export function mapProfileItem(item: any): RawCandidate | null {
  const url = normalizeLinkedinUrl(
    field(item, 'linkedinUrl', 'profileUrl', 'url', 'publicProfileUrl', 'profileLink'),
  );
  if (!url) return null;
  return {
    linkedinUrl: url,
    fullName: field(item, 'fullName', 'name', 'displayName'),
    headline: field(item, 'headline', 'subtitle', 'occupation', 'title'),
    raw: item,
  };
}

/**
 * Factory per una strategia di people-search no-cookie basata su un file di query.
 * Distribuisce il `limit` tra le query e deduplica per URL.
 */
export function makePeopleSearchStrategy(opts: {
  id: string;
  description: string;
  queriesFile: string;
  bucketHint: Strategy['bucketHint'];
}): Strategy {
  return {
    id: opts.id,
    description: opts.description,
    requiresCookie: false,
    bucketHint: opts.bucketHint,
    async source(limit: number): Promise<RawCandidate[]> {
      const queries = loadQueries(opts.queriesFile);
      const perQuery = Math.max(1, Math.ceil(limit / queries.length));
      const out: RawCandidate[] = [];
      const seen = new Set<string>();

      for (const q of queries) {
        if (out.length >= limit) break;
        const input = profileSearchInput(q.query, q.location ?? 'Italy', perQuery);
        const { items } = await runActor(ACTORS.profileSearch, input);
        for (const it of items) {
          const c = mapProfileItem(it);
          if (!c || seen.has(c.linkedinUrl)) continue;
          seen.add(c.linkedinUrl);
          out.push(c);
          if (out.length >= limit) break;
        }
      }
      return out;
    },
  };
}
