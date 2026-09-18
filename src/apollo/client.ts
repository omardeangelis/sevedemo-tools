/**
 * Client HTTP Apollo (apollo-lookalike T3). Esegue le richieste costruite in `requests.ts` (unico punto dei
 * path e dei body) e traduce gli esiti negli errori attribuiti del dominio (SPEC D13):
 *
 * - 401 → `ApolloConfigError` `config: chiave Apollo rifiutata (401)…`
 * - 403 → `ApolloConfigError` `config: la chiave Apollo non ha i permessi per <op>…`
 * - 429 → attende `retry-after` e ritenta; oltre `APOLLO_MAX_ATTEMPTS` → `ApolloRateLimitError`
 *   `actor:apollo:<op>: limite di richieste raggiunto (…)` (i job lo trattano come esito parziale, D12)
 * - ritmo proattivo per operazione: i limiti di Apollo sono per endpoint e bassi (smoke reale 2026-09-17:
 *   `bulk_enrich`/`bulk_match` 20/min, 100/ora, 600/24 h; ricerche 50/200/600). Dopo ogni risposta il client
 *   legge `x-{minute,hourly,24-hour}-requests-left`; prima di una richiesta, minuto esaurito → attende la fine
 *   della finestra; ora o giorno esauriti → `ApolloRateLimitError` subito, senza chiamare né attendere
 * - altri ≥ 400, errore di rete, JSON non valido → `ApolloProviderError` `actor:apollo:<op>: …`
 *
 * Il client non logga nulla, non mette mai nei messaggi la chiave né i body (dati personali) e non esegue
 * nulla all'import. `fetch` e `sleep` sono iniettabili: i test non chiamano mai Apollo.
 */
import type { ApolloOp, ApolloQueryValue, ApolloRequest } from './requests.js';

export const APOLLO_API_BASE_URL = 'https://api.apollo.io/api/v1/';

/**
 * Tentativi HTTP TOTALI per richiesta quando Apollo risponde 429: 1 tentativo iniziale + 2 ritentativi.
 * Al terzo 429 consecutivo la richiesta fallisce con `ApolloRateLimitError`.
 */
export const APOLLO_MAX_ATTEMPTS = 3;
/** Attesa massima prima di un ritentativo, anche se `retry-after` chiede di più (es. 3600 s → 60 s). */
export const APOLLO_RETRY_MAX_WAIT_MS = 60_000;
/** Attesa prima di un ritentativo quando il 429 non ha un `retry-after` leggibile. */
export const APOLLO_RETRY_DEFAULT_WAIT_MS = 5_000;
/** Timeout di ogni singola richiesta HTTP: oltre, errore di rete (non ritentato). */
export const APOLLO_REQUEST_TIMEOUT_MS = 30_000;
/**
 * Finestre dei limiti Apollo. Minuto esaurito → si attende fino a `APOLLO_MINUTE_WINDOW_MS` dalla risposta che
 * lo ha segnalato. Ora/giorno esauriti → rifiuto immediato finché il dato è più recente della finestra; dopo,
 * il dato è considerato vecchio e si torna a chiamare Apollo (che risponderà con header aggiornati).
 */
export const APOLLO_MINUTE_WINDOW_MS = 60_000;
export const APOLLO_HOUR_WINDOW_MS = 3_600_000;
export const APOLLO_DAY_WINDOW_MS = 86_400_000;

/** Lunghezza massima dell'estratto del messaggio d'errore di Apollo riportato negli errori. */
const EXCERPT_MAX = 160;

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ApolloClientOptions {
  apiKey: string;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  /** Orologio in millisecondi (default `Date.now`): iniettabile nei test del ritmo. */
  now?: () => number;
}

/**
 * Ultimi limiti noti di un'operazione, dagli header dell'ultima risposta che li riportava: `minute`/`hourly`/
 * `daily` = limite della finestra (`x-rate-limit-*`), `*Left` = richieste rimaste (`x-*-requests-left`).
 * Un campo assente = header mai visto o illeggibile.
 */
