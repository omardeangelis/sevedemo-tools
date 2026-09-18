/**
 * ID degli actor Apify + builder degli input.
 *
 * ⚠️ NOTA: gli schemi di input degli actor di terze parti possono cambiare. Gli input qui sotto
 * sono best-effort basati sulla documentazione degli actor. Se un actor restituisce errore di
 * validazione input, è qui che vanno adattati i campi (un solo punto da toccare). Il mapping
 * dell'output è invece tollerante (vedi util/fields.ts) e gestisce nomi di campo diversi.
 */

export const ACTORS = {
  /** Post recenti di un profilo (apimaestro, validato dall'operatore). No cookie. */
  profilePostsApimaestro: 'apimaestro/linkedin-profile-posts',
  /** Commentatori (e reply) di un post — "chi risponde". No cookie. */
  postComments: 'apimaestro/linkedin-post-comments-replies-engagements-scraper-no-cookies',
  /** Dettaglio profilo singolo + email pubblica best-effort. No cookie. Enrichment progressivo on-demand. */
  profileDetail: 'apimaestro/linkedin-profile-detail',
  /** Chi ha reagito a uno o più post (batch di URL, paginato). No cookie. $5/1000. */
  postReactions: 'apimaestro/linkedin-post-reactions',
  /** Dipendenti di un'azienda con filtri ruolo/località. No cookie. $4–12/1000 per modalità. */
  companyEmployees: 'harvestapi/linkedin-company-employees',
} as const;

/**
 * Input per apimaestro/linkedin-profile-posts. Il campo richiesto è `username`, che
 * accetta sia lo slug sia un URL `linkedin.com/in/...` (passiamo l'URL del seed).
 * `total_posts` attiva l'auto-paginazione fino a quel numero di post.
 */
export function profilePostsApimaestroInput(profileUrl: string, totalPosts: number): Record<string, unknown> {
  return { username: profileUrl, total_posts: totalPosts };
}

/**
 * Input per apimaestro/linkedin-post-comments-...-no-cookies. `postIds` accetta id
 * numerico dell'attività (es. `7472928569657225216`), activity URL o post URL.
 * `sortOrder`: "most recent" | "most relevant". `limit` 1-100.
 */
export function postCommentsInput(
  postIds: string[],
  limit: number,
  sortOrder: 'most recent' | 'most relevant' = 'most recent',
): Record<string, unknown> {
  return { postIds, limit, sortOrder };
}

/**
 * Input per apimaestro/linkedin-profile-detail (actor single-profile, una chiamata
 * per URL). Schema confermato con smoke reale (R1, 2026-06-15): l'unico campo richiesto
 * è `username` (che accetta anche un URL — incluso il formato URN `/in/ACwAAA…` che usiamo),
 * e `includeEmail` va forzato a `true` (default actor = false, altrimenti niente email).
 * NB: passare l'URL come `profileUrl`/`urls` viene ignorato → l'actor scrapava il profilo
 * demo di default (`sarptecimer`). Tenere `username`.
 */
export function profileDetailInput(urls: string[]): Record<string, unknown> {
  return { username: urls[0], includeEmail: true };
}

/**
 * Input per apimaestro/linkedin-post-reactions. Campi letterali confermati dall'input-schema
 * pubblico (build 0.1.27, GET https://api.apify.com/v2/actor-builds/GRe691CuRf1DXY6oi, 2026-09-16):
 * `post_urls` (string[]: URL o id numerico del post), `page_number` (int ≥ 1, default 1, vale per
 * tutti i post del batch), `limit` (1-100 reazioni per post, default 100), `reaction_type`
 * (`ALL`|`LIKE`|`PRAISE`|`EMPATHY`|`APPRECIATION`|`INTEREST`, default `ALL`: non lo passiamo).
 * Una run per pagina su tutti i post da sincronizzare; un post è esaurito quando torna < `limit` item.
 */
export function postReactionsInput(
  postUrls: string[],
  { pageNumber = 1, limit = 100 }: { pageNumber?: number; limit?: number } = {},
): Record<string, unknown> {
  return { post_urls: postUrls, page_number: pageNumber, limit };
}

/** Modalità di scraping dei dipendenti (prezzo per 1000 profili: Short $4, Full $8, Full+email $12). */
export type EmployeesMode = 'Short' | 'Full' | 'Full+email';

/** Valori letterali dell'enum `profileScraperMode` dell'actor (il prezzo fa parte della stringa). */
const EMPLOYEES_MODE_VALUE: Record<EmployeesMode, string> = {
  Short: 'Short ($4 per 1k)',
  Full: 'Full ($8 per 1k)',
  'Full+email': 'Full + email search ($12 per 1k)',
};

export interface CompanyEmployeesOptions {
  /** Filtro ruoli (ricerca "strict" sui job title correnti). Vuoto/assente = nessun filtro. */
  jobTitles?: string[];
  /** Filtro località testuali (LinkedIn usa il primo suggerimento dell'autocomplete). */
  locations?: string[];
  /** Tetto di profili: obbligatorio, perché per l'actor 0/assente = tutti (fino a 2.500). */
  maxItems: number;
  /** Default `Short`: l'actor di suo userebbe `Full` (il doppio del costo). */
  mode?: EmployeesMode;
}

/**
 * Input per harvestapi/linkedin-company-employees. Campi letterali confermati dall'input-schema
 * pubblico (build 0.0.158, GET https://api.apify.com/v2/actor-builds/dkyNoEUYU6B0NYmwI, 2026-09-16;
 * pagina https://apify.com/harvestapi/linkedin-company-employees/input-schema):
 * `companies` (string[] di URL company, o nomi), `jobTitles` (string[]), `locations` (string[]),
 * `maxItems` (int), `profileScraperMode` (enum `Short ($4 per 1k)` | `Full ($8 per 1k)` |
 * `Full + email search ($12 per 1k)`, default Full). Nessun campo è `required` nello schema.
 * Non usati: `searchQuery`, `pastJobTitles`, `seniorityLevelIds`, `functionIds`, `excludeLocations`,
 * `companyBatchMode` (default `all_at_once`, max 10 aziende per run), `startPage`/`takePages`, ….
 */
export function companyEmployeesInput(
  companyUrls: string[],
  { jobTitles, locations, maxItems, mode = 'Short' }: CompanyEmployeesOptions,
): Record<string, unknown> {
  const input: Record<string, unknown> = { companies: companyUrls };
  if (jobTitles?.length) input.jobTitles = jobTitles;
  if (locations?.length) input.locations = locations;
  input.maxItems = maxItems;
  input.profileScraperMode = EMPLOYEES_MODE_VALUE[mode];
  return input;
}
