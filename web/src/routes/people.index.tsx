import { useEffect, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { SlidersHorizontalIcon, UserPlusIcon } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FilterBar, type FilterSelectConfig } from '@/components/filters/FilterBar';
import { FilterChips, type ActiveFilterChip } from '@/components/filters/FilterChips';
import { cn } from '@/lib/utils';
import { api, queryKeys } from '../api/client';
import {
  CONTACT_FILTERS,
  FIT_FILTERS,
  NEXT_FILTERS,
  PEOPLE_VIEWS,
  PROSPECT_STATUSES,
  SOURCE_KINDS,
  STATUS_LABELS,
  type ContactFilter,
  type FitFilter,
  type NextFilter,
  type PeopleView,
  type ProspectQuery,
  type ProspectStatus,
  type SourceKind,
} from '../api/types';
import { AddToListDialog } from '../components/AddToListDialog';
import { BulkBar, EnrichDialog } from '../components/BulkBar';
import { AnalyzeDialog } from '../components/IcpPickerDialog';
import { FIT_FILTER_LABELS, ProspectTable, csvValues, searchParam, timeAgo, useSearchDraft } from '../components/ProspectTable';
import { StartPaths } from '../components/StartPaths';
import { SyncDialog } from '../components/SyncDialog';
import { Card, ErrorBox, Loading, PageHeader } from '../components/ui';
import { toast } from '../components/ui/toaster';
import { useToday } from '../lib/dates';
import { fmtCount } from '../lib/format';

/*
 * Persone (people-first-crm B1–B10, FLOW B e C): tutte le persone del CRM, con le viste Tutte · Da smistare · Con
 * prossima azione · Scartate (link con conteggio, nell'URL), filtri primari e "Altri filtri" nell'URL, selezione per
 * id con le azioni bulk, "Aggiungi persona". Sostituisce l'Inbox (`/inbox` fa redirect qui, vista Da smistare).
 */

const SORTS = ['recent', 'added', 'name', 'next_action', 'fit', 'comments_first', 'most_interactions'] as const;
type PeopleSort = (typeof SORTS)[number];

const SORT_LABELS: Record<PeopleSort, string> = {
  recent: 'Fonti più recenti',
  added: 'Data di aggiunta',
  name: 'Nome',
  next_action: 'Prossima azione',
  fit: 'Fit (tuo o AI)',
  comments_first: 'Commenti prima',
  most_interactions: 'Più interazioni',
};

const VIEW_LABELS: Record<PeopleView, string> = {
  tutte: 'Tutte',
  da_smistare: 'Da smistare',
  con_prossima_azione: 'Con prossima azione',
  scartate: 'Scartate',
};

const SOURCE_LABELS: Record<SourceKind, string> = {
  post_reaction: 'Reazioni',
  post_comment: 'Commenti',
  company_employees: "Persone di un'azienda",
  apollo_people: 'Apollo',
  manual: 'Aggiunta a mano',
};

const NEXT_LABELS: Record<NextFilter, string> = {
  scaduta: 'Scaduta',
  oggi: 'Oggi',
  '7g': 'Prossimi 7 giorni',
  nessuna: 'Nessuna',
};

const CONTACT_LABELS: Record<ContactFilter, string> = {
  email: 'Con email',
  linkedin: 'Con LinkedIn',
  no_linkedin: 'Senza LinkedIn',
};

export interface PeopleSearch {
  view?: Exclude<PeopleView, 'tutte'>;
  q?: string;
  /** Stati separati da virgola (`scartato` solo nella vista Scartate). */
  status?: string;
  /** Id di una lista oppure `none` (nessuna lista). */
  list?: number | 'none';
  source?: SourceKind;
  post?: number;
  company?: number;
  icp?: number;
  fit?: FitFilter;
  next?: NextFilter;
  contact?: ContactFilter;
  sort?: PeopleSort;
  page?: number;
}

