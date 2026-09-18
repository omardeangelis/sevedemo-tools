import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

/** Schema di crm-foundation (prima di apollo-lookalike): `companies.linkedin_url NOT NULL`. */
const OLD_SCHEMA = fs.readFileSync(new URL('./fixtures/schema-crm-foundation.sql', import.meta.url), 'utf8');

// Avvio su un DB esistente con lo schema vecchio (apollo-lookalike T4a): il file di DB_PATH viene
// creato qui con 3 aziende PRIMA che `src/db/index.ts` lo apra, così l'import percorre la
// migrazione reale di `applySchema`.
const oldDbPath = process.env.DB_PATH!;
{
  const old = new Database(oldDbPath);
  old.pragma('journal_mode = WAL');
  old.pragma('foreign_keys = ON');
  old.exec(OLD_SCHEMA);
  const insert = old.prepare('INSERT INTO companies (linkedin_url, name, website) VALUES (?, ?, ?)');
  insert.run('https://www.linkedin.com/company/acme', 'Acme', 'https://www.Acme.it/chi-siamo');
  insert.run('https://www.linkedin.com/company/gamma', 'Gamma', 'gamma.com');
  insert.run('https://www.linkedin.com/company/delta', 'Delta', 'https://www.facebook.com/delta');
  old.close();
}

// Schema `crm.db` (crm-foundation T3, PLAN §6). Import dinamico: la config
// (DB_PATH isolato da tests/setup.ts) è letta a import-time.
const { db } = await import('../src/db/index.js');
const { applySchema, backupDatabase, COMPANIES_INDEXES, COMPANIES_TABLE, migrateSchema, planSchemaMigration, rebuildTable, resetBackupState } =
  await import('../src/db/schema.js');
const { JOB_KINDS } = await import('../src/jobs/types.js');

const TABLES = [
  'activities',
  'analyses',
  'companies',
  'exports',
  'icp_company_candidates',
  'icp_reference_companies',
  'icps',
  'jobs',
  'list_members',
  'lists',
  'posts',
  'prospects',
  'settings',
  'sources',
];

/** DDL salvata di una tabella (`sqlite_master.sql`). */
function tableSql(conn: Database.Database, table: string): string | undefined {
  return conn.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`).pluck().get(table) as string | undefined;
}
function hasTableIn(conn: Database.Database, table: string): boolean {
  return tableSql(conn, table) !== undefined;
}

let seq = 0;
function insertProspect(status = 'nuovo'): number {
  seq += 1;
  return Number(
    db
      .prepare('INSERT INTO prospects (linkedin_url, full_name, status) VALUES (?, ?, ?)')
      .run(`https://www.linkedin.com/in/test-${seq}`, `Persona ${seq}`, status).lastInsertRowid,
  );
}

function insertPost(): number {
  seq += 1;
  return Number(
    db.prepare('INSERT INTO posts (post_url) VALUES (?)').run(`https://www.linkedin.com/posts/p-${seq}`).lastInsertRowid,
  );
}

function insertCompany(): number {
  seq += 1;
  return Number(
    db
      .prepare('INSERT INTO companies (linkedin_url, name) VALUES (?, ?)')
      .run(`https://www.linkedin.com/company/c-${seq}`, `Azienda ${seq}`).lastInsertRowid,
  );
}

function insertIcp(): number {
  return Number(db.prepare(`INSERT INTO icps (name) VALUES ('ICP test')`).run().lastInsertRowid);
}

