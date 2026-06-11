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
  status            TEXT NOT NULL DEFAULT 'new',  -- new|enriched|scored|selected|exported
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
db.exec(SCHEMA);

export function nowIso(): string {
  return new Date().toISOString();
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
