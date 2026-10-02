import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

// Lettura delle tre fonti della generazione (own-profile-services T23: C1–C5, C8, C11–C14, B9). Profilo LinkedIn
// dall'item dell'actor mappato davvero, sito dal client Cloudflare vero con `fetch` finto: nessuna chiamata di rete.
// Import dinamici: la config (DB_PATH isolato da tests/setup.ts) è letta a import-time.
const { db } = await import('../src/db/index.js');
const { updateSettings } = await import('../src/db/settings.js');
const { upsertPost } = await import('../src/db/posts.js');
const { mapProfileDetailItem } = await import('../src/enrich/profile-detail.js');
const { createCloudflareClient } = await import('../src/cloudflare/client.js');
const { readSources, listSourceRows } = await import('../src/profile/sources.js');

const FIXTURES = path.join(import.meta.dirname, 'fixtures', 'profile');
const fixture = (name: string): unknown => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));

const PROFILE_URL = 'https://www.linkedin.com/in/marta-fiorini-fixture';
const SITE = 'https://www.martafiorini.example/';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Deps delle fonti: profilo dall'item della fixture, sito dal client Cloudflare con le risposte date (in ordine). */
function deps(siteResponses: Array<() => Response>) {
  const calls = { profile: [] as string[], site: 0 };
  const client = createCloudflareClient({
    accountId: 'fixture-account',
    apiToken: 'fixture-token',
    fetch: async () => siteResponses[Math.min(calls.site++, siteResponses.length - 1)]!(),
    sleep: async () => {},
  });
  return {
    calls,
    deps: {
      readProfile: async (url: string) => {
        calls.profile.push(url);
        return mapProfileDetailItem(fixture('linkedin-profile.json')).enrichment;
      },
      readSite: client.readSite,
    },
  };
}

const ALL = ['linkedin', 'website', 'posts'] as const;

beforeEach(() => {
  db.exec(`DELETE FROM settings; DELETE FROM profile_sources; DELETE FROM posts;`);
  updateSettings({ own_profile_url: PROFILE_URL, website_url: SITE });
  upsertPost({ postUrl: 'https://www.linkedin.com/posts/fixture-1', text: 'Ho appena consegnato un MVP in cinque settimane.', postedAt: '2026-09-20T08:00:00Z' });
});

describe('fonti isolate (C12, C13)', () => {
  it('tdd_target: con Cloudflare che risponde 401, le altre due fonti vengono lette e l\'esito dice quale è fallita e perché', async () => {
    const { deps: d } = deps([() => jsonResponse(401, { success: false, errors: [{ code: 10000, message: 'Authentication error' }] })]);

    const outcomes = await readSources({ include: [...ALL], force: [] }, d);

    expect(outcomes.map((o) => [o.kind, o.outcome])).toEqual([
      ['linkedin', 'read'],
      ['website', 'failed'],
      ['posts', 'read'],
    ]);
    const website = outcomes.find((o) => o.kind === 'website')!;
    expect(website.reason).toBe('Cloudflare ha rifiutato le credenziali (401). Verifica CLOUDFLARE_API_TOKEN nel .env.');
    expect(website.toolError).toEqual({
      tool: 'cloudflare',
      error: 'config: Cloudflare ha rifiutato le credenziali (401). Verifica CLOUDFLARE_API_TOKEN nel .env.',
    });
    expect(outcomes.find((o) => o.kind === 'linkedin')!.content).toContain('Product engineer freelance');
    expect(outcomes.find((o) => o.kind === 'posts')!.content).toContain('MVP in cinque settimane');
    // Ogni fonte letta ha la sua riga, con l'esito e il motivo (C13).
    expect(listSourceRows().map((r) => [r.kind, r.outcome, r.reason])).toEqual([
      ['linkedin', 'read', null],
      ['website', 'failed', 'Cloudflare ha rifiutato le credenziali (401). Verifica CLOUDFLARE_API_TOKEN nel .env.'],
      ['posts', 'read', null],
    ]);
  });
});

/** Risposte del client per una lettura senza browser riuscita: avvio, poi lo stato con le pagine della fixture. */
const crawlOk = () => [() => jsonResponse(200, { success: true, result: 'fixture-crawl-0001' }), () => jsonResponse(200, fixture('site-crawl-status.json'))];

