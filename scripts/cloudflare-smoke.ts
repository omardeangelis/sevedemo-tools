/**
 * Verifica manuale di Cloudflare Browser Run (own-profile-services T20, SPEC A2, A8, PLAN P-15): la lancia
 * **l'utente**, con conferma esplicita, prima che un job del CRM chiami Cloudflare. Legge il sito **una volta** con
 * il client e le richieste di produzione (`src/cloudflare/{client,requests}.ts`): la verifica prova esattamente ciò
 * che i job invieranno. Riporta pagine lette, forma del contenuto, consumo dichiarato dalla risposta, cosa la
 * lettura dichiara al sito e, se le credenziali non bastano, l'errore leggibile che vedrà anche il CRM.
 *
 *   npm run cloudflare:smoke -- --site https://tuosito.it
 *       → stampa cosa farebbe ed esce con codice 2: nessuna chiamata
 *   npm run cloudflare:smoke -- --site https://tuosito.it --yes
 *       → una lettura reale come quella dei job (`readSite`: senza browser, con il browser solo se le pagine arrivano
 *         quasi vuote), fino a CLOUDFLARE_MAX_PAGES pagine (default 10; --pages N per cambiarle)
 *   … --yes --render | --no-render
 *       → una sola lettura, solo con il browser o solo senza: per confrontare le due modalità
 *
 * Codici di uscita: 0 lettura riuscita; 1 argomenti o credenziali non validi (con --yes) o lettura fallita;
 * 2 manca --yes (nessuna chiamata, qualunque siano gli argomenti).
 *
 * Prima della lettura scarica il `robots.txt` del sito (una richiesta al sito, non a Cloudflare), per confrontare i
 * limiti che il sito espone con ciò che la lettura ha fatto. La risposta grezza finisce in
 * `tests/fixtures/cloudflare/raw/` (ignorata da git: è il testo del sito). Il token non compare mai nell'output.
 * Non dipende da `src/config.ts`; importare questo modulo non esegue nulla.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import {
  CloudflareConfigError,
  createCloudflareClient,
  CLOUDFLARE_CRAWL_TIMEOUT_MS,
  CLOUDFLARE_MIN_PAGE_TEXT_CHARS,
  CLOUDFLARE_POLL_INTERVAL_MS,
  type CrawlResult,
} from '../src/cloudflare/client.js';
import { mapCrawlStatus, type CrawlPage } from '../src/cloudflare/mappers.js';
import { isRecord } from '../src/util/http.js';
import { CRAWL_MAX_PAGES, CRAWL_PURPOSES, startCrawlRequest } from '../src/cloudflare/requests.js';

/** User agent con cui la lettura si presenta al sito (documentazione dell'endpoint, 2026-09-30): non modificabile. */
export const CRAWLER_USER_AGENT = 'CloudflareBrowserRenderingCrawler/1.0';
const DEFAULT_PAGES = 10;
const PREVIEW_CHARS = 300;

export interface SmokeDeps {
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  log: (line: string) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  writeFile: (filePath: string, content: string) => Promise<void>;
  /** Cartella delle risposte grezze (`tests/fixtures/cloudflare/raw/`). */
  rawDir: string;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function realDeps(): SmokeDeps {
  return {
    fetch: globalThis.fetch,
    env: process.env,
    log: (line) => console.log(line),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: Date.now,
    writeFile: async (filePath, content) => {
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, content);
    },
    rawDir: path.join(ROOT, 'tests', 'fixtures', 'cloudflare', 'raw'),
  };
}

// --- Argomenti ---------------------------------------------------------------------------------------

interface CliArgs {
  site?: string;
  pages?: string;
  yes: boolean;
  /** Modalità forzata: `true` solo con il browser, `false` solo senza; assente = come i job (`readSite`). */
  render?: boolean;
  help: boolean;
  problems: string[];
}

