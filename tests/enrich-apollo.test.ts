import { beforeEach, describe, expect, it } from 'vitest';

// Arricchimento con `provider: 'apollo'` (apollo-lookalike T10, SPEC G1–G7, F6). Import dinamici: la config
// (DB_PATH isolato e chiave Apollo finta da tests/setup.ts) è letta a import-time. Mai Apollo reale:
// `deps.matchPeople` è sempre un fake che restituisce JSON nella forma di `people/bulk_match`.
const { db } = await import('../src/db/index.js');
const { upsertProspect } = await import('../src/db/prospects.js');
const { timeline } = await import('../src/db/activities.js');
const { createApp } = await import('../src/server/app.js');
const { config } = await import('../src/config.js');
const jobs = await import('../src/server/jobs.js');
const { handler, planEnrichment, configBlockers, realDeps } = await import('../src/jobs/enrich.js');
const { alignMatches, creditsConsumed } = await import('../src/enrich/apollo-match.js');
const { ApolloRateLimitError, ApolloConfigError, ApolloProviderError } = await import('../src/apollo/client.js');

type Preview = import('../src/jobs/types.js').JobPreview;
type JobBody = { job: import('../src/server/jobs.js').Job };

const URL_A = 'https://www.linkedin.com/in/anna-senza-email';
const URL_B = 'https://www.linkedin.com/in/bruno-con-email';
const URL_C = 'https://www.linkedin.com/in/carla-cercata-ieri';
const URL_D = 'https://www.linkedin.com/in/dario-con-email-cercato-ieri';

const yesterday = () => new Date(Date.now() - 86_400_000).toISOString();

function reset(): void {
  db.exec('DELETE FROM prospects; DELETE FROM posts; DELETE FROM lists; DELETE FROM companies; DELETE FROM icps; DELETE FROM jobs;');
}

function row(id: number): any {
  return db.prepare('SELECT * FROM prospects WHERE id = ?').get(id);
}

function setMatchedAt(id: number, at: string | null, apolloPersonId?: string): void {
  db.prepare('UPDATE prospects SET apollo_matched_at = ?, apollo_person_id = COALESCE(?, apollo_person_id) WHERE id = ?').run(
    at,
    apolloPersonId ?? null,
    id,
  );
}

/** Record di `matches[]` come lo restituisce Apollo (campi usati dal mapper). */
function match(id: string, linkedinUrl: string, extra: Record<string, unknown> = {}) {
  return { id, linkedin_url: linkedinUrl, name: 'Persona Fittizia', title: 'CTO', organization: { name: 'Acme Srl' }, ...extra };
}

/** Fake di `deps.matchPeople`: una risposta (o un errore) in coda per lotto; registra i dettagli ricevuti. */
function fakeMatch(...responses: Array<unknown>) {
  const calls: unknown[][] = [];
  return {
    calls,
    enrich: async () => new Map(),
    matchPeople: async (details: unknown[]) => {
      calls.push(details);
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next ?? { matches: details.map(() => null), credits_consumed: 0 };
    },
  };
}

const apolloParams = (prospectIds: number[], retryFailed = false) =>
  ({ prospectIds, provider: 'apollo', onlyMissing: true, retryFailed }) as const;

/** Quattro prospect della validazione PLAN T10: A da cercare, B con email, C cercata ieri, D con email e cercato ieri. */
function seedFour() {
  const a = upsertProspect({ linkedinUrl: URL_A, enrichedAt: '2026-09-01T00:00:00.000Z', title: 'Titolo a mano' }).id;
  const b = upsertProspect({ linkedinUrl: URL_B, email: 'bruno@acme.it' }).id;
  const c = upsertProspect({ linkedinUrl: URL_C, enrichmentAttemptedAt: '2026-09-02T00:00:00.000Z' }).id;
  const d = upsertProspect({ linkedinUrl: URL_D, email: 'dario@acme.it' }).id;
  setMatchedAt(c, yesterday(), 'apollo-c');
  setMatchedAt(d, yesterday());
  return { a, b, c, d };
}

beforeEach(reset);