export interface ApolloRateLimits {
  minute?: number;
  hourly?: number;
  daily?: number;
  minuteLeft?: number;
  hourlyLeft?: number;
  dailyLeft?: number;
}

export interface ApolloClient {
  /** Esegue la richiesta e ritorna il JSON della risposta (da leggere con i mapper tolleranti). */
  post(request: ApolloRequest): Promise<unknown>;
  /** `requests` conta ogni tentativo HTTP effettuato, ritentativi compresi. */
  readonly stats: { readonly requests: number };
  /** Copia degli ultimi limiti noti per l'operazione; `undefined` se nessuna risposta li ha mai riportati. */
  limits(op: ApolloOp): ApolloRateLimits | undefined;
}

/** Finestra esaurita che ha causato un `ApolloRateLimitError` proattivo (assente = 429 oltre i tentativi). */
export type ApolloRateLimitWindow = 'hourly' | 'daily';

/** Base degli errori Apollo: `op` è l'operazione, `status` lo stato HTTP se c'è stata una risposta. */
export class ApolloError extends Error {
  readonly op: ApolloOp;
  readonly status: number | undefined;
  constructor(message: string, op: ApolloOp, status?: number) {
    super(message);
    this.name = new.target.name;
    this.op = op;
    this.status = status;
  }
}

/** Chiave mancante, rifiutata (401) o senza permessi (403): il job fallisce con `config:`. */
export class ApolloConfigError extends ApolloError {}

/**
 * 429 oltre i tentativi, o limite orario/giornaliero esaurito (`window`, senza chiamata): i job chiudono con
 * esito parziale se hanno già salvato qualcosa (D12). `status` è 429 solo se l'ultima risposta era un 429.
 */
export class ApolloRateLimitError extends ApolloError {
  readonly attempts: number;
  readonly window: ApolloRateLimitWindow | undefined;
  constructor(message: string, op: ApolloOp, attempts: number, window?: ApolloRateLimitWindow, status?: number) {
    super(message, op, window === undefined ? 429 : status);
    this.attempts = attempts;
    this.window = window;
  }
}

/** Errore del provider: HTTP ≥ 400 (non 401/403/429), rete, timeout o risposta non JSON. */
export class ApolloProviderError extends ApolloError {}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Querystring con le liste nella forma `chiave[]=v` (quella documentata da Apollo). */
export function buildApolloUrl(request: ApolloRequest): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(request.query ?? {}) as [string, ApolloQueryValue][]) {
    if (Array.isArray(value)) {
      for (const item of value) parts.push(`${encodeURIComponent(key)}[]=${encodeURIComponent(item)}`);
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  const path = request.path.replace(/^\/+/, '');
  return `${APOLLO_API_BASE_URL}${path}${parts.length > 0 ? `?${parts.join('&')}` : ''}`;
}

/**
 * Millisecondi da attendere secondo `retry-after` (secondi o data HTTP), limitati a
 * `APOLLO_RETRY_MAX_WAIT_MS`; header assente o illeggibile → `APOLLO_RETRY_DEFAULT_WAIT_MS`.
 */
function retryWaitMs(header: string | null, now: number): number {
  const raw = header?.trim() ?? '';
  let ms: number | undefined;
  if (/^\d+(?:\.\d+)?$/.test(raw)) ms = Number(raw) * 1000;
  else if (raw !== '') {
    const at = Date.parse(raw);
    if (!Number.isNaN(at)) ms = Math.max(0, at - now);
  }
  return Math.min(ms ?? APOLLO_RETRY_DEFAULT_WAIT_MS, APOLLO_RETRY_MAX_WAIT_MS);
}

/** Header di rate limit letti per operazione → campo di `ApolloRateLimits`. */
const RATE_HEADERS: ReadonlyArray<[header: string, field: keyof ApolloRateLimits]> = [
  ['x-rate-limit-minute', 'minute'],
  ['x-rate-limit-hourly', 'hourly'],
  ['x-rate-limit-24-hour', 'daily'],
  ['x-minute-requests-left', 'minuteLeft'],
  ['x-hourly-requests-left', 'hourlyLeft'],
  ['x-24-hour-requests-left', 'dailyLeft'],
];

/** Stato interno per operazione: valori e istante (ms) in cui ciascun valore è stato letto. */
interface OpRateState {
  values: ApolloRateLimits;
  seenAt: Partial<Record<keyof ApolloRateLimits, number>>;
}

function parseCount(header: string | null): number | undefined {
  const raw = header?.trim() ?? '';
  return /^\d+$/.test(raw) ? Number(raw) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function shorten(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > EXCERPT_MAX ? `${flat.slice(0, EXCERPT_MAX)}…` : flat;
}

/** Estratto breve del messaggio d'errore di Apollo (`error` / `message`), mai il corpo intero. */
function errorExcerpt(text: string): string {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return '';
  }
  if (!isRecord(json)) return '';
  const raw = json.error ?? json.message ?? json.error_message;
  return typeof raw === 'string' ? shorten(raw) : '';
}

function networkReason(err: unknown): string {
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return `timeout dopo ${APOLLO_REQUEST_TIMEOUT_MS / 1000} s`;
  }
  const message = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error && isRecord(err.cause) && typeof err.cause.code === 'string' ? err.cause.code : '';
  return shorten(cause && !message.includes(cause) ? `${message}: ${cause}` : message);
}

