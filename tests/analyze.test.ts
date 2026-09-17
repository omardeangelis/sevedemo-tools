import { beforeEach, describe, expect, it } from 'vitest';

// Analisi AI del prospect (crm-foundation T11). Import dinamici: la config (DB_PATH isolato da
// tests/setup.ts) è letta a import-time. Claude **mai** chiamato: `client` è sempre un fake.
const { db } = await import('../src/db/index.js');
const { upsertProspect, addSource } = await import('../src/db/prospects.js');
const { createIcp } = await import('../src/db/icps.js');
const { updateSettings } = await import('../src/db/settings.js');
const { analyzeProspect } = await import('../src/analysis/analyze.js');

type Enrichment = import('../src/enrich/profile-detail.js').Enrichment;

const URL_ANNA = 'https://www.linkedin.com/in/anna-kubernetes';

const GOOD = {
  summary: 'CTO di una scale-up SaaS milanese, guida la migrazione a Kubernetes del prodotto.',
  angles: [
    { title: 'Migrazione a Kubernetes', rationale: 'Ha commentato che stanno migrando a Kubernetes.' },
    { title: 'Team platform in crescita', rationale: "Nell'esperienza attuale guida 40 persone." },
    { title: 'Costi cloud', rationale: 'Il passaggio a servizi gestiti apre il tema dei costi.' },
  ],
  fit: 'alto',
  fit_reason: 'Ruolo e settore coincidono con l\'ICP.',
};

type FakeResponse = import('../src/analysis/analyze.js').AnalysisResponse;

const ok = (output: unknown = GOOD): FakeResponse => ({
  content: [{ type: 'text', text: typeof output === 'string' ? output : JSON.stringify(output) }],
  stop_reason: 'end_turn',
  stop_details: null,
});

/** Client Anthropic fake: risponde in sequenza (l'ultima si ripete) e registra le chiamate. */
function fakeClient(...responses: Array<FakeResponse | Error>) {
  const calls: Array<{ body: any; options?: { signal?: AbortSignal } }> = [];
  return {
    calls,
    messages: {
      create: async (body: any, options?: { signal?: AbortSignal }) => {
        calls.push({ body, options });
        const r = responses[Math.min(calls.length - 1, responses.length - 1)];
        if (r instanceof Error) throw r;
        return r;
      },
    },
  };
}

/** Deps di enrichment fake (T10): dati per gli URL noti. */
function fakeEnrich(data: Record<string, Enrichment> = {}) {
  const calls: string[][] = [];
  return {
    calls,
    enrich: async (urls: string[]) => {
      calls.push(urls);
      const map = new Map<string, Enrichment>();
      for (const u of urls) if (data[u]) map.set(u, data[u]);
      return map;
    },
  };
}

function reset(): void {
  db.exec('DELETE FROM prospects; DELETE FROM posts; DELETE FROM lists; DELETE FROM companies; DELETE FROM icps; DELETE FROM jobs; DELETE FROM settings;');
}

function seedIcp(): number {
  return createIcp({ name: 'CTO startup IT', description: 'CTO di startup software italiane', target_roles: ['CTO'], pains: 'Costi cloud' }).id;
}

/** Prospect arricchito (busta raw di profile-detail) con un commento a un mio post. */
function seedAnna(): number {
  const id = upsertProspect({
    linkedinUrl: URL_ANNA,
    fullName: 'Anna Rossi',
    headline: 'CTO @ Nuvola SaaS',
    about: 'Guido il team tecnico di Nuvola: 40 persone tra platform e data.',
    companyName: 'Nuvola SaaS',
    title: 'CTO',
    location: 'Milano',
    enrichedAt: '2026-09-10T10:00:00.000Z',
    enrichmentAttemptedAt: '2026-09-10T10:00:00.000Z',
    raw: {
      source: {},
      experience: [{ title: 'CTO', company: 'Nuvola SaaS', description: 'Architettura e hiring tecnico.', is_current: true }],
      education: [{ school: 'Politecnico di Milano' }],
      certifications: [],
    },
  }).id;
  const postId = Number(
    db
      .prepare('INSERT INTO posts (post_url, text_excerpt) VALUES (?, ?)')
      .run('https://www.linkedin.com/posts/omar_devops-activity-1', 'Tre lezioni dalla nostra migrazione del cluster')
      .lastInsertRowid,
  );
  addSource(id, { kind: 'post_comment', postId, commentText: 'Anche noi stiamo migrando a Kubernetes' });
  return id;
}

