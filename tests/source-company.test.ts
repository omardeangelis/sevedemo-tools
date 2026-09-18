import { describe, expect, it } from 'vitest';

// Job "Sourcing da azienda" (crm-foundation T9). Import dinamici: la config (DB_PATH isolato da
// tests/setup.ts) è letta a import-time. Mai l'actor reale: `fetchEmployees` è sempre un fake.
const { createApp } = await import('../src/server/app.js');
const { sourceCompany } = await import('../src/jobs/source-company.js');
const { upsertProspect } = await import('../src/db/prospects.js');

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

/** ICP + lista + azienda nuove (slug unici per test). */
async function scenario(icp: { target_roles?: string[]; target_locations?: string[] } = {}) {
  seq += 1;
  const created = await send('POST', '/api/icps', { name: `ICP ${seq}`, ...icp });
  const list = await send('POST', '/api/lists', { icpId: created.body.id, name: `Lista ${seq}` });
  const company = await send('POST', '/api/companies', { linkedin_url: `linkedin.com/company/acme-${seq}`, name: `Acme ${seq}` });
  return { icpId: created.body.id as number, listId: list.body.id as number, companyId: company.body.id as number, companyUrl: company.body.linkedin_url as string };
}

/** Item nel layout Full di harvestapi (about/esperienze solo se `full`). */
function employee(slug: string, opts: { full?: boolean; urn?: string; title?: string } = {}) {
  return {
    id: opts.urn ?? `ACoAAFakeMember${slug.replace(/-/g, '')}`,
    publicIdentifier: slug,
    linkedinUrl: `https://www.linkedin.com/in/${slug}`,
    firstName: slug.split('-')[0],
    lastName: 'Test',
    headline: `${opts.title ?? 'CTO'} @ Acme`,
    location: { linkedinText: 'Milano, Lombardia, Italia' },
    currentPosition: [{ companyName: 'Acme' }],
    ...(opts.full
      ? {
          about: `Bio di ${slug}`,
          experience: [{ position: opts.title ?? 'CTO', companyName: 'Acme', endDate: { text: 'Present' } }],
        }
      : {}),
  };
}

/** Fake di `fetchEmployees` che registra le chiamate. */
function fakeFetch(items: unknown[]) {
  const calls: Array<{ companyUrl: string; filters: any }> = [];
  const fetchEmployees = async (companyUrl: string, filters: any) => {
    calls.push({ companyUrl, filters });
    return items;
  };
  return { calls, deps: { fetchEmployees } };
}

