import { beforeAll, describe, expect, it } from 'vitest';

// Tempo di risposta locale (people-first-crm Constraints, PLAN P-18, T21): 10.000 persone e 2.000 aziende
// generate da `seedBulkPeople` (lo stesso volume di `POST /api/e2e/seed-bulk`). Misura lato server, HTTP
// compreso: ricerca globale < 150 ms, prima pagina di Persone e conteggi delle viste < 500 ms (margine per il
// render sotto i 300 ms / 1 s della SPEC). Import dinamici: la config (DB_PATH isolato) è letta a import-time.
const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/server/app.js');
const { seedBulkPeople } = await import('../src/jobs/fake-deps.js');

const app = createApp();

/** Tempo mediano di `runs` richieste (dopo un giro di riscaldamento), in ms. */
async function median(path: string, runs = 5): Promise<number> {
  const once = async () => {
    const start = performance.now();
    const res = await app.request(path);
    expect(res.status).toBe(200);
    await res.json();
    return performance.now() - start;
  };
  await once();
  const times: number[] = [];
  for (let i = 0; i < runs; i++) times.push(await once());
  return times.sort((a, b) => a - b)[Math.floor(runs / 2)];
}

describe('perf su 10.000 persone e 2.000 aziende', () => {
  beforeAll(() => {
    db.exec('DELETE FROM prospects; DELETE FROM companies;');
    const seeded = seedBulkPeople(10_000, 2_000);
    expect(seeded).toMatchObject({ people: 10_000, companies: 2_000 });
  }, 60_000);

  it('il volume c\'è: persone, aziende, contesti d\'incontro e prossime azioni', () => {
    const count = (sql: string) => db.prepare(sql).pluck().get() as number;
    expect(count('SELECT COUNT(*) FROM prospects')).toBe(10_000);
    expect(count('SELECT COUNT(*) FROM companies')).toBe(2_000);
    expect(count(`SELECT COUNT(*) FROM activities WHERE kind = 'note' AND json_extract(meta, '$.meeting') IS NOT NULL`)).toBeGreaterThan(0);
    expect(count('SELECT COUNT(*) FROM prospects WHERE next_action_on IS NOT NULL')).toBeGreaterThan(0);
  });

  it('ricerca globale < 150 ms (testo comune, nome raro, contesto dell\'incontro)', async () => {
    for (const q of ['mar', 'rossi', 'evento', 'bulk-17']) {
      const ms = await median(`/api/search?q=${q}`);
      expect(ms, `ricerca "${q}": ${ms.toFixed(1)} ms`).toBeLessThan(150);
    }
  });

  it('prima pagina di Persone (Tutte, ordinamento di default) e conteggi delle viste < 500 ms', async () => {
    const page = await median('/api/prospects?view=tutte');
    expect(page, `Persone: ${page.toFixed(1)} ms`).toBeLessThan(500);
    const counts = await median('/api/prospects/view-counts');
    expect(counts, `conteggi: ${counts.toFixed(1)} ms`).toBeLessThan(500);
    const filtered = await median('/api/prospects/view-counts?q=mar');
    expect(filtered, `conteggi con testo: ${filtered.toFixed(1)} ms`).toBeLessThan(500);
  });
});
