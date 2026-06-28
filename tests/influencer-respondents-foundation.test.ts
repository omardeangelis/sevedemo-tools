import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

let seq = 0;
function newUrl(): string {
  seq += 1;
  return `https://www.linkedin.com/in/ipr-foundation-${process.pid}-${seq}`;
}

/**
 * DB in-memory che — a differenza del LEGACY_SCHEMA di migration.test.ts — HA la
 * colonna `contacts.source_strategy` e `runs.strategy`: serve a esercitare il
 * backfill di rename `freelance-post-reactors` → `influencer-post-respondents`.
 */
function dbWithSourceStrategy(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE contacts (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      linkedin_url      TEXT UNIQUE NOT NULL,
      source_strategy   TEXT,
      status            TEXT NOT NULL DEFAULT 'new',
      first_seen_at     TEXT NOT NULL,
      last_evaluated_at TEXT
    );
    CREATE TABLE runs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      run_date   TEXT NOT NULL,
      strategy   TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE daily_selection (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      date       TEXT NOT NULL,
      bucket     TEXT NOT NULL,
      contact_id INTEGER NOT NULL,
      rank       INTEGER NOT NULL,
      UNIQUE(date, contact_id)
    );
  `);
  return db;
}

function columnNames(db: Database.Database, table: string): string[] {
  return (db.pragma(`table_info(${table})`) as Array<{ name: string }>).map((c) => c.name);
}

describe('migrate: foundation influencer-post-respondents', () => {
  it('aggiunge contacts.source_detail e runs.run_error', async () => {
    const { migrate } = await import('../src/db/index.js');
    const db = dbWithSourceStrategy();

    migrate(db);

    expect(columnNames(db, 'contacts')).toContain('source_detail');
    expect(columnNames(db, 'runs')).toContain('run_error');
  });

  it('backfilla il rename storico freelance-post-reactors → influencer-post-respondents', async () => {
    const { migrate } = await import('../src/db/index.js');
    const db = dbWithSourceStrategy();
    db.exec(`
      INSERT INTO contacts (linkedin_url, source_strategy, status, first_seen_at) VALUES
        ('u-old', 'freelance-post-reactors', 'scored', 't'),
        ('u-other', 'freelance-people-search', 'scored', 't');
      INSERT INTO runs (run_date, strategy, created_at) VALUES
        ('2026-06-10', 'freelance-post-reactors', 't'),
        ('2026-06-10', 'freelance-people-search', 't');
    `);

    migrate(db);

    const contacts = db
      .prepare('SELECT linkedin_url, source_strategy FROM contacts ORDER BY linkedin_url')
      .all() as Array<{ linkedin_url: string; source_strategy: string }>;
    expect(contacts).toEqual([
      { linkedin_url: 'u-old', source_strategy: 'influencer-post-respondents' },
      { linkedin_url: 'u-other', source_strategy: 'freelance-people-search' },
    ]);
    const runs = db
      .prepare('SELECT strategy FROM runs ORDER BY strategy')
      .all() as Array<{ strategy: string }>;
    expect(runs.map((r) => r.strategy)).toEqual([
      'freelance-people-search',
      'influencer-post-respondents',
    ]);
  });

  it('è idempotente: una seconda migrate() sulla riga già rinominata è no-op', async () => {
    const { migrate } = await import('../src/db/index.js');
    const db = dbWithSourceStrategy();
    db.exec(
      "INSERT INTO contacts (linkedin_url, source_strategy, status, first_seen_at) VALUES ('u1','freelance-post-reactors','scored','t')",
    );
    migrate(db);
    expect(() => migrate(db)).not.toThrow();
    const row = db.prepare("SELECT source_strategy FROM contacts WHERE linkedin_url='u1'").get() as {
      source_strategy: string;
    };
    expect(row.source_strategy).toBe('influencer-post-respondents');
    // ALTER non rieseguito: source_detail compare una volta sola.
    expect(columnNames(db, 'contacts').filter((c) => c === 'source_detail')).toHaveLength(1);
  });
});

describe('logRun: canale errore', () => {
  it('logRun({error}) scrive su runs.run_error', async () => {
    const { logRun } = await import('../src/db/runs.js');
    const { db } = await import('../src/db/index.js');

    logRun({ runDate: '2099-09-09', strategy: 'st-err', runId: '2099-09-09-1', error: 'boom apify' });
    const row = db
      .prepare("SELECT run_error FROM runs WHERE run_date='2099-09-09' AND strategy='st-err'")
      .get() as { run_error: string | null };
    expect(row.run_error).toBe('boom apify');
  });
});

describe('persist: source_detail', () => {
  it('upsertCandidate con sourceDetail è leggibile su contacts.source_detail', async () => {
    const { upsertCandidate } = await import('../src/db/contacts.js');
    const { db } = await import('../src/db/index.js');

    const url = newUrl();
    const { id } = upsertCandidate({ linkedinUrl: url, sourceStrategy: 'influencer-post-respondents', sourceDetail: 'commenter' });
    const row = db.prepare('SELECT source_detail FROM contacts WHERE id = ?').get(id) as {
      source_detail: string | null;
    };
    expect(row.source_detail).toBe('commenter');
  });
});