describe('tracer bullet: preview Apollo ed esito senza toccare lo stato "arricchito"', () => {
  it("la preview esclude chi ha già l'email e dichiara est_credits = target; il job non scrive enriched_at", async () => {
    const app = createApp();
    const a = upsertProspect({ linkedinUrl: URL_A }).id;
    const b = upsertProspect({ linkedinUrl: URL_B, email: 'bruno@acme.it' }).id;

    const res = await app.request(`/api/enrich/preview?prospectIds=${a},${b}&provider=apollo`);
    expect(res.status).toBe(200);
    const preview = (await res.json()) as Preview;
    expect(preview.counts).toMatchObject({ selected: 2, targets: 1, skipped_with_email: 1, skipped_fresh: 0, est_credits: 1 });
    expect(preview.blockers).toEqual([]);

    const deps = fakeMatch({ matches: [match('apollo-a', URL_A, { email: 'anna@acme.it' })], credits_consumed: 1 });
    const result = await handler(apolloParams([a, b]), deps);

    expect(deps.calls).toEqual([[{ linkedin_url: URL_A }]]);
    expect(result.counts).toMatchObject({ targets: 1, with_email: 1, unavailable: 0, already_had_email: 1, credits_used: 1 });
    expect(row(a)).toMatchObject({ email: 'anna@acme.it', enriched_at: null, enrichment_attempted_at: null });
    expect(row(a).apollo_matched_at).toBeTruthy();
  });
});

