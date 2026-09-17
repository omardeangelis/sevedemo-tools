import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { api, isApiError, queryKeys } from '../api/client';
import {
  CANDIDATE_STATUSES,
  CANDIDATE_STATUS_FILTER_LABELS,
  scoreBucketOf,
  type ApolloPeopleJobParams,
  type Candidate,
  type CandidatesResponse,
  type CandidateStatus,
  type IcpDetail,
  type ScoreBucket,
} from '../api/types';
import { invalidateCandidateQueries, isZeroOutcome, useCurrentJob } from '../lib/jobs';
import { BulkBar } from './BulkBar';
import { ContactsDialog, type ContactsCompany, type ContactsDialogValues } from './ContactsDialog';
import { LookalikeDialog, shortDay } from './LookalikeDialog';
import { Card, ErrorBox } from './ui';
import { toast } from './ui/toaster';

/*
 * Sezione "Candidate" della pagina ICP (apollo-lookalike T13, FLOW B, SPEC E1–E5, P-8, P-17): filtro per stato
 * nell'URL (`?candidates=` + `cpage`), tabella ordinata per punteggio (paginazione lato client a 50), punteggio
 * in %, "perché simile" in chip, badge "Senza pagina LinkedIn" e "già cercata il <data>", azioni di riga senza
 * conferme, selezione + bulk Accetta · Scarta · Riproponi con esito per item, "Trova contatti" (FLOW C) da
 * bulk, header e toast dopo un Accetta in bulk. Il focus non torna mai a `body` dopo un cambio di stato.
 */

const PAGE_SIZE = 50;
const nf = (value: number | undefined) => (value ?? 0).toLocaleString('it-IT');

/** Cambio di URL chiesto dalla sezione (filtro di stato e pagina). */
export interface CandidatesSearchPatch {
  /** `undefined` = `proposta` (default, fuori dall'URL). */
  candidates?: CandidateStatus;
  /** `undefined` = pagina 1. */
  cpage?: number;
}

export interface CandidatesSectionProps {
  icp: IcpDetail;
  status: CandidateStatus;
  /** Pagina (1-based) della tabella; oltre l'ultima si mostra l'ultima. */
  page: number;
  onSearchChange: (patch: CandidatesSearchPatch, opts?: { scrollToSection?: boolean }) => void;
}

const STATUS_VERB: Record<CandidateStatus, [string, string]> = {
  proposta: ['riproposta', 'riproposte'],
  accettata: ['accettata', 'accettate'],
  scartata: ['scartata', 'scartate'],
};

/** Azioni di riga per stato (FLOW B.2): mai quella dello stato corrente. */
const ROW_ACTIONS: Record<CandidateStatus, Array<{ to: CandidateStatus; label: string }>> = {
  proposta: [
    { to: 'accettata', label: 'Accetta' },
    { to: 'scartata', label: 'Scarta' },
  ],
  accettata: [
    { to: 'scartata', label: 'Scarta' },
    { to: 'proposta', label: 'Riproponi' },
  ],
  scartata: [
    { to: 'accettata', label: 'Accetta' },
    { to: 'proposta', label: 'Riproponi' },
  ],
};

