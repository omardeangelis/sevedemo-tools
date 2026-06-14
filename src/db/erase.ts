import type Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { db } from './index.js';

export interface EraseResult {
  contacts: number;
  runs: number;
  selections: number;
  outcomes: number;
  kv: number;
  exportFiles: number;
}

export interface EraseDeps {
  database?: Database.Database;
  exportsDir?: string;
}

/**
 * Azzera tutti i dati prodotti dal sistema: le 5 tabelle dati (ordine FK-safe)
 * e i file in `exports/`. Non tocca lo schema, i seed (`data/seeds/`) né le
 * sottocartelle di exports. Gli id AUTOINCREMENT ripartono da 1.
 */
export function eraseAllData(deps: EraseDeps = {}): EraseResult {
  const database = deps.database ?? db;
  const exportsDir = deps.exportsDir ?? config.paths.exports;

  const count = (table: string): number =>
    (database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

  const result = database.transaction((): Omit<EraseResult, 'exportFiles'> => {
    const counts = {
      contacts: count('contacts'),
      runs: count('runs'),
      selections: count('daily_selection'),
      outcomes: count('outcomes'),
      kv: count('kv'),
    };
    // Figlie prima delle madri (daily_selection e outcomes referenziano contacts).
    for (const table of ['outcomes', 'daily_selection', 'runs', 'kv', 'contacts']) {
      database.prepare(`DELETE FROM ${table}`).run();
    }
    // sqlite_sequence esiste solo se almeno una tabella AUTOINCREMENT ha scritto.
    try {
      database.prepare('DELETE FROM sqlite_sequence').run();
    } catch {
      /* tabella assente: nessuna sequenza da azzerare */
    }
    return counts;
  })();

  let exportFiles = 0;
  if (fs.existsSync(exportsDir)) {
    for (const entry of fs.readdirSync(exportsDir, { withFileTypes: true })) {
      if (entry.isFile()) {
        fs.unlinkSync(path.join(exportsDir, entry.name));
        exportFiles++;
      }
    }
  }

  return { ...result, exportFiles };
}
