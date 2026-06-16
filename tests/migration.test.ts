import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

// Schema "legacy" pre-remodel: le tabelle senza le colonne che la migrazione
// deve aggiungere. Rispecchia la forma del DB di produzione prima di questa spec.
const LEGACY_SCHEMA = `
CREATE TABLE contacts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  linkedin_url      TEXT UNIQUE NOT NULL,
  email             TEXT,
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
`;

function legacyDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(LEGACY_SCHEMA);
  return db;
}

function columnNames(db: Database.Database, table: string): string[] {
  return (db.pragma(`table_info(${table})`) as Array<{ name: string }>).map((c) => c.name);
}

function indexNames(db: Database.Database, table: string): string[] {
  return (db.pragma(`index_list(${table})`) as Array<{ name: string }>).map((i) => i.name);
}

describe('migrate', () => {
  it('aggiunge colonne e indici nuovi e applica il default di state (DB fresco)', async () => {
    const { migrate } = await import('../src/db/index.js');
    const db = legacyDb();

    migrate(db);

    expect(columnNames(db, 'runs')).toContain('run_id');
    expect(columnNames(db, 'daily_selection')).toEqual(
      expect.arrayContaining(['run_id', 'state']),
    );
    expect(columnNames(db, 'contacts')).toEqual(
      expect.arrayContaining(['last_enrichment_attempt_at', 'last_enrichment_actor']),
    );
    expect(indexNames(db, 'runs')).toContain('idx_runs_run_id');
    expect(indexNames(db, 'daily_selection')).toEqual(
      expect.arrayContaining(['idx_daily_selection_run_id', 'idx_daily_selection_state']),
    );

    // Le nuove righe di selezione nascono `in_review` per default.
    db.exec("INSERT INTO contacts (linkedin_url, status, first_seen_at) VALUES ('u1','scored','t')");
    db.exec(
      "INSERT INTO daily_selection (date, bucket, contact_id, rank) VALUES ('2026-06-14','freelance',1,1)",
    );
    const row = db
      .prepare('SELECT state FROM daily_selection WHERE contact_id = 1')
      .get() as { state: string };
    expect(row.state).toBe('in_review');
  });

  it('rimappa i dati legacy: selezioni di contatti exported → state exported, status → scored', async () => {
    const { migrate } = await import('../src/db/index.js');
    const db = legacyDb();
    db.exec(`
      INSERT INTO contacts (id, linkedin_url, status, first_seen_at) VALUES
        (1, 'u1', 'exported', 't'),
        (2, 'u2', 'selected', 't'),
        (3, 'u3', 'scored', 't');
      INSERT INTO daily_selection (date, bucket, contact_id, rank) VALUES
        ('2026-06-10', 'freelance', 1, 1),
        ('2026-06-10', 'freelance', 2, 2),
        ('2026-06-10', 'azienda', 3, 1);
    `);

    migrate(db);

    const statuses = db
      .prepare('SELECT id, status FROM contacts ORDER BY id')
      .all() as Array<{ id: number; status: string }>;
    expect(statuses).toEqual([
      { id: 1, status: 'scored' },
      { id: 2, status: 'scored' },
      { id: 3, status: 'scored' },
    ]);

    const states = db
      .prepare('SELECT contact_id, state FROM daily_selection ORDER BY contact_id')
      .all() as Array<{ contact_id: number; state: string }>;
    expect(states).toEqual([
      { contact_id: 1, state: 'exported' }, // contatto legacy exported
      { contact_id: 2, state: 'in_review' }, // contatto legacy selected → solo scored, selezione in revisione
      { contact_id: 3, state: 'in_review' },
    ]);
  });

  it('è idempotente e non regredisce le selezioni exported del nuovo modello', async () => {
    const { migrate } = await import('../src/db/index.js');
    const db = legacyDb();
    db.exec(`
      INSERT INTO contacts (id, linkedin_url, status, first_seen_at) VALUES (1, 'u1', 'scored', 't');
      INSERT INTO daily_selection (date, bucket, contact_id, rank) VALUES ('2026-06-12', 'freelance', 1, 1);
    `);
    migrate(db);

    // Nel nuovo modello l'export marca la selezione, NON il contatto.
    db.exec("UPDATE daily_selection SET state = 'exported' WHERE contact_id = 1");

    expect(() => migrate(db)).not.toThrow();

    const state = db
      .prepare('SELECT state FROM daily_selection WHERE contact_id = 1')
      .get() as { state: string };
    expect(state.state).toBe('exported'); // non riportata a in_review
    const status = db
      .prepare('SELECT status FROM contacts WHERE id = 1')
      .get() as { status: string };
    expect(status.status).toBe('scored');
    // ALTER non rieseguito: la colonna non è duplicata.
    expect(columnNames(db, 'daily_selection').filter((c) => c === 'state')).toHaveLength(1);
  });
});
