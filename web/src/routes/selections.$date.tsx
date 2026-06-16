import { useEffect, useRef, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, csvUrl, isEmailReady, jsonUrl } from '../api/client';
import type { Bucket, Contact, Selection, SelectionItem } from '../api/types';
import { fmtDate } from '../lib/format';
import { useEnrichmentStatus, useStartEnrichment } from '../lib/pipeline';
import {
  Avatar,
  Badge,
  btn,
  Card,
  cls,
  EmptyState,
  ErrorBox,
  FitScore,
  inputCls,
  Loading,
  PageHeader,
  pushToast,
  SelectionStateBadge,
  Spinner,
  StatusBadge,
} from '../components/ui';

export const Route = createFileRoute('/selections/$date')({ component: SelectionPage });

const DAY_MS = 86_400_000;

/** Mirror client-side di isEnrichmentFresh: un tentativo recente non si ri-tenta. */
function isEnrichmentFresh(attemptAt: string | null, freshnessDays: number): boolean {
  if (!attemptAt) return false;
  return Date.now() - new Date(attemptAt).getTime() < freshnessDays * DAY_MS;
}

function SelectionPage() {
  const { date } = Route.useParams();
  const queryClient = useQueryClient();
  const selection = useQuery({ queryKey: ['selection', date], queryFn: () => api.selection(date) });
  const stats = useQuery({ queryKey: ['stats'], queryFn: api.stats });
  const enrichment = useEnrichmentStatus();

  // Quando un job di enrichment di QUESTA selezione termina, rinfresca i dati e notifica.
  const lastFinished = useRef<string | undefined>(undefined);
  useEffect(() => {
    const st = enrichment.data;
    if (!st || !st.finished_at || st.target?.date !== date) return;
    if (st.finished_at === lastFinished.current) return;
    lastFinished.current = st.finished_at;
    queryClient.invalidateQueries({ queryKey: ['selection', date] });
    queryClient.invalidateQueries({ queryKey: ['selections'] });
    queryClient.invalidateQueries({ queryKey: ['runs'] });
    if (st.state === 'succeeded' && st.result) {
      const r = st.result;
      pushToast({
        kind: 'success',
        title: 'Enrichment completato',
        description: `${r.attempted} tentati · ${r.emailsRecovered} email recuperate · ${r.draftsGenerated} bozze.`,
      });
    } else if (st.state === 'failed') {
      pushToast({ kind: 'error', title: 'Enrichment fallito', description: st.error });
    }
  }, [enrichment.data, date, queryClient]);

  const exportMut = useMutation({
    mutationFn: () => api.exportSelection(date),
    onSuccess: (updated) => {
      queryClient.setQueryData(['selection', date], updated);
      queryClient.invalidateQueries({ queryKey: ['selections'] });
      queryClient.invalidateQueries({ queryKey: ['runs'] });
      pushToast({
        kind: 'success',
        title: 'Selezione esportata',
        description: 'La lista è ora bloccata: scarica il CSV.',
      });
    },
    onError: (e) =>
      pushToast({
        kind: 'error',
        title: 'Export fallito',
        description: e instanceof Error ? e.message : undefined,
      }),
  });

  if (selection.isPending) return <Loading />;
  if (selection.isError) return <ErrorBox error={selection.error} />;

  const data = selection.data;
  const items = data.items;
  const exported = data.state === 'exported';
  const jobRunning = enrichment.data?.state === 'running';
  const jobRunningHere = jobRunning && enrichment.data?.target?.date === date;
  const freshnessDays = stats.data?.freshnessDays ?? 90;
  const result = enrichment.data?.target?.date === date ? enrichment.data?.result : undefined;
  const freelance = items.filter((i) => i.sel_bucket === 'freelance');
  const azienda = items.filter((i) => i.sel_bucket === 'azienda');

  return (
    <>
      <PageHeader
        title={`Selezione · ${fmtDate(date)}`}
        subtitle={
          exported
            ? 'Selezione esportata: lista in sola lettura.'
            : 'Rimuovi chi non convince, arricchisci le email mancanti, poi esporta.'
        }
        actions={
          <>
            {!exported && (
              <button
                type="button"
                className={btn.primary}
                disabled={exportMut.isPending || items.length === 0}
                onClick={() => exportMut.mutate()}
              >
                ✓ Esporta
              </button>
            )}
            <a href={csvUrl(date)} download className={btn.ghost}>
              ⬇ CSV
            </a>
            <a href={jsonUrl(date)} download className={btn.ghost}>
              JSON
            </a>
            <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden="true" />
            <a
              href={csvUrl(date, { email: 'with' })}
              download
              title="Esporta solo i contatti con email (pronti per l'invio)"
              className={btn.ghost}
            >
              ⬇ Solo email-ready
            </a>
          </>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2 text-sm text-slate-500">
        <SelectionStateBadge state={data.state} />
        {data.run_id ? (
          <span>
            Generata dal Run{' '}
            <Link to="/runs" className="font-mono text-slate-700 hover:underline">
              {data.run_id}
            </Link>
          </span>
        ) : (
          <span>Selezione legacy (nessun Run collegato).</span>
        )}
      </div>

      {result && (
        <div className="mb-5">
          <Card>
            <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm text-slate-600">
              {jobRunningHere && <Spinner className="size-4 border-slate-300 border-t-slate-600" />}
              <span className="font-medium">Esito ultimo enrichment:</span>
              <span>
                {result.attempted} tentati · {result.emailsRecovered} email · {result.draftsGenerated} bozze
                {result.skippedFresh ? ` · ${result.skippedFresh} saltati (freschi)` : ''}.
              </span>
            </div>
          </Card>
        </div>
      )}

      {items.length === 0 && (
        <div className="mb-6">
          <Card>
            <EmptyState
              title="Selezione vuota"
              hint="Aggiungi contatti dal pool con i pannelli qui sotto, oppure rilancia il run giornaliero."
            />
          </Card>
        </div>
      )}

      <div className="grid items-start gap-6 xl:grid-cols-2">
        <BucketPanel
          date={date}
          bucket="freelance"
          rows={freelance}
          exported={exported}
          jobRunning={jobRunning}
          freshnessDays={freshnessDays}
        />
        <BucketPanel
          date={date}
          bucket="azienda"
          rows={azienda}
          exported={exported}
          jobRunning={jobRunning}
          freshnessDays={freshnessDays}
        />
      </div>
    </>
  );
}

function ToEnrichBadge({ c, fresh }: { c: SelectionItem; fresh: boolean }) {
  if (c.last_enrichment_attempt_at) {
    return fresh ? (
      <Badge color="gray">tentato di recente</Badge>
    ) : (
      <Badge color="amber">tentato, nessuna email</Badge>
    );
  }
  return <Badge color="gray">mai tentato</Badge>;
}

function SelectionRow({
  c,
  onRemove,
  removing,
  onEnrich,
  enriching,
  exported,
  jobRunning,
  freshnessDays,
}: {
  c: SelectionItem;
  onRemove: (id: number) => void;
  removing: boolean;
  onEnrich: (id: number) => void;
  enriching: boolean;
  exported: boolean;
  jobRunning: boolean;
  freshnessDays: number;
}) {
  const hasEmail = isEmailReady(c.email);
  const fresh = isEnrichmentFresh(c.last_enrichment_attempt_at, freshnessDays);
  const needsDraft = hasEmail && !c.email_subject;

  return (
    <li className="group flex items-center gap-3 px-4 py-3">
      <span className="w-5 text-right text-xs font-semibold tabular-nums text-slate-400">{c.rank}</span>
      <Avatar name={c.full_name} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate">
          <Link
            to="/contacts/$id"
            params={{ id: String(c.id) }}
            className="truncate text-sm font-medium hover:underline"
          >
            {c.full_name ?? c.linkedin_url}
          </Link>
          {hasEmail ? (
            <span title={c.email ?? undefined} className="text-xs text-emerald-600">
              ✉
            </span>
          ) : (
            <span title="Email mancante" className="text-xs text-slate-300">
              ✉
            </span>
          )}
          {needsDraft && <Badge color="amber">bozza da rigenerare</Badge>}
          {!hasEmail && <ToEnrichBadge c={c} fresh={fresh} />}
        </p>
        <p className="truncate text-xs text-slate-500">{c.headline ?? '—'}</p>
      </div>
      <FitScore value={c.fit_score} />
      {!hasEmail && !exported && (
        <button
          type="button"
          title={fresh ? 'Tentato di recente: riprova più avanti' : 'Cerca email via apimaestro'}
          className={btn.ghost}
          disabled={enriching || jobRunning || fresh}
          onClick={() => onEnrich(c.id)}
        >
          Arricchisci
        </button>
      )}
      {!exported && (
        <button
          type="button"
          title="Rimuovi dalla lista"
          className={cls(btn.danger, 'opacity-0 group-hover:opacity-100')}
          disabled={removing}
          onClick={() => onRemove(c.id)}
        >
          ✕
        </button>
      )}
    </li>
  );
}

function BucketPanel({
  date,
  bucket,
  rows,
  exported,
  jobRunning,
  freshnessDays,
}: {
  date: string;
  bucket: Bucket;
  rows: SelectionItem[];
  exported: boolean;
  jobRunning: boolean;
  freshnessDays: number;
}) {
  const [adding, setAdding] = useState(false);
  const queryClient = useQueryClient();

  const onSelectionUpdate = (updated: Selection) => {
    queryClient.setQueryData(['selection', date], updated);
    queryClient.invalidateQueries({ queryKey: ['candidates', date] });
    queryClient.invalidateQueries({ queryKey: ['selections'] });
  };

  const remove = useMutation({
    mutationFn: (contactId: number) => api.removeFromSelection(date, contactId),
    onSuccess: onSelectionUpdate,
  });
  const enrich = useStartEnrichment(date);

  const ready = rows.filter((c) => isEmailReady(c.email));
  const toEnrich = rows.filter((c) => !isEmailReady(c.email));
  const enrichable = toEnrich.filter((c) => !isEnrichmentFresh(c.last_enrichment_attempt_at, freshnessDays));

  const rowProps = (c: SelectionItem) => ({
    c,
    onRemove: remove.mutate,
    removing: remove.isPending,
    onEnrich: (id: number) => enrich.mutate({ contactId: id }),
    enriching: enrich.isPending,
    exported,
    jobRunning,
    freshnessDays,
  });

  return (
    <Card
      title={
        <span>
          <span className={bucket === 'freelance' ? 'text-sky-700' : 'text-violet-700'}>
            {bucket === 'freelance' ? 'Freelance' : 'Azienda'}
          </span>
          <span className="ml-2 font-normal text-slate-400">{rows.length} contatti</span>
        </span>
      }
      actions={
        <button
          type="button"
          className={btn.ghost}
          disabled={exported}
          onClick={() => setAdding((v) => !v)}
        >
          {adding ? 'Chiudi' : '+ Aggiungi'}
        </button>
      }
    >
      {adding && !exported && <AddPanel date={date} bucket={bucket} onAdded={onSelectionUpdate} />}

      {rows.length > 0 && (
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2 text-xs">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
            <span className="text-emerald-600">✉</span>
            {ready.length} pronti per email
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700">
            {toEnrich.length} da arricchire
          </span>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState title="Nessun contatto in questo bucket" />
      ) : (
        <>
          <div>
            <p className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
              Pronti per email · {ready.length}
            </p>
            {ready.length === 0 ? (
              <p className="px-4 py-3 text-xs text-slate-400">Nessun contatto con email in questo bucket.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {ready.map((c) => (
                  <SelectionRow key={c.id} {...rowProps(c)} />
                ))}
              </ul>
            )}
          </div>

          {toEnrich.length > 0 && (
            <div className="border-t border-amber-100 bg-amber-50/40">
              <div className="flex items-center justify-between gap-2 px-4 pt-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                  Da arricchire · {toEnrich.length}
                </p>
                {!exported && (
                  <button
                    type="button"
                    className={btn.ghost}
                    disabled={jobRunning || enrich.isPending || enrichable.length === 0}
                    onClick={() => enrich.mutate({ bucket })}
                  >
                    {jobRunning ? 'Enrichment in corso…' : `✨ Arricchisci email${enrichable.length ? ` (${enrichable.length})` : ''}`}
                  </button>
                )}
              </div>
              <p className="px-4 pb-1 text-[11px] text-amber-600/80">
                Senza email: recupera l'email via apimaestro o contatta a mano prima dell'invio.
              </p>
              <ul className="divide-y divide-amber-100">
                {toEnrich.map((c) => (
                  <SelectionRow key={c.id} {...rowProps(c)} />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      {(remove.isError || enrich.isError) && (
        <p className="border-t border-slate-100 px-4 py-2 text-xs text-red-600">
          {(remove.error ?? enrich.error) instanceof Error
            ? (remove.error ?? enrich.error as Error).message
            : 'Errore nell\'operazione.'}
        </p>
      )}
    </Card>
  );
}

const EMAIL_FILTER_OPTIONS: Array<{ value: '' | 'with' | 'without'; label: string }> = [
  { value: '', label: 'Tutti' },
  { value: 'with', label: 'Con email' },
  { value: 'without', label: 'Senza email' },
];

function AddPanel({ date, bucket, onAdded }: { date: string; bucket: Bucket; onAdded: (s: Selection) => void }) {
  const [q, setQ] = useState('');
  const [email, setEmail] = useState<'' | 'with' | 'without'>('');
  const candidates = useQuery({
    queryKey: ['candidates', date, bucket, q, email],
    queryFn: () => api.candidates(date, bucket, q, email || undefined),
  });

  const add = useMutation({
    mutationFn: (contactId: number) => api.addToSelection(date, contactId, bucket),
    onSuccess: onAdded,
  });

  return (
    <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-3">
      <div className="flex gap-2">
        <input
          className={inputCls}
          placeholder="Cerca nel pool per nome, headline o azienda…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className={cls(inputCls, 'w-auto shrink-0')}
          title="Filtra il pool per presenza email"
          value={email}
          onChange={(e) => setEmail(e.target.value as '' | 'with' | 'without')}
        >
          {EMAIL_FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {add.isError && (
        <p className="mt-2 text-xs text-red-600">
          {add.error instanceof Error ? add.error.message : "Errore nell'aggiunta."}
        </p>
      )}
      <div className="mt-2 max-h-64 overflow-y-auto">
        {candidates.isPending ? (
          <Loading label="Cerco candidati…" />
        ) : candidates.isError ? (
          <ErrorBox error={candidates.error} />
        ) : candidates.data.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-400">Nessun candidato disponibile nel pool.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {candidates.data.map((c: Contact) => (
              <li key={c.id} className="flex items-center gap-3 py-2">
                <FitScore value={c.fit_score} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-sm font-medium">
                    {c.full_name ?? c.linkedin_url}
                    <StatusBadge status={c.status} />
                  </p>
                  <p className="truncate text-xs text-slate-500">{c.headline ?? '—'}</p>
                </div>
                <button type="button" className={btn.ghost} disabled={add.isPending} onClick={() => add.mutate(c.id)}>
                  + Aggiungi
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="mt-2 text-[11px] text-slate-400">
        Pool: contatti <code className="rounded bg-slate-100 px-1">scored</code> di questo bucket non ancora presenti
        in alcuna Selezione.
      </p>
    </div>
  );
}
