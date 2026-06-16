import { describe, expect, it, vi } from 'vitest';

// Comando finto: imita il wrapper enrichment, che scrive lui l'esito terminale
// (con `result`) in kv sotto la chiave del controller enrichment.
const SUCCESS_CHILD = `
  setTimeout(() => {
    const Database = require('better-sqlite3');
    const db = new Database(process.env.DB_PATH);
    db.prepare(
      'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run('ui_job:enrichment', JSON.stringify({
      state: 'succeeded',
      finished_at: new Date().toISOString(),
      result: { eligible: 1, attempted: 1, emailsRecovered: 1, draftsGenerated: 1, skippedFresh: 0 },
    }));
    db.close();
  }, 150);
`;

describe('job manager enrichment', () => {
  it('successo: running → succeeded con result; doppio start rifiutato', async () => {
    const { startEnrichmentRun, getEnrichmentJobStatus, RunInProgressError } = await import(
      '../src/server/jobs.js'
    );

    const status = startEnrichmentRun(
      { date: '2099-09-09' },
      { command: process.execPath, args: ['-e', SUCCESS_CHILD] },
    );
    expect(status.state).toBe('running');
    expect(getEnrichmentJobStatus().state).toBe('running');

    expect(() =>
      startEnrichmentRun(
        { date: '2099-09-09' },
        { command: process.execPath, args: ['-e', SUCCESS_CHILD] },
      ),
    ).toThrow(RunInProgressError);

    await vi.waitFor(() => expect(getEnrichmentJobStatus().state).toBe('succeeded'), {
      timeout: 5000,
    });
    expect(getEnrichmentJobStatus().result?.emailsRecovered).toBe(1);
  });

  it('backward-compat: il controller daily resta indipendente', async () => {
    const { getJobStatus, getEnrichmentJobStatus } = await import('../src/server/jobs.js');
    // L'enrichment è succeeded dal test precedente; il daily non è mai partito qui.
    expect(getEnrichmentJobStatus().state).toBe('succeeded');
    expect(getJobStatus().state).toBe('idle');
  });

  it("un daily in corso blocca l'avvio dell'enrichment", async () => {
    const { startEnrichmentRun, RunInProgressError, JOB_KV_KEY } = await import(
      '../src/server/jobs.js'
    );
    const { kvSet } = await import('../src/db/kv.js');
    // Daily running con pid vivo (questo processo) → enrichment rifiutato.
    kvSet(
      JOB_KV_KEY,
      JSON.stringify({ state: 'running', started_at: new Date().toISOString(), pid: process.pid }),
    );
    expect(() => startEnrichmentRun({ date: '2099-09-10' })).toThrow(RunInProgressError);
  });
});
