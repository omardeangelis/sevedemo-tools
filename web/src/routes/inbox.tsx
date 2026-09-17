import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Button, buttonVariants } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FilterBar, type FilterSelectConfig } from '@/components/filters/FilterBar';
import { FilterChips, type ActiveFilterChip } from '@/components/filters/FilterChips';
import { api, queryKeys } from '../api/client';
import {
  FIT_FILTERS,
  PROSPECT_STATUSES,
  STATUS_LABELS,
  type FitFilter,
  type ProspectQuery,
  type ProspectStatus,
  type SourceKind,
} from '../api/types';
import { AddToListDialog } from '../components/AddToListDialog';
import { BulkBar, EnrichDialog } from '../components/BulkBar';
import { AnalyzeDialog } from '../components/IcpPickerDialog';
import { FIT_FILTER_LABELS, ProspectTable, csvValues, searchParam, timeAgo, useSearchDraft } from '../components/ProspectTable';
import { SyncDialog } from '../components/SyncDialog';
import { Card, EmptyState, ErrorBox, Loading, PageHeader } from '../components/ui';
import { toast } from '../components/ui/toaster';

/*
 * Inbox (crm-foundation T15, FLOW C e H): prospect senza lista e non scartati, filtri nell'URL,
 * selezione per id con bulk Aggiungi a lista · Scarta · Analizza… · Arricchisci…; "Mostra scartati"
 * (`status=scartato`) con bulk Ripristina; empty state con "Sincronizza ora".
 */

const INBOX_SOURCES = ['post_reaction', 'post_comment', 'company_employees'] as const satisfies readonly SourceKind[];
const INBOX_SORTS = ['recent', 'comments_first', 'most_interactions', 'fit'] as const;
type InboxSort = (typeof INBOX_SORTS)[number];

const SORT_LABELS: Record<InboxSort, string> = {
  recent: 'Catturati di recente',
  comments_first: 'Commenti prima',
  most_interactions: 'Più interazioni',
  fit: 'Fit migliore',
};

const SOURCE_LABELS: Record<(typeof INBOX_SOURCES)[number], string> = {
  post_reaction: 'Reazioni',
  post_comment: 'Commenti',
  company_employees: 'Dipendenti',
};

export interface InboxSearch {
  q?: string;
  source?: (typeof INBOX_SOURCES)[number];
  post?: number;
  fit?: FitFilter;
  icp?: number;
  /** Stato (valori separati da virgola); `scartato` = vista "Mostra scartati". */
  status?: string;
  sort?: InboxSort;
  page?: number;
}

export const Route = createFileRoute('/inbox')({
  component: InboxPage,
  validateSearch: (s: Record<string, unknown>): InboxSearch => ({
    q: searchParam.text(s.q),
    source: searchParam.oneOf(INBOX_SOURCES, s.source),
    post: searchParam.id(s.post),
    fit: searchParam.oneOf(FIT_FILTERS, s.fit),
    icp: searchParam.id(s.icp),
    status: searchParam.csv(PROSPECT_STATUSES, s.status),
    sort: searchParam.oneOf(INBOX_SORTS, s.sort),
    page: searchParam.page(s.page),
  }),
});

const PAGE_SIZE = 50;

function InboxPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const page = search.page ?? 1;
  const statuses = csvValues<ProspectStatus>(search.status);
  const showDiscarded = statuses.includes('scartato');

  const settings = useQuery({ queryKey: queryKeys.settings, queryFn: api.settings.get });
  const icps = useQuery({ queryKey: queryKeys.icpsIndex, queryFn: api.icps.list });
  const posts = useQuery({ queryKey: queryKeys.posts, queryFn: api.sync.posts });
  const icpItems = icps.data?.items ?? [];
  const multiIcp = icpItems.length > 1;
  // Il fit vale entro un ICP: con più ICP serve sceglierlo, con uno solo lo risolve il server.
  const fitUsable = icpItems.length === 1 || (multiIcp && search.icp !== undefined);

  const filters: ProspectQuery = {
    q: search.q,
    source: search.source ? [search.source] : undefined,
    postId: search.post,
    fit: search.fit && fitUsable ? [search.fit] : undefined,
    icpId: search.icp,
    status: statuses.length > 0 ? statuses : undefined,
  };
  const sort = search.sort === 'fit' && !fitUsable ? undefined : search.sort;
  const query: ProspectQuery = { ...filters, sort, page, pageSize: PAGE_SIZE };

  const inbox = useQuery({
    queryKey: queryKeys.inboxPage(query),
    queryFn: () => api.prospects.inbox(query),
    placeholderData: keepPreviousData,
    // Con fit nell'URL si aspetta di sapere quanti ICP ci sono (con più ICP il fit richiede l'ICP).
    enabled: icps.isFetched || (!search.fit && search.sort !== 'fit'),
  });
  // Totale "da triagiare" senza filtri, per l'header.
  const inboxTotal = useQuery({
    queryKey: queryKeys.inboxPage({ pageSize: 1 }),
    queryFn: () => api.prospects.inbox({ pageSize: 1 }),
  });

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [capNotice, setCapNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | 'add' | 'analyze' | 'enrich' | 'sync'>(null);
  const [lastIcpId, setLastIcpId] = useState<number | undefined>(undefined);
  const selectedIds = [...selected];

  const updateSelection = (next: Set<number>) => {
    setSelected(next);
    setCapNotice(null);
  };

  const selectAll = useMutation({
    mutationFn: () => api.prospects.inboxIds({ ...filters, sort }),
    onSuccess: ({ ids, total, capped }) => {
      setSelected((cur) => new Set([...cur, ...ids]));
      setCapNotice(
        capped
          ? `Selezionati i primi ${ids.length.toLocaleString('it-IT')} di ${total.toLocaleString('it-IT')}: affina i filtri per il resto.`
          : null,
      );
    },
    onError: (err) => toast({ tone: 'error', title: 'Selezione non riuscita', description: err instanceof Error ? err.message : undefined }),
  });

  const bulkStatus = useMutation({
    mutationFn: (status: ProspectStatus) => api.prospects.bulkStatus({ prospectIds: selectedIds, status }),
    onSuccess: (result, status) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.inbox });
      void queryClient.invalidateQueries({ queryKey: queryKeys.prospects });
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings });
      const done = result.updated + result.unchanged;
      toast({
        tone: 'success',
        title: status === 'scartato' ? `${done} ${done === 1 ? 'scartato' : 'scartati'}` : `${done} ${done === 1 ? 'ripristinato' : 'ripristinati'}`,
        description:
          status === 'scartato'
            ? 'Li ritrovi con "Mostra scartati".'
            : result.not_found > 0
              ? `${result.not_found} non più presenti.`
              : undefined,
      });
      updateSelection(new Set());
    },
    onError: (err) =>
      toast({
        tone: 'error',
        title: 'Operazione non riuscita',
        description: `${err instanceof Error ? err.message : 'Errore inatteso.'} La selezione è rimasta: puoi riprovare.`,
      }),
  });

  const setSearch = (patch: Partial<InboxSearch>, opts: { replace?: boolean } = {}) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch, page: 'page' in patch ? patch.page : undefined }), replace: opts.replace });

  const [qDraft, setQDraft] = useSearchDraft(search.q, (q) => setSearch({ q }, { replace: true }));

  const toggleDiscarded = () => {
    updateSelection(new Set());
    setSearch({ status: showDiscarded ? undefined : 'scartato' });
  };

  const lastSync = (posts.data?.items ?? [])
    .map((p) => p.last_synced_at)
    .filter((d): d is string => d !== null)
    .sort()
    .at(-1);
  const postsCount = posts.data?.items.length ?? 0;
  const pendingTotal = inboxTotal.data?.total;

  const selects: FilterSelectConfig[] = [
    {
      key: 'source',
      label: 'Fonte',
      value: search.source ?? '',
      onChange: (v) => setSearch({ source: (v || undefined) as InboxSearch['source'] }),
      options: [{ value: '', label: 'Tutte le fonti' }, ...INBOX_SOURCES.map((s) => ({ value: s, label: SOURCE_LABELS[s] }))],
    },
    {
      key: 'post',
      label: 'Post',
      value: search.post ? String(search.post) : '',
      onChange: (v) => setSearch({ post: v ? Number(v) : undefined }),
      options: [
        { value: '', label: 'Tutti i post' },
        ...(posts.data?.items ?? []).slice(0, 10).map((p) => ({
          value: String(p.id),
          label: `${(p.text_excerpt ?? p.post_url).replace(/\s+/g, ' ').slice(0, 48)}…`,
        })),
      ],
    },
    {
      key: 'status',
      label: 'Stato',
      value: statuses.length === 1 ? statuses[0] : '',
      onChange: (v) => {
        if ((v === 'scartato') !== showDiscarded) updateSelection(new Set());
        setSearch({ status: v || undefined });
      },
      options: [{ value: '', label: 'Tutti gli stati' }, ...PROSPECT_STATUSES.map((s) => ({ value: s, label: s === 'scartato' ? 'Scartati' : STATUS_LABELS[s] }))],
    },
    ...(multiIcp
      ? [
          {
            key: 'icp',
            label: 'ICP',
            value: search.icp ? String(search.icp) : '',
            onChange: (v: string) => setSearch({ icp: v ? Number(v) : undefined }),
            options: [{ value: '', label: 'ICP: scegli per il fit' }, ...icpItems.map((i) => ({ value: String(i.id), label: `ICP: ${i.name}` }))],
          },
        ]
      : []),
    {
      key: 'sort',
      label: 'Ordinamento',
      value: sort ?? '',
      onChange: (v) => setSearch({ sort: (v || undefined) as InboxSort | undefined }),
      options: [
        { value: '', label: SORT_LABELS.recent },
        { value: 'comments_first', label: SORT_LABELS.comments_first },
        { value: 'most_interactions', label: SORT_LABELS.most_interactions },
        ...(fitUsable ? [{ value: 'fit', label: SORT_LABELS.fit }] : []),
      ],
    },
  ];

  const chips: ActiveFilterChip[] = [];
  if (search.q) chips.push({ key: 'q', label: `Cerca: ${search.q}`, onClear: () => setSearch({ q: undefined }) });
  if (search.source) chips.push({ key: 'source', label: `Fonte: ${SOURCE_LABELS[search.source]}`, onClear: () => setSearch({ source: undefined }) });
  if (search.post) chips.push({ key: 'post', label: `Post #${search.post}`, onClear: () => setSearch({ post: undefined }) });
  if (statuses.length > 0)
    chips.push({
      key: 'status',
      label: `Stato: ${statuses.map((s) => (s === 'scartato' ? 'Scartati' : STATUS_LABELS[s])).join(', ')}`,
      onClear: () => {
        if (showDiscarded) updateSelection(new Set());
        setSearch({ status: undefined });
      },
    });
  if (search.icp)
    chips.push({
      key: 'icp',
      label: `ICP: ${icpItems.find((i) => i.id === search.icp)?.name ?? search.icp}`,
      onClear: () => setSearch({ icp: undefined, fit: undefined }),
    });
  if (search.fit && fitUsable) chips.push({ key: 'fit', label: FIT_FILTER_LABELS[search.fit], onClear: () => setSearch({ fit: undefined }) });
  const clearAll = () => {
    if (showDiscarded) updateSelection(new Set());
    void navigate({ search: {} });
  };

  const rows = inbox.data?.items ?? [];
  const total = inbox.data?.total ?? 0;
  const hasFilters = chips.length > 0;

  return (
    <>
      <PageHeader
        title={showDiscarded ? 'Inbox · scartati' : 'Inbox'}
        subtitle={joinSubtitle([
          pendingTotal !== undefined && `${pendingTotal.toLocaleString('it-IT')} da triagiare`,
          posts.isSuccess && (lastSync ? `Ultimo sync: ${timeAgo(lastSync)}` : 'Nessun sync ancora'),
        ])}
        actions={
          <>
            <Button type="button" variant="outline" aria-pressed={showDiscarded} onClick={toggleDiscarded}>
              {showDiscarded ? 'Nascondi scartati' : 'Mostra scartati'}
            </Button>
            <Button
              type="button"
              onClick={() => setDialog('sync')}
              disabled={settings.data ? !settings.data.readiness.profile : false}
              title={settings.data && !settings.data.readiness.profile ? 'Salva prima il tuo profilo LinkedIn.' : undefined}
            >
              Sincronizza ora
            </Button>
          </>
        }
      />

      <Card>
        <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <FilterBar
              search={{ value: qDraft, onChange: setQDraft, placeholder: 'Cerca nome, headline, azienda…', label: 'Cerca nell\'Inbox' }}
              selects={selects}
            />
            <FitSelect
              value={search.fit}
              disabledHint={icpItems.length === 0 ? 'Fit: crea prima un ICP' : !fitUsable ? 'Fit: scegli prima l\'ICP' : null}
              onChange={(fit) => setSearch({ fit })}
            />
          </div>
          <FilterChips chips={chips} onClearAll={clearAll} />
        </div>

        {inbox.isPending ? (
          <Loading />
        ) : inbox.error ? (
          <div className="flex flex-col items-start gap-3 p-4">
            <ErrorBox error={inbox.error} />
            <Button type="button" variant="outline" onClick={() => void inbox.refetch()}>
              Riprova
            </Button>
          </div>
        ) : rows.length === 0 ? (
          hasFilters ? (
            showDiscarded && chips.length === 1 ? (
              <EmptyState title="Nessun prospect scartato." hint="Qui ritrovi chi hai scartato dall'Inbox, per ripristinarlo." />
            ) : (
              <div className="py-12 text-center">
                <p className="text-sm font-medium text-slate-600">Nessun prospect corrisponde ai filtri.</p>
                <Button type="button" variant="outline" size="sm" className="mt-3" onClick={clearAll}>
                  Pulisci
                </Button>
              </div>
            )
          ) : (
            <InboxEmpty
              hadProspects={settings.data?.readiness.prospects === true}
              canSync={settings.data?.readiness.profile === true}
              lastSync={lastSync}
              postsCount={postsCount}
              onSync={() => setDialog('sync')}
              onShowDiscarded={toggleDiscarded}
            />
          )
        ) : (
          <ProspectTable
            caption={showDiscarded ? 'Prospect scartati' : 'Prospect in Inbox'}
            rows={rows}
            selected={selected}
            onSelectedChange={updateSelection}
            fitWithIcp
            busy={inbox.isFetching && inbox.isPlaceholderData}
            selectAll={{ total, onSelectAll: () => selectAll.mutate(), pending: selectAll.isPending, notice: capNotice }}
            pagination={{ page, pageSize: PAGE_SIZE, total, onPageChange: (p) => setSearch({ page: p > 1 ? p : undefined }) }}
          />
        )}
      </Card>

      <BulkBar count={selected.size} onClear={() => updateSelection(new Set())} notice={capNotice}>
        {showDiscarded ? (
          <Button type="button" size="sm" onClick={() => bulkStatus.mutate('nuovo')} disabled={bulkStatus.isPending} aria-busy={bulkStatus.isPending}>
            Ripristina
          </Button>
        ) : (
          <>
            <Button type="button" size="sm" onClick={() => setDialog('add')}>
              Aggiungi a lista
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => bulkStatus.mutate('scartato')}
              disabled={bulkStatus.isPending}
              aria-busy={bulkStatus.isPending}
            >
              Scarta
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setDialog('analyze')}>
              Analizza…
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setDialog('enrich')}>
              Arricchisci…
            </Button>
          </>
        )}
      </BulkBar>

      <AddToListDialog
        open={dialog === 'add'}
        onOpenChange={(open) => setDialog(open ? 'add' : null)}
        prospectIds={selectedIds}
        preferredIcpId={(multiIcp ? search.icp : undefined) ?? lastIcpId}
        onAdded={() => updateSelection(new Set())}
      />
      <AnalyzeDialog
        open={dialog === 'analyze'}
        onOpenChange={(open) => setDialog(open ? 'analyze' : null)}
        scope={{ prospectIds: selectedIds }}
        onStarted={(_job, icpId) => setLastIcpId(icpId)}
      />
      <EnrichDialog open={dialog === 'enrich'} onOpenChange={(open) => setDialog(open ? 'enrich' : null)} scope={{ prospectIds: selectedIds }} />
      <SyncDialog open={dialog === 'sync'} onOpenChange={(open) => setDialog(open ? 'sync' : null)} />
    </>
  );
}

