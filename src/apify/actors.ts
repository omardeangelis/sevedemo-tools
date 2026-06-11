/**
 * ID degli actor Apify + builder degli input.
 *
 * ⚠️ NOTA: gli schemi di input degli actor di terze parti possono cambiare. Gli input qui sotto
 * sono best-effort basati sulla documentazione degli actor. Se un actor restituisce errore di
 * validazione input, è qui che vanno adattati i campi (un solo punto da toccare). Il mapping
 * dell'output è invece tollerante (vedi util/fields.ts) e gestisce nomi di campo diversi.
 */

export const ACTORS = {
  /** Ricerca persone per query/headline. No cookie. */
  profileSearch: 'harvestapi/linkedin-profile-search',
  /** Post recenti di un profilo. No cookie. */
  profilePosts: 'harvestapi/linkedin-profile-posts',
  /** Reazioni (likers/reactors) di un post. No cookie. */
  postReactions: 'harvestapi/linkedin-post-reactions',
  /** Enrichment profilo completo + email best-effort. No cookie. */
  profileScraper: 'dev_fusion/linkedin-profile-scraper',
  /** Ricerca persone via URL (anche filtro "Followers of"). RICHIEDE cookie li_at. */
  peopleSearchCookie: 'curious_coder/linkedin-people-search-scraper',
  /** Annunci di lavoro con persona/recruiter. RICHIEDE cookie li_at. */
  jobsSearchCookie: 'curious_coder/linkedin-jobs-search-scraper',
} as const;

export function profileSearchInput(query: string, location: string, maxItems: number): Record<string, unknown> {
  return {
    searchQuery: query,
    location,
    maxItems,
    // harvestapi: modalità che include headline/about per la classificazione
    profileScraperMode: 'Short',
  };
}

export function profilePostsInput(profileUrl: string, maxPosts: number): Record<string, unknown> {
  return { profileUrl, maxPosts, maxItems: maxPosts };
}

export function postReactionsInput(postUrl: string, maxItems: number): Record<string, unknown> {
  return { postUrl, maxItems };
}

export function profileScraperInput(profileUrls: string[]): Record<string, unknown> {
  return { profileUrls, urls: profileUrls };
}

/** Costruisce l'URL di ricerca "Followers of <person>" da passare all'actor cookie. */
export function buildFollowersSearchUrl(profileUrl: string): string {
  // L'actor accetta direttamente l'URL di ricerca people di LinkedIn con il filtro followers applicato.
  // Qui passiamo il profilo come seed; la costruzione precisa dell'URL va rifinita in fase di test reale.
  return profileUrl;
}

export function followersSearchInput(profileUrl: string, liAt: string, maxItems: number): Record<string, unknown> {
  return {
    searchUrl: buildFollowersSearchUrl(profileUrl),
    profileUrl,
    cookie: [{ name: 'li_at', value: liAt }],
    maxItems,
  };
}

export function jobsSearchInput(searchUrl: string, liAt: string, maxItems: number): Record<string, unknown> {
  return {
    urls: [searchUrl],
    cookie: [{ name: 'li_at', value: liAt }],
    maxItems,
  };
}
