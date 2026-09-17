import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { api, isApiError, queryKeys } from '../api/client';
import type { Job, Post, PostSyncState, Readiness, Settings } from '../api/types';
import { SyncDialog } from '../components/SyncDialog';
import { Card, ErrorBox, Loading, PageHeader, Spinner } from '../components/ui';
import { dismissToast, toast } from '../components/ui/toaster';
import {
  JOB_KIND_LABELS,
  describeJobError,
  formatDuration,
  jobOutcomeTone,
  useCurrentJob,
  useRetryJob,
  type JobOutcomeTone,
} from '../lib/jobs';

export const Route = createFileRoute('/settings')({ component: SettingsPage });

/*
 * Impostazioni (crm-foundation T14, FLOW A.2 e B): profilo LinkedIn (URL pubblico, errore inline dal
 * 400 del server), la mia azienda (testi per l'analisi AI), configurazione (readiness di Apify,
 * Anthropic e Apollo, apollo-lookalike T12a), i miei post con "Sincronizza interazioni" (dialog di T13)
 * e gli ultimi job con Riprova sui falliti. Gli esiti dei job li notifica il JobBanner.
 */

const labelCls = 'text-xs font-medium text-slate-600';
const textareaCls =
  'min-h-20 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';
const th = 'px-4 py-2 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase';
const td = 'px-4 py-2.5 align-top text-sm';

function SettingsPage() {
  const settings = useQuery({ queryKey: queryKeys.settings, queryFn: api.settings.get });

  if (settings.isPending) return <Loading />;
  if (settings.error) return <LoadError error={settings.error} onRetry={() => void settings.refetch()} />;

  return (
    <>
      <PageHeader title="Impostazioni" subtitle="Il tuo profilo LinkedIn, la tua azienda, i tuoi post e gli ultimi job." />
      <div className="flex flex-col gap-6">
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <ProfileSection settings={settings.data} />
          <CompanySection settings={settings.data} />
        </div>
        <ConfigSection readiness={settings.data.readiness} />
        <PostsSection readiness={settings.data.readiness} />
        <JobsSection />
      </div>
    </>
  );
}

function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 px-4 py-3">
      <ErrorBox error={error} />
      <Button type="button" variant="outline" onClick={onRetry}>
        Riprova
      </Button>
    </div>
  );
}

/** Testo di un errore di salvataggio: messaggi zod (`issues[]`) se presenti, altrimenti il messaggio del server. */
function errorText(err: unknown): string {
  if (isApiError(err) && err.body?.issues?.length) return err.body.issues.map((i) => i.message).join(' ');
  return err instanceof Error ? err.message : 'Salvataggio non riuscito.';
}

// ---------------------------------------------------------------------------
// Profilo LinkedIn
// ---------------------------------------------------------------------------

