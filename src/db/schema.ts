import type Database from 'better-sqlite3';
import fs from 'node:fs';
import { JOB_KINDS, JOB_STATES } from '../jobs/types.js';
import { normalizeDomain } from '../util/fields.js';
import { isAlive } from '../util/process.js';

/**
 * Schema di `data/crm.db` (PLAN crm-foundation §6, 13 tabelle; + `icp_company_candidates` da
 * apollo-lookalike T5). Gli enum sono esportati qui così i `CHECK` del DB e il codice applicativo
 * usano gli stessi valori.
 */

/** I 9 stati del prospect (D6): cambio manuale, ogni cambio logga un'attività. */
export const PROSPECT_STATUSES = [
  'nuovo',
  'qualificato',
  'da_contattare',
  'contattato',
  'risposto',
  'in_conversazione',
  'chiuso_vinto',
  'chiuso_perso',
  'scartato',
] as const;
export type ProspectStatus = (typeof PROSPECT_STATUSES)[number];

export const REFERENCE_OUTCOMES = ['vinta', 'in_trattativa', 'persa', 'riferimento'] as const;
export type ReferenceOutcome = (typeof REFERENCE_OUTCOMES)[number];

export const SOURCE_KINDS = ['post_reaction', 'post_comment', 'company_employees', 'manual', 'apollo_people'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** Fonti legate a un'azienda (richiedono `company_id`, stessa unicità per `(prospect, kind, azienda)`). */
export const COMPANY_SOURCE_KINDS = ['company_employees', 'apollo_people'] as const satisfies readonly SourceKind[];

/** Stati di una candidata dell'ICP (apollo-lookalike SPEC E): cambio manuale, reversibile. */
export const CANDIDATE_STATUSES = ['proposta', 'accettata', 'scartata'] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

/**
 * Tipi di attività della timeline. people-first-crm: `fit_change` (fit manuale impostato, cambiato o
 * rimosso, SPEC F7) e `next_action_done` (prossima azione completata, G4).
 */
export const ACTIVITY_KINDS = [
  'status_change',
  'touchpoint',
  'note',
  'export',
  'analysis',
  'enrichment',
  'fit_change',
  'next_action_done',
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const CHANNELS = ['email', 'linkedin_dm', 'linkedin_comment', 'call', 'other'] as const;
export type Channel = (typeof CHANNELS)[number];

export const DIRECTIONS = ['outbound', 'inbound'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const FIT_LEVELS = ['alto', 'medio', 'basso'] as const;
export type FitLevel = (typeof FIT_LEVELS)[number];

/** `'a', 'b', …` per le clausole `CHECK (col IN (…))` (valori costanti, niente input utente). */
function sqlList(values: readonly string[]): string {
  return values.map((v) => `'${v}'`).join(', ');
}

/** Default dei timestamp: stesso formato di `new Date().toISOString()`. */
const NOW = `(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

/** Colonne di `jobs` aggiunte da people-first-crm: stessa DDL per i DB nuovi e per gli `ALTER` dei DB esistenti. */
export const JOBS_NEW_COLUMNS = [
  { name: 'detached', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { name: 'logged', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { name: 'tools', ddl: `TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tools))` },
] as const;

/**
 * Aziende a doppia chiave (apollo-lookalike D-A, SPEC B1–B3): `linkedin_url` (normalizzato:
 * https://www.linkedin.com/company/<slug>) e `domain` (`normalizeDomain`), almeno uno dei due,
 * ciascuno unico se presente; `apollo_org_id` unico se presente. `apollo_enriched_at` = data
 * dell'ultimo esito Apollo, anche negativo. Usata da `SCHEMA` (DB nuovi) e da
 * `migrateSchema` (ricostruzione dei DB esistenti).
 */
export const COMPANIES_TABLE = `CREATE TABLE IF NOT EXISTS companies (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  linkedin_url       TEXT,
  domain             TEXT,
  name               TEXT,
  website            TEXT,
  industry           TEXT,
  size               TEXT,
  location           TEXT,
  notes              TEXT,
  apollo_org_id      TEXT,
  apollo_json        TEXT CHECK (apollo_json IS NULL OR json_valid(apollo_json)),
  apollo_enriched_at TEXT,
  created_at         TEXT NOT NULL DEFAULT ${NOW},
  updated_at         TEXT NOT NULL DEFAULT ${NOW},
  CHECK (linkedin_url IS NOT NULL OR domain IS NOT NULL)
);`;

/** Unicità parziale delle chiavi azienda (più righe senza chiave sono ammesse). */
export const COMPANIES_INDEXES = `
CREATE UNIQUE INDEX IF NOT EXISTS ux_companies_linkedin ON companies(linkedin_url) WHERE linkedin_url IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_companies_domain ON companies(domain) WHERE domain IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_companies_apollo ON companies(apollo_org_id) WHERE apollo_org_id IS NOT NULL;
`;

/**
 * Fonti (provenienza multipla, P4). `kind` ha un CHECK sull'enum: aggiungere un valore richiede la
 * ricostruzione della tabella sui DB esistenti (`migrateSchema`). Le fonti da azienda
 * (`COMPANY_SOURCE_KINDS`) richiedono `company_id`.
 */
export const SOURCES_TABLE = `CREATE TABLE IF NOT EXISTS sources (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  prospect_id   INTEGER NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN (${sqlList(SOURCE_KINDS)})),
  post_id       INTEGER REFERENCES posts(id) ON DELETE RESTRICT,
  company_id    INTEGER REFERENCES companies(id) ON DELETE RESTRICT,
  reaction_type TEXT,
  comment_text  TEXT,
  raw_json      TEXT CHECK (json_valid(raw_json)),
  captured_at   TEXT NOT NULL DEFAULT ${NOW},
  CHECK (kind NOT IN ('post_reaction', 'post_comment') OR post_id IS NOT NULL),
  CHECK (kind NOT IN (${sqlList(COMPANY_SOURCE_KINDS)}) OR company_id IS NOT NULL)
);`;

/**
 * Job asincroni: `kind` ha un CHECK su `JOB_KINDS` (nuovi kind → ricostruzione, come `sources`).
 * people-first-crm (in coda come gli `ALTER` dei DB esistenti): `detached` = analisi singola dalla scheda
 * (non blocca e non è nel banner, PLAN P-13); `logged` = run con log in `run_logs` (i precedenti mostrano
 * "Log non disponibile"); `tools` = strumenti usati dal run, JSON (`["apify"]`, …), fissati all'avvio (P-12).
 */
export const JOBS_TABLE = `CREATE TABLE IF NOT EXISTS jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL CHECK (kind IN (${sqlList(JOB_KINDS)})),
  params      TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(params)),
  state       TEXT NOT NULL DEFAULT 'running' CHECK (state IN (${sqlList(JOB_STATES)})),
  pid         INTEGER,
  started_at  TEXT,
  finished_at TEXT,
  result      TEXT CHECK (json_valid(result)),
  error       TEXT,
  created_at  TEXT NOT NULL DEFAULT ${NOW},
  ${JOBS_NEW_COLUMNS.map((c) => `${c.name} ${c.ddl}`).join(',\n  ')}
);`;

/**
 * Candidate di un ICP (apollo-lookalike PLAN §6, SPEC E/D14): proposte da una ricerca lookalike
 * (`job_id`, SET NULL se il job si cancella), decise a mano. Cancellate con l'ICP e con l'azienda.
 * `score` 0–1 a 2 decimali; `score_parts` = `{keywords, size, location|null}` e `scoring_version`
 * conservano come è stato calcolato (i punteggi esistenti non si ricalcolano); `reasons` = stringhe.
 * Una referenza dell'ICP non è anche sua candidata: lo garantisce `src/db/candidates.ts`.
 */
export const CANDIDATES_TABLE = `CREATE TABLE IF NOT EXISTS icp_company_candidates (
  icp_id          INTEGER NOT NULL REFERENCES icps(id) ON DELETE CASCADE,
  company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'proposta' CHECK (status IN (${sqlList(CANDIDATE_STATUSES)})),
  score           REAL NOT NULL DEFAULT 0,
  reasons         TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(reasons)),
  job_id          INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  score_parts     TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(score_parts)),
  scoring_version TEXT NOT NULL DEFAULT 'v1',
  created_at      TEXT NOT NULL DEFAULT ${NOW},
  decided_at      TEXT,
  PRIMARY KEY (icp_id, company_id)
);`;

/**
 * Persone (`prospects`). Identità (people-first-crm E1, PLAN P-2): `linkedin_url` normalizzato, unico se
 * presente (indice parziale `ux_prospects_linkedin`), facoltativo per chi è aggiunto a mano; `member_urn`
 * seconda chiave. Almeno un recapito tra LinkedIn, email e telefono (E2, E4). `manual_fields` = `{colonna:
 * ISO}` dei dati impostati a mano (P-3: i job non li riscrivono); prossima azione = data di calendario
 * `YYYY-MM-DD` + testo facoltativo + quando è stata impostata (G1, P-4). Usata da `SCHEMA` (DB nuovi) e
 * da `migrateSchema` (ricostruzione dei DB esistenti).
 */
export const PROSPECTS_TABLE = `CREATE TABLE IF NOT EXISTS prospects (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  linkedin_url            TEXT,                   -- identità: normalizeLinkedinUrl(), slug pubblico se noto; unico se presente
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
  status                  TEXT NOT NULL DEFAULT 'nuovo' CHECK (status IN (${sqlList(PROSPECT_STATUSES)})),
  status_changed_at       TEXT,
  created_at              TEXT NOT NULL DEFAULT ${NOW},
  updated_at              TEXT NOT NULL DEFAULT ${NOW},
  -- apollo-lookalike T5: id persona Apollo = chiave secondaria unica se presente, MAI identità (SPEC F6);
  -- data dell'ultimo esito del match (G6).
  apollo_person_id        TEXT,
  apollo_matched_at       TEXT,
  -- people-first-crm
  manual_fields           TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(manual_fields)),
  next_action_on          TEXT CHECK (next_action_on IS NULL OR date(next_action_on) IS next_action_on),
  next_action_text        TEXT,
  next_action_set_at      TEXT,
  CHECK (linkedin_url IS NOT NULL OR TRIM(COALESCE(email, '')) <> '' OR TRIM(COALESCE(phone, '')) <> ''),
  CHECK (next_action_on IS NOT NULL OR (next_action_text IS NULL AND next_action_set_at IS NULL))
);`;

/** Indici di `prospects` (creati da `SCHEMA` e dopo la ricostruzione di `migrateSchema`). */
export const PROSPECTS_INDEXES = `
CREATE UNIQUE INDEX IF NOT EXISTS ux_prospects_linkedin ON prospects(linkedin_url) WHERE linkedin_url IS NOT NULL;
-- La stessa persona arriva come slug (commenti) o come id membro (reazioni): src/db/identity.ts.
CREATE UNIQUE INDEX IF NOT EXISTS ux_prospects_member_urn ON prospects(member_urn) WHERE member_urn IS NOT NULL;
-- Id persona Apollo: chiave secondaria, scritta solo se libera (src/db/prospects.ts), mai identità.
CREATE UNIQUE INDEX IF NOT EXISTS ux_prospects_apollo_person ON prospects(apollo_person_id) WHERE apollo_person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prospects_name ON prospects(full_name);
CREATE INDEX IF NOT EXISTS idx_prospects_status ON prospects(status);
CREATE INDEX IF NOT EXISTS idx_prospects_company ON prospects(company_id);
-- Controllo doppioni sull'email (C8, E5): l'email non è una chiave, niente unicità (E1).
CREATE INDEX IF NOT EXISTS idx_prospects_email_ci ON prospects(lower(trim(email))) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prospects_next_action ON prospects(next_action_on) WHERE next_action_on IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prospects_created ON prospects(created_at);
`;

/** Timeline. `kind` ha un CHECK su `ACTIVITY_KINDS` (nuovi kind → ricostruzione, come `sources`). */
export const ACTIVITIES_TABLE = `CREATE TABLE IF NOT EXISTS activities (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  prospect_id INTEGER NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  list_id     INTEGER REFERENCES lists(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL CHECK (kind IN (${sqlList(ACTIVITY_KINDS)})),
  channel     TEXT CHECK (channel IN (${sqlList(CHANNELS)})),
  direction   TEXT CHECK (direction IN (${sqlList(DIRECTIONS)})),
  from_status TEXT CHECK (from_status IN (${sqlList(PROSPECT_STATUSES)})),
  to_status   TEXT CHECK (to_status IN (${sqlList(PROSPECT_STATUSES)})),
  body        TEXT,
  meta        TEXT CHECK (json_valid(meta)),
  occurred_at TEXT NOT NULL DEFAULT ${NOW},
  created_at  TEXT NOT NULL DEFAULT ${NOW}
);`;

/** Indici di `activities` (creati da `SCHEMA` e dopo la ricostruzione di `migrateSchema`). */
export const ACTIVITIES_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_activities_prospect ON activities(prospect_id, occurred_at);
-- Contesto dell'incontro ("Come vi siete conosciuti", people-first-crm P-5): l'unica nota cercabile (B5).
CREATE INDEX IF NOT EXISTS idx_activities_meeting ON activities(prospect_id)
  WHERE kind = 'note' AND json_extract(meta, '$.meeting') IS NOT NULL;
`;

// Politiche ON DELETE:
// - figli di `prospects` (membership, fonti, attività, analisi) → CASCADE;
// - `lists.icp_id` → RESTRICT (un ICP con liste non si cancella: l'API risponde 409);
// - riferimenti ICP e analisi dell'ICP, membership ed export della lista → CASCADE;
// - `prospects.company_id`, `activities.list_id` → SET NULL (il dato resta, perde il legame);
// - `sources.post_id` / `sources.company_id` → RESTRICT (la provenienza non sparisce in silenzio);
// - candidate → CASCADE su ICP e azienda, `job_id` → SET NULL;
// - fit manuali → CASCADE su persona e ICP (people-first-crm F10); righe di log → CASCADE sul run.
// Nota: i CHECK `IN (…)` su colonne nullable passano con NULL (semantica SQL).
export const SCHEMA = `
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
  created_at        TEXT NOT NULL DEFAULT ${NOW},
  updated_at        TEXT NOT NULL DEFAULT ${NOW}
);

${COMPANIES_TABLE}

CREATE TABLE IF NOT EXISTS icp_reference_companies (
  icp_id     INTEGER NOT NULL REFERENCES icps(id) ON DELETE CASCADE,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  outcome    TEXT NOT NULL DEFAULT 'riferimento' CHECK (outcome IN (${sqlList(REFERENCE_OUTCOMES)})),
  notes      TEXT,
  PRIMARY KEY (icp_id, company_id)
);

CREATE TABLE IF NOT EXISTS lists (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  icp_id      INTEGER NOT NULL REFERENCES icps(id) ON DELETE RESTRICT,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT ${NOW},
  archived_at TEXT                     -- archiviata = nascosta + job disabilitati
);

${PROSPECTS_TABLE}

CREATE TABLE IF NOT EXISTS list_members (
  list_id     INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  prospect_id INTEGER NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  added_at    TEXT NOT NULL DEFAULT ${NOW},
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
${SOURCES_TABLE}

${ACTIVITIES_TABLE}

-- Ultima riga per (prospect, icp) = analisi corrente; stale se input_hash ≠ hash dell'input attuale.
CREATE TABLE IF NOT EXISTS analyses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  prospect_id INTEGER NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  icp_id      INTEGER NOT NULL REFERENCES icps(id) ON DELETE CASCADE,
  model       TEXT NOT NULL,
  summary     TEXT NOT NULL,
  angles      TEXT NOT NULL CHECK (json_valid(angles)),   -- [{title, rationale}]
  fit         TEXT NOT NULL CHECK (fit IN (${sqlList(FIT_LEVELS)})),
  fit_reason  TEXT,
  input_hash  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT ${NOW}
);

${JOBS_TABLE}

${CANDIDATES_TABLE}

-- Il CSV non si salva: si rigenera e scarica per id.
CREATE TABLE IF NOT EXISTS exports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id      INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  filters      TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(filters)),
  prospect_ids TEXT CHECK (json_valid(prospect_ids)),
  count        INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT ${NOW}
);

-- Fit manuale per coppia persona–ICP (people-first-crm F, PLAN P-7): al più uno, sparisce con l'ICP.
CREATE TABLE IF NOT EXISTS manual_fits (
  prospect_id INTEGER NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  icp_id      INTEGER NOT NULL REFERENCES icps(id) ON DELETE CASCADE,
  fit         TEXT NOT NULL CHECK (fit IN (${sqlList(FIT_LEVELS)})),
  reason      TEXT,
  set_at      TEXT NOT NULL,
  PRIMARY KEY (prospect_id, icp_id)
);

-- Log dei run (people-first-crm J8–J11, PLAN P-10): righe con orario, scritte dal processo del run.
CREATE TABLE IF NOT EXISTS run_logs (
  job_id  INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  seq     INTEGER NOT NULL,
  at      TEXT NOT NULL,
  level   TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  message TEXT NOT NULL,
  PRIMARY KEY (job_id, seq)
) WITHOUT ROWID;

-- Unicità delle fonti (P4): il re-sync aggiorna invece di duplicare. Gli upsert
-- devono ripetere la clausola WHERE dell'indice nel conflict target.
CREATE UNIQUE INDEX IF NOT EXISTS ux_sources_post ON sources(prospect_id, kind, post_id) WHERE post_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_sources_company ON sources(prospect_id, kind, company_id) WHERE company_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_sources_manual ON sources(prospect_id, kind) WHERE post_id IS NULL AND company_id IS NULL;

${COMPANIES_INDEXES}
${PROSPECTS_INDEXES}
${ACTIVITIES_INDEXES}
CREATE INDEX IF NOT EXISTS idx_list_members_prospect ON list_members(prospect_id);
CREATE INDEX IF NOT EXISTS idx_sources_prospect ON sources(prospect_id);
CREATE INDEX IF NOT EXISTS idx_analyses_prospect_icp ON analyses(prospect_id, icp_id, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(state);
CREATE INDEX IF NOT EXISTS idx_sources_company ON sources(company_id, kind);
-- Statistiche per ricerca (SPEC D14) e "candidata per ICP" del dettaglio azienda.
CREATE INDEX IF NOT EXISTS idx_candidates_job ON icp_company_candidates(job_id);
CREATE INDEX IF NOT EXISTS idx_candidates_company ON icp_company_candidates(company_id);
CREATE INDEX IF NOT EXISTS idx_manual_fits_icp ON manual_fits(icp_id);
`;

/**
 * Attiva i vincoli di integrità, migra i DB esistenti (`migrateSchema`, no-op sui DB nuovi e su
 * quelli già aggiornati) e applica lo schema (idempotente). `foreign_keys` è per-connessione: va
 * ripetuto su ogni connessione aperta sul file. La migrazione precede `SCHEMA` perché gli indici
 * nuovi (`companies`, `prospects.apollo_person_id`) richiedono le colonne nuove. Anche i processi
 * figli dei job passano da qui all'import: sul DB già migrato dal server non fanno nulla.
 */
export function applySchema(database: Database.Database): void {
  database.pragma('foreign_keys = ON');
  migrateSchema(database, database.name);
  database.exec(SCHEMA);
}

// ---------------------------------------------------------------------------
// Migrazioni (apollo-lookalike T4a/T5, PLAN P-1 e §6): SQLite non toglie NOT NULL né cambia i CHECK
// con ALTER TABLE → ricostruzione della tabella ("12 passi" della documentazione) con backup prima.
// ---------------------------------------------------------------------------

/** True se la tabella esiste nel DB. */
export function hasTable(database: Database.Database, name: string): boolean {
  return database.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name) !== undefined;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

type ColumnInfo = { name: string; notnull: number };

function tableColumns(database: Database.Database, name: string): ColumnInfo[] {
  return database.pragma(`table_info(${quoteIdent(name)})`) as ColumnInfo[];
}

/** `CREATE TABLE …` salvato in `sqlite_master`, `undefined` se la tabella non esiste. */
function tableSql(database: Database.Database, name: string): string | undefined {
  return database.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`).pluck().get(name) as
    | string
    | undefined;
}

/**
 * Violazioni correnti di chiave esterna (tutto il DB), come chiavi confrontabili prima/dopo una
 * ricostruzione (senza `fkid`: l'ordine delle FK può cambiare con la DDL nuova).
 */
function foreignKeyViolations(database: Database.Database): string[] {
  const rows = database.pragma('foreign_key_check') as Array<{ table: string; rowid: number | null; parent: string }>;
  return rows.map((r) => `${r.table}#${r.rowid ?? '?'} → ${r.parent}`);
}

/** Lancia se ci sono violazioni di chiave esterna non presenti in `before` (la transazione torna indietro). */
function assertNoNewViolations(database: Database.Database, before: Set<string>, what: string): void {
  const introduced = foreignKeyViolations(database).filter((v) => !before.has(v));
  if (introduced.length > 0) {
    throw new Error(`la ricostruzione di ${what} viola ${introduced.length} chiavi esterne (${introduced.slice(0, 5).join('; ')})`);
  }
}

/**
 * Esegue `fn` con `foreign_keys=OFF` (si può cambiare solo fuori transazione) e ripristina il valore
 * di prima nel `finally`.
 */
function withForeignKeysOff(database: Database.Database, what: string, fn: () => void): void {
  if (database.inTransaction) {
    throw new Error(`Ricostruzione di ${what} impossibile dentro una transazione aperta (foreign_keys non si può spegnere).`);
  }
  const foreignKeysBefore = database.pragma('foreign_keys', { simple: true }) === 1;
  database.pragma('foreign_keys = OFF');
  try {
    fn();
  } finally {
    database.pragma(`foreign_keys = ${foreignKeysBefore ? 'ON' : 'OFF'}`);
  }
}

export interface RebuildTableOptions {
  /** DDL aggiuntiva (es. indici nuovi) eseguita dopo la rinomina, dentro la transazione. */
  indexes?: string;
  /** Passo di dati (es. backfill) eseguito dentro la transazione, sulla tabella già ricostruita. */
  migrate?: (database: Database.Database) => void;
}

/**
 * Passi della ricostruzione di `name`, da eseguire con `foreign_keys=OFF` dentro una transazione già
 * aperta: `CREATE TABLE <name>__new`, copia di `copyColumns`, `DROP` della vecchia, rinomina, indici con
 * nome della vecchia tabella ricreati, `indexes`, contatore AUTOINCREMENT conservato (gli id cancellati
 * non si riusano).
 */
function rebuildTableSteps(
  database: Database.Database,
  name: string,
  newDdl: string,
  copyColumns: readonly string[],
  indexes?: string,
): void {
  const tmp = `${name}__new`;
  const header = new RegExp(String.raw`^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?${name}"?\s*\(`, 'i');
  if (!header.test(newDdl)) throw new Error(`La DDL passata a rebuildTable non crea la tabella ${name}.`);
  const createTmp = newDdl.replace(header, `CREATE TABLE ${quoteIdent(tmp)} (`);
  const columns = copyColumns.map(quoteIdent).join(', ');

  const oldIndexes = database
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL`)
    .pluck()
    .all(name) as string[];
  const seq = hasTable(database, 'sqlite_sequence')
    ? (database.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').pluck().get(name) as number | undefined)
    : undefined;

  database.exec(`DROP TABLE IF EXISTS ${quoteIdent(tmp)}`);
  database.exec(createTmp);
  database.exec(`INSERT INTO ${quoteIdent(tmp)} (${columns}) SELECT ${columns} FROM ${quoteIdent(name)}`);
  database.exec(`DROP TABLE ${quoteIdent(name)}`);
  database.exec(`ALTER TABLE ${quoteIdent(tmp)} RENAME TO ${quoteIdent(name)}`);
  for (const sql of oldIndexes) database.exec(sql);
  if (indexes) database.exec(indexes);
  if (seq !== undefined) {
    const updated = database.prepare('UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = ?').run(seq, name);
    if (updated.changes === 0) database.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)').run(name, seq);
  }
}

/**
 * Ricostruisce `name` con una DDL nuova (procedura ufficiale SQLite): `foreign_keys=OFF` fuori
 * transazione → in una transazione: `rebuildTableSteps`, `options.migrate`, poi `foreign_key_check`:
 * se la ricostruzione introduce violazioni lancia e la transazione torna indietro (le violazioni già
 * presenti prima non bloccano). `foreign_keys` torna al valore di prima nel `finally`. `newDdl` è il
 * `CREATE TABLE [IF NOT EXISTS] <name> (…)` della tabella nuova.
 */
export function rebuildTable(
  database: Database.Database,
  name: string,
  newDdl: string,
  copyColumns: readonly string[],
  options: RebuildTableOptions = {},
): void {
  withForeignKeysOff(database, name, () => {
    database.transaction(() => {
      const violationsBefore = new Set(foreignKeyViolations(database));
      rebuildTableSteps(database, name, newDdl, copyColumns, options.indexes);
      options.migrate?.(database);
      assertNoNewViolations(database, violationsBefore, name);
    })();
  });
}

/** Backup già fatti in questo processo, per percorso del DB (uno per avvio: PLAN P-1). */
const backups = new Map<string, string>();

/** Solo per i test: dimentica i backup fatti, così `backupDatabase` ne rifà uno. */
export function resetBackupState(): void {
  backups.clear();
}

/** DB senza file (in memoria o temporaneo anonimo): niente da copiare. */
function isInMemory(dbPath: string): boolean {
  return dbPath === '' || dbPath === ':memory:' || dbPath.startsWith('file::memory:');
}

/**
 * Copia di sicurezza consistente del DB prima di una ricostruzione (SPEC B10): `VACUUM INTO` legge
 * lo stesso contenuto di una query (WAL incluso) e scrive `<dbPath>.bak-<ISO>` accanto all'originale.
 * Una sola copia per processo e per DB (le chiamate successive ritornano la stessa). Rifiuta se un
 * job risulta in corso con un processo vivo: la ricostruzione non deve correre sotto un job che scrive.
 * Ritorna il percorso della copia, `null` per i DB in memoria.
 */
export function backupDatabase(database: Database.Database, dbPath: string): string | null {
  if (isInMemory(dbPath)) return null;
  const done = backups.get(dbPath);
  if (done) return done;

  if (hasTable(database, 'jobs')) {
    const running = database.prepare(`SELECT id, pid FROM jobs WHERE state = 'running' AND pid IS NOT NULL`).all() as Array<{
      id: number;
      pid: number;
    }>;
    const alive = running.find((job) => isAlive(job.pid));
    if (alive) {
      throw new Error(
        `Aggiornamento del database rifiutato: il job #${alive.id} è ancora in esecuzione (pid ${alive.pid}). ` +
          'Attendi che finisca o fermalo, poi riavvia il server. Nessuna modifica è stata fatta.',
      );
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let target = `${dbPath}.bak-${stamp}`;
  for (let n = 2; fs.existsSync(target); n += 1) target = `${dbPath}.bak-${stamp}-${n}`;
  database.prepare('VACUUM INTO ?').run(target);
  backups.set(dbPath, target);
  return target;
}

