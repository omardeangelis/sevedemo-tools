import { Link } from '@tanstack/react-router';
import { cn } from '@/lib/utils';
import type { RunOutcome, RunView, ToolId } from '../../api/types';
import { relativeDay } from '../../lib/dates';

/*
 * Pezzi condivisi di Connessioni e dei run (people-first-crm J4–J7, FLOW G.2–G.4): esito in parole,
 * data e durata, link al dettaglio del run.
 */

/** Nome di uno strumento esterno: il server manda `label` in Connessioni, qui servono anche i `failed_tools`. */
export const TOOL_LABELS: Record<ToolId, string> = {
  apify: 'Apify',
  apollo: 'Apollo',
  anthropic: 'Anthropic',
  cloudflare: 'Cloudflare',
};

/** "Apify e Anthropic" / "Apify, Apollo": l'elenco degli strumenti di un run in parole. */
export function toolNames(tools: readonly ToolId[], separator = ' e '): string {
  return tools.map((tool) => TOOL_LABELS[tool]).join(separator);
}

export const OUTCOME_LABELS: Record<RunOutcome, string> = {
  running: 'In corso',
  completed: 'Completato',
  warnings: 'Completato con avvisi',
  failed: 'Fallito',
};

const OUTCOME_CLS: Record<RunOutcome, string> = {
  running: 'bg-sky-100 text-sky-800',
  completed: 'bg-emerald-100 text-emerald-800',
  warnings: 'bg-amber-100 text-amber-900',
  failed: 'bg-red-100 text-red-800',
};

/** Esito di un run come parola (J4): mai solo un colore. `role="status"` dove il passaggio va annunciato. */
export function Outcome({ outcome, className, role }: { outcome: RunOutcome; className?: string; role?: 'status' }) {
  return (
    <span
      role={role}
      className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', OUTCOME_CLS[outcome], className)}
    >
      {OUTCOME_LABELS[outcome]}
    </span>
  );
}

/**
 * Avvio di un run rispetto a oggi: *"oggi 10:12"*, *"ieri 18:40"*, *"18 set 10:12"*. Il giorno lo scrive
 * `relativeDay` come nel resto del CRM; `today` arriva da `useToday()`, che si riallinea a mezzanotte.
 */
export function runStartText(iso: string | null, today: string): string {
  if (!iso) return '—';
  const time = new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  return `${relativeDay(iso, today)} ${time}`;
}

/** Durata in secondi o minuti; `—` finché il run non è finito. */
export function runDurationText(ms: number | null): string {
  if (ms === null) return '—';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${String(seconds % 60).padStart(2, '0')} s`;
}

/** Link al dettaglio di un run (J7, J14). */
export function RunLink({ run, children, className }: { run: Pick<RunView, 'id'>; children: React.ReactNode; className?: string }) {
  return (
    <Link
      to="/settings/connections/runs/$runId"
      params={{ runId: String(run.id) }}
      className={cn('font-medium text-slate-900 underline-offset-2 hover:underline', className)}
    >
      {children}
    </Link>
  );
}

/**
 * Nomi italiani dei conteggi dell'esito (J7): sono le chiavi di `result.counts` dei sette kind, che nel
 * codice restano in inglese. Una chiave sconosciuta si mostra com'è, con gli underscore come spazi; quelle
 * del passo contatti di una pipeline arrivano col prefisso `contacts_`.
 */
const COUNT_LABELS: Record<string, string> = {
  // sync interazioni
  posts: 'post letti',
  posts_new: 'post nuovi',
  posts_synced: 'post sincronizzati',
  posts_skipped_fresh: 'post già sincronizzati (saltati)',
  posts_skipped_old: 'post troppo vecchi (saltati)',
  reposts_skipped: 'repost saltati',
  posts_capped: 'post al tetto di reazioni',
  reactions: 'reazioni lette',
  comments: 'commenti letti',
  post_errors: 'post in errore',
  // persone
  prospects_new: 'persone nuove',
  prospects_seen: 'persone già presenti',
  prospects_merged: 'doppioni uniti',
  skipped_no_url: 'senza profilo LinkedIn (saltate)',
  fetched: 'persone lette',
  added_to_list: 'aggiunte alla lista',
  added: 'aggiunte alla lista',
  already_in_list: 'già in lista',
  marked_enriched: 'marcate arricchite',
  selected: 'persone considerate',
  targets: 'da elaborare',
  not_found: 'non più nel CRM',
  no_linkedin: 'senza LinkedIn (escluse)',
  // arricchimento
  enriched: 'arricchite',
  no_data: 'senza dati sul profilo',
  with_email: 'con email',
  errors: 'in errore',
  skipped_enriched: 'già arricchite (saltate)',
  skipped_fresh: 'tentate di recente (saltate)',
  unavailable: 'email non disponibile',
  already_had_email: 'già con email (saltate)',
  not_searched: 'non cercate',
  email_cleared: 'email svuotata a mano (escluse)',
  apollo_id_taken: 'id Apollo già assegnato',
  credits_used: 'crediti Apollo usati',
  requests: 'richieste Apollo',
  // analisi
  enriched_first: 'arricchite prima',
  analyzed: 'analizzate',
  skipped_same_input: 'già analizzate con gli stessi dati (saltate)',
  skipped_analyzed: 'già analizzate (saltate)',
  not_enrichable: 'senza dati (non analizzabili)',
  refusals: 'rifiutate dal modello',
  // aziende
  merged: 'unioni',
  linkedin_acquired: 'URL LinkedIn acquisiti',
  key_conflicts: 'chiavi in conflitto',
  read: 'aziende lette',
  new_candidates: 'candidate nuove',
  known: 'già note',
  without_linkedin: 'senza URL LinkedIn',
  without_location: 'senza sede',
  references_completed: 'referenze completate',
  no_keys: 'senza chiavi (saltate)',
  pages_read: 'pagine lette',
  last_page: 'ultima pagina letta',
  last_page_declared: "aziende nell'ultima pagina",
  // contatti Apollo
  people_read: 'persone lette',
  people_matched: 'persone rivelate',
  companies: 'aziende',
  companies_done: 'aziende completate',
  without_domain: 'aziende senza sito',
};

export function countLabel(key: string): string {
  const contacts = key.startsWith('contacts_');
  const plain = contacts ? key.slice('contacts_'.length) : key;
  const label = COUNT_LABELS[plain] ?? plain.replaceAll('_', ' ');
  return contacts ? `contatti: ${label}` : label;
}
