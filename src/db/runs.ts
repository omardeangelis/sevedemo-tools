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
  /** Messaggio d'errore se la sorgente di questa strategia è fallita (canale onestà report). */
  error?: string;
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
    `INSERT INTO runs (run_date, strategy, run_id, actor_run_id, items_in, items_new, cost_estimate, run_error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    r.runDate,
    r.strategy,
    r.runId ?? null,
    r.actorRunId ?? null,
    r.itemsIn ?? 0,
    r.itemsNew ?? 0,
    r.costEstimate ?? 0,
    r.error ?? null,
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

/** Stato derivato di una strategia nel report (onestà osservabilità, AC5). */
export type StrategyState = 'never-ran' | 'clean-0' | 'all-duplicates' | 'errored' | 'ok';

export interface StrategyReportRow {
  strategy: string;
  extracted: number;
  selected: number;
  sent: number;
  opened: number;
  replied: number;
  positive: number;
  converted: number;
  /** Σ items_in dei run (candidati grezzi visti dalla sorgente). */
  sourced: number;
  /** Σ items_new dei run (candidati nuovi persistiti). */
  new: number;
  /** Data dell'ultimo run (max created_at) o null se mai girata. */
  last_run: string | null;
  /** Stato derivato: mai-girata / girata-pulita-0 / tutti-duplicati / errore / ok. */
  state: StrategyState;
  reply_rate: number;
  positive_rate: number;
  selected_rate: number;
}

interface ContactAgg {
  strategy: string;
  extracted: number;
  selected: number;
  sent: number;
  opened: number;
  replied: number;
  positive: number;
  converted: number;
}

interface RunAgg {
  strategy: string;
  sourced: number;
  new_count: number;
  last_run: string | null;
}

/**
 * Metriche per strategia. **Unica fonte** per CLI e UI (doc 06: "un'unica fonte, due
 * viste"). Onesta (spec influencer-post-respondents): l'universo delle strategie è
 * l'unione di quelle che hanno **contatti**, quelle che compaiono in **`runs`**, e le
 * `knownStrategies` passate dal chiamante (registry) → così una strategia compare
 * **anche a 0 estratti** e si distingue mai-girata / pulita-0 / tutti-duplicati /
 * errore. `knownStrategies` è iniettato dal chiamante per evitare un ciclo
 * `db → registry`.
 */
export function reportByStrategy(knownStrategies: string[] = []): StrategyReportRow[] {
  const contactRows = db
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
       GROUP BY c.source_strategy`,
    )
    .all() as ContactAgg[];

  const runRows = db
    .prepare(
      `SELECT strategy,
         SUM(COALESCE(items_in, 0)) AS sourced,
         SUM(COALESCE(items_new, 0)) AS new_count,
         MAX(created_at) AS last_run
       FROM runs
       GROUP BY strategy`,
    )
    .all() as RunAgg[];

  // run_error dell'ULTIMO run per strategia (max created_at).
  const errRows = db
    .prepare(
      `SELECT r.strategy AS strategy, r.run_error AS run_error
         FROM runs r
        WHERE r.created_at = (SELECT MAX(created_at) FROM runs r2 WHERE r2.strategy = r.strategy)
        GROUP BY r.strategy`,
    )
    .all() as Array<{ strategy: string; run_error: string | null }>;

  const contactMap = new Map(contactRows.map((r) => [r.strategy, r]));
  const runMap = new Map(runRows.map((r) => [r.strategy, r]));
  const errMap = new Map(errRows.map((r) => [r.strategy, r.run_error]));

  const universe = new Set<string>([
    ...contactMap.keys(),
    ...runMap.keys(),
    ...knownStrategies,
  ]);

  const out: StrategyReportRow[] = [];
  for (const strategy of universe) {
    const c = contactMap.get(strategy);
    const run = runMap.get(strategy);
    const extracted = c?.extracted ?? 0;
    const selected = c?.selected ?? 0;
    const sent = c?.sent ?? 0;
    const sourced = run?.sourced ?? 0;
    const newCount = run?.new_count ?? 0;
    const last_run = run?.last_run ?? null;
    const runError = errMap.get(strategy) ?? null;

    let state: StrategyState;
    if (runError) state = 'errored';
    else if (!run && extracted === 0) state = 'never-ran';
    else if (run && sourced === 0 && extracted === 0) state = 'clean-0';
    else if (sourced > 0 && newCount === 0) state = 'all-duplicates';
    else state = 'ok';

    out.push({
      strategy,
      extracted,
      selected,
      sent,
      opened: c?.opened ?? 0,
      replied: c?.replied ?? 0,
      positive: c?.positive ?? 0,
      converted: c?.converted ?? 0,
      sourced,
      new: newCount,
      last_run,
      state,
      reply_rate: sent ? +((c?.replied ?? 0) / sent).toFixed(3) : 0,
      positive_rate: sent ? +((c?.positive ?? 0) / sent).toFixed(3) : 0,
      selected_rate: extracted ? +(selected / extracted).toFixed(3) : 0,
    });
  }

  // Vincitore (più positive/reply/estratti) in cima; le righe a 0 affondano in coda.
  out.sort((a, b) => b.positive - a.positive || b.replied - a.replied || b.extracted - a.extracted);
  return out;
}

export interface SubSourceReportRow {
  strategy: string;
  /** Sotto-fonte; `(non attribuito)` quando `source_detail` è null. */
  source_detail: string;
  extracted: number;
  selected: number;
  sent: number;
  replied: number;
  positive: number;
}

/**
 * Drill-down del report per **sotto-fonte** (`source_detail`): rollup dei contatti per
 * (`source_strategy`, `source_detail`). Stessa fonte dati di `reportByStrategy` (doc 06),
 * ma raggruppata più fine. Le righe senza `source_detail` rendono `(non attribuito)`.
 */
export function reportBySourceDetail(): SubSourceReportRow[] {
  const rows = db
    .prepare(
      `SELECT
         c.source_strategy AS strategy,
         c.source_detail AS source_detail,
         COUNT(*) AS extracted,
         SUM(CASE WHEN c.id IN (SELECT contact_id FROM daily_selection) THEN 1 ELSE 0 END) AS selected,
         SUM(CASE WHEN o.sent_at IS NOT NULL THEN 1 ELSE 0 END) AS sent,
         SUM(COALESCE(o.replied, 0)) AS replied,
         SUM(COALESCE(o.positive_reply, 0)) AS positive
       FROM contacts c
       LEFT JOIN outcomes o ON o.contact_id = c.id
       WHERE c.source_strategy IS NOT NULL
       GROUP BY c.source_strategy, c.source_detail
       ORDER BY c.source_strategy, extracted DESC`,
    )
    .all() as Array<{ strategy: string; source_detail: string | null } & Omit<SubSourceReportRow, 'strategy' | 'source_detail'>>;

  return rows.map((r) => ({ ...r, source_detail: r.source_detail ?? '(non attribuito)' }));
}
