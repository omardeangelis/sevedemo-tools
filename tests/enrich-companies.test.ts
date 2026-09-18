import { describe, expect, it } from 'vitest';

// Job `enrich_companies` (apollo-lookalike T7c). Import dinamici: la config (DB_PATH isolato da
// tests/setup.ts) è letta a import-time. Mai Apollo reale: `enrichOrganizations` è sempre un fake che
// risponde nella forma di `tests/fixtures/apollo/organizations-bulk-enrich.json`.
const { handler, enrichCompanies, formatDay } = await import('../src/jobs/enrich-companies.js');
const { createCompany, getCompany } = await import('../src/db/companies.js');
const { createIcp, setReferenceCompany } = await import('../src/db/icps.js');
const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/server/app.js');
const { getJob } = await import('../src/server/jobs.js');
const { insertJob, setJobPid, completeJob } = await import('../src/db/jobs.js');
const { APOLLO_KEY_BLOCKER, config } = await import('../src/config.js');
const { ApolloConfigError, ApolloProviderError, ApolloRateLimitError } = await import('../src/apollo/client.js');

const app = createApp();
const DAY_MS = 86_400_000;
const OP = 'organizations/bulk_enrich' as const;

let seq = 0;
const next = () => (seq += 1);

async function send(method: string, path: string, body?: unknown, target = app) {
  const res = await target.request(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
  });
  return { status: res.status, body: (await res.json()) as any };
}

/** Organizzazione Apollo nella forma della fixture `organizations-bulk-enrich.json`. */
function org(domain: string, extra: Record<string, unknown> = {}) {
  const slug = domain.split('.')[0];
  return {
    id: `org-${slug}`,
    name: `${slug} S.r.l.`,
    website_url: `http://www.${domain}`,
    primary_domain: domain,
    linkedin_url: `http://www.linkedin.com/company/${slug}`,
    industry: 'machinery',
    keywords: ['automazione industriale', 'meccanica di precisione'],
    estimated_num_employees: 85,
    city: 'Brescia',
    state: 'Lombardy',
    country: 'Italy',
    ...extra,
  };
}

/** Risposta `bulk_enrich` con le organizzazioni indicate e `missing_records` coerente. */
function bulk(domains: string[], orgs: unknown[]) {
  return {
    status: 'success',
    total_requested_domains: domains.length,
    unique_enriched_records: orgs.length,
    missing_records: Math.max(0, domains.length - orgs.length),
    organizations: orgs,
  };
}

/**
 * Deps fake: `known` = domini che Apollo conosce (con eventuali campi extra); `failures[i]` = errore
 * lanciato alla chiamata i-esima (0-based). Registra le chiamate.
 */
function fakeDeps(known: Record<string, Record<string, unknown>> = {}, failures: Record<number, Error> = {}) {
  const calls: string[][] = [];
  return {
    calls,
    deps: {
      enrichOrganizations: async (domains: string[]) => {
        const index = calls.push(domains) - 1;
        if (failures[index]) throw failures[index];
        return bulk(domains, domains.filter((d) => d in known).map((d) => org(d, known[d])));
      },
    },
  };
}

/** Azienda già trovata su Apollo `daysAgo` giorni fa. */
function markFound(id: number, daysAgo: number) {
  const at = new Date(Date.now() - daysAgo * DAY_MS).toISOString();
  db.prepare('UPDATE companies SET apollo_org_id = ?, apollo_json = ?, apollo_enriched_at = ? WHERE id = ?').run(
    `org-found-${id}`,
    JSON.stringify({ id: `org-found-${id}`, keywords: ['saas'] }),
    at,
    id,
  );
  return at;
}

/** Tentativo senza esito `daysAgo` giorni fa. */
function markAttempted(id: number, daysAgo: number, outcome = 'not_found') {
  const at = new Date(Date.now() - daysAgo * DAY_MS).toISOString();
  db.prepare('UPDATE companies SET apollo_json = ?, apollo_enriched_at = ? WHERE id = ?').run(JSON.stringify({ outcome }), at, id);
  return at;
}

