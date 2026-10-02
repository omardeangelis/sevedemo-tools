/**
 * Client HTTP Cloudflare Browser Run (own-profile-services T20, SPEC A2, A7, A8). Esegue le richieste costruite in
 * `requests.ts` (unico punto dei percorsi e dei corpi) e traduce gli esiti in errori attribuiti a Cloudflare
 * (PLAN P-14), sempre a parole:
 *
 * - credenziali mancanti → `CloudflareConfigError` `config: CLOUDFLARE_… mancante nel .env`, senza chiamare
 * - 401 → `config: Cloudflare ha rifiutato le credenziali (401)…`; 403 → `config: il token … non ha il permesso…`
 * - 429 col limite di browser del giorno → `CloudflareLimitError` subito (inutile ritentare fino a domani);
 *   altri 429 → attende `retry-after` e ritenta; oltre `CLOUDFLARE_MAX_ATTEMPTS` → `CloudflareLimitError`
 * - ritmo: una richiesta al più ogni `CLOUDFLARE_REQUEST_INTERVAL_MS`, ritentativi compresi, imposto in `send()`
 * - 400 per le direttive `Content-Signal` del sito → il sito non consente la lettura per un'elaborazione AI
 * - altri ≥ 400, errore di rete, risposta non valida → `CloudflareProviderError` `actor:cloudflare:<op>: …`
 *
 * Il token non finisce mai in un messaggio (A7), né i contenuti letti (D11). Nessun accesso a config o DB e niente
 * all'import: `scripts/cloudflare-smoke.ts` importa da qui. `fetch`, `sleep`, `now` e `log` sono iniettabili: i test
 * non chiamano mai Cloudflare. Le uniche righe di log sono attese, ritentativi e la seconda lettura con il browser di
 * `readSite` (people-first-crm P-11).
 */
import { isRecord, networkReason, retryAfterMs, shorten } from '../util/http.js';
import { mapCrawlStatus, type CrawlPage, type CrawlStatus } from './mappers.js';
import {
  cancelCrawlRequest,
  crawlStatusRequest,
  startCrawlRequest,
  type CloudflareOp,
  type CloudflareRequest,
  type CrawlInput,
} from './requests.js';

export const CLOUDFLARE_API_BASE_URL = 'https://api.cloudflare.com/client/v4/';

/** Tentativi HTTP TOTALI per richiesta quando Cloudflare risponde 429 (1 + 2 ritentativi). */
export const CLOUDFLARE_MAX_ATTEMPTS = 3;
/** Attesa massima prima di un ritentativo, anche se `retry-after` chiede di più. */
export const CLOUDFLARE_RETRY_MAX_WAIT_MS = 60_000;
/**
 * Intervallo minimo tra due richieste, ritentativi compresi (e attesa di un 429 senza `retry-after` leggibile): sul
 * piano gratuito le richieste sono al più una ogni 10 secondi (limiti letti il 2026-09-30).
 */
export const CLOUDFLARE_REQUEST_INTERVAL_MS = 10_000;
/** Timeout di ogni singola richiesta HTTP: oltre, errore di rete (non ritentato). */
export const CLOUDFLARE_REQUEST_TIMEOUT_MS = 30_000;
/**
 * Attesa prima di ogni controllo dello stato della lettura. Nella verifica reale del 2026-09-30, con un controllo ogni
 * 10 s (tutto il ritmo che il piano gratuito concede), la lettura si è fermata dopo la prima pagina con due pagine in
 * coda fino all'annullamento. Controlli più radi lasciano il ritmo del piano alla lettura, se è lo stesso (ipotesi da
 * confermare con una seconda lettura reale); il costo è al più mezzo minuto in più per sapere che è finita.
 */
export const CLOUDFLARE_POLL_INTERVAL_MS = 30_000;
/** Attesa massima di una lettura: oltre, la lettura si annulla (pochi minuti bastano per un sito di 10 pagine). */
export const CLOUDFLARE_CRAWL_TIMEOUT_MS = 5 * 60_000;

