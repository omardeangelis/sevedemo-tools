import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

// Job `generate_profile` (own-profile-services T24–T26: D1–D14, E1–E13, H6): anteprima, blocchi, esito, proposta.
// Fonti dal client Cloudflare vero con `fetch` finto e dall'item dell'actor mappato; modello con client finto.
// Nessuna chiamata di rete. Import dinamici: la config (DB_PATH isolato da tests/setup.ts) è letta a import-time.
const { db } = await import('../src/db/index.js');
const { updateSettings } = await import('../src/db/settings.js');
const { upsertPost } = await import('../src/db/posts.js');
const { insertJob } = await import('../src/db/jobs.js');
const { readRunLog } = await import('../src/db/runs.js');
const { runJob } = await import('../src/server/job-entry.js');
const { mapProfileDetailItem } = await import('../src/enrich/profile-detail.js');
const { createCloudflareClient } = await import('../src/cloudflare/client.js');

const FIXTURES = path.join(import.meta.dirname, 'fixtures', 'profile');
const fixture = (name: string): unknown => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));

const PROFILE_URL = 'https://www.linkedin.com/in/marta-fiorini-fixture';
const SITE = 'https://www.martafiorini.example/';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const crawlWith = (records: unknown[]) => [
  () => jsonResponse(200, { success: true, result: 'fixture-crawl' }),
  () => jsonResponse(200, { success: true, result: { id: 'fixture-crawl', status: 'completed', total: records.length, finished: records.length, records } }),
];
const crawlOk = () => [() => jsonResponse(200, { success: true, result: 'fixture-crawl-0001' }), () => jsonResponse(200, fixture('site-crawl-status.json'))];
const consentPage = { url: SITE, status: 'completed', metadata: { status: 200, title: 'Cookie' }, markdown: '# Accetta i cookie' };

/** Client del modello finto: registra le richieste, risponde con `reply` (o fallisce se il test non se lo aspetta). */
function fakeClient(reply?: () => unknown) {
  const requests: unknown[] = [];
  return {
    requests,
    client: {
      messages: {
        create: async (body: unknown) => {
          requests.push(body);
          if (!reply) throw new Error('il modello non doveva essere chiamato');
          return reply() as never;
        },
      },
    },
  };
}

/** Deps del job: profilo (fixture o vuoto), sito (risposte date al client vero), modello finto. */
function deps(opts: { profile?: 'fixture' | 'empty'; site?: Array<() => Response>; reply?: () => unknown } = {}) {
  const calls = { profile: 0, site: 0 };
  const site = opts.site ?? crawlOk();
  const cloudflare = createCloudflareClient({
    accountId: 'fixture-account',
    apiToken: 'fixture-token',
    fetch: async () => site[Math.min(calls.site++, site.length - 1)]!(),
    sleep: async () => {},
  });
  const model = fakeClient(opts.reply);
  return {
    calls,
    model,
    deps: {
      sources: {
        readProfile: async () => {
          calls.profile++;
          return opts.profile === 'empty' ? undefined : mapProfileDetailItem(fixture('linkedin-profile.json')).enrichment;
        },
        readSite: cloudflare.readSite,
      },
      client: model.client,
    },
  };
}

function pendingProposal(createdAt = '2026-09-18T10:00:00.000Z'): number {
  return Number(
    db
      .prepare(
        `INSERT INTO profile_proposals (model, fields, services, sources, created_at) VALUES ('claude-opus-5', '{}', '[]', '[]', ?)`,
      )
      .run(createdAt).lastInsertRowid,
  );
}

beforeEach(() => {
  db.exec(`DELETE FROM jobs; DELETE FROM settings; DELETE FROM profile_sources; DELETE FROM profile_proposals; DELETE FROM posts;
           DELETE FROM services; DELETE FROM profile_field_origin;`);
  updateSettings({ own_profile_url: PROFILE_URL, website_url: SITE });
});

