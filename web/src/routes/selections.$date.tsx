import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, csvUrl, jsonUrl } from '../api/client';
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

      {rows.length === 0 ? (
        <EmptyState title="Nessun contatto in questo bucket" />
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((c) => (
            <li key={c.id} className="group flex items-center gap-3 px-4 py-3">
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
                disabled={remove.isPending}
                onClick={() => remove.mutate(c.id)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {remove.isError && (
        <p className="border-t border-slate-100 px-4 py-2 text-xs text-red-600">
          {remove.error instanceof Error ? remove.error.message : 'Errore nella rimozione.'}
        </p>
      )}
    </Card>
  );
}

function AddPanel({ date, bucket, onAdded }: { date: string; bucket: Bucket; onAdded: (s: Selection) => void }) {
  const [q, setQ] = useState('');
  const candidates = useQuery({
    queryKey: ['candidates', date, bucket, q],
    queryFn: () => api.candidates(date, bucket, q),
  });

  const add = useMutation({
    mutationFn: (contactId: number) => api.addToSelection(date, contactId, bucket),
    onSuccess: onAdded,
  });

  return (
    <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-3">
      <input
        className={inputCls}
        placeholder="Cerca nel pool per nome, headline o azienda…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
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