/** Colonne di `companies` prima di apollo-lookalike: copiate così come sono nella tabella nuova. */
const COMPANIES_V1_COLUMNS = [
  'id',
  'linkedin_url',
  'name',
  'website',
  'industry',
  'size',
  'location',
  'notes',
  'created_at',
  'updated_at',
] as const;

/** Colonne di `sources` e `jobs` (invariate da crm-foundation: la ricostruzione cambia solo i CHECK). */
const SOURCES_COLUMNS = ['id', 'prospect_id', 'kind', 'post_id', 'company_id', 'reaction_type', 'comment_text', 'raw_json', 'captured_at'] as const;
const JOBS_COLUMNS = ['id', 'kind', 'params', 'state', 'pid', 'started_at', 'finished_at', 'result', 'error', 'created_at'] as const;

/**
 * Colonne di `prospects` copiate nella ricostruzione di people-first-crm: quelle di crm-foundation più le
 * due di apollo-lookalike (assenti su un DB crm-foundation: `presentColumns` le salta). Le colonne nuove
 * prendono il default: niente risulta "impostato a mano" (SPEC Constraints).
 */
const PROSPECTS_COLUMNS = [
  'id',
  'linkedin_url',
  'member_urn',
  'full_name',
  'headline',
  'about',
  'location',
  'email',
  'phone',
  'company_id',
  'company_name',
  'title',
  'raw_json',
  'enriched_at',
  'enrichment_attempted_at',
  'status',
  'status_changed_at',
  'created_at',
  'updated_at',
  'apollo_person_id',
  'apollo_matched_at',
] as const;
const PROSPECTS_NEW_COLUMNS = ['manual_fields', 'next_action_on', 'next_action_text', 'next_action_set_at'] as const;