export const Route = createFileRoute('/people/')({
  component: PeoplePage,
  validateSearch: (s: Record<string, unknown>): PeopleSearch => {
    const view = searchParam.oneOf(PEOPLE_VIEWS, s.view);
    return {
      view: view === 'tutte' ? undefined : view,
      q: searchParam.text(s.q),
      status: searchParam.csv(PROSPECT_STATUSES, s.status),
      list: s.list === 'none' ? 'none' : searchParam.id(s.list),
      source: searchParam.oneOf(SOURCE_KINDS, s.source),
      post: searchParam.id(s.post),
      company: searchParam.id(s.company),
      icp: searchParam.id(s.icp),
      fit: searchParam.oneOf(FIT_FILTERS, s.fit),
      next: searchParam.oneOf(NEXT_FILTERS, s.next),
      contact: searchParam.oneOf(CONTACT_FILTERS, s.contact),
      sort: searchParam.oneOf(SORTS, s.sort),
      page: searchParam.page(s.page),
    };
  },
});

const PAGE_SIZE = 50;

function PeoplePage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const today = useToday();
  const view: PeopleView = search.view ?? 'tutte';
  const page = search.page ?? 1;
  const statuses = csvValues<ProspectStatus>(search.status).filter((s) => (view === 'scartate' ? s === 'scartato' : s !== 'scartato'));
  const [moreFilters, setMoreFilters] = useState(Boolean(search.post || search.company || search.icp || search.fit || search.contact));

  const settings = useQuery({ queryKey: queryKeys.settings, queryFn: api.settings.get });
  const icps = useQuery({ queryKey: queryKeys.icpsIndex, queryFn: api.icps.list });
  const lists = useQuery({ queryKey: queryKeys.listsIndex(false), queryFn: () => api.lists.list() });
  const posts = useQuery({ queryKey: queryKeys.posts, queryFn: api.sync.posts });
  const companies = useQuery({ queryKey: queryKeys.companiesIndex(''), queryFn: () => api.companies.list(), enabled: moreFilters });
  const icpItems = icps.data?.items ?? [];
  const multiIcp = icpItems.length > 1;
  // Il fit vale entro un ICP: con più ICP serve sceglierlo, con uno solo è implicito (FLOW E.3).
  const fitUsable = icpItems.length === 1 || (multiIcp && search.icp !== undefined);

  const filters: ProspectQuery = {
    q: search.q,
    status: view !== 'scartate' && statuses.length > 0 ? statuses : undefined,
    ...(search.list === 'none' ? { list: 'none' as const } : search.list ? { listId: search.list } : {}),
    source: search.source ? [search.source] : undefined,
    postId: search.post,
    companyId: search.company,
    icpId: search.icp,
    fit: search.fit && fitUsable ? [search.fit] : undefined,
    next: search.next ? [search.next] : undefined,
    contact: search.contact,
    today,
  };
  const sort = search.sort === 'fit' && !fitUsable ? undefined : search.sort;
  const query: ProspectQuery = { ...filters, view, sort, page, pageSize: PAGE_SIZE };

  const people = useQuery({
    queryKey: queryKeys.prospectsSearch(query),
    queryFn: () => api.prospects.search(query),
    placeholderData: keepPreviousData,
    enabled: icps.isFetched || (!search.fit && search.sort !== 'fit'),
  });
  const counts = useQuery({
    queryKey: queryKeys.viewCounts(filters),
    queryFn: () => api.prospects.viewCounts(filters),
    placeholderData: keepPreviousData,
    enabled: icps.isFetched || !search.fit,
  });

  // Selezione per id: resta tra pagine e filtri della stessa vista, si azzera cambiando vista (FLOW Edge "Selezione").
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [capNotice, setCapNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | 'add' | 'analyze' | 'enrich' | 'sync'>(null);
  const [lastIcpId, setLastIcpId] = useState<number | undefined>(undefined);
  const lastView = useRef(view);
  useEffect(() => {
    if (lastView.current !== view) {
      lastView.current = view;
      setSelected(new Set());
      setCapNotice(null);
    }
  }, [view]);
  const selectedIds = [...selected];
  const resultsRef = useRef<HTMLParagraphElement>(null);

  const updateSelection = (next: Set<number>) => {
    setSelected(next);
    setCapNotice(null);
  };

  const selectAll = useMutation({
    mutationFn: () => api.prospects.searchIds({ ...filters, view, sort }),
    onSuccess: ({ ids, total, capped }) => {
      setSelected((cur) => new Set([...cur, ...ids]));
      setCapNotice(capped ? `Selezionate le prime ${fmtCount(ids.length)} di ${fmtCount(total)}: affina i filtri per il resto.` : null);
    },
    onError: (err) => toast({ tone: 'error', title: 'Selezione non riuscita', description: err instanceof Error ? err.message : undefined }),
  });

  const rows = people.data?.items ?? [];
  const bulkStatus = useMutation({
    mutationFn: (status: ProspectStatus) => api.prospects.bulkStatus({ prospectIds: selectedIds, status }),
    onSuccess: (result, status) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.prospects });
      void queryClient.invalidateQueries({ queryKey: queryKeys.inbox });
      void queryClient.invalidateQueries({ queryKey: queryKeys.lists });
      const done = result.updated + result.unchanged;
      const withAction = rows.filter((r) => selected.has(r.id) && r.next_action_on).length;
      toast({
        tone: 'success',
        title:
          status === 'scartato'
            ? `${fmtCount(done)} ${done === 1 ? 'scartata' : 'scartate'}. Le ritrovi in Scartate.`
            : status === 'nuovo' && view === 'scartate'
              ? `${fmtCount(done)} ${done === 1 ? 'ripristinata' : 'ripristinate'}: ${done === 1 ? 'torna' : 'tornano'} in Tutte.`
              : `Stato aggiornato: ${STATUS_LABELS[status]} (${fmtCount(done)})`,
        description:
          status === 'scartato' && withAction > 0
            ? `${withAction} ${withAction === 1 ? 'aveva' : 'avevano'} una prossima azione: la conserv${withAction === 1 ? 'a' : 'ano'}, ma non comparirà più in Oggi.`
            : result.not_found > 0
              ? `${result.not_found} non più presenti.`
              : undefined,
      });
      updateSelection(new Set());
      // Le righe escono dalla vista: il focus va al riepilogo dei risultati (lezione TD-4).
      resultsRef.current?.focus();
    },
    onError: (err) =>
      toast({
        tone: 'error',
        title: 'Operazione non riuscita',
        description: `${err instanceof Error ? err.message : 'Errore inatteso.'} La selezione è rimasta: puoi riprovare.`,
      }),
  });

  const setSearch = (patch: Partial<PeopleSearch>, opts: { replace?: boolean } = {}) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch, page: 'page' in patch ? patch.page : undefined }), replace: opts.replace });
  const [qDraft, setQDraft] = useSearchDraft(search.q, (q) => setSearch({ q }, { replace: true }));

  const lastSync = (posts.data?.items ?? [])
    .map((p) => p.last_synced_at)
    .filter((d): d is string => d !== null)
    .sort()
    .at(-1);
  const canSync = settings.data?.readiness.profile === true;

  const listItems = lists.data?.items ?? [];
  const listName = (id: number) => listItems.find((l) => l.id === id)?.name ?? `Lista #${id}`;
  const companyName = (id: number) => {
    const c = companies.data?.items.find((x) => x.id === id);
    return c ? (c.name ?? c.domain ?? `Azienda #${id}`) : `Azienda #${id}`;
  };

  const primary: FilterSelectConfig[] = [
    ...(view !== 'scartate'
      ? [
          {
            key: 'status',
            label: 'Stato',
            value: statuses.length === 1 ? statuses[0] : '',
            onChange: (v: string) => setSearch({ status: v || undefined }),
            options: [
              { value: '', label: 'Tutti gli stati' },
              ...PROSPECT_STATUSES.filter((s) => s !== 'scartato').map((s) => ({ value: s, label: STATUS_LABELS[s] })),
            ],
          },
        ]
      : []),
    {
      key: 'list',
      label: 'Lista',
      value: search.list ? String(search.list) : '',
      onChange: (v) => setSearch({ list: v === 'none' ? 'none' : v ? Number(v) : undefined }),
      options: [
        { value: '', label: 'Tutte le liste' },
        { value: 'none', label: 'Nessuna lista' },
        ...listItems.map((l) => ({ value: String(l.id), label: l.name })),
      ],
    },
    {
      key: 'source',
      label: 'Fonte',
      value: search.source ?? '',
      onChange: (v) => setSearch({ source: (v || undefined) as SourceKind | undefined }),
      options: [{ value: '', label: 'Tutte le fonti' }, ...SOURCE_KINDS.map((s) => ({ value: s, label: SOURCE_LABELS[s] }))],
    },
    {
      key: 'next',
      label: 'Prossima azione',
      value: search.next ?? '',
      onChange: (v) => setSearch({ next: (v || undefined) as NextFilter | undefined }),
      options: [{ value: '', label: 'Prossima azione: tutte' }, ...NEXT_FILTERS.map((n) => ({ value: n, label: `Prossima azione: ${NEXT_LABELS[n].toLowerCase()}` }))],
    },
    {
      key: 'sort',
      label: 'Ordinamento',
      value: sort ?? '',
      onChange: (v) => setSearch({ sort: (v || undefined) as PeopleSort | undefined }),
      options: [
        { value: '', label: view === 'con_prossima_azione' ? SORT_LABELS.next_action : SORT_LABELS.recent },
        ...SORTS.filter((s) => (view === 'con_prossima_azione' ? s !== 'next_action' : s !== 'recent'))
          .filter((s) => s !== 'fit' || fitUsable)
          .map((s) => ({ value: s, label: SORT_LABELS[s] })),
      ],
    },
  ];

  const more: FilterSelectConfig[] = [
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
      key: 'company',
      label: 'Azienda collegata',
      value: search.company ? String(search.company) : '',
      onChange: (v) => setSearch({ company: v ? Number(v) : undefined }),
      options: [
        { value: '', label: 'Tutte le aziende' },
        ...(companies.data?.items ?? []).slice(0, 200).map((c) => ({ value: String(c.id), label: c.name ?? c.domain ?? `Azienda #${c.id}` })),
      ],
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
      key: 'contact',
      label: 'Recapiti',
      value: search.contact ?? '',
      onChange: (v) => setSearch({ contact: (v || undefined) as ContactFilter | undefined }),
      options: [{ value: '', label: 'Tutti i recapiti' }, ...CONTACT_FILTERS.map((c) => ({ value: c, label: CONTACT_LABELS[c] }))],
    },
  ];

  const chips: ActiveFilterChip[] = [];
  if (search.q) chips.push({ key: 'q', label: `Cerca: ${search.q}`, onClear: () => setSearch({ q: undefined }) });
  if (statuses.length > 0 && view !== 'scartate')
    chips.push({ key: 'status', label: `Stato: ${statuses.map((s) => STATUS_LABELS[s]).join(', ')}`, onClear: () => setSearch({ status: undefined }) });
  if (search.list)
    chips.push({
      key: 'list',
      label: search.list === 'none' ? 'Nessuna lista' : `Lista: ${listName(search.list)}`,
      onClear: () => setSearch({ list: undefined }),
    });
  if (search.source) chips.push({ key: 'source', label: `Fonte: ${SOURCE_LABELS[search.source]}`, onClear: () => setSearch({ source: undefined }) });
  if (search.next) chips.push({ key: 'next', label: `Prossima azione: ${NEXT_LABELS[search.next].toLowerCase()}`, onClear: () => setSearch({ next: undefined }) });
  if (search.post) chips.push({ key: 'post', label: `Post #${search.post}`, onClear: () => setSearch({ post: undefined }) });
  if (search.company) chips.push({ key: 'company', label: `Azienda: ${companyName(search.company)}`, onClear: () => setSearch({ company: undefined }) });
  if (search.icp)
    chips.push({
      key: 'icp',
      label: `ICP: ${icpItems.find((i) => i.id === search.icp)?.name ?? search.icp}`,
      onClear: () => setSearch({ icp: undefined, fit: undefined }),
    });
  if (search.fit && fitUsable) chips.push({ key: 'fit', label: FIT_FILTER_LABELS[search.fit], onClear: () => setSearch({ fit: undefined }) });
  if (search.contact) chips.push({ key: 'contact', label: CONTACT_LABELS[search.contact], onClear: () => setSearch({ contact: undefined }) });
  const clearAll = () => void navigate({ search: search.view ? { view: search.view } : {} });

  const total = people.data?.total ?? 0;
  // Pagina oltre l'ultima (URL vecchio, righe uscite dalla vista): si torna all'ultima pagina con righe.
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pastEnd = people.isSuccess && !people.isPlaceholderData && total > 0 && page > lastPage;
  useEffect(() => {
    if (pastEnd) setSearch({ page: lastPage > 1 ? lastPage : undefined }, { replace: true });
  }, [pastEnd, lastPage]);
  const hasFilters = chips.length > 0;
  const crmEmpty = counts.data !== undefined && counts.data.tutte + counts.data.scartate === 0 && !hasFilters;
  const impossible = view === 'da_smistare' && search.source === 'manual';
  const discardedMatches = view !== 'scartate' && search.q ? (counts.data?.scartate ?? 0) : 0;

  return (
    <>
      <PageHeader
        title="Persone"
        subtitle={
          view === 'da_smistare'
            ? `Chi arriva dai tuoi strumenti e non è in nessuna lista.${posts.isSuccess ? ` Ultimo sync: ${lastSync ? timeAgo(lastSync) : 'mai'}.` : ''}`
            : undefined
        }
        actions={
          <>
            {view === 'da_smistare' && (
              <div className="flex flex-col items-end gap-1">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialog('sync')}
                  disabled={settings.data ? !canSync : false}
                  aria-describedby={settings.data && !canSync ? 'sync-profile-hint' : undefined}
                >
                  Sincronizza interazioni
                </Button>
                {settings.data && !canSync && (
                  <p id="sync-profile-hint" className="text-xs text-slate-500">
                    Serve il tuo profilo LinkedIn.{' '}
                    <Link to="/settings" hash="profilo" className="font-medium underline underline-offset-2">
                      Salva il profilo
                    </Link>
                  </p>
                )}
              </div>
            )}
            <Link to="/people/new" className={buttonVariants()}>
              <UserPlusIcon aria-hidden="true" />
              Aggiungi persona
            </Link>
          </>
        }
      />

      <ViewTabs view={view} counts={counts.data} searchFor={(v) => viewSearch(search, v)} />

      <Card>
        <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <FilterBar
              search={{ value: qDraft, onChange: setQDraft, placeholder: 'Cerca nome, azienda, email, evento…', label: 'Cerca tra le persone' }}
              selects={primary}
            />
            <Button
              type="button"
              variant={moreFilters ? 'secondary' : 'outline'}
              aria-expanded={moreFilters}
              aria-controls="altri-filtri"
              onClick={() => setMoreFilters((v) => !v)}
            >
              <SlidersHorizontalIcon aria-hidden="true" />
              Altri filtri
            </Button>
          </div>
          {moreFilters && (
            <div id="altri-filtri" className="flex flex-wrap items-center gap-2">
              <FilterBar selects={more} />
              <FitSelect
                value={search.fit}
                disabledHint={icpItems.length === 0 ? 'Fit: crea prima un ICP' : !fitUsable ? "Fit: scegli prima l'ICP" : null}
                onChange={(fit) => setSearch({ fit })}
              />
            </div>
          )}
          <FilterChips chips={chips} onClearAll={clearAll} />
          {discardedMatches > 0 && (
            <p className="text-sm text-slate-600">
              Anche {fmtCount(discardedMatches)} {discardedMatches === 1 ? 'persona scartata corrisponde' : 'persone scartate corrispondono'} a '{search.q}'.{' '}
              <Link to="/people" search={{ view: 'scartate', q: search.q } as never} className="font-medium underline">
                {discardedMatches === 1 ? 'Mostrala' : 'Mostrale'}
              </Link>
            </p>
          )}
        </div>
        <p ref={resultsRef} tabIndex={-1} className="sr-only" aria-live="polite">
          {people.data ? `${fmtCount(total)} ${total === 1 ? 'persona' : 'persone'} in ${VIEW_LABELS[view]}` : ''}
        </p>

        {people.isPending ? (
          <Loading />
        ) : people.error ? (
          <div className="flex flex-col items-start gap-3 p-4">
            <ErrorBox error={people.error} />
            <Button type="button" variant="outline" onClick={() => void people.refetch()}>
              Riprova
            </Button>
          </div>
        ) : rows.length === 0 ? (
          crmEmpty ? (
            <EmptyCrm readiness={{ profile: canSync, icp: settings.data?.readiness.icp === true }} onSync={() => setDialog('sync')} />
          ) : impossible ? (
            <Empty title="Le persone aggiunte a mano non passano da Da smistare." action={<ClearButton onClick={() => setSearch({ source: undefined })} label="Togli il filtro Fonte" />} />
          ) : hasFilters ? (
            <Empty title="Nessuna persona corrisponde ai filtri." action={<ClearButton onClick={clearAll} label="Pulisci" />} />
          ) : view === 'da_smistare' ? (
            <Empty
              title="Niente da smistare: hai messo in lista o scartato tutte le persone arrivate dai tuoi strumenti."
              hint={lastSync ? `Ultimo sync: ${timeAgo(lastSync)} (${posts.data?.items.length ?? 0} post).` : undefined}
              action={
                <div className="flex justify-center gap-2">
                  <Button type="button" onClick={() => setDialog('sync')} disabled={!canSync}>
                    Sincronizza interazioni
                  </Button>
                  <Link to="/people" search={{ view: 'scartate' } as never} className={buttonVariants({ variant: 'outline' })}>
                    Vedi le scartate
                  </Link>
                </div>
              }
            />
          ) : view === 'scartate' ? (
            <Empty title="Nessuna persona scartata." hint="Qui ritrovi chi hai scartato, per ripristinarlo." />
          ) : view === 'con_prossima_azione' ? (
            <Empty title="Nessuna prossima azione." hint="Impostala dalla scheda di una persona o quando la aggiungi." />
          ) : (
            <Empty title="Nessuna persona." />
          )
        ) : (
          <ProspectTable
            caption={`Persone: vista ${VIEW_LABELS[view]}`}
            rows={rows}
            selected={selected}
            onSelectedChange={updateSelection}
            columns={{ email: false, fit: fitUsable, lists: true, nextAction: true, addedAt: true }}
            today={today}
            busy={people.isFetching && people.isPlaceholderData}
            selectAll={{ total, onSelectAll: () => selectAll.mutate(), pending: selectAll.isPending, notice: capNotice }}
            pagination={{ page, pageSize: PAGE_SIZE, total, onPageChange: (p) => setSearch({ page: p > 1 ? p : undefined }) }}
          />
        )}
      </Card>

      <BulkBar count={selected.size} onClear={() => updateSelection(new Set())} notice={capNotice}>
        {/* B9: le stesse azioni in ogni vista; in Scartate "Ripristina" (→ Nuovo) al posto di "Scarta". */}
        <Button type="button" size="sm" onClick={() => setDialog('add')}>
          Aggiungi a lista
        </Button>
        {view === 'scartate' ? (
          <Button type="button" size="sm" variant="outline" onClick={() => bulkStatus.mutate('nuovo')} disabled={bulkStatus.isPending} aria-busy={bulkStatus.isPending}>
            Ripristina
          </Button>
        ) : (
          <Button type="button" size="sm" variant="outline" onClick={() => bulkStatus.mutate('scartato')} disabled={bulkStatus.isPending} aria-busy={bulkStatus.isPending}>
            Scarta
          </Button>
        )}
        <ChangeStatusSelect disabled={bulkStatus.isPending} onChange={(s) => bulkStatus.mutate(s)} />
        <Button type="button" size="sm" variant="outline" onClick={() => setDialog('enrich')}>
          Arricchisci…
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setDialog('analyze')}>
          Analizza…
        </Button>
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