/**
 * Testo minimo (Markdown senza front matter) della pagina più ricca perché una lettura senza browser valga: sotto, il
 * sito mostra il testo solo con il JavaScript e `readSite` lo rilegge con il browser. Una pagina che regge un
 * profilo ha migliaia di caratteri (verifica reale del 2026-10-02: da 4 042 a 20 102); una pagina che si compone col
 * JavaScript, senza, ha al più titolo e qualche riga.
 */
export const CLOUDFLARE_MIN_PAGE_TEXT_CHARS = 300;

/** Parole del limite giornaliero del piano gratuito, lette da chi mostra l'esito (FLOW E.7, Constraints). */
export const CLOUDFLARE_DAILY_LIMIT_TEXT =
  'Cloudflare ha rifiutato la lettura, superato il limite di browser del piano gratuito (10 minuti al giorno). ' +
  'Riprova domani o passa al piano a pagamento.';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface CloudflareClientOptions {
  accountId: string;
  apiToken: string;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  /** Orologio in millisecondi (default `Date.now`): iniettabile per il ritmo e l'attesa massima della lettura. */
  now?: () => number;
  /** Riga di log per attese e ritentativi (default: nessun log). */
  log?: (message: string) => void;
}

/** Una lettura conclusa: le pagine e i numeri che Cloudflare dichiara. */
export interface CrawlResult {
  id: string;
  total: number | null;
  finished: number | null;
  /** Tempo di browser dichiarato da Cloudflare nel risultato della lettura. */
  browserSeconds: number | null;
  pages: CrawlPage[];
}

/** La lettura del sito che usano i job: in quale modalità ha dato le pagine e, se c'è stata, la prima scartata. */
export interface SiteRead extends CrawlResult {
  /** `false` = senza browser (solo l'HTML iniziale); `true` = con il browser. */
  render: boolean;
  /** La lettura senza browser scartata perché quasi vuota, quando le pagine vengono dalla seconda con il browser. */
  withoutBrowser: CrawlResult | null;
}

export interface CloudflareClient {
  /**
   * Lettura del sito dei job (decisione dell'utente del 2026-10-02, dopo A8): **senza browser**, che sul piano
   * gratuito segue i link e non consuma tempo di browser; **con il browser** solo se nessuna pagina arriva con
   * almeno `CLOUDFLARE_MIN_PAGE_TEXT_CHARS` caratteri di testo (il sito si compone con il JavaScript). La seconda
   * lettura costa un'altra delle 5 letture del giorno e, sul gratuito, legge solo la pagina iniziale. Gli errori della
   * prima lettura non fanno tentare la seconda.
   */
  readSite(input: Omit<CrawlInput, 'render'>): Promise<SiteRead>;
  /**
   * Lettura completa: avvio, stato ogni `CLOUDFLARE_POLL_INTERVAL_MS` fino alla fine, tutte le pagine. Oltre
   * `CLOUDFLARE_CRAWL_TIMEOUT_MS` annulla la lettura e fallisce dicendo fin dove era arrivata.
   */
  crawl(input: CrawlInput): Promise<CrawlResult>;
  /**
   * `requests` conta ogni tentativo HTTP; `browserMs` somma l'header `X-Browser-Ms-Used`, il consumo che
   * Cloudflare dichiara risposta per risposta.
   */
  readonly stats: { readonly requests: number; readonly browserMs: number };
}

/** Base degli errori Cloudflare: `op` è l'operazione, `status` lo stato HTTP se c'è stata una risposta. */
export class CloudflareError extends Error {
  readonly op: CloudflareOp;
  readonly status: number | undefined;
  constructor(message: string, op: CloudflareOp, status?: number) {
    super(message);
    this.name = new.target.name;
    this.op = op;
    this.status = status;
  }
}

