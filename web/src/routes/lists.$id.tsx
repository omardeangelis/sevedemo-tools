import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Building2Icon, DownloadIcon } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FilterBar, type FilterSelectConfig } from '@/components/filters/FilterBar';
import { FilterChips, type ActiveFilterChip } from '@/components/filters/FilterChips';
import { EMAIL_FILTER_OPTIONS } from '@/components/filters/emailOptions';
import { cn } from '@/lib/utils';
import { api, queryKeys } from '../api/client';
import {
  FIT_FILTERS,
  PROSPECT_STATUSES,
  STATUS_LABELS,
  type ExportRecord,
  type ExportScopeFilters,
  type FitFilter,
  type ProspectList,
  type ProspectQuery,
  type ProspectStatus,
  type SourceKind,
} from '../api/types';
import { BulkBar, EnrichDialog, type BulkJobScope } from '../components/BulkBar';
import { ExportDialog } from '../components/ExportDialog';
import { AnalyzeDialog } from '../components/IcpPickerDialog';
import { FIT_FILTER_LABELS, ProspectTable, csvValues, formatDay, searchParam, useSearchDraft } from '../components/ProspectTable';
import { Card, ErrorBox, Loading, PageHeader } from '../components/ui';
import { toast } from '../components/ui/toaster';

/*
 * Dettaglio Lista (crm-foundation T15, FLOW E, G, D.1): header con ICP, conteggi per stato cliccabili
 * (filtro) e contatori; tabella con filtri nell'URL; BulkBar Cambia stato · Rimuovi · Arricchisci… ·
 * Analizza… · Esporta…; "Azioni sulla lista" sulla lista filtrata; "Export precedenti". Lista
 * archiviata: banner, job disabilitati, lettura ed export permessi.
 */

const LIST_SOURCES = ['post_reaction', 'post_comment', 'company_employees', 'manual'] as const satisfies readonly SourceKind[];
const LIST_SORTS = ['recent', 'fit', 'comments_first', 'most_interactions'] as const;
type ListSort = (typeof LIST_SORTS)[number];

const SORT_LABELS: Record<ListSort, string> = {
  recent: 'Aggiunti di recente',
  fit: 'Fit migliore',
  comments_first: 'Commenti prima',
  most_interactions: 'Più interazioni',
};
const SOURCE_LABELS: Record<(typeof LIST_SOURCES)[number], string> = {
  post_reaction: 'Reazioni',
  post_comment: 'Commenti',
  company_employees: 'Dipendenti',
  manual: 'Manuali',
};

interface ListSearch {
  q?: string;
  /** Stati separati da virgola. */
  status?: string;
  email?: 'with' | 'without';
  enriched?: boolean;
  fit?: FitFilter;
  source?: (typeof LIST_SOURCES)[number];
  sort?: ListSort;
  page?: number;
}

export const Route = createFileRoute('/lists/$id')({
  component: ListPage,
  validateSearch: (s: Record<string, unknown>): ListSearch => ({
    q: searchParam.text(s.q),
    status: searchParam.csv(PROSPECT_STATUSES, s.status),
    email: searchParam.oneOf(['with', 'without'] as const, s.email),
    enriched: searchParam.bool(s.enriched),
    fit: searchParam.oneOf(FIT_FILTERS, s.fit),
    source: searchParam.oneOf(LIST_SOURCES, s.source),
    sort: searchParam.oneOf(LIST_SORTS, s.sort),
    page: searchParam.page(s.page),
  }),
});

const PAGE_SIZE = 50;

function ListPage() {
  const { id } = Route.useParams();
  const listId = searchParam.id(id);
  if (listId === undefined) return <ListNotFound />;
  return <ListDetail key={listId} listId={listId} />;
}

function ListNotFound() {
  return (
    <div className="py-20 text-center text-sm text-slate-600">
      <p className="font-medium">Lista non trovata.</p>
      <Link to="/lists" className="mt-2 inline-block font-medium text-slate-900 underline">
        Torna alle liste
      </Link>
    </div>
  );
}

type DialogKind = 'enrich' | 'analyze' | 'export';
/** Dialog aperto: sulla selezione (BulkBar) o sulla lista filtrata ("Azioni sulla lista"). */
type OpenDialog = { kind: DialogKind; target: 'selection' | 'filtered'; ids?: number[]; notice?: string | null } | null;

