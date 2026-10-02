import { describe, expect, it } from 'vitest';

// Verifica manuale Cloudflare (own-profile-services T20, SPEC A8): qui lo script gira SOLO con `fetch`, `env`,
// `log`, `sleep` e `writeFile` iniettati. Nessuna chiamata di rete, nessuna scrittura su disco.
// Import statici sicuri: né lo script né `src/cloudflare/*` leggono la config.
const { main, summarizeRobots, normalizeSiteArg, CRAWLER_USER_AGENT } = await import('../scripts/cloudflare-smoke.js');

const ACCOUNT = '0123456789abcdef0123456789abcdef';
const TOKEN = 'cf-token-finto-smoke-123';
const ENV = { CLOUDFLARE_ACCOUNT_ID: ACCOUNT, CLOUDFLARE_API_TOKEN: TOKEN };

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

const ROBOTS = `User-agent: *
Content-Signal: search=yes, ai-input=yes, ai-train=no
Crawl-delay: 2
Disallow: /admin

User-agent: GPTBot
Disallow: /
`;

/** Testo di una pagina che regge un profilo: sopra la soglia di `readSite`, quindi niente seconda lettura. */
const HOME_MARKDOWN =
  '# Officina\nSviluppo software su misura per le PMI: analisi, prototipo in due settimane, rilascio e manutenzione, ' +
  'con un prezzo fisso al mese e un referente senior nel team. Gestionali per la logistica, portali clienti, app ' +
  'interne per turni e magazzino: prima il problema, poi il codice.\n## Servizi\nFractional CTO e sviluppo su misura.';

const COMPLETED = {
  success: true,
  result: {
    id: 'job-1',
    status: 'completed',
    browserSecondsUsed: 18.2,
    total: 2,
    finished: 2,
    records: [
      {
        url: 'https://officina-fittizia.it/',
        status: 'completed',
        markdown: HOME_MARKDOWN,
        metadata: { status: 200, title: 'Officina' },
      },
      { url: 'https://officina-fittizia.it/admin', status: 'disallowed' },
    ],
  },
};

/** `fetch` finto per endpoint: robots.txt del sito, avvio e stato della lettura (con la risposta data). */
function run(argv: string[], opts: { env?: Record<string, string>; crawl?: (init?: RequestInit) => Response } = {}) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const lines: string[] = [];
  const files: Array<{ path: string; content: string }> = [];
  const clock = { t: Date.parse('2026-09-30T10:00:00Z') };
  const fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith('/robots.txt')) return new Response(ROBOTS, { status: 200 });
    if (opts.crawl) return opts.crawl(init);
    if (init?.method === 'POST') return jsonResponse(200, { success: true, result: 'job-1' }, { 'X-Browser-Ms-Used': '500' });
    // Il primo controllo trova la lettura in corso, con le pagine lette fin lì.
    if (calls.filter((c) => !c.url.endsWith('/robots.txt') && c.init?.method !== 'POST').length === 1) {
      return jsonResponse(200, { success: true, result: { ...COMPLETED.result, status: 'running', finished: 1, records: COMPLETED.result.records.slice(0, 1) } });
    }
    return jsonResponse(200, COMPLETED, { 'X-Browser-Ms-Used': '17700' });
  }) as typeof globalThis.fetch;
  const done = main(argv, {
    fetch,
    env: opts.env ?? ENV,
    log: (line) => lines.push(line),
    sleep: async (ms) => {
      clock.t += ms;
    },
    now: () => clock.t,
    writeFile: async (path, content) => {
      files.push({ path, content });
    },
    rawDir: '/cartella-finta/cloudflare/raw',
  });
  return { done, calls, lines, files };
}

