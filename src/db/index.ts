import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS contacts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  linkedin_url      TEXT UNIQUE NOT NULL,
  full_name         TEXT,
  headline          TEXT,
  about             TEXT,
  location          TEXT,
  email             TEXT,
  phone             TEXT,
  company           TEXT,
  role              TEXT,
  bucket            TEXT,              -- 'freelance' | 'azienda' | 'scarta' | NULL
  sector            TEXT,              -- 'tech' | 'design' | 'marketing' | 'other'
  fit_score         INTEGER,
  short_description TEXT,
  score_reason      TEXT,
  signals           TEXT,              -- json
  source_strategy   TEXT,
  source_post_url   TEXT,
  email_subject     TEXT,
  email_body        TEXT,
  status            TEXT NOT NULL DEFAULT 'new',  -- new|enriched|scored|discarded|rejected_geo (stadio del dato)
  raw_json          TEXT,
  first_seen_at     TEXT NOT NULL,
  last_evaluated_at TEXT
);

CREATE TABLE IF NOT EXISTS runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  run_date      TEXT NOT NULL,
  strategy      TEXT NOT NULL,
  actor_run_id  TEXT,
  items_in      INTEGER DEFAULT 0,
  items_new     INTEGER DEFAULT 0,
  cost_estimate REAL DEFAULT 0,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_selection (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT NOT NULL,
  bucket     TEXT NOT NULL,
  contact_id INTEGER NOT NULL,
  rank       INTEGER NOT NULL,
  UNIQUE(date, contact_id),
  FOREIGN KEY (contact_id) REFERENCES contacts(id)
);

CREATE TABLE IF NOT EXISTS kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outcomes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id     INTEGER NOT NULL UNIQUE,
  strategy       TEXT,
  sent_at        TEXT,
  opened         INTEGER DEFAULT 0,
  replied        INTEGER DEFAULT 0,
  positive_reply INTEGER DEFAULT 0,
  converted      INTEGER DEFAULT 0,
  notes          TEXT,
  FOREIGN KEY (contact_id) REFERENCES contacts(id)
);

CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status);
CREATE INDEX IF NOT EXISTS idx_contacts_bucket ON contacts(bucket);
CREATE INDEX IF NOT EXISTS idx_contacts_source ON contacts(source_strategy);
`;

fs.mkdirSync(path.dirname(config.paths.db), { recursive: true });

export const db: Database.Database = new Database(config.paths.db);
db.pragma('journal_mode = WAL');
// Server e processo figlio del run daily scrivono lo stesso file: attendi
// invece di fallire subito con SQLITE_BUSY.
db.pragma('busy_timeout = 5000');
db.exec(SCHEMA);

/**
 * Aggiunge una colonna solo se assente (guard via `PRAGMA table_info`).
 * Ritorna `true` se la colonna è stata aggiunta ora, `false` se esisteva già.
 * Surrogato di una migrazione: nel repo non esiste un framework di migrazioni.
 */
export function ensureColumn(
  database: Database.Database,
  table: string,
  column: string,
  ddl: string,
): boolean {
  const cols = database.pragma(`table_info(${table})`) as Array<{ name: string }>;
  if (cols.some((c) => c.name === column)) return false;
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  return true;
}

/**
 * Migrazione idempotente: aggiunge le colonne del remodel degli stati + indici,
 * e — solo alla prima comparsa di `daily_selection.state` — rimappa i dati legacy
 * (contatti `selected`/`exported` → `scored`; le loro selezioni → `state='exported'`).
 * Sicura da rieseguire a ogni avvio.
 */
export function migrate(database: Database.Database): void {
  ensureColumn(database, 'runs', 'run_id', 'TEXT');
  ensureColumn(database, 'daily_selection', 'run_id', 'TEXT');
  const addedState = ensureColumn(
    database,
    'daily_selection',
    'state',
    "TEXT NOT NULL DEFAULT 'in_review'",
  );
  ensureColumn(database, 'contacts', 'last_enrichment_attempt_at', 'TEXT');
  ensureColumn(database, 'contacts', 'last_enrichment_actor', 'TEXT');

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_runs_run_id ON runs(run_id);
    CREATE INDEX IF NOT EXISTS idx_daily_selection_run_id ON daily_selection(run_id);
    CREATE INDEX IF NOT EXISTS idx_daily_selection_state ON daily_selection(state);
  `);

  if (addedState) {
    // Remap one-shot dei dati legacy (pre-remodel). Ordine obbligato: prima
    // marca come `exported` le selezioni dei contatti già `exported`, poi
    // collassa quegli status su `scored` (stadio del dato). Dopo la prima
    // esecuzione nessuna riga soddisfa più i predicati → naturalmente idempotente.
    database.exec(`
      UPDATE daily_selection SET state = 'exported'
      WHERE contact_id IN (SELECT id FROM contacts WHERE status = 'exported');
      UPDATE contacts SET status = 'scored' WHERE status IN ('selected', 'exported');
    `);
  }
}

migrate(db);

export function nowIso(): string {
  return new Date().toISOString();
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
