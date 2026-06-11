import { db, nowIso } from './index.js';

export interface ContactRow {
  id: number;
  linkedin_url: string;
  full_name: string | null;
  headline: string | null;
  about: string | null;
  location: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  role: string | null;
  bucket: string | null;
  sector: string | null;
  fit_score: number | null;
  short_description: string | null;
  score_reason: string | null;
  signals: string | null;
  source_strategy: string | null;
  source_post_url: string | null;
  email_subject: string | null;
  email_body: string | null;
  status: string;
  raw_json: string | null;
  first_seen_at: string;
  last_evaluated_at: string | null;
}

export interface NewCandidate {
  linkedinUrl: string;
  fullName?: string;
  headline?: string;
  sourceStrategy: string;
  sourcePostUrl?: string;
  raw?: unknown;
}

/** Inserisce un candidato se nuovo; ritorna l'id e se era nuovo. */
export function upsertCandidate(c: NewCandidate): { id: number; isNew: boolean } {
  const existing = db
    .prepare('SELECT id FROM contacts WHERE linkedin_url = ?')
    .get(c.linkedinUrl) as { id: number } | undefined;

  if (existing) {
    // Backfill leggero di nome/headline/source_post_url se mancanti, senza toccare lo scoring.
    db.prepare(
      `UPDATE contacts SET
         full_name       = COALESCE(full_name, ?),
         headline        = COALESCE(headline, ?),
         source_post_url = COALESCE(source_post_url, ?)
       WHERE id = ?`,
    ).run(c.fullName ?? null, c.headline ?? null, c.sourcePostUrl ?? null, existing.id);
    return { id: existing.id, isNew: false };
  }

  const info = db
    .prepare(
      `INSERT INTO contacts
         (linkedin_url, full_name, headline, source_strategy, source_post_url, raw_json, status, first_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, 'new', ?)`,
    )
    .run(
      c.linkedinUrl,
      c.fullName ?? null,
      c.headline ?? null,
      c.sourceStrategy,
      c.sourcePostUrl ?? null,
      c.raw ? JSON.stringify(c.raw) : null,
      nowIso(),
    );
  return { id: Number(info.lastInsertRowid), isNew: true };
}

/** True se il contatto è stato valutato entro la finestra di freshness. */
export function isFresh(id: number, freshnessDays: number): boolean {
  const row = db
    .prepare('SELECT last_evaluated_at FROM contacts WHERE id = ?')
    .get(id) as { last_evaluated_at: string | null } | undefined;
  if (!row || !row.last_evaluated_at) return false;
  const ageMs = Date.now() - new Date(row.last_evaluated_at).getTime();
  return ageMs < freshnessDays * 86_400_000;
}

export interface Enrichment {
  fullName?: string;
  headline?: string;
  about?: string;
  location?: string;
  email?: string;
  phone?: string;
  company?: string;
  raw?: unknown;
}

export function updateEnrichment(id: number, e: Enrichment): void {
  db.prepare(
    `UPDATE contacts SET
       full_name = COALESCE(?, full_name),
       headline  = COALESCE(?, headline),
       about     = COALESCE(?, about),
       location  = COALESCE(?, location),
       email     = COALESCE(?, email),
       phone     = COALESCE(?, phone),
       company   = COALESCE(?, company),
       raw_json  = COALESCE(?, raw_json),
       status    = 'enriched'
     WHERE id = ?`,
  ).run(
    e.fullName ?? null,
    e.headline ?? null,
    e.about ?? null,
    e.location ?? null,
    e.email ?? null,
    e.phone ?? null,
    e.company ?? null,
    e.raw ? JSON.stringify(e.raw) : null,
    id,
  );
}

export interface ScoreUpdate {
  role: string;
  bucket: string;
  sector: string;
  fitScore: number;
  shortDescription: string;
  reason: string;
  signals: unknown;
}

export function updateScore(id: number, s: ScoreUpdate): void {
  db.prepare(
    `UPDATE contacts SET
       role = ?, bucket = ?, sector = ?, fit_score = ?,
       short_description = ?, score_reason = ?, signals = ?,
       status = 'scored', last_evaluated_at = ?
     WHERE id = ?`,
  ).run(
    s.role,
    s.bucket,
    s.sector,
    s.fitScore,
    s.shortDescription,
    s.reason,
    JSON.stringify(s.signals ?? {}),
    nowIso(),
    id,
  );
}

export function updateEmail(id: number, subject: string, body: string): void {
  db.prepare('UPDATE contacts SET email_subject = ?, email_body = ? WHERE id = ?').run(subject, body, id);
}

export function setStatus(id: number, status: string): void {
  db.prepare('UPDATE contacts SET status = ? WHERE id = ?').run(status, id);
}

export function getById(id: number): ContactRow | undefined {
  return db.prepare('SELECT * FROM contacts WHERE id = ?').get(id) as ContactRow | undefined;
}

export function getByIds(ids: number[]): ContactRow[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  return db
    .prepare(`SELECT * FROM contacts WHERE id IN (${placeholders})`)
    .all(...ids) as ContactRow[];
}

export function findByEmail(email: string): ContactRow | undefined {
  return db.prepare('SELECT * FROM contacts WHERE email = ? COLLATE NOCASE').get(email) as ContactRow | undefined;
}

export function findByUrl(url: string): ContactRow | undefined {
  return db.prepare('SELECT * FROM contacts WHERE linkedin_url = ?').get(url) as ContactRow | undefined;
}