describe('esito neutro (D13, D14)', () => {
  it('tdd_target: con tutte le fonti senza contenuto, il job chiude neutro e il client del modello non viene mai chiamato', async () => {
    const pending = pendingProposal();
    // Profilo senza dati, sito di solo consenso (anche con il browser), post solo estratto.
    upsertPost({ postUrl: 'https://www.linkedin.com/posts/vecchio', text: 'Estratto di un post vecchio.' });
    db.exec(`UPDATE posts SET text_complete = 0`);
    const { deps: d, model } = deps({ profile: 'empty', site: [...crawlWith([consentPage]), ...crawlWith([consentPage])] });
    const job = insertJob('generate_profile', { sources: ['linkedin', 'website'], force: [] }, ['apify', 'cloudflare', 'anthropic']);

    const done = await runJob(job.id, { resolveDeps: () => d });

    expect(done.state).toBe('succeeded');
    expect(model.requests).toEqual([]);
    expect(done.result).toMatchObject({
      summary:
        'Nessuna fonte ha prodotto contenuto: il modello non è stato chiamato, nessuna spesa di elaborazione. La proposta del 18 set resta com\'era.',
      counts: { no_content: 1, sources_read: 0, sources_empty: 2, sources_unavailable: 1, sources_failed: 0 },
    });
    expect(done.result!.tool_errors).toBeUndefined();
    // La proposta pendente è intatta e non ne nasce un'altra.
    expect(db.prepare(`SELECT id FROM profile_proposals`).pluck().all()).toEqual([pending]);
    // Il log ha una riga per chiamata a uno strumento, mai il contenuto letto (D10, D11).
    const lines = readRunLog(job.id).lines.map((l) => l.message);
    expect(lines).toContain('Apify · profilo · marta-fiorini-fixture');
    expect(lines).toContain('Cloudflare · sito · martafiorini.example');
    expect(lines.join('\n')).not.toContain('Accetta i cookie');
  });
});

// ---------------------------------------------------------------------------
// Anteprima, avvio, "Riprova…" (D1–D9, D12, P-28)
// ---------------------------------------------------------------------------

const { createApp } = await import('../src/server/app.js');
const { config } = await import('../src/config.js');
const { setJobPid, findJob } = await import('../src/db/jobs.js');
const { getJob } = await import('../src/server/jobs.js');
const { ANTHROPIC_BLOCKER, ALL_EXCLUDED_BLOCKER, NO_SOURCE_BLOCKER } = await import('../src/jobs/generate-profile.js');

// Il figlio esce subito senza esito: ogni avvio diventa un job `failed` con i `params` che la route salva davvero.
const app = createApp({ jobs: { command: 'node', args: ['-e', ''] } });

async function send(method: 'GET' | 'POST', url: string, body?: unknown) {
  const res = await app.request(url, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
  });
  return { status: res.status, body: (await res.json()) as any };
}

