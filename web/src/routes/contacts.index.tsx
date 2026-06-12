import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import {
  btn,
  BucketBadge,
  Card,
  EmptyState,
  ErrorBox,
  FitScore,
  inputCls,
  Loading,
  PageHeader,
  StatusBadge,
  td,
  th,
} from '../components/ui';

export const Route = createFileRoute('/contacts/')({ component: ContactsPage });

const PAGE_SIZE = 25;

const STATUSES = [
  ['', 'Tutti gli stati'],
  ['new', 'Nuovo'],
  ['enriched', 'Arricchito'],
  ['scored', 'Valutato'],
  ['selected', 'Selezionato'],
  ['exported', 'Esportato'],
] as const;

function ContactsPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [bucket, setBucket] = useState('');
  const [status, setStatus] = useState('');
  const [strategy, setStrategy] = useState('');
  const [page, setPage] = useState(1);

  const stats = useQuery({ queryKey: ['stats'], queryFn: api.stats });
  const contacts = useQuery({
    queryKey: ['contacts', { q, bucket, status, strategy, page }],
    queryFn: () => api.contacts({ q, bucket, status, strategy, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const resetPage = () => setPage(1);
  const totalPages = contacts.data ? Math.max(1, Math.ceil(contacts.data.total / PAGE_SIZE)) : 1;
  const selectCls = `${inputCls} w-auto`;

  return (
    <>
      <PageHeader
        title="Contatti"
        subtitle="Tutti i profili estratti, in qualunque stato della pipeline. Clicca una riga per il dettaglio."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          className={`${inputCls} max-w-72`}
          placeholder="Cerca nome, headline, azienda, email…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            resetPage();
          }}
        />
        <select
          className={selectCls}
          value={bucket}
          onChange={(e) => {
            setBucket(e.target.value);
            resetPage();
          }}
        >
          <option value="">Tutti i bucket</option>
          <option value="freelance">Freelance</option>
          <option value="azienda">Azienda</option>
          <option value="scarta">Scartati</option>
        </select>
        <select
          className={selectCls}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            resetPage();
          }}
        >
          {STATUSES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          className={selectCls}
          value={strategy}
          onChange={(e) => {
            setStrategy(e.target.value);
            resetPage();
          }}
        >
          <option value="">Tutte le strategie</option>
          {(stats.data?.strategies ?? []).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <Card>
        {contacts.isPending ? (
          <Loading />
        ) : contacts.isError ? (
          <div className="p-4">
            <ErrorBox error={contacts.error} />
          </div>
        ) : contacts.data.items.length === 0 ? (
          <EmptyState title="Nessun contatto trovato" hint="Prova ad allargare i filtri." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className={th}>Nome</th>
                    <th className={th}>Bucket</th>
                    <th className={th}>Settore</th>
                    <th className={`${th} text-right`}>Fit</th>
                    <th className={th}>Stato</th>
                    <th className={th}>Email</th>
                    <th className={th}>Strategia</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {contacts.data.items.map((c) => (
                    <tr
                      key={c.id}
                      className="cursor-pointer hover:bg-slate-50"
                      onClick={() => navigate({ to: '/contacts/$id', params: { id: String(c.id) } })}
                    >
                      <td className={td}>
                        <p className="font-medium">{c.full_name ?? '—'}</p>
                        <p className="max-w-xs truncate text-xs text-slate-500">{c.headline ?? ''}</p>
                      </td>
                      <td className={td}>
                        <BucketBadge bucket={c.bucket} />
                      </td>
                      <td className={`${td} text-slate-500`}>{c.sector ?? '—'}</td>
                      <td className={`${td} text-right`}>
                        <FitScore value={c.fit_score} />
                      </td>
                      <td className={td}>
                        <StatusBadge status={c.status} />
                      </td>
                      <td className={`${td} max-w-44 truncate text-slate-500`}>{c.email ?? '—'}</td>
                      <td className={`${td} max-w-44 truncate text-xs text-slate-400`}>{c.source_strategy ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
              <p className="text-xs text-slate-500">
                {contacts.data.total} contatti · pagina {page} di {totalPages}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={btn.ghost}
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  ← Prec
                </button>
                <button
                  type="button"
                  className={btn.ghost}
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Succ →
                </button>
              </div>
            </div>
          </>
        )}
      </Card>
    </>
  );
}