const ACTIVITIES_COLUMNS = [
  'id',
  'prospect_id',
  'list_id',
  'kind',
  'channel',
  'direction',
  'from_status',
  'to_status',
  'body',
  'meta',
  'occurred_at',
  'created_at',
] as const;

/** Colonne di `wanted` presenti nella tabella attuale (quelle da copiare nella ricostruzione). */
function presentColumns(database: Database.Database, table: string, wanted: readonly string[]): string[] {
  const present = new Set(tableColumns(database, table).map((c) => c.name));
  return wanted.filter((c) => present.has(c));
}

type DomainCollision = { domain: string; keptId: number; skippedId: number };

/**
 * Backfill di `companies.domain = normalizeDomain(website)` in ordine di id (SPEC B8): a parità di
 * dominio lo tiene l'id minore, le altre righe restano senza (una riga di log); un sito non
 * normalizzabile lascia il dominio vuoto. Ritorna i domini assegnati; le collisioni in `collisions`.
 */
function backfillCompanyDomains(database: Database.Database, collisions: DomainCollision[]): number {
  const owners = new Map<string, number>(
    (database.prepare('SELECT domain, id FROM companies WHERE domain IS NOT NULL').all() as Array<{ domain: string; id: number }>).map(
      (r) => [r.domain, r.id],
    ),
  );
  const rows = database
    .prepare('SELECT id, website FROM companies WHERE domain IS NULL AND website IS NOT NULL ORDER BY id')
    .all() as Array<{ id: number; website: string }>;
  const setDomain = database.prepare('UPDATE companies SET domain = ? WHERE id = ?');
  let assigned = 0;
  for (const row of rows) {
    const domain = normalizeDomain(row.website);
    if (!domain) continue;
    const owner = owners.get(domain);
    if (owner !== undefined) {
      collisions.push({ domain, keptId: owner, skippedId: row.id });
      console.warn(`[migrazione aziende] dominio ${domain} già assegnato all'azienda #${owner}: l'azienda #${row.id} resta senza dominio.`);
      continue;
    }
    setDomain.run(domain, row.id);
    owners.set(domain, row.id);
    assigned += 1;
  }
  return assigned;
}