async function waitTerminal(id: number) {
  const deadline = Date.now() + 5000;
  for (;;) {
    const job = getJob(id);
    if (job && job.state !== 'running') return job;
    if (Date.now() > deadline) throw new Error(`job ${id} ancora running`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function withoutKey<T>(key: 'anthropicApiKey' | 'apifyToken' | 'cloudflareApiToken', fn: () => Promise<T>): Promise<T> {
  const saved = config[key];
  config[key] = '';
  try {
    return await fn();
  } finally {
    config[key] = saved;
  }
}

function completePost() {
  upsertPost({ postUrl: 'https://www.linkedin.com/posts/fixture-1', text: 'Ho consegnato un MVP in cinque settimane.', postedAt: '2026-09-20T08:00:00Z' });
}

describe('anteprima: le fonti una per una (D3, D8, D9, P-28)', () => {
  it('tre fonti scelte, con indirizzo e strumento; nessun avviso di fonte in `warnings`', async () => {
    completePost();
    const { status, body } = await send('GET', '/api/profile/generate/preview');
    expect(status).toBe(200);
    expect(body.sources).toEqual([
      // Il prezzo dell'actor non è configurato nei test: il costo del profilo è "non disponibile" (T25).
      { kind: 'linkedin', state: 'selected', address: PROFILE_URL, reason: null, short_reason: null, remedy: null, max_pages: null, fresh_at: null, forced: false, tool: 'apify', est_cost_usd: null },
      { kind: 'website', state: 'selected', address: SITE, reason: null, short_reason: null, remedy: null, max_pages: 10, fresh_at: null, forced: false, tool: 'cloudflare', est_cost_usd: 0 },
      { kind: 'posts', state: 'selected', address: null, reason: null, short_reason: null, remedy: null, max_pages: null, fresh_at: null, forced: false, tool: null, est_cost_usd: 0 },
    ]);
    expect(body.counts).toEqual({
      sources_available: 3,
      sources_selected: 3,
      profile_reads: 1,
      site_max_pages: 10,
      posts_complete: 1,
      posts_excerpts: 0,
      generations: 1,
    });
    expect(body.warnings).toEqual([]);
    expect(body.blockers).toEqual([]);
  });

  it('i motivi delle fonti non disponibili stanno solo nella loro riga; la proposta pendente è un avviso generale (E11)', async () => {
    updateSettings({ website_url: null });
    pendingProposal('2026-09-18T10:00:00.000Z');
    const { body } = await withoutKey('apifyToken', () => send('GET', '/api/profile/generate/preview'));
    expect(body.sources.map((s: any) => [s.kind, s.state, s.reason])).toEqual([
      ['linkedin', 'unavailable', 'APIFY_TOKEN mancante nel .env. Vai a Connessioni.'],
      ['website', 'unavailable', 'Nessun sito impostato. Aggiungilo in «I tuoi indirizzi pubblici».'],
      ['posts', 'unavailable', 'Nessun post sincronizzato. Sincronizza i tuoi post.'],
    ]);
    // In breve per la riga della card che anticipa le fonti (G4).
    expect(body.sources.map((s: any) => [s.short_reason, s.remedy])).toEqual([
      ['Profilo LinkedIn senza APIFY_TOKEN', 'connections'],
      ['Sito non impostato', 'addresses'],
      ['Nessun post sincronizzato', 'posts'],
    ]);
    expect(body.warnings).toEqual([
      "C'è una proposta del 18 set non applicata: una nuova generazione la sostituisce. Le voci già applicate restano.",
    ]);
    expect(body.blockers).toEqual([NO_SOURCE_BLOCKER]);
  });

  it('escludere una fonte e rileggere una fonte fresca cambiano fonti e conteggi', async () => {
    completePost();
    db.prepare(
      `INSERT INTO profile_sources (kind, read_at, outcome, content, meta) VALUES ('linkedin', ?, 'read', 'Nome: Marta', ?)`,
    ).run(new Date(Date.now() - 3 * 86_400_000).toISOString(), JSON.stringify({ address: PROFILE_URL }));

    const fresh = (await send('GET', '/api/profile/generate/preview?exclude=website')).body;
    expect(fresh.sources.map((s: any) => [s.kind, s.state, s.fresh_at !== null, s.forced, s.tool])).toEqual([
      ['linkedin', 'selected', true, false, null],
      ['website', 'excluded', false, false, null],
      ['posts', 'selected', false, false, null],
    ]);
    expect(fresh.counts).toMatchObject({ sources_selected: 2, profile_reads: 0, site_max_pages: 0 });

    const forced = (await send('GET', '/api/profile/generate/preview?exclude=website&force=linkedin')).body;
    expect(forced.sources[0]).toMatchObject({ forced: true, tool: 'apify' });
    expect(forced.counts).toMatchObject({ profile_reads: 1 });

    expect((await send('GET', '/api/profile/generate/preview?exclude=sito')).status).toBe(400);
  });
});

describe('blocchi e avvio (D1, D6, D7)', () => {
  it('chiave Anthropic mancante ⇒ blocco in anteprima e 400 `blocked` all\'avvio, nessun job', async () => {
    completePost();
    await withoutKey('anthropicApiKey', async () => {
      expect((await send('GET', '/api/profile/generate/preview')).body.blockers).toEqual([ANTHROPIC_BLOCKER]);
      const start = await send('POST', '/api/profile/generate', {});
      expect(start.status).toBe(400);
      expect(start.body).toMatchObject({ code: 'blocked', blockers: [ANTHROPIC_BLOCKER] });
    });
    expect(db.prepare(`SELECT COUNT(*) FROM jobs`).pluck().get()).toBe(0);
  });

  it('tutte le fonti escluse ⇒ blocco', async () => {
    completePost();
    const { body } = await send('GET', '/api/profile/generate/preview?exclude=linkedin,website,posts');
    expect(body.blockers).toEqual([ALL_EXCLUDED_BLOCKER]);
    expect((await send('POST', '/api/profile/generate', { exclude: ['linkedin', 'website', 'posts'] })).status).toBe(400);
  });

  it('con un job in corso l\'anteprima lo dice e un secondo avvio è 409 `job_running`', async () => {
    const running = insertJob('analyze', { prospectIds: [1], icpId: 1 }, ['anthropic']);
    setJobPid(running.id, process.pid);
    expect((await send('GET', '/api/profile/generate/preview')).body.blockers).toEqual([
      expect.stringMatching(/^C'è già un job in corso: Analisi/),
    ]);
    const start = await send('POST', '/api/profile/generate', {});
    expect(start.status).toBe(409);
    expect(start.body).toMatchObject({ code: 'job_running', job_id: running.id });
    db.prepare(`UPDATE jobs SET state = 'failed' WHERE id = ?`).run(running.id);
  });

  it('l\'avvio congela le fonti scelte e gli strumenti di quelle che si leggono davvero (toolsOf)', async () => {
    completePost();
    const started = await send('POST', '/api/profile/generate', { exclude: ['website'] });
    expect(started.status).toBe(202);
    const job = await waitTerminal(started.body.job.id);
    expect(job.params).toEqual({ sources: ['linkedin', 'posts'], force: [] });
    expect(findJob(job.id)!.tools).toEqual(['apify', 'anthropic']);
  });

  it('"Riprova…" su una generazione fallita = la stessa anteprima della route, fonti comprese (D12)', async () => {
    completePost();
    const started = await send('POST', '/api/profile/generate', { exclude: ['posts'], force: [] });
    const failed = await waitTerminal(started.body.job.id);
    expect(failed.state).toBe('failed');

    const retry = await send('GET', `/api/jobs/${failed.id}/retry-preview`);
    const route = await send('GET', '/api/profile/generate/preview?exclude=posts');
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual(route.body);
    expect(retry.body.sources.find((s: any) => s.kind === 'posts').state).toBe('excluded');
  });
});

describe('stima: prima "non disponibile", poi il prezzo (D2–D5, T25)', () => {
  async function withPrices<T>(prices: { detail: number | null; generation: number | null }, fn: () => Promise<T>): Promise<T> {
    const saved = { ...config.prices };
    config.prices.profileDetailUsd = prices.detail;
    config.prices.profileGenerationUsd = prices.generation;
    try {
      return await fn();
    } finally {
      Object.assign(config.prices, saved);
    }
  }

  it('tdd_target: senza le variabili di prezzo l\'anteprima dichiara "stima non disponibile" e i conteggi di letture e pagine restano veri', async () => {
    completePost();
    const { body } = await withPrices({ detail: null, generation: null }, () => send('GET', '/api/profile/generate/preview'));
    expect(body.est_cost_usd).toBeNull();
    expect(body.missing_prices).toEqual(['PRICE_PROFILE_DETAIL_USD', 'PRICE_PROFILE_GENERATION_USD']);
    expect(body.counts).toMatchObject({ profile_reads: 1, site_max_pages: 10, posts_complete: 1, generations: 1 });
    expect(body.sources.map((s: any) => [s.kind, s.est_cost_usd])).toEqual([
      ['linkedin', null],
      ['website', 0],
      ['posts', 0],
    ]);
    expect(body.processing).toEqual({ model: 'claude-opus-5', est_cost_usd: null });
  });

  it('con i prezzi la stima è la somma per fonte; sito e post non costano denaro', async () => {
    completePost();
    const { body } = await withPrices({ detail: 0.01, generation: 0.05 }, () => send('GET', '/api/profile/generate/preview'));
    expect(body.est_cost_usd).toBeCloseTo(0.06, 10);
    expect(body.missing_prices).toEqual([]);
    expect(body.sources.map((s: any) => s.est_cost_usd)).toEqual([0.01, 0, 0]);
    expect(body.processing).toEqual({ model: 'claude-opus-5', est_cost_usd: 0.05 });
  });

  it('escludere il profilo o riprenderlo fresco toglie il suo prezzo: nessun numero solo se manca un pezzo che serve', async () => {
    completePost();
    const excluded = await withPrices({ detail: null, generation: 0.05 }, () => send('GET', '/api/profile/generate/preview?exclude=linkedin'));
    expect(excluded.body.est_cost_usd).toBeCloseTo(0.05, 10);
    expect(excluded.body.missing_prices).toEqual([]);
    expect(excluded.body.sources[0]).toMatchObject({ state: 'excluded', est_cost_usd: 0 });

    db.prepare(
      `INSERT INTO profile_sources (kind, read_at, outcome, content, meta) VALUES ('linkedin', ?, 'read', 'Nome: Marta', ?)`,
    ).run(new Date().toISOString(), JSON.stringify({ address: PROFILE_URL }));
    const fresh = await withPrices({ detail: null, generation: 0.05 }, () => send('GET', '/api/profile/generate/preview'));
    expect(fresh.body.est_cost_usd).toBeCloseTo(0.05, 10);
    const forced = await withPrices({ detail: null, generation: 0.05 }, () => send('GET', '/api/profile/generate/preview?force=linkedin'));
    expect(forced.body.est_cost_usd).toBeNull();
    expect(forced.body.missing_prices).toEqual(['PRICE_PROFILE_DETAIL_USD']);
  });

  it('il modello dell\'elaborazione è PROFILE_MODEL se impostato, altrimenti quello dell\'analisi (G-3)', async () => {
    completePost();
    const saved = config.profileModel;
    config.profileModel = 'claude-sonnet-5-5';
    try {
      expect((await send('GET', '/api/profile/generate/preview')).body.processing.model).toBe('claude-sonnet-5-5');
    } finally {
      config.profileModel = saved;
    }
  });
});

// ---------------------------------------------------------------------------
// Elaborazione del modello e proposta salvata (E1, E2, E5, E6, E11, E13 — T26)
// ---------------------------------------------------------------------------

const { createService, listServices } = await import('../src/db/services.js');
const { getSettings } = await import('../src/db/settings.js');

/** Risposta del modello con la proposta data. */
const reply = (proposal: unknown) => () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(proposal) }] });

