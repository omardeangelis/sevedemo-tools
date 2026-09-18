import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, isApiError, queryKeys } from '../api/client';
import type {
  AnalyzePreviewParams,
  ContactsPreview,
  ContactsPreviewParams,
  EnrichCompaniesPreview,
  EnrichCompaniesPreviewParams,
  EnrichPreview,
  EnrichPreviewParams,
  Job,
  JobKind,
  JobPreview,
  JobStarted,
  LookalikePreview,
  LookalikePreviewParams,
  SourcePreviewParams,
  SyncOptions,
} from '../api/types';
import { toast } from '../components/ui/toaster';

/*
 * Job asincroni lato UI (crm-foundation T13, FLOW B/E e "Error paths"): job corrente con polling,
 * preview uniforme per kind, avvio con gestione di `blocked`/`job_running`, testi ed esiti.
 * Il `JobBanner` (sidebar) è l'unico che notifica gli esiti: le pagine avviano e basta.
 */

/** Nome leggibile del kind (specchio di `JOB_KIND_LABELS` in `src/server/jobs.ts`). Per un job usare `jobKindLabel`. */
export const JOB_KIND_LABELS: Record<JobKind, string> = {
  sync_interactions: 'Sync interazioni',
  source_company: 'Sourcing da azienda',
  enrich: 'Arricchimento',
  analyze: 'Analisi',
  // apollo-lookalike P-16
  enrich_companies: 'Arricchimento aziende (Apollo)',
  lookalike_companies: 'Aziende simili (Apollo)',
  apollo_people: 'Contatti Apollo',
};

/** Etichetta di un job: come `JOB_KIND_LABELS`, ma l'arricchimento con provider Apollo è "Arricchimento (Apollo)" (P-16). */
export function jobKindLabel(job: Pick<Job, 'kind' | 'params'>): string {
  if (job.kind === 'enrich' && job.params?.provider === 'apollo') return 'Arricchimento (Apollo)';
  return JOB_KIND_LABELS[job.kind];
}

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

/** Parametri della preview per kind: tutti i 7 kind hanno una preview. */
export interface JobPreviewParams {
  sync_interactions: SyncOptions;
  source_company: SourcePreviewParams;
  /** `provider: 'apollo'` = email di lavoro (conteggi `ApolloEnrichPreviewCounts`); assente = Apify. */
  enrich: EnrichPreviewParams;
  analyze: AnalyzePreviewParams;
  /** `{icpId}` = referenze dell'ICP; `{companyId}` = "Arricchisci con Apollo" dal dettaglio azienda. */
  enrich_companies: EnrichCompaniesPreviewParams;
  /**
   * Tenere i default fuori dai parametri (`pages` 1, `perPage` 25): la card e il dialog condividono la chiave.
   * `contacts` valorizzato = pipeline attiva.
   */
  lookalike_companies: LookalikePreviewParams;
  /** "Trova contatti": ICP della lista (o dell'ICP della pagina) + aziende; chiavi assenti = default dell'ICP. */
  apollo_people: ContactsPreviewParams;
}

/** Kind con una preview lato FE. */
export type PreviewJobKind = keyof JobPreviewParams;

/** Forma della preview per kind: `JobPreview` uniforme, estesa dove il server aggiunge campi. */
export interface JobPreviewResults {
  sync_interactions: JobPreview;
  source_company: JobPreview;
  enrich: EnrichPreview;
  analyze: JobPreview;
  enrich_companies: EnrichCompaniesPreview;
  lookalike_companies: LookalikePreview;
  apollo_people: ContactsPreview;
}

function fetchPreview<K extends PreviewJobKind>(kind: K, params: JobPreviewParams[K]): Promise<JobPreviewResults[K]> {
  const run = (): Promise<JobPreview> => {
    const k: PreviewJobKind = kind;
    switch (k) {
      case 'sync_interactions':
        return api.sync.preview(params as SyncOptions);
      case 'source_company':
        return api.companies.sourcePreview(params as SourcePreviewParams);
      case 'enrich':
        return api.enrich.preview(params as EnrichPreviewParams);
      case 'analyze':
        return api.analyze.preview(params as AnalyzePreviewParams);
      case 'enrich_companies': {
        const { icpId, companyId, ...opts } = params as EnrichCompaniesPreviewParams;
        return companyId !== undefined
          ? api.companies.enrichApollo.preview(companyId, opts)
          : api.enrichCompanies.preview(icpId!, opts);
      }
      case 'lookalike_companies': {
        const { icpId, ...input } = params as LookalikePreviewParams;
        return api.lookalike.preview(icpId, input);
      }
      case 'apollo_people':
        return api.contacts.preview(params as ContactsPreviewParams);
      default: {
        const unreachable: never = k;
        return Promise.reject(new Error(`Preview non prevista per ${String(unreachable)}`));
      }
    }
  };
  return run() as Promise<JobPreviewResults[K]>;
}

/**
 * Preview uniforme di un job (`{counts, est_cost_usd, warnings, blockers}`), sempre fresca:
 * passare `enabled: open` così si ricarica a ogni apertura del dialog. Si invalida da sola quando
 * un job parte o finisce (il blocker "job in corso" cambia).
 */