/** True se `companies` ha ancora `linkedin_url NOT NULL` (schema di crm-foundation). */
function companiesNeedDualKey(database: Database.Database): boolean {
  const linkedin = tableColumns(database, 'companies').find((c) => c.name === 'linkedin_url');
  return linkedin !== undefined && linkedin.notnull === 1;
}

/**
 * True se `prospects` è ancora quella di prima di people-first-crm: `linkedin_url NOT NULL UNIQUE` oppure
 * colonne nuove mancanti (ricostruzione: l'unicità dell'URL diventa l'indice parziale `ux_prospects_linkedin`).
 */
function prospectsNeedRebuild(database: Database.Database): boolean {
  const columns = tableColumns(database, 'prospects');
  if (columns.length === 0) return false;
  const linkedin = columns.find((c) => c.name === 'linkedin_url');
  const names = new Set(columns.map((c) => c.name));
  return (linkedin !== undefined && linkedin.notnull === 1) || PROSPECTS_NEW_COLUMNS.some((c) => !names.has(c));
}

/** True se il CHECK dell'enum nella DDL salvata non contiene tutti i valori attuali (tabella da ricostruire). */
function enumCheckOutdated(database: Database.Database, table: string, values: readonly string[]): boolean {
  const sql = tableSql(database, table);
  return sql !== undefined && values.some((v) => !sql.includes(`'${v}'`));
}