const field = (value: string, sources: string[] = ['linkedin']) => ({ value, sources });
const service = (name: string, sources: string[] = ['website'], extra: Record<string, string | null> = {}) => ({
  name,
  description: null,
  audience: null,
  problem: null,
  proof: null,
  ...extra,
  sources,
});

const GOOD = {
  fields: {
    company_name: field('Marta Fiorini', ['linkedin', 'website']),
    company_description: field('Product engineering freelance per startup B2B.', ['website']),
    company_offering: field('MVP in sei settimane, affiancamento del primo CTO, revisione architetturale.', ['website']),
    positioning: field('La product engineer che porta in produzione il primo prodotto di una startup B2B.', ['linkedin', 'website']),
    proof_points: field('14 MVP in quattro anni; Fatture Chiare: oltre un milione di ricavi annui.', ['linkedin', 'website']),
    tone_of_voice: field('Diretto, concreto, in prima persona.', ['posts']),
  },
  services: [
    service('MVP in sei settimane', ['website'], { audience: 'Startup B2B con il problema validato', problem: 'Arrivare al primo cliente pagante' }),
    service('Affiancamento del primo CTO', ['website', 'linkedin']),
  ],
};

/** Un run del job con le fonti di sempre (profilo, sito, post) e il modello che risponde `proposal`. */
async function generate(proposal: unknown, params = { sources: ['linkedin', 'website', 'posts'], force: [] }) {
  completePost();
  const run = deps({ reply: reply(proposal) });
  const job = insertJob('generate_profile', params, ['apify', 'cloudflare', 'anthropic']);
  const done = await runJob(job.id, { resolveDeps: () => run.deps });
  return { done, job, model: run.model };
}