describe('sourceCompany (job)', () => {
  it('ruoli dall\'ICP della lista; 5 item (1 senza URL, 1 già prospect) → 4 membri `nuovo`, 3 nuovi', async () => {
    const s = await scenario({ target_roles: ['CTO'] });
    const existing = upsertProspect({ linkedinUrl: 'https://www.linkedin.com/in/gia-presente', fullName: 'Già Presente' });
    const items = [
      employee('anna-rossi'),
      employee('bruno-verdi'),
      employee('carla-bianchi'),
      employee('gia-presente'),
      { name: 'LinkedIn Member', position: 'CTO presso Acme' },
    ];
    const { calls, deps } = fakeFetch(items);

    const result = await sourceCompany({ companyId: s.companyId, listId: s.listId }, deps);

    expect(calls).toHaveLength(1);
    expect(calls[0].companyUrl).toBe(s.companyUrl);
    expect(calls[0].filters).toMatchObject({ jobTitles: ['CTO'] });
    expect(result.counts).toMatchObject({ fetched: 5, prospects_new: 3, prospects_seen: 1, added_to_list: 4, skipped_no_url: 1 });
    expect(result.summary).toBe(
      `Sourcing Acme ${seq} completato: 5 persone lette · 4 aggiunte a 'Lista ${seq}' (3 nuove, 1 già in archivio) · 1 senza profilo pubblico.`,
    );

    const list = await send('GET', `/api/lists/${s.listId}`);
    expect(list.body.members_count).toBe(4);
    expect(list.body.counts_by_status.nuovo).toBe(4);
    const members = await send('GET', `/api/prospects?listId=${s.listId}`);
    expect(members.body.items.map((p: any) => p.id)).toContain(existing.id);

    // Rilancio con gli stessi item: nessun doppione di prospect, fonti o membership.
    const again = await sourceCompany({ companyId: s.companyId, listId: s.listId }, deps);
    expect(again.counts).toMatchObject({ prospects_new: 0, prospects_seen: 4, added_to_list: 0, already_in_list: 4 });
    const detail = (await send('GET', `/api/prospects/${existing.id}`)).body;
    expect(detail.sources).toMatchObject([{ kind: 'company_employees', company_name: `Acme ${seq}` }]);
    expect(detail).toMatchObject({ company_id: s.companyId, status: 'nuovo' });
  });

  it('mode Full con about/esperienze → marked_enriched, enriched_at + raw_json, dati più ricchi vincono (P10)', async () => {
    const s = await scenario({ target_roles: ['CTO'] });
    const old = upsertProspect({
      linkedinUrl: 'https://www.linkedin.com/in/dario-full',
      fullName: 'Dario Vecchio',
      headline: 'Headline vecchia',
    });
    const { calls, deps } = fakeFetch([employee('dario-full', { full: true }), employee('elena-short')]);

    const result = await sourceCompany({ companyId: s.companyId, listId: s.listId, mode: 'Full', maxItems: 20 }, deps);

    expect(calls[0].filters).toMatchObject({ mode: 'Full', maxItems: 20 });
    expect(result.counts).toMatchObject({ marked_enriched: 1, prospects_new: 1, prospects_seen: 1, added_to_list: 2 });
    const dario = (await send('GET', `/api/prospects/${old.id}`)).body;
    expect(dario).toMatchObject({ headline: 'CTO @ Acme', about: 'Bio di dario-full', title: 'CTO', company_id: s.companyId });
    expect(dario.member_urn).toBe('ACoAAFakeMemberdariofull');
    expect(dario.enriched_at).toBeTruthy();
    expect(JSON.stringify(dario.raw)).toContain('Bio di dario-full');
    const members = (await send('GET', `/api/prospects?listId=${s.listId}`)).body.items;
    const elena = members.find((p: any) => p.linkedin_url.endsWith('/elena-short'));
    expect(elena.enriched_at).toBeNull();
  });

  it('mode Short: niente arricchimento né sovrascrittura dei dati già presenti', async () => {
    const s = await scenario({ target_roles: ['CTO'] });
    const old = upsertProspect({ linkedinUrl: 'https://www.linkedin.com/in/fabio-short', headline: 'Scritta a mano' });
    const { deps } = fakeFetch([employee('fabio-short', { full: true })]);

    const result = await sourceCompany({ companyId: s.companyId, listId: s.listId, mode: 'Short' }, deps);

    expect(result.counts.marked_enriched).toBe(0);
    const fabio = (await send('GET', `/api/prospects/${old.id}`)).body;
    expect(fabio).toMatchObject({ headline: 'Scritta a mano', enriched_at: null, company_id: s.companyId });
  });

  it('identità: slug + id membro uniscono reazione (forma id) e commento (slug) già presenti → prospects_merged', async () => {
    const s = await scenario({ target_roles: ['CTO'] });
    const urn = 'ACoAAFakeMemberGinoMerge01';
    const reaction = upsertProspect({ linkedinUrl: `https://www.linkedin.com/in/${urn}`, fullName: 'Gino Merge' });
    const comment = upsertProspect({ linkedinUrl: 'https://www.linkedin.com/in/gino-merge', fullName: 'Gino Merge' });
    const { deps } = fakeFetch([employee('gino-merge', { urn })]);

    const result = await sourceCompany({ companyId: s.companyId, listId: s.listId }, deps);

    expect(result.counts).toMatchObject({ prospects_new: 0, prospects_seen: 1, prospects_merged: 1, added_to_list: 1 });
    expect((await send('GET', `/api/prospects/${reaction.id}`)).status).toBe(404);
    const gino = (await send('GET', `/api/prospects/${comment.id}`)).body;
    expect(gino).toMatchObject({ linkedin_url: 'https://www.linkedin.com/in/gino-merge', member_urn: urn });
    expect(gino.sources.map((src: any) => src.kind)).toEqual(['company_employees']);
    expect(gino.memberships.map((m: any) => m.list_id)).toEqual([s.listId]);
  });

  it('ruoli e località passati vincono sull\'ICP; 0 persone → esito neutro con i ruoli', async () => {
    const s = await scenario({ target_roles: ['CTO'], target_locations: ['Italia'] });
    const { calls, deps } = fakeFetch([]);

    const result = await sourceCompany(
      { companyId: s.companyId, listId: s.listId, roles: ['Head of Engineering', ' '], locations: [] },
      deps,
    );

    expect(calls[0].filters).toEqual({ jobTitles: ['Head of Engineering'], locations: [], maxItems: 50, mode: 'Short' });
    expect(result.counts).toMatchObject({ fetched: 0, prospects_new: 0, added_to_list: 0 });
    expect(result.summary).toBe(`Nessuna persona trovata in Acme ${seq} con ruoli Head of Engineering. Amplia i ruoli.`);
    expect(result.warnings).toEqual([]);
  });

  it('errori attribuiti: azienda/lista mancante o archiviata → `config:`; actor che fallisce → `actor:<id>:`', async () => {
    const s = await scenario({ target_roles: ['CTO'] });
    const { calls, deps } = fakeFetch([employee('mai-letto')]);

    await expect(sourceCompany({ companyId: 999999, listId: s.listId }, deps)).rejects.toThrow(/^config: /);
    await expect(sourceCompany({ companyId: s.companyId, listId: 999999 }, deps)).rejects.toThrow(/^config: /);
    await send('PATCH', `/api/lists/${s.listId}`, { archived: true });
    await expect(sourceCompany({ companyId: s.companyId, listId: s.listId }, deps)).rejects.toThrow(/^config: .*archiviata/);
    expect(calls).toHaveLength(0);
    await send('PATCH', `/api/lists/${s.listId}`, { archived: false });

    const failing = {
      fetchEmployees: async () => {
        throw new Error('Actor "harvestapi/linkedin-company-employees" fallito: 402 crediti esauriti');
      },
    };
    await expect(sourceCompany({ companyId: s.companyId, listId: s.listId }, failing)).rejects.toThrow(
      'actor:harvestapi/linkedin-company-employees: 402 crediti esauriti',
    );
    const prefixed = {
      fetchEmployees: async () => {
        throw new Error('actor:harvestapi/linkedin-company-employees: simulato');
      },
    };
    await expect(sourceCompany({ companyId: s.companyId, listId: s.listId }, prefixed)).rejects.toThrow(
      /^actor:harvestapi\/linkedin-company-employees: simulato$/,
    );
    expect((await send('GET', `/api/lists/${s.listId}`)).body.members_count).toBe(0);
  });

  it('deps reali senza APIFY_TOKEN → `config:` prima di qualunque chiamata all\'actor', async () => {
    const { realDeps } = await import('../src/jobs/source-company.js');
    const { config } = await import('../src/config.js');
    const token = config.apifyToken;
    config.apifyToken = '';
    try {
      await expect(
        realDeps().fetchEmployees('https://www.linkedin.com/company/acme', { jobTitles: [], locations: [], maxItems: 1, mode: 'Short' }),
      ).rejects.toThrow(/^config: APIFY_TOKEN/);
    } finally {
      config.apifyToken = token;
    }
  });
});

