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
const PEOPLE_FIRST_SCHEMA = fs.readFileSync(new URL('./fixtures/schema-people-first-crm.sql', import.meta.url), 'utf8');
/** Post salvati dal vero `upsertPost` di people-first-crm (500 e 450 con emoji troncati, 120 intero). */
const LEGACY_POSTS = (
  JSON.parse(fs.readFileSync(new URL('./fixtures/posts-people-first-crm.json', import.meta.url), 'utf8')) as {
    posts: Array<{ key: string; text_excerpt: string }>;
  }
).posts;

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

/** DB con lo schema di people-first-crm (quello del DB reale oggi): post veri, due analisi, azienda compilata. */
function peopleFirstDb(): string {
  const file = path.join(tmpDir('mc-pf-'), 'crm.db');
  const conn = new Database(file);
  conn.pragma('journal_mode = WAL');
  conn.exec(PEOPLE_FIRST_SCHEMA);
  conn.exec(`
    INSERT INTO icps (name) VALUES ('ICP');
    INSERT INTO prospects (linkedin_url, full_name, about) VALUES ('https://www.linkedin.com/in/uno', 'Uno', 'CTO');
    INSERT INTO prospects (linkedin_url, full_name, about) VALUES ('https://www.linkedin.com/in/due', 'Due', 'CEO');
    INSERT INTO analyses (prospect_id, icp_id, model, summary, angles, fit, input_hash) VALUES (1, 1, 'm', 's', '[]', 'alto', 'vecchio');
    INSERT INTO analyses (prospect_id, icp_id, model, summary, angles, fit, input_hash) VALUES (2, 1, 'm', 's', '[]', 'basso', 'vecchio');
    INSERT INTO settings (key, value) VALUES ('company_name', 'Officina'), ('company_description', 'Software'), ('company_offering', 'Consulenza');
    INSERT INTO jobs (kind, params, state, tools, logged) VALUES ('analyze', '{}', 'succeeded', '["anthropic"]', 1);
  `);
  const post = conn.prepare('INSERT INTO posts (post_url, text_excerpt) VALUES (?, ?)');
  LEGACY_POSTS.forEach((p, i) => post.run(`https://www.linkedin.com/posts/legacy-${i + 1}`, p.text_excerpt));
  post.run('https://www.linkedin.com/posts/senza-testo', null);
  conn.close();
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

  it('DB people-first-crm (own-profile-services T2): post dalla forma vera, nessun servizio, profilo come atteso da F6, un backup', async () => {
    const src = peopleFirstDb();
    const report = await checkMigration(src, { preflight: () => [] });

    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.migratedTables).toEqual(expect.arrayContaining(['jobs', 'analyses', 'posts']));
    for (const [table, n] of Object.entries(report.rowsBefore)) expect(report.rowsAfter[table]).toBe(n);
    expect(report.rowsAfter).toMatchObject({ services: 0, profile_field_origin: 0, profile_sources: 0, profile_proposals: 0 });
    // `jobs` si ricostruisce: strumenti e log dei run restano quelli di prima (nessun valore cambiato).
    expect(report.contentChanged).toEqual([]);
    // 500 e 450 con emoji troncati, 120 e il post senza testo integrali.
    expect(report.posts).toEqual({ complete: 2, truncated: 2, unknown: 0 });
    expect(report.backups).toBe(1);
    // Assunzione di F6 sul DB reale: azienda compilata, campi nuovi vuoti (solo sì/no, nessun valore).
    expect(report.profileSettings).toEqual({
      company_name: true,
      company_description: true,
      company_offering: true,
      website_url: false,
      positioning: false,
      proof_points: false,
      tone_of_voice: false,
    });
    // Analisi: "da aggiornare" prima e dopo il backfill dell'impronta (il reset una tantum di P-20, F6).
    expect(report.analyses).toEqual({ latest: 2, staleBefore: 2, backfilled: 2, subjectHashNull: 0, staleAfter: 0 });
    expect(report.fkViolations).toEqual([]);
    expect(report.sourceUnchanged).toBe(true);
    expect(report.tmpRemoved).toBe(true);
    expect(JSON.stringify(report)).not.toMatch(/Officina|Software|Consulenza|linkedin\.com/i);
  });

  it('"da aggiornare" si conta con lo stesso criterio della scheda (own-profile-services T2)', async () => {
    // DB costruito dall'app (il DB di questo processo di test): un'analisi coerente, una con la persona cambiata.
    const { db } = await import('../src/db/index.js');
    const { createIcp, getIcpContext } = await import('../src/db/icps.js');
    const { saveAnalysis } = await import('../src/db/analyses.js');
    const { analysisContext, analysisInput } = await import('../src/analysis/analyze.js');
    const icp = createIcp({ name: 'CTO startup' });
    const insert = db.prepare('INSERT INTO prospects (linkedin_url, full_name, about) VALUES (?, ?, ?)');
    const ids = [1, 2].map((n) => Number(insert.run(`https://www.linkedin.com/in/app-${n}`, `Persona ${n}`, 'CTO').lastInsertRowid));
    for (const id of ids) {
      const ctx = analysisContext(id, getIcpContext(icp.id)!)!;
      const output = { summary: 's', angles: [{ title: 't', rationale: 'r' }], fit: 'medio' as const, fit_reason: 'f' };
      const { inputHash, subjectHash } = analysisInput(ctx);
      saveAnalysis({ prospectId: id, icpId: icp.id, icpName: icp.name, model: 'm', output, inputHash, subjectHash });
    }
    db.prepare('UPDATE prospects SET about = ? WHERE id = ?').run('CTO e co-founder', ids[1]);
    db.pragma('wal_checkpoint(TRUNCATE)');

    const report = await checkMigration(process.env.DB_PATH!, { preflight: () => [] });
    expect(report.problems).toEqual([]);
    // Analisi fatte con l'impronta: nessun reset, il segnale della persona cambiata resta.
    expect(report.analyses).toEqual({ latest: 2, staleBefore: 1, backfilled: 0, subjectHashNull: 0, staleAfter: 1 });
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
