import { describe, expect, it } from 'vitest';

// Job `apollo_people` (apollo-lookalike T8, S-6): ricerca gratuita per azienda + `people/bulk_match` per id.
// Import dinamici: la config (DB_PATH isolato da tests/setup.ts) è letta a import-time. Mai Apollo reale:
// `searchPeople`/`matchPeople` sono sempre fake che restituiscono JSON nella forma delle fixture.
const { db } = await import('../src/db/index.js');
const { config } = await import('../src/config.js');
const { createApp } = await import('../src/server/app.js');
const { ApolloPeopleError, handler, runApolloPeople, shortDateText } = await import('../src/jobs/apollo-people.js');
const { CONFIG_BLOCKERS } = await import('../src/jobs/handlers.js');
const { createIcp } = await import('../src/db/icps.js');
const { addMembers, createList, updateList } = await import('../src/db/lists.js');
const { createCompany } = await import('../src/db/companies.js');
const { addSource, upsertProspect } = await import('../src/db/prospects.js');
const { lastContactsByCompany } = await import('../src/db/candidates.js');
const { insertJob, setJobPid, completeJob } = await import('../src/db/jobs.js');
const { runJob } = await import('../src/server/job-entry.js');
const { getJob } = await import('../src/server/jobs.js');
const { ApolloConfigError, ApolloProviderError, ApolloRateLimitError } = await import('../src/apollo/client.js');

const app = createApp();

async function send(method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
  });
  return { status: res.status, body: (await res.json()) as any };
}

let seq = 0;

type CompanySpec = { name: string; domain?: string | null };

/** ICP + lista + aziende (dominio univoco per test; `domain: null` = solo URL LinkedIn). */
function scenario(opts: { roles?: string[]; locations?: string[]; companies?: CompanySpec[] } = {}) {
  seq += 1;
  const icp = createIcp({ name: `ICP contatti ${seq}`, target_roles: opts.roles ?? ['CTO'], target_locations: opts.locations ?? [] });
  const list = createList({ icpId: icp.id, name: `Lista contatti ${seq}` })!;
  const companies = (opts.companies ?? [{ name: 'Acme' }]).map((c) =>
    createCompany(
      c.domain === null
        ? { name: c.name, linkedin_url: `https://www.linkedin.com/company/${c.name.toLowerCase()}-${seq}` }
        : { name: c.name, domain: c.domain ?? `${c.name.toLowerCase()}-${seq}.it` },
    ),
  );
  return { icp, list, companies };
}

/** Persona come la restituisce `mixed_people/api_search` (niente URL LinkedIn). */
function searchItem(id: string, title = 'CTO') {
  return { id, first_name: `Nome ${id}`, last_name_obfuscated: 'Ro***i', title, has_email: true, organization: { name: 'Org' } };
}

/** Persona rivelata da `people/bulk_match` (`url: null` = Apollo non ha il profilo LinkedIn). */
function matchItem(id: string, fields: { url?: string | null; email?: string; title?: string } = {}) {
  return {
    id,
    name: `Persona ${id}`,
    first_name: 'Persona',
    last_name: id,
    title: fields.title ?? 'CTO',
    city: 'Milano',
    country: 'Italy',
    ...(fields.url === null ? {} : { linkedin_url: fields.url ?? profileUrl(id) }),
    ...(fields.email ? { email: fields.email, email_status: 'verified' } : {}),
    organization: { name: 'Org Apollo', primary_domain: 'org.it' },
  };
}

function profileUrl(id: string): string {
  return `http://www.linkedin.com/in/persona-${id.toLowerCase()}`;
}

type Deps = import('../src/jobs/apollo-people.js').Deps;

/**
 * Deps fake: per dominio gli id trovati dalla ricerca, per id il record rivelato (assente = `null`).
 * `credits_consumed` = record non nulli, salvo `credits` o `noCredits`. `fail` intercetta le chiamate.
 */