export function createApolloClient(options: ApolloClientOptions): ApolloClient {
  const apiKey = options.apiKey.trim();
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const stats = { requests: 0 };
  const rates = new Map<ApolloOp, OpRateState>();

  // Qualunque testo proveniente dall'esterno passa da qui: la chiave non finisce mai in un messaggio.
  const redact = (text: string) => (apiKey === '' ? text : text.split(apiKey).join('[chiave nascosta]'));

  /** Registra gli header di rate limit leggibili; quelli assenti o illeggibili lasciano il valore precedente. */
  function recordRates(op: ApolloOp, headers: Headers): void {
    const at = now();
    for (const [header, field] of RATE_HEADERS) {
      const value = parseCount(headers.get(header));
      if (value === undefined) continue;
      const state = rates.get(op) ?? { values: {}, seenAt: {} };
      state.values[field] = value;
      state.seenAt[field] = at;
      rates.set(op, state);
    }
  }

  /** Vero se `field` vale 0 ed è stato letto da meno di `windowMs`. */
  function exhausted(state: OpRateState, field: 'hourlyLeft' | 'dailyLeft', windowMs: number): boolean {
    const seenAt = state.seenAt[field];
    return state.values[field] === 0 && seenAt !== undefined && now() - seenAt < windowMs;
  }

  /** Giorno/ora esauriti per l'operazione → `ApolloRateLimitError` immediato (nessuna attesa, nessuna chiamata). */
  function assertWindows(op: ApolloOp, attemptsDone: number, lastStatus: number | undefined): void {
    const state = rates.get(op);
    if (!state) return;
    const windows = [
      ['daily', 'dailyLeft', APOLLO_DAY_WINDOW_MS, 'giornaliero', state.values.daily, '24 ore'],
      ['hourly', 'hourlyLeft', APOLLO_HOUR_WINDOW_MS, 'orario', state.values.hourly, 'ora'],
    ] as const;
    for (const [window, field, windowMs, label, limit, unit] of windows) {
      if (!exhausted(state, field, windowMs)) continue;
      const detail = limit === undefined ? '' : ` (${limit} richieste/${unit})`;
      throw new ApolloRateLimitError(
        `actor:apollo:${op}: limite ${label} di Apollo esaurito${detail}: riprova più tardi`,
        op,
        attemptsDone,
        window,
        lastStatus,
      );
    }
  }

  /** Minuto esaurito → attesa fino a `APOLLO_MINUTE_WINDOW_MS` dalla risposta che lo ha segnalato, meno il trascorso. */
  async function waitMinuteWindow(op: ApolloOp): Promise<void> {
    const state = rates.get(op);
    const seenAt = state?.seenAt.minuteLeft;
    if (state?.values.minuteLeft !== 0 || seenAt === undefined) return;
    const wait = Math.min(APOLLO_MINUTE_WINDOW_MS, APOLLO_MINUTE_WINDOW_MS - (now() - seenAt));
    if (wait > 0) await sleep(wait);
  }

  async function post(request: ApolloRequest): Promise<unknown> {
    const { op } = request;
    if (apiKey === '') throw new ApolloConfigError('config: APOLLO_API_KEY mancante nel .env', op);
    const doFetch: FetchLike = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
    const url = buildApolloUrl(request);
    let lastStatus: number | undefined;

    for (let attempt = 1; ; attempt++) {
      assertWindows(op, attempt - 1, lastStatus);
      await waitMinuteWindow(op);
      let res: Response;
      stats.requests++;
      try {
        res = await doFetch(url, {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
            Accept: 'application/json',
          },
          ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
          signal: AbortSignal.timeout(APOLLO_REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        throw new ApolloProviderError(redact(`actor:apollo:${op}: errore di rete (${networkReason(err)})`), op);
      }

      recordRates(op, res.headers);
      lastStatus = res.status;
      const text = await res.text().catch(() => '');

      if (res.status === 429) {
        // Ora o giorno esauriti: inutile attendere `retry-after` e ritentare.
        assertWindows(op, attempt, 429);
        const retryAfter = res.headers.get('retry-after');
        if (attempt >= APOLLO_MAX_ATTEMPTS) {
          const hint = retryAfter ? `; Apollo chiede di attendere ${shorten(retryAfter)} s` : '';
          throw new ApolloRateLimitError(
            redact(`actor:apollo:${op}: limite di richieste raggiunto (${attempt} tentativi${hint})`),
            op,
            attempt,
          );
        }
        await sleep(retryWaitMs(retryAfter, now()));
        continue;
      }
      if (res.status === 401) {
        throw new ApolloConfigError('config: chiave Apollo rifiutata (401). Verifica APOLLO_API_KEY nel .env.', op, 401);
      }
      if (res.status === 403) {
        throw new ApolloConfigError(
          `config: la chiave Apollo non ha i permessi per ${op}: usa una master key o una chiave con il permesso di ` +
            'ricerca persone (Apollo → Settings → API keys).',
          op,
          403,
        );
      }
      if (res.status >= 400) {
        const excerpt = errorExcerpt(text);
        throw new ApolloProviderError(
          redact(`actor:apollo:${op}: HTTP ${res.status}${excerpt ? ` (${excerpt})` : ''}`),
          op,
          res.status,
        );
      }

      try {
        if (text.trim() === '') throw new Error('corpo vuoto');
        return JSON.parse(text) as unknown;
      } catch {
        throw new ApolloProviderError(`actor:apollo:${op}: risposta non valida`, op, res.status);
      }
    }
  }

  function limits(op: ApolloOp): ApolloRateLimits | undefined {
    const state = rates.get(op);
    return state ? { ...state.values } : undefined;
  }

  return { post, stats, limits };
}

/**
 * Client creato alla prima chiamata, con la chiave letta in quel momento (`apiKey()`): per le deps reali dei
 * job, che non chiamano nulla all'import né alla creazione delle deps. La chiave arriva da chi chiama: questo
 * modulo non legge la config.
 */
export function lazyApolloClient(apiKey: () => string): () => ApolloClient {
  let client: ApolloClient | undefined;
  return () => (client ??= createApolloClient({ apiKey: apiKey() }));
}