function joinSubtitle(parts: Array<string | false | undefined>): string | undefined {
  const text = parts.filter((p): p is string => typeof p === 'string').join(' · ');
  return text || undefined;
}

/** Filtro fit con stato disabilitato esplicito (FLOW H.2: con più ICP serve prima l'ICP). */
function FitSelect({ value, disabledHint, onChange }: { value?: FitFilter; disabledHint: string | null; onChange: (fit: FitFilter | undefined) => void }) {
  const ALL = '__all';
  return (
    <Select value={disabledHint ? ALL : (value ?? ALL)} onValueChange={(v) => onChange(v === ALL ? undefined : (v as FitFilter))} disabled={disabledHint !== null}>
      <SelectTrigger className="w-auto" aria-label={disabledHint ?? 'Fit'} title={disabledHint ?? undefined}>
        <SelectValue placeholder="Fit" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{disabledHint ?? 'Tutti i fit'}</SelectItem>
        {FIT_FILTERS.map((f) => (
          <SelectItem key={f} value={f}>
            {FIT_FILTER_LABELS[f]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Inbox vuota senza filtri: prima del primo sync oppure tutta triagiata (FLOW Edge cases, C outcome). */
function InboxEmpty(props: {
  hadProspects: boolean;
  canSync: boolean;
  lastSync?: string;
  postsCount: number;
  onSync: () => void;
  onShowDiscarded: () => void;
}) {
  if (props.hadProspects) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm font-medium text-slate-700">Inbox pulita: tutte le interazioni sono state assegnate o scartate.</p>
        {props.lastSync && (
          <p className="mt-1 text-sm text-slate-500">
            Ultimo sync: {timeAgo(props.lastSync)} ({props.postsCount} {props.postsCount === 1 ? 'post' : 'post'}).
          </p>
        )}
        <div className="mt-4 flex justify-center gap-2">
          <Button type="button" onClick={props.onSync} disabled={!props.canSync}>
            Sincronizza di nuovo
          </Button>
          <Button type="button" variant="outline" onClick={props.onShowDiscarded}>
            Mostra scartati
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="py-12 text-center">
      <p className="text-sm font-medium text-slate-700">
        Nessuna interazione ancora. Sincronizza i tuoi post: vedrai qui chi ha reagito o commentato.
      </p>
      <div className="mt-4 flex flex-col items-center gap-2">
        <Button type="button" onClick={props.onSync} disabled={!props.canSync} aria-describedby={props.canSync ? undefined : 'inbox-sync-hint'}>
          Sincronizza ora
        </Button>
        {!props.canSync && (
          <p id="inbox-sync-hint" className="text-xs text-slate-500">
            Salva prima il tuo profilo LinkedIn.{' '}
            <Link to={'/settings' as never} className="underline">
              Apri Impostazioni
            </Link>
          </p>
        )}
        <Link to={'/companies' as never} className={buttonVariants({ variant: 'link', size: 'sm' })}>
          oppure cerca persone in un'azienda
        </Link>
      </div>
    </div>
  );
}
