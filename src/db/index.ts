import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { applySchema } from './schema.js';

fs.mkdirSync(path.dirname(config.paths.db), { recursive: true });

export const db: Database.Database = new Database(config.paths.db);
db.pragma('journal_mode = WAL');
// Server e processo figlio dei job scrivono lo stesso file: attendi
// invece di fallire subito con SQLITE_BUSY.
db.pragma('busy_timeout = 5000');
applySchema(db);

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

/** True se la colonna esiste già (via `PRAGMA table_info`). Guard per gli UPDATE di backfill. */
export function hasColumn(database: Database.Database, table: string, column: string): boolean {
  const cols = database.pragma(`table_info(${table})`) as Array<{ name: string }>;
  return cols.some((c) => c.name === column);
}

export function nowIso(): string {
  return new Date().toISOString();
}