function analysesOf(prospectId: number): any[] {
  return db.prepare('SELECT * FROM analyses WHERE prospect_id = ? ORDER BY id').all(prospectId);
}

beforeEach(() => {
  reset();
  updateSettings({ company_name: 'SeVedemo', company_description: 'Consulenza DevOps e piattaforme cloud per software house.' });
});

describe('analyzeProspect', () => {
  it('prompt con i segnali di provenienza (commento) → analisi salvata con fit e 3 angoli', async () => {
    const icp = seedIcp();
    const anna = seedAnna();
    const client = fakeClient(ok());

    const result = await analyzeProspect(anna, icp, { client });

    expect(result.outcome).toBe('analyzed');
    expect(client.calls).toHaveLength(1);
    const { body } = client.calls[0];
    expect(body.messages[0].content).toContain('Kubernetes');
    const rows = analysesOf(anna);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ icp_id: icp, fit: 'alto', model: 'claude-opus-5' });
    expect(JSON.parse(rows[0].angles)).toHaveLength(3);
  });
});

describe('analyzeProspect: retry, rifiuti, arricchimento, input invariato', () => {
  it('JSON non valido una volta, poi valido → 1 retry sulla stessa deadline e analisi salvata', async () => {
    const icp = seedIcp();
    const anna = seedAnna();
    const client = fakeClient(ok('non è json'), ok());

    const result = await analyzeProspect(anna, icp, { client });

    expect(result.outcome).toBe('analyzed');
    expect(client.calls).toHaveLength(2);
    expect(client.calls[1].options?.signal).toBe(client.calls[0].options?.signal);
    expect(client.calls[1].body.messages[0].content).toMatch(/risposta precedente non era valida/);
    expect(analysesOf(anna)).toHaveLength(1);
  });

  it('structured outputs: output_config.format con lo schema; 2 risposte fuori schema → failed invalid_output', async () => {
    const icp = seedIcp();
    const anna = seedAnna();
    const twoAngles = { ...GOOD, angles: GOOD.angles.slice(0, 2) };
    const client = fakeClient(ok(twoAngles));

    const result = await analyzeProspect(anna, icp, { client });

    expect(client.calls[0].body).toMatchObject({
      model: 'claude-opus-5',
      max_tokens: 16_000,
      output_config: { format: { type: 'json_schema', schema: expect.objectContaining({ type: 'object' }) } },
    });
    expect(client.calls).toHaveLength(2);
    expect(result).toMatchObject({ outcome: 'failed', errorKind: 'invalid_output', error: 'Risposta del modello non valida (2 tentativi). Riprova tra poco.' });
    expect(analysesOf(anna)).toHaveLength(0);
  });

  it("refusal → nessuna riga analyses, attività `analysis` con meta.error, error_kind e icp_id; nessun retry", async () => {
    const icp = seedIcp();
    const anna = seedAnna();
    const client = fakeClient({ content: [], stop_reason: 'refusal', stop_details: { category: 'cyber', explanation: null } });

    const result = await analyzeProspect(anna, icp, { client });

    expect(result).toMatchObject({ outcome: 'failed', errorKind: 'refusal' });
    expect(client.calls).toHaveLength(1);
    expect(analysesOf(anna)).toHaveLength(0);
    const activity = db.prepare(`SELECT * FROM activities WHERE prospect_id = ? AND kind = 'analysis'`).get(anna) as any;
    expect(JSON.parse(activity.meta)).toMatchObject({
      icp_id: icp,
      error_kind: 'refusal',
      refusal_category: 'cyber',
      error: 'Il modello ha rifiutato di analizzare questo profilo. Puoi riprovare o scrivere il messaggio a mano.',
    });
  });

  it('max_tokens → failed con attività; errore del provider → failed leggibile; timeout → messaggio di deadline', async () => {
    const icp = seedIcp();
    const anna = seedAnna();

    const truncated = await analyzeProspect(anna, icp, { client: fakeClient({ content: [{ type: 'text', text: '{"summ' }], stop_reason: 'max_tokens' }) });
    expect(truncated).toMatchObject({ outcome: 'failed', errorKind: 'max_tokens' });

    const down = await analyzeProspect(anna, icp, { client: fakeClient(new Error('529 overloaded')) });
    expect(down).toMatchObject({ outcome: 'failed', errorKind: 'error', error: 'Chiamata al modello non riuscita: 529 overloaded' });

    const hanging = {
      messages: {
        create: (_body: unknown, options?: { signal?: AbortSignal }) =>
          new Promise<never>((_, reject) => options?.signal?.addEventListener('abort', () => reject(new Error('Request was aborted.')))),
      },
    };
    const slow = await analyzeProspect(anna, icp, { client: hanging, timeoutMs: 30 });
    expect(slow).toMatchObject({ outcome: 'failed', errorKind: 'error', error: expect.stringMatching(/^Nessuna risposta dal modello/) });

    const kinds = db
      .prepare(`SELECT json_extract(meta, '$.error_kind') FROM activities WHERE prospect_id = ? AND kind = 'analysis' ORDER BY id`)
      .pluck()
      .all(anna);
    expect(kinds).toEqual(['max_tokens', 'error', 'error']);
    expect(analysesOf(anna)).toHaveLength(0);
  });

  it('errore di configurazione (chiave mancante / 401) → failed senza attività sul prospect', async () => {
    const icp = seedIcp();
    const anna = seedAnna();
    const missing = await analyzeProspect(anna, icp, { client: fakeClient(new Error('config: ANTHROPIC_API_KEY mancante nel .env.')) });
    expect(missing).toMatchObject({ outcome: 'failed', error: expect.stringMatching(/^config:/), activity: null });
    const unauthorized = Object.assign(new Error('401 invalid x-api-key'), { status: 401 });
    expect(await analyzeProspect(anna, icp, { client: fakeClient(unauthorized) })).toMatchObject({
      outcome: 'failed',
      error: expect.stringMatching(/^config: ANTHROPIC_API_KEY non valida/),
    });
    expect(db.prepare(`SELECT COUNT(*) FROM activities WHERE kind = 'analysis'`).pluck().get()).toBe(0);
  });

  it('input identico → skipped_same_input senza chiamate; force rianalizza; profilo cambiato → nuova analisi', async () => {
    const icp = seedIcp();
    const anna = seedAnna();
    await analyzeProspect(anna, icp, { client: fakeClient(ok()) });

    const again = fakeClient(ok());
    expect((await analyzeProspect(anna, icp, { client: again })).outcome).toBe('skipped_same_input');
    expect(again.calls).toHaveLength(0);

    expect((await analyzeProspect(anna, icp, { client: again, force: true })).outcome).toBe('analyzed');
    db.prepare(`UPDATE prospects SET about = 'Ora guida anche il team sicurezza.' WHERE id = ?`).run(anna);
    expect((await analyzeProspect(anna, icp, { client: again })).outcome).toBe('analyzed');
    expect(again.calls).toHaveLength(2);
    expect(analysesOf(anna)).toHaveLength(3);
  });

  it('non arricchito: not_enriched; con enrichFirst chiama la deps di enrichment e poi analizza', async () => {
    const icp = seedIcp();
    const url = 'https://www.linkedin.com/in/bruno-da-arricchire';
    const bruno = upsertProspect({ linkedinUrl: url, fullName: 'Bruno' }).id;
    const client = fakeClient(ok());

    expect(await analyzeProspect(bruno, icp, { client })).toMatchObject({ outcome: 'not_enriched' });
    expect(client.calls).toHaveLength(0);

    const enrich = fakeEnrich({ [url]: { about: 'Head of Platform in una fintech.', title: 'Head of Platform' } });
    const result = await analyzeProspect(bruno, icp, { client, enrich, enrichFirst: true });

    expect(result).toMatchObject({ outcome: 'analyzed', enrichedFirst: true });
    expect(enrich.calls).toEqual([[url]]);
    expect(client.calls[0].body.messages[0].content).toContain('Head of Platform in una fintech.');
    expect(analysesOf(bruno)).toHaveLength(1);
  });

  it('enrichFirst senza dati → not_enrichable (nessuna chiamata al modello); About compilato a mano basta', async () => {
    const icp = seedIcp();
    const carla = upsertProspect({ linkedinUrl: 'https://www.linkedin.com/in/carla-privata', fullName: 'Carla' }).id;
    const client = fakeClient(ok());

    const result = await analyzeProspect(carla, icp, { client, enrich: fakeEnrich(), enrichFirst: true });
    expect(result).toMatchObject({
      outcome: 'not_enrichable',
      error: 'Profilo senza dati pubblici: analisi non possibile. Puoi compilare a mano About/ruolo e riprovare.',
    });
    expect(client.calls).toHaveLength(0);

    db.prepare(`UPDATE prospects SET about = 'Founder di uno studio di design.' WHERE id = ?`).run(carla);
    expect((await analyzeProspect(carla, icp, { client })).outcome).toBe('analyzed');
  });

  it('JSON-only (ANALYSIS_STRUCTURED=0): nessun output_config, istruzione nel system, stesso input_hash', async () => {
    const { config } = await import('../src/config.js');
    const icp = seedIcp();
    const anna = seedAnna();
    await analyzeProspect(anna, icp, { client: fakeClient(ok()) });

    config.analysisStructured = false;
    try {
      const client = fakeClient(ok('```json\n' + JSON.stringify(GOOD) + '\n```'));
      expect((await analyzeProspect(anna, icp, { client })).outcome).toBe('skipped_same_input');
      expect((await analyzeProspect(anna, icp, { client, force: true })).outcome).toBe('analyzed');
      expect(client.calls[0].body.output_config).toBeUndefined();
      expect(client.calls[0].body.system).toMatch(/SOLO un oggetto JSON valido/);
    } finally {
      config.analysisStructured = true;
    }
  });
});

