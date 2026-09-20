import type { JobKind, JobResult, JobState } from '../jobs/types.js';

/*
 * Come si descrive un run (people-first-crm SPEC J4, J6, FLOW G.3, T28): operazione ed esito.
 * Serve al log (riga di avvio e riga finale), a Connessioni e al dettaglio del run; il FE rispecchia
 * gli stessi testi. Funzioni pure: nessun accesso al DB.
 */

/** Nome leggibile del kind, per blocker e messaggi ("C'è già un job in corso: Sync interazioni"). */
export const JOB_KIND_LABELS: Record<JobKind, string> = {
  sync_interactions: 'Sync interazioni',
  source_company: "Persone di un'azienda",
  enrich: 'Arricchimento',
  analyze: 'Analisi',
  // apollo-lookalike P-16: i kind Apollo dicono nel nome da dove arrivano.
  enrich_companies: 'Arricchimento aziende (Apollo)',
  lookalike_companies: 'Aziende simili (Apollo)',
  apollo_people: 'Contatti Apollo',
};

/**
 * Operazione di un run (FLOW G.3): il kind più ciò che cambia davvero di volta in volta — lo strumento
 * scelto per l'arricchimento, il sync del solo elenco post, l'analisi lanciata da una scheda, che è un run
 * `detached` (P-13).
 */
export function operationLabel(kind: JobKind, params: Record<string, unknown> = {}, detached = false): string {
  if (kind === 'sync_interactions' && params.postsOnly === true) return 'Solo elenco post';
  if (kind === 'enrich') return params.provider === 'apollo' ? 'Arricchimento (Apollo)' : 'Arricchimento (Apify)';
  if (kind === 'analyze' && detached) return 'Analisi singola';
  return JOB_KIND_LABELS[kind];
}

/**
 * Esito di un run (J4): `warnings` = il run è arrivato in fondo ma con warning, errori su singoli elementi
 * o profili rifiutati dal modello.
 */
export type RunOutcome = 'running' | 'completed' | 'warnings' | 'failed';

export const RUN_OUTCOME_LABELS: Record<RunOutcome, string> = {
  running: 'In corso',
  completed: 'Completato',
  warnings: 'Completato con avvisi',
  failed: 'Fallito',
};

export function runOutcome(job: { state: JobState; result: JobResult | null }): RunOutcome {
  if (job.state === 'running') return 'running';
  if (job.state === 'failed') return 'failed';
  const counts = job.result?.counts ?? {};
  const warned = (job.result?.warnings?.length ?? 0) > 0 || (counts.errors ?? 0) > 0 || (counts.refusals ?? 0) > 0;
  return warned ? 'warnings' : 'completed';
}

/** Riga finale del log (T28): *"Fine: completato con avvisi"*, *"Fine: fallito — <errore attribuito>"*. */
export function finishLine(outcome: RunOutcome, error?: string | null): string {
  const text = RUN_OUTCOME_LABELS[outcome].toLowerCase();
  return `Fine: ${error ? `${text} — ${error}` : text}`;
}