/** Colonne di `JOBS_NEW_COLUMNS` mancanti in `jobs` (vuoto su un DB nuovo, senza `jobs`, o già aggiornato). */
function missingJobsColumns(database: Database.Database): string[] {
  const names = new Set(tableColumns(database, 'jobs').map((c) => c.name));
  if (names.size === 0) return [];
  return JOBS_NEW_COLUMNS.map((c) => c.name).filter((c) => !names.has(c));
}

/**
 * Strumenti di un run concluso prima di people-first-crm (backfill di `jobs.tools`, PLAN §6 e P-12), dai
 * soli dati salvati: sync e persone di un'azienda → Apify; arricchimento → Apollo o Apify secondo il
 * provider; analisi → Anthropic, più Apify se ha arricchito prima o se l'errore viene da un actor Apify
 * (`actor:<owner>/<name>:`) o nomina `APIFY_TOKEN`; kind Apollo → Apollo.
 */
export function legacyRunTools(kind: string, params: unknown, result: unknown, error: string | null): string[] {
  const p = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>;
  switch (kind) {
    case 'sync_interactions':
    case 'source_company':
      return ['apify'];
    case 'enrich':
      return [p.provider === 'apollo' ? 'apollo' : 'apify'];
    case 'analyze': {
      const counts = (result && typeof result === 'object' ? (result as { counts?: unknown }).counts : undefined) as
        | Record<string, unknown>
        | undefined;
      const enrichedFirst = typeof counts?.enriched_first === 'number' && counts.enriched_first > 0;
      const apifyError = error !== null && (/^actor:[^:/\s]+\/[^:\s]+:/.test(error) || error.includes('APIFY_TOKEN'));
      return enrichedFirst || apifyError ? ['anthropic', 'apify'] : ['anthropic'];
    }
    case 'enrich_companies':
    case 'lookalike_companies':
    case 'apollo_people':
      return ['apollo'];
    default:
      return [];
  }
}