describe('schema crm.db', () => {
  it('contiene esattamente le 14 tabelle del modello dati', () => {
    // `sqlite_sequence` è interna di SQLite (creata da AUTOINCREMENT): esclusa.
    const rows = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
      .all() as Array<{ name: string }>;
    expect(rows.map((r) => r.name)).toEqual(TABLES);
  });

  it('riapplicare lo schema è idempotente', () => {
    expect(() => applySchema(db)).not.toThrow();
  });

  it('i vincoli di chiave esterna sono attivi', () => {
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(() =>
      db.prepare(`INSERT INTO lists (icp_id, name) VALUES (999999, 'orfana')`).run(),
    ).toThrow(expect.objectContaining({ code: 'SQLITE_CONSTRAINT_FOREIGNKEY' }));
  });

  it('prospects: nuovo di default, uno stato fuori dai 9 viola il CHECK', () => {
    const id = insertProspect();
    expect(db.prepare('SELECT status FROM prospects WHERE id = ?').pluck().get(id)).toBe('nuovo');
    expect(() => insertProspect('selected')).toThrow(expect.objectContaining({ code: 'SQLITE_CONSTRAINT_CHECK' }));
  });

  it('prospects: linkedin_url è unico', () => {
    db.prepare(`INSERT INTO prospects (linkedin_url) VALUES ('https://www.linkedin.com/in/doppio')`).run();
    expect(() =>
      db.prepare(`INSERT INTO prospects (linkedin_url) VALUES ('https://www.linkedin.com/in/doppio')`).run(),
    ).toThrow(expect.objectContaining({ code: 'SQLITE_CONSTRAINT_UNIQUE' }));
  });

  it('prospects: member_urn è unico se presente, più righe senza id membro sono ammesse', () => {
    const insert = db.prepare('INSERT INTO prospects (linkedin_url, member_urn) VALUES (?, ?)');
    insert.run('https://www.linkedin.com/in/con-id', 'ACoAAFakeSchema0001AbCdEfGh');
    expect(() => insert.run('https://www.linkedin.com/in/stesso-id', 'ACoAAFakeSchema0001AbCdEfGh')).toThrow(
      expect.objectContaining({ code: 'SQLITE_CONSTRAINT_UNIQUE' }),
    );
    expect(() => {
      insert.run('https://www.linkedin.com/in/senza-id-1', null);
      insert.run('https://www.linkedin.com/in/senza-id-2', null);
    }).not.toThrow();
  });

  it('sources: la stessa (prospect, kind, post) non si duplica', () => {
    const prospectId = insertProspect();
    const postId = insertPost();
    const insert = db.prepare(`INSERT INTO sources (prospect_id, kind, post_id, reaction_type) VALUES (?, 'post_reaction', ?, 'LIKE')`);
    insert.run(prospectId, postId);
    expect(() => insert.run(prospectId, postId)).toThrow(expect.objectContaining({ code: 'SQLITE_CONSTRAINT_UNIQUE' }));
    // Stessa persona e stesso post ma kind diverso (commento): è un'altra fonte.
    expect(() =>
      db.prepare(`INSERT INTO sources (prospect_id, kind, post_id) VALUES (?, 'post_comment', ?)`).run(prospectId, postId),
    ).not.toThrow();
  });

  it('sources: unicità anche per azienda e per la fonte manuale', () => {
    const prospectId = insertProspect();
    const companyId = insertCompany();
    const byCompany = db.prepare(`INSERT INTO sources (prospect_id, kind, company_id) VALUES (?, 'company_employees', ?)`);
    byCompany.run(prospectId, companyId);
    expect(() => byCompany.run(prospectId, companyId)).toThrow(expect.objectContaining({ code: 'SQLITE_CONSTRAINT_UNIQUE' }));

    const manual = db.prepare(`INSERT INTO sources (prospect_id, kind) VALUES (?, 'manual')`);
    manual.run(prospectId);
    expect(() => manual.run(prospectId)).toThrow(expect.objectContaining({ code: 'SQLITE_CONSTRAINT_UNIQUE' }));
  });

  it('sources: una fonte da post senza post viola il CHECK', () => {
    const prospectId = insertProspect();
    expect(() =>
      db.prepare(`INSERT INTO sources (prospect_id, kind) VALUES (?, 'post_reaction')`).run(prospectId),
    ).toThrow(expect.objectContaining({ code: 'SQLITE_CONSTRAINT_CHECK' }));
  });

  it('un ICP con liste non si cancella; cancellare un prospect rimuove i suoi figli', () => {
    const icpId = insertIcp();
    const listId = Number(db.prepare(`INSERT INTO lists (icp_id, name) VALUES (?, 'Lista')`).run(icpId).lastInsertRowid);
    // ON DELETE RESTRICT: SQLite la segnala con code `SQLITE_CONSTRAINT_TRIGGER`, non `_FOREIGNKEY`.
    expect(() => db.prepare('DELETE FROM icps WHERE id = ?').run(icpId)).toThrow('FOREIGN KEY constraint failed');

    const prospectId = insertProspect();
    db.prepare('INSERT INTO list_members (list_id, prospect_id) VALUES (?, ?)').run(listId, prospectId);
    db.prepare(`INSERT INTO sources (prospect_id, kind) VALUES (?, 'manual')`).run(prospectId);
    db.prepare(`INSERT INTO activities (prospect_id, list_id, kind, body) VALUES (?, ?, 'note', 'ciao')`).run(prospectId, listId);
    db.prepare('DELETE FROM prospects WHERE id = ?').run(prospectId);
    for (const table of ['list_members', 'sources', 'activities']) {
      expect(db.prepare(`SELECT COUNT(*) FROM ${table} WHERE prospect_id = ?`).pluck().get(prospectId)).toBe(0);
    }
  });

  it('jobs: kind e state fuori enum violano il CHECK; i timestamp di default sono ISO', () => {
    expect(() => db.prepare(`INSERT INTO jobs (kind) VALUES ('daily_run')`).run()).toThrow(
      expect.objectContaining({ code: 'SQLITE_CONSTRAINT_CHECK' }),
    );
    const id = db.prepare(`INSERT INTO jobs (kind, params) VALUES ('enrich', '{"prospectIds":[1]}')`).run().lastInsertRowid;
    const row = db.prepare('SELECT state, created_at FROM jobs WHERE id = ?').get(id) as { state: string; created_at: string };
    expect(row.state).toBe('running');
    expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(() => db.prepare(`UPDATE jobs SET state = 'done' WHERE id = ?`).run(id)).toThrow(
      expect.objectContaining({ code: 'SQLITE_CONSTRAINT_CHECK' }),
    );
  });
});

