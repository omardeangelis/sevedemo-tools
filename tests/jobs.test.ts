import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';

// Comando finto al posto della pipeline reale: imita il wrapper, che scrive
// lui stesso lo stato terminale in kv prima di uscire.
const SUCCESS_CHILD = `
  setTimeout(() => {
    const Database = require('better-sqlite3');
    const db = new Database(process.env.DB_PATH);
    db.prepare(
      'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run('ui_job:daily', JSON.stringify({ state: 'succeeded', finished_at: new Date().toISOString() }));
    db.close();
  }, 150);
`;

describe('job manager run daily', () => {
  it('comando a successo: running → succeeded; doppio start rifiutato', async () => {
    const { startDailyRun, getJobStatus, RunInProgressError } = await import(
      '../src/server/jobs.js'
    );

    const status = startDailyRun({ command: process.execPath, args: ['-e', SUCCESS_CHILD] });
    expect(status.state).toBe('running');
    expect(getJobStatus().state).toBe('running');

    expect(() =>
      startDailyRun({ command: process.execPath, args: ['-e', SUCCESS_CHILD] }),
    ).toThrow(RunInProgressError);

    await vi.waitFor(() => expect(getJobStatus().state).toBe('succeeded'), { timeout: 5000 });
    expect(getJobStatus().finished_at).toBeTruthy();
  });

  it('figlio che crasha senza stato terminale: fallback del server → failed con stderr', async () => {
    const { startDailyRun, getJobStatus } = await import('../src/server/jobs.js');

    startDailyRun({
      command: process.execPath,
      args: ['-e', "console.error('boom della pipeline'); process.exit(1);"],
    });

    await vi.waitFor(() => expect(getJobStatus().state).toBe('failed'), { timeout: 5000 });
    expect(getJobStatus().error).toContain('boom della pipeline');
  });

  it('stato running orfano (pid morto, es. dopo restart del server) → failed interrotto', async () => {
    const { getJobStatus, JOB_KV_KEY } = await import('../src/server/jobs.js');
    const { kvSet } = await import('../src/db/kv.js');

    // Un processo già terminato fornisce un pid sicuramente morto.
    const dead = spawnSync(process.execPath, ['-e', '']);
    kvSet(
      JOB_KV_KEY,
      JSON.stringify({ state: 'running', started_at: new Date().toISOString(), pid: dead.pid }),
    );

    const status = getJobStatus();
    expect(status.state).toBe('failed');
    expect(status.error).toContain('interrotto');
    // L'esito è persistito, non solo calcolato al volo.
    expect(getJobStatus().state).toBe('failed');
  });
});