export function useJobPreview<K extends PreviewJobKind>(kind: K, params: JobPreviewParams[K], opts: { enabled?: boolean } = {}) {
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
 * `useJobStart` (409 `job_running` → toast con il testo del server; 400 `blocked` → toast "Riprova
 * bloccata: …" e `blockersOf(retry.error)` dà l'elenco da mostrare inline, come fa il `JobBanner`).
 */
export function useRetryJob(opts: { onStarted?: (job: Job, failedJobId: number) => void } = {}) {
  return useJobStart((jobId: number) => api.jobs.retry(jobId), opts);
}

// ---------------------------------------------------------------------------
// Invalidazioni
// ---------------------------------------------------------------------------

/**
 * Fine di un job (chiamata dal `JobBanner` quando vede un job passare da `running` a terminato): i job
 * scrivono ovunque, quindi si invalida **tutto** il cache tranne `['jobs', 'current']` (che ha appena dato
 * l'esito). Copre, per i job Apollo: candidate di ogni stato (`candidatesOfIcp`), dettaglio e indice ICP,
 * `lookalikeRuns`, liste e membri, prospect e Inbox, aziende con `companyCandidateOf`/`companyContactsAt`,
 * le preview aperte e lo storico dei job. Le query inattive si ricaricano al prossimo mount.
 */
export function invalidateAfterJob(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ predicate: (q) => !(q.queryKey[0] === 'jobs' && q.queryKey[1] === 'current') });
}

/**
 * Dopo un cambio di stato delle candidate (riga, bulk, card "Candidata per ICP") o una promozione a referenza
 * con `candidate_removed`: candidate dell'ICP in ogni stato (conteggi dei filtri e della card), statistiche
 * di "Ricerche precedenti" e card "Candidata per ICP" delle aziende toccate (tutte se `companyIds` manca).
 * Niente preview: nessuna dipende dallo stato delle candidate ("Trova contatti" riceve gli id delle aziende).
 */
export function invalidateCandidateQueries(queryClient: QueryClient, icpId: number, companyIds?: readonly number[]): Promise<void> {
  const companies = companyIds
    ? companyIds.map((id) => queryClient.invalidateQueries({ queryKey: queryKeys.companyCandidateOf(id) }))
    : [queryClient.invalidateQueries({ queryKey: ['companies', 'candidate-of'] })];
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.candidatesOfIcp(icpId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.lookalikeRuns(icpId) }),
    ...companies,
  ]).then(() => undefined);
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

/** Errore (o avviso) di un job diviso per attribuzione (`actor:<id>: …`, `config: …`, `process: …`). */
export interface JobErrorInfo {
  source: 'actor' | 'config' | 'process' | null;
  /** Etichetta leggibile dell'origine, es. "Actor apimaestro/linkedin-profile-posts", "Apollo mixed_companies/search". */
  label: string | null;
  message: string;
  /**
   * Rimedio da mostrare accanto al messaggio (FLOW Error paths) per gli errori di configurazione Apollo
   * riconosciuti: chiave senza permessi (403, "master key"), chiave rifiutata (401), chiave mancante.
   * `null` = nessun rimedio noto oltre al messaggio.
   */
  remedy: string | null;
  /** Serve un intervento sulla configurazione (`config:`): il banner resta rosso finché non lo si chiude. */
  actionRequired: boolean;
}

export interface DescribeJobErrorOptions {
  /** Il rimedio può suggerire "Riprova" (job `failed`); `false` per gli avvisi di un job riuscito. Default `true`. */
  retry?: boolean;
}

/** Rimedio per i `config:` della chiave Apollo (testi di `src/apollo/client.ts` e `APOLLO_KEY_BLOCKER`). */
function apolloKeyRemedy(message: string, retry: boolean): string | null {
  const then = retry ? ', riavvia il server e usa "Riprova"' : ' e riavvia il server';
  if (/master key|non ha i permessi/i.test(message)) {
    return `Sostituisci APOLLO_API_KEY nel .env con una master key (o una chiave con il permesso di ricerca persone)${then}.`;
  }
  if (/APOLLO_API_KEY mancante/i.test(message)) return `Aggiungi APOLLO_API_KEY al .env${then}.`;
  if (/chiave Apollo rifiutata/i.test(message)) return `Correggi APOLLO_API_KEY nel .env${then}.`;
  return null;
}