function fakeDeps(
  people: Record<string, string[]>,
  matches: Record<string, unknown>,
  opts: { credits?: number; noCredits?: boolean; failSearch?: (domain: string) => Error | undefined; failMatch?: (n: number) => Error | undefined } = {},
) {
  const searches: any[] = [];
  const matchCalls: any[][] = [];
  const deps: Deps = {
    searchPeople: async (params) => {
      searches.push(params);
      const error = opts.failSearch?.(params.domain);
      if (error) throw error;
      const ids = people[params.domain] ?? [];
      return { total_entries: ids.length, people: ids.map((id) => searchItem(id)) };
    },
    matchPeople: async (details) => {
      matchCalls.push(details);
      const error = opts.failMatch?.(matchCalls.length);
      if (error) throw error;
      const found = details.map((d) => (d.id ? (matches[d.id] ?? null) : null));
      return {
        status: 'success',
        ...(opts.noCredits ? {} : { credits_consumed: opts.credits ?? found.filter(Boolean).length }),
        matches: found,
      };
    },
  };
  return { deps, searches, matchCalls };
}

function params(s: ReturnType<typeof scenario>, overrides: Record<string, unknown> = {}) {
  return {
    icpId: s.icp.id,
    companyIds: s.companies.map((c) => c.id),
    listId: s.list.id,
    roles: ['CTO'],
    seniorities: [] as string[],
    locations: [] as string[],
    perCompany: 10,
    ...overrides,
  };
}

function members(listId: number): number[] {
  return db.prepare('SELECT prospect_id FROM list_members WHERE list_id = ? ORDER BY prospect_id').pluck().all(listId) as number[];
}

function prospectByUrl(url: string): any {
  return db.prepare('SELECT * FROM prospects WHERE linkedin_url = ?').get(url.replace('http://', 'https://'));
}

function apolloSources(companyIds: number[]): any[] {
  return db
    .prepare(`SELECT * FROM sources WHERE kind = 'apollo_people' AND company_id IN (${companyIds.join(',')}) ORDER BY id`)
    .all() as any[];
}