describe('schema apollo-lookalike T5: candidate, fonti apollo_people, job Apollo, colonne Apollo dei prospect', () => {
  const candidate = db.prepare(
    'INSERT INTO icp_company_candidates (icp_id, company_id, status, score_parts, reasons) VALUES (?, ?, ?, ?, ?)',
  );

  it('icp_company_candidates: default proposta/v1/{}; stato fuori enum e JSON non valido violano i CHECK; PK (icp, azienda)', () => {
    const icpId = insertIcp();
    const companyId = insertCompany();
    db.prepare('INSERT INTO icp_company_candidates (icp_id, company_id) VALUES (?, ?)').run(icpId, companyId);
    expect(db.prepare('SELECT * FROM icp_company_candidates WHERE icp_id = ?').get(icpId)).toMatchObject({
      status: 'proposta',
      score: 0,
      reasons: '[]',
      score_parts: '{}',
      scoring_version: 'v1',
      job_id: null,
      decided_at: null,
      created_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    });
    expect(() => db.prepare('INSERT INTO icp_company_candidates (icp_id, company_id) VALUES (?, ?)').run(icpId, companyId)).toThrow(
      expect.objectContaining({ code: 'SQLITE_CONSTRAINT_PRIMARYKEY' }),
    );
    const other = insertCompany();
    expect(() => candidate.run(icpId, other, 'decisa', '{}', '[]')).toThrow(expect.objectContaining({ code: 'SQLITE_CONSTRAINT_CHECK' }));
    expect(() => candidate.run(icpId, other, 'proposta', 'non json', '[]')).toThrow(expect.objectContaining({ code: 'SQLITE_CONSTRAINT_CHECK' }));
    expect(() => candidate.run(icpId, other, 'proposta', '{}', '[rotto')).toThrow(expect.objectContaining({ code: 'SQLITE_CONSTRAINT_CHECK' }));
    expect(() => candidate.run(icpId, 999_999, 'proposta', '{}', '[]')).toThrow(expect.objectContaining({ code: 'SQLITE_CONSTRAINT_FOREIGNKEY' }));
    const indexes = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'icp_company_candidates' AND sql IS NOT NULL ORDER BY name`).pluck().all();
    expect(indexes).toEqual(['idx_candidates_company', 'idx_candidates_job']);
  });

  it('i tre kind Apollo sono inseribili in jobs', () => {
    expect(JOB_KINDS).toEqual(expect.arrayContaining(['enrich_companies', 'lookalike_companies', 'apollo_people']));
    for (const kind of JOB_KINDS) {
      expect(() => db.prepare(`INSERT INTO jobs (kind) VALUES (?)`).run(kind)).not.toThrow();
    }
  });

  it('sources apollo_people: richiede company_id, stessa unicità di company_employees', () => {
    const prospectId = insertProspect();
    expect(() => db.prepare(`INSERT INTO sources (prospect_id, kind) VALUES (?, 'apollo_people')`).run(prospectId)).toThrow(
      expect.objectContaining({ code: 'SQLITE_CONSTRAINT_CHECK' }),
    );
    expect(() => db.prepare(`INSERT INTO sources (prospect_id, kind) VALUES (?, 'company_employees')`).run(prospectId)).toThrow(
      expect.objectContaining({ code: 'SQLITE_CONSTRAINT_CHECK' }),
    );
    const companyId = insertCompany();
    const insert = db.prepare(`INSERT INTO sources (prospect_id, kind, company_id) VALUES (?, ?, ?)`);
    insert.run(prospectId, 'apollo_people', companyId);
    expect(() => insert.run(prospectId, 'apollo_people', companyId)).toThrow(expect.objectContaining({ code: 'SQLITE_CONSTRAINT_UNIQUE' }));
    expect(() => insert.run(prospectId, 'company_employees', companyId)).not.toThrow();
  });

  it('prospects: apollo_person_id unico se presente, apollo_matched_at libera', () => {
    const insert = db.prepare('INSERT INTO prospects (linkedin_url, apollo_person_id, apollo_matched_at) VALUES (?, ?, ?)');
    insert.run('https://www.linkedin.com/in/apollo-1', 'apollo-person-1', '2026-09-17T10:00:00.000Z');
    expect(() => insert.run('https://www.linkedin.com/in/apollo-2', 'apollo-person-1', null)).toThrow(
      expect.objectContaining({ code: 'SQLITE_CONSTRAINT_UNIQUE' }),
    );
    expect(() => {
      insert.run('https://www.linkedin.com/in/apollo-3', null, null);
      insert.run('https://www.linkedin.com/in/apollo-4', null, null);
    }).not.toThrow();
  });

  it('eliminare un ICP elimina le sue candidate (le liste restano RESTRICT)', () => {
    const icpId = insertIcp();
    candidate.run(icpId, insertCompany(), 'accettata', '{}', '[]');
    db.prepare('DELETE FROM icps WHERE id = ?').run(icpId);
    expect(db.prepare('SELECT COUNT(*) FROM icp_company_candidates WHERE icp_id = ?').pluck().get(icpId)).toBe(0);
  });

  it('sul DB già aggiornato non c\'è nulla da migrare', () => {
    expect(planSchemaMigration(db)).toEqual({ companies: false, sources: false, jobs: false, prospectsColumns: [] });
  });
});

describe('migrazione companies a doppia chiave all\'avvio (apollo-lookalike T4a)', () => {
  it('il DB vecchio con 3 aziende ottiene il dominio dal sito, un backup, e accetta aziende senza URL', async () => {
    const rows = db.prepare('SELECT id, name, linkedin_url, domain FROM companies WHERE name IN (?, ?, ?) ORDER BY id').all(
      'Acme',
      'Gamma',
      'Delta',
    ) as Array<{ name: string; linkedin_url: string; domain: string | null }>;
    expect(rows.map((r) => [r.name, r.domain])).toEqual([
      ['Acme', 'acme.it'],
      ['Gamma', 'gamma.com'],
      ['Delta', null],
    ]);
    const dir = path.dirname(oldDbPath);
    const backups = fs.readdirSync(dir).filter((f) => f.startsWith(`${path.basename(oldDbPath)}.bak-`));
    expect(backups).toHaveLength(1);

    const { createCompany } = await import('../src/db/companies.js');
    const beta = createCompany({ website: 'beta.io' });
    expect(beta).toMatchObject({ domain: 'beta.io', name: 'beta.io', linkedin_url: null });
    // T5 nella stessa migrazione (e nello stesso backup): fonti, job e prospect aggiornati.
    expect(tableSql(db, 'sources')).toContain("'apollo_people'");
    expect(tableSql(db, 'jobs')).toContain("'lookalike_companies'");
  });
});

describe('migrazione di companies a doppia chiave su DB temporanei con lo schema vecchio', () => {
  /** DB nuovo in una cartella propria (accanto al DB del test), schema vecchio, WAL come il server. */
  function oldSchemaDb(seed: (old: Database.Database) => void) {
    const dir = fs.mkdtempSync(path.join(path.dirname(oldDbPath), 'migr-'));
    const file = path.join(dir, 'crm.db');
    const old = new Database(file);
    old.pragma('journal_mode = WAL');
    old.pragma('foreign_keys = ON');
    old.exec(OLD_SCHEMA);
    seed(old);
    return { dir, file, old };
  }

  const backupsIn = (dir: string) => fs.readdirSync(dir).filter((f) => f.startsWith('crm.db.bak-')).sort();
  const notNull = (conn: Database.Database, column: string) =>
    (conn.pragma('table_info(companies)') as Array<{ name: string; notnull: number }>).find((c) => c.name === column)?.notnull;
  const count = (conn: Database.Database, table: string) => conn.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get();

  function seedRelations(old: Database.Database) {
    const icp = old.prepare(`INSERT INTO icps (name) VALUES ('ICP')`).run().lastInsertRowid;
    const company = old.prepare('INSERT INTO companies (linkedin_url, name, website, notes) VALUES (?, ?, ?, ?)');
    company.run('https://www.linkedin.com/company/acme', 'Acme', 'https://www.acme.it/', 'cliente storico');
    company.run('https://www.linkedin.com/company/beta', 'Beta', 'non è un sito', null);
    company.run('https://www.linkedin.com/company/gamma', 'Gamma', null, null);
    company.run('https://www.linkedin.com/company/temp', 'Temp', null, null);
    old.prepare('DELETE FROM companies WHERE id = 4').run(); // contatore AUTOINCREMENT a 4
    old.prepare(`INSERT INTO icp_reference_companies (icp_id, company_id, outcome) VALUES (?, 1, 'vinta'), (?, 2, 'persa')`).run(icp, icp);
    const prospect = old.prepare('INSERT INTO prospects (linkedin_url, company_id) VALUES (?, ?)');
    const p1 = prospect.run('https://www.linkedin.com/in/uno', 1).lastInsertRowid;
    const p2 = prospect.run('https://www.linkedin.com/in/due', 3).lastInsertRowid;
    old.prepare(`INSERT INTO sources (prospect_id, kind, company_id) VALUES (?, 'company_employees', 1), (?, 'company_employees', 3)`).run(p1, p2);
    // Job "in corso" di un processo morto: non blocca la migrazione.
    old.prepare(`INSERT INTO jobs (kind, state, pid) VALUES ('enrich', 'running', 2147483646)`).run();
  }

  it('ricostruisce companies: colonne nuove, righe e relazioni intatte, FK valide, backup consistente e leggibile', () => {
    const { dir, file, old } = oldSchemaDb(seedRelations);
    const tables = ['companies', 'icp_reference_companies', 'prospects', 'sources', 'jobs'];
    const before = Object.fromEntries(tables.map((t) => [t, count(old, t)]));
    const original = old.prepare('SELECT id, linkedin_url, name, website, notes, created_at, updated_at FROM companies ORDER BY id').all();
    // Le scritture sono ancora nel WAL: la copia deve includerle (SPEC B10).
    expect(fs.statSync(`${file}-wal`).size).toBeGreaterThan(0);

    applySchema(old);

    const columns = (old.pragma('table_info(companies)') as Array<{ name: string }>).map((c) => c.name);
    expect(columns).toEqual(expect.arrayContaining(['domain', 'apollo_org_id', 'apollo_json', 'apollo_enriched_at']));
    expect(notNull(old, 'linkedin_url')).toBe(0);
    expect(Object.fromEntries(tables.map((t) => [t, count(old, t)]))).toEqual(before);
    expect(old.prepare('SELECT id, linkedin_url, name, website, notes, created_at, updated_at FROM companies ORDER BY id').all()).toEqual(original);
    expect(old.prepare('SELECT id, domain FROM companies ORDER BY id').all()).toEqual([
      { id: 1, domain: 'acme.it' },
      { id: 2, domain: null },
      { id: 3, domain: null },
    ]);
    expect(old.pragma('foreign_key_check')).toEqual([]);
    expect(old.pragma('foreign_keys', { simple: true })).toBe(1);
    const indexes = old.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'companies' AND sql IS NOT NULL ORDER BY name`).pluck().all();
    expect(indexes).toEqual(['ux_companies_apollo', 'ux_companies_domain', 'ux_companies_linkedin']);

    // Le FK delle altre tabelle puntano alla tabella nuova (sources è RESTRICT).
    expect(() => old.prepare('DELETE FROM companies WHERE id = 1').run()).toThrow('FOREIGN KEY constraint failed');
    // Gli id cancellati non si riusano; "almeno una chiave" e JSON Apollo valido sono vincoli del DB.
    expect(old.prepare(`INSERT INTO companies (domain) VALUES ('nuova.io')`).run().lastInsertRowid).toBe(5);
    expect(() => old.prepare(`INSERT INTO companies (name) VALUES ('senza chiavi')`).run()).toThrow(
      expect.objectContaining({ code: 'SQLITE_CONSTRAINT_CHECK' }),
    );
    expect(() => old.prepare(`INSERT INTO companies (domain, apollo_json) VALUES ('x.io', 'non json')`).run()).toThrow(
      expect.objectContaining({ code: 'SQLITE_CONSTRAINT_CHECK' }),
    );
    expect(() => old.prepare(`INSERT INTO companies (domain) VALUES ('acme.it')`).run()).toThrow(
      expect.objectContaining({ code: 'SQLITE_CONSTRAINT_UNIQUE' }),
    );

    const backups = backupsIn(dir);
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/^crm\.db\.bak-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/);
    const copy = new Database(path.join(dir, backups[0]), { readonly: true });
    expect(count(copy, 'companies')).toBe(3);
    expect(count(copy, 'sources')).toBe(2);
    expect(notNull(copy, 'linkedin_url')).toBe(1);
    copy.close();
    old.close();
  });

  it('è idempotente: la seconda applySchema non fa un nuovo backup né modifiche', () => {
    const { dir, old } = oldSchemaDb(seedRelations);
    applySchema(old);
    const after = old.prepare('SELECT * FROM companies ORDER BY id').all();
    resetBackupState(); // anche dimenticando il backup già fatto, lo schema nuovo non migra

    applySchema(old);
    expect(migrateSchema(old, old.name)).toEqual({ migrated: false, tables: [] });
    expect(backupsIn(dir)).toHaveLength(1);
    expect(old.prepare('SELECT * FROM companies ORDER BY id').all()).toEqual(after);
    old.close();
  });

  it('collisione di dominio: lo tiene l\'id minore, le altre restano senza con una riga di log', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { old } = oldSchemaDb((o) => {
        const insert = o.prepare('INSERT INTO companies (linkedin_url, website) VALUES (?, ?)');
        insert.run('https://www.linkedin.com/company/acme', 'https://acme.it');
        insert.run('https://www.linkedin.com/company/acme-italia', 'www.ACME.it/contatti');
        insert.run('https://www.linkedin.com/company/acme-shop', 'https://shop.acme.it');
      });
      const result = migrateSchema(old, old.name);
      expect(result).toMatchObject({ migrated: true, domainsAssigned: 2, collisions: [{ domain: 'acme.it', keptId: 1, skippedId: 2 }] });
      expect(old.prepare('SELECT domain FROM companies ORDER BY id').pluck().all()).toEqual(['acme.it', null, 'shop.acme.it']);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toEqual(expect.stringMatching(/acme\.it.*#1.*#2/));
      old.close();
    } finally {
      warn.mockRestore();
    }
  });

  it('un job in corso con processo vivo blocca la migrazione: nessun backup, DB invariato', () => {
    const { dir, old } = oldSchemaDb((o) => {
      seedRelations(o);
      o.prepare(`INSERT INTO jobs (kind, state, pid) VALUES ('analyze', 'running', ?)`).run(process.pid);
    });
    const before = old.prepare('SELECT * FROM companies ORDER BY id').all();

    const ddlBefore = old.prepare(`SELECT name, sql FROM sqlite_master ORDER BY name`).all();
    expect(() => applySchema(old)).toThrow(/job #\d+ è ancora in esecuzione \(pid \d+\)/);
    expect(old.prepare(`SELECT name, sql FROM sqlite_master ORDER BY name`).all()).toEqual(ddlBefore);
    expect(notNull(old, 'linkedin_url')).toBe(1);
    expect(old.prepare('SELECT * FROM companies ORDER BY id').all()).toEqual(before);
    expect(backupsIn(dir)).toEqual([]);
    old.close();
  });

  it('tutto o niente: un errore durante la ricostruzione lascia il DB originale e indica la copia', () => {
    const { dir, old } = oldSchemaDb((o) => {
      seedRelations(o);
      // Una vista sulla tabella fa fallire la rinomina a metà procedura.
      o.exec('CREATE VIEW v_companies AS SELECT id, linkedin_url FROM companies');
    });
    const before = old.prepare('SELECT * FROM companies ORDER BY id').all();

    let message = '';
    try {
      migrateSchema(old, old.name);
    } catch (err) {
      message = (err as Error).message;
    }
    const backups = backupsIn(dir);
    expect(backups).toHaveLength(1);
    expect(message).toContain('Il database originale è intatto');
    expect(message).toContain(path.join(dir, backups[0]));
    expect(notNull(old, 'linkedin_url')).toBe(1);
    expect(old.prepare('SELECT * FROM companies ORDER BY id').all()).toEqual(before);
    expect(old.prepare(`SELECT COUNT(*) FROM sqlite_master WHERE name = 'companies__new'`).pluck().get()).toBe(0);
    expect(old.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(old.inTransaction).toBe(false);
    old.close();
  });

  it('rebuildTable: un passo di dati che fallisce annulla la ricostruzione', () => {
    const { old } = oldSchemaDb(seedRelations);
    const ddlBefore = old.prepare(`SELECT sql FROM sqlite_master WHERE name = 'companies'`).pluck().get();
    expect(() =>
      rebuildTable(old, 'companies', 'CREATE TABLE companies (id INTEGER PRIMARY KEY, linkedin_url TEXT)', ['id', 'linkedin_url'], {
        migrate: () => {
          throw new Error('passo fallito');
        },
      }),
    ).toThrow('passo fallito');
    expect(old.prepare(`SELECT sql FROM sqlite_master WHERE name = 'companies'`).pluck().get()).toBe(ddlBefore);
    expect(count(old, 'companies')).toBe(3);
    expect(old.pragma('foreign_keys', { simple: true })).toBe(1);
    old.close();
  });

  it('rebuildTable: una ricostruzione che rompe le chiavi esterne viene annullata', () => {
    const { old } = oldSchemaDb(seedRelations);
    // Copia senza la riga 1, referenziata da riferimenti, prospect e fonti.
    expect(() =>
      rebuildTable(old, 'companies', OLD_SCHEMA.match(/CREATE TABLE IF NOT EXISTS companies \([\s\S]*?\n\);/)![0], ['id', 'linkedin_url'], {
        migrate: (tx) => tx.prepare('DELETE FROM companies WHERE id = 1').run(),
      }),
    ).toThrow(/chiavi esterne/);
    expect(count(old, 'companies')).toBe(3);
    expect(old.pragma('foreign_key_check')).toEqual([]);
    old.close();
  });
});