describe('npm run cloudflare:smoke', () => {
  it('senza --yes stampa cosa farebbe, non chiama niente ed esce con 2', async () => {
    const { done, calls, lines } = run(['--site', 'officina-fittizia.it']);
    expect(await done).toBe(2);
    expect(calls).toHaveLength(0);
    expect(lines.join('\n')).toContain('Sito: https://officina-fittizia.it/ · fino a 10 pagine');
    expect(lines.at(-1)).toBe('Nessuna chiamata eseguita. Per eseguire davvero ripeti il comando aggiungendo --yes.');
  });

  it('con --yes ma senza credenziali non chiama ed esce con 1', async () => {
    const { done, calls, lines } = run(['--site', 'officina-fittizia.it', '--yes'], { env: { CLOUDFLARE_ACCOUNT_ID: ACCOUNT } });
    expect(await done).toBe(1);
    expect(calls).toHaveLength(0);
    expect(lines).toContain('  - CLOUDFLARE_API_TOKEN mancante nel .env');
  });

  it('con --yes legge il sito una volta: pagine, forma del contenuto, consumo, cosa dichiara al sito', async () => {
    const { done, calls, lines, files } = run(['--site', 'https://officina-fittizia.it', '--pages', '5', '--yes']);
    expect(await done).toBe(0);
    const out = lines.join('\n');

    expect(calls.map((c) => `${c.init?.method ?? 'GET'} ${c.url.replace(ACCOUNT, '<account>')}`)).toEqual([
      'GET https://officina-fittizia.it/robots.txt',
      'POST https://api.cloudflare.com/client/v4/accounts/<account>/browser-run/crawl',
      'GET https://api.cloudflare.com/client/v4/accounts/<account>/browser-run/crawl/job-1',
      'GET https://api.cloudflare.com/client/v4/accounts/<account>/browser-run/crawl/job-1',
    ]);
    expect(JSON.parse(calls[1]!.init!.body as string)).toMatchObject({ limit: 5, render: false, crawlPurposes: ['ai-input'] });

    expect(out).toContain('  - Crawl-delay: 2');
    expect(out).toContain('  - Content-Signal: search=yes, ai-input=yes, ai-train=no');
    expect(out).toContain('  - Disallow: /admin');
    expect(out).toContain(`  - user agent ${CRAWLER_USER_AGENT} (fisso, lo sceglie Cloudflare)`);
    expect(out).toContain(
      "  Modalità: come la generazione del profilo, senza browser (solo l'HTML iniziale); con il browser solo se le pagine arrivano quasi vuote.",
    );
    expect(out).toContain('Lettura job-1 (senza browser) conclusa in 60 s: 1 pagina letta · 1 vietata dal robots.txt del sito.');
    expect(out).not.toContain('ancora in coda');
    expect(out).not.toContain('riletta con il browser');
    expect(out).toContain(
      `  - https://officina-fittizia.it/ — letta · HTTP 200 · «Officina» · ${HOME_MARKDOWN.length} caratteri di Markdown, 2 titoli`,
    );
    expect(out).toContain('  - https://officina-fittizia.it/admin — vietata dal robots.txt del sito');
    expect(out).toContain('  | # Officina');
    expect(out).toContain('  - tempo di browser nel risultato (browserSecondsUsed): 18,2 s');
    expect(out).toContain("  - somma dell'header X-Browser-Ms-Used: 18,2 s su 3 richieste");

    expect(files).toHaveLength(1);
    expect(files[0]!.path).toMatch(/^\/cartella-finta\/cloudflare\/raw\/crawl-2026-09-30T10-00-00-000Z\.json$/);
    const raw = JSON.parse(files[0]!.content);
    expect(raw.map((r: any) => `${r.method} ${r.path} ${r.status}`)).toEqual([
      'POST /client/v4/accounts/<account>/browser-run/crawl 200',
      'GET /client/v4/accounts/<account>/browser-run/crawl/job-1 200',
      'GET /client/v4/accounts/<account>/browser-run/crawl/job-1 200',
    ]);
    // Del controllo in corso restano indirizzo e stato delle pagine; la risposta finale le tiene intere.
    expect(raw[1].body.result.records).toEqual([{ url: 'https://officina-fittizia.it/', status: 'completed' }]);
    expect(raw[2].body.result.records).toHaveLength(2);
    expect(files[0]!.content).not.toContain(TOKEN);
    expect(files[0]!.content).not.toContain(ACCOUNT);
  });

  it('permessi insufficienti ⇒ l\'errore leggibile del CRM, uscita 1, il token mai stampato', async () => {
    const forbidden = () =>
      jsonResponse(403, { success: false, errors: [{ code: 10000, message: `Authentication error ${TOKEN}` }] });
    const { done, lines } = run(['--site', 'officina-fittizia.it', '--yes'], { crawl: forbidden });
    expect(await done).toBe(1);
    expect(lines).toContain(
      'Lettura FALLITA: config: il token Cloudflare non ha il permesso «Browser Rendering - Edit» su questo account (403). ' +
        'Verifica CLOUDFLARE_API_TOKEN e CLOUDFLARE_ACCOUNT_ID nel .env.',
    );
    expect(lines.join('\n')).toContain('Il token serve con il permesso «Browser Rendering - Edit»');
    for (const line of lines) expect(line).not.toContain(TOKEN);
  });

  it('lettura rimasta in corso ⇒ annullata, con le pagine viste per ultime e senza il consiglio sul token', async () => {
    // Come nella verifica reale: l'annullamento risponde senza pagine.
    const stuck = (init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse(200, { success: true, result: 'job-1' });
      if (init?.method === 'DELETE') {
        return jsonResponse(200, { success: true, result: { message: 'Crawl job cancelled successfully', job_id: 'job-1' } });
      }
      const records = [COMPLETED.result.records[0], { url: 'https://officina-fittizia.it/servizi', status: 'queued' }];
      return jsonResponse(200, { success: true, result: { id: 'job-1', status: 'running', total: 2, finished: 1, records } });
    };
    const { done, lines } = run(['--site', 'officina-fittizia.it', '--yes'], { crawl: stuck });
    expect(await done).toBe(1);
    const out = lines.join('\n');
    expect(out).toContain('(1 pagina letta, 1 ancora in coda) ed è stata annullata.');
    expect(out).toContain('Ultimo stato visto da Cloudflare (running):');
    expect(out).toContain('  - https://officina-fittizia.it/servizi — ancora in coda');
    expect(out).not.toContain('Il token serve');
  });

  it('lettura dichiarata conclusa con pagine in coda ⇒ il riepilogo le conta come non lette e lo dice', async () => {
    // Com'era la seconda verifica reale del 2026-09-30: `completed` con la sola pagina iniziale letta.
    const partial = (init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse(200, { success: true, result: 'job-1' });
      const records = [
        COMPLETED.result.records[0],
        { url: 'https://cal.example/prenota', status: 'skipped' },
        { url: 'https://officina-fittizia.it/prezzi', status: 'queued' },
        { url: 'https://officina-fittizia.it/termini', status: 'queued' },
      ];
      return jsonResponse(200, { success: true, result: { id: 'job-1', status: 'completed', total: 2, finished: 1, skipped: 1, records } });
    };
    const { done, lines } = run(['--site', 'officina-fittizia.it', '--yes'], { crawl: partial });
    expect(await done).toBe(0);
    const out = lines.join('\n');
    expect(out).toContain(
      'Lettura job-1 (senza browser) conclusa in 30 s: 1 pagina letta · 1 esclusa dalla configurazione · 2 rimaste in coda, non lette.',
    );
    expect(out).toContain('  - https://officina-fittizia.it/prezzi — ancora in coda');
    expect(out).toContain('Cloudflare ha dichiarato la lettura conclusa con pagine ancora in coda');
  });

  it('--no-render chiede la lettura senza browser e lo dice, costo compreso', async () => {
    const { done, calls, lines } = run(['--site', 'officina-fittizia.it', '--no-render', '--yes']);
    expect(await done).toBe(0);
    expect(JSON.parse(calls[1]!.init!.body as string)).toMatchObject({ render: false });
    const out = lines.join('\n');
    expect(out).toContain("  Modalità: solo senza browser (--no-render), solo l'HTML iniziale: il JavaScript del sito non viene eseguito.");
    expect(out).toContain('niente tempo di browser; 1 delle 5 letture al giorno.');
  });

  it('--render chiede una sola lettura con il browser, anche se le pagine sono quasi vuote', async () => {
    const { done, calls, lines } = run(['--site', 'officina-fittizia.it', '--render', '--yes']);
    expect(await done).toBe(0);
    expect(calls.filter((c) => c.init?.method === 'POST').map((c) => JSON.parse(c.init!.body as string).render)).toEqual([true]);
    expect(lines.join('\n')).toContain('  Modalità: solo con il browser (--render), JavaScript del sito eseguito.');
  });

  it('--render e --no-render insieme ⇒ nessuna chiamata, uscita 1', async () => {
    const { done, calls, lines } = run(['--site', 'officina-fittizia.it', '--render', '--no-render', '--yes']);
    expect(await done).toBe(1);
    expect(calls).toHaveLength(0);
    expect(lines).toContain('  - --render e --no-render insieme: scegline uno');
  });

  it('come i job: senza browser quasi vuoto ⇒ riletto con il browser, e lo script mostra entrambe le letture', async () => {
    let mode: 'html' | 'browser' = 'html';
    const shell = { url: 'https://officina-fittizia.it/', status: 'completed', markdown: '---\ntitle: "Officina"\n---\nAttiva JavaScript.' };
    const byMode = (init?: RequestInit) => {
      if (init?.method === 'POST') {
        mode = JSON.parse(init.body as string).render ? 'browser' : 'html';
        return jsonResponse(200, { success: true, result: mode === 'html' ? 'job-html' : 'job-1' });
      }
      if (mode === 'html') return jsonResponse(200, { success: true, result: { id: 'job-html', status: 'completed', records: [shell] } });
      return jsonResponse(200, COMPLETED);
    };
    const { done, calls, lines } = run(['--site', 'officina-fittizia.it', '--yes'], { crawl: byMode });
    expect(await done).toBe(0);
    expect(calls.filter((c) => c.init?.method === 'POST').map((c) => JSON.parse(c.init!.body as string).render)).toEqual([false, true]);
    const out = lines.join('\n');
    expect(out).toContain(
      'Lettura senza browser job-html: 1 pagina letta; nessuna pagina con almeno 300 caratteri di testo, quindi riletta con il browser.',
    );
    expect(out).toContain('  Cloudflare · senza browser il sito è quasi vuoto');
    expect(out).toContain('Lettura job-1 (con il browser) conclusa in');
  });
});

describe('parti pure', () => {
  it('robots.txt: solo i gruppi per tutti o per il lettore di Cloudflare', () => {
    expect(summarizeRobots(ROBOTS)).toEqual({
      found: true,
      crawlDelay: '2',
      contentSignal: ['search=yes, ai-input=yes, ai-train=no'],
      disallow: ['/admin'],
    });
    expect(summarizeRobots('User-agent: CloudflareBrowserRenderingCrawler\nDisallow: /privato\n').disallow).toEqual(['/privato']);
  });

  it('indirizzo del sito: dominio nudo o URL, solo http e https', () => {
    expect(normalizeSiteArg('officina-fittizia.it')).toBe('https://officina-fittizia.it/');
    expect(normalizeSiteArg('http://officina-fittizia.it/chi-siamo')).toBe('http://officina-fittizia.it/chi-siamo');
    expect(normalizeSiteArg('ftp://officina-fittizia.it')).toBeUndefined();
    expect(normalizeSiteArg('localhost')).toBeUndefined();
  });
});
