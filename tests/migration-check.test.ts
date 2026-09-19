import Database from 'better-sqlite3';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Prova della migrazione su una copia del DB reale (people-first-crm T2). Lo script non importa mai
// `src/db/index.ts`: qui si importa solo il suo modulo, con import dinamico come gli altri test.
const { checkMigration } = await import('../scripts/migration-check.js');

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APOLLO_SCHEMA_PATH = fileURLToPath(new URL('./fixtures/schema-apollo-lookalike.sql', import.meta.url));

/** Dati sintetici sullo schema di apollo-lookalike (lo stesso codice gira anche nel processo figlio). */
const SEED_SQL = `
INSERT INTO icps (name) VALUES ('ICP');
INSERT INTO companies (linkedin_url, domain, name) VALUES ('https://www.linkedin.com/company/acme', 'acme.it', 'Acme');
INSERT INTO lists (icp_id, name) VALUES (1, 'Lista');
INSERT INTO posts (post_url) VALUES ('https://www.linkedin.com/posts/p-1');
INSERT INTO prospects (linkedin_url, full_name, company_id) VALUES ('https://www.linkedin.com/in/uno', 'Uno', 1);
INSERT INTO prospects (linkedin_url, full_name) VALUES ('https://www.linkedin.com/in/due', 'Due');
INSERT INTO prospects (linkedin_url, full_name, status) VALUES ('https://www.linkedin.com/in/tre', 'Tre', 'scartato');
INSERT INTO prospects (linkedin_url, full_name) VALUES ('https://www.linkedin.com/in/quattro', 'Quattro');
INSERT INTO list_members (list_id, prospect_id) VALUES (1, 1);
INSERT INTO sources (prospect_id, kind, post_id, reaction_type) VALUES (2, 'post_reaction', 1, 'LIKE');
INSERT INTO sources (prospect_id, kind, company_id) VALUES (4, 'company_employees', 1);
INSERT INTO activities (prospect_id, kind, body) VALUES (1, 'note', 'nota');
INSERT INTO jobs (kind, params, state) VALUES ('enrich', '{}', 'succeeded');
`;

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const statOf = (file: string) => {
  const st = fs.statSync(file);
  return { size: st.size, mtimeMs: st.mtimeMs };
};

/** (1) DB in WAL chiuso pulito (checkpoint alla chiusura). */
function cleanWalDb(): string {
  const file = path.join(tmpDir('mc-clean-'), 'crm.db');
  const conn = new Database(file);
  conn.pragma('journal_mode = WAL');
  conn.exec(fs.readFileSync(APOLLO_SCHEMA_PATH, 'utf8'));
  conn.exec(SEED_SQL);
  conn.close();
  return file;
}

/** (2) Layout reale: un processo scrive in WAL ed è terminato con SIGINT senza checkpoint (dati nel `-wal`). */
async function killedWriterDb(): Promise<string> {
  const file = path.join(tmpDir('mc-killed-'), 'crm.db');
  const script = `
    const Database = require('better-sqlite3');
    const fs = require('fs');
    const db = new Database(process.argv[1]);
    db.pragma('journal_mode = WAL');
    db.exec(fs.readFileSync(process.argv[2], 'utf8'));
    db.exec(process.argv[3]);
    process.stdout.write('pronto\\n');
    setInterval(() => {}, 1000);
  `;
  const child = spawn(process.execPath, ['-e', script, file, APOLLO_SCHEMA_PATH, SEED_SQL], { cwd: REPO, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise<void>((resolve, reject) => {
    child.stdout.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('pronto')) resolve();
    });
    child.on('exit', (code) => reject(new Error(`scrittore uscito prima del tempo (${code})`)));
  });
  const exited = new Promise((resolve) => child.on('exit', resolve));
  child.kill('SIGINT');
  await exited;
  return file;
}