describe('lettura riuscita (C1, C3, C5, C8)', () => {
  it('ogni fonte letta ⇒ riga «read» con il suo indirizzo e i suoi numeri; il testo resta fuori dal log', async () => {
    const { deps: d, calls } = deps(crawlOk());

    const outcomes = await readSources({ include: [...ALL], force: [] }, d);

    expect(outcomes.map((o) => [o.kind, o.outcome, o.reused])).toEqual([
      ['linkedin', 'read', false],
      ['website', 'read', false],
      ['posts', 'read', false],
    ]);
    expect(calls.profile).toEqual([PROFILE_URL]);
    const website = outcomes.find((o) => o.kind === 'website')!;
    // Tre pagine lette su quattro trovate (una vietata da robots.txt), senza browser, con i titoli in chiaro.
    expect(website.meta).toEqual({ address: SITE, pages_read: 3, pages_queued: 0, max_pages: 10, render: false });
    expect(website.warnings).toEqual([]);
    expect(website.content).toContain('## Marta Fiorini — MVP in sei settimane (https://www.martafiorini.example/)');
    expect(website.content).toContain('MVP: 24 000 € a prezzo fisso');
    expect(outcomes.find((o) => o.kind === 'posts')!.meta).toEqual({ complete: 1, excerpts: 0, used: 1 });
    const linkedin = outcomes.find((o) => o.kind === 'linkedin')!.content!;
    expect(linkedin).toContain('Titolo: Product engineer freelance | MVP e piattaforme SaaS per startup B2B');
    expect(linkedin).toContain('- Product engineer freelance · Freelance (2022–oggi): MVP in 6 settimane a prezzo fisso');
    expect(listSourceRows().map((r) => [r.kind, r.outcome, r.meta.address ?? null])).toEqual([
      ['linkedin', 'read', PROFILE_URL],
      ['website', 'read', SITE],
      ['posts', 'read', null],
    ]);
  });
});

/** Stato di una lettura conclusa con le pagine date. */
const crawlWith = (records: unknown[]) => [
  () => jsonResponse(200, { success: true, result: 'fixture-crawl-0002' }),
  () => jsonResponse(200, { success: true, result: { id: 'fixture-crawl-0002', status: 'completed', total: records.length, finished: records.length, records } }),
];
const consentPage = { url: SITE, status: 'completed', metadata: { status: 200, title: 'Cookie' }, markdown: '# Accetta i cookie\n\nPer continuare accetta.' };

describe('sito senza contenuto utile (C14)', () => {
  it('pagina di consenso anche con il browser ⇒ «empty» col motivo, nessun contenuto, e l\'avviso della seconda lettura', async () => {
    // Senza browser quasi vuota, poi con il browser ancora quasi vuota: due letture, nessun testo.
    const { deps: d, calls } = deps([...crawlWith([consentPage]), ...crawlWith([consentPage])]);

    const [, website] = await readSources({ include: ['website'], force: [] }, d);

    expect(calls.site).toBe(4);
    expect(website).toMatchObject({
      outcome: 'empty',
      content: null,
      reason: 'Nessun contenuto utile (pagina vuota, consenso obbligatorio o blocco): nessun valore è stato dedotto dal sito.',
    });
    expect(website!.meta).toMatchObject({ render: true, pages_read: 1 });
    expect(website!.warnings).toEqual([
      "Senza browser le pagine del sito erano quasi vuote: riletto con il browser, che costa un'altra lettura del giorno.",
    ]);
  });

  it('pagine rimaste in coda in una lettura conclusa ⇒ non lette, e l\'esito lo dice', async () => {
    const status = fixture('site-crawl-status.json') as { result: { records: unknown[] } };
    const records = [...status.result.records, { url: `${SITE}team`, status: 'queued' }, { url: `${SITE}blog`, status: 'queued' }];
    const { deps: d } = deps(crawlWith(records));

    const [, website] = await readSources({ include: ['website'], force: [] }, d);

    expect(website).toMatchObject({ outcome: 'read', meta: { pages_read: 3, pages_queued: 2 } });
    expect(website!.warnings).toEqual(['2 pagine trovate non sono state lette: Cloudflare ha chiuso la lettura prima.']);
  });
});

