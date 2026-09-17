import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, isApiError, queryKeys } from '../api/client';
import type {
  AnalyzePreviewParams,
  EnrichPreviewParams,
  Job,
  JobKind,
  JobPreview,
  JobStarted,
  SourcePreviewParams,
  SyncOptions,
} from '../api/types';
import { toast } from '../components/ui/toaster';

/*
 * Job asincroni lato UI (crm-foundation T13, FLOW B/E e "Error paths"): job corrente con polling,
 * preview uniforme per kind, avvio con gestione di `blocked`/`job_running`, testi ed esiti.
 * Il `JobBanner` (sidebar) è l'unico che notifica gli esiti: le pagine avviano e basta.
 */

/** Nome leggibile del kind (specchio di `JOB_KIND_LABELS` in `src/server/jobs.ts`). */
export const JOB_KIND_LABELS: Record<JobKind, string> = {
  sync_interactions: 'Sync interazioni',
  source_company: 'Sourcing da azienda',
  enrich: 'Arricchimento',
  analyze: 'Analisi',
};

/** Intervallo di polling del job in corso. */
export const JOB_POLL_MS = 2_500;

/**
 * Il job in corso o, se nessuno gira, l'ultimo terminato (`job: null` se mai lanciato). Fa polling
 * ogni 2,5 s solo mentre è `running` (anche a scheda nascosta); si aggiorna anche al ritorno sulla
 * finestra (job avviato da un'altra tab).
 */
export function useCurrentJob() {
  return useQuery({
    queryKey: queryKeys.currentJob,
    queryFn: api.jobs.current,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => (query.state.data?.job?.state === 'running' ? JOB_POLL_MS : false),
    // Anche a scheda nascosta (e nel browser headless di agent-browser): l'esito arriva comunque.
    refetchIntervalInBackground: true,
  });
}

/** Parametri della preview per kind. */
export interface JobPreviewParams {
  sync_interactions: SyncOptions;
  source_company: SourcePreviewParams;
  enrich: EnrichPreviewParams;
  analyze: AnalyzePreviewParams;
}

function fetchPreview<K extends JobKind>(kind: K, params: JobPreviewParams[K]): Promise<JobPreview> {
  switch (kind) {
    case 'sync_interactions':
      return api.sync.preview(params as SyncOptions);
    case 'source_company':
      return api.companies.sourcePreview(params as SourcePreviewParams);
    case 'enrich':
      return api.enrich.preview(params as EnrichPreviewParams);
    default:
      return api.analyze.preview(params as AnalyzePreviewParams);
  }
}

/**
 * Preview uniforme di un job (`{counts, est_cost_usd, warnings, blockers}`), sempre fresca:
 * passare `enabled: open` così si ricarica a ogni apertura del dialog. Si invalida da sola quando
 * un job parte o finisce (il blocker "job in corso" cambia).
 */
export function useJobPreview<K extends JobKind>(kind: K, params: JobPreviewParams[K], opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [...queryKeys.jobPreviews, kind, params],
    queryFn: () => fetchPreview(kind, params),
    enabled: opts.enabled ?? true,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

/**
 * Mutation di avvio di un job: `start` è la chiamata del client (es. `api.sync.start`). Su 202
 * mette il job nel cache del banner (parte il polling) e invalida preview e storico. Su 409
 * `job_running` (race dopo la preview) o 400 `blocked` mostra un toast con il testo del server e
 * ricarica preview e banner, così il dialog mostra subito il blocco; gli altri errori → toast rosso.
 * `onStarted` riceve il job e le variabili dell'avvio (tipicamente chiude il dialog).
 */
export function useJobStart<V = void>(
  start: (vars: V) => Promise<JobStarted>,
  opts: { onStarted?: (job: Job, vars: V) => void } = {},
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: start,
    onSuccess: ({ job }, vars) => {
      queryClient.setQueryData(queryKeys.currentJob, { job });
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobPreviews });
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs, exact: true });
      opts.onStarted?.(job, vars);
    },
    onError: (err) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobPreviews });
      void queryClient.invalidateQueries({ queryKey: queryKeys.currentJob });
      if (isApiError(err, 'job_running')) {
        toast({ tone: 'warning', title: 'Job non avviato', description: err.message });
      } else if (isApiError(err, 'blocked')) {
        toast({ tone: 'warning', title: 'Job non avviato', description: err.message });
      } else {
        toast({ tone: 'error', title: 'Avvio non riuscito', description: err instanceof Error ? err.message : undefined });
      }
    },
  });
}