const proposals = (): Array<Record<string, any>> =>
  (db.prepare(`SELECT * FROM profile_proposals ORDER BY id`).all() as Array<Record<string, any>>).map((r) => ({
    ...r,
    fields: JSON.parse(r.fields),
    services: JSON.parse(r.services),
    sources: JSON.parse(r.sources),
    discarded: JSON.parse(r.discarded),
  }));

describe('elaborazione e proposta (T26)', () => {
  it('tdd_target: una generazione riuscita crea la proposta e nessun valore del profilo cambia', async () => {
    updateSettings({ company_description: 'Scritta a mano.', positioning: 'Il mio posizionamento.' });
    createService({ name: 'Revisione architetturale' });
    const settingsBefore = getSettings();
    const servicesBefore = listServices();

    const { done, job, model } = await generate(GOOD);

    expect(done.state).toBe('succeeded');
    expect(model.requests).toHaveLength(1);
    expect(getSettings()).toEqual(settingsBefore);
    expect(listServices()).toEqual(servicesBefore);
    const [proposal] = proposals();
    expect(proposal).toMatchObject({ job_id: job.id, model: 'claude-opus-5' });
    expect(proposal!.fields.positioning).toEqual(GOOD.fields.positioning);
    expect(proposal!.services.map((s: any) => s.name)).toEqual(['MVP in sei settimane', 'Affiancamento del primo CTO']);
    expect(proposal!.sources.map((s: any) => [s.kind, s.outcome])).toEqual([
      ['linkedin', 'read'],
      ['website', 'read'],
      ['posts', 'read'],
    ]);
    expect(done.result).toMatchObject({
      summary: 'Proposta pronta: 6 campi del profilo e 2 servizi · fonti lette 3 su 3 · 1 post per intero.',
      counts: { proposal_id: proposal!.id, fields_proposed: 6, services_proposed: 2, discarded: 0, no_content: 0, poor: 0 },
      warnings: [],
    });
    expect(readRunLog(job.id).lines.map((l) => l.message)).toContain('Anthropic · elaborazione del profilo');
  });

  it('il modello riceve le fonti lette, i nomi dei servizi già scritti e la richiesta in italiano; mai il testo nel log', async () => {
    createService({ name: 'Revisione architetturale' });
    const { job, model } = await generate(GOOD);
    const body = model.requests[0] as any;
    expect(body.model).toBe('claude-opus-5');
    expect(body.system).toContain('in italiano');
    const user = body.messages[0].content as string;
    expect(user).toContain('<profilo_linkedin');
    expect(user).toContain('Il tuo MVP in produzione in sei settimane');
    expect(user).toContain('<post');
    expect(user).toContain('Revisione architetturale');
    expect(body.output_config.format.type).toBe('json_schema');
    expect(readRunLog(job.id).lines.map((l) => l.message).join('\n')).not.toContain('sei settimane');
  });

  it('E2, E5, E6: input proposti, voci senza fonte e servizi omonimi non entrano e si contano', async () => {
    const { done } = await generate({
      fields: {
        ...GOOD.fields,
        positioning: field('Senza fonte', []),
        // Una fonte che non è stata letta in questa generazione non conta come fonte.
        tone_of_voice: field('Da una fonte non letta', ['apollo']),
        own_profile_url: field('https://www.linkedin.com/in/altro', ['linkedin']),
        website_url: field('https://altro.example', ['website']),
      },
      services: [...GOOD.services, service('mvp  IN SEI settimane', ['linkedin']), service('Senza fonte', [])],
    });

    expect(done.state).toBe('succeeded');
    const [proposal] = proposals();
    expect(Object.keys(proposal!.fields).sort()).toEqual(['company_description', 'company_name', 'company_offering', 'proof_points']);
    expect(proposal!.services.map((s: any) => s.name)).toEqual(['MVP in sei settimane', 'Affiancamento del primo CTO']);
    expect(proposal!.discarded).toEqual([
      { kind: 'field', name: 'positioning', reason: 'no_source' },
      { kind: 'field', name: 'tone_of_voice', reason: 'no_source' },
      { kind: 'field', name: 'own_profile_url', reason: 'not_generable' },
      { kind: 'field', name: 'website_url', reason: 'not_generable' },
      { kind: 'service', name: 'mvp  IN SEI settimane', reason: 'duplicate' },
      { kind: 'service', name: 'Senza fonte', reason: 'no_source' },
    ]);
    expect(done.result!.counts).toMatchObject({ fields_proposed: 4, services_proposed: 2, discarded: 6 });
    expect(done.result!.summary).toBe(
      'Proposta pronta: 4 campi del profilo e 2 servizi · fonti lette 3 su 3 · 1 post per intero. 6 voci scartate: 3 senza fonte, 1 con un nome già proposto, 2 non generabili.',
    );
  });

  it('risposta non conforme anche al secondo tentativo ⇒ job fallito con errore leggibile per Anthropic, nessuna proposta, pendente intatta', async () => {
    const pending = pendingProposal();
    const { done, model } = await generate({ fields: 'non è un oggetto' });
    expect(model.requests).toHaveLength(2);
    expect(done.state).toBe('failed');
    expect(done.error).toBe('actor:claude-opus-5: Il modello ha risposto in una forma inattesa: nessuna proposta creata. Riprova.');
    expect(proposals().map((p) => p.id)).toEqual([pending]);
  });

  it('E11: una seconda generazione lascia una sola proposta pendente, la nuova', async () => {
    await generate(GOOD);
    const first = proposals()[0]!.id;
    await generate({ ...GOOD, services: [] });
    const all = proposals();
    expect(all).toHaveLength(1);
    expect(all[0]!.id).not.toBe(first);
  });

  it('proposta povera (nessun servizio, pochi campi) ⇒ esito neutro coi suoi sbocchi gratis', async () => {
    const { done } = await generate({ fields: { company_name: field('Marta Fiorini') }, services: [] });
    expect(done.result).toMatchObject({
      summary: 'Proposta povera: 1 campo e nessun servizio. Le fonti lette dicono poco di cosa vendi.',
      counts: { poor: 1, fields_proposed: 1, services_proposed: 0 },
    });
    expect(proposals()).toHaveLength(1);
  });

  it('una fonte fallita ⇒ esito "Attenzione" con le altre lette, e l\'esito dichiara lo strumento della fonte (P-26)', async () => {
    completePost();
    const run = deps({ site: [() => jsonResponse(401, { success: false, errors: [] })], reply: reply(GOOD) });
    const job = insertJob('generate_profile', { sources: ['linkedin', 'website', 'posts'], force: [] }, ['apify', 'cloudflare', 'anthropic']);
    const done = await runJob(job.id, { resolveDeps: () => run.deps });

    expect(done.state).toBe('succeeded');
    expect(done.result!.summary).toMatch(/^Proposta pronta: .* · fonti lette 2 su 3 · /);
    expect(done.result!.warnings).toEqual([
      'Sito non letto: Cloudflare ha rifiutato le credenziali (401). Verifica CLOUDFLARE_API_TOKEN nel .env.',
    ]);
    expect(done.result!.tool_errors).toEqual({
      cloudflare: 'config: Cloudflare ha rifiutato le credenziali (401). Verifica CLOUDFLARE_API_TOKEN nel .env.',
    });
    // Il sito fallito non è fra le fonti mandate al modello.
    expect((run.model.requests[0] as any).messages[0].content).not.toContain('<sito');
  });
});
