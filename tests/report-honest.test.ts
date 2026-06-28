import { describe, expect, it } from 'vitest';

const P = process.pid;
const S_CLEAN = `t11-clean-${P}`;
const S_ERR = `t11-err-${P}`;
const S_DUP = `t11-dup-${P}`;
const S_OK = `t11-ok-${P}`;
const S_NEVER = `t11-never-${P}`;

let seq = 0;
const url = () => `https://www.linkedin.com/in/t11-${P}-${++seq}`;

function rowFor(rows: any[], strategy: string) {
  return rows.find((r) => r.strategy === strategy);
}

describe('reportByStrategy (T11): report onesto con join su runs', () => {
  it('mostra le strategie a 0/errore e i 4 stati derivati', async () => {
    const { logRun, reportByStrategy } = await import('../src/db/runs.js');
    const { upsertCandidate } = await import('../src/db/contacts.js');

    // (clean-0) ha girato, 0 sourced, nessun contatto.
    logRun({ runDate: '2099-11-01', strategy: S_CLEAN, runId: `${S_CLEAN}-1`, itemsIn: 0, itemsNew: 0 });
    // (errored) ultimo run con run_error.
    logRun({ runDate: '2099-11-01', strategy: S_ERR, runId: `${S_ERR}-1`, itemsIn: 0, itemsNew: 0, error: 'apify down' });
    // (all-duplicates) sourced>0 ma new=0.
    logRun({ runDate: '2099-11-01', strategy: S_DUP, runId: `${S_DUP}-1`, itemsIn: 7, itemsNew: 0 });
    // (ok) sourced>0, new>0, 1 contatto.
    upsertCandidate({ linkedinUrl: url(), sourceStrategy: S_OK });
    logRun({ runDate: '2099-11-01', strategy: S_OK, runId: `${S_OK}-1`, itemsIn: 3, itemsNew: 1 });

    const rows = reportByStrategy([S_NEVER]); // S_NEVER è "noto" (registry) ma non ha mai girato

    const clean = rowFor(rows, S_CLEAN);
    expect(clean).toBeDefined();
    expect(clean.extracted).toBe(0);
    expect(clean.last_run).not.toBeNull(); // ha girato: last_run valorizzato
    expect(clean.state).toBe('clean-0');

    const err = rowFor(rows, S_ERR);
    expect(err.state).toBe('errored'); // distinto da clean-0

    const dup = rowFor(rows, S_DUP);
    expect(dup.state).toBe('all-duplicates');
    expect(dup.sourced).toBe(7);
    expect(dup.new).toBe(0);

    const ok = rowFor(rows, S_OK);
    expect(ok.state).toBe('ok');
    expect(ok.extracted).toBe(1);
    expect(ok.sourced).toBe(3);
    expect(ok.new).toBe(1);

    const never = rowFor(rows, S_NEVER);
    expect(never).toBeDefined();
    expect(never.state).toBe('never-ran');
    expect(never.extracted).toBe(0);
    expect(never.last_run).toBeNull();
  });

  it('preserva il comportamento esistente: le strategie con contatti restano presenti', async () => {
    const { reportByStrategy } = await import('../src/db/runs.js');
    const { upsertCandidate } = await import('../src/db/contacts.js');
    const s = `t11-legacy-${P}`;
    upsertCandidate({ linkedinUrl: url(), sourceStrategy: s });
    const rows = reportByStrategy();
    expect(rowFor(rows, s)).toBeDefined();
    expect(rowFor(rows, s).extracted).toBe(1);
  });
});
