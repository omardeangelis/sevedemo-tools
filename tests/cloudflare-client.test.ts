import { describe, expect, it } from 'vitest';

// Client Cloudflare Browser Run (own-profile-services T20, SPEC A2, A7, A8): `fetch` e `sleep` sempre iniettati.
// Nessuna chiamata di rete.
const {
  createCloudflareClient,
  CLOUDFLARE_DAILY_LIMIT_TEXT,
  CLOUDFLARE_MAX_ATTEMPTS,
  CLOUDFLARE_POLL_INTERVAL_MS,
  CLOUDFLARE_REQUEST_INTERVAL_MS,
} = await import('../src/cloudflare/client.js');
const { startCrawlRequest, CRAWL_PURPOSES } = await import('../src/cloudflare/requests.js');

const ACCOUNT = '0123456789abcdef0123456789abcdef';
const TOKEN = 'cf-token-segreto-xyz123';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

interface Call {
  url: string;
  init: RequestInit;
}

/**
 * Client con `fetch` finto che risponde in ordine (l'ultima risposta si ripete); `sleep` registra le attese e fa
 * avanzare l'orologio.
 */
function setup(...responses: Array<() => Response>) {
  return setupWith({ accountId: ACCOUNT, apiToken: TOKEN }, ...responses);
}

function setupWith(credentials: { accountId: string; apiToken: string }, ...responses: Array<() => Response>) {
  const calls: Call[] = [];
  const waits: number[] = [];
  const logs: string[] = [];
  const clock = { t: Date.parse('2026-09-30T10:00:00Z') };
  const client = createCloudflareClient({
    ...credentials,
    now: () => clock.t,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return responses[Math.min(calls.length - 1, responses.length - 1)]!();
    },
    sleep: async (ms) => {
      waits.push(ms);
      clock.t += ms;
    },
    log: (line) => logs.push(line),
  });
  return { client, calls, waits, logs };
}

/** L'errore lanciato dalla promessa (il test fallisce se la promessa si risolve). */
async function failure(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }
  throw new Error('la promessa doveva fallire');
}

const authError = { success: false, errors: [{ code: 10000, message: `Authentication error for ${TOKEN}` }], messages: [], result: null };

describe('credenziali', () => {
  it('tdd_target: 401 ⇒ errore attribuito a Cloudflare, leggibile, senza il token', async () => {
    const { client } = setup(() => jsonResponse(401, authError));
    const err = await failure(client.crawl({ url: 'https://officina-fittizia.it', maxPages: 10 }));
    expect(err.message).toBe('config: Cloudflare ha rifiutato le credenziali (401). Verifica CLOUDFLARE_API_TOKEN nel .env.');
    expect(err.message).not.toContain(TOKEN);
  });

  it('403 ⇒ il token non ha il permesso richiesto, a parole e con le variabili da verificare', async () => {
    const { client } = setup(() => jsonResponse(403, authError));
    const err = await failure(client.crawl({ url: 'https://officina-fittizia.it', maxPages: 10 }));
    expect(err.message).toBe(
      'config: il token Cloudflare non ha il permesso «Browser Rendering - Edit» su questo account (403). ' +
        'Verifica CLOUDFLARE_API_TOKEN e CLOUDFLARE_ACCOUNT_ID nel .env.',
    );
  });

  it('senza credenziali il client non chiama: nessuna invocazione del fetch finto (A9)', async () => {
    for (const [credentials, missing] of [
      [{ accountId: '', apiToken: TOKEN }, 'CLOUDFLARE_ACCOUNT_ID'],
      [{ accountId: ACCOUNT, apiToken: '  ' }, 'CLOUDFLARE_API_TOKEN'],
    ] as const) {
      const { client, calls } = setupWith(credentials, () => jsonResponse(200, { success: true, result: 'job-1' }));
      const err = await failure(client.crawl({ url: 'https://officina-fittizia.it', maxPages: 10 }));
      expect(err.message).toBe(`config: ${missing} mancante nel .env`);
      expect(calls).toHaveLength(0);
    }
  });
});

const started = () => jsonResponse(200, { success: true, errors: [], messages: [], result: 'job-1' });
const running = () =>
  jsonResponse(200, { success: true, result: { id: 'job-1', status: 'running', total: 3, finished: 1, records: [] } });
