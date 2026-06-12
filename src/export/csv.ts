import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import type { ContactRow } from '../db/contacts.js';

const COLUMNS: Array<keyof ContactRow> = [
  'full_name',
  'email',
  'linkedin_url',
  'bucket',
  'role',
  'sector',
  'fit_score',
  'short_description',
  'score_reason',
  'company',
  'phone',
  'source_strategy',
  'source_post_url',
  'email_subject',
  'email_body',
];

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function toCsv(rows: ContactRow[]): string {
  const header = COLUMNS.join(',');
  const lines = rows.map((r) => COLUMNS.map((col) => csvCell(r[col])).join(','));
  return [header, ...lines].join('\n');
}

export interface ExportResult {
  csvPath: string;
  jsonPath: string;
  count: number;
}

/** Scrive CSV + JSON dei contatti indicati in exports/<label>.csv|json. */
export function exportContacts(rows: ContactRow[], label: string): ExportResult {
  fs.mkdirSync(config.paths.exports, { recursive: true });
  const base = path.join(config.paths.exports, label);
  const csvPath = `${base}.csv`;
  const jsonPath = `${base}.json`;

  fs.writeFileSync(csvPath, toCsv(rows), 'utf8');
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      rows.map((r) => ({ ...r, signals: r.signals ? safeParse(r.signals) : null, raw_json: undefined })),
      null,
      2,
    ),
    'utf8',
  );
  return { csvPath, jsonPath, count: rows.length };
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
