/**
 * Prova della migrazione su una **copia** di un DB reale (people-first-crm T2, grill G-5; estesa da
 * own-profile-services T2 a post, servizi, profilo e analisi "da aggiornare").
 *
 * Uso: `npm run db:migration-check -- data/crm.db`
 *
 * Isolamento dal DB reale (il rischio è migrare `data/crm.db` in posto):
 * - nessun import di `src/db/index.ts` né di moduli che lo importano: solo `better-sqlite3` e, con import
 *   dinamico dopo aver fissato `DB_PATH`, `src/db/schema.ts` (che importa solo `jobs/types`, `util/fields`,
 *   `util/process`). Le analisi "da aggiornare" le conta un processo figlio
 *   (`scripts/migration-check-analyses.ts`) con `DB_PATH` = la copia, che rifiuta ogni percorso fuori da
 *   `os.tmpdir()`;
 * - il sorgente non si apre mai con SQLite (anche un'apertura `readonly` di un DB in WAL crea `-wal`/`-shm`
 *   accanto al file): si copia byte per byte la coppia `<db>` + `<db>-wal` (mai `-shm`, mai il solo `.db`
 *   quando c'è un `-wal`: i dati del server stanno quasi tutti lì) e si apre solo la copia, in `os.tmpdir()`;
 * - preflight: rifiuta se un processo ha aperto il DB (`lsof`).
 *
 * Stampa un report di soli numeri (nessun nome, nessun dato personale) e cancella copia e backup.
 */
import Database from 'better-sqlite3';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AnalysesCheck } from './migration-check-analyses.js';
import { DATA_DIR, isInside, isScratchPath, REPO_ROOT } from './scratch-paths.js';

/**
 * `DB_PATH` sicuro prima di qualunque import del progetto: se quello ereditato punta fuori da `data/` e dal
 * repo lo tiene (il test passa la sua sentinella), altrimenti una sentinella in `os.tmpdir()`. Nessun modulo
 * importato qui apre `DB_PATH`: la sentinella serve a rendere visibile un import sbagliato, non a usarla.
 */
export function pinSafeDbPath(env: NodeJS.ProcessEnv = process.env): string {
  const inherited = env.DB_PATH;
  if (inherited && !isInside(inherited, DATA_DIR) && !isInside(inherited, REPO_ROOT)) return inherited;
  const sentinel = path.join(os.tmpdir(), `migration-check-sentinel-${process.pid}.db`);
  env.DB_PATH = sentinel;
  return sentinel;
}

/** Pid dei processi che hanno aperto uno dei file (vuoto = nessuno). Lancia se `lsof` non si può usare. */
export function openersOf(files: string[]): number[] {
  const existing = files.filter((f) => fs.existsSync(f));
  if (existing.length === 0) return [];
  try {
    const out = execFileSync('lsof', ['-t', '--', ...existing], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return [...new Set(out.split('\n').map((l) => Number.parseInt(l, 10)).filter(Number.isFinite))];
  } catch (err) {
    // `lsof` esce con 1 quando nessun processo ha aperto i file.
    if ((err as { status?: number }).status === 1) return [];
    throw new Error(`Impossibile verificare con lsof chi ha aperto il DB: ${(err as Error).message}`);
  }
}

type FileStat = { name: string; size: number; mtimeMs: number };

function statFiles(srcPath: string): FileStat[] {
  return [srcPath, `${srcPath}-wal`, `${srcPath}-shm`]
    .filter((f) => fs.existsSync(f))
    .map((f) => {
      const st = fs.statSync(f);
      return { name: path.basename(f), size: st.size, mtimeMs: st.mtimeMs };
    });
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function tableNames(conn: Database.Database): string[] {
  return conn
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .pluck()
    .all() as string[];
}

function rowCounts(conn: Database.Database): Record<string, number> {
  return Object.fromEntries(tableNames(conn).map((t) => [t, conn.prepare(`SELECT COUNT(*) FROM "${t}"`).pluck().get() as number]));
}

/**
 * Impronta del contenuto delle colonne `columns` di `table` (righe in JSON, ordinate): uguale prima e dopo = la
 * migrazione non ha cambiato nessun valore che c'era già (le ricostruzioni copiano, non riscrivono).
 */
function contentHash(conn: Database.Database, table: string, columns: string[]): string {
  const list = columns.map((c) => `"${c}"`).join(', ');
  const rows = (conn.prepare(`SELECT ${list} FROM "${table}"`).raw().all() as unknown[][]).map((r) => JSON.stringify(r)).sort();
  const hash = createHash('sha256');
  for (const row of rows) hash.update(row).update('\n');
  return hash.digest('hex');
}

function columnsOf(conn: Database.Database): Record<string, string[]> {
  return Object.fromEntries(
    tableNames(conn).map((t) => [t, (conn.pragma(`table_info("${t}")`) as Array<{ name: string }>).map((c) => c.name)]),
  );
}

/** Campi del profilo di cui la prova riporta solo se sono compilati (assunzione di own-profile-services F6). */
const PROFILE_KEYS = ['company_name', 'company_description', 'company_offering', 'website_url', 'positioning', 'proof_points', 'tone_of_voice'] as const;
type ProfileFilled = Record<(typeof PROFILE_KEYS)[number], boolean>;
type PostsCompleteness = { complete: number; truncated: number; unknown: number };

function profileSettings(conn: Database.Database): ProfileFilled {
  const value = conn.prepare('SELECT value FROM settings WHERE key = ?').pluck();
  const filled = (key: string) => {
    const v = value.get(key) as string | null | undefined;
    return typeof v === 'string' && v.trim() !== '';
  };
  return Object.fromEntries(PROFILE_KEYS.map((k) => [k, filled(k)])) as ProfileFilled;
}

/** Marcatore dei post dopo la migrazione (C6): integrali, solo estratto, non noti. */
function postsCompleteness(conn: Database.Database): PostsCompleteness {
  return conn
    .prepare(
      `SELECT COALESCE(SUM(text_complete = 1), 0) AS complete, COALESCE(SUM(text_complete = 0), 0) AS truncated,
              COALESCE(SUM(text_complete IS NULL), 0) AS unknown FROM posts`,
    )
    .get() as PostsCompleteness;
}

/**
 * Analisi "da aggiornare" sulla copia migrata, contate dal processo figlio con il codice della scheda.
 * Lancia con il messaggio del figlio se non riesce.
 */
function checkAnalyses(copy: string): AnalysesCheck {
  const run = spawnSync(process.execPath, ['--import', 'tsx', path.join(REPO_ROOT, 'scripts', 'migration-check-analyses.ts')], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, DB_PATH: copy, DOTENV_CONFIG_PATH: os.devNull, DOTENV_CONFIG_QUIET: 'true' },
  });
  if (run.status !== 0) throw new Error((run.stderr || `uscito con ${run.status}`).trim().split('\n').slice(-3).join(' '));
  return JSON.parse(run.stdout) as AnalysesCheck;
}

