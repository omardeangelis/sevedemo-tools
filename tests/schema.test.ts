import { describe, expect, it } from 'vitest';

// Schema `crm.db` (crm-foundation T3, PLAN §6). Import dinamico: la config
// (DB_PATH isolato da tests/setup.ts) è letta a import-time.
const { db } = await import('../src/db/index.js');
const { applySchema } = await import('../src/db/schema.js');

const TABLES = [
  'activities',
  'analyses',
  'companies',
  'exports',
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
  it('contiene esattamente le 13 tabelle del modello dati', () => {
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