describe('piano e preview Apollo (SPEC G2, G3, C5)', () => {
  const app = createApp();
  const previewOf = async (qs: string) => (await (await app.request(`/api/enrich/preview?${qs}`)).json()) as Preview;

  it('4 prospect → 1 da cercare (retryFailed → 2); email prima della freschezza; costo null con warning, poi crediti × prezzo', async () => {
    const { a, b, c, d } = seedFour();
    const ids = `${a},${b},${c},${d},999999`;

    const preview = await previewOf(`prospectIds=${ids}&provider=apollo`);
    expect(preview).toEqual({
      counts: { selected: 4, targets: 1, skipped_with_email: 2, skipped_fresh: 1, not_found: 1, est_credits: 1 },
      est_cost_usd: null,
      warnings: [expect.stringMatching(/APOLLO_CREDIT_USD.*stima non disponibile/)],
      blockers: [],
      unit_prices: { apify: null, apollo: null },
    });

    const retry = await previewOf(`prospectIds=${ids}&provider=apollo&retryFailed=true&onlyMissing=false`);
    expect(retry.counts).toMatchObject({ selected: 4, targets: 2, skipped_with_email: 2, skipped_fresh: 0, est_credits: 2 });

    const saved = config.prices.apolloCreditUsd;
    config.prices.apolloCreditUsd = 0.1;
    try {
      expect(await previewOf(`prospectIds=${ids}&provider=apollo&retryFailed=true`)).toMatchObject({
        est_cost_usd: 0.2,
        warnings: [],
        unit_prices: { apify: null, apollo: 0.1 },
      });
    } finally {
      config.prices.apolloCreditUsd = saved;
    }
    expect(planEnrichment(apolloParams([a, b, c, d])).targets).toEqual([a]);
  });

  it('un esito Apollo più vecchio di FRESHNESS_DAYS si ricerca; `enriched_at`/tentativo Apify non contano', async () => {
    const c = upsertProspect({ linkedinUrl: URL_C, enrichedAt: '2026-09-01T00:00:00.000Z', enrichmentAttemptedAt: yesterday() }).id;
    setMatchedAt(c, new Date(Date.now() - (config.freshnessDays + 1) * 86_400_000).toISOString());
    expect(planEnrichment(apolloParams([c]))).toMatchObject({ targets: [c], skipped_fresh: 0, skipped_enriched: 0 });
  });

  it('ambito lista: membri senza email; lista archiviata → blocker', async () => {
    const { createIcp } = await import('../src/db/icps.js');
    const { createList, addMembers, updateList } = await import('../src/db/lists.js');
    const listId = createList({ icpId: createIcp({ name: 'CTO' }).id, name: 'CTO startup' })!.id;
    const { a, b } = seedFour();
    addMembers(listId, [a, b]);

    expect((await previewOf(`listId=${listId}&provider=apollo`)).counts).toMatchObject({ selected: 2, targets: 1, skipped_with_email: 1 });
    updateList(listId, { archived: true });
    // SPEC G3 / FLOW "Lista archiviata (C, D, E)": con Apollo il testo è quello del flusso contatti.
    expect((await previewOf(`listId=${listId}&provider=apollo`)).blockers).toEqual([
      "La lista 'CTO startup' è archiviata: riattivala per aggiungere persone.",
    ]);
    // Apify resta sul testo di crm-foundation.
    expect((await previewOf(`listId=${listId}&provider=apify`)).blockers).toEqual([
      'Lista archiviata: arricchimento disabilitato (lettura ed export restano possibili).',
    ]);
  });

  it('0 da cercare → blocker "Nessun profilo da cercare" (Apify resta un warning); provider non valido → 400', async () => {
    const b = upsertProspect({ linkedinUrl: URL_B, email: 'bruno@acme.it' }).id;
    const apollo = await previewOf(`prospectIds=${b}&provider=apollo`);
    expect(apollo.counts).toMatchObject({ targets: 0, est_credits: 0 });
    // SPEC C5/G3: senza prezzo configurato la stima è `null` anche a 0 crediti (mai "$0,00" inventato).
    expect(apollo.est_cost_usd).toBeNull();
    expect(apollo.warnings).toContain('Prezzo del credito Apollo non configurato (APOLLO_CREDIT_USD): stima non disponibile.');
    expect(apollo.blockers).toEqual(['Nessun profilo da cercare con queste opzioni.']);

    const price = config.prices.apolloCreditUsd;
    config.prices.apolloCreditUsd = 0.1;
    try {
      const priced = await previewOf(`prospectIds=${b}&provider=apollo`);
      expect(priced.est_cost_usd).toBe(0);
      expect(priced.warnings).toEqual([]);
    } finally {
      config.prices.apolloCreditUsd = price;
    }

    upsertProspect({ linkedinUrl: URL_B, enrichedAt: '2026-09-01T00:00:00.000Z' });
    const apify = await previewOf(`prospectIds=${b}&provider=apify`);
    expect(apify.blockers).toEqual([]);
    expect(apify.warnings).toContain('Nessun profilo da arricchire con queste opzioni.');
    expect(apify.counts).toEqual({ selected: 1, targets: 0, skipped_enriched: 1, skipped_fresh: 0, not_found: 0 });

    expect((await app.request(`/api/enrich/preview?prospectIds=${b}&provider=hunter`)).status).toBe(400);
  });

  it('chiave Apollo mancante → blocker solo con provider apollo; `configBlockers` esportata per provider', async () => {
    const a = upsertProspect({ linkedinUrl: URL_A }).id;
    const saved = config.apolloApiKey;
    config.apolloApiKey = '';
    try {
      expect((await previewOf(`prospectIds=${a}&provider=apollo`)).blockers).toEqual(['APOLLO_API_KEY mancante nel .env — nessun job avviato.']);
      expect((await previewOf(`prospectIds=${a}`)).blockers).toEqual([]);
      expect(configBlockers(apolloParams([a]))).toEqual(['APOLLO_API_KEY mancante nel .env — nessun job avviato.']);
      expect(configBlockers({ prospectIds: [a] })).toEqual([]);
    } finally {
      config.apolloApiKey = saved;
    }
    const savedToken = config.apifyToken;
    config.apifyToken = '';
    try {
      expect(configBlockers({ prospectIds: [a], provider: 'apify' })).toEqual([expect.stringMatching(/^APIFY_TOKEN mancante/)]);
      expect(configBlockers(apolloParams([a]))).toEqual([]);
    } finally {
      config.apifyToken = savedToken;
    }
  });
});