function ListDetail({ listId }: { listId: number }) {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const page = search.page ?? 1;
  const statuses = csvValues<ProspectStatus>(search.status);

  const list = useQuery({ queryKey: queryKeys.list(listId), queryFn: () => api.lists.get(listId), retry: false });

  const filters: Omit<ProspectQuery, 'listId'> = {
    q: search.q,
    status: statuses.length > 0 ? statuses : undefined,
    hasEmail: search.email === 'with' ? true : search.email === 'without' ? false : undefined,
    enriched: search.enriched,
    fit: search.fit ? [search.fit] : undefined,
    source: search.source ? [search.source] : undefined,
  };
  const query: ProspectQuery = { ...filters, listId, sort: search.sort, page, pageSize: PAGE_SIZE };
  const members = useQuery({
    queryKey: queryKeys.prospectsSearch(query),
    queryFn: () => api.prospects.search(query),
    placeholderData: keepPreviousData,
    enabled: list.isSuccess,
  });
  const exportsHistory = useQuery({ queryKey: queryKeys.exports(listId), queryFn: () => api.exports.history(listId), enabled: list.isSuccess });

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [capNotice, setCapNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const selectedIds = [...selected];
  const updateSelection = (next: Set<number>) => {
    setSelected(next);
    setCapNotice(null);
  };

  const setSearch = (patch: Partial<ListSearch>, opts: { replace?: boolean } = {}) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch, page: 'page' in patch ? patch.page : undefined }), replace: opts.replace });
  const [qDraft, setQDraft] = useSearchDraft(search.q, (q) => setSearch({ q }, { replace: true }));

  const invalidateMembers = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.lists });
    void queryClient.invalidateQueries({ queryKey: queryKeys.prospects });
    void queryClient.invalidateQueries({ queryKey: queryKeys.inbox });
  };

  const selectAll = useMutation({
    mutationFn: () => api.lists.memberIds(listId, { ...filters, sort: search.sort }),
    onSuccess: ({ ids, total, capped }) => {
      setSelected((cur) => new Set([...cur, ...ids]));
      setCapNotice(capped ? capText(ids.length, total) : null);
    },
    onError: (err) => toast({ tone: 'error', title: 'Selezione non riuscita', description: err instanceof Error ? err.message : undefined }),
  });

  /** "Azioni sulla lista" con filtri attivi: gli id dei filtrati (cap 500) diventano l'ambito del job. */
  const filteredIds = useMutation({
    mutationFn: (_kind: DialogKind) => api.lists.memberIds(listId, filters),
    onSuccess: ({ ids, total, capped }, kind) =>
      setDialog({ kind, target: 'filtered', ids, notice: capped ? capText(ids.length, total) : null }),
    onError: (err) => toast({ tone: 'error', title: 'Impossibile leggere la lista filtrata', description: err instanceof Error ? err.message : undefined }),
  });

  const bulkStatus = useMutation({
    mutationFn: (status: ProspectStatus) => api.prospects.bulkStatus({ prospectIds: selectedIds, status, listId }),
    onSuccess: (result, status) => {
      invalidateMembers();
      toast({
        tone: 'success',
        title: `${result.updated} ${result.updated === 1 ? 'aggiornato' : 'aggiornati'} a '${STATUS_LABELS[status]}'`,
        description: result.unchanged > 0 ? `${result.unchanged} erano già in questo stato.` : undefined,
      });
    },
    onError: (err) =>
      toast({ tone: 'error', title: 'Cambio stato non riuscito', description: `${err instanceof Error ? err.message : ''} La selezione è rimasta.` }),
  });

  const remove = useMutation({
    mutationFn: () => api.lists.removeMembers(listId, selectedIds),
    onSuccess: (result) => {
      invalidateMembers();
      toast({
        tone: 'success',
        title: `${result.removed} ${result.removed === 1 ? 'rimosso' : 'rimossi'} dalla lista`,
        description: 'Stato e timeline restano; chi non è in altre liste torna in Inbox.',
      });
      updateSelection(new Set());
    },
    onError: (err) =>
      toast({ tone: 'error', title: 'Rimozione non riuscita', description: `${err instanceof Error ? err.message : ''} La selezione è rimasta.` }),
  });

  const unarchive = useMutation({
    mutationFn: () => api.lists.update(listId, { archived: false }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.lists });
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobPreviews });
      toast({ tone: 'success', title: 'Lista ripristinata' });
    },
    onError: (err) => toast({ tone: 'error', title: 'Ripristino non riuscito', description: err instanceof Error ? err.message : undefined }),
  });

  if (list.isPending) return <Loading />;
  if (list.error) {
    if (list.error instanceof Error && 'status' in list.error && list.error.status === 404) return <ListNotFound />;
    return (
      <div className="flex flex-col items-start gap-3">
        <ErrorBox error={list.error} />
        <Button type="button" variant="outline" onClick={() => void list.refetch()}>
          Riprova
        </Button>
      </div>
    );
  }

  const data = list.data;
  const archived = data.archived_at !== null;
  const total = members.data?.total ?? 0;
  const rows = members.data?.items ?? [];

  const toggleStatus = (s: ProspectStatus) => {
    const next = statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s];
    setSearch({ status: next.length > 0 ? PROSPECT_STATUSES.filter((x) => next.includes(x)).join(',') : undefined });
  };

  const chips: ActiveFilterChip[] = [];
  if (search.q) chips.push({ key: 'q', label: `Cerca: ${search.q}`, onClear: () => setSearch({ q: undefined }) });
  if (statuses.length > 0)
    chips.push({ key: 'status', label: `Stato: ${statuses.map((s) => STATUS_LABELS[s]).join(', ')}`, onClear: () => setSearch({ status: undefined }) });
  if (search.email) chips.push({ key: 'email', label: search.email === 'with' ? 'Con email' : 'Senza email', onClear: () => setSearch({ email: undefined }) });
  if (search.enriched !== undefined)
    chips.push({ key: 'enriched', label: search.enriched ? 'Arricchiti' : 'Non arricchiti', onClear: () => setSearch({ enriched: undefined }) });
  if (search.fit) chips.push({ key: 'fit', label: FIT_FILTER_LABELS[search.fit], onClear: () => setSearch({ fit: undefined }) });
  if (search.source) chips.push({ key: 'source', label: `Fonte: ${SOURCE_LABELS[search.source]}`, onClear: () => setSearch({ source: undefined }) });
  const clearAll = () => void navigate({ search: {} });
  const hasFilters = chips.length > 0;

  const selects: FilterSelectConfig[] = [
    {
      key: 'email',
      label: 'Email',
      value: search.email ?? '',
      onChange: (v) => setSearch({ email: (v || undefined) as ListSearch['email'] }),
      options: EMAIL_FILTER_OPTIONS.map((o) => ({ value: o.value, label: o.value === '' ? 'Email: tutti' : o.label })),
    },
    {
      key: 'enriched',
      label: 'Arricchimento',
      value: search.enriched === undefined ? '' : String(search.enriched),
      onChange: (v) => setSearch({ enriched: v === '' ? undefined : v === 'true' }),
      options: [
        { value: '', label: 'Arricchiti e non' },
        { value: 'true', label: 'Arricchiti' },
        { value: 'false', label: 'Non arricchiti' },
      ],
    },
    {
      key: 'fit',
      label: 'Fit',
      value: search.fit ?? '',
      onChange: (v) => setSearch({ fit: (v || undefined) as FitFilter | undefined }),
      options: [{ value: '', label: 'Tutti i fit' }, ...FIT_FILTERS.map((f) => ({ value: f, label: FIT_FILTER_LABELS[f] }))],
    },
    {
      key: 'source',
      label: 'Fonte',
      value: search.source ?? '',
      onChange: (v) => setSearch({ source: (v || undefined) as ListSearch['source'] }),
      options: [{ value: '', label: 'Tutte le fonti' }, ...LIST_SOURCES.map((s) => ({ value: s, label: SOURCE_LABELS[s] }))],
    },
    {
      key: 'sort',
      label: 'Ordinamento',
      value: search.sort ?? '',
      onChange: (v) => setSearch({ sort: (v || undefined) as ListSort | undefined }),
      options: [{ value: '', label: SORT_LABELS.recent }, ...LIST_SORTS.filter((s) => s !== 'recent').map((s) => ({ value: s, label: SORT_LABELS[s] }))],
    },
  ];

  // Ambito dei dialog: selezione, lista filtrata (id) o intera lista.
  const scopeFilters: ExportScopeFilters = {
    q: filters.q,
    status: filters.status,
    enriched: filters.enriched,
    source: filters.source,
    fit: filters.fit,
  };
  const filterLabels = chips.filter((c) => c.key !== 'email').map((c) => c.label);
  const openFiltered = (kind: DialogKind) => {
    if (kind === 'export' || !hasFilters) setDialog({ kind, target: 'filtered' });
    else filteredIds.mutate(kind);
  };
  const jobScope: BulkJobScope =
    dialog?.target === 'selection'
      ? { prospectIds: selectedIds }
      : dialog?.ids
        ? { prospectIds: dialog.ids }
        : { listId };
  const scopeLabel =
    dialog?.target === 'selection'
      ? `${selectedIds.length} selezionati`
      : dialog?.ids
        ? `Lista filtrata: ${chips.map((c) => c.label).join(' · ')} (${dialog.ids.length})${dialog.notice ? ` — ${dialog.notice}` : ''}`
        : 'Tutta la lista (solo i mancanti)';
  const jobsDisabledHint = archived ? 'Lista archiviata: arricchimento, analisi e sourcing disabilitati.' : undefined;
  const closeDialog = (open: boolean) => !open && setDialog(null);

  return (
    <>
      <nav aria-label="Percorso" className="mb-2 text-sm text-slate-500">
        <Link to="/lists" className="hover:underline">
          Liste
        </Link>{' '}
        / <span className="text-slate-700">{data.name}</span>
      </nav>
      <PageHeader
        title={data.name}
        subtitle={data.description ?? undefined}
        actions={
          archived ? (
            <Button type="button" variant="outline" disabled title={jobsDisabledHint}>
              <Building2Icon aria-hidden="true" />
              Aggiungi persone da un'azienda
            </Button>
          ) : (
            <Link to={'/companies' as never} search={{ listId } as never} className={buttonVariants({ variant: 'outline' })}>
              <Building2Icon aria-hidden="true" />
              Aggiungi persone da un'azienda
            </Link>
          )
        }
      />

      {archived && (
        <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p>
            <span className="font-semibold">Lista archiviata</span>: arricchimento, analisi e sourcing sono disabilitati; lettura ed
            export restano possibili.
          </p>
          <Button type="button" size="sm" variant="outline" onClick={() => unarchive.mutate()} disabled={unarchive.isPending}>
            Ripristina lista
          </Button>
        </div>
      )}

      <ListSummary list={data} statuses={statuses} onToggleStatus={toggleStatus} />

      <Card className="mt-4">
        <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <FilterBar
              search={{ value: qDraft, onChange: setQDraft, placeholder: 'Cerca nome, headline, azienda…', label: 'Cerca nella lista' }}
              selects={selects}
            />
            <div role="group" aria-label="Azioni sulla lista" className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-slate-500">{hasFilters ? 'Sulla lista filtrata:' : 'Sulla lista:'}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={archived || data.members_count === 0 || filteredIds.isPending}
                title={jobsDisabledHint}
                onClick={() => openFiltered('enrich')}
              >
                Arricchisci…
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={archived || data.members_count === 0 || filteredIds.isPending}
                title={jobsDisabledHint}
                onClick={() => openFiltered('analyze')}
              >
                Analizza…
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={data.members_count === 0} onClick={() => openFiltered('export')}>
                <DownloadIcon aria-hidden="true" />
                Esporta…
              </Button>
            </div>
          </div>
          <FilterChips chips={chips} onClearAll={clearAll} />
          {archived && <p className="text-xs text-slate-500">{jobsDisabledHint}</p>}
        </div>

        {members.isPending ? (
          <Loading />
        ) : members.error ? (
          <div className="flex flex-col items-start gap-3 p-4">
            <ErrorBox error={members.error} />
            <Button type="button" variant="outline" onClick={() => void members.refetch()}>
              Riprova
            </Button>
          </div>
        ) : rows.length === 0 ? (
          hasFilters ? (
            <div className="py-12 text-center">
              <p className="text-sm font-medium text-slate-600">Nessun prospect corrisponde ai filtri.</p>
              <Button type="button" variant="outline" size="sm" className="mt-3" onClick={clearAll}>
                Pulisci
              </Button>
            </div>
          ) : (
            <EmptyList listId={listId} archived={archived} />
          )
        ) : (
          <ProspectTable
            caption={`Prospect della lista ${data.name}`}
            rows={rows}
            selected={selected}
            onSelectedChange={updateSelection}
            listId={listId}
            columns={{ lastTouchpoint: true, capturedAt: false }}
            busy={members.isFetching && members.isPlaceholderData}
            selectAll={{ total, onSelectAll: () => selectAll.mutate(), pending: selectAll.isPending, notice: capNotice }}
            pagination={{ page, pageSize: PAGE_SIZE, total, onPageChange: (p) => setSearch({ page: p > 1 ? p : undefined }) }}
          />
        )}
      </Card>

      <ExportHistory query={exportsHistory} />

      <BulkBar count={selected.size} onClear={() => updateSelection(new Set())} notice={capNotice}>
        <StatusMenu disabled={bulkStatus.isPending} onChange={(s) => bulkStatus.mutate(s)} />
        <Button type="button" size="sm" variant="outline" onClick={() => remove.mutate()} disabled={remove.isPending} aria-busy={remove.isPending}>
          Rimuovi dalla lista
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={archived}
          title={jobsDisabledHint}
          onClick={() => setDialog({ kind: 'enrich', target: 'selection' })}
        >
          Arricchisci…
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={archived}
          title={jobsDisabledHint}
          onClick={() => setDialog({ kind: 'analyze', target: 'selection' })}
        >
          Analizza…
        </Button>
        <Button type="button" size="sm" onClick={() => setDialog({ kind: 'export', target: 'selection' })}>
          Esporta…
        </Button>
      </BulkBar>

      <EnrichDialog open={dialog?.kind === 'enrich'} onOpenChange={closeDialog} scope={jobScope} description={scopeLabel} />
      <AnalyzeDialog
        open={dialog?.kind === 'analyze'}
        onOpenChange={closeDialog}
        scope={jobScope}
        icp={data.icp}
        onlyMissing={dialog?.target === 'filtered' ? true : undefined}
        scopeLabel={scopeLabel}
      />
      <ExportDialog
        open={dialog?.kind === 'export'}
        onOpenChange={closeDialog}
        list={data}
        prospectIds={dialog?.target === 'selection' ? selectedIds : undefined}
        filters={scopeFilters}
        emailFilter={filters.hasEmail}
        filterLabels={filterLabels}
      />
    </>
  );
}

