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
  Loading,
  PageHeader,
  StatusBadge,
  td,
  th,
} from '../components/ui';
import { FilterBar } from '@/components/filters/FilterBar';
import { FilterChips, type ActiveFilterChip } from '@/components/filters/FilterChips';
import { EMAIL_FILTER_OPTIONS } from '@/components/filters/emailOptions';

type ContactSearch = {
  q?: string;
  bucket?: string;
  status?: string;
  strategy?: string;
  email?: 'with' | 'without';
  emailReady?: boolean;
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
    // Modalità export "solo email-ready": persistita come booleano (URL pulito
    // `emailReady=true`) quando attiva, omessa (default-stripped) e validata in
    // modo stretto altrimenti — qualsiasi valore ≠ true viene scartato (OQ-1 = sì).
    emailReady: s.emailReady === true ? true : undefined,
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

const BUCKETS = [
  ['', 'Tutti i bucket'],
  ['freelance', 'Freelance'],
  ['azienda', 'Azienda'],
  ['scarta', 'Scartati'],
] as const;

function ContactsPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const updateSearch = Route.useNavigate();
  const { q, bucket, status, strategy, email } = search;
  const page = search.page ?? 1;
  // "solo email-ready" è ora stato URL (chip + deep-link/reload), non più useState.
  const emailReady = search.emailReady === true;

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
  // "solo email-ready" è un modificatore dell'export, non un filtro della lista:
  // attivarlo/disattivarlo NON cambia la lista visibile → la pagina NON va resettata.
  const setEmailReady = (on: boolean) =>
    updateSearch({ search: (prev) => ({ ...prev, emailReady: on ? true : undefined }) });
  // "Pulisci": azzera tutti i filtri (incl. emailReady) e riporta la pagina a 1, in un solo navigate.
  const clearAllFilters = () =>
    updateSearch({
      search: (prev) => ({
        ...prev,
        q: undefined,
        bucket: undefined,
        status: undefined,
        strategy: undefined,
        email: undefined,
        emailReady: undefined,
        page: undefined,
      }),
    });

  const totalPages = contacts.data ? Math.max(1, Math.ceil(contacts.data.total / PAGE_SIZE)) : 1;

  // Chip dei soli filtri attivi (etichetta umana + ✕). Riusa le stesse opzioni
  // della barra per le label. Facile da estendere (es. T3: "Export: solo email-ready").
  const labelOf = (
    options: ReadonlyArray<readonly [string, string]> | ReadonlyArray<{ value: string; label: string }>,
    value: string,
  ): string => {
    for (const o of options) {
      if (Array.isArray(o)) {
        if (o[0] === value) return o[1] as string;
      } else if ((o as { value: string }).value === value) {
        return (o as { label: string }).label;
      }
    }
    return value;
  };
  const activeChips: ActiveFilterChip[] = [];
  if (q) activeChips.push({ key: 'q', label: `Cerca: ${q}`, onClear: () => setFilter('q', '') });
  if (bucket)
    activeChips.push({ key: 'bucket', label: `Bucket: ${labelOf(BUCKETS, bucket)}`, onClear: () => setFilter('bucket', '') });
  if (status)
    activeChips.push({ key: 'status', label: `Stato: ${labelOf(STATUSES, status)}`, onClear: () => setFilter('status', '') });
  if (strategy)
    activeChips.push({ key: 'strategy', label: `Strategia: ${strategy}`, onClear: () => setFilter('strategy', '') });
  if (email)
    activeChips.push({
      key: 'email',
      label: `Email: ${labelOf(EMAIL_FILTER_OPTIONS, email)}`,
      onClear: () => setFilter('email', ''),
    });
  if (emailReady)
    activeChips.push({
      key: 'emailReady',
      label: 'Export: solo email-ready',
      // ✕ pulisce solo emailReady, preservando la pagina (non è un filtro lista).
      onClear: () => setEmailReady(false),
    });

  // Filtri correnti per l'export; il toggle "solo email-ready" forza email=with.
  const exportFilters: ContactFilters = {
    q,
    bucket,
    status,
    strategy,
    email: emailReady ? 'with' : email,
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
                checked={emailReady}
                onChange={(e) => setEmailReady(e.target.checked)}
              />
              solo email-ready
            </label>
          </>
        }
      />

      <div className="mb-4 space-y-2">
        <FilterBar
          search={{
            value: q ?? '',
            onChange: (v) => setFilter('q', v),
            placeholder: 'Cerca nome, headline, azienda, email…',
          }}
          selects={[
            {
              key: 'bucket',
              label: 'Tutti i bucket',
              value: bucket ?? '',
              onChange: (v) => setFilter('bucket', v),
              options: BUCKETS.map(([value, label]) => ({ value, label })),
            },
            {
              key: 'status',
              label: 'Tutti gli stati',
              value: status ?? '',
              onChange: (v) => setFilter('status', v),
              options: STATUSES.map(([value, label]) => ({ value, label })),
            },
            {
              key: 'strategy',
              label: 'Tutte le strategie',
              value: strategy ?? '',
              onChange: (v) => setFilter('strategy', v),
              options: [
                { value: '', label: 'Tutte le strategie' },
                ...(stats.data?.strategies ?? []).map((s) => ({ value: s, label: s })),
              ],
            },
            {
              key: 'email',
              label: 'Tutti',
              value: email ?? '',
              onChange: (v) => setFilter('email', v),
              options: EMAIL_FILTER_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
            },
          ]}
        />
        <FilterChips chips={activeChips} onClearAll={clearAllFilters} />
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
