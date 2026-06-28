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
  source_detail: string | null;
  email_subject: string | null;
  email_body: string | null;
  status: string;
  raw_json: string | null;
  first_seen_at: string;
  last_evaluated_at: string | null;
  last_enrichment_attempt_at: string | null;
  last_enrichment_actor: string | null;
}

export interface NewCandidate {
  linkedinUrl: string;
  fullName?: string;
  headline?: string;
  sourceStrategy: string;
  sourcePostUrl?: string;
  /** Sotto-fonte (commenter | tagged-person | company-expansion). Nullable. */
  sourceDetail?: string;
  raw?: unknown;
}

/** Inserisce un candidato se nuovo; ritorna l'id e se era nuovo. */
export function upsertCandidate(c: NewCandidate): { id: number; isNew: boolean } {
  const existing = db
    .prepare('SELECT id FROM contacts WHERE linkedin_url = ?')
    .get(c.linkedinUrl) as { id: number } | undefined;

  if (existing) {
    // Backfill leggero di nome/headline/source_post_url/source_detail se mancanti, senza toccare lo scoring.
    db.prepare(
      `UPDATE contacts SET
         full_name       = COALESCE(full_name, ?),
         headline        = COALESCE(headline, ?),
         source_post_url = COALESCE(source_post_url, ?),
         source_detail   = COALESCE(source_detail, ?)
       WHERE id = ?`,
    ).run(c.fullName ?? null, c.headline ?? null, c.sourcePostUrl ?? null, c.sourceDetail ?? null, existing.id);
    return { id: existing.id, isNew: false };
  }

  const info = db
    .prepare(
      `INSERT INTO contacts
         (linkedin_url, full_name, headline, source_strategy, source_post_url, source_detail, raw_json, status, first_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?)`,
    )
    .run(
      c.linkedinUrl,
      c.fullName ?? null,
      c.headline ?? null,
      c.sourceStrategy,
      c.sourcePostUrl ?? null,
      c.sourceDetail ?? null,
      c.raw ? JSON.stringify(c.raw) : null,
      nowIso(),
    );
  return { id: Number(info.lastInsertRowid), isNew: true };
}

/** True se il contatto è stato valutato (scoring) entro la finestra di freshness. */
export function isFresh(id: number, freshnessDays: number): boolean {
  const row = db
    .prepare('SELECT last_evaluated_at FROM contacts WHERE id = ?')
    .get(id) as { last_evaluated_at: string | null } | undefined;
  if (!row || !row.last_evaluated_at) return false;
  const ageMs = Date.now() - new Date(row.last_evaluated_at).getTime();
  return ageMs < freshnessDays * 86_400_000;
}

/**
 * Come `isFresh` ma sul tentativo di **enrichment progressivo**
 * (`last_enrichment_attempt_at`), distinto da `last_evaluated_at` (scoring): serve
 * a non ri-arricchire — e ri-pagare su Apify — un contatto tentato di recente.
 * Mai tentato → `false` (eleggibile).
 */
export function isEnrichmentFresh(id: number, freshnessDays: number): boolean {
  const row = db
    .prepare('SELECT last_enrichment_attempt_at FROM contacts WHERE id = ?')
    .get(id) as { last_enrichment_attempt_at: string | null } | undefined;
  if (!row || !row.last_enrichment_attempt_at) return false;
  const ageMs = Date.now() - new Date(row.last_enrichment_attempt_at).getTime();
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

/**
 * Scrittura dell'enrichment **progressivo** (on-demand, actor `apimaestro`).
 * Differenze rispetto a `updateEnrichment`:
 *  - **status-preserving**: NON tocca `status` (un contatto `scored` resta `scored`);
 *    lo stadio del dato non regredisce per un top-up dell'email.
 *  - **stamp sempre**: `last_enrichment_attempt_at` + `last_enrichment_actor` sono
 *    scritti anche quando il tentativo non recupera nulla (così la UI distingue
 *    "mai tentato" da "tentato senza esito" e la freshness blocca i retry).
 * Refresh COALESCE: un valore nuovo non vuoto vince; vuoto/assente non azzera.
 */
export function applyProgressiveEnrichment(id: number, e: Enrichment, actor: string): void {
  const clean = (v: string | undefined): string | null => (v && v.trim() !== '' ? v : null);
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
       last_enrichment_attempt_at = ?,
       last_enrichment_actor      = ?
     WHERE id = ?`,
  ).run(
    clean(e.fullName),
    clean(e.headline),
    clean(e.about),
    clean(e.location),
    clean(e.email),
    clean(e.phone),
    clean(e.company),
    e.raw ? JSON.stringify(e.raw) : null,
    nowIso(),
    actor,
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
  // Stadio del dato: lo scoring porta a `scored`, salvo il bucket di scarto che
  // è un esito terminale del dato (`discarded`). Nessuna nozione di selezione qui.
  const status = s.bucket === 'scarta' ? 'discarded' : 'scored';
  db.prepare(
    `UPDATE contacts SET
       role = ?, bucket = ?, sector = ?, fit_score = ?,
       short_description = ?, score_reason = ?, signals = ?,
       status = ?, last_evaluated_at = ?
     WHERE id = ?`,
  ).run(
    s.role,
    s.bucket,
    s.sector,
    s.fitScore,
    s.shortDescription,
    s.reason,
    JSON.stringify(s.signals ?? {}),
    status,
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

/**
 * Tombstone geografico (spec: italy-geo-gate): marca un contatto come scartato dal gate
 * Italia con lo status terminale `rejected_geo` e stampa `last_evaluated_at`. Lo stamp è
 * essenziale: fa sì che `isFresh` salti il profilo nei run futuri, evitando di
 * ri-arricchirlo e ri-pagarlo ad ogni run (OQ#3/D3). Idempotente; UPDATE su id
 * inesistente è un no-op (0 righe), non un errore.
 */
export function markRejectedGeo(id: number): void {
  db.prepare(
    `UPDATE contacts SET status = 'rejected_geo', last_evaluated_at = ? WHERE id = ?`,
  ).run(nowIso(), id);
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