/** Persone visibili per azienda: prima = collegate o con una fonte su quell'azienda; dopo (D5) = solo collegate. */
function visibleByCompany(conn: Database.Database, linkedOnly: boolean): Map<number, number> {
  const sql = linkedOnly
    ? `SELECT company_id AS id, COUNT(*) AS n FROM prospects WHERE company_id IS NOT NULL GROUP BY company_id`
    : `SELECT c.id AS id, COUNT(DISTINCT p.id) AS n FROM companies c JOIN prospects p
         ON p.company_id = c.id OR EXISTS (SELECT 1 FROM sources s WHERE s.prospect_id = p.id AND s.company_id = c.id)
       GROUP BY c.id`;
  return new Map((conn.prepare(sql).all() as Array<{ id: number; n: number }>).map((r) => [r.id, r.n]));
}

export interface MigrationCheckReport {
  ok: boolean;
  /** Motivi per cui `ok` è falso (vuoto se tutto torna). */
  problems: string[];
  integrity: string;
  migratedTables: string[];
  rowsBefore: Record<string, number>;
  rowsAfter: Record<string, number>;
  /** Colonne che c'erano prima e mancano dopo, come `tabella.colonna`. */
  missingColumns: string[];
  /** Tabelle in cui un valore delle colonne che c'erano già è cambiato (deve essere vuoto). */
  contentChanged: string[];
  /** Persone "Inbox" prima (senza liste, non scartate) e "Da smistare" dopo (in più: senza fonte manuale). */
  inboxBefore: number;
  toTriageAfter: number;
  /** Aziende la cui sezione Persone si accorcia con D5 (persone trovate lì ma non collegate). */
  companiesShrunk: number;
  personsHiddenFromCompanies: number;
  emptyLinkedinUrls: number;
  fkViolations: string[];
  secondRunNoop: boolean;
  /** Copie di sicurezza fatte dalla migrazione sulla copia (deve essere una). */
  backups: number;
  /** Post dopo la migrazione per marcatore di C6 (own-profile-services). */
  posts: PostsCompleteness;
  /** Campi del profilo compilati (solo sì/no): l'assunzione di own-profile-services F6. */
  profileSettings: ProfileFilled;
  /**
   * Analisi "da aggiornare" prima (criterio di prima del rilascio) e dopo il backfill dell'impronta della persona
   * (criterio della scheda), più le righe riempite e quelle rimaste vuote (`null` se è fallito: vedi `problems`).
   */
  analyses: AnalysesCheck | null;
  sourceUnchanged: boolean;
  sourceFiles: { before: FileStat[]; after: FileStat[] };
  tmpRemoved: boolean;
}