/**
 * "Riprova" su un job `failed`: nuovo job con gli stessi `params`. Stessa gestione errori di
 * `useJobStart` (409 `job_running` → toast con il testo del server).
 */
export function useRetryJob(opts: { onStarted?: (job: Job, failedJobId: number) => void } = {}) {
  return useJobStart((jobId: number) => api.jobs.retry(jobId), opts);
}

// ---------------------------------------------------------------------------
// Testi ed esiti
// ---------------------------------------------------------------------------

const usd = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** `2.1` → `"≈ $2,10"`; `null` → `"stima non disponibile"` (mai un numero inventato). */
export function formatCost(value: number | null): string {
  return value === null ? 'stima non disponibile' : `≈ $${usd.format(value)}`;
}

/** Durata `m:ss` (o `h:mm:ss`) tra due istanti ISO; `end` default adesso. */
export function formatDuration(startIso: string | null, endIso?: string | null, now = Date.now()): string {
  if (!startIso) return '0:00';
  const end = endIso ? Date.parse(endIso) : now;
  const total = Math.max(0, Math.floor((end - Date.parse(startIso)) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Errore di un job diviso per attribuzione (`actor:<id>: …`, `config: …`, `process: …`). */
export interface JobErrorInfo {
  source: 'actor' | 'config' | 'process' | null;
  /** Etichetta leggibile dell'origine, es. "Actor apimaestro/linkedin-profile-posts". */
  label: string | null;
  message: string;
}

export function describeJobError(error: string | null): JobErrorInfo {
  const text = (error ?? '').trim();
  const actor = /^actor:\s*([^\s:]+(?:\/[^\s:]+)?):\s*([\s\S]*)$/.exec(text);
  if (actor) return { source: 'actor', label: `Actor ${actor[1]}`, message: actor[2] || text };
  const other = /^(config|process):\s*([\s\S]*)$/.exec(text);
  if (other) {
    const source = other[1] as 'config' | 'process';
    return { source, label: source === 'config' ? 'Configurazione' : 'Processo', message: other[2] || text };
  }
  return { source: null, label: null, message: text || 'Job fallito senza messaggio.' };
}

/** Tono dell'esito: `failed` rosso, warning ambra, zero risultati neutro, altrimenti successo. */
export type JobOutcomeTone = 'running' | 'success' | 'neutral' | 'warning' | 'error';

/**
 * True se il job è terminato senza risultati (esito neutro, non un errore): nessuna persona per
 * sync e sourcing, nessun bersaglio per arricchimento e analisi.
 */
export function isZeroOutcome(job: Job): boolean {
  const c = job.result?.counts ?? {};
  const n = (key: string) => (typeof c[key] === 'number' ? c[key] : 0);
  switch (job.kind) {
    case 'sync_interactions':
      return n('prospects_new') + n('prospects_seen') === 0;
    case 'source_company':
      return n('fetched') === 0;
    case 'enrich':
      return n('targets') === 0;
    case 'analyze':
      return n('targets') === 0 && n('analyzed') === 0;
  }
}

export function jobOutcomeTone(job: Job): JobOutcomeTone {
  if (job.state === 'running') return 'running';
  if (job.state === 'failed') return 'error';
  if ((job.result?.warnings?.length ?? 0) > 0) return 'warning';
  return isZeroOutcome(job) ? 'neutral' : 'success';
}

/** Dove portare l'utente dopo un esito (FLOW: "Apri Inbox", "Apri lista"); `null` = nessuna azione. */
export function jobOutcomeLink(job: Job): { to: string; label: string } | null {
  if (job.state !== 'succeeded' || isZeroOutcome(job)) return null;
  const listId = typeof job.params.listId === 'number' ? job.params.listId : null;
  if (job.kind === 'sync_interactions') return job.params.postsOnly ? null : { to: '/inbox', label: 'Apri Inbox' };
  if (listId !== null) return { to: `/lists/${listId}`, label: 'Apri lista' };
  return null;
}