const completed = () =>
  jsonResponse(
    200,
    {
      success: true,
      result: {
        id: 'job-1',
        status: 'completed',
        browserSecondsUsed: 21.4,
        total: 3,
        finished: 3,
        records: [
          {
            url: 'https://officina-fittizia.it/',
            status: 'completed',
            markdown: '# Officina\nSviluppo software su misura.',
            metadata: { status: 200, title: 'Officina', url: 'https://officina-fittizia.it/' },
          },
          {
            url: 'https://officina-fittizia.it/servizi',
            status: 'completed',
            markdown: '## Servizi\nFractional CTO.',
            // Il titolo arriva con le entità dell'HTML del sito (verifica reale del 2026-10-02).
            metadata: { status: 200, title: 'L&#39;offerta &amp; i servizi &#x2014; Officina' },
          },
          { url: 'https://officina-fittizia.it/admin', status: 'disallowed' },
        ],
      },
    },
    { 'X-Browser-Ms-Used': '9000' },
  );

describe('lettura del sito', () => {
  it('lettura riuscita ⇒ pagine e testo mappati, consumo dichiarato, un controllo dello stato ogni 30 s', async () => {
    const { client, calls, waits } = setup(started, running, completed);
    const result = await client.crawl({ url: 'https://officina-fittizia.it', maxPages: 10 });

    expect(result).toEqual({
      id: 'job-1',
      total: 3,
      finished: 3,
      browserSeconds: 21.4,
      pages: [
        {
          url: 'https://officina-fittizia.it/',
          status: 'completed',
          httpStatus: 200,
          title: 'Officina',
          markdown: '# Officina\nSviluppo software su misura.',
        },
        {
          url: 'https://officina-fittizia.it/servizi',
          status: 'completed',
          httpStatus: 200,
          title: "L'offerta & i servizi — Officina",
          markdown: '## Servizi\nFractional CTO.',
        },
        { url: 'https://officina-fittizia.it/admin', status: 'disallowed', httpStatus: null, title: null, markdown: null },
      ],
    });
    expect(client.stats).toEqual({ requests: 3, browserMs: 9000 });
    expect(waits).toEqual([CLOUDFLARE_POLL_INTERVAL_MS, CLOUDFLARE_POLL_INTERVAL_MS]);

    const base = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/browser-run/crawl`;
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([`POST ${base}`, `GET ${base}/job-1`, `GET ${base}/job-1`]);
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual(startCrawlRequest({ url: 'https://officina-fittizia.it', maxPages: 10 }).body);
  });

  it('la richiesta dichiara lo scopo: input di un\'elaborazione AI, solo il sito, testo in Markdown', () => {
    expect(CRAWL_PURPOSES).toEqual(['ai-input']);
    expect(startCrawlRequest({ url: 'https://officina-fittizia.it', maxPages: 10 })).toEqual({
      op: 'crawl',
      method: 'POST',
      path: 'browser-run/crawl',
      body: {
        url: 'https://officina-fittizia.it/',
        limit: 10,
        render: true,
        formats: ['markdown'],
        crawlPurposes: ['ai-input'],
        options: { includeExternalLinks: false, includeSubdomains: false },
      },
    });
    // Senza browser solo su richiesta: solo l'HTML iniziale, niente tempo di browser.
    expect(startCrawlRequest({ url: 'https://officina-fittizia.it', maxPages: 10, render: false }).body).toMatchObject({ render: false });
    expect(() => startCrawlRequest({ url: 'ftp://officina-fittizia.it', maxPages: 10 })).toThrow(/http o https/);
    expect(() => startCrawlRequest({ url: 'https://officina-fittizia.it', maxPages: 101 })).toThrow(/tra 1 e 100/);
  });

  it('il sito vieta la lettura per l\'AI (Content-Signal) ⇒ lo dice a parole, attribuito a Cloudflare', async () => {
    const { client } = setup(() =>
      jsonResponse(400, { success: false, errors: [{ code: 400, message: 'Crawl disallowed by Content-Signal directive (purpose or use level)' }] }),
    );
    const err = await failure(client.crawl({ url: 'https://officina-fittizia.it', maxPages: 10 }));
    expect(err.message).toBe(
      "actor:cloudflare:crawl: il sito non consente la lettura per un'elaborazione AI (direttive Content-Signal del suo robots.txt).",
    );
  });

  it('una lettura che non finisce in tempo si annulla e fallisce dicendo fin dove era arrivata', async () => {
    // Com'era la verifica reale del 2026-09-30: una pagina letta, due in coda, stato fermo.
    const stuck = () =>
      jsonResponse(200, {
        success: true,
        result: {
          id: 'job-1',
          status: 'running',
          total: 3,
          finished: 1,
          skipped: 2,
          records: [
            { url: 'https://officina-fittizia.it/', status: 'completed', markdown: '# Officina' },
            { url: 'https://officina-fittizia.it/servizi', status: 'queued' },
            { url: 'https://officina-fittizia.it/prezzi', status: 'queued' },
            { url: 'https://altro-sito.it/', status: 'skipped' },
          ],
        },
      });
    const { client, calls } = setup(started, stuck);
    const err = await failure(client.crawl({ url: 'https://officina-fittizia.it', maxPages: 10 }));
    expect(err.message).toBe(
      'actor:cloudflare:crawl: la lettura del sito non è finita entro 5 minuti (1 pagina letta, 2 ancora in coda) ed è stata annullata.',
    );
    // Uno stato ogni 30 s per 5 minuti, poi l'annullamento.
    expect(calls.filter((c) => c.init.method === 'GET')).toHaveLength(10);
    expect(calls.at(-1)!.init.method).toBe('DELETE');
    expect(calls.at(-1)!.url).toMatch(/\/browser-run\/crawl\/job-1$/);
  });
});

describe('lettura del sito dei job: senza browser, con il browser solo se quasi vuota', () => {
  const bodyOf = (call: Call) => JSON.parse(call.init.body as string) as Record<string, unknown>;
  const posts = (calls: Call[]) => calls.filter((c) => c.init.method === 'POST');
  /** Una lettura conclusa con le pagine date. */
  const done = (records: unknown[]) => () =>
    jsonResponse(200, { success: true, result: { id: 'job-1', status: 'completed', browserSecondsUsed: 0, records } });
  const shell = {
    url: 'https://officina-fittizia.it/',
    status: 'completed',
    // Com'è senza JavaScript un sito che si compone nel browser: il front matter e poco altro.
    markdown: '---\ntitle: "Officina"\nmeta:\n  description: "Sviluppo software su misura per le PMI, dal 2015."\n---\nAttiva JavaScript.',
    metadata: { status: 200, title: 'Officina' },
  };

  it('tdd_target: sito con testo nell\'HTML ⇒ una sola lettura, senza browser', async () => {
    const services =
      '## Servizi\nSviluppo di prodotti digitali per le PMI: analisi del problema, prototipo in due settimane, ' +
      'rilascio in produzione e manutenzione. Lavoriamo con un prezzo fisso al mese e un referente senior nel team.\n' +
      '## Casi\nUn gestionale per la logistica che ha dimezzato i tempi di inserimento degli ordini; un portale clienti ' +
      'per un consorzio di cantine; una app interna per i turni di un poliambulatorio.';
    const page = { url: 'https://officina-fittizia.it/', status: 'completed', markdown: `${shell.markdown}\n${services}` };
    const { client, calls } = setup(started, done([page, { url: 'https://altro-sito.it/', status: 'skipped' }]));
    const read = await client.readSite({ url: 'https://officina-fittizia.it', maxPages: 10 });
    expect(posts(calls)).toHaveLength(1);
    expect(bodyOf(posts(calls)[0]!)).toMatchObject({ render: false, limit: 10 });
    expect(read).toMatchObject({ render: false, withoutBrowser: null, id: 'job-1' });
    expect(read.pages.map((p) => p.status)).toEqual(['completed', 'skipped']);
  });

  it('pagine quasi vuote senza browser ⇒ seconda lettura con il browser, che dà le pagine; la prima resta per l\'avviso', async () => {
    const { client, calls, logs } = setup(started, done([shell]), started, completed);
    const read = await client.readSite({ url: 'https://officina-fittizia.it', maxPages: 10 });
    expect(posts(calls).map((c) => bodyOf(c).render)).toEqual([false, true]);
    expect(read.render).toBe(true);
    expect(read.pages[0]!.markdown).toBe('# Officina\nSviluppo software su misura.');
    expect(read.withoutBrowser?.pages).toHaveLength(1);
    expect(logs).toEqual([
      'Cloudflare · senza browser il sito è quasi vuoto (meno di 300 caratteri per pagina): nuova lettura con il browser',
    ]);
  });

  it('nessuna pagina letta senza browser ⇒ anche lì la seconda lettura con il browser', async () => {
    const { client, calls } = setup(started, done([{ url: 'https://officina-fittizia.it/', status: 'errored' }]), started, completed);
    const read = await client.readSite({ url: 'https://officina-fittizia.it', maxPages: 10 });
    expect(posts(calls)).toHaveLength(2);
    expect(read.render).toBe(true);
  });

  it('la prima lettura fallisce ⇒ errore, nessuna seconda lettura (una delle 5 del giorno non si spreca)', async () => {
    const limited = () => jsonResponse(200, { success: true, result: { id: 'job-1', status: 'cancelled_due_to_limits', records: [] } });
    const { client, calls } = setup(started, limited, started, completed);
    const err = await failure(client.readSite({ url: 'https://officina-fittizia.it', maxPages: 10 }));
    expect(err.message).toMatch(/^actor:cloudflare:crawl: Cloudflare ha interrotto la lettura per i limiti del piano/);
    expect(posts(calls)).toHaveLength(1);
  });
});

describe('limiti del piano (Constraints: parole, non codici)', () => {
  it('tempo di browser del giorno finito ⇒ le parole del piano gratuito, nessun ritentativo', async () => {
    const { client, calls } = setup(() =>
      jsonResponse(429, { success: false, errors: [{ code: 429, message: 'Browser time limit exceeded for today' }] }),
    );
    const err = await failure(client.crawl({ url: 'https://officina-fittizia.it', maxPages: 10 }));
    expect(err.message).toBe(`actor:cloudflare:crawl: ${CLOUDFLARE_DAILY_LIMIT_TEXT}`);
    expect(err.message).toContain('superato il limite di browser del piano gratuito (10 minuti al giorno)');
    expect(calls).toHaveLength(1);
  });

  it('richieste troppo fitte ⇒ attende retry-after e ritenta; oltre i tentativi, a parole', async () => {
    const tooMany = () => jsonResponse(429, { success: false, errors: [{ code: 429, message: 'Too many requests' }] }, { 'Retry-After': '12' });
    const { client, calls, waits, logs } = setup(tooMany);
    const err = await failure(client.crawl({ url: 'https://officina-fittizia.it', maxPages: 10 }));
    expect(calls).toHaveLength(CLOUDFLARE_MAX_ATTEMPTS);
    expect(waits).toEqual([12_000, 12_000]);
    expect(logs).toEqual([
      'Cloudflare · 429 su crawl: nuovo tentativo tra 12 s (tentativo 1 di 3)',
      'Cloudflare · 429 su crawl: nuovo tentativo tra 12 s (tentativo 2 di 3)',
    ]);
    expect(err.message).toBe(
      'actor:cloudflare:crawl: Cloudflare ha rifiutato la lettura, troppe richieste per il piano (3 tentativi: Too many requests). Riprova tra qualche minuto.',
    );
  });

  it('un retry-after più corto dell\'intervallo del piano non fa ritentare prima di 10 s', async () => {
    const tooMany = () => jsonResponse(429, { success: false, errors: [{ code: 429, message: 'Too many requests' }] }, { 'Retry-After': '2' });
    const { client, waits } = setup(tooMany, started, completed);
    await client.crawl({ url: 'https://officina-fittizia.it', maxPages: 10 });
    expect(waits).toEqual([CLOUDFLARE_REQUEST_INTERVAL_MS, CLOUDFLARE_POLL_INTERVAL_MS]);
  });

  it('lettura interrotta per i limiti ⇒ a parole', async () => {
    const limited = () => jsonResponse(200, { success: true, result: { id: 'job-1', status: 'cancelled_due_to_limits', records: [] } });
    const { client } = setup(started, limited);
    const err = await failure(client.crawl({ url: 'https://officina-fittizia.it', maxPages: 10 }));
    expect(err.message).toBe(
      'actor:cloudflare:crawl: Cloudflare ha interrotto la lettura per i limiti del piano (sul gratuito: 10 minuti di browser ' +
        'e 5 letture al giorno). Riprova domani o passa al piano a pagamento.',
    );
  });
});

describe('il token non compare mai (A7)', () => {
  it('né negli errori del servizio che lo ripetono, né nelle righe di log, né negli errori di rete', async () => {
    const echo = () => jsonResponse(500, { success: false, errors: [{ code: 1, message: `bad token ${TOKEN}` }] });
    const a = setup(echo);
    const provider = await failure(a.client.crawl({ url: 'https://officina-fittizia.it', maxPages: 10 }));
    expect(provider.message).toBe('actor:cloudflare:crawl: HTTP 500 (bad token [token nascosto])');

    const b = setupWith({ accountId: ACCOUNT, apiToken: TOKEN }, () => {
      throw new Error(`connessione rifiutata per ${TOKEN}`);
    });
    const network = await failure(b.client.crawl({ url: 'https://officina-fittizia.it', maxPages: 10 }));
    expect(network.message).toBe('actor:cloudflare:crawl: errore di rete (connessione rifiutata per [token nascosto])');

    const tooMany = () => jsonResponse(429, { success: false, errors: [{ code: 429, message: `slow down ${TOKEN}` }] });
    const c = setup(tooMany);
    const limit = await failure(c.client.crawl({ url: 'https://officina-fittizia.it', maxPages: 10 }));
    for (const text of [limit.message, ...c.logs]) expect(text).not.toContain(TOKEN);
  });
});