function icpWithReferences(companyIds: number[]) {
  const icp = createIcp({ name: `ICP arricchimento ${next()}` });
  for (const id of companyIds) setReferenceCompany(icp.id, id);
  return icp;
}

/** `n` aziende solo-dominio con prefisso univoco. */
function companies(prefix: string, n: number) {
  return Array.from({ length: n }, (_, i) => createCompany({ website: `${prefix}-${i}.it`, name: `${prefix} ${i}` }));
}

/** Il figlio `node -e ''` esce subito senza esito: si attende che il job non sia più in corso. */
async function waitJobDone(id: number) {
  const deadline = Date.now() + 5000;
  while (getJob(id)?.state === 'running' && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
  expect(getJob(id)?.state).not.toBe('running');
}

const launcher = createApp({ jobs: { command: 'node', args: ['-e', ''] } });

describe('enrich_companies — handler', () => {
  it('RED: salva apollo_org_id, parole chiave in apollo_json e apollo_enriched_at; counts.enriched === 1', async () => {
    const n = next();
    const beta = createCompany({ website: `https://www.beta-${n}.io/chi-siamo`, name: 'Beta' });
    const { deps, calls } = fakeDeps({ [`beta-${n}.io`]: {} });

    const result = await handler({ companyIds: [beta.id], retryNotFound: false }, deps);

    expect(calls).toEqual([[`beta-${n}.io`]]);
    expect(result.counts.enriched).toBe(1);
    const saved = getCompany(beta.id)!;
    expect(saved.apollo_org_id).toBe(`org-beta-${n}`);
    expect(JSON.parse(saved.apollo_json!).keywords).toEqual(['automazione industriale', 'meccanica di precisione']);
    expect(saved.apollo_enriched_at).toEqual(expect.any(String));
  });

  it('3 referenze (2 con dominio, 1 arricchita ieri): preview to_enrich 1 → avvio 202 → enriched 1, industry intatta, linkedin_acquired 1; secondo giro to_enrich 0', async () => {
    const n = next();
    const acme = createCompany({ website: `acme-${n}.it`, name: 'Acme' });
    const acmeAt = markFound(acme.id, 1);
    const beta = createCompany({ website: `beta-${n}.io`, name: 'Beta', industry: 'Software' });
    const delta = createCompany({ linkedin_url: `linkedin.com/company/delta-${n}`, name: 'Delta' });
    const icp = icpWithReferences([acme.id, beta.id, delta.id]);

    const preview = await send('GET', `/api/icps/${icp.id}/enrich-companies/preview`);
    expect(preview.status).toBe(200);
    expect(preview.body.counts).toEqual({ references: 3, with_domain: 2, to_enrich: 1, skipped_fresh: 0, enriched: 1, est_credits: 1 });
    expect(preview.body.est_cost_usd).toBeNull();
    expect(preview.body.blockers).toEqual([]);
    expect(preview.body.warnings).toEqual(['Referenza senza sito, ignorata: Delta. Aggiungi il sito in Aziende per arricchirla.']);
    expect(preview.body.items).toEqual([
      { company_id: acme.id, name: 'Acme', domain: `acme-${n}.it`, state: 'arricchita', apollo_enriched_at: acmeAt, to_enrich: false, label: `arricchita il ${formatDay(acmeAt)}` },
      { company_id: beta.id, name: 'Beta', domain: `beta-${n}.io`, state: 'da_arricchire', apollo_enriched_at: null, to_enrich: true, label: 'da arricchire' },
      { company_id: delta.id, name: 'Delta', domain: null, state: 'senza_sito', apollo_enriched_at: null, to_enrich: false, label: 'senza sito (ignorata)' },
    ]);

    const price = config.prices.apolloCreditUsd;
    config.prices.apolloCreditUsd = 0.25;
    try {
      expect((await send('GET', `/api/icps/${icp.id}/enrich-companies/preview`)).body.est_cost_usd).toBe(0.25);
    } finally {
      config.prices.apolloCreditUsd = price;
    }

    const started = await send('POST', `/api/icps/${icp.id}/enrich-companies`, undefined, launcher);
    expect(started.status).toBe(202);
    expect(started.body.job).toMatchObject({
      kind: 'enrich_companies',
      state: 'running',
      params: { companyIds: [beta.id], icpId: icp.id, retryNotFound: false },
    });
    await waitJobDone(started.body.job.id);

    const { deps, calls } = fakeDeps({ [`beta-${n}.io`]: { industry: 'information technology & services' } });
    const result = await handler(started.body.job.params, deps);
    expect(calls).toEqual([[`beta-${n}.io`]]);
    expect(result).toEqual({
      summary: '1 referenza arricchita · 0 non trovate su Apollo · 0 unioni · 1 URL LinkedIn acquisito',
      counts: { enriched: 1, not_found: 0, merged: 0, linkedin_acquired: 1, key_conflicts: 0, credits_used: 1 },
      warnings: [],
    });
    expect(getCompany(beta.id)).toMatchObject({
      name: 'Beta',
      industry: 'Software',
      website: `beta-${n}.io`,
      size: '85 dipendenti',
      location: 'Brescia, Lombardy, Italy',
      linkedin_url: `https://www.linkedin.com/company/beta-${n}`,
      apollo_org_id: `org-beta-${n}`,
    });

    const again = await send('GET', `/api/icps/${icp.id}/enrich-companies/preview`);
    expect(again.body.counts).toMatchObject({ with_domain: 2, to_enrich: 0, enriched: 2, est_credits: 0 });
    // SPEC C5: senza `APOLLO_CREDIT_USD` la stima è `null` anche a 0 crediti (la UI dice "stima non disponibile").
    expect(again.body.est_cost_usd).toBeNull();
    expect(again.body.blockers).toEqual(['Nessuna referenza da arricchire.']);
    const refused = await send('POST', `/api/icps/${icp.id}/enrich-companies`, { retryNotFound: true });
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ code: 'blocked', blockers: ['Nessuna referenza da arricchire.'] });

    // Le trovate non si ripagano mai, nemmeno se il job le riceve (params vecchi, "Riprova").
    const replay = fakeDeps({ [`beta-${n}.io`]: {} });
    const skipped = await handler({ companyIds: [beta.id], icpId: icp.id, retryNotFound: true }, replay.deps);
    expect(replay.calls).toEqual([]);
    expect(skipped.counts).toMatchObject({ enriched: 0, credits_used: 0 });
    expect(skipped.warnings).toEqual(['1 referenza saltata (già arricchita): nessun credito speso.']);
  });

  it("organizzazione con l'URL di un'altra azienda solo-LinkedIn → merged 1, il superstite (con URL) prende dominio e dati Apollo", async () => {
    const n = next();
    const gamma = createCompany({ website: `gamma-${n}.it`, name: 'Gamma' });
    const gammaLi = createCompany({ linkedin_url: `linkedin.com/company/gamma-${n}`, name: 'Gamma LinkedIn' });
    const { deps } = fakeDeps({ [`gamma-${n}.it`]: {} });

    const run = await enrichCompanies([gamma.id], deps);

    expect(run.counts).toEqual({ enriched: 1, not_found: 0, merged: 1, linkedin_acquired: 0, key_conflicts: 0, credits_used: 1 });
    expect(run.results).toEqual([{ requestedId: gamma.id, companyId: gammaLi.id, outcome: 'enriched' }]);
    expect(run.enrichedIds).toEqual([gammaLi.id]);
    expect(run.stoppedBy).toBeUndefined();
    expect(getCompany(gamma.id)).toBeUndefined();
    expect(getCompany(gammaLi.id)).toMatchObject({ name: 'Gamma LinkedIn', domain: `gamma-${n}.it`, apollo_org_id: `org-gamma-${n}` });
  });

  it('dominio non trovato → not_found 1 con apollo_enriched_at; non ritentata prima di FRESHNESS_DAYS salvo retryNotFound', async () => {
    const n = next();
    const delta = createCompany({ website: `delta-${n}.it`, name: 'Delta' });
    const eta = createCompany({ website: `eta-${n}.it`, name: 'Eta' });
    const icp = icpWithReferences([delta.id, eta.id]);
    const first = fakeDeps({ [`eta-${n}.it`]: {} });

    const result = await handler({ companyIds: [delta.id, eta.id], icpId: icp.id, retryNotFound: false }, first.deps);

    expect(first.calls).toEqual([[`delta-${n}.it`, `eta-${n}.it`]]);
    expect(result.counts).toEqual({ enriched: 1, not_found: 1, merged: 0, linkedin_acquired: 1, key_conflicts: 0, credits_used: 1 });
    expect(result.summary).toBe('1 referenza arricchita · 1 non trovata su Apollo (Delta) · 0 unioni · 1 URL LinkedIn acquisito');
    expect(result.warnings).toEqual([
      `Non trovata su Apollo: Delta (delta-${n}.it). Verifica il sito: non verrà ritentata prima di 90 giorni, salvo «Ritenta anche le non trovate».`,
    ]);
    const saved = getCompany(delta.id)!;
    expect(saved.apollo_org_id).toBeNull();
    expect(saved.apollo_enriched_at).toEqual(expect.any(String));
    expect(JSON.parse(saved.apollo_json!)).toEqual({ outcome: 'not_found' });

    const preview = await send('GET', `/api/icps/${icp.id}/enrich-companies/preview`);
    expect(preview.body.counts).toEqual({ references: 2, with_domain: 2, to_enrich: 0, skipped_fresh: 1, enriched: 1, est_credits: 0 });
    expect(preview.body.blockers).toEqual(['Nessuna referenza da arricchire.']);
    const day = formatDay(saved.apollo_enriched_at);
    expect(preview.body.warnings).toEqual([
      `Tentata di recente senza esito, non ritentata: Delta (non trovata il ${day}). Spunta «Ritenta anche le non trovate» per riprovare.`,
    ]);

    const retry = await send('GET', `/api/icps/${icp.id}/enrich-companies/preview?retryNotFound=true`);
    expect(retry.body.counts).toMatchObject({ to_enrich: 1, skipped_fresh: 0, est_credits: 1 });
    expect(retry.body.blockers).toEqual([]);
    expect(retry.body.items.find((i: any) => i.company_id === delta.id).label).toBe(`non trovata il ${day} · da ritentare`);
    expect((await send('GET', `/api/icps/${icp.id}/enrich-companies/preview?retryNotFound=boh`)).status).toBe(400);

    const noRetry = fakeDeps();
    expect((await handler({ companyIds: [delta.id], icpId: icp.id, retryNotFound: false }, noRetry.deps)).counts.not_found).toBe(0);
    expect(noRetry.calls).toEqual([]);
    const withRetry = fakeDeps();
    expect((await handler({ companyIds: [delta.id], icpId: icp.id, retryNotFound: true }, withRetry.deps)).counts.not_found).toBe(1);
    expect(withRetry.calls).toEqual([[`delta-${n}.it`]]);

    // Tentativo più vecchio di FRESHNESS_DAYS: di nuovo da arricchire senza "ritenta".
    markAttempted(delta.id, 91);
    expect((await send('GET', `/api/icps/${icp.id}/enrich-companies/preview`)).body.counts).toMatchObject({ to_enrich: 1, skipped_fresh: 0 });
  });

  it("errore 500 sul lotto 1 di 2 → lotto 2 salvato, succeeded parziale con warning, le aziende del lotto 1 restano da arricchire", async () => {
    const n = next();
    const list = companies(`lotto-${n}`, 11);
    const error = new ApolloProviderError(`actor:apollo:${OP}: HTTP 500 (boom)`, OP, 500);
    const { deps, calls } = fakeDeps({ [`lotto-${n}-10.it`]: {} }, { 0: error });

    const result = await handler({ companyIds: list.map((c) => c.id), retryNotFound: false }, deps);

    expect(calls.map((c) => c.length)).toEqual([10, 1]);
    expect(result.counts).toMatchObject({ enriched: 1, not_found: 0, credits_used: 1 });
    expect(result.warnings).toEqual([
      `Errore Apollo (actor:apollo:${OP}: HTTP 500 (boom)): 10 aziende restano da arricchire; rilancia per completare.`,
    ]);
    for (const c of list.slice(0, 10)) expect(getCompany(c.id)).toMatchObject({ apollo_enriched_at: null, apollo_org_id: null, apollo_json: null });
    expect(getCompany(list[10].id)!.apollo_org_id).toBe(`org-lotto-${n}-10`);
  });

  it('403 o 500 prima di qualunque scrittura → throw attribuito (config: / actor:apollo:), nessun dato modificato', async () => {
    const n = next();
    const [one] = companies(`vietato-${n}`, 1);
    const forbidden = new ApolloConfigError(
      `config: la chiave Apollo non ha i permessi per ${OP}: usa una master key o una chiave con il permesso di ricerca persone (Apollo → Settings → API keys).`,
      OP,
      403,
    );
    await expect(handler({ companyIds: [one.id], retryNotFound: false }, fakeDeps({}, { 0: forbidden }).deps)).rejects.toThrow(
      /^config: la chiave Apollo non ha i permessi .* Nessun dato modificato\.$/,
    );
    await expect(
      handler({ companyIds: [one.id], retryNotFound: false }, fakeDeps({}, { 0: new Error('socket hang up') }).deps),
    ).rejects.toThrow(`actor:apollo:${OP}: socket hang up Nessun dato modificato.`);
    expect(getCompany(one.id)).toMatchObject({ apollo_enriched_at: null, apollo_json: null });

    const key = config.apolloApiKey;
    config.apolloApiKey = '';
    try {
      const calls = fakeDeps();
      await expect(handler({ companyIds: [one.id], retryNotFound: false }, calls.deps)).rejects.toThrow(`config: ${APOLLO_KEY_BLOCKER}`);
      expect(calls.calls).toEqual([]);
    } finally {
      config.apolloApiKey = key;
    }
  });

  it('403 o limite orario dopo un lotto salvato → ciclo fermato (stoppedBy), lotti successivi non chiamati, esito parziale', async () => {
    const n = next();
    const list = companies(`stop-${n}`, 21);
    const known = Object.fromEntries(list.map((_, i) => [`stop-${n}-${i}.it`, {}]));
    const hourly = new ApolloRateLimitError(`actor:apollo:${OP}: limite orario di Apollo esaurito (100 richieste/ora): riprova più tardi`, OP, 0, 'hourly');
    const { deps, calls } = fakeDeps(known, { 1: hourly });

    const run = await enrichCompanies(list.map((c) => c.id), deps);
    expect(calls).toHaveLength(2);
    expect(run.stoppedBy).toBe(hourly);
    expect(run.errors).toEqual([]);
    expect(run.counts.enriched).toBe(10);
    expect(run.results.filter((r) => r.outcome === 'failed')).toHaveLength(11);
    for (const c of list.slice(10)) expect(getCompany(c.id)!.apollo_enriched_at).toBeNull();

    // Handler: stesso arresto con 403 dopo il primo lotto → `succeeded` con il warning FLOW.
    const m = next();
    const others = companies(`stop-${m}`, 11);
    const forbidden = new ApolloConfigError(`config: la chiave Apollo non ha i permessi per ${OP}.`, OP, 403);
    const second = fakeDeps(Object.fromEntries(others.map((_, i) => [`stop-${m}-${i}.it`, {}])), { 1: forbidden });
    const partial = await handler({ companyIds: others.map((c) => c.id), icpId: 1, retryNotFound: false }, second.deps);
    expect(partial.counts.enriched).toBe(10);
    expect(partial.warnings).toEqual([
      `Arricchimento interrotto (config: la chiave Apollo non ha i permessi per ${OP}.): arricchite 10 referenze su 11; le altre restano da arricchire.`,
    ]);

    const k = next();
    const limited = companies(`limite-${k}`, 11);
    const third = fakeDeps(Object.fromEntries(limited.map((_, i) => [`limite-${k}-${i}.it`, {}])), { 1: hourly });
    const byRate = await handler({ companyIds: limited.map((c) => c.id), retryNotFound: false }, third.deps);
    expect(byRate.warnings).toEqual(['Limite Apollo raggiunto: arricchite 10 aziende su 11; le altre restano da arricchire.']);
  });

  it('AL-TD-7: arresto dopo un lotto di sole non trovate → il warning non le conta come arricchite', async () => {
    const n = next();
    const unknown = companies(`ignote-${n}`, 11);
    const hourly = new ApolloRateLimitError(`actor:apollo:${OP}: limite orario di Apollo esaurito (100 richieste/ora): riprova più tardi`, OP, 0, 'hourly');
    // Nessun dominio noto ad Apollo: il 1º lotto salva 10 "non trovate", il 2º si ferma sul limite.
    const { deps } = fakeDeps({}, { 1: hourly });

    const partial = await handler({ companyIds: unknown.map((c) => c.id), icpId: 1, retryNotFound: false }, deps);
    expect(partial.counts).toMatchObject({ enriched: 0, not_found: 10 });
    expect(partial.warnings).toContain(
      'Limite Apollo raggiunto: elaborate 10 referenze su 11 (0 arricchite); le altre restano da arricchire.',
    );
  });

  it('chiavi in conflitto → key_conflicts 1, marcata con apollo_keys, chiavi discordanti nel warning, nessuna scrittura delle chiavi', async () => {
    const n = next();
    const kappa = createCompany({ website: `kappa-${n}.it`, linkedin_url: `linkedin.com/company/kappa-${n}`, name: 'Kappa' });
    const { deps } = fakeDeps({ [`kappa-${n}.it`]: { linkedin_url: `https://www.linkedin.com/company/kappa-robotics-${n}` } });

    const result = await handler({ companyIds: [kappa.id], retryNotFound: false }, deps);

    expect(result.counts).toEqual({ enriched: 0, not_found: 0, merged: 0, linkedin_acquired: 0, key_conflicts: 1, credits_used: 1 });
    expect(result.summary).toBe('0 aziende arricchite · 0 non trovate su Apollo · 0 unioni · 0 URL LinkedIn acquisiti · 1 con chiavi in conflitto (Kappa)');
    expect(result.warnings).toEqual([
      `Chiavi in conflitto con Apollo, nessun dato salvato: Kappa — URL LinkedIn: Apollo indica linkedin.com/company/kappa-robotics-${n}, ` +
        `in anagrafica linkedin.com/company/kappa-${n}. Correggi l'URL LinkedIn o il sito in Anagrafica (o unisci le aziende), poi ritenta.`,
    ]);
    const saved = getCompany(kappa.id)!;
    expect(saved).toMatchObject({ linkedin_url: `https://www.linkedin.com/company/kappa-${n}`, apollo_org_id: null, industry: null });
    expect(JSON.parse(saved.apollo_json!)).toMatchObject({
      outcome: 'key_conflict',
      apollo_keys: { domain: `kappa-${n}.it`, linkedin_url: `https://www.linkedin.com/company/kappa-robotics-${n}`, apollo_org_id: `org-kappa-${n}` },
    });

    const preview = await send('GET', `/api/companies/${kappa.id}/enrich-apollo/preview`);
    expect(preview.body.items[0]).toMatchObject({ state: 'in_conflitto', to_enrich: false });
    expect(preview.body.blockers).toEqual([
      `Chiavi in conflitto con Apollo il ${formatDay(saved.apollo_enriched_at)}: correggi l'URL LinkedIn o il sito in Anagrafica, oppure spunta «Ritenta anche le non trovate».`,
    ]);

    // URL LinkedIn di Apollo già di un'altra azienda con un altro dominio.
    const lambda = createCompany({ website: `lambda-${n}.it`, name: 'Lambda' });
    createCompany({ website: `altra-${n}.it`, linkedin_url: `linkedin.com/company/lambda-${n}`, name: 'Altra' });
    const other = await handler({ companyIds: [lambda.id], retryNotFound: false }, fakeDeps({ [`lambda-${n}.it`]: {} }).deps);
    expect(other.counts.key_conflicts).toBe(1);
    expect(other.warnings?.[0]).toContain(`Lambda — URL LinkedIn di Apollo già usato da Altra (dominio altra-${n}.it)`);
  });

  it('dominio primario Apollo diverso da quello chiesto: abbinato se unico residuo del lotto, ambiguo altrimenti', async () => {
    const n = next();
    const old = createCompany({ website: `vecchio-${n}.it`, name: 'Vecchio' });
    const renamed = { enrichOrganizations: async (domains: string[]) => bulk(domains, [org(`nuovo-${n}.com`)]) };

    const single = await enrichCompanies([old.id], renamed);
    expect(single.counts).toMatchObject({ enriched: 1, not_found: 0, credits_used: 1 });
    const saved = getCompany(old.id)!;
    expect(saved.domain).toBe(`vecchio-${n}.it`);
    expect(JSON.parse(saved.apollo_json!).primary_domain).toBe(`nuovo-${n}.com`);

    const [a, b] = companies(`ambiguo-${n}`, 2);
    const ambiguous = await enrichCompanies([a.id, b.id], renamed);
    expect(ambiguous.counts).toMatchObject({ enriched: 0, not_found: 2, credits_used: 1 });
    expect(ambiguous.warnings).toContain(
      `Apollo ha restituito 1 organizzazione non riconducibile ai domini richiesti (nuovo-${n}.com): non salvata.`,
    );
  });
});

