import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, contactsCsvUrl, contactsJsonUrl } from '../api/client';
import type { ContactFilters } from '../api/types';
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

type ContactSearch = {
  q?: string;
  bucket?: string;
  status?: string;
  strategy?: string;
  email?: 'with' | 'without';
  page?: number;
};

const validateSearch = (s: Record<string, unknown>): ContactSearch => {
  const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined);
  const n = Number(s.page);
  return {
    q: str(s.q),
    bucket: str(s.bucket),
    status: str(s.status),
    strategy: str(s.strategy),
    email: s.email === 'with' || s.email === 'without' ? s.email : undefined,
    page: Number.isInteger(n) && n > 1 ? n : undefined, // default 1 ⇒ omesso
  };
};

export const Route = createFileRoute('/contacts/')({ component: ContactsPage, validateSearch });

const PAGE_SIZE = 25;

const STATUSES = [
  ['', 'Tutti gli stati'],
  ['new', 'Nuovo'],
  ['enriched', 'Arricchito'],
  ['scored', 'Valutato'],
  ['selected', 'Selezionato'],
  ['exported', 'Esportato'],
] as const;

const EMAIL_OPTIONS = [
  ['', 'Tutti'],
  ['with', 'Con email'],
  ['without', 'Senza email'],
] as const;

function ContactsPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const updateSearch = Route.useNavigate();
  const { q, bucket, status, strategy, email } = search;
  const page = search.page ?? 1;

  // Toggle locale (non persistito nell'URL): incide solo sull'href di download.
  const [onlyEmailReady, setOnlyEmailReady] = useState(false);

  const stats = useQuery({ queryKey: ['stats'], queryFn: api.stats });
  const contacts = useQuery({
    queryKey: ['contacts', { q, bucket, status, strategy, email, page }],
    queryFn: () => api.contacts({ q, bucket, status, strategy, email, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  // Cambiare un filtro azzera la pagina a 1 (page=undefined ⇒ omesso dall'URL).
  const setFilter = (field: keyof ContactSearch, value: string) =>
    updateSearch({ search: (prev) => ({ ...prev, [field]: value || undefined, page: undefined }) });
  const goToPage = (p: number) =>
    updateSearch({ search: (prev) => ({ ...prev, page: p > 1 ? p : undefined }) });

  const totalPages = contacts.data ? Math.max(1, Math.ceil(contacts.data.total / PAGE_SIZE)) : 1;
  const selectCls = `${inputCls} w-auto`;

  // Filtri correnti per l'export; il toggle "solo email-ready" forza email=with.
  const exportFilters: ContactFilters = {
    q,
    bucket,
    status,
    strategy,
    email: onlyEmailReady ? 'with' : email,
  };

  return (
    <>
      <PageHeader
        title="Contatti"
        subtitle="Tutti i profili estratti, in qualunque stato della pipeline. Clicca una riga per il dettaglio."
        actions={
          <>
            <a href={contactsCsvUrl(exportFilters)} download className={btn.primary}>
              ⬇ Scarica CSV
            </a>
            <a href={contactsJsonUrl(exportFilters)} download className={btn.ghost}>
              JSON
            </a>
            <label className="ml-1 inline-flex cursor-pointer items-center gap-1.5 text-sm text-slate-600">
              <input
                type="checkbox"
                className="size-4 cursor-pointer accent-slate-900"
                checked={onlyEmailReady}
                onChange={(e) => setOnlyEmailReady(e.target.checked)}
              />
              solo email-ready
            </label>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          className={`${inputCls} max-w-72`}
          placeholder="Cerca nome, headline, azienda, email…"
          value={q ?? ''}
          onChange={(e) => setFilter('q', e.target.value)}
        />
        <select className={selectCls} value={bucket ?? ''} onChange={(e) => setFilter('bucket', e.target.value)}>
          <option value="">Tutti i bucket</option>
          <option value="freelance">Freelance</option>
          <option value="azienda">Azienda</option>
          <option value="scarta">Scartati</option>
        </select>
        <select className={selectCls} value={status ?? ''} onChange={(e) => setFilter('status', e.target.value)}>
          {STATUSES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select className={selectCls} value={strategy ?? ''} onChange={(e) => setFilter('strategy', e.target.value)}>
          <option value="">Tutte le strategie</option>
          {(stats.data?.strategies ?? []).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select className={selectCls} value={email ?? ''} onChange={(e) => setFilter('email', e.target.value)}>
          {EMAIL_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
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
                  onClick={() => goToPage(page - 1)}
                >
                  ← Prec
                </button>
                <button
                  type="button"
                  className={btn.ghost}
                  disabled={page >= totalPages}
                  onClick={() => goToPage(page + 1)}
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