function parseCli(argv: string[]): CliArgs {
  const args: CliArgs = { yes: false, help: false, problems: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    const eq = token.indexOf('=');
    const name = token.startsWith('--') && eq > 0 ? token.slice(0, eq) : token;
    const inline = token.startsWith('--') && eq > 0 ? token.slice(eq + 1) : undefined;
    if (name === '--yes' && inline === undefined) args.yes = true;
    else if ((name === '--render' || name === '--no-render') && inline === undefined) {
      const render = name === '--render';
      if (args.render !== undefined && args.render !== render) args.problems.push('--render e --no-render insieme: scegline uno');
      args.render = render;
    }
    else if ((name === '--help' || name === '-h') && inline === undefined) args.help = true;
    else if (name === '--site' || name === '--pages') {
      const value = inline ?? (argv[i + 1]?.startsWith('--') ? undefined : argv[++i]);
      if (value === undefined) args.problems.push(`${name} richiede un valore`);
      else if (name === '--site') args.site = value;
      else args.pages = value;
    } else args.problems.push(`argomento non riconosciuto: ${token}`);
  }
  return args;
}

/** Indirizzo del sito: `acme.it` diventa `https://acme.it/`; solo http e https. */
export function normalizeSiteArg(raw: string): string | undefined {
  const text = raw.trim();
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname.includes('.')) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function pagesArg(raw: string | undefined, problems: string[]): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_PAGES;
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 1 && n <= CRAWL_MAX_PAGES) return n;
  problems.push(`pagine non valide: "${raw}" (atteso un intero tra 1 e ${CRAWL_MAX_PAGES})`);
  return DEFAULT_PAGES;
}

// --- robots.txt --------------------------------------------------------------------------------------

/** Cosa il sito dichiara ai lettori automatici: le righe che contano per questa lettura. */
export interface RobotsSummary {
  found: boolean;
  crawlDelay: string | null;
  contentSignal: string[];
  /** Regole `Disallow` per `*` o per lo user agent di Cloudflare. */
  disallow: string[];
}

/** Lettura minima del `robots.txt`: gruppi che valgono per `*` o per il lettore di Cloudflare. */
export function summarizeRobots(text: string): RobotsSummary {
  const out: RobotsSummary = { found: true, crawlDelay: null, contentSignal: [], disallow: [] };
  let agents: string[] = [];
  let inRules = false;
  const applies = () => agents.some((a) => a === '*' || CRAWLER_USER_AGENT.toLowerCase().startsWith(a));
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === 'user-agent') {
      if (inRules) agents = [];
      inRules = false;
      agents.push(value.toLowerCase());
      continue;
    }
    inRules = true;
    if (!applies()) continue;
    if (key === 'crawl-delay') out.crawlDelay = value;
    else if (key === 'content-signal') out.contentSignal.push(value);
    else if (key === 'disallow' && value !== '') out.disallow.push(value);
  }
  return out;
}