const { createApp } = await import('../src/server/app.js');
const { config } = await import('../src/config.js');
const { analyzeMany } = await import('../src/jobs/analyze.js');
const { createList, addMembers, updateList } = await import('../src/db/lists.js');
const jobs = await import('../src/server/jobs.js');

function request(app: ReturnType<typeof createApp>, method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('POST /api/prospects/:id/analyze (sincrona)', () => {
  it('client fake → 200 con l\'analisi; GET /api/prospects/:id ha latest_analysis con 3 angoli', async () => {
    const icp = seedIcp();
    const anna = seedAnna();
    const app = createApp({ analyzeDeps: { client: fakeClient(ok()), enrich: fakeEnrich() } });

    const res = await request(app, 'POST', `/api/prospects/${anna}/analyze`, { icpId: icp });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toMatchObject({ outcome: 'analyzed', enriched_first: false, stale: false, analysis: { icp_id: icp, fit: 'alto' } });
    const detail = (await (await app.request(`/api/prospects/${anna}`)).json()) as any;
    expect(detail.latest_analysis.angles).toHaveLength(3);
  });

  it('refusal → 502 con il testo del FLOW, nessuna riga analyses, attività con meta.error in timeline', async () => {
    const icp = seedIcp();
    const anna = seedAnna();
    const refusal = { content: [], stop_reason: 'refusal', stop_details: { category: null } };
    const app = createApp({ analyzeDeps: { client: fakeClient(refusal), enrich: fakeEnrich() } });

    const res = await request(app, 'POST', `/api/prospects/${anna}/analyze`, { icpId: icp });

    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({
      code: 'refusal',
      error: 'Il modello ha rifiutato di analizzare questo profilo. Puoi riprovare o scrivere il messaggio a mano.',
    });
    expect(analysesOf(anna)).toHaveLength(0);
    const detail = (await (await app.request(`/api/prospects/${anna}`)).json()) as any;
    expect(detail.timeline[0]).toMatchObject({ kind: 'analysis', meta: { error_kind: 'refusal', icp_id: icp } });
  });

  it('non arricchito → 409 not_enriched; con enrichFirst arricchisce inline e analizza; senza dati → 409 not_enrichable', async () => {
    const icp = seedIcp();
    const url = 'https://www.linkedin.com/in/bruno-da-arricchire';
    const bruno = upsertProspect({ linkedinUrl: url }).id;
    const carla = upsertProspect({ linkedinUrl: 'https://www.linkedin.com/in/carla-privata' }).id;
    const enrich = fakeEnrich({ [url]: { about: 'Head of Platform.' } });
    const app = createApp({ analyzeDeps: { client: fakeClient(ok()), enrich } });

    const refused = await request(app, 'POST', `/api/prospects/${bruno}/analyze`, { icpId: icp });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: 'not_enriched' });

    const res = await request(app, 'POST', `/api/prospects/${bruno}/analyze`, { icpId: icp, enrichFirst: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ outcome: 'analyzed', enriched_first: true });
    expect(enrich.calls).toEqual([[url]]);

    const empty = await request(app, 'POST', `/api/prospects/${carla}/analyze`, { icpId: icp, enrichFirst: true });
    expect(empty.status).toBe(409);
    expect(await empty.json()).toMatchObject({ code: 'not_enrichable', error: expect.stringMatching(/^Profilo senza dati pubblici/) });
  });

  it('input invariato → 200 skipped_same_input senza chiamate; 404 prospect o ICP; 400 body; chiave mancante → 400 blocked', async () => {
    const icp = seedIcp();
    const anna = seedAnna();
    const client = fakeClient(ok());
    const app = createApp({ analyzeDeps: { client, enrich: fakeEnrich() } });
    await request(app, 'POST', `/api/prospects/${anna}/analyze`, { icpId: icp });

    const again = await request(app, 'POST', `/api/prospects/${anna}/analyze`, { icpId: icp });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ outcome: 'skipped_same_input' });
    expect(client.calls).toHaveLength(1);

    expect((await request(app, 'POST', `/api/prospects/999999/analyze`, { icpId: icp })).status).toBe(404);
    expect((await request(app, 'POST', `/api/prospects/${anna}/analyze`, { icpId: 999999 })).status).toBe(404);
    expect((await request(app, 'POST', `/api/prospects/${anna}/analyze`, {})).status).toBe(400);
    expect((await request(app, 'POST', `/api/prospects/${anna}/analyze`, { icpId: icp, altro: 1 })).status).toBe(400);

    const saved = config.anthropicApiKey;
    config.anthropicApiKey = '';
    try {
      const blocked = await request(app, 'POST', `/api/prospects/${anna}/analyze`, { icpId: icp, force: true });
      expect(blocked.status).toBe(400);
      expect(await blocked.json()).toMatchObject({ code: 'blocked', blockers: [expect.stringMatching(/ANTHROPIC_API_KEY mancante/)] });
    } finally {
      config.anthropicApiKey = saved;
    }
    expect(client.calls).toHaveLength(1);
  });
});

