import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, csvUrl, isEmailReady, jsonUrl } from '../api/client';
import type { Bucket, Contact, Selection, SelectionItem } from '../api/types';
import { fmtDate } from '../lib/format';
import {
  Avatar,
  btn,
  Card,
  cls,
  EmptyState,
  ErrorBox,
  FitScore,
  inputCls,
  Loading,
  PageHeader,
  StatusBadge,
} from '../components/ui';

export const Route = createFileRoute('/selections/$date')({ component: SelectionPage });

function SelectionPage() {
  const { date } = Route.useParams();
  const selection = useQuery({ queryKey: ['selection', date], queryFn: () => api.selection(date) });

  if (selection.isPending) return <Loading />;
  if (selection.isError) return <ErrorBox error={selection.error} />;

  const items = selection.data.items;
  const freelance = items.filter((i) => i.sel_bucket === 'freelance');
  const azienda = items.filter((i) => i.sel_bucket === 'azienda');

  return (
    <>
      <PageHeader
        title={`Selezione · ${fmtDate(date)}`}
        subtitle={`${items.length} contatti in lista. Rimuovi chi non convince e aggiungi sostituti dal pool, poi scarica.`}
        actions={
          <>
            <a href={csvUrl(date)} download className={btn.primary}>
              ⬇ Scarica CSV
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
              ⬇ Solo email-ready (CSV)
            </a>
            <a
              href={jsonUrl(date, { email: 'with' })}
              download
              title="Esporta solo i contatti con email (pronti per l'invio)"
              className={btn.ghost}
            >
              JSON
            </a>
          </>
        }
      />

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
        <BucketPanel date={date} bucket="freelance" rows={freelance} />
        <BucketPanel date={date} bucket="azienda" rows={azienda} />
      </div>
    </>
  );
}

function SelectionRow({
  c,
  onRemove,
  removing,
}: {
  c: SelectionItem;
  onRemove: (id: number) => void;
  removing: boolean;
}) {
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
          {c.email ? (
            <span title={c.email} className="text-xs text-emerald-600">
              ✉
            </span>
          ) : (
            <span title="Email mancante" className="text-xs text-slate-300">
              ✉
            </span>
          )}
        </p>
        <p className="truncate text-xs text-slate-500">{c.headline ?? '—'}</p>
      </div>
      <FitScore value={c.fit_score} />
      <button
        type="button"
        title="Rimuovi dalla lista"
        className={cls(btn.danger, 'opacity-0 group-hover:opacity-100')}
        disabled={removing}
        onClick={() => onRemove(c.id)}
      >
        ✕
      </button>
    </li>
  );
}

function BucketPanel({ date, bucket, rows }: { date: string; bucket: Bucket; rows: SelectionItem[] }) {
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

  const ready = rows.filter((c) => isEmailReady(c.email));
  const toEnrich = rows.filter((c) => !isEmailReady(c.email));

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
        <button type="button" className={btn.ghost} onClick={() => setAdding((v) => !v)}>
          {adding ? 'Chiudi' : '+ Aggiungi'}
        </button>
      }
    >
      {adding && <AddPanel date={date} bucket={bucket} onAdded={onSelectionUpdate} />}

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
                  <SelectionRow key={c.id} c={c} onRemove={remove.mutate} removing={remove.isPending} />
                ))}
              </ul>
            )}
          </div>

          {toEnrich.length > 0 && (
            <div className="border-t border-amber-100 bg-amber-50/40">
              <p className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                Da arricchire · {toEnrich.length}
              </p>
              <p className="px-4 pb-1 text-[11px] text-amber-600/80">
                Senza email: da arricchire o contattare a mano prima dell'invio.
              </p>
              <ul className="divide-y divide-amber-100">
                {toEnrich.map((c) => (
                  <SelectionRow key={c.id} c={c} onRemove={remove.mutate} removing={remove.isPending} />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      {remove.isError && (
        <p className="border-t border-slate-100 px-4 py-2 text-xs text-red-600">
          {remove.error instanceof Error ? remove.error.message : 'Errore nella rimozione.'}
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
        Pool: contatti già valutati di questo bucket non presenti nella lista. "Esportato" = già incluso in una
        selezione passata.
      </p>
    </div>
  );
}