describe('apollo_people (job)', () => {
  it('RED: aggiunge alla lista i prospect rivelati con URL; senza URL saltati; crediti da credits_consumed; 1 ricerca + 1 match', async () => {
    const s = scenario();
    const [acme] = s.companies;
    const { deps, searches, matchCalls } = fakeDeps(
      { [acme.domain!]: [`a1-${seq}`, `a2-${seq}`, `a3-${seq}`] },
      { [`a1-${seq}`]: matchItem(`a1-${seq}`, { email: 'a1@acme.it' }), [`a2-${seq}`]: matchItem(`a2-${seq}`), [`a3-${seq}`]: matchItem(`a3-${seq}`, { url: null }) },
      { credits: 3 },
    );

    const result = await handler(params(s), deps);

    expect(searches).toEqual([{ domain: acme.domain, titles: ['CTO'], seniorities: [], locations: [], perPage: 10 }]);
    expect(matchCalls).toEqual([[{ id: `a1-${seq}` }, { id: `a2-${seq}` }, { id: `a3-${seq}` }]]);
    expect(result.counts).toMatchObject({ skipped_no_url: 1, credits_used: 3, requests: 2, added: 2, prospects_new: 2 });
    expect(members(s.list.id)).toHaveLength(2);
  });

  it('2 aziende, 6 persone (1 senza URL, 1 id Apollo già di un altro, 1 già in lista) → conteggi, backfill, email e apollo_matched_at; rilancio idempotente', async () => {
    const s = scenario({ companies: [{ name: 'Acme' }, { name: 'Beta' }] });
    const [acme, beta] = s.companies;
    const other = createCompany({ name: 'Altra', domain: `altra-${seq}.it` });
    const id = (k: string) => `${k}-${seq}`;

    // Un altro prospect possiede già l'id Apollo di a3.
    const owner = upsertProspect({ linkedinUrl: `https://www.linkedin.com/in/proprietario-${seq}`, apolloPersonId: id('a3') });
    // b1: già in lista, email e azienda già presenti (non si sovrascrivono).
    const b1 = upsertProspect({ linkedinUrl: profileUrl(id('b1')), email: 'old@beta.it', companyId: other.id }).id;
    addMembers(s.list.id, [b1]);
    // b2: già in archivio (non in lista), titolo scritto a mano, senza email.
    const b2 = upsertProspect({ linkedinUrl: profileUrl(id('b2')), title: 'Titolo a mano' }).id;

    const { deps } = fakeDeps(
      { [acme.domain!]: [id('a1'), id('a2'), id('a3')], [beta.domain!]: [id('b1'), id('b2'), id('b3')] },
      {
        [id('a1')]: matchItem(id('a1'), { email: 'a1@acme.it' }),
        [id('a2')]: matchItem(id('a2'), { url: null, email: 'a2@acme.it' }),
        [id('a3')]: matchItem(id('a3')),
        [id('b1')]: matchItem(id('b1'), { email: 'new@beta.it' }),
        [id('b2')]: matchItem(id('b2'), { email: 'b2@beta.it', title: 'Head of Engineering' }),
        [id('b3')]: matchItem(id('b3')),
      },
    );

    const first = await handler(params(s), deps);
    expect(first.counts).toEqual({
      people_read: 6,
      people_matched: 6,
      companies_done: 2,
      companies: 2,
      without_domain: 0,
      added: 4,
      prospects_new: 3,
      prospects_seen: 2,
      already_in_list: 1,
      skipped_no_url: 1,
      apollo_id_taken: 1,
      with_email: 3,
      credits_used: 6,
      requests: 4,
    });
    expect(first.warnings).toEqual([]);
    expect(first.summary).toBe(
      `Contatti Apollo: 6 persone lette in 2 aziende · 4 aggiunte a '${s.list.name}' (3 nuove, 1 già in archivio) · 1 già in lista · ` +
        '1 senza profilo LinkedIn (saltata) · 1 con id Apollo già assegnato · 3 con email · 6 crediti usati.',
    );

    const a1 = prospectByUrl(profileUrl(id('a1')));
    expect(a1).toMatchObject({
      status: 'nuovo',
      email: 'a1@acme.it',
      company_id: acme.id,
      company_name: 'Acme',
      title: 'CTO',
      full_name: `Persona ${id('a1')}`,
      apollo_person_id: id('a1'),
    });
    expect(a1.apollo_matched_at).toEqual(expect.any(String));
    expect(prospectByUrl(profileUrl(id('a3')))).toMatchObject({ apollo_person_id: null, company_id: acme.id });
    expect(db.prepare('SELECT apollo_person_id FROM prospects WHERE id = ?').pluck().get(owner.id)).toBe(id('a3'));
    expect(db.prepare('SELECT * FROM prospects WHERE id = ?').get(b1)).toMatchObject({ email: 'old@beta.it', company_id: other.id });
    const b2Row = db.prepare('SELECT * FROM prospects WHERE id = ?').get(b2) as any;
    expect(b2Row).toMatchObject({ email: 'b2@beta.it', title: 'Titolo a mano', company_id: beta.id, company_name: 'Beta' });
    expect(b2Row.apollo_matched_at).toEqual(expect.any(String));
    // Nessun prospect senza URL LinkedIn (F8).
    expect(db.prepare('SELECT COUNT(*) FROM prospects WHERE email = ?').pluck().get('a2@acme.it')).toBe(0);
    expect(members(s.list.id)).toHaveLength(5);
    expect(apolloSources([acme.id, beta.id])).toHaveLength(5);

    // Rilancio: nessun doppione; la data della fonte segue l'ultima ricerca (E5).
    db.prepare(`UPDATE sources SET captured_at = '2026-01-01T00:00:00.000Z' WHERE kind = 'apollo_people' AND company_id IN (?, ?)`).run(acme.id, beta.id);
    const second = await handler(params(s), deps);
    expect(second.counts).toMatchObject({ added: 0, already_in_list: 5, prospects_new: 0, prospects_seen: 5, apollo_id_taken: 1, skipped_no_url: 1 });
    expect(second.summary).toBe(
      `Contatti Apollo: 6 persone lette in 2 aziende · nessuna aggiunta a '${s.list.name}' · 5 già in lista · ` +
        '1 senza profilo LinkedIn (saltata) · 1 con id Apollo già assegnato · 3 con email · 6 crediti usati.',
    );
    const sources = apolloSources([acme.id, beta.id]);
    expect(sources).toHaveLength(5);
    expect(sources.every((row) => row.captured_at > '2026-01-01T00:00:00.000Z')).toBe(true);
    expect(members(s.list.id)).toHaveLength(5);
    expect(lastContactsByCompany([acme.id, beta.id], s.list.id).get(acme.id)! > '2026-01-01T00:00:00.000Z').toBe(true);
  });

  it('match allineato per posizione: persona ripetuta e null; lotti da 10; tetto per azienda; crediti senza credits_consumed', async () => {
    const s = scenario();
    const [acme] = s.companies;
    const ids = Array.from({ length: 13 }, (_, i) => `c${i + 1}-${seq}`);
    const matches: Record<string, unknown> = Object.fromEntries(ids.map((k) => [k, matchItem(k)]));
    matches[ids[1]] = matchItem(ids[0]); // il 2º dettaglio rivela di nuovo la 1ª persona
    delete matches[ids[2]]; // il 3º non è noto ad Apollo → null
    const { deps, matchCalls } = fakeDeps({ [acme.domain!]: ids }, matches, { noCredits: true });

    const result = await handler(params(s, { perCompany: 12 }), deps);

    expect(matchCalls.map((batch) => batch.length)).toEqual([10, 2]);
    expect(matchCalls[1]).toEqual([{ id: ids[10] }, { id: ids[11] }]);
    expect(result.counts).toMatchObject({ people_read: 12, people_matched: 10, credits_used: 10, requests: 3, added: 10, prospects_new: 10 });
    expect(members(s.list.id)).toHaveLength(10);
  });

  it('rate limit alla 2ª azienda → succeeded parziale `companies_done 1`; errore del provider dopo la 1ª → parziale attribuito', async () => {
    const s = scenario({ companies: [{ name: 'Acme' }, { name: 'Beta' }] });
    const [acme, beta] = s.companies;
    const people = { [acme.domain!]: [`r1-${seq}`, `r2-${seq}`], [beta.domain!]: [`r3-${seq}`] };
    const matches = { [`r1-${seq}`]: matchItem(`r1-${seq}`), [`r2-${seq}`]: matchItem(`r2-${seq}`), [`r3-${seq}`]: matchItem(`r3-${seq}`) };
    const limited = fakeDeps(people, matches, {
      failSearch: (domain) =>
        domain === beta.domain
          ? new ApolloRateLimitError('actor:apollo:mixed_people/api_search: limite di richieste raggiunto (3 tentativi)', 'mixed_people/api_search', 3)
          : undefined,
    });

    const job = insertJob('apollo_people', params(s));
    const done = await runJob(job.id, { resolveDeps: () => limited.deps });

    expect(done.state).toBe('succeeded');
    expect(done.result!.counts).toMatchObject({ companies_done: 1, companies: 2, added: 2, requests: 3, people_read: 2 });
    expect(done.result!.warnings).toEqual([
      `Limite Apollo raggiunto: completata 1 azienda su 2 · 2 aggiunte a '${s.list.name}'. Rilancia sulle stesse aziende: chi è già in lista non si duplica.`,
    ]);
    expect(done.result!.summary).toMatch(/^Contatti Apollo \(esito parziale\): 2 persone lette in 1 azienda su 2 · 2 aggiunte/);
    expect(members(s.list.id)).toHaveLength(2);

    const broken = fakeDeps(people, matches, {
      failSearch: (domain) => (domain === beta.domain ? new ApolloProviderError('actor:apollo:mixed_people/api_search: HTTP 502', 'mixed_people/api_search', 502) : undefined),
    });
    const partial = await runApolloPeople(params(s), broken.deps);
    expect(partial.counts.companies_done).toBe(1);
    expect(partial.warnings).toEqual([
      `actor:apollo:mixed_people/api_search: HTTP 502 · completata 1 azienda su 2 · nessuna aggiunta a '${s.list.name}'. ` +
        "I dati salvati fino all'errore restano validi: rilancia sulle stesse aziende, chi è già in lista non si duplica.",
    ]);
  });

  it('403 alla prima ricerca → job failed `config:` senza match né scritture; errore prima della 1ª azienda completata → failed attribuito', async () => {
    const s = scenario({ companies: [{ name: 'Acme' }, { name: 'Beta' }] });
    const [acme] = s.companies;
    const forbidden = fakeDeps({ [acme.domain!]: [`f1-${seq}`] }, { [`f1-${seq}`]: matchItem(`f1-${seq}`) }, {
      failSearch: () =>
        new ApolloConfigError(
          'config: la chiave Apollo non ha i permessi per mixed_people/api_search: usa una master key o una chiave con il permesso di ricerca persone (Apollo → Settings → API keys).',
          'mixed_people/api_search',
          403,
        ),
    });

    const job = insertJob('apollo_people', params(s));
    const done = await runJob(job.id, { resolveDeps: () => forbidden.deps });
    expect(done.state).toBe('failed');
    expect(done.error).toMatch(/^config: la chiave Apollo non ha i permessi per mixed_people\/api_search: .*API keys\)\. Nessun dato modificato\.$/);
    expect(forbidden.searches).toHaveLength(1);
    expect(forbidden.matchCalls).toHaveLength(0);
    expect(members(s.list.id)).toHaveLength(0);

    const matchDown = fakeDeps({ [acme.domain!]: [`f1-${seq}`] }, {}, {
      failMatch: () => new ApolloProviderError('actor:apollo:people/bulk_match: HTTP 500', 'people/bulk_match', 500),
    });
    await expect(runApolloPeople(params(s), matchDown.deps)).rejects.toThrow('actor:apollo:people/bulk_match: HTTP 500. Nessun dato modificato.');
  });

  it('AL-TD-5: lotto di match pagato e poi errore del provider sulla stessa azienda → failed con i crediti usati e i conteggi parziali sull\'errore', async () => {
    const s = scenario({ companies: [{ name: 'Acme' }, { name: 'Beta' }] });
    const [acme] = s.companies;
    const ids = Array.from({ length: 12 }, (_, i) => `p${i + 1}-${seq}`);
    // 1º lotto (10 dettagli): Apollo rivela 2 persone e le fa pagare; il 2º lotto va in errore.
    const paid = () =>
      fakeDeps({ [acme.domain!]: ids }, { [ids[0]]: matchItem(ids[0]), [ids[1]]: matchItem(ids[1]) }, {
        failMatch: (n) => (n === 2 ? new ApolloProviderError('actor:apollo:people/bulk_match: HTTP 500', 'people/bulk_match', 500) : undefined),
      });

    const first = paid();
    const job = insertJob('apollo_people', params(s, { perCompany: 12 }));
    const done = await runJob(job.id, { resolveDeps: () => first.deps });

    expect(first.matchCalls.map((batch) => batch.length)).toEqual([10, 2]);
    expect(first.searches).toHaveLength(1);
    expect(done.state).toBe('failed');
    expect(done.error).toBe("actor:apollo:people/bulk_match: HTTP 500. 2 crediti usati. I dati salvati fino all'errore restano validi.");
    expect(members(s.list.id)).toHaveLength(2);

    // Rilancio in process: l'errore porta i conteggi parziali (letti dalla pipeline).
    const again = paid();
    const err = await runApolloPeople(params(s, { perCompany: 12 }), again.deps).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApolloPeopleError);
    expect((err as InstanceType<typeof ApolloPeopleError>).counts).toMatchObject({
      companies_done: 0,
      people_read: 12,
      people_matched: 2,
      credits_used: 2,
      requests: 3,
      already_in_list: 2,
    });
    expect((err as InstanceType<typeof ApolloPeopleError>).detail).toBe('actor:apollo:people/bulk_match: HTTP 500');
  });

  it('config verificata prima di qualunque chiamata: chiave mancante, lista archiviata o di un altro ICP → `config:`', async () => {
    const s = scenario();
    const { deps, searches } = fakeDeps({}, {});

    const key = config.apolloApiKey;
    config.apolloApiKey = '';
    try {
      await expect(handler(params(s), deps)).rejects.toThrow('config: APOLLO_API_KEY mancante nel .env — nessun job avviato.');
    } finally {
      config.apolloApiKey = key;
    }

    updateList(s.list.id, { archived: true });
    await expect(handler(params(s), deps)).rejects.toThrow(`config: La lista '${s.list.name}' è archiviata: riattivala per aggiungere persone.`);
    expect(CONFIG_BLOCKERS.apollo_people(params(s))).toEqual([`La lista '${s.list.name}' è archiviata: riattivala per aggiungere persone.`]);
    updateList(s.list.id, { archived: false });

    const otherIcp = createIcp({ name: `Altro ICP ${seq}` });
    await expect(handler(params(s, { icpId: otherIcp.id }), deps)).rejects.toThrow(/^config: La lista '.*' non è dell'ICP 'Altro ICP \d+'/);
    expect(searches).toHaveLength(0);
  });

  it('zero persone → esito neutro con i filtri; aziende senza sito e sparite contate; > 50 % senza LinkedIn → warning', async () => {
    const s = scenario({ roles: [], companies: [{ name: 'Acme' }, { name: 'Delta', domain: null }] });
    const [acme] = s.companies;
    const empty = fakeDeps({}, {});
    const zero = await handler(
      params(s, { roles: [], seniorities: ['c_suite'], locations: ['Milano, Italia'], companyIds: [...s.companies.map((c) => c.id), 999999] }),
      empty.deps,
    );
    expect(zero.counts).toMatchObject({ companies: 2, without_domain: 1, companies_done: 1, people_read: 0, requests: 1, credits_used: 0 });
    expect(empty.matchCalls).toHaveLength(0);
    expect(zero.summary).toBe(
      'Nessuna persona trovata in 1 azienda con seniority C-suite · località Milano, Italia. Togli seniority e località. 1 azienda senza sito esclusa.',
    );
    expect(zero.warnings).toEqual(['1 azienda selezionata non esiste più (unita o eliminata): esclusa.']);

    const noUrl = fakeDeps(
      { [acme.domain!]: [`n1-${seq}`, `n2-${seq}`, `n3-${seq}`] },
      { [`n1-${seq}`]: matchItem(`n1-${seq}`), [`n2-${seq}`]: matchItem(`n2-${seq}`, { url: null }), [`n3-${seq}`]: matchItem(`n3-${seq}`, { url: null }) },
    );
    const result = await handler(params(s, { roles: ['CTO'] }), noUrl.deps);
    expect(result.counts).toMatchObject({ skipped_no_url: 2, added: 1, people_matched: 3 });
    expect(result.warnings).toEqual(['Molte persone senza profilo LinkedIn: valuta ruoli più specifici.']);
  });

  it('azienda sparita durante il job (unione/eliminazione) → saltata con warning, nessun errore', async () => {
    const s = scenario({ companies: [{ name: 'Acme' }, { name: 'Beta' }] });
    const [acme, beta] = s.companies;
    const { deps, searches } = fakeDeps({ [acme.domain!]: [`v1-${seq}`] }, { [`v1-${seq}`]: matchItem(`v1-${seq}`) });
    const search = deps.searchPeople;
    deps.searchPeople = async (p) => {
      db.prepare('DELETE FROM companies WHERE id = ?').run(beta.id);
      return search(p);
    };
    const result = await handler(params(s), deps);
    expect(searches.map((p) => p.domain)).toEqual([acme.domain]);
    expect(result.counts).toMatchObject({ companies: 2, companies_done: 1, added: 1 });
    expect(result.warnings).toEqual(['1 azienda è stata unita, eliminata o ha perso il sito durante il job: saltata.']);
  });

  it('nessuna azienda con sito al momento dell\'esecuzione → esito neutro senza richieste', async () => {
    const s = scenario({ companies: [{ name: 'Delta', domain: null }] });
    const { deps, searches } = fakeDeps({}, {});
    const result = await handler(params(s), deps);
    expect(searches).toHaveLength(0);
    expect(result.counts).toMatchObject({ companies: 1, without_domain: 1, requests: 0, companies_done: 0 });
    expect(result.summary).toBe('Contatti Apollo: nessuna azienda con sito da cercare (1 azienda senza sito esclusa). Nessuna richiesta fatta.');
  });
});