function ProfileSection({ settings }: { settings: Settings }) {
  const queryClient = useQueryClient();
  const uid = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState(settings.own_profile_url ?? '');
  const [error, setError] = useState<string | null>(null);

  // Deep-link `/settings#profilo` (errore "profilo mancante" di un job): porta il focus sul campo.
  useEffect(() => {
    if (window.location.hash === '#profilo') inputRef.current?.focus();
  }, []);

  const save = useMutation({
    mutationFn: (value: string) => api.settings.update({ own_profile_url: value.trim() }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.settings, data);
      // Il profilo è un blocker della preview del sync.
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobPreviews });
      setUrl(data.own_profile_url ?? '');
      setError(null);
      toast({ title: data.own_profile_url ? 'Profilo salvato' : 'Profilo rimosso' });
    },
    onError: (err) => {
      setError(errorText(err));
      inputRef.current?.focus();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate(url);
  };

  return (
    <Card title="Profilo LinkedIn">
      <form id="profilo" onSubmit={submit} noValidate className="flex scroll-mt-6 flex-col gap-3 px-4 py-4">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-url`} className={labelCls}>
            URL pubblico del tuo profilo
          </label>
          <Input
            ref={inputRef}
            id={`${uid}-url`}
            type="url"
            inputMode="url"
            autoComplete="url"
            value={url}
            placeholder="https://www.linkedin.com/in/tuo-nome/"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${uid}-error` : `${uid}-hint`}
            onChange={(e) => {
              setUrl(e.target.value);
              if (error) setError(null);
            }}
          />
          {error ? (
            <p id={`${uid}-error`} role="alert" className="text-sm text-red-700">
              {error}
            </p>
          ) : (
            <p id={`${uid}-hint`} className="text-xs text-slate-500">
              Serve a leggere chi reagisce e commenta i tuoi post. Nessun login: solo l'URL pubblico.
            </p>
          )}
        </div>
        {settings.own_profile_url && (
          <p className="text-sm text-slate-600">
            Salvato come{' '}
            <a
              href={settings.own_profile_url}
              target="_blank"
              rel="noreferrer"
              className="font-medium break-all text-slate-900 underline"
            >
              {settings.own_profile_url}
            </a>
          </p>
        )}
        <div>
          <Button type="submit" disabled={save.isPending} aria-busy={save.isPending}>
            {save.isPending ? 'Salvataggio…' : 'Salva profilo'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// La mia azienda
// ---------------------------------------------------------------------------

type CompanyFields = Pick<Settings, 'company_name' | 'company_description' | 'company_offering'>;

function CompanySection({ settings }: { settings: Settings }) {
  const queryClient = useQueryClient();
  const uid = useId();
  const [values, setValues] = useState(() => ({
    company_name: settings.company_name ?? '',
    company_description: settings.company_description ?? '',
    company_offering: settings.company_offering ?? '',
  }));
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: CompanyFields) => api.settings.update(body),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.settings, data);
      // La descrizione vuota è un avviso nella preview dell'analisi.
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobPreviews });
      setValues({
        company_name: data.company_name ?? '',
        company_description: data.company_description ?? '',
        company_offering: data.company_offering ?? '',
      });
      setError(null);
      toast({ title: 'Azienda salvata' });
    },
    onError: (err) => setError(errorText(err)),
  });

  const field = (key: keyof typeof values) => ({
    id: `${uid}-${key}`,
    value: values[key],
    onChange: (e: { target: { value: string } }) => setValues((cur) => ({ ...cur, [key]: e.target.value })),
  });

  return (
    <Card title="La mia azienda">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(values);
        }}
        className="flex flex-col gap-3 px-4 py-4"
        aria-describedby={`${uid}-hint`}
      >
        <p id={`${uid}-hint`} className="text-xs text-slate-500">
          Usati dall'analisi AI per proporre angoli coerenti con ciò che vendi. Tutti facoltativi.
        </p>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-company_name`} className={labelCls}>
            Nome
          </label>
          <Input {...field('company_name')} placeholder="es. Officina Codice Srl" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-company_description`} className={labelCls}>
            Di cosa si occupa
          </label>
          <textarea
            {...field('company_description')}
            className={textareaCls}
            rows={3}
            placeholder="es. Sviluppiamo software gestionale su misura per PMI manifatturiere."
          />
          {!settings.readiness.company && (
            <p className="text-xs text-amber-800">Descrizione azienda vuota: gli angoli AI saranno meno mirati.</p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-company_offering`} className={labelCls}>
            Cosa offri
          </label>
          <textarea
            {...field('company_offering')}
            className={textareaCls}
            rows={3}
            placeholder="es. Assessment gratuito di 2 settimane, poi sviluppo a progetto."
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <div>
          <Button type="submit" disabled={save.isPending} aria-busy={save.isPending}>
            {save.isPending ? 'Salvataggio…' : 'Salva azienda'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Configurazione (readiness delle chiavi del .env)
// ---------------------------------------------------------------------------

/** Chiavi del `.env` lette dal server: presente = configurata; i permessi si verificano al primo job. */
const CONFIG_ROWS: ReadonlyArray<{ key: 'apify' | 'anthropic' | 'apollo'; name: string; env: string; ready: string; missing: string }> = [
  {
    key: 'apify',
    name: 'Apify',
    env: 'APIFY_TOKEN',
    ready: 'Sync delle interazioni, sourcing da azienda e arricchimento dei profili.',
    missing: 'APIFY_TOKEN mancante nel .env: sync, sourcing e arricchimento resteranno bloccati.',
  },
  {
    key: 'anthropic',
    name: 'Anthropic',
    env: 'ANTHROPIC_API_KEY',
    ready: 'Analisi AI dei prospect.',
    missing: "ANTHROPIC_API_KEY mancante nel .env: l'analisi AI resterà bloccata.",
  },
  {
    key: 'apollo',
    name: 'Apollo',
    env: 'APOLLO_API_KEY',
    ready: 'Aziende simili, contatti ed email di lavoro. I permessi della chiave si verificano al primo job.',
    missing: 'APOLLO_API_KEY mancante nel .env: aziende simili, contatti ed email via Apollo resteranno bloccati.',
  },
];

/** Readiness di Apify, Anthropic e Apollo (FLOW Entry points): una chiave mancante non blocca il resto del CRM. */
function ConfigSection({ readiness }: { readiness: Readiness }) {
  const anyMissing = CONFIG_ROWS.some((row) => !readiness[row.key]);
  return (
    <Card title="Configurazione">
      <ul className="divide-y divide-slate-100" aria-label="Chiavi dei servizi esterni">
        {CONFIG_ROWS.map((row) => {
          const ready = readiness[row.key];
          return (
            <li
              key={row.key}
              data-readiness={row.key}
              data-ready={ready}
              className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm"
            >
              <div className="min-w-0">
                <p className="font-medium text-slate-900">
                  {row.name} <span className="font-mono text-xs font-normal text-slate-500">{row.env}</span>
                </p>
                <p className={cn('mt-0.5', ready ? 'text-slate-600' : 'text-red-800')}>{ready ? row.ready : row.missing}</p>
              </div>
              <span
                className={cn(
                  'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
                  ready ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800',
                )}
              >
                {ready ? 'Configurata' : 'Mancante'}
              </span>
            </li>
          );
        })}
      </ul>
      {anyMissing && (
        <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-600">
          Aggiungi le chiavi al file .env e riavvia il server.
        </p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// I miei post + Sincronizza interazioni
// ---------------------------------------------------------------------------

const rtf = new Intl.RelativeTimeFormat('it', { numeric: 'auto' });

/** "5 minuti fa", "ieri", "3 giorni fa"; oltre un mese la data. */
function fmtRelative(iso: string, now = Date.now()): string {
  const diff = (Date.parse(iso) - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return 'adesso';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 30 * 86_400) return rtf.format(Math.round(diff / 86_400), 'day');
  return fmtDay(iso);
}

function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function Time({ iso, relative = false }: { iso: string; relative?: boolean }) {
  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString('it-IT')}>
      {relative ? fmtRelative(iso) : fmtDay(iso)}
    </time>
  );
}

const nf = (value: number | null) => (value === null ? '—' : value.toLocaleString('it-IT'));

const POST_STATE: Record<PostSyncState, { label: string; className: string }> = {
  synced: { label: 'Sincronizzato', className: 'bg-emerald-100 text-emerald-800' },
  to_sync: { label: 'Da sincronizzare', className: 'bg-sky-100 text-sky-800' },
  archived: { label: 'Archiviato', className: 'bg-slate-100 text-slate-600' },
  error: { label: 'Errore', className: 'bg-red-100 text-red-800' },
};

function PostsSection({ readiness }: { readiness: Readiness }) {
  const [syncOpen, setSyncOpen] = useState(false);
  const hintId = useId();
  const posts = useQuery({ queryKey: queryKeys.posts, queryFn: api.sync.posts });
  const current = useCurrentJob();
  const job = current.data?.job ?? null;
  const syncJob = job?.state === 'running' && job.kind === 'sync_interactions' ? job : null;

  const items = posts.data?.items ?? [];
  const hasArchived = items.some((p) => p.sync_state === 'archived');

  return (
    <Card
      title="I miei post"
      actions={
        <div className="flex flex-col items-end gap-1">
          <Button
            type="button"
            onClick={() => setSyncOpen(true)}
            disabled={!readiness.profile}
            aria-describedby={readiness.profile ? undefined : hintId}
          >
            Sincronizza interazioni
          </Button>
          {!readiness.profile && (
            <p id={hintId} className="text-xs text-slate-500">
              Salva prima il tuo profilo LinkedIn.
            </p>
          )}
        </div>
      }
    >
      {syncJob && (
        <p role="status" className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2 text-sm text-slate-700">
          <Spinner className="size-3.5 border-slate-300 border-t-slate-600" />
          {syncJob.params.postsOnly
            ? "Aggiornamento dell'elenco dei post in corso: la tabella si aggiorna al termine."
            : 'Sync in corso: la tabella si aggiorna al termine.'}
        </p>
      )}

      {posts.isPending ? (
        <Loading label="Caricamento post…" />
      ) : posts.error ? (
        <LoadError error={posts.error} onRetry={() => void posts.refetch()} />
      ) : items.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-slate-500">
          {readiness.profile ? (
            <>
              <p className="font-medium text-slate-700">Nessun post ancora.</p>
              <p className="mt-1">
                Sincronizza per leggere i tuoi ultimi post e chi ha interagito. Al primo sync puoi anche aggiornare solo
                l'elenco dei post e vedere la stima reale prima di spendere.
              </p>
            </>
          ) : (
            <p>Salva il tuo profilo LinkedIn qui sopra: poi potrai sincronizzare i tuoi post.</p>
          )}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-slate-100">
                <tr>
                  <th scope="col" className={th}>
                    Data
                  </th>
                  <th scope="col" className={th}>
                    Post
                  </th>
                  <th scope="col" className={cn(th, 'text-right')}>
                    Reazioni
                  </th>
                  <th scope="col" className={cn(th, 'text-right')}>
                    Commenti
                  </th>
                  <th scope="col" className={cn(th, 'text-right')}>
                    Prospect generati
                  </th>
                  <th scope="col" className={th}>
                    Ultimo sync
                  </th>
                  <th scope="col" className={th}>
                    Stato
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((post) => (
                  <PostRow key={post.id} post={post} syncJob={syncJob} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
            Reazioni e commenti: dichiarati dal post (sotto, quanti ne sono stati letti).
            {hasArchived &&
              " Archiviato = post più vecchio di POST_RECENCY_DAYS (default 90 giorni): si rilegge solo con 'Risincronizza tutto'."}
          </p>
        </>
      )}

      <SyncDialog open={syncOpen} onOpenChange={setSyncOpen} />
    </Card>
  );
}

function PostRow({ post, syncJob }: { post: Post; syncJob: Job | null }) {
  // Righe toccate dal sync in corso: quelle da sincronizzare (tutte con "Risincronizza tutto").
  const syncing =
    syncJob !== null &&
    !syncJob.params.postsOnly &&
    (syncJob.params.force === true || post.sync_state === 'to_sync' || post.sync_state === 'error');
  const state = POST_STATE[post.sync_state];
  const err = post.sync_error ? describeJobError(post.sync_error) : null;
  // Letti: anche su un post non marcato (errore o warning) se qualcosa è stato letto.
  const read = post.last_synced_at !== null || post.reactions_read + post.comments_read > 0;

  return (
    <tr>
      <td className={cn(td, 'whitespace-nowrap text-slate-600')}>{post.posted_at ? <Time iso={post.posted_at} /> : '—'}</td>
      <td className={cn(td, 'max-w-md')}>
        <a
          href={post.post_url}
          target="_blank"
          rel="noreferrer"
          className="line-clamp-2 text-slate-900 hover:underline"
          title={post.text_excerpt ?? undefined}
        >
          {post.text_excerpt || 'Post senza testo'}
        </a>
      </td>
      <td className={cn(td, 'text-right tabular-nums')}>
        {nf(post.reactions_count)}
        {read && <span className="block text-xs text-slate-500">{nf(post.reactions_read)} lette</span>}
      </td>
      <td className={cn(td, 'text-right tabular-nums')}>
        {nf(post.comments_count)}
        {read && <span className="block text-xs text-slate-500">{nf(post.comments_read)} letti</span>}
      </td>
      <td className={cn(td, 'text-right tabular-nums')}>{nf(post.prospects_count)}</td>
      <td className={cn(td, 'whitespace-nowrap text-slate-600')}>
        {post.last_synced_at ? <Time iso={post.last_synced_at} relative /> : 'mai'}
      </td>
      <td className={td}>
        {syncing ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
            <Spinner className="size-3 border-slate-300 border-t-slate-600" />
            sync in corso…
          </span>
        ) : (
          <>
            <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', state.className)}>
              {state.label}
            </span>
            {err && (
              <p className="mt-1 max-w-xs text-xs break-words text-red-800" title={post.sync_error ?? undefined}>
                {err.label && <span className="font-semibold">{err.label}: </span>}
                <span className="line-clamp-3">{err.message}</span>
                <span className="block text-slate-500">Il prossimo sync lo riprende.</span>
              </p>
            )}
          </>
        )}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Ultimi job
// ---------------------------------------------------------------------------

const JOBS_LIMIT = 20;

const JOB_STATE: Record<JobOutcomeTone, { label: string; className: string }> = {
  running: { label: 'In corso', className: 'bg-sky-100 text-sky-800' },
  success: { label: 'Completato', className: 'bg-emerald-100 text-emerald-800' },
  neutral: { label: 'Nessun risultato', className: 'bg-slate-100 text-slate-700' },
  warning: { label: 'Attenzione', className: 'bg-amber-100 text-amber-900' },
  error: { label: 'Errore', className: 'bg-red-100 text-red-800' },
};

function JobsSection() {
  const queryClient = useQueryClient();
  const jobs = useQuery({ queryKey: queryKeys.jobsIndex(JOBS_LIMIT), queryFn: () => api.jobs.list(JOBS_LIMIT) });
  const current = useCurrentJob();
  const currentJob = current.data?.job ?? null;
  const anyRunning = currentJob?.state === 'running';

  // Un job partito o finito (da qui, dal banner o da un'altra pagina) cambia lo storico. `undefined`
  // = job corrente non ancora caricato (non è un cambiamento), `none` = nessun job mai lanciato.
  const signature = current.data === undefined ? undefined : currentJob ? `${currentJob.id}:${currentJob.state}` : 'none';
  const lastSignature = useRef(signature);
  useEffect(() => {
    const previous = lastSignature.current;
    lastSignature.current = signature;
    if (previous === undefined || previous === signature) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.jobsIndex(JOBS_LIMIT) });
  }, [signature, queryClient]);

  const retry = useRetryJob({
    // Il nuovo job prende il posto del fallito nel banner: chiude anche la notifica del fallito
    // (id `job-outcome-<id>` del JobBanner), come fa "Riprova" nel banner.
    onStarted: (job, failedJobId) => {
      dismissToast(`job-outcome-${failedJobId}`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobsIndex(JOBS_LIMIT) });
      toast({ tone: 'neutral', title: `${JOB_KIND_LABELS[job.kind]} riavviato`, description: `Nuovo job #${job.id} con gli stessi parametri.` });
    },
  });

  const items = jobs.data?.items ?? [];
  const runningHintId = useId();

  return (
    <Card title={`Ultimi job${items.length > 0 ? ` (${items.length})` : ''}`}>
      {jobs.isPending ? (
        <Loading label="Caricamento job…" />
      ) : jobs.error ? (
        <LoadError error={jobs.error} onRetry={() => void jobs.refetch()} />
      ) : items.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-slate-500">
          Nessun job ancora: partono da Sincronizza interazioni, Estrai persone, Arricchisci e Analizza.
        </p>
      ) : (
        <>
          {anyRunning && (
            <p id={runningHintId} className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-600">
              C'è un job in corso: "Riprova" si riattiva quando termina.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-slate-100">
                <tr>
                  <th scope="col" className={th}>
                    Job
                  </th>
                  <th scope="col" className={th}>
                    Stato
                  </th>
                  <th scope="col" className={th}>
                    Avviato
                  </th>
                  <th scope="col" className={th}>
                    Durata
                  </th>
                  <th scope="col" className={th}>
                    Esito
                  </th>
                  <th scope="col" className={th}>
                    <span className="sr-only">Azioni</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((job) => {
                  const retrying = retry.isPending && retry.variables === job.id;
                  return (
                    <tr key={job.id} data-job-id={job.id} data-job-state={job.state}>
                      <td className={cn(td, 'whitespace-nowrap')}>
                        <span className="font-medium text-slate-900">{JOB_KIND_LABELS[job.kind]}</span>
                        <span className="block text-xs text-slate-500">
                          #{job.id}
                          {jobParamsNote(job) && ` · ${jobParamsNote(job)}`}
                        </span>
                      </td>
                      <td className={td}>
                        <JobStateBadge job={job} />
                      </td>
                      <td className={cn(td, 'whitespace-nowrap text-slate-600')}>
                        {job.started_at ? (
                          <time dateTime={job.started_at}>{fmtDateTime(job.started_at)}</time>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className={cn(td, 'whitespace-nowrap tabular-nums text-slate-600')}>
                        {job.state === 'running' ? 'in corso' : formatDuration(job.started_at, job.finished_at)}
                      </td>
                      <td className={cn(td, 'max-w-xl')}>
                        <JobOutcome job={job} />
                      </td>
                      <td className={cn(td, 'text-right')}>
                        {job.state === 'failed' && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => retry.mutate(job.id)}
                            disabled={anyRunning || retry.isPending}
                            aria-busy={retrying}
                            aria-label={`Riprova job #${job.id} (${JOB_KIND_LABELS[job.kind]})`}
                            aria-describedby={anyRunning ? runningHintId : undefined}
                          >
                            {retrying ? 'Avvio…' : 'Riprova'}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

/** Opzioni rilevanti del job, per distinguere le righe ("Risincronizza tutto", "solo elenco post"…). */
function jobParamsNote(job: Job): string | null {
  const p = job.params;
  const notes: string[] = [];
  if (p.postsOnly === true) notes.push('solo elenco post');
  if (p.force === true) notes.push(job.kind === 'sync_interactions' ? 'risincronizza tutto' : 'forzato');
  if (Array.isArray(p.prospectIds)) notes.push(`${p.prospectIds.length} selezionati`);
  if (typeof p.mode === 'string') notes.push(p.mode);
  return notes.length > 0 ? notes.join(' · ') : null;
}

function JobStateBadge({ job }: { job: Job }) {
  const state = JOB_STATE[jobOutcomeTone(job)];
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', state.className)}>
      {job.state === 'running' && <Spinner className="size-2.5 border-sky-300 border-t-sky-700" />}
      {state.label}
    </span>
  );
}

function JobOutcome({ job }: { job: Job }): ReactNode {
  if (job.state === 'running') return <span className="text-slate-500">—</span>;
  if (job.state === 'failed') {
    const err = describeJobError(job.error);
    return (
      <p className="text-sm break-words text-red-800">
        {err.label && <span className="font-semibold">{err.label}: </span>}
        {err.message}
      </p>
    );
  }
  const warnings = job.result?.warnings ?? [];
  return (
    <div className="text-sm text-slate-700">
      <p className="break-words">{job.result?.summary ?? 'Job completato.'}</p>
      {warnings.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-amber-900">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