describe('enrich_companies — route', () => {
  it('singola azienda dal dettaglio: preview 1 credito → 202 senza icpId; già arricchita → "Già arricchita il …"; senza sito → "Serve il sito web"', async () => {
    const n = next();
    const one = createCompany({ website: `singola-${n}.it`, name: 'Singola' });

    const preview = await send('GET', `/api/companies/${one.id}/enrich-apollo/preview`);
    expect(preview.status).toBe(200);
    expect(preview.body).toEqual({
      counts: { references: 1, with_domain: 1, to_enrich: 1, skipped_fresh: 0, enriched: 0, est_credits: 1 },
      est_cost_usd: null,
      warnings: [],
      blockers: [],
      items: [
        { company_id: one.id, name: 'Singola', domain: `singola-${n}.it`, state: 'da_arricchire', apollo_enriched_at: null, to_enrich: true, label: 'da arricchire' },
      ],
    });

    const started = await send('POST', `/api/companies/${one.id}/enrich-apollo`, undefined, launcher);
    expect(started.status).toBe(202);
    expect(started.body.job).toMatchObject({ kind: 'enrich_companies', params: { companyIds: [one.id], retryNotFound: false } });
    expect(started.body.job.params).not.toHaveProperty('icpId');
    await waitJobDone(started.body.job.id);

    const at = markFound(one.id, 3);
    const done = await send('GET', `/api/companies/${one.id}/enrich-apollo/preview`);
    expect(done.body.counts).toMatchObject({ to_enrich: 0, enriched: 1, est_credits: 0 });
    expect(done.body.blockers).toEqual([`Già arricchita il ${formatDay(at)}: i dati Apollo non si ricomprano.`]);
    const blocked = await send('POST', `/api/companies/${one.id}/enrich-apollo`, { retryNotFound: true });
    expect(blocked.status).toBe(400);
    expect(blocked.body).toMatchObject({ code: 'blocked', blockers: [expect.stringMatching(/^Già arricchita il /)] });
    expect(blocked.body.error).toMatch(/^Arricchimento non avviato: Già arricchita il /);

    const noSite = createCompany({ linkedin_url: `linkedin.com/company/senza-sito-${n}`, name: 'Senza sito' });
    const noSitePreview = await send('GET', `/api/companies/${noSite.id}/enrich-apollo/preview`);
    expect(noSitePreview.body.counts).toMatchObject({ references: 1, with_domain: 0, to_enrich: 0 });
    expect(noSitePreview.body.blockers).toEqual(["Serve il sito web: aggiungilo in Anagrafica per arricchire l'azienda con Apollo."]);
    expect((await send('POST', `/api/companies/${noSite.id}/enrich-apollo`)).status).toBe(400);

    const attempted = createCompany({ website: `tentata-${n}.it`, name: 'Tentata' });
    const tried = markAttempted(attempted.id, 2);
    expect((await send('GET', `/api/companies/${attempted.id}/enrich-apollo/preview`)).body.blockers).toEqual([
      `Non trovata su Apollo il ${formatDay(tried)}: si ritenta dopo 90 giorni, oppure spunta «Ritenta anche le non trovate».`,
    ]);
    expect((await send('GET', `/api/companies/${attempted.id}/enrich-apollo/preview?retryNotFound=true`)).body.blockers).toEqual([]);
  });

  it('404 su ICP/azienda inesistenti, 400 su body non valido, chiave mancante → blocker e 400, job in corso → blocker e 409', async () => {
    for (const [method, path] of [
      ['GET', '/api/icps/999999/enrich-companies/preview'],
      ['POST', '/api/icps/999999/enrich-companies'],
      ['GET', '/api/companies/999999/enrich-apollo/preview'],
      ['POST', '/api/companies/999999/enrich-apollo'],
      ['GET', '/api/companies/abc/enrich-apollo/preview'],
    ]) {
      expect((await send(method, path)).status).toBe(404);
    }
    const n = next();
    const one = createCompany({ website: `route-${n}.it`, name: 'Route' });
    const icp = icpWithReferences([one.id]);
    expect((await send('GET', `/api/icps/999999/enrich-companies/preview`)).body.error).toBe('ICP non trovato.');
    expect((await send('POST', `/api/icps/${icp.id}/enrich-companies`, { retryNotFound: true, extra: 1 })).status).toBe(400);
    expect((await send('POST', `/api/companies/${one.id}/enrich-apollo`, { retryNotFound: 'si' })).status).toBe(400);

    const key = config.apolloApiKey;
    config.apolloApiKey = '';
    try {
      expect((await send('GET', `/api/icps/${icp.id}/enrich-companies/preview`)).body.blockers).toEqual([APOLLO_KEY_BLOCKER]);
      const blocked = await send('POST', `/api/icps/${icp.id}/enrich-companies`);
      expect(blocked.status).toBe(400);
      expect(blocked.body).toMatchObject({ code: 'blocked', blockers: [APOLLO_KEY_BLOCKER] });
    } finally {
      config.apolloApiKey = key;
    }

    const running = insertJob('enrich', {});
    setJobPid(running.id, process.pid);
    try {
      const preview = await send('GET', `/api/companies/${one.id}/enrich-apollo/preview`);
      expect(preview.body.blockers).toEqual([expect.stringMatching(/^C'è già un job in corso: Arricchimento/)]);
      const busy = await send('POST', `/api/icps/${icp.id}/enrich-companies`);
      expect(busy.status).toBe(409);
      expect(busy.body).toMatchObject({ code: 'job_running', job_id: running.id });
    } finally {
      completeJob(running.id, { state: 'failed', error: 'process: fine test' });
    }
  });
});