describe('contatti: preview e avvio (route)', () => {
  const previewUrl = (icpId: number, query: string) => `/api/icps/${icpId}/contacts/preview?${query}`;

  it('preview senza ruoli → warning e nessun blocker; senza sito esclusa ed elencata; est_credits = con dominio × tetto', async () => {
    const s = scenario({ roles: [], companies: [{ name: 'Acme' }, { name: 'Delta', domain: null }] });
    const [acme, delta] = s.companies;

    const res = await send('GET', previewUrl(s.icp.id, `companyIds=${acme.id},${delta.id}&listId=${s.list.id}`));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      counts: { companies: 2, with_domain: 1, without_domain: 1, per_company: 10, requests: 2, est_credits: 10 },
      est_cost_usd: null,
      warnings: [
        'Delta è senza sito: esclusa (Apollo cerca per dominio).',
        "L'ICP non ha ruoli target: verranno prese le prime 10 persone qualunque per azienda.",
      ],
      blockers: [],
    });
  });

  it('preview: chiavi ripetute, tetto, prezzo, ruoli indicati vuoti, avviso sul limite al minuto, già cercate per la lista', async () => {
    const s = scenario({ roles: ['CTO'], companies: [{ name: 'Acme' }, { name: 'Beta' }] });
    const [acme, beta] = s.companies;
    const price = config.prices.apolloCreditUsd;
    const limit = config.apolloRateLimitPerMinute;
    config.prices.apolloCreditUsd = 0.1;
    config.apolloRateLimitPerMinute = 3;
    try {
      const res = await send(
        'GET',
        previewUrl(s.icp.id, `companyIds=${acme.id}&companyIds=${beta.id}&listId=${s.list.id}&perCompany=25&roles=CTO&roles=Head%2C%20Eng&seniorities=vp,c_suite&locations=Milano%2C%20Italia`),
      );
      expect(res.body.counts).toEqual({ companies: 2, with_domain: 2, without_domain: 0, per_company: 25, requests: 7, est_credits: 50 });
      expect(res.body.est_cost_usd).toBe(5);
      expect(res.body.warnings).toEqual([
        'Fino a 7 richieste Apollo, oltre il limite di 3 al minuto: il job rispetterà il limite e durerà più a lungo, e si ferma con esito parziale se Apollo limita.',
      ]);
    } finally {
      config.prices.apolloCreditUsd = price;
      config.apolloRateLimitPerMinute = limit;
    }

    // `roles=` vuota con un ICP che ha ruoli → "Nessun ruolo indicato".
    const noRoles = await send('GET', previewUrl(s.icp.id, `companyIds=${acme.id}&listId=${s.list.id}&roles=`));
    expect(noRoles.body.warnings).toEqual(['Nessun ruolo indicato: verranno prese le prime 10 persone qualunque per azienda.']);

    // Già cercata per questa lista: fonte `apollo_people` su un membro della lista.
    const p = upsertProspect({ linkedinUrl: `https://www.linkedin.com/in/cercata-${seq}` }).id;
    const { id: sourceId } = addSource(p, { kind: 'apollo_people', companyId: acme.id });
    addMembers(s.list.id, [p]);
    const at = db.prepare('SELECT captured_at FROM sources WHERE id = ?').pluck().get(sourceId) as string;
    const tail = `per '${s.list.name}' il ${shortDateText(at)}: le persone già in lista non si duplicano, ma il match si ripaga.`;
    const one = await send('GET', previewUrl(s.icp.id, `companyIds=${acme.id}&listId=${s.list.id}`));
    expect(one.body.warnings).toEqual([`Acme già cercata ${tail}`]);
    const two = await send('GET', previewUrl(s.icp.id, `companyIds=${acme.id},${beta.id}&listId=${s.list.id}`));
    expect(two.body.warnings).toEqual([`1 di 2 aziende già cercate ${tail}`]);
    // Un'altra lista dello stesso ICP non eredita l'avviso.
    const otherList = createList({ icpId: s.icp.id, name: `Altra lista ${seq}` })!;
    expect((await send('GET', previewUrl(s.icp.id, `companyIds=${acme.id}&listId=${otherList.id}`))).body.warnings).toEqual([]);
  });

  it('blockers F3: chiave, nessuna azienda, nessuna con sito, lista mancante/inesistente/di un altro ICP/archiviata, job in corso (409 all\'avvio)', async () => {
    const s = scenario({ companies: [{ name: 'Acme' }, { name: 'Delta', domain: null }] });
    const [acme, delta] = s.companies;
    const blockers = async (query: string) => (await send('GET', previewUrl(s.icp.id, query))).body.blockers as string[];

    const key = config.apolloApiKey;
    config.apolloApiKey = '';
    try {
      expect(await blockers(`companyIds=${acme.id}&listId=${s.list.id}`)).toEqual(['APOLLO_API_KEY mancante nel .env — nessun job avviato.']);
    } finally {
      config.apolloApiKey = key;
    }
    expect(await blockers(`listId=${s.list.id}`)).toEqual(['Nessuna azienda selezionata.']);
    expect(await blockers(`companyIds=${delta.id}&listId=${s.list.id}`)).toEqual(['Nessuna delle aziende selezionate ha un sito: Apollo cerca per dominio.']);
    expect(await blockers(`companyIds=${acme.id}`)).toEqual(['Scegli una lista di destinazione.']);
    expect(await blockers(`companyIds=${acme.id}&listId=999999`)).toEqual(['La lista di destinazione non esiste.']);
    const other = scenario();
    expect(await blockers(`companyIds=${acme.id}&listId=${other.list.id}`)).toEqual([
      `La lista '${other.list.name}' non è dell'ICP '${s.icp.name}': scegli una lista di questo ICP.`,
    ]);
    await send('PATCH', `/api/lists/${s.list.id}`, { archived: true });
    expect(await blockers(`companyIds=${acme.id}&listId=${s.list.id}`)).toEqual([`La lista '${s.list.name}' è archiviata: riattivala per aggiungere persone.`]);
    const blocked = await send('POST', `/api/icps/${s.icp.id}/contacts`, { companyIds: [acme.id], listId: s.list.id });
    expect(blocked.status).toBe(400);
    expect(blocked.body).toMatchObject({ code: 'blocked', blockers: [expect.stringContaining('archiviata')] });
    expect(blocked.body.error).toMatch(/^Contatti non avviati: /);
    await send('PATCH', `/api/lists/${s.list.id}`, { archived: false });

    const running = insertJob('enrich', {});
    setJobPid(running.id, process.pid);
    try {
      expect(await blockers(`companyIds=${acme.id}&listId=${s.list.id}`)).toEqual([expect.stringMatching(/^C'è già un job in corso: Arricchimento/)]);
      const busy = await send('POST', `/api/icps/${s.icp.id}/contacts`, { companyIds: [acme.id], listId: s.list.id });
      expect(busy.status).toBe(409);
      expect(busy.body).toMatchObject({ code: 'job_running', job_id: running.id });
    } finally {
      completeJob(running.id, { state: 'failed', error: 'process: fine test' });
    }
  });

  it('validazione: 404 ICP; 400 su seniority, tetto fuori range, id non numerici, campi extra nel body', async () => {
    const s = scenario();
    const [acme] = s.companies;
    expect((await send('GET', previewUrl(999999, `companyIds=${acme.id}`))).status).toBe(404);
    expect((await send('POST', '/api/icps/999999/contacts', { companyIds: [acme.id], listId: s.list.id })).status).toBe(404);
    const bad = await send('GET', previewUrl(s.icp.id, `companyIds=${acme.id}&seniorities=boss`));
    expect(bad.status).toBe(400);
    expect(bad.body.issues[0].message).toMatch(/^Seniority Apollo non valida/);
    for (const query of [`companyIds=${acme.id}&perCompany=0`, `companyIds=${acme.id}&perCompany=101`, `companyIds=${acme.id}&perCompany=abc`, 'companyIds=abc']) {
      expect((await send('GET', previewUrl(s.icp.id, query))).status).toBe(400);
    }
    const body = { companyIds: [acme.id], listId: s.list.id };
    expect((await send('POST', `/api/icps/${s.icp.id}/contacts`, { ...body, perCompany: 0 })).status).toBe(400);
    expect((await send('POST', `/api/icps/${s.icp.id}/contacts`, { ...body, seniorities: ['boss'] })).status).toBe(400);
    expect((await send('POST', `/api/icps/${s.icp.id}/contacts`, { ...body, extra: 1 })).status).toBe(400);
  });

  it('POST /api/icps/:id/contacts → 202 con params risolti (default dall\'ICP, id senza doppioni)', async () => {
    const s = scenario({ roles: ['CTO', 'Head of Engineering'], locations: ['Italia'], companies: [{ name: 'Acme' }, { name: 'Delta', domain: null }] });
    const [acme, delta] = s.companies;
    const launcher = createApp({ jobs: { command: 'node', args: ['-e', ''] } });

    const res = await launcher.request(`/api/icps/${s.icp.id}/contacts`, {
      method: 'POST',
      body: JSON.stringify({ companyIds: [acme.id, delta.id, acme.id], listId: s.list.id, seniorities: ['vp'] }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(202);
    const { job } = (await res.json()) as any;
    expect(job).toMatchObject({
      kind: 'apollo_people',
      state: 'running',
      params: {
        icpId: s.icp.id,
        companyIds: [acme.id, delta.id],
        listId: s.list.id,
        roles: ['CTO', 'Head of Engineering'],
        seniorities: ['vp'],
        locations: ['Italia'],
        perCompany: 10,
      },
    });

    // Il figlio `node -e ''` esce subito senza esito: si attende che il job non sia più in corso.
    const deadline = Date.now() + 5000;
    while (getJob(job.id)?.state === 'running' && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    expect(getJob(job.id)?.state).toBe('failed');
  });
});