function parseJson(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Riempie `jobs.tools` dei run che ne sono senza (`'[]'`) con `legacyRunTools`: la migrazione lo fa sugli
 * storici, `src/server/index.ts` a ogni avvio sui run creati prima di T30 (people-first-crm P-28).
 * Idempotente: ritorna quante righe ha aggiornato (0 quando non c'è più niente da riempire).
 */
export function fillMissingRunTools(database: Database.Database): number {
  const rows = database.prepare(`SELECT id, kind, params, result, error FROM jobs WHERE tools = '[]'`).all() as Array<{
    id: number;
    kind: string;
    params: string;
    result: string | null;
    error: string | null;
  }>;
  const update = database.prepare('UPDATE jobs SET tools = ? WHERE id = ?');
  let updated = 0;
  for (const row of rows) {
    const tools = legacyRunTools(row.kind, parseJson(row.params), parseJson(row.result), row.error);
    if (tools.length === 0) continue;
    update.run(JSON.stringify(tools), row.id);
    updated += 1;
  }
  return updated;
}

/** Cosa va aggiornato su un DB esistente (tutto `false`/vuoto su un DB nuovo o già aggiornato). */
export interface SchemaMigrationPlan {
  /** `companies.linkedin_url` ancora `NOT NULL` → ricostruzione a doppia chiave + backfill del dominio (apollo-lookalike T4a). */
  companies: boolean;
  /** CHECK di `sources.kind` senza tutti i `SOURCE_KINDS` (es. `apollo_people`) → ricostruzione (apollo-lookalike T5). */
  sources: boolean;
  /** CHECK di `jobs.kind` senza tutti i `JOB_KINDS` → ricostruzione (apollo-lookalike T5). */
  jobs: boolean;
  /** `prospects` di prima di people-first-crm (URL obbligatorio o colonne nuove mancanti) → ricostruzione. */
  prospects: boolean;
  /** CHECK di `activities.kind` senza tutti gli `ACTIVITY_KINDS` → ricostruzione (people-first-crm). */
  activities: boolean;
  /** Colonne di `JOBS_NEW_COLUMNS` mancanti → `ALTER TABLE ADD COLUMN` + backfill di `tools` (people-first-crm). */
  jobsColumns: string[];
}

export function planSchemaMigration(database: Database.Database): SchemaMigrationPlan {
  return {
    companies: companiesNeedDualKey(database),
    sources: enumCheckOutdated(database, 'sources', SOURCE_KINDS),
    jobs: enumCheckOutdated(database, 'jobs', JOB_KINDS),
    prospects: prospectsNeedRebuild(database),
    activities: enumCheckOutdated(database, 'activities', ACTIVITY_KINDS),
    jobsColumns: missingJobsColumns(database),
  };
}

export interface SchemaMigrationResult {
  migrated: boolean;
  /** Tabelle aggiornate (vuoto se `migrated` è `false`). */
  tables: string[];
  /** Copia di sicurezza fatta prima della ricostruzione (`null` per i DB in memoria). */
  backupPath?: string | null;
  /** Aziende che hanno ricevuto il dominio dal sito. */
  domainsAssigned?: number;
  /** Domini già presi da un'azienda con id minore: la riga resta senza dominio (SPEC B8). */
  collisions?: DomainCollision[];
  /** Run storici che hanno ricevuto gli strumenti (`jobs.tools`, people-first-crm). */
  jobToolsFilled?: number;
}

/**
 * Aggiornamento dello schema dei DB esistenti all'avvio: `companies` a doppia chiave, `sources` e `jobs`
 * ricostruite quando il loro CHECK non contiene i kind nuovi (apollo-lookalike); `prospects` ricostruita con
 * l'URL LinkedIn facoltativo, i dati a mano e la prossima azione, `activities` coi kind nuovi, colonne nuove
 * di `jobs` con il backfill degli strumenti (people-first-crm). Una **sola** copia di sicurezza
 * (`backupDatabase`, rifiutata con un job vivo: nessuna modifica) e **una sola** transazione con
 * `foreign_keys=OFF` per tutte le tabelle, con `foreign_key_check` alla fine: tutto o niente — su errore il
 * DB resta com'era e il messaggio indica la copia. Idempotente: su un DB nuovo o già aggiornato non fa
 * nulla (nemmeno il backup), così i processi figli dei job che importano `db/index.ts` non toccano il file.
 */
export function migrateSchema(database: Database.Database, dbPath: string): SchemaMigrationResult {
  const plan = planSchemaMigration(database);
  const tables = [
    ...(plan.companies ? ['companies'] : []),
    ...(plan.sources ? ['sources'] : []),
    ...(plan.jobs || plan.jobsColumns.length > 0 ? ['jobs'] : []),
    ...(plan.prospects ? ['prospects'] : []),
    ...(plan.activities ? ['activities'] : []),
  ];
  if (tables.length === 0) return { migrated: false, tables };

  const backupPath = backupDatabase(database, dbPath);
  const collisions: DomainCollision[] = [];
  let domainsAssigned = 0;
  let jobToolsFilled = 0;
  try {
    withForeignKeysOff(database, tables.join(', '), () => {
      database.transaction(() => {
        const violationsBefore = new Set(foreignKeyViolations(database));
        if (plan.companies) {
          rebuildTableSteps(database, 'companies', COMPANIES_TABLE, presentColumns(database, 'companies', COMPANIES_V1_COLUMNS), COMPANIES_INDEXES);
          domainsAssigned = backfillCompanyDomains(database, collisions);
        }
        if (plan.sources) {
          rebuildTableSteps(database, 'sources', SOURCES_TABLE, presentColumns(database, 'sources', SOURCES_COLUMNS));
        }
        if (plan.jobs) {
          // La DDL nuova ha già le colonne di people-first-crm (default): nessun ALTER dopo.
          rebuildTableSteps(database, 'jobs', JOBS_TABLE, presentColumns(database, 'jobs', JOBS_COLUMNS));
        }
        const stillMissing = new Set(missingJobsColumns(database));
        for (const column of JOBS_NEW_COLUMNS) {
          if (stillMissing.has(column.name)) database.exec(`ALTER TABLE jobs ADD COLUMN ${quoteIdent(column.name)} ${column.ddl}`);
        }
        if (plan.jobsColumns.includes('tools')) jobToolsFilled = fillMissingRunTools(database);
        if (plan.prospects) {
          // L'autoindice di `UNIQUE` sparisce con la tabella vecchia: l'unicità dell'URL passa all'indice parziale.
          rebuildTableSteps(database, 'prospects', PROSPECTS_TABLE, presentColumns(database, 'prospects', PROSPECTS_COLUMNS), PROSPECTS_INDEXES);
        }
        if (plan.activities) {
          rebuildTableSteps(database, 'activities', ACTIVITIES_TABLE, presentColumns(database, 'activities', ACTIVITIES_COLUMNS), ACTIVITIES_INDEXES);
        }
        assertNoNewViolations(database, violationsBefore, tables.join(', '));
      })();
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const copyText = backupPath ? ` Copia di sicurezza: ${backupPath}.` : '';
    throw new Error(
      `Aggiornamento dello schema del database fallito (${tables.join(', ')}): ${reason}. Il database originale è intatto.${copyText}`,
      { cause: err },
    );
  }

  console.log(
    `[migrazione schema] tabelle aggiornate: ${tables.join(', ')}` +
      (plan.companies ? ` (${domainsAssigned} domini dal sito${collisions.length ? `, ${collisions.length} collisioni` : ''})` : '') +
      (jobToolsFilled > 0 ? ` (${jobToolsFilled} run con gli strumenti)` : '') +
      (backupPath ? `. Copia di sicurezza: ${backupPath}` : ''),
  );
  return { migrated: true, tables, backupPath, domainsAssigned, collisions, jobToolsFilled };
}
