import { beforeEach, describe, expect, it, vi } from 'vitest';

// Log dei run (people-first-crm T28, SPEC J8–J11, PLAN P-10): righe scritte dal processo che esegue il run,
// lette da `GET /api/runs/:id/log`. Import dinamici: la config (DB_PATH isolato) è letta a import-time.
const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/server/app.js');
const { completeJob, insertJob } = await import('../src/db/jobs.js');
const { runJob } = await import('../src/server/job-entry.js');
const { runLog, withRunLog } = await import('../src/runs/log.js');
const jobs = await import('../src/server/jobs.js');
const { config } = await import('../src/config.js');

const app = createApp();

async function readLog(id: number, query = '') {
  const res = await app.request(`/api/runs/${id}/log${query}`);
  return { status: res.status, body: (await res.json()) as any };
}

/** Run già concluso su cui scrivere righe a mano: un run lasciato `running` senza pid lo chiuderebbe il server. */
function finishedRun(kind: Parameters<typeof insertJob>[0]) {
  const row = insertJob(kind, {});
  return { id: row.id, close: () => completeJob(row.id, { state: 'succeeded', result: { summary: 'ok', counts: {} } }) };
}

/** Attende che il job esca da `running` (il figlio è terminato e il parent l'ha visto). */
async function waitTerminal(id: number, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = jobs.getJob(id);
    if (job && job.state !== 'running') return job;
    if (Date.now() > deadline) throw new Error(`job ${id} ancora running dopo ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

beforeEach(() => {
  db.exec('DELETE FROM jobs;');
});

describe('runJob scrive il log del run (J8, J9)', () => {
  it('avvio, righe dell\'handler ed esito, con seq crescenti e orari ISO; il run è marcato "con log"', async () => {
    const row = insertJob('enrich', { prospectIds: [1, 2], provider: 'apify' });
    const done = await runJob(row.id, {
      resolveDeps: () => ({}),
      handlers: {
        enrich: async () => {
          runLog.info('Apify · profilo · Mario Rossi');
          runLog.warn('Nessun dato per Anna Bianchi');
          runLog.info('2 profili elaborati');
          return { summary: 'Arricchimento: 1 arricchito.', counts: { enriched: 1, errors: 0 }, warnings: [] };
        },
      },
    });
    expect(done.state).toBe('succeeded');

    const { status, body } = await readLog(row.id);
    expect(status).toBe(200);
    expect(body).toMatchObject({ logged: true, state: 'succeeded', omitted: 0 });
    expect(body.lines.map((l: any) => l.message)).toEqual([
      'Avvio: Arricchimento (Apify)',
      'Apify · profilo · Mario Rossi',
      'Nessun dato per Anna Bianchi',
      '2 profili elaborati',
      'Fine: completato',
    ]);
    expect(body.lines.map((l: any) => l.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(body.lines.map((l: any) => l.level)).toEqual(['info', 'info', 'warn', 'info', 'info']);
    const times = body.lines.map((l: any) => l.at);
    expect(times[0]).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect([...times].sort()).toEqual(times);

    // `after`: solo le righe nuove (polling del dettaglio a run in corso).
    const tail = await readLog(row.id, '?after=4');
    expect(tail.body.lines.map((l: any) => l.seq)).toEqual([5]);
    expect(tail.body.omitted).toBe(0);
  });

  it('esito con avvisi e run fallito: la riga finale porta l\'errore attribuito', async () => {
    const warned = insertJob('analyze', { prospectIds: [1] });
    await runJob(warned.id, {
      resolveDeps: () => ({}),
      handlers: {
        analyze: async () => ({
          summary: 'Analisi: 1 analizzata, 1 rifiutata dal modello.',
          counts: { analyzed: 1, refusals: 1, errors: 0 },
          warnings: ['1 profilo rifiutato dal modello: puoi riprovare o scrivere il messaggio a mano.'],
        }),
      },
    });
    expect((await readLog(warned.id)).body.lines.at(-1).message).toBe('Fine: completato con avvisi');

    const failed = insertJob('apollo_people', { icpId: 1, companyIds: [1] });
    await runJob(failed.id, {
      resolveDeps: () => ({}),
      handlers: {
        apollo_people: async () => {
          runLog.info('Apollo · ricerca persone · Acme');
          throw new Error('actor:apollo:mixed_people/api_search: chiave Apollo rifiutata (401)');
        },
      },
    });
    const { body } = await readLog(failed.id);
    expect(body.state).toBe('failed');
    expect(body.lines.at(-1)).toMatchObject({
      level: 'error',
      message: 'Fine: fallito — actor:apollo:mixed_people/api_search: chiave Apollo rifiutata (401)',
    });
  });
});

describe('limiti e robustezza del log (J10, J11, P-10)', () => {
  it('oltre 5.000 righe: 5.000 restituite, le centrali omesse, prima e ultima presenti', async () => {
    const run = finishedRun('analyze');
    await withRunLog(run.id, async () => {
      for (let i = 1; i <= 6000; i++) runLog.info(`riga ${i}`);
    });
    run.close();

    const { body } = await readLog(run.id);
    expect(body.lines).toHaveLength(5000);
    expect(body.omitted).toBe(1000);
    expect(body.lines[0]).toMatchObject({ seq: 1, message: 'riga 1' });
    expect(body.lines.at(-1)).toMatchObject({ seq: 6000, message: 'riga 6000' });
    // Il taglio è al centro: le prime 2.500 e le ultime 2.500.
    expect(body.lines[2499].seq).toBe(2500);
    expect(body.lines[2500].seq).toBe(3501);
  });

  it('i valori delle chiavi configurate non finiscono nel log, nemmeno dentro un errore', async () => {
    const run = finishedRun('analyze');
    await withRunLog(run.id, async () => {
      runLog.error(`config: chiamata rifiutata (x-api-key: ${config.anthropicApiKey})`);
      runLog.info(`Apify · profilo (token ${config.apifyToken}) · Mario Rossi`);
      runLog.info('x'.repeat(2500));
    });
    run.close();

    const { body } = await readLog(run.id);
    const messages = body.lines.map((l: any) => l.message).join('\n');
    expect(messages).not.toContain(config.anthropicApiKey);
    expect(messages).not.toContain(config.apifyToken);
    expect(body.lines[0].message).toContain('***');
    // Messaggio lungo: troncato con "…" (un run non può occupare più di ~10 MB).
    expect(body.lines[2].message).toHaveLength(2000);
    expect(body.lines[2].message.endsWith('…')).toBe(true);
  });

  it('un log che non si riesce a scrivere non fa fallire il run: una riga su stderr', async () => {
    const seen: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      seen.push(args.join(' '));
    });
    try {
      // Run inesistente: la foreign key rifiuta le righe (il run è stato cancellato mentre girava).
      const value = await withRunLog(999_999, async () => {
        runLog.info('prima');
        runLog.info('seconda');
        return 'fatto';
      });
      expect(value).toBe('fatto');
    } finally {
      spy.mockRestore();
    }
    expect(seen.filter((line) => line.includes('999999'))).toHaveLength(1);
  });

  it('fuori da un run le righe si scartano senza errori', async () => {
    expect(() => runLog.info('nessun run in corso')).not.toThrow();
    expect(db.prepare('SELECT COUNT(*) FROM run_logs').pluck().get()).toBe(0);
  });
});

describe('GET /api/runs/:id/log', () => {
  it('figlio uscito senza esito: la riga finale la scrive il server', async () => {
    const job = jobs.startJob('sync_interactions', {}, { command: 'node', args: ['-e', ''] });
    await waitTerminal(job.id);

    const { body } = await readLog(job.id);
    expect(body.state).toBe('failed');
    expect(body.lines.at(-1).level).toBe('error');
    expect(body.lines.at(-1).message).toMatch(/^Fine: fallito — process: /);
  });

  it('run precedente al rilascio → logged: false; run inesistente → 404', async () => {
    const row = insertJob('analyze', {});
    db.prepare('UPDATE jobs SET logged = 0 WHERE id = ?').run(row.id);
    expect((await readLog(row.id)).body).toMatchObject({ logged: false, lines: [], omitted: 0 });

    const missing = await readLog(999_999);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe('Run non trovato.');
  });
});