export function candidateName(c: Pick<Candidate, 'company_id' | 'name' | 'domain' | 'linkedin_url'>): string {
  return (
    c.name ??
    c.domain ??
    (c.linkedin_url ? c.linkedin_url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') : null) ??
    `Azienda #${c.company_id}`
  );
}

const toContactsCompany = (c: Candidate): ContactsCompany => ({ company_id: c.company_id, name: c.name, domain: c.domain });

function errorMessage(err: unknown): string {
  if (isApiError(err) && err.body?.issues?.length) return err.body.issues.map((i) => i.message).join(' ');
  return err instanceof Error ? err.message : 'errore inatteso.';
}

// ---------------------------------------------------------------------------
// Sezione
// ---------------------------------------------------------------------------

/**
 * @example
 * <CandidatesSection icp={icp} status={search.candidates ?? 'proposta'} page={search.cpage ?? 1}
 *   onSearchChange={(patch) => navigate({ search: (prev) => ({ ...prev, ...patch }), resetScroll: false })} />
 */
export function CandidatesSection({ icp, status, page, onSearchChange }: CandidatesSectionProps) {
  const queryClient = useQueryClient();
  const headingRef = useRef<HTMLSpanElement>(null);
  const query = useQuery({
    queryKey: queryKeys.candidates(icp.id, status),
    queryFn: () => api.candidates.list(icp.id, status),
    placeholderData: keepPreviousData,
  });

  const [contacts, setContacts] = useState<{ open: boolean; companies: ContactsCompany[]; initial?: ContactsDialogValues }>({
    open: false,
    companies: [],
  });
  const openContacts = (companies: ContactsCompany[], initial?: ContactsDialogValues) =>
    setContacts({ open: true, companies, initial });
  const [searchOpen, setSearchOpen] = useState(false);

  // "Trova contatti in tutte le accettate (N)": tutte le accettate, fresche (anche con un altro filtro attivo).
  const allAccepted = useMutation({
    mutationFn: () =>
      queryClient.fetchQuery({
        queryKey: queryKeys.candidates(icp.id, 'accettata'),
        queryFn: () => api.candidates.list(icp.id, 'accettata'),
      }),
    onSuccess: (data) => openContacts(data.items.map(toContactsCompany)),
    onError: (err) => toast({ tone: 'error', title: 'Candidate accettate non caricate', description: errorMessage(err) }),
  });

  const data = query.data;
  const counts = data?.counts;
  const totalAll = counts ? counts.proposta + counts.accettata + counts.scartata : 0;

  let content: ReactNode = null;
  if (!data && query.error) {
    content = (
      <Card title="Candidate">
        <div className="flex flex-col items-start gap-3 p-4">
          <ErrorBox error={query.error} />
          <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
            Riprova
          </Button>
        </div>
      </Card>
    );
  } else if (data && counts && totalAll > 0) {
    content = (
      <Card
        title={
          <span ref={headingRef} tabIndex={-1} className="outline-none">
            Candidate ({nf(totalAll)})
          </span>
        }
        actions={
          counts.accettata > 0 ? (
            <Button
              type="button"
              size="sm"
              onClick={() => {
                if (!allAccepted.isPending) allAccepted.mutate();
              }}
              aria-busy={allAccepted.isPending}
            >
              Trova contatti in tutte le accettate ({nf(counts.accettata)})
            </Button>
          ) : undefined
        }
      >
        <StatusFilter
          status={status}
          counts={counts}
          onChange={(next) => onSearchChange({ candidates: next === 'proposta' ? undefined : next, cpage: undefined })}
        />
        <ContactsZeroOutcome icp={icp} onRetry={openContacts} />
        {/* Stato come chiave: cambiare filtro azzera selezione e focus in sospeso. */}
        <CandidatesView
          key={status}
          icp={icp}
          status={status}
          page={page}
          data={data}
          loading={query.isPlaceholderData}
          headingRef={headingRef}
          onSearchChange={onSearchChange}
          onOpenContacts={openContacts}
          onFindMore={() => setSearchOpen(true)}
        />
      </Card>
    );
  }

  return (
    <>
      {content}
      <ContactsDialog
        mode="icp"
        icp={icp}
        open={contacts.open}
        onOpenChange={(open) => setContacts((cur) => ({ ...cur, open }))}
        companies={contacts.companies}
        initial={contacts.initial}
      />
      <LookalikeDialog open={searchOpen} onOpenChange={setSearchOpen} icp={icp} />
    </>
  );
}

/** Chip di stato con i conteggi: "Proposte 61 · Accettate 18 · Scartate 5" (FLOW B.1). */
function StatusFilter(props: {
  status: CandidateStatus;
  counts: Record<CandidateStatus, number>;
  onChange: (status: CandidateStatus) => void;
}) {
  return (
    <div role="group" aria-label="Filtra le candidate per stato" className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
      {CANDIDATE_STATUSES.map((s) => {
        const active = s === props.status;
        return (
          <button
            key={s}
            type="button"
            aria-pressed={active}
            data-status-filter={s}
            onClick={() => props.onChange(s)}
            className={cn(
              'inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium tabular-nums focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:outline-none',
              active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
            )}
          >
            {CANDIDATE_STATUS_FILTER_LABELS[s]} <span className={active ? 'text-slate-300' : 'text-slate-500'}>{nf(props.counts[s])}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Ultima ricerca contatti di questo ICP senza risultati (FLOW C.3 zero neutro): "Riprova con altri filtri" riapre
 * il dialog con le stesse aziende e opzioni. Letta dal job corrente/ultimo (`GET /api/jobs/current`).
 */
function ContactsZeroOutcome({ icp, onRetry }: { icp: IcpDetail; onRetry: (companies: ContactsCompany[], initial: ContactsDialogValues) => void }) {
  const current = useCurrentJob();
  const [dismissed, setDismissed] = useState<number | null>(null);
  const job = current.data?.job ?? null;
  const params = job?.params as Partial<ApolloPeopleJobParams> | undefined;
  const loadAll = useMutation({
    mutationFn: () => api.candidates.list(icp.id),
    onError: (err) => toast({ tone: 'error', title: 'Candidate non caricate', description: errorMessage(err) }),
  });

  if (
    !job ||
    job.kind !== 'apollo_people' ||
    job.state !== 'succeeded' ||
    params?.icpId !== icp.id ||
    !isZeroOutcome(job) ||
    dismissed === job.id
  ) {
    return null;
  }
  const retry = () =>
    loadAll.mutate(undefined, {
      onSuccess: (all) => {
        const ids = params.companyIds ?? [];
        const byId = new Map(all.items.map((c) => [c.company_id, c]));
        onRetry(
          ids.map((id) => {
            const row = byId.get(id);
            return row ? toContactsCompany(row) : { company_id: id, name: null, domain: null };
          }),
          {
            listId: params.listId,
            roles: params.roles,
            seniorities: params.seniorities,
            locations: params.locations,
            perCompany: params.perCompany,
          },
        );
      },
    });
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2 text-sm text-slate-700" data-testid="contacts-zero-outcome">
      <p className="min-w-0 flex-1">
        <span className="font-medium">Ultima ricerca contatti senza risultati:</span> {job.result?.summary}
      </p>
      <Button type="button" size="sm" variant="outline" onClick={retry} disabled={loadAll.isPending} aria-busy={loadAll.isPending}>
        Riprova con altri filtri
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setDismissed(job.id)} aria-label="Nascondi l'esito della ricerca contatti">
        Nascondi
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabella e azioni
// ---------------------------------------------------------------------------

/** Focus da sistemare quando le righe cambiate sono uscite dalla vista. */
interface PendingFocus {
  removed: number[];
  /** Riga su cui spostarsi (azione di riga) e indice dell'azione cliccata. */
  rowId: number | null;
  action: number;
  /** Dopo questo istante (ms) il focus non si sposta più da solo. */
  until: number;
}

/** Finestra in cui un cambio di stato può ancora spostare un focus perso (refetch che toglie la selezione). */
const FOCUS_WINDOW_MS = 3000;

function CandidatesView(props: {
  icp: IcpDetail;
  status: CandidateStatus;
  page: number;
  data: CandidatesResponse;
  /** Righe di un altro stato mostrate come segnaposto mentre si carica quello scelto. */
  loading: boolean;
  headingRef: RefObject<HTMLSpanElement | null>;
  onSearchChange: CandidatesSectionProps['onSearchChange'];
  onOpenContacts: (companies: ContactsCompany[]) => void;
  onFindMore: () => void;
}) {
  const { icp, status, data, onOpenContacts } = props;
  const queryClient = useQueryClient();
  const uid = useId();
  const tableRef = useRef<HTMLTableElement>(null);
  const items = data.items;
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, props.page), pages);
  const pageRows = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const itemIds = new Set(items.map((c) => c.company_id));
  const selectedIds = [...selected].filter((id) => itemIds.has(id));
  const [pendingRows, setPendingRows] = useState<ReadonlySet<number>>(new Set());
  const [announcement, setAnnouncement] = useState('');
  const pendingFocus = useRef<PendingFocus | null>(null);

  // Focus dopo un cambio di stato (FLOW Accessibilità, TD-4): riga successiva (stessa azione), altrimenti prima
  // checkbox della pagina, altrimenti il titolo della sezione. Mai `body`.
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    if (Date.now() > target.until) {
      pendingFocus.current = null;
      return;
    }
    if (target.removed.some((id) => itemIds.has(id))) return;
    const active = document.activeElement;
    const lost = !active || active === document.body || !active.isConnected;
    const table = tableRef.current;
    if (target.rowId !== null && table) {
      const buttons = table.querySelectorAll<HTMLButtonElement>(`tr[data-company-id="${target.rowId}"] [data-row-action]`);
      const button = buttons[Math.min(target.action, buttons.length - 1)];
      if (button) {
        pendingFocus.current = null;
        button.focus();
        return;
      }
    }
    // Focus ancora su un elemento vivo (es. bottone della BulkBar con le fallite selezionate): si riprova al
    // prossimo cambio di righe o selezione finché la finestra è aperta.
    if (!lost) return;
    pendingFocus.current = null;
    const firstCheckbox = table?.querySelector<HTMLElement>('tbody [role="checkbox"]');
    if (firstCheckbox) firstCheckbox.focus();
    else props.headingRef.current?.focus();
  }, [items, selectedIds.length]);

  /** Toglie dalla vista corrente le candidate cambiate (i conteggi seguono) prima del refetch. */
  const removeFromView = (ids: number[], to: CandidateStatus) => {
    const gone = new Set(ids);
    queryClient.setQueryData<CandidatesResponse>(queryKeys.candidates(icp.id, status), (cur) => {
      if (!cur) return cur;
      const kept = cur.items.filter((c) => !gone.has(c.company_id));
      const moved = cur.items.length - kept.length;
      return {
        ...cur,
        items: kept,
        total: Math.max(0, cur.total - moved),
        counts: { ...cur.counts, [status]: Math.max(0, cur.counts[status] - moved), [to]: cur.counts[to] + moved },
      };
    });
  };

  const rowChange = useMutation({
    mutationFn: (vars: { row: Candidate; to: CandidateStatus; action: number; nextId: number | null }) =>
      api.candidates.update(icp.id, vars.row.company_id, vars.to),
    onMutate: (vars) => setPendingRows((cur) => new Set(cur).add(vars.row.company_id)),
    onSettled: (_data, _err, vars) =>
      setPendingRows((cur) => {
        const next = new Set(cur);
        next.delete(vars.row.company_id);
        return next;
      }),
    onSuccess: (_candidate, vars) => {
      const id = vars.row.company_id;
      pendingFocus.current = { removed: [id], rowId: vars.nextId, action: vars.action, until: Date.now() + FOCUS_WINDOW_MS };
      setSelected((cur) => {
        if (!cur.has(id)) return cur;
        const next = new Set(cur);
        next.delete(id);
        return next;
      });
      setAnnouncement(`${candidateName(vars.row)} ${STATUS_VERB[vars.to][0]}.`);
      removeFromView([id], vars.to);
      void invalidateCandidateQueries(queryClient, icp.id, [id]);
    },
    onError: (err, vars) => {
      const gone = isApiError(err) && err.status === 404;
      toast({
        tone: 'error',
        title: `Stato non aggiornato: ${errorMessage(err)}`,
        description: gone
          ? `${candidateName(vars.row)} non è più tra le candidate di questo ICP (unita o promossa a riferimento): la tabella si aggiorna.`
          : `${candidateName(vars.row)} resta com'era.`,
      });
      if (gone) {
        // La riga sparirà al refetch: il focus passa alla riga successiva come dopo un cambio riuscito.
        pendingFocus.current = { removed: [vars.row.company_id], rowId: vars.nextId, action: vars.action, until: Date.now() + FOCUS_WINDOW_MS };
        void invalidateCandidateQueries(queryClient, icp.id, [vars.row.company_id]);
      }
    },
  });

  const changeRow = (row: Candidate, to: CandidateStatus, action: number) => {
    // Nessun `disabled` durante l'attesa: un bottone disabilitato perde il focus (che finirebbe su `body`).
    if (pendingRows.has(row.company_id) || bulk.isPending) return;
    const index = pageRows.findIndex((r) => r.company_id === row.company_id);
    const next = pageRows[index + 1] ?? pageRows[index - 1] ?? null;
    rowChange.mutate({ row, to, action, nextId: next?.company_id ?? null });
  };

  const bulk = useMutation({
    mutationFn: (vars: { rows: Candidate[]; to: CandidateStatus }) =>
      api.candidates.bulk(icp.id, { company_ids: vars.rows.map((r) => r.company_id), status: vars.to }),
    onSuccess: (result, vars) => {
      const failedIds = new Set(result.failed.map((f) => f.company_id));
      const okRows = vars.rows.filter((r) => !failedIds.has(r.company_id));
      const failedRows = vars.rows.filter((r) => failedIds.has(r.company_id));
      const okIds = okRows.map((r) => r.company_id);
      pendingFocus.current = { removed: okIds, rowId: null, action: 0, until: Date.now() + FOCUS_WINDOW_MS };
      // La selezione conserva solo le fallite (FLOW B.3).
      setSelected(new Set(failedIds));
      removeFromView(okIds, vars.to);
      void invalidateCandidateQueries(queryClient, icp.id, vars.rows.map((r) => r.company_id));
      notifyBulk({ okRows, failedRows, failed: result.failed, to: vars.to });
    },
    onError: (err) =>
      toast({
        id: `candidates-bulk-${icp.id}`,
        tone: 'error',
        title: `Stato non aggiornato: ${errorMessage(err)}`,
        description: 'Nessuna candidata cambiata: la selezione è rimasta, puoi riprovare.',
      }),
  });

  const notifyBulk = (outcome: {
    okRows: Candidate[];
    failedRows: Candidate[];
    failed: Array<{ company_id: number; error: string }>;
    to: CandidateStatus;
  }) => {
    const { okRows, failedRows, to } = outcome;
    const ok = okRows.length;
    const findContacts =
      to === 'accettata' && ok > 0 ? (
        <Button type="button" size="sm" variant="outline" onClick={() => onOpenContacts(okRows.map(toContactsCompany))}>
          Trova contatti in {ok === 1 ? 'questa' : `queste ${nf(ok)}`}
        </Button>
      ) : null;
    if (failedRows.length === 0) {
      setAnnouncement(`${nf(ok)} ${ok === 1 ? 'candidata' : 'candidate'} ${STATUS_VERB[to][ok === 1 ? 0 : 1]}.`);
      toast({
        id: `candidates-bulk-${icp.id}`,
        title: `${nf(ok)} ${ok === 1 ? 'candidata' : 'candidate'} ${STATUS_VERB[to][ok === 1 ? 0 : 1]}`,
        // Con "Trova contatti in queste N" resta finché non lo si chiude (un'azione da tastiera non deve scadere).
        persistent: findContacts !== null,
        action: findContacts ?? undefined,
      });
      return;
    }
    const errorById = new Map(outcome.failed.map((f) => [f.company_id, f.error]));
    const title = `${nf(ok)} ${ok === 1 ? 'riuscita' : 'riuscite'} · ${nf(failedRows.length)} ${failedRows.length === 1 ? 'errore' : 'errori'}`;
    setAnnouncement(`${title}.`);
    toast({
      id: `candidates-bulk-${icp.id}`,
      tone: 'warning',
      persistent: true,
      title,
      description: (
        <ul className="list-disc space-y-0.5 pl-4">
          {failedRows.map((r) => (
            <li key={r.company_id}>
              {candidateName(r)}: {errorById.get(r.company_id) ?? 'errore'}
            </li>
          ))}
        </ul>
      ),
      action: (
        <>
          <Button type="button" size="sm" variant="outline" onClick={() => bulk.mutate({ rows: failedRows, to })}>
            Riprova le fallite
          </Button>
          {findContacts}
        </>
      ),
    });
  };

  const selectedRows = items.filter((c) => selected.has(c.company_id));
  const runBulk = (to: CandidateStatus) => {
    if (selectedRows.length > 0 && !bulk.isPending) bulk.mutate({ rows: selectedRows, to });
  };

  // Selezione
  const visibleIds = pageRows.map((r) => r.company_id);
  const selectedVisible = visibleIds.filter((id) => selected.has(id)).length;
  const allVisible = pageRows.length > 0 && selectedVisible === pageRows.length;
  const headerState: boolean | 'indeterminate' = allVisible ? true : selectedVisible > 0 ? 'indeterminate' : false;
  const toggleVisible = () => {
    const next = new Set(selected);
    if (allVisible) visibleIds.forEach((id) => next.delete(id));
    else visibleIds.forEach((id) => next.add(id));
    setSelected(next);
  };
  const allLoadedSelected = items.length > 0 && selectedIds.length === items.length;
  const capped = data.total > items.length;

  if (props.loading) {
    return (
      <p className="px-4 py-6 text-sm text-slate-500" aria-busy="true">
        Caricamento delle candidate {CANDIDATE_STATUS_FILTER_LABELS[status].toLowerCase()}…
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <>
        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>
        <EmptyStatus status={status} counts={data.counts} onSearchChange={props.onSearchChange} onFindMore={props.onFindMore} />
      </>
    );
  }

  const bulkBusy = bulk.isPending;
  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {(allVisible && items.length > pageRows.length) || capped ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2 text-sm text-slate-700">
          {allVisible && items.length > pageRows.length && !allLoadedSelected && (
            <>
              <span>Tutte le {nf(pageRows.length)} visibili sono selezionate.</span>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto px-0"
                onClick={() => setSelected(new Set(items.map((c) => c.company_id)))}
              >
                Seleziona tutte le {nf(items.length)} {capped ? 'caricate' : 'filtrate'}
              </Button>
            </>
          )}
          {allVisible && allLoadedSelected && items.length > pageRows.length && (
            <span>Tutte le {nf(items.length)} {capped ? 'caricate' : 'filtrate'} sono selezionate.</span>
          )}
          {capped && (
            <span className="text-slate-500">
              Mostrate le prime {nf(items.length)} di {nf(data.total)} (le più simili): vaglia queste per vedere le altre.
            </span>
          )}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table ref={tableRef} className="w-full text-sm">
          <caption className="sr-only">
            Candidate {CANDIDATE_STATUS_FILTER_LABELS[status].toLowerCase()} di {icp.name}, ordinate per somiglianza
          </caption>
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
              <th scope="col" className="w-10 px-4 py-2">
                <Checkbox
                  checked={headerState}
                  onCheckedChange={toggleVisible}
                  aria-label={`Seleziona le visibili (${pageRows.length})`}
                />
              </th>
              <th scope="col" className="px-2.5 py-2">Nome</th>
              <th scope="col" className="px-2.5 py-2">Dominio</th>
              <th scope="col" className="px-2.5 py-2">Settore</th>
              <th scope="col" className="px-2.5 py-2">Dipendenti</th>
              <th scope="col" className="px-2.5 py-2">Sede</th>
              <th scope="col" className="px-2.5 py-2">Somiglianza</th>
              <th scope="col" className="px-2.5 py-2">Perché simile</th>
              <th scope="col" className="sticky right-0 bg-white px-3 py-2 shadow-[-8px_0_8px_-8px_rgba(15,23,42,0.15)]">
                <span className="sr-only">Azioni</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pageRows.map((row) => (
              <CandidateRow
                key={row.company_id}
                row={row}
                status={status}
                selected={selected.has(row.company_id)}
                pending={pendingRows.has(row.company_id) || bulkBusy}
                onSelect={(on) => {
                  const next = new Set(selected);
                  if (on) next.add(row.company_id);
                  else next.delete(row.company_id);
                  setSelected(next);
                }}
                onChange={(to, action) => changeRow(row, to, action)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <Pager
        page={page}
        total={items.length}
        onPageChange={(next) =>
          props.onSearchChange({ candidates: status === 'proposta' ? undefined : status, cpage: next > 1 ? next : undefined }, { scrollToSection: true })
        }
      />

      <BulkBar count={selectedIds.length} onClear={() => setSelected(new Set())} label="Azioni sulle candidate selezionate">
        {status === 'accettata' && (
          <Button type="button" size="sm" onClick={() => onOpenContacts(selectedRows.map(toContactsCompany))} aria-disabled={bulkBusy || undefined}>
            Trova contatti…
          </Button>
        )}
        {ROW_ACTIONS[status].map((a) => (
          <Button
            key={a.to}
            type="button"
            size="sm"
            variant={a.to === 'proposta' ? 'ghost' : 'outline'}
            onClick={() => runBulk(a.to)}
            aria-disabled={bulkBusy || undefined}
            aria-busy={bulkBusy && bulk.variables?.to === a.to}
            aria-describedby={`${uid}-bulk-hint`}
          >
            {a.label}
          </Button>
        ))}
        <span id={`${uid}-bulk-hint`} className="sr-only">
          Nessuna conferma: il cambio è reversibile.
        </span>
      </BulkBar>
    </>
  );
}

function EmptyStatus(props: {
  status: CandidateStatus;
  counts: Record<CandidateStatus, number>;
  onSearchChange: CandidatesSectionProps['onSearchChange'];
  onFindMore: () => void;
}) {
  const { status, counts } = props;
  const title =
    status === 'proposta'
      ? 'Nessuna candidata da vagliare.'
      : status === 'accettata'
        ? 'Nessuna candidata accettata.'
        : 'Nessuna candidata scartata.';
  const others = CANDIDATE_STATUSES.filter((s) => s !== status);
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm" data-testid="candidates-empty">
      <p className="font-medium text-slate-700">{title}</p>
      <p className="flex flex-wrap items-center justify-center gap-x-1 text-slate-500">
        {others.map((s, i) => (
          <span key={s}>
            {i > 0 && <span aria-hidden="true"> · </span>}
            <button
              type="button"
              onClick={() => props.onSearchChange({ candidates: s === 'proposta' ? undefined : s, cpage: undefined })}
              className="cursor-pointer font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900"
            >
              {CANDIDATE_STATUS_FILTER_LABELS[s]} {nf(counts[s])}
            </button>
          </span>
        ))}
      </p>
      {status === 'proposta' && (
        <Button type="button" size="sm" variant="outline" className="mt-1" onClick={props.onFindMore}>
          Trova altre aziende simili
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Riga e celle
// ---------------------------------------------------------------------------

function CandidateRow(props: {
  row: Candidate;
  status: CandidateStatus;
  selected: boolean;
  pending: boolean;
  onSelect: (on: boolean) => void;
  onChange: (to: CandidateStatus, action: number) => void;
}) {
  const { row } = props;
  const name = candidateName(row);
  const site = row.website ?? (row.domain ? `https://${row.domain}` : null);
  return (
    <tr data-company-id={row.company_id} className={cn('align-top', props.selected && 'bg-sky-50/60')} aria-busy={props.pending || undefined}>
      <td className="px-4 py-2.5">
        <Checkbox checked={props.selected} onCheckedChange={(v) => props.onSelect(v === true)} aria-label={`Seleziona ${name}`} className="mt-0.5" />
      </td>
      <td className="max-w-48 min-w-32 px-2.5 py-2.5">
        <Link to="/companies/$id" params={{ id: String(row.company_id) }} className="font-medium text-slate-900 hover:underline focus-visible:underline">
          {name}
        </Link>
        {(!row.linkedin_url || row.last_contacts_at) && (
          <div className="mt-1 flex flex-wrap gap-1">
            {!row.linkedin_url && (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-amber-900 ring-1 ring-amber-200 ring-inset">
                Senza pagina LinkedIn
              </span>
            )}
            {row.last_contacts_at && (
              <Link
                to="/companies/$id"
                params={{ id: String(row.company_id) }}
                className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-sky-900 ring-1 ring-sky-200 ring-inset hover:underline"
                aria-label={`${name}: contatti già cercati il ${shortDay(row.last_contacts_at)} (apri l'azienda)`}
                data-testid="already-searched"
              >
                già cercata il {shortDay(row.last_contacts_at)}
              </Link>
            )}
          </div>
        )}
      </td>
      <td className="max-w-40 px-2.5 py-2.5">
        {row.domain && site ? (
          <a
            href={site}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Apri il sito di ${name} (nuova scheda)`}
            title={row.domain}
            className="block truncate text-slate-700 underline-offset-2 hover:underline"
          >
            {row.domain}
          </a>
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </td>
      <td className="max-w-36 px-2.5 py-2.5 text-slate-700">{row.industry ?? <span className="text-slate-400">—</span>}</td>
      <td className="px-2.5 py-2.5 whitespace-nowrap text-slate-700 tabular-nums">{employeesText(row)}</td>
      <td className="max-w-32 px-2.5 py-2.5 text-slate-700">{locationText(row) ?? <span className="text-slate-400">—</span>}</td>
      <td className="px-2.5 py-2.5">
        <ScoreCell score={row.score} />
      </td>
      <td className="w-52 max-w-52 px-2.5 py-2.5">
        <ReasonChips reasons={row.reasons} />
      </td>
      <td
        className={cn(
          'sticky right-0 px-3 py-2.5 shadow-[-8px_0_8px_-8px_rgba(15,23,42,0.15)]',
          props.selected ? 'bg-sky-50' : 'bg-white',
        )}
      >
        <div className="flex items-center justify-end gap-1.5">
          {ROW_ACTIONS[props.status].map((a, i) => (
            <Button
              key={a.to}
              type="button"
              size="sm"
              variant={a.to === 'proposta' ? 'ghost' : 'outline'}
              data-row-action={i}
              aria-disabled={props.pending || undefined}
              className={props.pending ? 'opacity-50' : undefined}
              onClick={() => props.onChange(a.to, i)}
              aria-label={`${a.label} ${name}`}
            >
              {a.label}
            </Button>
          ))}
        </div>
      </td>
    </tr>
  );
}

function employeesText(row: Candidate): string {
  if (row.apollo_employees !== null) return row.apollo_employees.toLocaleString('it-IT');
  return row.size ?? '—';
}

/** "Milano, Lombardia" dai dati Apollo; altrimenti la sede in anagrafica. */
function locationText(row: Candidate): string | null {
  const parts = [row.apollo_city, row.apollo_state].filter((p): p is string => Boolean(p && p.trim()));
  if (parts.length > 0) return parts.join(', ');
  return row.location ?? row.apollo_country ?? null;
}

const BUCKET_STYLE: Record<ScoreBucket, string> = {
  alto: 'bg-emerald-500',
  medio: 'bg-amber-400',
  basso: 'bg-slate-400',
};

/** "82 %" con la fascia in testo; la barra è decorativa (`aria-hidden`). */
function ScoreCell({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const bucket = scoreBucketOf(score);
  return (
    <div className="flex min-w-20 flex-col gap-1" data-score={score}>
      <span className="whitespace-nowrap">
        <span className="font-medium text-slate-900 tabular-nums">{pct} %</span>{' '}
        <span className="text-xs text-slate-500">{bucket}</span>
      </span>
      <span aria-hidden="true" className="block h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
        <span className={cn('block h-full rounded-full', BUCKET_STYLE[bucket])} style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}

/** "Acme HR Software Srl, Beta Payroll Srl" → "Acme HR Software +1" (senza forma societaria). */
function referencesShort(names: string): string {
  const list = names.split(', ').map((n) => n.replace(/[\s,]+(s\.?r\.?l\.?s?|s\.?p\.?a\.?|s\.?a\.?s\.?|s\.?n\.?c\.?)$/i, '').trim());
  return list.length > 1 ? `${list[0]} +${list.length - 1}` : list[0];
}

/**
 * Chip corto di una ragione del server (`src/apollo/similarity.ts`), il testo pieno resta nel `title` e per i
 * lettori di schermo: "3 parole chiave in comune", "stessa fascia (51–100)", "fascia vicina", "stessa città di
 * Acme", "stessa regione di Beta", "località non disponibile". Testi sconosciuti restano come sono.
 */
export function reasonChipText(reason: string): string {
  if (/^località non disponibile/i.test(reason)) return 'località non disponibile';
  const one = /^1 parola chiave in comune: (.+)$/.exec(reason);
  if (one) return `in comune: ${one[1]}`;
  const many = /^(\d+ parole chiave in comune)/.exec(reason);
  if (many) return many[1];
  const size = /^stessa fascia di dipendenti di .+ \(([^)]+)\)$/.exec(reason);
  if (size) return `stessa fascia (${size[1].replace('-', '–')})`;
  if (/^fascia vicina a /.test(reason)) return 'fascia vicina';
  const place = /^stessa (città|regione) di (.+) \([^)]*\)$/.exec(reason);
  if (place) return `stessa ${place[1]} di ${referencesShort(place[2])}`;
  return reason;
}

function ReasonChips({ reasons }: { reasons: string[] }) {
  if (reasons.length === 0) return <span className="text-xs text-slate-400">nessuna ragione</span>;
  return (
    <ul className="flex flex-wrap gap-1" title={reasons.join('\n')} aria-label="Perché simile">
      {reasons.map((reason) => {
        const short = reasonChipText(reason);
        return (
          <li key={reason} title={reason} className="max-w-full truncate rounded-full bg-slate-100 px-2 py-0.5 text-xs whitespace-nowrap text-slate-700">
            {short === reason ? (
              reason
            ) : (
              <>
                <span aria-hidden="true">{short}</span>
                <span className="sr-only">{reason}</span>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Pager({ page, total, onPageChange }: { page: number; total: number; onPageChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, page * PAGE_SIZE);
  return (
    <nav aria-label="Paginazione delle candidate" className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-2 text-sm text-slate-600">
      <span>
        {nf(from)}–{nf(to)} di {nf(total)}
      </span>
      {pages > 1 && (
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            <ChevronLeftIcon aria-hidden="true" />
            Precedente
          </Button>
          <span aria-current="page">
            Pagina {page} di {pages}
          </span>
          <Button type="button" variant="outline" size="sm" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>
            Successiva
            <ChevronRightIcon aria-hidden="true" />
          </Button>
        </div>
      )}
    </nav>
  );
}
