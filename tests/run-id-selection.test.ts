import { describe, expect, it } from 'vitest';

let seq = 0;
function newUrl(): string {
  seq += 1;
  return `https://www.linkedin.com/in/runid-${process.pid}-${seq}`;
}

const score = (bucket: string, fit: number) => ({
  role: 'r',
  bucket,
  sector: 'tech',
  fitScore: fit,
  shortDescription: 'd',
  reason: 'x',
  signals: {},
});

describe('selectBucket: eleggibilità = scored e non già in una selezione', () => {
  it('esclude i contatti già presenti in daily_selection', async () => {
    const { upsertCandidate, updateScore } = await import('../src/db/contacts.js');
    const { saveSelection } = await import('../src/db/runs.js');
    const { selectBucket } = await import('../src/pipeline/select.js');

    const taken = upsertCandidate({ linkedinUrl: newUrl(), sourceStrategy: 's' }).id;
    const free = upsertCandidate({ linkedinUrl: newUrl(), sourceStrategy: 's' }).id;
    updateScore(taken, score('freelance', 99));
    updateScore(free, score('freelance', 99));

    // `taken` entra in una selezione → non più eleggibile a un nuovo Run.
    saveSelection('2099-01-01', [{ bucket: 'freelance', contactId: taken, rank: 1 }], '2099-01-01-1');

    const picked = selectBucket('freelance', 50, 90).map((c) => c.id);
    expect(picked).toContain(free);
    expect(picked).not.toContain(taken);
  });
});

describe('saveSelection: provenienza run_id + stato in_review', () => {
  it('persiste run_id e state=in_review su ogni riga', async () => {
    const { upsertCandidate } = await import('../src/db/contacts.js');
    const { saveSelection } = await import('../src/db/runs.js');
    const { db } = await import('../src/db/index.js');

    const id = upsertCandidate({ linkedinUrl: newUrl(), sourceStrategy: 's' }).id;
    saveSelection('2099-02-02', [{ bucket: 'freelance', contactId: id, rank: 1 }], '2099-02-02-1');

    const row = db
      .prepare('SELECT run_id, state FROM daily_selection WHERE date = ?')
      .get('2099-02-02') as { run_id: string; state: string };
    expect(row.run_id).toBe('2099-02-02-1');
    expect(row.state).toBe('in_review');
  });
});

describe('logRun + newRunId', () => {
  it('logRun persiste run_id; newRunId è incrementale per data', async () => {
    const { logRun, newRunId } = await import('../src/db/runs.js');
    const { db } = await import('../src/db/index.js');

    const date = '2099-03-03';
    const first = newRunId(date);
    expect(first).toBe('2099-03-03-1');

    logRun({ runDate: date, strategy: 'st-a', runId: first });
    const stored = db
      .prepare('SELECT run_id FROM runs WHERE run_date = ? LIMIT 1')
      .get(date) as { run_id: string };
    expect(stored.run_id).toBe(first);

    // Dopo un run registrato, il successivo id del giorno incrementa.
    expect(newRunId(date)).toBe('2099-03-03-2');
  });
});