describe('checkMigration su una copia (people-first-crm T2)', () => {
  it.each([
    ['DB in WAL chiuso pulito', async () => cleanWalDb()],
    ['layout reale: dati nel -wal, processo terminato con SIGINT', killedWriterDb],
  ])('%s: conteggi e colonne uguali, no-op al secondo giro, niente FK rotte, sorgente intatto', async (_label, make) => {
    const src = await make();
    const dir = path.dirname(src);
    const filesBefore = fs.readdirSync(dir).sort();
    const dbBefore = statOf(src);
    const walBefore = fs.existsSync(`${src}-wal`) ? statOf(`${src}-wal`) : null;

    const report = await checkMigration(src, { preflight: () => [] });

    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.rowsBefore.prospects).toBe(4);
    expect(report.rowsBefore.sources).toBe(2);
    for (const [table, n] of Object.entries(report.rowsBefore)) expect(report.rowsAfter[table]).toBe(n);
    expect(report.missingColumns).toEqual([]);
    expect(report.migratedTables).toEqual(expect.arrayContaining(['prospects', 'activities', 'jobs']));
    expect(report.secondRunNoop).toBe(true);
    expect(report.fkViolations).toEqual([]);
    expect(report.inboxBefore).toBe(2);
    expect(report.toTriageAfter).toBe(2);
    // Quattro era visibile in Acme per la sua fonte, ma non è collegata: con D5 la sezione si accorcia.
    expect(report.companiesShrunk).toBe(1);
    expect(report.personsHiddenFromCompanies).toBe(1);
    expect(report.tmpRemoved).toBe(true);
    expect(report.sourceUnchanged).toBe(true);
    expect(fs.readdirSync(dir).sort()).toEqual(filesBefore);
    expect(statOf(src)).toEqual(dbBefore);
    if (walBefore) expect(statOf(`${src}-wal`)).toEqual(walBefore);
    // Il report non contiene nomi né URL.
    expect(JSON.stringify(report)).not.toMatch(/Uno|Due|linkedin\.com|acme/i);
  });

  it('nel layout reale i dati stanno nel -wal: il solo .db copiato non avrebbe le tabelle', async () => {
    const src = await killedWriterDb();
    expect(fs.statSync(`${src}-wal`).size).toBeGreaterThan(0);
    const onlyDb = path.join(tmpDir('mc-onlydb-'), 'copy.db');
    fs.copyFileSync(src, onlyDb);
    const conn = new Database(onlyDb, { readonly: true });
    expect(conn.prepare(`SELECT COUNT(*) FROM sqlite_master WHERE name = 'prospects'`).pluck().get()).toBe(0);
    conn.close();
  });

  it('rifiuta se un processo ha il DB aperto, senza copiare nulla', async () => {
    const src = cleanWalDb();
    const tmp = path.join(tmpDir('mc-refuse-'), 'lavoro');
    await expect(checkMigration(src, { preflight: () => [4242], tmpDir: tmp })).rejects.toThrow(/aperto da 1 processo\/i \(pid 4242\)/);
    expect(fs.existsSync(tmp)).toBe(false);
  });

  it('rifiuta una cartella temporanea dentro data/ o dentro il repo, senza crearla', async () => {
    const src = cleanWalDb();
    const inData = path.join(REPO, 'data', 'migration-check-mai');
    await expect(checkMigration(src, { preflight: () => [], tmpDir: inData })).rejects.toThrow(/fuori da data\/ e dal repo/);
    expect(fs.existsSync(inData)).toBe(false);
    const inRepo = path.join(REPO, 'tmp-migration-check-mai');
    await expect(checkMigration(src, { preflight: () => [], tmpDir: inRepo })).rejects.toThrow(/fuori da data\/ e dal repo/);
    expect(fs.existsSync(inRepo)).toBe(false);
  });

  it('come processo: non apre mai DB_PATH (nessun import di db/index.ts) ed esce con 0', () => {
    const src = cleanWalDb();
    const sentinel = path.join(tmpDir('mc-sentinel-'), 'sentinella.db');
    const run = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/migration-check.ts', src], {
      cwd: REPO,
      encoding: 'utf8',
      env: { ...process.env, DB_PATH: sentinel, MIGRATION_CHECK_NO_PREFLIGHT: '1' },
    });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('Esito: OK');
    expect(fs.existsSync(sentinel)).toBe(false);
  });
});
