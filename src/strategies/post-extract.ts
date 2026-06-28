/**
 * Mapper puri per la fonte `influencer-post-respondents`. Nessuna I/O: trasformano
 * gli item degli actor apimaestro (post + commenti) e le annotation nei tipi grezzi
 * della pipeline. La lettura è tollerante (`field`) perché lo schema degli actor di
 * terze parti non è garantito.
 */
import { field, normalizeLinkedinUrl } from '../util/fields.js';
import type { RawCandidate } from './types.js';

/** Persona taggata in un post (`text_annotations[].type === 'profile'`). */
export interface TaggedPerson {
  name?: string;
  /** Id membro (`ACoAA…`): NON è uno slug `/in/…`, va trattato come URN. */
  profileUrn: string;
}

/** Azienda taggata in un post (`text_annotations[].type === 'company'`). */
export interface CompanyRef {
  name: string;
  companyUrn?: string;
}

/** Risultato dell'estrazione da un singolo post item. */
export interface PostExtract {
  /** Id attività usato per interrogare i commenti (preferito `urn.activity_urn`). */
  activityId?: string;
  postUrl?: string;
  people: TaggedPerson[];
  companies: CompanyRef[];
}

/** Estrae l'id attività: preferisce `urn.activity_urn`, poi parsa `full_urn`. */
function activityIdOf(item: any): string | undefined {
  const fromUrn = field(item?.urn, 'activity_urn');
  if (fromUrn != null) return String(fromUrn);
  const full = field(item, 'full_urn');
  if (typeof full === 'string') {
    const m = full.match(/urn:li:(?:activity|ugcPost):(\d+)/);
    if (m) return m[1];
  }
  return undefined;
}

/**
 * Da un item `apimaestro/linkedin-profile-posts`: id attività, url, e le persone/
 * aziende taggate **solo nel testo top-level**. D9: le `text_annotations` di
 * `reshared_post` sono ignorate (evita doppi conteggi e drift dell'autore originale).
 */
export function extractPost(item: any): PostExtract {
  const anns = Array.isArray(item?.text_annotations) ? item.text_annotations : [];

  const people: TaggedPerson[] = anns
    .filter((a: any) => a?.type === 'profile')
    .map((a: any) => ({ name: field(a, 'text'), profileUrn: field(a, 'profile_urn') }))
    .filter((p: TaggedPerson) => typeof p.profileUrn === 'string' && p.profileUrn.length > 0);

  const companies: CompanyRef[] = anns
    .filter((a: any) => a?.type === 'company')
    .map((a: any) => ({ name: field(a, 'text'), companyUrn: field(a, 'company_urn') }))
    .filter((c: CompanyRef) => typeof c.name === 'string' && c.name.length > 0);

  return {
    activityId: activityIdOf(item),
    postUrl: field(item, 'url', 'postUrl', 'link'),
    people,
    companies,
  };
}

/**
 * Da un item commento (`apimaestro/linkedin-post-comments-...`) → `RawCandidate`
 * `commenter`. Include sia `comment` sia `reply` (entrambi "chi risponde").
 * `linkedinUrl` da `author.profile_url` (slug `/in/<slug>` reale); item senza un
 * URL valido → `null` (scartato). `sourcePostUrl` = `postUrl` passato dall'orchestratore,
 * con fallback su `post_input` (id post echeggiato dall'actor) per la linkage.
 */
export function mapComment(item: any, postUrl?: string): RawCandidate | null {
  const author = field(item, 'author') ?? {};
  const url = normalizeLinkedinUrl(field(author, 'profile_url', 'profileUrl', 'url'));
  if (!url) return null;
  return {
    linkedinUrl: url,
    fullName: field(author, 'name', 'fullName', 'displayName'),
    headline: field(author, 'headline', 'subtitle', 'occupation'),
    sourcePostUrl: postUrl ?? field(item, 'post_input'),
    sourceDetail: 'commenter',
    raw: item,
  };
}

/** Mappa una lista di commenti, scartando gli item senza URL. Lista vuota → `[]`. */
export function mapComments(items: any[], postUrl?: string): RawCandidate[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((it) => mapComment(it, postUrl))
    .filter((c): c is RawCandidate => c !== null);
}

/**
 * Persona taggata → `RawCandidate` `tagged-person`. ⚠️ Limite noto (RH): la annotation
 * dà solo `profile_urn` (id membro `ACoAA…`), non uno slug `/in/<slug>`. Costruiamo
 * `https://www.linkedin.com/in/<profile_urn>` (case preservato da `normalizeLinkedinUrl`).
 * Senza URN → `null` (non si fabbrica un URL). Questa chiave **non deduplica** con i
 * commentatori (`/in/<slug>`): lo stesso umano può comparire due volte.
 *
 * La RISOLVIBILITÀ di questo URN contro l'enrichment **daily** (`dev_fusion`, non
 * apimaestro) NON è ancora provata → l'emissione nel pipeline è gated da
 * `config.taggedPersonEnabled` (default off) finché lo smoke reale T14 non conferma.
 */
export function mapTaggedPerson(p: TaggedPerson): RawCandidate | null {
  const urn = typeof p?.profileUrn === 'string' ? p.profileUrn.trim() : '';
  if (!urn) return null;
  const url = normalizeLinkedinUrl(`https://www.linkedin.com/in/${urn}`);
  if (!url) return null;
  return {
    linkedinUrl: url,
    fullName: p.name,
    sourceDetail: 'tagged-person',
    raw: p,
  };
}
