import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('isolamento dei test', () => {
  it('il DB usato dai test è temporaneo, mai data/sevedemo.db', async () => {
    expect(process.env.DB_PATH).toBeTruthy();
    expect(process.env.DB_PATH).not.toContain(path.join('data', 'sevedemo.db'));

    // Import dinamico: la config è letta a import-time, l'env deve già essere impostata.
    const { config } = await import('../src/config.js');
    expect(config.paths.db).toBe(process.env.DB_PATH);

    const { db } = await import('../src/db/index.js');
    expect(fs.existsSync(config.paths.db)).toBe(true);
    const row = db.prepare('SELECT COUNT(*) AS n FROM contacts').get() as { n: number };
    expect(row.n).toBe(0);
  });
});