describe('API sourcing da azienda', () => {
  it('GET /api/companies/:id/source/preview → max_items, stima con start fee, nessun warning se l\'ICP ha ruoli', async () => {
    const s = await scenario({ target_roles: ['CTO'] });

    const short = await send('GET', `/api/companies/${s.companyId}/source/preview?listId=${s.listId}`);
    expect(short.status).toBe(200);
    // Short $4/1000 × 50 + $0,02 di start fee per run.
    expect(short.body).toEqual({ counts: { max_items: 50 }, est_cost_usd: 0.22, warnings: [], blockers: [] });

    const full = await send('GET', `/api/companies/${s.companyId}/source/preview?listId=${s.listId}&mode=Full%2Bemail&maxItems=100`);
    expect(full.body).toMatchObject({ counts: { max_items: 100 }, est_cost_usd: 1.22, blockers: [] });

    expect((await send('GET', `/api/companies/999999/source/preview?listId=${s.listId}`)).status).toBe(404);
    expect((await send('GET', `/api/companies/${s.companyId}/source/preview?listId=${s.listId}&mode=Mega`)).status).toBe(400);
    expect((await send('GET', `/api/companies/${s.companyId}/source/preview?listId=${s.listId}&maxItems=0`)).status).toBe(400);
  });

  it('preview su ICP senza ruoli → warning (non blocca); ruoli indicati nella query lo tolgono', async () => {
    const s = await scenario({ target_roles: [] });

    const res = await send('GET', `/api/companies/${s.companyId}/source/preview?listId=${s.listId}&maxItems=30`);
    expect(res.body.blockers).toEqual([]);
    expect(res.body.warnings).toEqual([
      "L'ICP non ha ruoli target: verranno estratte le prime 30 persone qualunque. Aggiungi ruoli qui o nell'ICP.",
    ]);

    const withRoles = await send('GET', `/api/companies/${s.companyId}/source/preview?listId=${s.listId}&roles=CTO,VP%20Engineering`);
    expect(withRoles.body.warnings).toEqual([]);
  });

  it('blockers: token mancante, job in corso, lista archiviata/inesistente/non scelta', async () => {
    const { config } = await import('../src/config.js');
    const { insertJob, setJobPid, completeJob } = await import('../src/db/jobs.js');
    const s = await scenario({ target_roles: ['CTO'] });
    const preview = async (query: string) =>
      (await send('GET', `/api/companies/${s.companyId}/source/preview${query}`)).body.blockers as string[];

    const token = config.apifyToken;
    config.apifyToken = '';
    try {
      expect(await preview(`?listId=${s.listId}`)).toEqual(['APIFY_TOKEN mancante nel .env — nessun job avviato.']);
    } finally {
      config.apifyToken = token;
    }

    const running = insertJob('enrich', {});
    setJobPid(running.id, process.pid);
    try {
      expect(await preview(`?listId=${s.listId}`)).toEqual([expect.stringMatching(/^C'è già un job in corso: Arricchimento/)]);
      // Solo il job in corso: niente 400 `blocked`, risponde `launchJob` con 409 `job_running` (T6, FLOW).
      const busy = await send('POST', `/api/companies/${s.companyId}/source`, { listId: s.listId });
      expect(busy.status).toBe(409);
      expect(busy.body).toMatchObject({ code: 'job_running', job_id: running.id });
    } finally {
      completeJob(running.id, { state: 'failed', error: 'process: fine test' });
    }

    expect(await preview('')).toEqual(['Scegli la lista di destinazione.']);
    expect(await preview('?listId=999999')).toEqual(['La lista di destinazione non esiste.']);
    await send('PATCH', `/api/lists/${s.listId}`, { archived: true });
    expect(await preview(`?listId=${s.listId}`)).toEqual([`La lista 'Lista ${seq}' è archiviata: riattivala per aggiungere persone.`]);
  });

  it('azienda senza pagina LinkedIn (solo dominio) → blocker in preview e 400 `blocked` all\'avvio; con l\'URL il blocker sparisce (SPEC B14)', async () => {
    const s = await scenario({ target_roles: ['CTO'] });
    const created = await send('POST', '/api/companies', { website: `https://www.solo-dominio-${seq}.it` });
    expect(created.status).toBe(201);
    const id = created.body.id as number;
    const noLinkedin = 'Azienda senza pagina LinkedIn: recuperala prima (Anagrafica → URL LinkedIn).';

    const preview = await send('GET', `/api/companies/${id}/source/preview?listId=${s.listId}`);
    expect(preview.status).toBe(200);
    expect(preview.body.blockers).toEqual([noLinkedin]);

    const start = await send('POST', `/api/companies/${id}/source`, { listId: s.listId });
    expect(start.status).toBe(400);
    expect(start.body).toEqual({ error: noLinkedin, code: 'blocked', blockers: [noLinkedin] });

    const linked = await send('PATCH', `/api/companies/${id}`, { linkedin_url: `linkedin.com/company/solo-dominio-${seq}` });
    expect(linked.status).toBe(200);
    expect((await send('GET', `/api/companies/${id}/source/preview?listId=${s.listId}`)).body.blockers).toEqual([]);
  });

  it('POST /api/companies/:id/source → 400 `blocked` con i blockers; 404 azienda; 202 con params risolti', async () => {
    const { getJob } = await import('../src/server/jobs.js');
    const s = await scenario({ target_roles: ['CTO'], target_locations: ['Italia'] });

    await send('PATCH', `/api/lists/${s.listId}`, { archived: true });
    const blocked = await send('POST', `/api/companies/${s.companyId}/source`, { listId: s.listId });
    expect(blocked.status).toBe(400);
    expect(blocked.body).toMatchObject({ code: 'blocked', blockers: [expect.stringContaining('archiviata')] });
    expect(blocked.body.error).toBeTypeOf('string');
    await send('PATCH', `/api/lists/${s.listId}`, { archived: false });

    expect((await send('POST', `/api/companies/999999/source`, { listId: s.listId })).status).toBe(404);
    expect((await send('POST', `/api/companies/${s.companyId}/source`, { listId: s.listId, extra: 1 })).status).toBe(400);

    const launcher = createApp({ jobs: { command: 'node', args: ['-e', ''] } });
    const res = await launcher.request(`/api/companies/${s.companyId}/source`, {
      method: 'POST',
      body: JSON.stringify({ listId: s.listId, mode: 'Full' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(202);
    const { job } = (await res.json()) as any;
    expect(job).toMatchObject({
      kind: 'source_company',
      state: 'running',
      params: { companyId: s.companyId, listId: s.listId, roles: ['CTO'], locations: ['Italia'], maxItems: 50, mode: 'Full' },
    });

    // Il figlio `node -e ''` esce subito senza esito: si attende che il job non sia più in corso.
    const deadline = Date.now() + 5000;
    while (getJob(job.id)?.state === 'running' && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    expect(getJob(job.id)?.state).toBe('failed');
  });

  it('POST /api/companies/from-url → crea (201) o ritorna l\'esistente (200), con riferimento ICP opzionale', async () => {
    const icp = (await send('POST', '/api/icps', { name: 'ICP from-url' })).body;

    const created = await send('POST', '/api/companies/from-url', {
      url: 'https://it.linkedin.com/company/Nuova-Spa/about/',
      icpId: icp.id,
      outcome: 'vinta',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      linkedin_url: 'https://www.linkedin.com/company/nuova-spa',
      name: 'nuova-spa',
      created: true,
      reference_of: [{ icp_id: icp.id, outcome: 'vinta' }],
    });
    const detail = (await send('GET', `/api/icps/${icp.id}`)).body;
    expect(detail.reference_companies).toMatchObject([{ company_id: created.body.id, outcome: 'vinta' }]);

    const again = await send('POST', '/api/companies/from-url', { url: 'linkedin.com/company/nuova-spa' });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ id: created.body.id, created: false });

    // Campo unico "URL LinkedIn o sito web" (apollo-lookalike FLOW F.1): un sito crea l'azienda solo-dominio.
    const site = await send('POST', '/api/companies/from-url', { url: 'https://www.nuova.it/chi-siamo', icpId: icp.id });
    expect(site.status).toBe(201);
    expect(site.body).toMatchObject({
      linkedin_url: null,
      domain: 'nuova.it',
      name: 'nuova.it',
      website: 'https://www.nuova.it/chi-siamo',
      created: true,
      reference_of: [{ icp_id: icp.id, outcome: 'riferimento' }],
    });
    const siteAgain = await send('POST', '/api/companies/from-url', { url: 'NUOVA.it' });
    expect(siteAgain.status).toBe(200);
    expect(siteAgain.body).toMatchObject({ id: site.body.id, created: false });

    const notCompany = await send('POST', '/api/companies/from-url', { url: 'https://www.linkedin.com/in/mario' });
    expect(notCompany.status).toBe(400);
    expect(notCompany.body).toEqual({ error: 'Inserisci un URL del tipo linkedin.com/company/<nome>', code: 'invalid_company_url' });
    for (const bad of ['', 'non un sito', 'https://acme.wixsite.com/home']) {
      const invalid = await send('POST', '/api/companies/from-url', { url: bad });
      expect(invalid.status, bad).toBe(400);
      expect(invalid.body).toEqual({
        error: "Inserisci l'URL LinkedIn dell'azienda (linkedin.com/company/<nome>) o il suo sito web (es. acme.it)",
        code: 'invalid_company_url',
      });
    }

    const noIcp = await send('POST', '/api/companies/from-url', { url: 'linkedin.com/company/orfana', icpId: 999999 });
    expect(noIcp.status).toBe(400);
    expect(noIcp.body.code).toBe('icp_not_found');
    expect((await send('GET', '/api/companies?q=orfana')).body.items).toEqual([]);
  });
});
