-- Schema di crm.db PRIMA di apollo-lookalike (commit 7a33339, src/db/schema.ts `SCHEMA` con gli enum risolti).
-- Copiato alla lettera: serve ai test di migrazione (companies.linkedin_url NOT NULL). Non modificare.

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS icps (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL,
  description       TEXT,
  target_roles      TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(target_roles)),
  target_industries TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(target_industries)),
  target_locations  TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(target_locations)),
  company_size      TEXT,
  pains             TEXT,
  notes             TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS companies (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  linkedin_url TEXT NOT NULL UNIQUE,   -- normalizzato: https://www.linkedin.com/company/<slug>
  name         TEXT,
  website      TEXT,
  industry     TEXT,
  size         TEXT,
  location     TEXT,
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS icp_reference_companies (
  icp_id     INTEGER NOT NULL REFERENCES icps(id) ON DELETE CASCADE,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  outcome    TEXT NOT NULL DEFAULT 'riferimento' CHECK (outcome IN ('vinta', 'in_trattativa', 'persa', 'riferimento')),
  notes      TEXT,
  PRIMARY KEY (icp_id, company_id)
);

CREATE TABLE IF NOT EXISTS lists (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  icp_id      INTEGER NOT NULL REFERENCES icps(id) ON DELETE RESTRICT,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_at TEXT                     -- archiviata = nascosta + job disabilitati
);

CREATE TABLE IF NOT EXISTS prospects (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  linkedin_url            TEXT NOT NULL UNIQUE,   -- identità: normalizeLinkedinUrl(), slug pubblico se noto
  member_urn              TEXT,                   -- seconda chiave: id membro ACoAA… (unico se presente)
  full_name               TEXT,
  headline                TEXT,
  about                   TEXT,
  location                TEXT,
  email                   TEXT,
  phone                   TEXT,
  company_id              INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  company_name            TEXT,
  title                   TEXT,
  raw_json                TEXT CHECK (json_valid(raw_json)),
  enriched_at             TEXT,
  enrichment_attempted_at TEXT,
  status                  TEXT NOT NULL DEFAULT 'nuovo' CHECK (status IN ('nuovo', 'qualificato', 'da_contattare', 'contattato', 'risposto', 'in_conversazione', 'chiuso_vinto', 'chiuso_perso', 'scartato')),
  status_changed_at       TEXT,
  created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS list_members (
  list_id     INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  prospect_id INTEGER NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  added_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (list_id, prospect_id)
);

CREATE TABLE IF NOT EXISTS posts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  post_url        TEXT NOT NULL UNIQUE,
  activity_id     TEXT,
  text_excerpt    TEXT,
  posted_at       TEXT,
  reactions_count INTEGER,
  comments_count  INTEGER,
  last_synced_at  TEXT
);

-- Provenienza multipla (P4). Le fonti da post richiedono il post, quelle da
-- azienda l'azienda: così nessuna finisce per errore nell'unicità di 'manual'.
CREATE TABLE IF NOT EXISTS sources (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  prospect_id   INTEGER NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('post_reaction', 'post_comment', 'company_employees', 'manual')),
  post_id       INTEGER REFERENCES posts(id) ON DELETE RESTRICT,
  company_id    INTEGER REFERENCES companies(id) ON DELETE RESTRICT,
  reaction_type TEXT,
  comment_text  TEXT,
  raw_json      TEXT CHECK (json_valid(raw_json)),
  captured_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (kind NOT IN ('post_reaction', 'post_comment') OR post_id IS NOT NULL),
  CHECK (kind <> 'company_employees' OR company_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS activities (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  prospect_id INTEGER NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  list_id     INTEGER REFERENCES lists(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('status_change', 'touchpoint', 'note', 'export', 'analysis', 'enrichment')),
  channel     TEXT CHECK (channel IN ('email', 'linkedin_dm', 'linkedin_comment', 'call', 'other')),
  direction   TEXT CHECK (direction IN ('outbound', 'inbound')),
  from_status TEXT CHECK (from_status IN ('nuovo', 'qualificato', 'da_contattare', 'contattato', 'risposto', 'in_conversazione', 'chiuso_vinto', 'chiuso_perso', 'scartato')),
  to_status   TEXT CHECK (to_status IN ('nuovo', 'qualificato', 'da_contattare', 'contattato', 'risposto', 'in_conversazione', 'chiuso_vinto', 'chiuso_perso', 'scartato')),
  body        TEXT,
  meta        TEXT CHECK (json_valid(meta)),
  occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Ultima riga per (prospect, icp) = analisi corrente; stale se input_hash ≠ hash dell'input attuale.
CREATE TABLE IF NOT EXISTS analyses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  prospect_id INTEGER NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  icp_id      INTEGER NOT NULL REFERENCES icps(id) ON DELETE CASCADE,
  model       TEXT NOT NULL,
  summary     TEXT NOT NULL,
  angles      TEXT NOT NULL CHECK (json_valid(angles)),   -- [{title, rationale}]
  fit         TEXT NOT NULL CHECK (fit IN ('alto', 'medio', 'basso')),
  fit_reason  TEXT,
  input_hash  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL CHECK (kind IN ('sync_interactions', 'source_company', 'enrich', 'analyze')),
  params      TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(params)),
  state       TEXT NOT NULL DEFAULT 'running' CHECK (state IN ('running', 'succeeded', 'failed')),
  pid         INTEGER,
  started_at  TEXT,
  finished_at TEXT,
  result      TEXT CHECK (json_valid(result)),
  error       TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Il CSV non si salva: si rigenera e scarica per id.
CREATE TABLE IF NOT EXISTS exports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id      INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  filters      TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(filters)),
  prospect_ids TEXT CHECK (json_valid(prospect_ids)),
  count        INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Unicità delle fonti (P4): il re-sync aggiorna invece di duplicare. Gli upsert
-- devono ripetere la clausola WHERE dell'indice nel conflict target.
CREATE UNIQUE INDEX IF NOT EXISTS ux_sources_post ON sources(prospect_id, kind, post_id) WHERE post_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_sources_company ON sources(prospect_id, kind, company_id) WHERE company_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_sources_manual ON sources(prospect_id, kind) WHERE post_id IS NULL AND company_id IS NULL;

-- La stessa persona arriva come slug (commenti) o come id membro (reazioni): src/db/identity.ts.
CREATE UNIQUE INDEX IF NOT EXISTS ux_prospects_member_urn ON prospects(member_urn) WHERE member_urn IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prospects_name ON prospects(full_name);

CREATE INDEX IF NOT EXISTS idx_prospects_status ON prospects(status);
CREATE INDEX IF NOT EXISTS idx_prospects_company ON prospects(company_id);
CREATE INDEX IF NOT EXISTS idx_list_members_prospect ON list_members(prospect_id);
CREATE INDEX IF NOT EXISTS idx_sources_prospect ON sources(prospect_id);
CREATE INDEX IF NOT EXISTS idx_activities_prospect ON activities(prospect_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_analyses_prospect_icp ON analyses(prospect_id, icp_id, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(state);