export function describeJobError(error: string | null, opts: DescribeJobErrorOptions = {}): JobErrorInfo {
  const retry = opts.retry ?? true;
  const text = (error ?? '').trim();
  const apollo = /^actor:\s*apollo:([^\s:]+):\s*([\s\S]*)$/.exec(text);
  if (apollo) {
    return { source: 'actor', label: `Apollo ${apollo[1]}`, message: apollo[2] || text, remedy: null, actionRequired: false };
  }
  const actor = /^actor:\s*([^\s:]+(?:\/[^\s:]+)?):\s*([\s\S]*)$/.exec(text);
  if (actor) return { source: 'actor', label: `Actor ${actor[1]}`, message: actor[2] || text, remedy: null, actionRequired: false };
  const other = /^(config|process):\s*([\s\S]*)$/.exec(text);
  if (other) {
    const source = other[1] as 'config' | 'process';
    const message = other[2] || text;
    return {
      source,
      label: source === 'config' ? 'Configurazione' : 'Processo',
      message,
      remedy: source === 'config' ? apolloKeyRemedy(message, retry) : null,
      actionRequired: source === 'config',
    };
  }
  return { source: null, label: null, message: text || 'Job fallito senza messaggio.', remedy: null, actionRequired: false };
}

/**
 * Avviso di un job riuscito letto come un errore attribuito: gli avvisi `config:` (es. passo contatti della
 * pipeline fallito per la chiave, SPEC H3) chiedono un intervento e il banner li mostra con il rimedio.
 */
export function describeJobWarning(warning: string): JobErrorInfo {
  return describeJobError(warning, { retry: false });
}

/** Tono dell'esito: `failed` rosso, warning ambra, zero risultati neutro, altrimenti successo. */
export type JobOutcomeTone = 'running' | 'success' | 'neutral' | 'warning' | 'error';

/**
 * True se il job è terminato senza risultati (esito neutro grigio, non un errore; FLOW "0 risultati"):
 * nessuna persona per sync e sourcing, nessun bersaglio per arricchimento e analisi (con Apollo: nessuna
 * email trovata), nessuna referenza trattata per l'arricchimento aziende, nessuna azienda letta per la
 * ricerca (la pipeline non parte), nessuna persona letta per i contatti.
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
      return job.params.provider === 'apollo' ? n('targets') === 0 || n('with_email') === 0 : n('targets') === 0;
    case 'analyze':
      return n('targets') === 0 && n('analyzed') === 0;
    case 'enrich_companies':
      return n('enriched') + n('not_found') + n('key_conflicts') + n('merged') === 0;
    case 'lookalike_companies':
      return n('read') === 0;
    case 'apollo_people':
      return n('people_read') === 0;
    default: {
      const unreachable: never = job.kind;
      return unreachable;
    }
  }
}

export function jobOutcomeTone(job: Job): JobOutcomeTone {
  if (job.state === 'running') return 'running';
  if (job.state === 'failed') return 'error';
  if ((job.result?.warnings?.length ?? 0) > 0) return 'warning';
  return isZeroOutcome(job) ? 'neutral' : 'success';
}

/**
 * Link d'esito: `to` è un path concreto (`/lists/2`, `/icps/2`), `search` i parametri da passare a `<Link
 * search>` (es. `{candidates: 'proposta'}`).
 */
export interface JobOutcomeLink {
  to: string;
  search?: Record<string, string>;
  label: string;
}

const numberOr = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) ? value : null);

/**
 * Dove portare l'utente dopo un esito riuscito e non vuoto (FLOW: "Apri Inbox", "Apri lista", "Vedi
 * candidate"), nell'ordine in cui mostrarli; `[]` = nessuna azione.
 * - sync → "Apri Inbox" (non per "solo elenco dei post"); sourcing, arricchimento (entrambi i provider),
 *   analisi e contatti Apollo con `params.listId` → "Apri lista";
 * - ricerca aziende simili → "Vedi candidate" (`/icps/$id?candidates=proposta`); con la pipeline, se il passo
 *   contatti ha letto persone, prima "Apri lista" della pipeline (FLOW E.3);
 * - arricchimento aziende → nessun link (la card dell'ICP / il dettaglio azienda si aggiornano da soli).
 */
export function jobOutcomeLinks(job: Job): JobOutcomeLink[] {
  if (job.state !== 'succeeded' || isZeroOutcome(job)) return [];
  const params = job.params ?? {};
  const listLink = (id: number): JobOutcomeLink => ({ to: `/lists/${id}`, label: 'Apri lista' });
  switch (job.kind) {
    case 'sync_interactions':
      return params.postsOnly ? [] : [{ to: '/inbox', label: 'Apri Inbox' }];
    case 'lookalike_companies': {
      const links: JobOutcomeLink[] = [];
      const auto = params.autoContacts;
      const pipelineList = auto && typeof auto === 'object' ? numberOr((auto as { listId?: unknown }).listId) : null;
      // `contacts_people_read`: persone lette dal passo contatti della pipeline.
      if (pipelineList !== null && (job.result?.counts.contacts_people_read ?? 0) > 0) {
        links.push(listLink(pipelineList));
      }
      const icpId = numberOr(params.icpId);
      if (icpId !== null) links.push({ to: `/icps/${icpId}`, search: { candidates: 'proposta' }, label: 'Vedi candidate' });
      return links;
    }
    case 'enrich_companies':
      return [];
    case 'source_company':
    case 'enrich':
    case 'analyze':
    case 'apollo_people': {
      const listId = numberOr(params.listId);
      return listId !== null ? [listLink(listId)] : [];
    }
    default: {
      const unreachable: never = job.kind;
      return unreachable;
    }
  }
}