export interface CheckOptions {
  /** Cartella temporanea (default: una nuova in `os.tmpdir()`); rifiutata se dentro `data/` o dentro il repo. */
  tmpDir?: string;
  /** Pid dei processi con il DB aperto (default `openersOf`, iniettabile nei test). */
  preflight?: (files: string[]) => number[];
}

/**
 * Copia `<srcPath>` (+ `-wal`) in una cartella temporanea, migra la copia e confronta prima/dopo. Lancia (senza
 * toccare nulla) se un processo ha aperto il sorgente, se `tmpDir` non è sicura o se nella copia c'è un job vivo.
 */
export async function checkMigration(srcPath: string, options: CheckOptions = {}): Promise<MigrationCheckReport> {
  const src = path.resolve(srcPath);
  if (!fs.existsSync(src)) throw new Error(`File non trovato: ${src}`);
  const openers = (options.preflight ?? openersOf)([src, `${src}-wal`]);
  if (openers.length > 0) {
    throw new Error(`Rifiutato: il DB è aperto da ${openers.length} processo/i (pid ${openers.join(', ')}). Ferma il server e riprova.`);
  }

  const tmp = options.tmpDir ? path.resolve(options.tmpDir) : fs.mkdtempSync(path.join(os.tmpdir(), 'migration-check-'));
  if (!isScratchPath(tmp)) {
    throw new Error(`Rifiutato: la cartella temporanea deve stare in ${os.tmpdir()}, fuori da data/ e dal repo.`);
  }
  fs.mkdirSync(tmp, { recursive: true });

  const sourceBefore = statFiles(src);
  const copy = path.join(tmp, 'copy.db');
  fs.copyFileSync(src, copy);
  if (fs.existsSync(`${src}-wal`)) fs.copyFileSync(`${src}-wal`, `${copy}-wal`);

  const problems: string[] = [];
  let report: Omit<MigrationCheckReport, 'ok' | 'problems' | 'sourceUnchanged' | 'sourceFiles' | 'tmpRemoved'>;
  const conn = new Database(copy);
  try {
    const integrity = conn.pragma('integrity_check', { simple: true }) as string;
    if (integrity !== 'ok') problems.push(`integrity_check: ${integrity}`);
    if (tableNames(conn).includes('jobs')) {
      const running = conn.prepare(`SELECT id, pid FROM jobs WHERE state = 'running' AND pid IS NOT NULL`).all() as Array<{ id: number; pid: number }>;
      const alive = running.find((j) => isAlive(j.pid));
      if (alive) throw new Error(`Rifiutato: il job #${alive.id} risulta in corso con un processo vivo (pid ${alive.pid}).`);
    }

    const rowsBefore = rowCounts(conn);
    const columnsBefore = columnsOf(conn);
    const contentBefore = Object.fromEntries(Object.entries(columnsBefore).map(([t, cols]) => [t, contentHash(conn, t, cols)]));
    const inboxBefore = conn
      .prepare(`SELECT COUNT(*) FROM prospects p WHERE p.status <> 'scartato' AND NOT EXISTS (SELECT 1 FROM list_members m WHERE m.prospect_id = p.id)`)
      .pluck()
      .get() as number;
    const emptyLinkedinUrls = conn.prepare(`SELECT COUNT(*) FROM prospects WHERE TRIM(linkedin_url) = ''`).pluck().get() as number;
    const visibleBefore = visibleByCompany(conn, false);

    const { applySchema, migrateSchema, resetBackupState } = await import('../src/db/schema.js');
    const log = console.log;
    console.log = () => {}; // il messaggio della migrazione contiene il percorso della copia: il report basta
    let migratedTables: string[] = [];
    let secondRunNoop = false;
    try {
      conn.pragma('foreign_keys = ON');
      migratedTables = migrateSchema(conn, copy).tables;
      applySchema(conn);
      resetBackupState();
      secondRunNoop = migrateSchema(conn, copy).migrated === false;
    } finally {
      console.log = log;
    }
    // Il figlio lavora sulla copia già migrata; i conteggi "dopo" si leggono quando ha finito.
    const backups = fs.readdirSync(tmp).filter((f) => f.startsWith(`${path.basename(copy)}.bak-`)).length;
    let analyses: AnalysesCheck | null = null;
    try {
      analyses = checkAnalyses(copy);
    } catch (err) {
      problems.push(`conteggio delle analisi fallito: ${(err as Error).message}`);
    }

    const rowsAfter = rowCounts(conn);
    const columnsAfter = columnsOf(conn);
    const missingColumns = Object.entries(columnsBefore).flatMap(([t, cols]) =>
      cols.filter((c) => !(columnsAfter[t] ?? []).includes(c)).map((c) => `${t}.${c}`),
    );
    const contentChanged = Object.entries(columnsBefore)
      .filter(([t, cols]) => cols.every((c) => (columnsAfter[t] ?? []).includes(c)) && contentHash(conn, t, cols) !== contentBefore[t])
      .map(([t]) => t);
    const toTriageAfter = conn
      .prepare(
        `SELECT COUNT(*) FROM prospects p WHERE p.status <> 'scartato'
           AND NOT EXISTS (SELECT 1 FROM list_members m WHERE m.prospect_id = p.id)
           AND NOT EXISTS (SELECT 1 FROM sources s WHERE s.prospect_id = p.id AND s.kind = 'manual')`,
      )
      .pluck()
      .get() as number;
    const visibleAfter = visibleByCompany(conn, true);
    let companiesShrunk = 0;
    let personsHiddenFromCompanies = 0;
    for (const [id, n] of visibleBefore) {
      const after = visibleAfter.get(id) ?? 0;
      if (after < n) {
        companiesShrunk += 1;
        personsHiddenFromCompanies += n - after;
      }
    }
    const posts = postsCompleteness(conn);
    const settingsAfter = profileSettings(conn);
    const fkViolations = (conn.pragma('foreign_key_check') as Array<{ table: string; parent: string }>).map((v) => `${v.table} → ${v.parent}`);

    for (const [t, n] of Object.entries(rowsBefore)) {
      if (rowsAfter[t] !== n) problems.push(`righe di ${t}: ${n} prima, ${rowsAfter[t] ?? 'tabella assente'} dopo`);
    }
    if (missingColumns.length > 0) problems.push(`colonne perse: ${missingColumns.length}`);
    if (contentChanged.length > 0) problems.push(`valori cambiati in: ${contentChanged.join(', ')}`);
    if (fkViolations.length > 0) problems.push(`violazioni di chiave esterna: ${fkViolations.length}`);
    if (emptyLinkedinUrls > 0) problems.push(`persone con URL LinkedIn vuoto: ${emptyLinkedinUrls}`);
    if (!secondRunNoop) problems.push('la seconda migrazione non è un no-op');
    if (migratedTables.length > 0 && backups !== 1) problems.push(`copie di sicurezza: ${backups} invece di una`);
    if (analyses && analyses.subjectHashNull > 0) problems.push(`analisi senza impronta della persona dopo il backfill: ${analyses.subjectHashNull}`);
    if (inboxBefore !== toTriageAfter) problems.push(`Inbox prima (${inboxBefore}) ≠ Da smistare dopo (${toTriageAfter})`);

    report = {
      integrity,
      migratedTables,
      rowsBefore,
      rowsAfter,
      missingColumns,
      contentChanged,
      inboxBefore,
      toTriageAfter,
      companiesShrunk,
      personsHiddenFromCompanies,
      emptyLinkedinUrls,
      fkViolations,
      secondRunNoop,
      backups,
      posts,
      profileSettings: settingsAfter,
      analyses,
    };
  } finally {
    conn.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  const sourceAfter = statFiles(src);
  const sameFile = (name: string) => {
    const b = sourceBefore.find((f) => f.name === name);
    const a = sourceAfter.find((f) => f.name === name);
    return (b === undefined && a === undefined) || (b !== undefined && a !== undefined && b.size === a.size && b.mtimeMs === a.mtimeMs);
  };
  const base = path.basename(src);
  const sameSet = sourceBefore.map((f) => f.name).join() === sourceAfter.map((f) => f.name).join();
  const sourceUnchanged = sameSet && sameFile(base) && sameFile(`${base}-wal`);
  if (!sourceUnchanged) problems.push('i file del DB sorgente sono cambiati');
  const tmpRemoved = !fs.existsSync(tmp);
  if (!tmpRemoved) problems.push('la cartella temporanea non è stata rimossa');

  return { ok: problems.length === 0, problems, ...report, sourceUnchanged, sourceFiles: { before: sourceBefore, after: sourceAfter }, tmpRemoved };
}

async function main(): Promise<void> {
  pinSafeDbPath();
  const srcArg = process.argv[2];
  if (!srcArg) {
    console.error('Uso: npm run db:migration-check -- <percorso del DB>');
    process.exitCode = 2;
    return;
  }
  const src = path.resolve(srcArg);
  // Preflight disattivabile solo per un sorgente in os.tmpdir() (i test lo lanciano mentre altri processi girano).
  const noPreflight = process.env.MIGRATION_CHECK_NO_PREFLIGHT === '1' && isInside(src, os.tmpdir());
  try {
    const report = await checkMigration(src, noPreflight ? { preflight: () => [] } : {});
    console.log(JSON.stringify(report, null, 2));
    console.log(report.ok ? 'Esito: OK' : `Esito: DA VERIFICARE (${report.problems.join('; ')})`);
    process.exitCode = report.ok ? 0 : 1;
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
