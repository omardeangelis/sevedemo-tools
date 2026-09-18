import { PROSPECT_STATUSES, type ProspectStatus } from '../db/schema.js';

/*
 * Modello stati del prospect (D6): 9 stati, cambio **manuale e libero** (nessuna transizione
 * vietata), ogni cambio logga un'attività `status_change`. Lo stato è sul prospect (D4): vale
 * in tutte le liste in cui compare.
 */

export { PROSPECT_STATUSES, type ProspectStatus };
export { changeStatus, type StatusChangeResult } from '../db/activities.js';

/** Label italiane per UI ed export. */
export const STATUS_LABELS: Record<ProspectStatus, string> = {
  nuovo: 'Nuovo',
  qualificato: 'Qualificato',
  da_contattare: 'Da contattare',
  contattato: 'Contattato',
  risposto: 'Risposto',
  in_conversazione: 'In conversazione',
  chiuso_vinto: 'Chiuso vinto',
  chiuso_perso: 'Chiuso perso',
  scartato: 'Scartato',
};

const TERMINAL: readonly ProspectStatus[] = ['chiuso_vinto', 'chiuso_perso', 'scartato'];

/** True per gli esiti finali (vinto, perso, scartato). Informativo: non blocca i cambi. */
export function isTerminal(status: ProspectStatus): boolean {
  return TERMINAL.includes(status);
}

/** Type guard sui 9 stati. */
export function isProspectStatus(value: unknown): value is ProspectStatus {
  return typeof value === 'string' && (PROSPECT_STATUSES as readonly string[]).includes(value);
}
