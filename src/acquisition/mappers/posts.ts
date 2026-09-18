/**
 * Mapper puri per i post del profilo utente e i loro commenti. Nessuna I/O: trasformano
 * gli item degli actor apimaestro (`linkedin-profile-posts`, `linkedin-post-comments-…`)
 * nei tipi dell'acquisizione. La lettura è tollerante (`field`) perché lo schema degli
 * actor di terze parti non è garantito.
 */
import { field, profileKeys } from '../../util/fields.js';
import type { CommentCandidate } from '../types.js';

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
  /** Testo integrale del post (l'excerpt lo tronca chi salva). */
  text?: string;
  /** Data di pubblicazione ISO (da `posted_at.timestamp`, fallback `posted_at.date`). */
  postedAt?: string;
  /** Reazioni dichiarate dal post (`stats.total_reactions`): base per stima e warning. */
  reactionsCount?: number;
  /** Commenti dichiarati dal post (`stats.comments`). */
  commentsCount?: number;
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

/** Data di pubblicazione: timestamp in ms → ISO; altrimenti la stringa data così com'è. */
function postedAtOf(item: any): string | undefined {
  const posted = field(item, 'posted_at', 'postedAt');
  if (typeof posted === 'string') return posted;
  const ts = field(posted, 'timestamp');
  if (typeof ts === 'number' && Number.isFinite(ts)) return new Date(ts).toISOString();
  const date = field(posted, 'date');
  return typeof date === 'string' ? date : undefined;
}

/** Conteggio numerico (0 incluso); valori non numerici → undefined. */
function countOf(obj: unknown, ...names: string[]): number | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const n of names) {
    const v = (obj as Record<string, unknown>)[n];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return undefined;
}

/**
 * Da un item `apimaestro/linkedin-profile-posts`: id attività, url, testo, data, conteggi
 * dichiarati e le aziende taggate **solo nel testo top-level**. D9: le `text_annotations`
 * di `reshared_post` sono ignorate (evita doppi conteggi e drift dell'autore originale).
 */
export function extractPost(item: any): PostExtract {
  const anns = Array.isArray(item?.text_annotations) ? item.text_annotations : [];

  const companies: CompanyRef[] = anns
    .filter((a: any) => a?.type === 'company')
    .map((a: any) => ({ name: field(a, 'text'), companyUrn: field(a, 'company_urn') }))
    .filter((c: CompanyRef) => typeof c.name === 'string' && c.name.length > 0);

  const stats = field(item, 'stats');
  const text = field(item, 'text', 'commentary');

  return {
    activityId: activityIdOf(item),
    postUrl: field(item, 'url', 'postUrl', 'link'),
    text: typeof text === 'string' ? text : undefined,
    postedAt: postedAtOf(item),
    reactionsCount: countOf(stats, 'total_reactions', 'totalReactions', 'reactions'),
    commentsCount: countOf(stats, 'comments', 'total_comments', 'commentsCount'),
    companies,
  };
}

/**
 * Da un item commento (`apimaestro/linkedin-post-comments-...`) → candidato `post_comment`.
 * Include sia `comment` sia `reply` (entrambi "chi risponde"). `linkedinUrl` da
 * `author.profile_url` (slug `/in/<slug>` reale); `memberUrn` solo se l'autore espone un id membro
 * (`author.urn` o query `miniProfileUrn`: assenti nel layout documentato); item senza un URL valido → `null`
 * (scartato). `postUrl` = quello passato dall'orchestratore, con fallback su `post_input`
 * (id post echeggiato dall'actor) per la linkage.
 */
export function mapComment(item: any, postUrl?: string): CommentCandidate | null {
  const author = field(item, 'author') ?? {};
  const { linkedinUrl, memberUrn } = profileKeys({
    url: field(author, 'profile_url', 'profileUrl', 'url'),
    publicIdentifier: field(author, 'public_identifier', 'publicIdentifier'),
    memberId: field(author, 'urn', 'profile_urn', 'member_urn'),
  });
  if (!linkedinUrl) return null;
  const text = field(item, 'text', 'comment_text', 'comment');
  return {
    kind: 'post_comment',
    linkedinUrl,
    memberUrn,
    fullName: field(author, 'name', 'fullName', 'displayName'),
    headline: field(author, 'headline', 'subtitle', 'occupation'),
    commentText: typeof text === 'string' ? text : undefined,
    postUrl: postUrl ?? field(item, 'post_input'),
    raw: item,
  };
}

/**
 * Mappa una lista di commenti, scartando gli item senza URL. Lista vuota → `[]`.
 * Gli scartati (per `skipped_no_url`) sono `items.length - risultato.length`.
 */
export function mapComments(items: any[], postUrl?: string): CommentCandidate[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((it) => mapComment(it, postUrl))
    .filter((c): c is CommentCandidate => c !== null);
}