describe('analyzeMany (job bulk)', () => {

  /** Client che rifiuta i profili il cui prompt contiene `refuseIf`, altrimenti risponde GOOD. */
  function selectiveClient(refuseIf: string) {
    const calls: string[] = [];
    return {
      calls,
      messages: {
        create: async (body: any): Promise<FakeResponse> => {
          const user = body.messages[0].content as string;
          calls.push(user);
          return user.includes(refuseIf) ? { content: [], stop_reason: 'refusal', stop_details: null } : ok();
        },
      },
    };
  }

  it('lista: arricchisce prima i mancanti (P5), analizza, salta input identico e i non arricchibili recenti; counts e summary', async () => {
    const icp = seedIcp();
    const list = createList({ icpId: icp, name: 'CTO startup' })!.id;
    const anna = seedAnna();
    const urlB = 'https://www.linkedin.com/in/bruno-da-arricchire';
    const bruno = upsertProspect({ linkedinUrl: urlB, fullName: 'Bruno' }).id;
    const carla = upsertProspect({ linkedinUrl: 'https://www.linkedin.com/in/carla-privata', enrichmentAttemptedAt: new Date().toISOString() }).id;
    const dario = upsertProspect({ linkedinUrl: 'https://www.linkedin.com/in/dario-rifiutato', fullName: 'Dario Rifiutato', about: 'Bio', enrichedAt: '2026-09-01T00:00:00.000Z' }).id;
    const elisa = upsertProspect({ linkedinUrl: 'https://www.linkedin.com/in/elisa-gia-fatta', fullName: 'Elisa', about: 'Bio', enrichedAt: '2026-09-01T00:00:00.000Z' }).id;
    addMembers(list, [anna, bruno, carla, dario, elisa]);
    await analyzeProspect(elisa, icp, { client: fakeClient(ok()) });

    const enrich = fakeEnrich({ [urlB]: { about: 'Head of Platform.' } });
    const client = selectiveClient('Dario Rifiutato');
    const result = await analyzeMany({ listId: list, onlyMissing: true, force: false }, { client, enrich });

    expect(result.counts).toEqual({
      selected: 5,
      targets: 3,
      enriched_first: 1,
      analyzed: 2,
      skipped_same_input: 1,
      skipped_analyzed: 0,
      not_enrichable: 1,
      refusals: 1,
      errors: 0,
      not_found: 0,
      prospects_merged: 0,
    });
    expect(enrich.calls).toEqual([[urlB]]);
    expect(client.calls).toHaveLength(3);
    expect(result.summary).toBe(
      'Analisi completata: 2 analizzati · 1 arricchito prima · 1 saltato (dati identici) · 1 rifiutato dal modello · 1 non analizzabile (profilo senza dati).',
    );
    expect(result.warnings).toEqual([expect.stringMatching(/^1 profilo rifiutato dal modello/)]);
    expect(analysesOf(bruno)).toHaveLength(1);
    const failure = db.prepare(`SELECT list_id, meta FROM activities WHERE prospect_id = ? AND kind = 'analysis'`).get(dario) as any;
    expect(failure.list_id).toBe(list);
    expect(JSON.parse(failure.meta)).toMatchObject({ error_kind: 'refusal', icp_id: icp });
  });

  it('onlyMissing salta i già analizzati con dati cambiati; force li rianalizza; selezione con id inesistenti', async () => {
    const icp = seedIcp();
    const list = createList({ icpId: icp, name: 'CTO' })!.id;
    const anna = seedAnna();
    addMembers(list, [anna]);
    await analyzeProspect(anna, icp, { client: fakeClient(ok()) });
    db.prepare(`UPDATE prospects SET about = 'Nuovo about' WHERE id = ?`).run(anna);

    const client = fakeClient(ok());
    const deps = { client, enrich: fakeEnrich() };
    expect((await analyzeMany({ listId: list, onlyMissing: true }, deps)).counts).toMatchObject({ skipped_analyzed: 1, analyzed: 0 });
    expect(client.calls).toHaveLength(0);
    expect((await analyzeMany({ listId: list, onlyMissing: true, force: true }, deps)).counts).toMatchObject({ analyzed: 1 });

    const selection = await analyzeMany({ prospectIds: [anna, 999_999], icpId: icp }, deps);
    expect(selection.counts).toMatchObject({ selected: 1, not_found: 1, skipped_same_input: 1 });
  });

  it('tutte le analisi in errore → job fallito con errore attribuito; config mancante → `config:`; lista archiviata → `config:`', async () => {
    const icp = seedIcp();
    const list = createList({ icpId: icp, name: 'CTO' })!.id;
    const anna = seedAnna();
    addMembers(list, [anna]);

    await expect(analyzeMany({ listId: list }, { client: fakeClient(new Error('overloaded')), enrich: fakeEnrich() })).rejects.toThrow(
      /^actor:claude-opus-5: Chiamata al modello non riuscita: overloaded/,
    );
    const { realDeps } = await import('../src/jobs/analyze.js');
    const saved = config.anthropicApiKey;
    config.anthropicApiKey = '';
    try {
      await expect(analyzeMany({ listId: list }, { client: realDeps().client, enrich: fakeEnrich() })).rejects.toThrow(
        /^config: ANTHROPIC_API_KEY mancante/,
      );
    } finally {
      config.anthropicApiKey = saved;
    }
    updateList(list, { archived: true });
    await expect(analyzeMany({ listId: list }, { client: fakeClient(ok()), enrich: fakeEnrich() })).rejects.toThrow(/^config: .*archiviata/);
    await expect(analyzeMany({ prospectIds: [anna] } as any, { client: fakeClient(ok()), enrich: fakeEnrich() })).rejects.toThrow(/^config:/);
  });

  it('handler registrato: il wrapper del job esegue analyze con deps fake e scrive summary e counts', async () => {
    const { runJob } = await import('../src/server/job-entry.js');
    const { insertJob } = await import('../src/db/jobs.js');
    const icp = seedIcp();
    const anna = seedAnna();
    const job = insertJob('analyze', { prospectIds: [anna], icpId: icp, force: false });

    const done = await runJob(job.id, { resolveDeps: () => ({ client: fakeClient(ok()), enrich: fakeEnrich() }) });

    expect(done.state).toBe('succeeded');
    expect(done.result?.counts).toMatchObject({ analyzed: 1 });
    expect(done.result?.summary).toBe('Analisi completata: 1 analizzato.');
  });
});