describe('avvio Apollo: route su tutte le forme (SPEC G1, I1)', () => {
  /** Figlio fittizio che resta vivo 200 ms ed esce: nessun handler reale, nessun Apollo. */
  const app = createApp({ jobs: { command: 'node', args: ['-e', 'setTimeout(() => {}, 200)'] } });
  const post = (path: string, body?: unknown) =>
    app.request(path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    });

  async function waitTerminal(id: number) {
    const deadline = Date.now() + 5000;
    while (jobs.getJob(id)?.state === 'running') {
      if (Date.now() > deadline) throw new Error(`job ${id} ancora running`);
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  it('prospect, selezione e lista → 202 con provider esplicito e onlyMissing forzato a true; body non valido 400', async () => {
    const { createIcp } = await import('../src/db/icps.js');
    const { createList, addMembers } = await import('../src/db/lists.js');
    const a = upsertProspect({ linkedinUrl: URL_A }).id;
    const listId = createList({ icpId: createIcp({ name: 'CTO' }).id, name: 'CTO startup' })!.id;
    addMembers(listId, [a]);

    const single = await post(`/api/prospects/${a}/enrich`, { provider: 'apollo', retryFailed: true });
    expect(single.status).toBe(202);
    const singleJob = ((await single.json()) as JobBody).job;
    expect(singleJob.params).toEqual({ prospectIds: [a], provider: 'apollo', onlyMissing: true, retryFailed: true });
    await waitTerminal(singleJob.id);

    const bulk = await post('/api/enrich', { prospectIds: [a, a], provider: 'apollo', onlyMissing: false });
    expect(bulk.status).toBe(202);
    const bulkJob = ((await bulk.json()) as JobBody).job;
    expect(bulkJob.params).toEqual({ prospectIds: [a], provider: 'apollo', onlyMissing: true, retryFailed: false });
    await waitTerminal(bulkJob.id);

    const list = await post(`/api/lists/${listId}/enrich`, { provider: 'apollo' });
    expect(list.status).toBe(202);
    const listJob = ((await list.json()) as JobBody).job;
    expect(listJob.params).toEqual({ listId, provider: 'apollo', onlyMissing: true, retryFailed: false });
    await waitTerminal(listJob.id);

    const apify = await post('/api/enrich', { prospectIds: [a], provider: 'apify' });
    expect(apify.status).toBe(202);
    const apifyJob = ((await apify.json()) as JobBody).job;
    expect(apifyJob.params).toEqual({ prospectIds: [a], provider: 'apify', onlyMissing: true, retryFailed: false });
    await waitTerminal(apifyJob.id);

    expect((await post('/api/enrich', { prospectIds: [a], provider: 'hunter' })).status).toBe(400);
    expect((await post(`/api/prospects/${a}/enrich`, { provider: 'APOLLO' })).status).toBe(400);
    expect((await post(`/api/lists/${listId}/enrich`, { provider: 'apollo', extra: true })).status).toBe(400);
  });

  it('0 da cercare → POST 400 `blocked` su tutte le forme, nessun job creato', async () => {
    const { createIcp } = await import('../src/db/icps.js');
    const { createList, addMembers } = await import('../src/db/lists.js');
    const b = upsertProspect({ linkedinUrl: URL_B, email: 'bruno@acme.it' }).id;
    const c = upsertProspect({ linkedinUrl: URL_C }).id;
    setMatchedAt(c, yesterday());
    const listId = createList({ icpId: createIcp({ name: 'CTO' }).id, name: 'CTO startup' })!.id;
    addMembers(listId, [b, c]);

    for (const [path, body] of [
      [`/api/prospects/${b}/enrich`, { provider: 'apollo' }],
      ['/api/enrich', { prospectIds: [b, c], provider: 'apollo' }],
      [`/api/lists/${listId}/enrich`, { provider: 'apollo' }],
    ] as const) {
      const res = await post(path, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'blocked', blockers: ['Nessun profilo da cercare con queste opzioni.'] });
    }
    expect(db.prepare('SELECT COUNT(*) FROM jobs').pluck().get()).toBe(0);

    // "Riprova anche quelli senza risultato" rende C di nuovo cercabile.
    const retry = await post('/api/enrich', { prospectIds: [b, c], provider: 'apollo', retryFailed: true });
    expect(retry.status).toBe(202);
    await waitTerminal(((await retry.json()) as JobBody).job.id);
  });

  it('APOLLO_API_KEY mancante → POST 400 `blocked` con il blocker della preview', async () => {
    const a = upsertProspect({ linkedinUrl: URL_A }).id;
    const saved = config.apolloApiKey;
    config.apolloApiKey = '';
    try {
      const res = await post('/api/enrich', { prospectIds: [a], provider: 'apollo' });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'blocked', blockers: ['APOLLO_API_KEY mancante nel .env — nessun job avviato.'] });
    } finally {
      config.apolloApiKey = saved;
    }
  });
});

