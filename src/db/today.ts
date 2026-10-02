import type { ToolId } from '../runs/tools.js';
import { localDate } from '../util/fields.js';
import { db } from './index.js';
import { lastRunPerTool, runView, type RunView } from './runs.js';
import { personRefs, type PersonRef } from './people.js';
import { addDays, nextActionState, VIEW_CONDITIONS, type NextActionState } from './prospects.js';
import { getReadiness, getSettings } from './settings.js';

/*
 * Oggi, la home (people-first-crm SPEC H1–H8, T25): cosa fare oggi senza aprire le schede. Tutto derivato (K4):
 * prossime azioni scadute o di oggi (Da fare) e dei prossimi 7 giorni (In arrivo) delle persone non scartate,
 * quante persone sono da smistare, le ultime aggiunte e cosa manca alla configurazione. "Oggi" è quello
 * dell'utente (`today`, P-4). Gli avvisi sui run falliti (H5) guardano l'ultimo run di ogni strumento.
 */

/** Riga di Da fare / In arrivo: persona, azienda (collegata o scritta) e prossima azione. */
export interface TodayAction {
  id: number;
  full_name: string | null;
  company_name: string | null;
  company_id: number | null;
  next_action_on: string;
  next_action_text: string | null;
  next_action_set_at: string | null;
  next_action_state: NextActionState;
  status: string;
}

/** Ultime aggiunte (H4): la persona con la prima fonte e la data di aggiunta. */
export type RecentPerson = PersonRef & { created_at: string };

/**
 * Voci di configurazione (H7), nell'ordine in cui conviene completarle: le chiavi di `getReadiness` più `generate`, la
 * generazione di profilo e servizi (own-profile-services G6).
 */
export const SETUP_KEYS = ['profile', 'company', 'generate', 'icp', 'apify', 'anthropic', 'apollo'] as const;
export type SetupKey = (typeof SETUP_KEYS)[number];

/**
 * La voce "genera profilo e servizi" (G6): solo se nessuna generazione ha mai prodotto una proposta (un run riuscito
 * senza contenuto, D14, non ha generato niente), non c'è nessun servizio e c'è almeno un indirizzo da leggere (senza,
 * non è possibile). Mentre c'è, la voce dell'azienda tace (OQ-7): la generazione la compila. La readiness non cambia,
 * perché la leggono anche avvisi e anteprime (B8).
 */
function generationSuggested(): boolean {
  const settings = getSettings();
  if (settings.own_profile_url === null && settings.website_url === null) return false;
  const generated = db
    .prepare(
      `SELECT 1 FROM jobs WHERE kind = 'generate_profile' AND state = 'succeeded'
         AND COALESCE(json_extract(result, '$.counts.no_content'), 0) <> 1 LIMIT 1`,
    )
    .get();
  return !generated && !db.prepare(`SELECT 1 FROM services LIMIT 1`).get();
}

function setupMissing(): SetupKey[] {
  const readiness = getReadiness();
  const generate = generationSuggested();
  return SETUP_KEYS.filter((key) => (key === 'generate' ? generate : key === 'company' ? !readiness.company && !generate : !readiness[key]));
}

export interface Today {
  /** Nessuna persona nel CRM: la home è l'onboarding (H8). */
  empty: boolean;
  due: TodayAction[];
  upcoming: TodayAction[];
  to_triage: number;
  recent: RecentPerson[];
  setup_missing: SetupKey[];
  /** Avvisi sui run falliti (H5), dal più recente. */
  failed_runs: FailedRunAlert[];
}

/** Un run fallito che è l'ultimo di uno o più strumenti, e conta come fallito per loro (H5, J4). */
export interface FailedRunAlert {
  /** Strumenti da avvisare: *"Ultimo run fallito per Apollo"*. */
  tools: ToolId[];
  run: RunView;
}

/**
 * Gli strumenti il cui ultimo run è fallito **per loro** (`lastRunPerTool`, la stessa base della salute in
 * Connessioni): un avviso per run, con tutti gli strumenti che riguarda, dal più recente.
 */
function failedRuns(): FailedRunAlert[] {
  const alerts = new Map<number, FailedRunAlert>();
  for (const { tool, run, failing } of lastRunPerTool()) {
    if (!failing) continue;
    const alert = alerts.get(run.id) ?? { tools: [], run: runView(run) };
    alert.tools.push(tool);
    alerts.set(run.id, alert);
  }
  // Dal più recente; a parità di avvio (run nello stesso millisecondo) decide l'id, così l'ordine non cambia da una
  // lettura all'altra.
  return [...alerts.values()].sort(
    (a, b) => (b.run.started_at ?? '').localeCompare(a.run.started_at ?? '') || b.run.id - a.run.id,
  );
}

export const RECENT_LIMIT = 10;
const UPCOMING_DAYS = 7;

function actions(where: string, params: unknown[], today: string): TodayAction[] {
  const rows = db
    .prepare(
      `SELECT p.id, p.full_name, COALESCE(c.name, p.company_name) AS company_name, p.company_id, p.next_action_on,
              p.next_action_text, p.next_action_set_at, p.status
       FROM prospects p LEFT JOIN companies c ON c.id = p.company_id
       WHERE p.status <> 'scartato' AND p.next_action_on IS NOT NULL AND ${where}
       ORDER BY p.next_action_on, p.full_name COLLATE NOCASE, p.id`,
    )
    .all(...params) as Array<Omit<TodayAction, 'next_action_state'>>;
  return rows.map((r) => ({ ...r, next_action_state: nextActionState(r.next_action_on, today)! }));
}

/** Oggi (H2–H8) rispetto al `today` dell'utente (default: la data locale del server). */
export function getToday(today: string = localDate()): Today {
  // Ultime aggiunte per data di aggiunta: "Aggiungi l'incontro" su chi c'era già non la cambia (H4).
  const latest = db.prepare(`SELECT id, created_at FROM prospects ORDER BY created_at DESC, id DESC LIMIT ${RECENT_LIMIT}`).all() as Array<{
    id: number;
    created_at: string;
  }>;
  const created = new Map(latest.map((r) => [r.id, r.created_at]));
  return {
    empty: latest.length === 0,
    due: actions('p.next_action_on <= ?', [today], today),
    upcoming: actions('p.next_action_on > ? AND p.next_action_on <= ?', [today, addDays(today, UPCOMING_DAYS)], today),
    to_triage: db.prepare(`SELECT COUNT(*) FROM prospects p WHERE ${VIEW_CONDITIONS.da_smistare}`).pluck().get() as number,
    recent: personRefs(latest.map((r) => r.id)).map((p) => ({ ...p, created_at: created.get(p.id)! })),
    setup_missing: setupMissing(),
    failed_runs: failedRuns(),
  };
}
