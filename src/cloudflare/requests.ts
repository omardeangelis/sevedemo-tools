/**
 * Richieste Cloudflare Browser Run (own-profile-services T20): UNICO punto del codice in cui si costruiscono
 * percorsi, querystring e corpi delle chiamate a Cloudflare, come `src/apollo/requests.ts`. Funzioni pure:
 * nessuna chiamata, nessun accesso a config o DB. Il client (`client.ts`) le esegue così come sono.
 *
 * Riferimento: endpoint di crawl, letto il 2026-09-30
 * (https://developers.cloudflare.com/browser-run/quick-actions/crawl-endpoint/). La lettura è asincrona: avvio
 * (restituisce l'id), stato con le pagine lette (a pagine, con `cursor`), annullamento.
 */

/** Operazioni usate dal CRM: sono anche il prefisso degli errori `actor:cloudflare:<op>:` (PLAN P-14). */
export type CloudflareOp = 'crawl' | 'crawl/status' | 'crawl/cancel';

export type CloudflareQueryValue = string | number;

export interface CloudflareRequest {
  op: CloudflareOp;
  method: 'GET' | 'POST' | 'DELETE';
  /** Percorso relativo a `https://api.cloudflare.com/client/v4/accounts/<account id>/`, senza slash iniziale. */
  path: string;
  /** Corpo JSON; assente = nessun corpo. */
  body?: Record<string, unknown>;
  query?: Record<string, CloudflareQueryValue>;
}

/**
 * Scopo dichiarato al sito (SPEC Constraints): la lettura serve da input a un'elaborazione AI, non a un motore di
 * ricerca né all'addestramento. Cloudflare lo confronta con le direttive `Content-Signal` del `robots.txt` del
 * sito e rifiuta la lettura (400) se il sito non lo consente. Il resto lo fa l'endpoint da sé: rispetta
 * `robots.txt` e `crawl-delay` (0,5 s tra due richieste allo stesso dominio se il sito non lo indica) e si
 * presenta con lo user agent `CloudflareBrowserRenderingCrawler/1.0`, che non si può cambiare.
 */
export const CRAWL_PURPOSES = ['ai-input'] as const;

/** Tetto di pagine per lettura sul piano gratuito (limiti letti il 2026-09-30): oltre, l'endpoint rifiuta. */
export const CRAWL_MAX_PAGES = 100;

export interface CrawlInput {
  /** Indirizzo da cui parte la lettura (`http` o `https`). */
  url: string;
  /** Pagine lette al massimo (`CLOUDFLARE_MAX_PAGES`). */
  maxPages: number;
  /**
   * `false` = solo l'HTML iniziale, senza browser: niente JavaScript, niente tempo di browser (gratuita durante la
   * beta, poi al prezzo dei Workers). Default `true`: i siti moderni senza JavaScript sono spesso quasi vuoti (SPEC).
   */
  render?: boolean;
}

function assertJobId(name: string, jobId: string): void {
  if (!/^[\w-]+$/.test(jobId)) throw new Error(`${name}: id della lettura non valido (${jobId})`);
}

/**
 * Avvio della lettura: il sito e basta (niente domini esterni né sottodomini, i default dell'endpoint scritti per
 * chiarezza), testo in Markdown, JavaScript eseguito salvo `render: false`.
 */
export function startCrawlRequest(input: CrawlInput): CloudflareRequest {
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    throw new Error(`startCrawlRequest: indirizzo non valido (${input.url})`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`startCrawlRequest: serve un indirizzo http o https (${input.url})`);
  }
  if (!Number.isInteger(input.maxPages) || input.maxPages < 1 || input.maxPages > CRAWL_MAX_PAGES) {
    throw new Error(`startCrawlRequest: pagine tra 1 e ${CRAWL_MAX_PAGES} (ricevuto ${input.maxPages})`);
  }
  return {
    op: 'crawl',
    method: 'POST',
    path: 'browser-run/crawl',
    body: {
      url: url.href,
      limit: input.maxPages,
      render: input.render !== false,
      formats: ['markdown'],
      crawlPurposes: [...CRAWL_PURPOSES],
      options: { includeExternalLinks: false, includeSubdomains: false },
    },
  };
}

/**
 * Stato della lettura con le pagine lette fin lì (fino a 10 MB per risposta; oltre, il `cursor` porta alle successive).
 * Niente `limit`: con una richiesta ogni 10 secondi, averle già nello stato che dice "finita" risparmia una richiesta.
 */
export function crawlStatusRequest(jobId: string, cursor?: string | number): CloudflareRequest {
  assertJobId('crawlStatusRequest', jobId);
  return {
    op: 'crawl/status',
    method: 'GET',
    path: `browser-run/crawl/${jobId}`,
    ...(cursor === undefined ? {} : { query: { cursor } }),
  };
}

/** Annullamento di una lettura ancora in corso (per esempio oltre il tempo massimo di attesa). */
export function cancelCrawlRequest(jobId: string): CloudflareRequest {
  assertJobId('cancelCrawlRequest', jobId);
  return { op: 'crawl/cancel', method: 'DELETE', path: `browser-run/crawl/${jobId}` };
}
