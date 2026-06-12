import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const TABLES = ['contacts', 'runs', 'daily_selection', 'kv', 'outcomes'] as const;

async function seededDb() {
  const { db, nowIso, today } = await import('../src/db/index.js');
  const contact = db
    .prepare("INSERT INTO contacts (linkedin_url, first_seen_at) VALUES (?, ?)")
    .run(`https://linkedin.com/in/test-${Math.random()}`, nowIso());
  const contactId = Number(contact.lastInsertRowid);
  db.prepare('INSERT INTO runs (run_date, strategy, created_at) VALUES (?, ?, ?)').run(
    today(),
    'test',
    nowIso(),
  );
  db.prepare(
    'INSERT INTO daily_selection (date, bucket, contact_id, rank) VALUES (?, ?, ?, ?)',
  ).run(today(), 'freelance', contactId, 1);
  db.prepare('INSERT INTO kv (key, value) VALUES (?, ?)').run('query_cursor', '3');
  db.prepare('INSERT INTO outcomes (contact_id, strategy) VALUES (?, ?)').run(contactId, 'test');
  return db;
}

function tmpExportsDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sevedemo-exports-'));
}

describe('eraseAllData', () => {
  it('svuota le 5 tabelle e i file export, ritornando i conteggi', async () => {
    const db = await seededDb();
    const exportsDir = tmpExportsDir();
    fs.writeFileSync(path.join(exportsDir, 'freelance-2026-06-12.csv'), 'a,b\n');
    fs.writeFileSync(path.join(exportsDir, 'azienda-2026-06-12.csv'), 'a,b\n');

    const { eraseAllData } = await import('../src/db/erase.js');
    const result = eraseAllData({ exportsDir });

    for (const table of TABLES) {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
      expect(row.n, table).toBe(0);
    }
    expect(fs.readdirSync(exportsDir)).toEqual([]);
    expect(result).toEqual({
      contacts: 1,
      runs: 1,
      selections: 1,
      outcomes: 1,
      kv: 1,
      exportFiles: 2,
    });
  });

  it('fa ripartire gli id AUTOINCREMENT da 1 e preserva le sottocartelle di exports', async () => {
    const db = await seededDb();
    const exportsDir = tmpExportsDir();
    fs.mkdirSync(path.join(exportsDir, 'archivio'));
    fs.writeFileSync(path.join(exportsDir, 'archivio', 'vecchio.csv'), 'a,b\n');

    const { eraseAllData } = await import('../src/db/erase.js');
    const { nowIso } = await import('../src/db/index.js');
    eraseAllData({ exportsDir });

    const inserted = db
      .prepare('INSERT INTO contacts (linkedin_url, first_seen_at) VALUES (?, ?)')
      .run('https://linkedin.com/in/dopo-erase', nowIso());
    expect(Number(inserted.lastInsertRowid)).toBe(1);
    expect(fs.existsSync(path.join(exportsDir, 'archivio', 'vecchio.csv'))).toBe(true);
  });

  it('è innocuo su stato già vuoto e con exports dir assente', async () => {
    const { eraseAllData } = await import('../src/db/erase.js');
    eraseAllData({ exportsDir: tmpExportsDir() });
    const result = eraseAllData({
      exportsDir: path.join(os.tmpdir(), 'sevedemo-exports-non-esiste'),
    });
    expect(result.contacts).toBe(0);
    expect(result.exportFiles).toBe(0);
  });
});
