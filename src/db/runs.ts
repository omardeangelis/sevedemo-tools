import { db, nowIso } from './index.js';
import type { ContactRow } from './contacts.js';

export interface RunLog {
  runDate: string;
  strategy: string;
  runId?: string;
  actorRunId?: string;
  itemsIn?: number;
  itemsNew?: number;
  costEstimate?: number;
}

/**
 * Id opaco dell'esecuzione (`YYYY-MM-DD-N`, N progressivo del giorno). Identifica
 * un'esecuzione di `runDaily` — che scrive N righe `runs` (una per strategia) + una
 * `daily_selection` — così la Selezione può puntare al Run che l'ha generata, e due
 * run nello stesso giorno restano distinti. Chiamato a inizio run, prima di `logRun`.
 */
export function newRunId(date: string): string {
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT run_id) AS n FROM runs WHERE run_date = ? AND run_id IS NOT NULL`,
    )
    .get(date) as { n: number };
  return `${date}-${row.n + 1}`;
}

export function logRun(r: RunLog): void {
  db.prepare(
    `INSERT INTO runs (run_date, strategy, run_id, actor_run_id, items_in, items_new, cost_estimate, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    r.runDate,
    r.strategy,
    r.runId ?? null,
    r.actorRunId ?? null,
    r.itemsIn ?? 0,
    r.itemsNew ?? 0,
    r.costEstimate ?? 0,
    nowIso(),
  );
}

export interface SelectionRow {
  bucket: string;
  contactId: number;
  rank: number;
}

/**
 * Sostituisce la selezione del giorno indicato, marcandola come figlia del Run
 * `runId` e in stato `in_review` (ciclo proprio della Selezione: `in_review →
 * exported`). DELETE+INSERT per data: una seconda esecuzione nello stesso giorno
 * rimpiazza la selezione precedente.
 */
export function saveSelection(date: string, rows: SelectionRow[], runId: string): void {
  const tx = db.transaction((items: SelectionRow[]) => {
    db.prepare('DELETE FROM daily_selection WHERE date = ?').run(date);
    const ins = db.prepare(
      `INSERT INTO daily_selection (date, bucket, contact_id, rank, run_id, state)
       VALUES (?, ?, ?, ?, ?, 'in_review')`,
    );
    for (const it of items) ins.run(date, it.bucket, it.contactId, it.rank, runId);
  });
  tx(rows);
}

export function getSelection(date: string): ContactRow[] {
  return db
    .prepare(
      `SELECT c.* FROM daily_selection d
         JOIN contacts c ON c.id = d.contact_id
        WHERE d.date = ?
        ORDER BY d.bucket, d.rank`,
    )
    .all(date) as ContactRow[];
}

export interface OutcomeInput {
  contactId: number;
  strategy?: string | null;
  sentAt?: string | null;
  opened?: boolean;
  replied?: boolean;
  positiveReply?: boolean;
  converted?: boolean;
  notes?: string | null;
}

export function upsertOutcome(o: OutcomeInput): void {
  db.prepare(
    `INSERT INTO outcomes (contact_id, strategy, sent_at, opened, replied, positive_reply, converted, notes)
     VALUES (@contactId, @strategy, @sentAt, @opened, @replied, @positiveReply, @converted, @notes)
     ON CONFLICT(contact_id) DO UPDATE SET
       strategy       = COALESCE(excluded.strategy, outcomes.strategy),
       sent_at        = COALESCE(excluded.sent_at, outcomes.sent_at),
       opened         = MAX(outcomes.opened, excluded.opened),
       replied        = MAX(outcomes.replied, excluded.replied),
       positive_reply = MAX(outcomes.positive_reply, excluded.positive_reply),
       converted      = MAX(outcomes.converted, excluded.converted),
       notes          = COALESCE(excluded.notes, outcomes.notes)`,
  ).run({
    contactId: o.contactId,
    strategy: o.strategy ?? null,
    sentAt: o.sentAt ?? null,
    opened: o.opened ? 1 : 0,
    replied: o.replied ? 1 : 0,
    positiveReply: o.positiveReply ? 1 : 0,
    converted: o.converted ? 1 : 0,
    notes: o.notes ?? null,
  });
}

export interface StrategyReportRow {
  strategy: string;
  extracted: number;
  selected: number;
  sent: number;
  opened: number;
  replied: number;
  positive: number;
  converted: number;
  reply_rate: number;
  positive_rate: number;
  selected_rate: number;
}

/** Metriche per strategia di estrazione, usando source_strategy del contatto. */
export function reportByStrategy(): StrategyReportRow[] {
  const rows = db
    .prepare(
      `SELECT
         c.source_strategy AS strategy,
         COUNT(*) AS extracted,
         SUM(CASE WHEN c.id IN (SELECT contact_id FROM daily_selection) THEN 1 ELSE 0 END) AS selected,
         SUM(CASE WHEN o.sent_at IS NOT NULL THEN 1 ELSE 0 END) AS sent,
         SUM(COALESCE(o.opened, 0)) AS opened,
         SUM(COALESCE(o.replied, 0)) AS replied,
         SUM(COALESCE(o.positive_reply, 0)) AS positive,
         SUM(COALESCE(o.converted, 0)) AS converted
       FROM contacts c
       LEFT JOIN outcomes o ON o.contact_id = c.id
       WHERE c.source_strategy IS NOT NULL
       GROUP BY c.source_strategy
       ORDER BY positive DESC, replied DESC, extracted DESC`,
    )
    .all() as Array<Omit<StrategyReportRow, 'reply_rate' | 'positive_rate' | 'selected_rate'>>;

  return rows.map((r) => {
    const sent = r.sent || 0;
    return {
      ...r,
      reply_rate: sent ? +(r.replied / sent).toFixed(3) : 0,
      positive_rate: sent ? +(r.positive / sent).toFixed(3) : 0,
      selected_rate: r.extracted ? +(r.selected / r.extracted).toFixed(3) : 0,
    };
  });
}