/** Credenziali mancanti o rifiutate: il messaggio è `config:` e nomina la variabile da sistemare. */
export class CloudflareConfigError extends CloudflareError {}

/** Limite del piano (browser del giorno, richieste troppo fitte, lettura interrotta per i limiti). */
export class CloudflareLimitError extends CloudflareError {}

/** Errore del servizio o del sito: HTTP ≥ 400 non di credenziali né di limite, rete, risposta non valida. */
export class CloudflareProviderError extends CloudflareError {}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function buildCloudflareUrl(accountId: string, request: CloudflareRequest): string {
  const query = Object.entries(request.query ?? {})
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
  const path = request.path.replace(/^\/+/, '');
  return `${CLOUDFLARE_API_BASE_URL}accounts/${encodeURIComponent(accountId)}/${path}${query ? `?${query}` : ''}`;
}

/** Il primo errore dell'involucro di Cloudflare (`errors: [{code, message}]`), mai il corpo intero. */
function firstError(json: unknown): { code: number | undefined; message: string } {
  const first = isRecord(json) && Array.isArray(json.errors) ? json.errors[0] : undefined;
  if (!isRecord(first)) return { code: undefined, message: '' };
  return {
    code: typeof first.code === 'number' ? first.code : undefined,
    message: typeof first.message === 'string' ? shorten(first.message) : '',
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Esito finale di una lettura diverso da `completed`, a parole. */
const CRAWL_STATE_TEXT: Record<string, string> = {
  errored: 'la lettura del sito è fallita lato Cloudflare',
  cancelled_by_user: 'la lettura del sito è stata annullata',
  cancelled_due_to_timeout: 'la lettura del sito è stata annullata da Cloudflare per il tempo massimo',
};

/** Caratteri di testo di una pagina letta, senza il front matter (titolo e meta) che Cloudflare mette in testa. */
function textChars(page: CrawlPage): number {
  if (page.status !== 'completed' || page.markdown === null) return 0;
  return page.markdown.replace(/^---\n[\s\S]*?\n---\n?/, '').trim().length;
}

/** Fin dove era arrivata una lettura rimasta in corso: pagine lette e ancora in coda (vuoto se Cloudflare non lo dice). */
function progressText(pages: CrawlPage[]): string {
  const read = pages.filter((p) => p.status === 'completed').length;
  const queued = pages.filter((p) => p.status === 'queued').length;
  if (read + queued === 0) return '';
  return ` (${read === 1 ? '1 pagina letta' : `${read} pagine lette`}, ${queued} ancora in coda)`;
}

export function createCloudflareClient(options: CloudflareClientOptions): CloudflareClient {
  const accountId = options.accountId.trim();
  const apiToken = options.apiToken.trim();
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const log = options.log ?? (() => {});
  const stats = { requests: 0, browserMs: 0 };
  /** Istante dell'ultima richiesta partita: la prossima parte non prima di `CLOUDFLARE_REQUEST_INTERVAL_MS` dopo. */
  let lastRequestAt: number | undefined;
  const untilNextSlot = () => (lastRequestAt === undefined ? 0 : lastRequestAt + CLOUDFLARE_REQUEST_INTERVAL_MS - now());

  // Qualunque testo proveniente dall'esterno passa da qui: il token non finisce mai in un messaggio (A7).
  const redact = (text: string) => (apiToken === '' ? text : text.split(apiToken).join('[token nascosto]'));

  function assertCredentials(op: CloudflareOp): void {
    if (accountId === '') throw new CloudflareConfigError('config: CLOUDFLARE_ACCOUNT_ID mancante nel .env', op);
    if (apiToken === '') throw new CloudflareConfigError('config: CLOUDFLARE_API_TOKEN mancante nel .env', op);
  }

  /** Errore di una risposta ≥ 400 che non è un 429 da ritentare. */
  function httpFailure(op: CloudflareOp, status: number, json: unknown): CloudflareError {
    const { code, message } = firstError(json);
    if (status === 401) {
      return new CloudflareConfigError(
        'config: Cloudflare ha rifiutato le credenziali (401). Verifica CLOUDFLARE_API_TOKEN nel .env.',
        op,
        401,
      );
    }
    if (status === 403) {
      return new CloudflareConfigError(
        'config: il token Cloudflare non ha il permesso «Browser Rendering - Edit» su questo account (403). ' +
          'Verifica CLOUDFLARE_API_TOKEN e CLOUDFLARE_ACCOUNT_ID nel .env.',
        op,
        403,
      );
    }
    // 7003: "Could not route to /accounts/…": l'identificativo dell'account non esiste.
    if (code === 7003 || /could not route/i.test(message)) {
      return new CloudflareConfigError(
        `config: Cloudflare non riconosce l'account (HTTP ${status}). Verifica CLOUDFLARE_ACCOUNT_ID nel .env.`,
        op,
        status,
      );
    }
    if (status === 400 && /content-signal/i.test(message)) {
      return new CloudflareProviderError(
        `actor:cloudflare:${op}: il sito non consente la lettura per un'elaborazione AI (direttive Content-Signal del suo robots.txt).`,
        op,
        400,
      );
    }
    return new CloudflareProviderError(redact(`actor:cloudflare:${op}: HTTP ${status}${message ? ` (${message})` : ''}`), op, status);
  }

  async function send(request: CloudflareRequest): Promise<unknown> {
    const { op } = request;
    assertCredentials(op);
    const doFetch: FetchLike = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
    const url = buildCloudflareUrl(accountId, request);

    for (let attempt = 1; ; attempt++) {
      const wait = untilNextSlot();
      if (wait > 0) await sleep(wait);
      lastRequestAt = now();
      let res: Response;
      stats.requests++;
      try {
        res = await doFetch(url, {
          method: request.method,
          headers: {
            Authorization: `Bearer ${apiToken}`,
            Accept: 'application/json',
            ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
          signal: AbortSignal.timeout(CLOUDFLARE_REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        throw new CloudflareProviderError(
          redact(`actor:cloudflare:${op}: errore di rete (${networkReason(err, CLOUDFLARE_REQUEST_TIMEOUT_MS)})`),
          op,
        );
      }

      const used = Number(res.headers.get('x-browser-ms-used'));
      if (Number.isFinite(used) && used > 0) stats.browserMs += used;
      const json = parseJson(await res.text().catch(() => ''));

      if (res.status === 429) {
        const { message } = firstError(json);
        // Tempo di browser del giorno finito: fino al giorno dopo (UTC) ogni tentativo riceverebbe un 429.
        if (/time limit exceeded/i.test(message)) {
          throw new CloudflareLimitError(`actor:cloudflare:${op}: ${CLOUDFLARE_DAILY_LIMIT_TEXT}`, op, 429);
        }
        if (attempt >= CLOUDFLARE_MAX_ATTEMPTS) {
          throw new CloudflareLimitError(
            redact(
              `actor:cloudflare:${op}: Cloudflare ha rifiutato la lettura, troppe richieste per il piano ` +
                `(${attempt} tentativi${message ? `: ${message}` : ''}). Riprova tra qualche minuto.`,
            ),
            op,
            429,
          );
        }
        // Quanto chiede `retry-after` (al più 60 s), mai meno dell'intervallo del piano.
        const asked = Math.min(retryAfterMs(res.headers.get('retry-after'), now()) ?? 0, CLOUDFLARE_RETRY_MAX_WAIT_MS);
        const waitMs = Math.max(asked, untilNextSlot());
        const next = `tentativo ${attempt} di ${CLOUDFLARE_MAX_ATTEMPTS}`;
        log(`Cloudflare · 429 su ${op}: nuovo tentativo tra ${Math.ceil(waitMs / 1000)} s (${next})`);
        await sleep(waitMs);
        continue;
      }
      if (res.status >= 400) throw httpFailure(op, res.status, json);
      if (!isRecord(json) || json.success !== true) {
        const { message } = firstError(json);
        throw new CloudflareProviderError(
          redact(`actor:cloudflare:${op}: risposta non valida${message ? ` (${message})` : ''}`),
          op,
          res.status,
        );
      }
      return json.result;
    }
  }

  async function startCrawl(input: CrawlInput): Promise<string> {
    const result = await send(startCrawlRequest(input));
    if (typeof result !== 'string' || result === '') {
      throw new CloudflareProviderError("actor:cloudflare:crawl: risposta non valida (manca l'id della lettura)", 'crawl');
    }
    return result;
  }

  const crawlStatus = async (jobId: string, cursor?: string | number): Promise<CrawlStatus> =>
    mapCrawlStatus(await send(crawlStatusRequest(jobId, cursor)));

  async function crawl(input: CrawlInput): Promise<CrawlResult> {
    const id = await startCrawl(input);
    const deadline = now() + CLOUDFLARE_CRAWL_TIMEOUT_MS;
    // Lo stato porta già le pagine lette (fino a 10 MB): quando la lettura è finita non serve una richiesta in più.
    const nextStatus = async () => {
      await sleep(CLOUDFLARE_POLL_INTERVAL_MS);
      return crawlStatus(id);
    };
    let status = await nextStatus();
    while (status.status === 'running') {
      if (now() >= deadline) {
        // Annullare è una cortesia verso il consumo: se fallisce, per il CRM la lettura resta comunque senza esito.
        await send(cancelCrawlRequest(id)).catch(() => {});
        const minutes = CLOUDFLARE_CRAWL_TIMEOUT_MS / 60_000;
        throw new CloudflareProviderError(
          `actor:cloudflare:crawl: la lettura del sito non è finita entro ${minutes} minuti${progressText(status.pages)} ` +
            'ed è stata annullata.',
          'crawl',
        );
      }
      status = await nextStatus();
    }
    if (status.status === 'cancelled_due_to_limits') {
      throw new CloudflareLimitError(
        'actor:cloudflare:crawl: Cloudflare ha interrotto la lettura per i limiti del piano (sul gratuito: 10 minuti ' +
          'di browser e 5 letture al giorno). Riprova domani o passa al piano a pagamento.',
        'crawl',
      );
    }
    if (status.status !== 'completed') {
      const text = CRAWL_STATE_TEXT[status.status] ?? `la lettura del sito si è chiusa con uno stato inatteso (${status.status})`;
      throw new CloudflareProviderError(`actor:cloudflare:crawl: ${text}.`, 'crawl');
    }

    // Oltre 10 MB le pagine arrivano a blocchi: il `cursor` c'è finché ne restano.
    const pages = [...status.pages];
    let page = status;
    while (page.cursor !== null && page.pages.length > 0) {
      page = await crawlStatus(id, page.cursor);
      pages.push(...page.pages);
    }
    return { id, total: status.total, finished: status.finished, browserSeconds: status.browserSeconds, pages };
  }

  async function readSite(input: Omit<CrawlInput, 'render'>): Promise<SiteRead> {
    const html = await crawl({ ...input, render: false });
    if (html.pages.some((page) => textChars(page) >= CLOUDFLARE_MIN_PAGE_TEXT_CHARS)) {
      return { ...html, render: false, withoutBrowser: null };
    }
    log(
      `Cloudflare · senza browser il sito è quasi vuoto (meno di ${CLOUDFLARE_MIN_PAGE_TEXT_CHARS} caratteri per pagina): ` +
        'nuova lettura con il browser',
    );
    return { ...(await crawl({ ...input, render: true })), render: true, withoutBrowser: html };
  }

  return { crawl, readSite, stats };
}