const capText = (count: number, total: number) =>
  `Selezionati i primi ${count.toLocaleString('it-IT')} di ${total.toLocaleString('it-IT')}: affina i filtri per il resto.`;

/** ICP, conteggi per stato come filtri (toggle) e contatori (FLOW E.1). */
function ListSummary({ list, statuses, onToggleStatus }: { list: ProspectList; statuses: ProspectStatus[]; onToggleStatus: (s: ProspectStatus) => void }) {
  const total = list.members_count;
  return (
    <Card>
      <div className="flex flex-col gap-3 px-4 py-3">
        <p className="text-sm text-slate-700">
          <span className="font-medium">ICP:</span>{' '}
          <Link to={`/icps/${list.icp.id}` as never} className="text-slate-900 underline-offset-2 hover:underline">
            {list.icp.name}
          </Link>
          <span className="text-slate-500">
            {' '}
            · {total} {total === 1 ? 'persona' : 'persone'} · arricchiti {list.enriched_count}/{total} · analizzati {list.analyzed_count}/{total} · con
            email {list.with_email_count}/{total}
          </span>
        </p>
        <div role="group" aria-label="Filtra per stato" className="flex flex-wrap gap-1.5">
          {PROSPECT_STATUSES.map((s) => {
            const count = list.counts_by_status[s];
            const active = statuses.includes(s);
            if (count === 0 && !active) return null;
            return (
              <button
                key={s}
                type="button"
                aria-pressed={active}
                onClick={() => onToggleStatus(s)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:outline-none',
                  active ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-100',
                )}
              >
                {STATUS_LABELS[s]}
                <span className="tabular-nums">{count}</span>
              </button>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

/** "Cambia stato ▾": applica subito lo stato scelto alla selezione (nessuna conferma: reversibile). */
function StatusMenu({ disabled, onChange }: { disabled: boolean; onChange: (s: ProspectStatus) => void }) {
  return (
    <Select value="" onValueChange={(v) => onChange(v as ProspectStatus)} disabled={disabled}>
      <SelectTrigger size="sm" className="w-auto" aria-label="Cambia stato dei selezionati">
        <SelectValue placeholder="Cambia stato…" />
      </SelectTrigger>
      <SelectContent>
        {PROSPECT_STATUSES.map((s) => (
          <SelectItem key={s} value={s}>
            {STATUS_LABELS[s]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function EmptyList({ listId, archived }: { listId: number; archived: boolean }) {
  return (
    <div className="py-12 text-center">
      <p className="text-sm font-medium text-slate-700">
        Lista vuota. Aggiungi persone dall'Inbox (seleziona → Aggiungi a lista) o cerca persone in un'azienda.
      </p>
      <div className="mt-4 flex justify-center gap-2">
        <Link to="/inbox" className={buttonVariants({ variant: 'outline' })}>
          Aggiungi dall'Inbox
        </Link>
        {archived ? (
          <Button type="button" disabled title="Lista archiviata: sourcing disabilitato.">
            Estrai da un'azienda
          </Button>
        ) : (
          <Link to={'/companies' as never} search={{ listId } as never} className={buttonVariants()}>
            Estrai da un'azienda
          </Link>
        )}
      </div>
    </div>
  );
}

function scopeDescription(record: ExportRecord): string {
  if (record.scope === 'selection') return `${record.selected ?? 0} ${record.selected === 1 ? 'selezionato' : 'selezionati'}`;
  const f = record.filters;
  const parts = [
    f.q && `cerca "${f.q}"`,
    f.status?.length && `stato ${f.status.map((s) => STATUS_LABELS[s]).join(', ')}`,
    f.enriched !== undefined && (f.enriched ? 'arricchiti' : 'non arricchiti'),
    f.source?.length && `fonte ${f.source.join(', ')}`,
    f.fit?.length && `fit ${f.fit.map((x) => FIT_FILTER_LABELS[x].toLowerCase()).join(', ')}`,
  ].filter((p): p is string => typeof p === 'string');
  return parts.length > 0 ? `Lista filtrata: ${parts.join(' · ')}` : 'Tutta la lista';
}

/** "Export precedenti" (FLOW G.3): data · filtri · conteggio · "Scarica di nuovo". */
function ExportHistory({ query }: { query: { data?: { items: ExportRecord[] }; isPending: boolean; error: unknown } }) {
  const items = query.data?.items ?? [];
  return (
    <Card title="Export precedenti" className="mt-6">
      {query.isPending ? (
        <p className="px-4 py-3 text-sm text-slate-500">Caricamento…</p>
      ) : query.error ? (
        <div className="p-4">
          <ErrorBox error={query.error} />
        </div>
      ) : items.length === 0 ? (
        <p className="px-4 py-3 text-sm text-slate-500">Nessun export ancora.</p>
      ) : (
        <table className="w-full text-sm">
          <caption className="sr-only">Export precedenti della lista</caption>
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
              <th scope="col" className="px-4 py-2">Data</th>
              <th scope="col" className="px-3 py-2">Ambito</th>
              <th scope="col" className="px-3 py-2">Prospect</th>
              <th scope="col" className="px-3 py-2">
                <span className="sr-only">Azioni</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((e) => (
              <tr key={e.id}>
                <td className="px-4 py-2 whitespace-nowrap text-slate-700">
                  <time dateTime={e.created_at}>{formatDay(e.created_at)}</time>
                  <span className="block text-xs text-slate-500">Export #{e.id}</span>
                </td>
                <td className="px-3 py-2 text-slate-700">
                  {scopeDescription(e)}
                  <span className="block text-xs text-slate-500">
                    {[e.filters.hasEmail === true && 'solo con email', e.filters.hasEmail === false && 'solo senza email', e.mark_contacted && 'segnati contattati']
                      .filter(Boolean)
                      .join(' · ') || 'tutti, con e senza email'}
                  </span>
                </td>
                <td className="px-3 py-2 tabular-nums">{e.count}</td>
                <td className="px-3 py-2 text-right">
                  <a href={e.download_url} download className={buttonVariants({ variant: 'outline', size: 'sm' })} aria-label={`Scarica di nuovo l'export #${e.id}`}>
                    <DownloadIcon aria-hidden="true" />
                    Scarica di nuovo
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