describe('job Apollo: applicazione degli esiti (SPEC G4–G7, F6)', () => {
  it('validazione PLAN T10: retryFailed → 1 email trovata, 1 non disponibile; enriched_at invariato, apollo_matched_at scritta', async () => {
    const { a, b, c, d } = seedFour();
    const beforeC = row(c).apollo_matched_at;
    const deps = fakeMatch({
      matches: [match('apollo-a', URL_A, { email: 'anna@acme.it', title: 'CTO Apollo' }), match('apollo-c', URL_C, { email: null })],
      credits_consumed: 2,
    });

    const result = await handler(apolloParams([a, b, c, d], true), deps);

    // C ha già un id Apollo: si cerca per id; A per URL LinkedIn.
    expect(deps.calls).toEqual([[{ linkedin_url: URL_A }, { id: 'apollo-c' }]]);
    expect(result.counts).toEqual({
      selected: 4,
      targets: 2,
      with_email: 1,
      unavailable: 1,
      already_had_email: 2,
      skipped_fresh: 0,
      not_found: 0,
      not_searched: 0,
      apollo_id_taken: 0,
      credits_used: 2,
    });
    expect(result.warnings).toEqual([]);
    expect(result.summary).toBe(
      'Email via Apollo: 1 email di lavoro trovata · 1 non disponibile (contatti EU o dato assente) · 2 già presenti (saltate) · 2 crediti usati.',
    );

    // Solo campi mancanti: il titolo scritto a mano resta, l'azienda si riempie; mai lo stato "arricchito".
    expect(row(a)).toMatchObject({
      email: 'anna@acme.it',
      title: 'Titolo a mano',
      company_name: 'Acme Srl',
      apollo_person_id: 'apollo-a',
      enriched_at: '2026-09-01T00:00:00.000Z',
      enrichment_attempted_at: null,
    });
    expect(row(c)).toMatchObject({ email: null, title: 'CTO', enriched_at: null, enrichment_attempted_at: '2026-09-02T00:00:00.000Z' });
    expect(row(a).apollo_matched_at).toBeTruthy();
    expect(Date.parse(row(c).apollo_matched_at)).toBeGreaterThan(Date.parse(beforeC));
    expect(row(b).apollo_matched_at).toBeNull();

    expect(timeline(a)).toEqual([
      expect.objectContaining({
        kind: 'enrichment',
        body: 'Arricchimento via Apollo: email di lavoro trovata',
        meta: { provider: 'apollo', outcome: 'email_found', with_email: true },
      }),
    ]);
    expect(timeline(c)).toEqual([
      expect.objectContaining({
        body: 'Arricchimento via Apollo: nessuna email disponibile',
        meta: { provider: 'apollo', outcome: 'no_email', with_email: false },
      }),
    ]);
    expect(timeline(b)).toEqual([]);
  });

  it("dopo l'Apollo l'analisi in bulk conta ancora il prospect come da arricchire", async () => {
    const { createIcp } = await import('../src/db/icps.js');
    const icp = createIcp({ name: 'CTO startup IT', target_roles: ['CTO'] }).id;
    const a = upsertProspect({ linkedinUrl: URL_A }).id;
    await handler(apolloParams([a]), fakeMatch({ matches: [match('apollo-a', URL_A, { email: 'anna@acme.it' })], credits_consumed: 1 }));

    const res = await createApp().request(`/api/analyze/preview?prospectIds=${a}&icpId=${icp}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as Preview).counts).toMatchObject({ selected: 1, to_enrich: 1 });
    expect(row(a)).toMatchObject({ email: 'anna@acme.it', enriched_at: null });
  });

  it('matches allineati per posizione con un null in mezzo e la stessa persona ripetuta', async () => {
    const ids = [URL_A, URL_B, URL_C].map((linkedinUrl) => upsertProspect({ linkedinUrl }).id);
    const [a, b, c] = ids;
    const deps = fakeMatch({
      matches: [match('apollo-a', URL_A, { email: 'anna@acme.it' }), null, match('apollo-c', URL_C, { email: 'carla@acme.it' })],
      credits_consumed: 2,
    });

    const result = await handler(apolloParams(ids), deps);

    expect(result.counts).toMatchObject({ targets: 3, with_email: 2, unavailable: 1, credits_used: 2 });
    expect(row(a)).toMatchObject({ email: 'anna@acme.it', apollo_person_id: 'apollo-a' });
    expect(row(b)).toMatchObject({ email: null, apollo_person_id: null, title: null });
    expect(row(b).apollo_matched_at).toBeTruthy();
    expect(row(c)).toMatchObject({ email: 'carla@acme.it', apollo_person_id: 'apollo-c' });

    // Stessa persona per due dettagli: entrambi ricevono l'email, l'id Apollo resta al primo (F6).
    reset();
    const x = upsertProspect({ linkedinUrl: URL_A }).id;
    const y = upsertProspect({ linkedinUrl: URL_D }).id;
    const same = match('apollo-x', URL_A, { email: 'anna@acme.it' });
    const repeated = await handler(apolloParams([x, y]), fakeMatch({ matches: [same, same], credits_consumed: 1 }));
    expect(repeated.counts).toMatchObject({ with_email: 2, apollo_id_taken: 1, credits_used: 1 });
    expect(row(y)).toMatchObject({ email: 'anna@acme.it', apollo_person_id: null });
  });

  it('id Apollo già di un altro prospect → non scritto, `apollo_id_taken` 1 (anche senza email)', async () => {
    const owner = upsertProspect({ linkedinUrl: URL_B, email: 'bruno@acme.it' }).id;
    setMatchedAt(owner, null, 'apollo-shared');
    const a = upsertProspect({ linkedinUrl: URL_A }).id;

    const result = await handler(apolloParams([a]), fakeMatch({ matches: [match('apollo-shared', URL_A)], credits_consumed: 1 }));

    expect(result.counts).toMatchObject({ unavailable: 1, apollo_id_taken: 1 });
    expect(result.summary).toMatch(/1 con id Apollo già assegnato/);
    expect(row(a)).toMatchObject({ apollo_person_id: null, title: 'CTO', company_name: 'Acme Srl' });
    expect(row(owner).apollo_person_id).toBe('apollo-shared');
    expect(timeline(a)[0].meta).toEqual({ provider: 'apollo', outcome: 'no_email', with_email: false, apollo_id_taken: true });
  });

  it('segnaposto email bloccata di Apollo → nessuna email salvata (non disponibile)', async () => {
    const a = upsertProspect({ linkedinUrl: URL_A }).id;
    const result = await handler(
      apolloParams([a]),
      fakeMatch({ matches: [match('apollo-a', URL_A, { email: 'email_not_unlocked@domain.com' })], credits_consumed: 1 }),
    );
    expect(result.counts).toMatchObject({ with_email: 0, unavailable: 1 });
    expect(row(a).email).toBeNull();
  });

  it('lotti da 10: al momento del lotto chi ha ricevuto un’email o è sparito non si manda ad Apollo', async () => {
    const ids = Array.from({ length: 12 }, (_, i) => upsertProspect({ linkedinUrl: `https://www.linkedin.com/in/persona-${i}` }).id);
    const deps = fakeMatch();
    const original = deps.matchPeople;
    deps.matchPeople = async (details) => {
      if (deps.calls.length === 0) {
        // Durante il primo lotto: l'undicesimo riceve un'email a mano, il dodicesimo sparisce.
        db.prepare('UPDATE prospects SET email = ? WHERE id = ?').run('manuale@acme.it', ids[10]);
        db.prepare('DELETE FROM prospects WHERE id = ?').run(ids[11]);
      }
      return original(details);
    };

    const result = await handler(apolloParams(ids), deps);

    expect(deps.calls.map((c) => c.length)).toEqual([10]);
    expect(result.counts).toMatchObject({ targets: 12, unavailable: 10, already_had_email: 1, not_found: 1, not_searched: 0 });
  });
});

describe('job Apollo: errori ed esiti parziali (SPEC G6, G7, D13)', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => upsertProspect({ linkedinUrl: `https://www.linkedin.com/in/lotto-${i}` }).id);
  const allNull = (n: number) => ({ matches: Array.from({ length: n }, () => null), credits_consumed: 0 });

  it('errore del provider sul solo lotto → job fallito con errore attribuito, nessuna scrittura', async () => {
    const a = upsertProspect({ linkedinUrl: URL_A }).id;
    const deps = fakeMatch(new ApolloProviderError('actor:apollo:people/bulk_match: HTTP 502', 'people/bulk_match', 502));

    await expect(handler(apolloParams([a]), deps)).rejects.toThrow(/^actor:apollo:people\/bulk_match: HTTP 502$/);
    expect(row(a).apollo_matched_at).toBeNull();
    expect(timeline(a)).toEqual([]);

    await expect(handler(apolloParams([a]), fakeMatch(new Error('socket hang up')))).rejects.toThrow(
      /^actor:apollo:people\/bulk_match: socket hang up$/,
    );
    await expect(handler(apolloParams([a]), fakeMatch({ unexpected: true }))).rejects.toThrow(/risposta senza matches/);
  });

  it('errore sul secondo lotto → riuscito parziale: quei prospect restano "da cercare" con warning', async () => {
    const ids = many(15);
    const deps = fakeMatch(allNull(10), new ApolloProviderError('actor:apollo:people/bulk_match: HTTP 500', 'people/bulk_match', 500));

    const result = await handler(apolloParams(ids), deps);

    expect(result.counts).toMatchObject({ targets: 15, unavailable: 10, not_searched: 5 });
    expect(result.warnings).toEqual([
      'Errore Apollo su una parte dei profili: 10 email cercate su 15 · 0 trovate. I 5 restanti restano "da cercare" (actor:apollo:people/bulk_match: HTTP 500).',
    ]);
    expect(result.summary).toMatch(/5 restano da cercare/);
    for (const id of ids.slice(10)) expect(row(id).apollo_matched_at).toBeNull();
    expect(planEnrichment(apolloParams(ids)).targets).toEqual(ids.slice(10));
  });

  it('errore isolato sul primo lotto e successo sul secondo → parziale (isolamento per lotto)', async () => {
    const ids = many(12);
    const deps = fakeMatch(new ApolloProviderError('actor:apollo:people/bulk_match: HTTP 503', 'people/bulk_match', 503), allNull(2));
    const result = await handler(apolloParams(ids), deps);
    expect(deps.calls).toHaveLength(2);
    expect(result.counts).toMatchObject({ unavailable: 2, not_searched: 10 });
    expect(result.warnings).toHaveLength(1);
  });

  it('limite Apollo con finestra dopo un lotto → parziale "Limite Apollo raggiunto", nessuna chiamata successiva', async () => {
    const ids = many(25);
    const limit = new ApolloRateLimitError(
      'actor:apollo:people/bulk_match: limite orario di Apollo esaurito (100 richieste/ora): riprova più tardi',
      'people/bulk_match',
      0,
      'hourly',
    );
    const first = { matches: ids.slice(0, 10).map((_, i) => (i < 7 ? match(`p-${i}`, `https://www.linkedin.com/in/lotto-${i}`, { email: `p${i}@acme.it` }) : null)), credits_consumed: 7 };
    const deps = fakeMatch(first, limit);

    const result = await handler(apolloParams(ids), deps);

    expect(deps.calls).toHaveLength(2);
    expect(result.counts).toMatchObject({ targets: 25, with_email: 7, unavailable: 3, not_searched: 15, credits_used: 7 });
    expect(result.warnings).toEqual([
      'Limite Apollo raggiunto: 10 email cercate su 25 · 7 trovate. I 15 restanti restano "da cercare" (actor:apollo:people/bulk_match: limite orario di Apollo esaurito (100 richieste/ora): riprova più tardi).',
    ]);
    for (const id of ids.slice(10)) expect(row(id).apollo_matched_at).toBeNull();
  });

  it('limite o chiave rifiutata prima di qualunque lotto → job fallito con l’errore attribuito (config: resta config:)', async () => {
    const ids = many(12);
    const limit = new ApolloRateLimitError('actor:apollo:people/bulk_match: limite di richieste raggiunto (3 tentativi)', 'people/bulk_match', 3);
    const limited = fakeMatch(limit);
    await expect(handler(apolloParams(ids), limited)).rejects.toThrow(/^actor:apollo:people\/bulk_match: limite di richieste/);
    expect(limited.calls).toHaveLength(1);

    const denied = fakeMatch(new ApolloConfigError('config: chiave Apollo rifiutata (401). Verifica APOLLO_API_KEY nel .env.', 'people/bulk_match', 401));
    await expect(handler(apolloParams(ids), denied)).rejects.toThrow(/^config: chiave Apollo rifiutata/);
    expect(denied.calls).toHaveLength(1);
  });

  it('configurazione in cima: chiave mancante, deps senza matchPeople, lista archiviata → `config:` senza chiamate', async () => {
    const a = upsertProspect({ linkedinUrl: URL_A }).id;
    const deps = fakeMatch();
    const saved = config.apolloApiKey;
    config.apolloApiKey = '';
    try {
      await expect(handler(apolloParams([a]), deps)).rejects.toThrow(/^config: APOLLO_API_KEY mancante/);
    } finally {
      config.apolloApiKey = saved;
    }
    await expect(handler(apolloParams([a]), { enrich: deps.enrich })).rejects.toThrow(/^config: provider Apollo non disponibile/);

    const { createIcp } = await import('../src/db/icps.js');
    const { createList, updateList } = await import('../src/db/lists.js');
    const listId = createList({ icpId: createIcp({ name: 'CTO' }).id, name: 'Archiviata' })!.id;
    updateList(listId, { archived: true });
    await expect(handler({ listId, provider: 'apollo', onlyMissing: true, retryFailed: false }, deps)).rejects.toThrow(/^config: la lista "Archiviata" è archiviata/);
    expect(deps.calls).toEqual([]);
  });

  it('realDeps senza chiave → `config:` dal client, senza rete; handler registrato via runJob', async () => {
    const saved = config.apolloApiKey;
    config.apolloApiKey = '';
    try {
      await expect(realDeps().matchPeople!([{ linkedin_url: URL_A }])).rejects.toThrow(/^config: APOLLO_API_KEY mancante/);
    } finally {
      config.apolloApiKey = saved;
    }

    const { runJob } = await import('../src/server/job-entry.js');
    const { insertJob } = await import('../src/db/jobs.js');
    const a = upsertProspect({ linkedinUrl: URL_A }).id;
    const job = insertJob('enrich', apolloParams([a]));
    const done = await runJob(job.id, {
      resolveDeps: () => fakeMatch({ matches: [match('apollo-a', URL_A, { email: 'anna@acme.it' })], credits_consumed: 1 }),
    });
    expect(done.state).toBe('succeeded');
    expect(done.result?.counts).toMatchObject({ with_email: 1, credits_used: 1 });
    expect(done.result?.summary).toBe(
      'Email via Apollo: 1 email di lavoro trovata · 0 non disponibili (contatti EU o dato assente) · 1 credito usato.',
    );
  });
});

describe('allineamento e crediti (puri)', () => {
  it('lunghezza diversa dai dettagli → abbinamento per chiave (id o URL), mai per posizione', () => {
    const details = [{ linkedin_url: 'https://it.linkedin.com/in/Anna-Senza-Email/' }, { id: 'apollo-b' }, { id: 'apollo-x' }];
    const people = alignMatches(details, { matches: [match('apollo-b', URL_B), match('apollo-a', URL_A)] });
    expect(people?.map((p) => p?.apolloId)).toEqual(['apollo-a', 'apollo-b', undefined]);
    expect(alignMatches(details, { people: [] })).toBeNull();
  });

  it('crediti: `credits_consumed` se numerico, altrimenti persone distinte abbinate', () => {
    const same = match('apollo-a', URL_A);
    const people = alignMatches([{ id: 'apollo-a' }, { linkedin_url: URL_A }, { id: 'z' }], { matches: [same, same, null] })!;
    expect(creditsConsumed({ credits_consumed: 5 }, people)).toBe(5);
    expect(creditsConsumed({ credits_consumed: 0 }, people)).toBe(0);
    expect(creditsConsumed({}, people)).toBe(1);
  });
});