async function readRobots(site: string, deps: SmokeDeps): Promise<RobotsSummary | string> {
  const url = new URL('/robots.txt', site).href;
  try {
    const res = await deps.fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (res.status === 404) return { found: false, crawlDelay: null, contentSignal: [], disallow: [] };
    if (!res.ok) return `HTTP ${res.status}`;
    return summarizeRobots(await res.text());
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

// --- Report ------------------------------------------------------------------------------------------

const PAGE_STATUS_TEXT: Record<string, string> = {
  completed: 'letta',
  disallowed: 'vietata dal robots.txt del sito',
  skipped: 'esclusa dalla configurazione',
  errored: 'errore del sito',
  cancelled: 'annullata',
  queued: 'ancora in coda',
};

/** Le pagine per esito, al singolare e al plurale: il riepilogo conta i record, non il `total` di Cloudflare. */
const PAGE_COUNT_TEXT: Record<string, [string, string]> = {
  completed: ['pagina letta', 'pagine lette'],
  disallowed: ['vietata dal robots.txt del sito', 'vietate dal robots.txt del sito'],
  skipped: ['esclusa dalla configurazione', 'escluse dalla configurazione'],
  errored: ['con errore del sito', 'con errore del sito'],
  cancelled: ['annullata', 'annullate'],
  queued: ['rimasta in coda, non letta', 'rimaste in coda, non lette'],
};

function pageCounts(pages: CrawlPage[]): string {
  const counts = new Map<string, number>();
  for (const page of pages) counts.set(page.status, (counts.get(page.status) ?? 0) + 1);
  if (counts.size === 0) return 'nessuna pagina';
  return [...counts]
    .map(([status, n]) => {
      const [one, many] = PAGE_COUNT_TEXT[status] ?? [status, status];
      return `${n} ${n === 1 ? one : many}`;
    })
    .join(' · ');
}

function pageLine(page: CrawlPage): string {
  const what = PAGE_STATUS_TEXT[page.status] ?? page.status;
  const http = page.httpStatus === null ? '' : ` · HTTP ${page.httpStatus}`;
  const title = page.title ? ` · «${page.title}»` : '';
  const text =
    page.markdown === null
      ? ''
      : ` · ${page.markdown.length} caratteri di Markdown, ${(page.markdown.match(/^#{1,6} /gm) ?? []).length} titoli`;
  return `  - ${page.url} — ${what}${http}${title}${text}`;
}

/** Il `result` di una risposta di stato con le sue pagine, se lo è. */
function crawlResultOf(body: unknown): Record<string, unknown> | undefined {
  const result = isRecord(body) ? body.result : undefined;
  return isRecord(result) && Array.isArray(result.records) ? result : undefined;
}

/**
 * Ogni controllo di una lettura in corso ripete le pagine lette fin lì: nel file ne restano indirizzo e stato (per
 * capire dove una lettura si è fermata), il testo resta solo nelle risposte finali.
 */
function withoutRunningPages<T extends { body: unknown }>(entry: T): T {
  const result = crawlResultOf(entry.body);
  if (result?.status !== 'running') return entry;
  const records = (result.records as unknown[]).map((r) => (isRecord(r) ? { url: r.url, status: r.status } : r));
  return { ...entry, body: { ...(entry.body as object), result: { ...result, records } } };
}

const seconds = (ms: number) => `${(ms / 1000).toLocaleString('it-IT', { maximumFractionDigits: 1 })} s`;

export async function main(argv: string[], deps: SmokeDeps): Promise<number> {
  const cli = parseCli(argv);
  const accountId = deps.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? '';
  const apiToken = deps.env.CLOUDFLARE_API_TOKEN?.trim() ?? '';
  // Il token non compare mai nell'output, nemmeno se Cloudflare lo riecheggia in un errore (A7).
  const log = (line: string) => deps.log(apiToken ? line.split(apiToken).join('[token nascosto]') : line);

  if (cli.help) {
    log('Uso: npm run cloudflare:smoke -- --site <indirizzo del sito> [--pages N] [--render | --no-render] [--yes]');
    log('Senza --yes stampa cosa farebbe ed esce con codice 2 senza chiamare Cloudflare.');
    return 0;
  }

  const problems = [...cli.problems];
  const site = cli.site === undefined ? undefined : normalizeSiteArg(cli.site);
  if (cli.site === undefined) problems.push('manca --site <indirizzo> (es. --site https://tuosito.it)');
  else if (!site) problems.push(`--site non valido: "${cli.site}" (atteso un indirizzo come https://tuosito.it)`);
  const pages = pagesArg(cli.pages ?? deps.env.CLOUDFLARE_MAX_PAGES, problems);
  if (!accountId) problems.push('CLOUDFLARE_ACCOUNT_ID mancante nel .env');
  if (!apiToken) problems.push('CLOUDFLARE_API_TOKEN mancante nel .env');

  log('Verifica manuale di Cloudflare Browser Run');
  log(`  Sito: ${site ?? '(da indicare con --site)'} · fino a ${pages} pagine`);
  log(
    cli.render === undefined
      ? '  Modalità: come la generazione del profilo, senza browser (solo l\'HTML iniziale); con il browser solo se le ' +
          'pagine arrivano quasi vuote.'
      : cli.render
        ? '  Modalità: solo con il browser (--render), JavaScript del sito eseguito.'
        : '  Modalità: solo senza browser (--no-render), solo l\'HTML iniziale: il JavaScript del sito non viene eseguito.',
  );
  const tokenState = apiToken ? 'presente (non viene mai stampato)' : 'MANCANTE';
  log(`  Credenziali: CLOUDFLARE_ACCOUNT_ID ${accountId ? 'presente' : 'MANCANTE'} · CLOUDFLARE_API_TOKEN ${tokenState}`);
  log(
    '  Chiamate previste: 1 lettura del robots.txt del sito, poi 1 avvio della lettura su Cloudflare e un controllo ' +
      `dello stato ogni ${CLOUDFLARE_POLL_INTERVAL_MS / 1000} s`,
  );
  log(`  fino alla fine (al massimo ${CLOUDFLARE_CRAWL_TIMEOUT_MS / 60_000} minuti, poi la lettura si annulla).`);
  log(
    cli.render === undefined
      ? '  Costo: nessuno in denaro; senza browser niente tempo di browser (gratuita durante la beta); 1 delle 5 letture ' +
          'al giorno, 2 se serve la seconda con il browser.'
      : cli.render
        ? '  Costo: nessuno in denaro sul piano gratuito; consuma tempo di browser (10 minuti al giorno) e 1 delle 5 letture al giorno.'
        : '  Costo: nessuno in denaro (gratuita durante la beta); niente tempo di browser; 1 delle 5 letture al giorno.',
  );
  if (problems.length > 0) {
    log('Da correggere prima di eseguire:');
    for (const p of problems) log(`  - ${p}`);
  }

  if (!cli.yes) {
    log('Nessuna chiamata eseguita. Per eseguire davvero ripeti il comando aggiungendo --yes.');
    return 2;
  }
  if (problems.length > 0 || !site) {
    log('Nessuna chiamata eseguita.');
    return 1;
  }

  log('');
  const robots = await readRobots(site, deps);
  if (typeof robots === 'string') log(`robots.txt del sito: non letto (${robots}).`);
  else if (!robots.found) log('robots.txt del sito: assente (nessun limite dichiarato: Cloudflare attende comunque 0,5 s tra due pagine).');
  else {
    log('robots.txt del sito (regole per tutti o per il lettore di Cloudflare):');
    log(`  - Crawl-delay: ${robots.crawlDelay ?? 'non indicato (Cloudflare attende 0,5 s tra due pagine)'}`);
    log(`  - Content-Signal: ${robots.contentSignal.length > 0 ? robots.contentSignal.join(' · ') : 'non indicato'}`);
    log(`  - Disallow: ${robots.disallow.length > 0 ? robots.disallow.join(' · ') : 'nessuno'}`);
  }

  const input = { url: site, maxPages: pages };
  const request = startCrawlRequest({ ...input, render: cli.render ?? false });
  log('');
  log('Cosa la lettura dichiara al sito:');
  log(`  - user agent ${CRAWLER_USER_AGENT} (fisso, lo sceglie Cloudflare)`);
  log(`  - scopo: ${CRAWL_PURPOSES.join(', ')} (input per un'elaborazione AI; Cloudflare lo confronta con il Content-Signal del sito)`);
  log(`  - richiesta inviata: ${request.method} accounts/<account>/${request.path} ${JSON.stringify(request.body)}`);
  if (cli.render === undefined) log('    (la seconda lettura, se serve, è la stessa con "render": true)');

  // Registra le risposte grezze (mai le intestazioni della richiesta: portano il token).
  const raw: Array<{ method: string; path: string; status: number; browser_ms_used: string | null; body: unknown }> = [];
  const client = createCloudflareClient({
    accountId,
    apiToken,
    sleep: deps.sleep,
    now: deps.now,
    log: (line) => log(`  ${line}`),
    fetch: async (url, init) => {
      const res = await deps.fetch(url, init);
      const text = await res.clone().text().catch(() => '');
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        // resta testo
      }
      raw.push({
        method: init.method ?? 'GET',
        path: new URL(url).pathname.replace(`/accounts/${accountId}/`, '/accounts/<account>/'),
        status: res.status,
        browser_ms_used: res.headers.get('x-browser-ms-used'),
        body,
      });
      return res;
    },
  });

  log('');
  log('Lettura in corso…');
  const startedAt = deps.now();
  let exitCode = 0;
  try {
    const result: CrawlResult & { withoutBrowser?: CrawlResult | null } =
      cli.render === undefined ? await client.readSite(input) : await client.crawl({ ...input, render: cli.render });
    if (result.withoutBrowser) {
      log(
        `Lettura senza browser ${result.withoutBrowser.id}: ${pageCounts(result.withoutBrowser.pages)}; nessuna pagina ` +
          `con almeno ${CLOUDFLARE_MIN_PAGE_TEXT_CHARS} caratteri di testo, quindi riletta con il browser.`,
      );
      for (const page of result.withoutBrowser.pages) log(pageLine(page));
    }
    const read = result.pages.filter((p) => p.status === 'completed' && p.markdown !== null);
    const mode = cli.render === undefined ? (result.withoutBrowser ? ' (con il browser)' : ' (senza browser)') : '';
    log(`Lettura ${result.id}${mode} conclusa in ${seconds(deps.now() - startedAt)}: ${pageCounts(result.pages)}.`);
    for (const page of result.pages) log(pageLine(page));
    if (result.pages.some((p) => p.status === 'queued')) {
      log('  Cloudflare ha dichiarato la lettura conclusa con pagine ancora in coda: quelle pagine non sono state lette.');
    }
    const first = read[0];
    if (first?.markdown) {
      log('');
      log(`Forma del contenuto (prima pagina, primi ${PREVIEW_CHARS} caratteri):`);
      for (const line of first.markdown.slice(0, PREVIEW_CHARS).split('\n')) log(`  | ${line}`);
    }
    log('');
    log('Consumo dichiarato da Cloudflare:');
    const declared = result.browserSeconds === null ? 'non riportato' : seconds(result.browserSeconds * 1000);
    const summed = client.stats.browserMs > 0 ? seconds(client.stats.browserMs) : 'non riportato';
    log(`  - tempo di browser nel risultato (browserSecondsUsed): ${declared}`);
    log(`  - somma dell'header X-Browser-Ms-Used: ${summed} su ${client.stats.requests} richieste`);
    log(
      '  Confrontalo con la dashboard Cloudflare (Browser Rendering) e con il limite del piano gratuito di 10 minuti ' +
        'al giorno.',
    );
  } catch (err) {
    exitCode = 1;
    log('');
    log(`Lettura FALLITA: ${(err as Error).message}`);
    log('È lo stesso messaggio che il CRM mostrerà nell\'esito della generazione del profilo.');
    if (err instanceof CloudflareConfigError) {
      log('Il token serve con il permesso «Browser Rendering - Edit» (Cloudflare → My Profile → API Tokens) sull\'account indicato.');
    }
    const last = raw.map((r) => crawlResultOf(r.body)).filter((r) => r !== undefined).at(-1);
    const seen = last === undefined ? [] : mapCrawlStatus(last).pages;
    if (seen.length > 0) {
      log(`Ultimo stato visto da Cloudflare (${String(last?.status)}):`);
      for (const page of seen) log(pageLine(page));
    }
  }

  if (raw.length > 0) {
    const file = path.join(deps.rawDir, `crawl-${new Date(startedAt).toISOString().replace(/[:.]/g, '-')}.json`);
    await deps.writeFile(file, `${JSON.stringify(raw.map(withoutRunningPages), null, 2)}\n`);
    log(`Risposte grezze salvate in ${path.relative(ROOT, file)} (ignorata da git: contiene il testo del sito).`);
  }
  log('Riporta pagine lette, consumo ed eventuali scostamenti nel log di T20 (PLAN) e nel README.');
  return exitCode;
}

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(path.resolve(entry));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  loadDotenv({ path: path.join(ROOT, '.env'), quiet: true });
  process.exitCode = await main(process.argv.slice(2), realDeps());
}