describe('migrateSchema all\'avvio (apollo-lookalike T5): companies + sources + jobs + prospects in un colpo', () => {
  function oldSchemaDb(seed: (old: Database.Database) => void) {
    const dir = fs.mkdtempSync(path.join(path.dirname(oldDbPath), 'migr5-'));
    const file = path.join(dir, 'crm.db');
    const old = new Database(file);
    old.pragma('journal_mode = WAL');
    old.pragma('foreign_keys = ON');
    old.exec(OLD_SCHEMA);
    seed(old);
    return { dir, file, old };
  }
  const backupsIn = (dir: string) => fs.readdirSync(dir).filter((f) => f.startsWith('crm.db.bak-')).sort();
  const dump = (conn: Database.Database, table: string) => conn.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
  const columnNames = (conn: Database.Database, table: string) =>
    (conn.pragma(`table_info(${table})`) as Array<{ name: string }>).map((c) => c.name);

  /** Schema crm-foundation con righe in tutte le tabelle toccate: aziende, fonti (post, azienda, manuale), job. */
  function seedAll(old: Database.Database) {
    old.prepare('INSERT INTO companies (linkedin_url, name, website) VALUES (?, ?, ?)').run('https://www.linkedin.com/company/acme', 'Acme', 'acme.it');
    const post = old.prepare(`INSERT INTO posts (post_url) VALUES ('https://www.linkedin.com/posts/p-1')`).run().lastInsertRowid;
    const p1 = old.prepare(`INSERT INTO prospects (linkedin_url, company_id) VALUES ('https://www.linkedin.com/in/uno', 1)`).run().lastInsertRowid;
    const p2 = old.prepare(`INSERT INTO prospects (linkedin_url) VALUES ('https://www.linkedin.com/in/due')`).run().lastInsertRowid;
    old.prepare(`INSERT INTO sources (prospect_id, kind, company_id, raw_json) VALUES (?, 'company_employees', 1, '{"a":1}')`).run(p1);
    old.prepare(`INSERT INTO sources (prospect_id, kind, post_id, reaction_type) VALUES (?, 'post_reaction', ?, 'LIKE')`).run(p2, post);
    old.prepare(`INSERT INTO sources (prospect_id, kind) VALUES (?, 'manual')`).run(p1);
    old.prepare(`DELETE FROM sources WHERE kind = 'manual'`).run(); // contatore AUTOINCREMENT di sources a 3
    old.prepare(`INSERT INTO jobs (kind, params, state, result, finished_at) VALUES ('enrich', '{"prospectIds":[1]}', 'succeeded', '{"summary":"ok","counts":{}}', '2026-09-01T00:00:00.000Z')`).run();
    old.prepare(`INSERT INTO jobs (kind, params, state, error) VALUES ('source_company', '{"companyId":1}', 'failed', 'actor:x: errore')`).run();
    // Job "in corso" di un processo morto: non blocca la migrazione.
    old.prepare(`INSERT INTO jobs (kind, state, pid) VALUES ('analyze', 'running', 2147483646)`).run();
  }

  it('DB crm-foundation: tutte e quattro le tabelle aggiornate, righe e contatori intatti, un solo backup, seconda volta no-op', () => {
    const { dir, old } = oldSchemaDb(seedAll);
    const before = { sources: dump(old, 'sources'), jobs: dump(old, 'jobs'), prospects: dump(old, 'prospects') };
    expect(planSchemaMigration(old)).toEqual({ companies: true, sources: true, jobs: true, prospectsColumns: ['apollo_person_id', 'apollo_matched_at'] });

    applySchema(old);

    expect(planSchemaMigration(old)).toEqual({ companies: false, sources: false, jobs: false, prospectsColumns: [] });
    expect(dump(old, 'sources')).toEqual(before.sources);
    expect(dump(old, 'jobs')).toEqual(before.jobs);
    expect(dump(old, 'prospects')).toEqual(before.prospects.map((p: any) => ({ ...p, apollo_person_id: null, apollo_matched_at: null })));
    expect(old.prepare(`SELECT domain FROM companies WHERE id = 1`).pluck().get()).toBe('acme.it');
    expect(old.pragma('foreign_key_check')).toEqual([]);
    expect(old.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(backupsIn(dir)).toHaveLength(1);
    expect(hasTableIn(old, 'icp_company_candidates')).toBe(true);
    // Indici delle tabelle ricostruite ricreati.
    const indexes = (table: string) =>
      old.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL ORDER BY name`).pluck().all(table);
    expect(indexes('sources')).toEqual(['idx_sources_company', 'idx_sources_prospect', 'ux_sources_company', 'ux_sources_manual', 'ux_sources_post']);
    expect(indexes('jobs')).toEqual(['idx_jobs_state']);
    expect(indexes('prospects')).toEqual(expect.arrayContaining(['ux_prospects_apollo_person', 'ux_prospects_member_urn']));

    // I CHECK nuovi valgono, quelli vecchi pure; gli id cancellati non si riusano.
    expect(old.prepare(`INSERT INTO jobs (kind) VALUES ('lookalike_companies')`).run().lastInsertRowid).toBe(4);
    expect(() => old.prepare(`INSERT INTO jobs (kind) VALUES ('daily_run')`).run()).toThrow(expect.objectContaining({ code: 'SQLITE_CONSTRAINT_CHECK' }));
    expect(() => old.prepare(`INSERT INTO sources (prospect_id, kind) VALUES (1, 'apollo_people')`).run()).toThrow(
      expect.objectContaining({ code: 'SQLITE_CONSTRAINT_CHECK' }),
    );
    expect(old.prepare(`INSERT INTO sources (prospect_id, kind, company_id) VALUES (2, 'apollo_people', 1)`).run().lastInsertRowid).toBe(4);
    expect(() => old.prepare('DELETE FROM companies WHERE id = 1').run()).toThrow('FOREIGN KEY constraint failed');

    // Seconda applicazione (anche dimenticando il backup, come un nuovo avvio): nessun backup, nessuna modifica.
    const ddl = old.prepare(`SELECT name, sql FROM sqlite_master ORDER BY name`).all();
    resetBackupState();
    applySchema(old);
    expect(old.prepare(`SELECT name, sql FROM sqlite_master ORDER BY name`).all()).toEqual(ddl);
    expect(backupsIn(dir)).toHaveLength(1);

    // Il backup è lo schema vecchio con le righe di prima.
    const copy = new Database(path.join(dir, backupsIn(dir)[0]), { readonly: true });
    expect(copy.prepare(`SELECT sql FROM sqlite_master WHERE name = 'jobs'`).pluck().get()).not.toContain('lookalike_companies');
    expect(copy.prepare('SELECT COUNT(*) FROM sources').pluck().get()).toBe(2);
    copy.close();
    old.close();
  });

  it('DB già migrato da T4a ma non da T5: ricostruisce solo sources e jobs e aggiunge le colonne dei prospect', () => {
    const { dir, old } = oldSchemaDb(seedAll);
    // Primo avvio con T4a (solo companies a doppia chiave, con il suo backup): `migrateSchema` aggiorna
    // tutto insieme, quindi lo stato intermedio si ricrea con le primitive.
    backupDatabase(old, old.name);
    rebuildTable(old, 'companies', COMPANIES_TABLE, ['id', 'linkedin_url', 'name', 'website', 'industry', 'size', 'location', 'notes', 'created_at', 'updated_at'], {
      indexes: COMPANIES_INDEXES,
      migrate: (tx) => tx.prepare(`UPDATE companies SET domain = 'acme.it' WHERE id = 1`).run(),
    });
    const companies = dump(old, 'companies');
    const companiesDdl = tableSql(old, 'companies');
    resetBackupState(); // nuovo avvio
    expect(planSchemaMigration(old)).toEqual({ companies: false, sources: true, jobs: true, prospectsColumns: ['apollo_person_id', 'apollo_matched_at'] });

    applySchema(old);

    expect(planSchemaMigration(old)).toEqual({ companies: false, sources: false, jobs: false, prospectsColumns: [] });
    expect(dump(old, 'companies')).toEqual(companies);
    expect(tableSql(old, 'companies')).toBe(companiesDdl);
    expect(dump(old, 'jobs')).toHaveLength(3);
    expect(dump(old, 'sources')).toHaveLength(2);
    expect(columnNames(old, 'prospects').slice(-2)).toEqual(['apollo_person_id', 'apollo_matched_at']);
    expect(old.pragma('foreign_key_check')).toEqual([]);
    expect(backupsIn(dir)).toHaveLength(2); // uno per avvio che ha migrato
    old.close();
  });

  it('DB nuovo e DB aggiornato con un job vivo (processo figlio che importa db/index.ts): nessun backup, nessun errore', () => {
    const dir = fs.mkdtempSync(path.join(path.dirname(oldDbPath), 'fresh-'));
    const fresh = new Database(path.join(dir, 'crm.db'));
    expect(planSchemaMigration(fresh)).toEqual({ companies: false, sources: false, jobs: false, prospectsColumns: [] });
    applySchema(fresh);
    fresh.prepare(`INSERT INTO jobs (kind, state, pid) VALUES ('lookalike_companies', 'running', ?)`).run(process.pid);
    resetBackupState();
    expect(() => applySchema(fresh)).not.toThrow();
    expect(backupsIn(dir)).toEqual([]);
    // Colonne dei prospect nello stesso ordine di un DB migrato con ALTER.
    expect(columnNames(fresh, 'prospects').slice(-2)).toEqual(['apollo_person_id', 'apollo_matched_at']);
    fresh.close();
  });

  it('tutto o niente tra tabelle: se la ricostruzione di jobs fallisce, nemmeno companies e sources cambiano', () => {
    const { dir, old } = oldSchemaDb((o) => {
      seedAll(o);
      // Una vista su jobs fa fallire la rinomina di jobs, dopo che companies e sources sono già ricostruite.
      o.exec('CREATE VIEW v_jobs AS SELECT id, kind FROM jobs');
    });
    const ddlBefore = old.prepare(`SELECT name, sql FROM sqlite_master ORDER BY name`).all();
    const rows = { companies: dump(old, 'companies'), sources: dump(old, 'sources'), jobs: dump(old, 'jobs') };

    let message = '';
    try {
      applySchema(old);
    } catch (err) {
      message = (err as Error).message;
    }
    const backups = backupsIn(dir);
    expect(backups).toHaveLength(1);
    expect(message).toContain('companies, sources, jobs, prospects');
    expect(message).toContain('v_jobs'); // fallita all'ultima ricostruzione, dopo companies e sources
    expect(message).toContain('Il database originale è intatto');
    expect(message).toContain(path.join(dir, backups[0]));
    expect(old.prepare(`SELECT name, sql FROM sqlite_master ORDER BY name`).all()).toEqual(ddlBefore);
    expect({ companies: dump(old, 'companies'), sources: dump(old, 'sources'), jobs: dump(old, 'jobs') }).toEqual(rows);
    expect(old.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(old.inTransaction).toBe(false);
    old.close();
  });
});