describe('API analisi bulk: preview e avvio', () => {
  type Preview = import('../src/jobs/types.js').JobPreview;
  /** Figlio fittizio che resta vivo 200 ms ed esce: nessun handler reale, nessun Claude. */
  const app = createApp({ jobs: { command: 'node', args: ['-e', 'setTimeout(() => {}, 200)'] } });
  const preview = async (qs: string) => (await (await app.request(`/api/analyze/preview?${qs}`)).json()) as Preview & { model: string };

  async function waitTerminal(id: number) {
    const deadline = Date.now() + 5000;
    while (jobs.getJob(id)?.state === 'running') {
      if (Date.now() > deadline) throw new Error(`job ${id} ancora running`);
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  it('selezione di 2 non arricchiti, prezzo profilo null → "2 da arricchire · 2 da analizzare · $0,06" + warning stima', async () => {
    const icp = seedIcp();
    const a = upsertProspect({ linkedinUrl: 'https://www.linkedin.com/in/a-uno' }).id;
    const b = upsertProspect({ linkedinUrl: 'https://www.linkedin.com/in/b-due' }).id;
    const saved = config.prices.profileDetailUsd;
    config.prices.profileDetailUsd = null;
    try {
      const p = await preview(`prospectIds=${a},${b}&icpId=${icp}`);
      expect(p.counts).toMatchObject({ selected: 2, to_enrich: 2, to_analyze: 2, skipped_same_input: 0 });
      expect(p.est_cost_usd).toBe(0.06);
      expect(p.warnings).toEqual([expect.stringMatching(/stima arricchimento non disponibile/)]);
      expect(p.blockers).toEqual([]);
      expect(p.model).toBe('claude-opus-5');

      config.prices.profileDetailUsd = 0.01;
      expect((await preview(`prospectIds=${a},${b}&icpId=${icp}`)).est_cost_usd).toBe(0.08);
    } finally {
      config.prices.profileDetailUsd = saved;
    }
  });

  it('lista: già analizzati con gli stessi dati saltati (force li conta); warning azienda vuota e ICP senza pains; 400/404', async () => {
    const icp = seedIcp();
    const bare = createIcp({ name: 'Senza pains' }).id;
    const list = createList({ icpId: icp, name: 'CTO' })!.id;
    const anna = seedAnna();
    const bruno = upsertProspect({ linkedinUrl: 'https://www.linkedin.com/in/bruno-bio', about: 'Bio' }).id;
    addMembers(list, [anna, bruno]);
    await analyzeProspect(anna, icp, { client: fakeClient(ok()) });

    expect((await preview(`listId=${list}`)).counts).toMatchObject({ selected: 2, to_enrich: 0, to_analyze: 1, skipped_same_input: 1 });
    expect((await preview(`listId=${list}&force=true`)).counts).toMatchObject({ to_analyze: 2, skipped_same_input: 0 });
    expect((await preview(`listId=${list}`)).est_cost_usd).toBe(0.03);

    updateSettings({ company_description: null });
    const warned = await preview(`prospectIds=${bruno}&icpId=${bare}`);
    expect(warned.warnings).toEqual([
      'Descrizione della tua azienda vuota: angoli meno mirati.',
      "L'ICP non ha pains/descrizione: il fit sarà poco affidabile.",
    ]);

    expect((await app.request('/api/analyze/preview?listId=999999')).status).toBe(404);
    expect((await app.request(`/api/analyze/preview?prospectIds=${anna}`)).status).toBe(400);
    expect((await app.request(`/api/analyze/preview?prospectIds=${anna}&icpId=999999`)).status).toBe(404);
    expect((await app.request('/api/analyze/preview')).status).toBe(400);
  });

  it('POST /api/analyze e /api/lists/:id/analyze → 202 job analyze con params espliciti; 404; body non valido 400', async () => {
    const icp = seedIcp();
    const list = createList({ icpId: icp, name: 'CTO' })!.id;
    const anna = seedAnna();
    addMembers(list, [anna]);

    const res = await request(app, 'POST', '/api/analyze', { prospectIds: [anna, anna], icpId: icp });
    expect(res.status).toBe(202);
    const job = ((await res.json()) as any).job;
    expect(job).toMatchObject({ kind: 'analyze', params: { prospectIds: [anna], icpId: icp, onlyMissing: false, force: false } });
    await waitTerminal(job.id);

    const listRes = await app.request(`/api/lists/${list}/analyze`, { method: 'POST' });
    expect(listRes.status).toBe(202);
    const listJob = ((await listRes.json()) as any).job;
    expect(listJob.params).toEqual({ listId: list, onlyMissing: true, force: false });
    await waitTerminal(listJob.id);

    expect((await request(app, 'POST', '/api/analyze', { prospectIds: [anna], icpId: 999999 })).status).toBe(404);
    expect((await request(app, 'POST', '/api/analyze', { prospectIds: [], icpId: icp })).status).toBe(400);
    expect((await request(app, 'POST', '/api/lists/999999/analyze', {})).status).toBe(404);
    expect((await request(app, 'POST', `/api/lists/${list}/analyze`, { onlyMissing: 'si' })).status).toBe(400);
  });

  it('blocchi: chiave Anthropic mancante, lista archiviata, Apify mancante con arricchimenti → preview + 400 `blocked`; solo job in corso → 409', async () => {
    const { insertJob, setJobPid, completeJob } = await import('../src/db/jobs.js');
    const icp = seedIcp();
    const list = createList({ icpId: icp, name: 'CTO' })!.id;
    const bare = upsertProspect({ linkedinUrl: 'https://www.linkedin.com/in/da-arricchire' }).id;
    addMembers(list, [bare]);

    const savedKey = config.anthropicApiKey;
    const savedToken = config.apifyToken;
    config.anthropicApiKey = '';
    config.apifyToken = '';
    try {
      const p = await preview(`listId=${list}`);
      expect(p.blockers).toEqual([
        expect.stringMatching(/^ANTHROPIC_API_KEY mancante/),
        expect.stringMatching(/^APIFY_TOKEN mancante.*1 prospect vanno arricchiti/),
      ]);
      const res = await request(app, 'POST', `/api/lists/${list}/analyze`, {});
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'blocked', blockers: p.blockers });
    } finally {
      config.anthropicApiKey = savedKey;
      config.apifyToken = savedToken;
    }

    updateList(list, { archived: true });
    expect((await preview(`listId=${list}`)).blockers).toEqual([expect.stringMatching(/^Lista archiviata/)]);
    expect((await request(app, 'POST', `/api/lists/${list}/analyze`, {})).status).toBe(400);
    updateList(list, { archived: false });

    const running = insertJob('enrich', {});
    setJobPid(running.id, process.pid);
    try {
      expect((await preview(`listId=${list}`)).blockers).toEqual([expect.stringMatching(/^C'è già un job in corso/)]);
      const res = await request(app, 'POST', '/api/analyze', { prospectIds: [bare], icpId: icp });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: 'job_running', job_id: running.id });
    } finally {
      completeJob(running.id, { state: 'failed', error: 'process: fine test' });
    }
    expect(db.prepare(`SELECT COUNT(*) FROM jobs WHERE kind = 'analyze'`).pluck().get()).toBe(0);
  });
});

describe('GET /api/prospects/:id/analyses', () => {
  it('latest, history, stale dopo il cambio profilo, last_error dopo un rifiuto, state; 400 senza icpId, 404', async () => {
    const icp = seedIcp();
    const anna = seedAnna();
    const app = createApp();
    const get = async (qs: string) => (await (await app.request(`/api/prospects/${anna}/analyses?${qs}`)).json()) as any;

    expect(await get(`icpId=${icp}`)).toMatchObject({ icp_id: icp, latest: null, stale: false, history: [], state: null, last_error: null, analyzable: true });

    await analyzeProspect(anna, icp, { client: fakeClient(ok()) });
    const fresh = await get(`icpId=${icp}`);
    expect(fresh).toMatchObject({ stale: false, state: 'alto', latest: { fit: 'alto', icp_name: 'CTO startup IT' } });
    expect(fresh.latest.angles).toHaveLength(3);
    expect(fresh.history).toHaveLength(1);

    db.prepare(`UPDATE prospects SET about = 'Ora guida anche la sicurezza.' WHERE id = ?`).run(anna);
    expect(await get(`icpId=${icp}`)).toMatchObject({ stale: true, state: 'alto' });

    await analyzeProspect(anna, icp, { client: fakeClient({ content: [], stop_reason: 'refusal' }), force: true });
    expect(await get(`icpId=${icp}`)).toMatchObject({
      stale: true,
      state: 'rifiutata',
      latest: { fit: 'alto' },
      last_error: { kind: 'refusal', message: expect.stringMatching(/^Il modello ha rifiutato/) },
    });

    expect((await app.request(`/api/prospects/${anna}/analyses`)).status).toBe(400);
    expect((await app.request(`/api/prospects/${anna}/analyses?icpId=999999`)).status).toBe(404);
    expect((await app.request(`/api/prospects/999999/analyses?icpId=${icp}`)).status).toBe(404);
  });
});