/** Search della vista `v` con gli stessi filtri (la pagina riparte da 1; lo stato "scartato" vale solo in Scartate). */
function viewSearch(search: PeopleSearch, v: PeopleView): PeopleSearch {
  const { page: _page, view: _view, status, ...rest } = search;
  const kept = csvValues<ProspectStatus>(status).filter((s) => s !== 'scartato');
  return { ...rest, ...(v === 'tutte' ? {} : { view: v }), ...(v !== 'scartate' && kept.length ? { status: kept.join(',') } : {}) };
}

/** Viste come link con conteggio e `aria-current` (B2, FLOW Decisioni UX): vivono nell'URL. */
function ViewTabs(props: { view: PeopleView; counts?: { [K in PeopleView]: number }; searchFor: (v: PeopleView) => PeopleSearch }) {
  return (
    <nav aria-label="Viste" className="mb-3 flex flex-wrap items-center gap-1">
      {PEOPLE_VIEWS.map((v) => {
        const active = v === props.view;
        const n = props.counts?.[v];
        return (
          <Link
            key={v}
            to="/people"
            search={props.searchFor(v) as never}
            // Attiva solo la vista esatta (senza, "Tutte" risulterebbe attiva in ogni vista).
            activeOptions={{ exact: true, includeSearch: true }}
            aria-current={active ? 'page' : undefined}
            aria-label={n === undefined ? VIEW_LABELS[v] : `${VIEW_LABELS[v]}, ${fmtCount(n)}`}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
              active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-200/60 hover:text-slate-900',
            )}
          >
            {VIEW_LABELS[v]}
            {n !== undefined && <span className={cn('tabular-nums', active ? 'text-slate-300' : 'text-slate-400')}>{fmtCount(n)}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

/** "Cambia stato ▾" della BulkBar: tutti gli stati (Scarta e Ripristina hanno anche il bottone diretto). */
function ChangeStatusSelect({ onChange, disabled }: { onChange: (status: ProspectStatus) => void; disabled?: boolean }) {
  return (
    <Select value="" onValueChange={(v) => onChange(v as ProspectStatus)} disabled={disabled}>
      <SelectTrigger size="sm" className="w-auto" aria-label="Cambia stato dei selezionati">
        <SelectValue placeholder="Cambia stato" />
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

/** Filtro fit con stato disabilitato esplicito (con più ICP serve prima l'ICP). */
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

function ClearButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick}>
      {label}
    </Button>
  );
}

function Empty({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {hint && <p className="text-sm text-slate-500">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/**
 * CRM vuoto (B10, FLOW H.3): le stesse tre strade dell'onboarding, con i requisiti scritti sulla strada che li
 * richiede. La strada manuale non ha requisiti (C11).
 */
function EmptyCrm({ readiness, onSync }: { readiness: { profile: boolean; icp: boolean }; onSync: () => void }) {
  return (
    <div className="flex flex-col gap-4 px-4 py-8">
      <p className="text-center text-sm font-medium text-slate-700">Il CRM è vuoto.</p>
      <StartPaths readiness={readiness} onSync={onSync} />
    </div>
  );
}