describe('fonti non disponibili (D8, C11)', () => {
  it('un indirizzo che non è un sito ⇒ «unavailable» col motivo di C11, senza chiamare Cloudflare; un sito su Wix si legge', async () => {
    updateSettings({ website_url: 'il mio sito' });
    const { deps: d, calls } = deps(crawlOk());

    const [, website] = await readSources({ include: [...ALL], force: [] }, d);

    expect(calls.site).toBe(0);
    expect(website).toMatchObject({
      outcome: 'unavailable',
      reason: "L'indirizzo salvato non è un sito. Correggilo in «I tuoi indirizzi pubblici».",
    });
    expect(listSourceRows().find((r) => r.kind === 'website')).toMatchObject({ outcome: 'unavailable' });

    updateSettings({ website_url: 'martafiorini.wixsite.com/studio' });
    const [, wix] = await readSources({ include: ['website'], force: [] }, deps(crawlOk()).deps);
    expect(wix).toMatchObject({ outcome: 'read', meta: { address: 'https://martafiorini.wixsite.com/studio' } });
  });

  it('credenziali mancanti e post solo estratto ⇒ «unavailable» con la variabile o il rimedio; una fonte esclusa non si tocca', async () => {
    const { config } = await import('../src/config.js');
    const saved = config.cloudflareAccountId;
    config.cloudflareAccountId = '';
    db.exec(`UPDATE posts SET text_complete = 0`);
    try {
      const { deps: d, calls } = deps(crawlOk());
      const outcomes = await readSources({ include: ['website', 'posts'], force: [] }, d);
      expect(outcomes.map((o) => [o.kind, o.outcome, o.reason])).toEqual([
        ['linkedin', 'excluded', null],
        ['website', 'unavailable', 'CLOUDFLARE_ACCOUNT_ID mancante nel .env. Vai a Connessioni.'],
        [
          'posts',
          'unavailable',
          "Nessun post con testo integrale: i post sincronizzati prima di oggi hanno solo l'estratto. Sincronizza di nuovo per conservarlo.",
        ],
      ]);
      expect(calls).toEqual({ profile: [], site: 0 });
      expect(listSourceRows().map((r) => r.kind)).toEqual(['website', 'posts']);
    } finally {
      config.cloudflareAccountId = saved;
    }
  });
});

describe('freschezza sull\'indirizzo letto (C4, G-4)', () => {
  const DAY = 86_400_000;

  it('profilo letto 10 giorni fa ⇒ si riprende senza chiamare; con la rilettura chiama', async () => {
    await readSources({ include: ['linkedin'], force: [] }, deps([]).deps);
    db.prepare(`UPDATE profile_sources SET read_at = ? WHERE kind = 'linkedin'`).run(new Date(Date.now() - 10 * DAY).toISOString());

    const { deps: d, calls } = deps([]);
    const [linkedin] = await readSources({ include: ['linkedin'], force: [] }, d);
    expect(calls.profile).toEqual([]);
    expect(linkedin).toMatchObject({ outcome: 'read', reused: true, content: expect.stringContaining('Marta Fiorini') });

    const again = deps([]);
    const [forced] = await readSources({ include: ['linkedin'], force: ['linkedin'] }, again.deps);
    expect(again.calls.profile).toEqual([PROFILE_URL]);
    expect(forced).toMatchObject({ outcome: 'read', reused: false });
  });

  it('profilo e sito letti 10 giorni fa ma con l\'indirizzo cambiato dopo ⇒ si leggono di nuovo', async () => {
    await readSources({ include: ['linkedin', 'website'], force: [] }, deps(crawlOk()).deps);
    db.prepare(`UPDATE profile_sources SET read_at = ?`).run(new Date(Date.now() - 10 * DAY).toISOString());
    updateSettings({ own_profile_url: 'https://www.linkedin.com/in/marta-fiorini-nuovo', website_url: 'https://studio.martafiorini.example/' });

    const { deps: d, calls } = deps(crawlOk());
    const outcomes = await readSources({ include: ['linkedin', 'website'], force: [] }, d);

    expect(calls.profile).toEqual(['https://www.linkedin.com/in/marta-fiorini-nuovo']);
    expect(calls.site).toBe(2);
    expect(outcomes.slice(0, 2).map((o) => o.reused)).toEqual([false, false]);
  });

  it('una lettura fallita non è fresca: la volta dopo si riprova', async () => {
    await readSources({ include: ['website'], force: [] }, deps([() => jsonResponse(401, { success: false, errors: [] })]).deps);
    const { deps: d, calls } = deps(crawlOk());
    const [, website] = await readSources({ include: ['website'], force: [] }, d);
    expect(calls.site).toBe(2);
    expect(website).toMatchObject({ outcome: 'read', reused: false });
  });
});

describe('B9: la propria azienda non è un\'azienda del CRM', () => {
  it('una lettura completa delle tre fonti lascia `companies` com\'era', async () => {
    db.prepare(`INSERT INTO companies (name, domain) VALUES ('Acme', 'acme.it')`).run();
    const before = db.prepare(`SELECT * FROM companies ORDER BY id`).all();

    await readSources({ include: [...ALL], force: [] }, deps(crawlOk()).deps);

    expect(db.prepare(`SELECT * FROM companies ORDER BY id`).all()).toEqual(before);
    db.exec(`DELETE FROM companies`);
  });
});
