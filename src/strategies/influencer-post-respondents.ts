import { runActor } from '../apify/client.js';
import {
  ACTORS,
  profilePostsApimaestroInput,
  postCommentsInput,
  profileSearchInput,
} from '../apify/actors.js';
import { config } from '../config.js';
import { field } from '../util/fields.js';
import { loadInfluencers } from './seeds.js';
import { extractPost, mapComments, mapTaggedPerson, type CompanyRef } from './post-extract.js';
import { expandCompanies } from './company-expansion.js';
import type { RawCandidate, Strategy } from './types.js';

/** Dipendenze iniettabili dell'orchestrazione: rendono il core testabile senza Apify. */
export interface RespondentsDeps {
  influencers: string[];
  postsPerInfluencer: number;
  taggedPersonEnabled: boolean;
  /** Se presente, scarta i post più vecchi di questo timestamp (ms). */
  recencyCutoffMs?: number;
  fetchPosts: (profileUrl: string) => Promise<any[]>;
  fetchComments: (activityId: string) => Promise<any[]>;
  expand: (companies: CompanyRef[]) => Promise<RawCandidate[]>;
}

/** Timestamp (ms) del post, se leggibile. Post senza data → undefined (non scartato). */
function postTimestamp(post: any): number | undefined {
  const ts = field(post?.posted_at, 'timestamp');
  return typeof ts === 'number' ? ts : undefined;
}

/**
 * Core dell'estrazione (puro rispetto all'I/O: tutto passa dalle deps). Per ogni
 * influencer → post recenti → commentatori (segnale più caldo, raccolti per primi) +
 * persone taggate (se abilitate) + aziende taggate raccolte e poi espanse a
 * decision-maker. Dedup globale per URL normalizzato, rispetta `limit`. Errori/vuoti
 * per-post isolati: un post che fallisce o non rende contribuisce 0 e NON fa fallire
 * `source()`. Seed vuoto → throw (è un errore di configurazione, non un run pulito).
 */
export async function collectRespondents(limit: number, deps: RespondentsDeps): Promise<RawCandidate[]> {
  if (deps.influencers.length === 0) {
    throw new Error(
      'Nessun influencer in data/seeds/influencers.json: aggiungi gli URL dei profili da cui pescare i commentatori.',
    );
  }

  const out: RawCandidate[] = [];
  const seen = new Set<string>();
  const companyRefs: CompanyRef[] = [];

  const add = (c: RawCandidate | null): void => {
    if (!c || out.length >= limit || seen.has(c.linkedinUrl)) return;
    seen.add(c.linkedinUrl);
    out.push(c);
  };

  for (const influencer of deps.influencers) {
    if (out.length >= limit) break;

    let posts: any[] = [];
    try {
      posts = await deps.fetchPosts(influencer);
    } catch {
      posts = []; // un influencer che fallisce non blocca gli altri
    }

    for (const post of posts.slice(0, deps.postsPerInfluencer)) {
      if (out.length >= limit) break;

      const ts = postTimestamp(post);
      if (deps.recencyCutoffMs !== undefined && ts !== undefined && ts < deps.recencyCutoffMs) continue;

      const { activityId, postUrl, people, companies } = extractPost(post);
      companyRefs.push(...companies);

      if (activityId) {
        try {
          const comments = await deps.fetchComments(activityId);
          for (const c of mapComments(comments, postUrl)) add(c);
        } catch {
          // commenti disabilitati / actor in errore su QUESTO post → 0, niente throw
        }
      }

      if (deps.taggedPersonEnabled) {
        for (const p of people) add(mapTaggedPerson(p));
      }
    }
  }

  // Espansione-azienda col budget residuo (i commentatori hanno la precedenza).
  if (out.length < limit && companyRefs.length > 0) {
    const expanded = await deps.expand(companyRefs);
    for (const c of expanded) add(c);
  }

  return out.slice(0, limit);
}

/**
 * Fonte primaria azienda-first: i **commentatori** dei post degli influencer
 * (apimaestro) + le persone/aziende taggate (aziende espanse a decision-maker).
 * No-cookie. Il bucket finale lo decide Claude in scoring.
 */
export const influencerPostRespondents: Strategy = {
  id: 'influencer-post-respondents',
  description:
    'Commentatori dei post degli influencer (apimaestro) + persone/aziende taggate, aziende espanse a decision-maker. Fonte primaria, azienda-first.',
  requiresCookie: false,
  bucketHint: 'misto',
  async source(limit: number): Promise<RawCandidate[]> {
    return collectRespondents(limit, {
      influencers: loadInfluencers(),
      postsPerInfluencer: config.postsPerInfluencer,
      taggedPersonEnabled: config.taggedPersonEnabled,
      recencyCutoffMs: Date.now() - config.postRecencyDays * 86_400_000,
      fetchPosts: async (url) =>
        (await runActor(ACTORS.profilePostsApimaestro, profilePostsApimaestroInput(url, config.postsPerInfluencer)))
          .items,
      fetchComments: async (activityId) =>
        (await runActor(ACTORS.postComments, postCommentsInput([activityId], config.commentsPerPost))).items,
      expand: (companies) =>
        expandCompanies(companies, {
          roles: config.companyExpansionRoles,
          perCompany: config.companyExpansionPerCompany,
          search: async (query, location, maxItems) =>
            (await runActor(ACTORS.profileSearch, profileSearchInput(query, location, maxItems))).items,
        }),
    });
  },
};
