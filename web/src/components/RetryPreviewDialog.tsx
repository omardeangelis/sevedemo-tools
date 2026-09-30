import type { Job, JobKind } from '../api/types';
import { jobKindLabel, useRetryJob, useRetryPreview } from '../lib/jobs';
import { JobPreviewDialog } from './JobPreviewDialog';

/** Hint di "Riprova…" (FLOW G.5): il bottone apre la preview, non spende. */
export const RETRY_HINT = "Apre l'anteprima con gli stessi parametri: conteggi, stima e blocchi ricalcolati adesso.";

/**
 * Etichette dei conteggi della preview per kind, nell'ordine (la prima si mostra sempre, le altre solo se
 * diverse da 0): le chiavi assenti in `counts` si saltano, così un kind con più varianti (Apify/Apollo) ha
 * una mappa sola.
 */
const COUNT_LABELS: Record<JobKind, Record<string, string>> = {
  sync_interactions: {
    posts_per_sync: 'Ultimi post letti dal profilo',
    posts_to_sync: 'Post da sincronizzare',
    posts_never_synced: 'Mai sincronizzati',
    posts_resync: 'Con sync scaduto',
    posts_skipped_fresh: 'Già sincronizzati (saltati)',
    posts_skipped_old: 'Oltre il limite di età (saltati)',
    reactions_max: 'Reazioni lette al massimo',
    comments_max: 'Commenti letti al massimo',
  },
  source_company: { max_items: 'Persone lette al massimo' },
  enrich: {
    selected: 'Persone considerate',
    targets: 'Da arricchire',
    skipped_enriched: 'Già arricchite (saltate)',
    skipped_with_email: 'Con email (saltate)',
    skipped_fresh: 'Tentate di recente senza risultato (saltate)',
    email_cleared: 'Email svuotata a mano (escluse)',
    no_linkedin: 'Senza LinkedIn (escluse)',
    not_found: 'Non più nel CRM',
    est_credits: 'Crediti Apollo stimati',
  },
  analyze: {
    selected: 'Persone considerate',
    to_enrich: 'Da arricchire prima',
    to_analyze: 'Da analizzare',
    // own-profile-services F8: stessi gruppi del dialog dell'analisi in blocco.
    to_redo: 'Da rifare',
    skipped_same_input: 'Input identico, saltate comunque',
    skipped_analyzed: "Hanno già un'analisi per questo ICP (restano fuori)",
    not_enrichable: 'Senza dati sul profilo (saltate)',
    no_linkedin: 'Senza LinkedIn (escluse)',
    not_found: 'Non più nel CRM',
  },
  enrich_companies: {
    references: 'Aziende considerate',
    to_enrich: 'Da arricchire',
    with_domain: 'Con sito',
    skipped_fresh: 'Tentate di recente senza esito (saltate)',
    enriched: 'Già arricchite',
    est_credits: 'Crediti Apollo stimati',
  },
  lookalike_companies: {
    pages: 'Pagine da leggere',
    per_page: 'Aziende per pagina',
    start_page: 'Dalla pagina',
    est_credits: 'Crediti Apollo stimati (tetto)',
    requests: 'Richieste Apollo (tetto)',
    contacts_companies: 'Aziende per i contatti (tetto)',
    contacts_per_company: 'Persone per azienda',
  },
  apollo_people: {
    companies: 'Aziende',
    with_domain: 'Con sito',
    without_domain: 'Senza sito (escluse)',
    per_company: 'Persone per azienda al massimo',
    requests: 'Richieste Apollo',
    est_credits: 'Crediti Apollo stimati (tetto)',
  },
};

export interface RetryPreviewDialogProps {
  /** Il job `failed` da riprovare (basta quello che serve al titolo e alla preview: anche un run di J7). */
  job: Pick<Job, 'id' | 'kind' | 'params'>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Nuovo job partito ("Avvia"): il dialog si chiude da sé; qui si segna letto l'esito del fallito. */
  onStarted?: (job: Job, failedJobId: number) => void;
}

/**
 * "Riprova…" di un job fallito (SPEC J12, FLOW G.5, people-first-crm T18): la preview del kind ricalcolata
 * adesso con gli stessi `params` (`GET /api/jobs/:id/retry-preview`) nel `JobPreviewDialog` di sempre;
 * blocchi = avvio disabilitato; il job riparte solo da **Avvia** (`POST /api/jobs/:id/retry`). Una corsa
 * (job partito altrove, 409) dà il toast di `useJobStart` e ricarica la preview, che mostra il blocco.
 */
export function RetryPreviewDialog({ job, open, onOpenChange, onStarted }: RetryPreviewDialogProps) {
  const preview = useRetryPreview(job.id, { enabled: open });
  const start = useRetryJob({
    onStarted: (started, failedJobId) => {
      onOpenChange(false);
      onStarted?.(started, failedJobId);
    },
  });

  return (
    <JobPreviewDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Riprova: ${jobKindLabel(job)}`}
      description="Stessi parametri del job fallito: conteggi, stima e blocchi sono ricalcolati adesso."
      preview={preview}
      countLabels={COUNT_LABELS[job.kind]}
      starting={start.isPending}
      onStart={() => start.mutate(job.id)}
    />
  );
}
