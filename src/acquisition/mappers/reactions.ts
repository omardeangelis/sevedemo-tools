/**
 * Mapper puro per `apimaestro/linkedin-post-reactions`. Nessuna I/O: trasforma gli item
 * dell'actor in candidati `post_reaction`. Lettura tollerante (`field`): lo schema di
 * un actor di terze parti non è garantito.
 *
 * Layout documentato (README actor, 2026-09-16):
 * `{reaction_type, reactor: {urn, name, headline, profile_url, profile_pictures},
 *   _metadata: {post_url, page_number, reaction_type}}`.
 * ⚠️ `reactor.profile_url` è spesso nel formato member-URN (`/in/ACoAA…`), non lo slug
 * pubblico: `reactor.urn` va in `memberUrn` perché `upsertProspect` possa legare la reazione
 * al commento (`/in/<slug>`) della stessa persona.
 */
import { field, profileKeys } from '../../util/fields.js';
import type { MapResult, ReactionCandidate } from '../types.js';

export interface ReactionsMapResult extends MapResult<ReactionCandidate> {
  /**
   * Item letti per post (scartati inclusi), chiave = post URL echeggiato dall'actor.
   * Serve alla paginazione in batch: un post con meno item del `limit` è esaurito.
   * Gli item senza post URL non sono conteggiati qui.
   */
  itemsByPost: Record<string, number>;
}

/** Post URL di un item: preferisce `_metadata.post_url`, poi campi piatti. */
function postUrlOf(item: any): string | undefined {
  const meta = field(item, '_metadata', 'metadata');
  const url = field(meta, 'post_url', 'postUrl') ?? field(item, 'post_url', 'postUrl', 'post_input');
  return typeof url === 'string' ? url : undefined;
}

/** Reazione → candidato, o `null` se il reattore non ha un URL normalizzabile. */
export function mapReaction(item: any): ReactionCandidate | null {
  const reactor = field(item, 'reactor', 'author', 'actor') ?? {};
  const { linkedinUrl, memberUrn } = profileKeys({
    url: field(reactor, 'profile_url', 'profileUrl', 'url', 'linkedinUrl'),
    publicIdentifier: field(reactor, 'public_identifier', 'publicIdentifier'),
    memberId: field(reactor, 'urn', 'profile_urn', 'member_urn'),
  });
  if (!linkedinUrl) return null;
  const type = field(item, 'reaction_type', 'reactionType', 'type');
  return {
    kind: 'post_reaction',
    linkedinUrl,
    memberUrn,
    fullName: field(reactor, 'name', 'fullName', 'displayName'),
    headline: field(reactor, 'headline', 'subtitle', 'occupation'),
    reactionType: typeof type === 'string' ? type.toUpperCase() : undefined,
    postUrl: postUrlOf(item),
    raw: item,
  };
}

/**
 * Mappa gli item di una run (anche su più post in batch). Scarta e conta gli item
 * senza `reactor.profile_url` normalizzabile; input non-array → risultato vuoto.
 */
export function mapReactions(items: any[]): ReactionsMapResult {
  const result: ReactionsMapResult = { candidates: [], skipped: 0, itemsByPost: {} };
  if (!Array.isArray(items)) return result;
  for (const item of items) {
    const postUrl = postUrlOf(item);
    if (postUrl) result.itemsByPost[postUrl] = (result.itemsByPost[postUrl] ?? 0) + 1;
    const c = mapReaction(item);
    if (c) result.candidates.push(c);
    else result.skipped += 1;
  }
  return result;
}
