import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { Tooltip as TooltipPrimitive } from 'radix-ui';
import {
  Building2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MailIcon,
  MailXIcon,
  MessageSquareIcon,
  OrbitIcon,
  ThumbsUpIcon,
  UserPlusIcon,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import {
  SOURCE_KINDS,
  SOURCE_KIND_LABELS,
  type AnalysisState,
  type FitFilter,
  type ProspectRow,
  type Source,
  type SourceKind,
} from '../api/types';
import { StatusBadge } from './StatusBadge';

/*
 * Tabella dei prospect condivisa (crm-foundation T15, FLOW C/E): Inbox, Lista e — in T19 — i
 * prospect collegati a un'azienda. Selezione **per id** controllata dalla pagina (sopravvive a
 * cambio filtro/pagina), "seleziona i visibili" nell'header e "seleziona tutti i filtrati" (cap 500)
 * delegato alla pagina, colonne attivabili, paginazione opzionale. Esporta anche i testi di stato
 * (fonti, fit) e le utilità per i filtri nell'URL usate dalle pagine.
 */

// ---------------------------------------------------------------------------
// Testi condivisi
// ---------------------------------------------------------------------------

/** Etichetta leggibile dello stato di analisi (colonna Fit). */
export const ANALYSIS_STATE_LABELS: Record<AnalysisState, string> = {
  alto: 'alto',
  medio: 'medio',
  basso: 'basso',
  rifiutata: 'rifiutata',
  errore: 'errore',
  non_arricchibile: 'non arricchibile',
};

/** Opzioni del filtro `fit` (FLOW E.4: include i falliti per "riprovare solo i falliti"). */
export const FIT_FILTER_LABELS: Record<FitFilter, string> = {
  alto: 'Fit alto',
  medio: 'Fit medio',
  basso: 'Fit basso',
  none: 'Non analizzati',
  rifiutata: 'Analisi rifiutata',
  errore: 'Analisi in errore',
  non_arricchibile: 'Non arricchibili',
};

/** Tooltip fisso del rifiuto (FLOW E.4). */
export const REFUSAL_TEXT = 'Il modello ha rifiutato di analizzare questo profilo. Puoi riprovare o scrivere il messaggio a mano.';

const SOURCE_ICONS: Record<SourceKind, LucideIcon> = {
  post_reaction: ThumbsUpIcon,
  post_comment: MessageSquareIcon,
  company_employees: Building2Icon,
  manual: UserPlusIcon,
  // "Trova contatti" via Apollo (apollo-lookalike F11): icona propria, `aria-label` "Apollo".
  apollo_people: OrbitIcon,
};

const FIT_STYLE: Record<AnalysisState, string> = {
  alto: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  medio: 'bg-amber-100 text-amber-900 ring-amber-200',
  basso: 'bg-stone-200 text-stone-700 ring-stone-300',
  rifiutata: 'bg-red-50 text-red-700 ring-red-200',
  errore: 'bg-red-50 text-red-700 ring-red-200',
  non_arricchibile: 'bg-slate-100 text-slate-600 ring-slate-200',
};

const dateFmt = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });

/** "16 set 2026" (vuoto → "—"). */
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dateFmt.format(d);
}

/** "5 min fa", "3 ore fa", "2 giorni fa" (relativo ad adesso). */
export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'mai';
  const diff = Math.max(0, now - Date.parse(iso));
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'adesso';
  if (min < 60) return `${min} min fa`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'ora' : 'ore'} fa`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'giorno' : 'giorni'} fa`;
}

const clip = (text: string | null, max: number) => {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/**
 * Riga di tooltip per una fonte (FLOW C.1: "Ha commentato '…' su <excerpt post>"; apollo-lookalike F11:
 * "Apollo · Acme (ricerca del 16 set 2026)").
 */
export function describeSource(source: Source): string {
  const post = source.post_excerpt ? `'${clip(source.post_excerpt, 60)}'` : 'un tuo post';
  switch (source.kind) {
    case 'post_reaction':
      return `Ha reagito${source.reaction_type ? ` (${source.reaction_type})` : ''} a ${post}`;
    case 'post_comment':
      return source.comment_text ? `Ha commentato '${clip(source.comment_text, 80)}' su ${post}` : `Ha commentato ${post}`;
    case 'company_employees':
      return `Dipendente di ${source.company_name ?? 'un\'azienda'}`;
    case 'apollo_people':
      return `Apollo · ${source.company_name ?? 'azienda sconosciuta'} (ricerca del ${formatDay(source.captured_at)})`;
    default:
      return 'Inserito a mano';
  }
}

// ---------------------------------------------------------------------------
// Filtri nell'URL (`validateSearch` hand-rolled, invariante: valori invalidi → default)
// ---------------------------------------------------------------------------

/**
 * Lettori tolleranti dei search param (il router fa `JSON.parse` dei valori: `?q=123` arriva come
 * numero, `?enriched=true` come booleano). Ogni lettore ritorna `undefined` per valori non validi,
 * così un deep-link sporco ricade sul default.
 */
export const searchParam = {
  /** Testo non vuoto (numeri convertiti in stringa). */
  text(value: unknown): string | undefined {
    if (typeof value === 'number') return String(value);
    return typeof value === 'string' && value.trim() !== '' ? value : undefined;
  },
  /** Intero positivo. */
  id(value: unknown): number | undefined {
    const n = typeof value === 'string' ? Number(value) : value;
    return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : undefined;
  },
  /** Pagina > 1 (la 1 è il default e resta fuori dall'URL). */
  page(value: unknown): number | undefined {
    const n = searchParam.id(value);
    return n !== undefined && n > 1 ? n : undefined;
  },
  /** Uno dei valori ammessi. */
  oneOf<T extends string>(values: readonly T[], value: unknown): T | undefined {
    return typeof value === 'string' && (values as readonly string[]).includes(value) ? (value as T) : undefined;
  },
  /** Valori ammessi separati da virgola, normalizzati (duplicati e invalidi scartati). */
  csv<T extends string>(values: readonly T[], value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const valid = [...new Set(value.split(','))].filter((v): v is T => (values as readonly string[]).includes(v));
    return valid.length > 0 ? valid.join(',') : undefined;
  },
  /** `true`/`false` (anche come stringhe). */
  bool(value: unknown): boolean | undefined {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return undefined;
  },
};

/** "nuovo,contattato" → `['nuovo', 'contattato']` (già validato da `searchParam.csv`). */
export function csvValues<T extends string>(value: string | undefined): T[] {
  return value ? (value.split(',') as T[]) : [];
}

/**
 * Campo di ricerca con bozza locale: il valore digitato va nell'URL dopo `delayMs` di pausa (una
 * query per parola, non per tasto); se l'URL cambia da fuori (Pulisci, indietro) la bozza si allinea.
 */
export function useSearchDraft(urlValue: string | undefined, commit: (value: string | undefined) => void, delayMs = 300) {
  const [draft, setDraft] = useState(urlValue ?? '');
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const lastUrl = useRef(urlValue ?? '');

  useEffect(() => {
    if ((urlValue ?? '') !== lastUrl.current) {
      lastUrl.current = urlValue ?? '';
      setDraft(urlValue ?? '');
    }
  }, [urlValue]);

  useEffect(() => {
    if (draft.trim() === (urlValue ?? '').trim()) return;
    const handle = setTimeout(() => {
      lastUrl.current = draft.trim();
      commitRef.current(draft.trim() || undefined);
    }, delayMs);
    return () => clearTimeout(handle);
  }, [draft, urlValue, delayMs]);

  return [draft, setDraft] as const;
}

// ---------------------------------------------------------------------------
// Tabella
// ---------------------------------------------------------------------------

/** Colonne attivabili (nome + checkbox sono sempre presenti). */
export type ProspectColumn = 'sources' | 'company' | 'status' | 'email' | 'fit' | 'lists' | 'lastTouchpoint' | 'capturedAt';

const DEFAULT_COLUMNS: Record<ProspectColumn, boolean> = {
  sources: true,
  company: true,
  status: true,
  email: true,
  fit: true,
  lists: false,
  lastTouchpoint: false,
  capturedAt: true,
};

export interface ProspectTableProps {
  /** Righe della pagina corrente (`GET /api/inbox`, `GET /api/prospects?listId=|companyId=`). */
  rows: ProspectRow[];
  /** Nome accessibile della tabella (es. "Prospect in Inbox"). */
  caption: string;
  /** Id selezionati (controllato dalla pagina: la selezione vive oltre filtri e pagine). */
  selected: ReadonlySet<number>;
  onSelectedChange: (next: Set<number>) => void;
  /**
   * Colonne da mostrare/nascondere rispetto ai default: `sources`, `company`, `status`, `email`,
   * `fit`, `capturedAt` accese; `lists` (liste di appartenenza) e `lastTouchpoint` spente.
   */
  columns?: Partial<Record<ProspectColumn, boolean>>;
  /** Accanto al fit mostra l'ICP dell'analisi ("alto · CTO startup IT"): in Inbox, dove convivono più ICP. */
  fitWithIcp?: boolean;
  /** Lista di contesto: il link al dettaglio porta `?list=<id>` (FLOW F.1). */
  listId?: number;
  /**
   * "Seleziona tutti i N filtrati" (FLOW C.2): compare quando tutte le righe visibili sono selezionate
   * e i filtrati sono di più. `onSelectAll` carica gli id (cap 500) e li aggiunge alla selezione;
   * `notice` (es. il cap raggiunto) si mostra nella stessa riga.
   */
  selectAll?: { total: number; onSelectAll: () => void; pending?: boolean; notice?: ReactNode };
  /** Paginazione (50 per pagina nelle pagine del CRM). */
  pagination?: { page: number; pageSize: number; total: number; onPageChange: (page: number) => void };
  /** Refetch in corso (`aria-busy` sulla tabella, righe attenuate). */
  busy?: boolean;
}

/**
 * Tabella dei prospect con selezione multipla accessibile: checkbox di riga "Seleziona <nome>",
 * checkbox di header "Seleziona i N visibili" con stato indeterminato, stati e fit sempre con testo
 * (mai solo colore), ✉ con testo alternativo, fonti con `aria-label` e tooltip anche da tastiera.
 *
 * @example
 * const [selected, setSelected] = useState<Set<number>>(new Set());
 * <ProspectTable caption="Prospect di Acme" rows={page.items} selected={selected} onSelectedChange={setSelected}
 *   columns={{ lists: true, capturedAt: false }}
 *   pagination={{ page, pageSize: 50, total: page.total, onPageChange: setPage }} />
 */
export function ProspectTable(props: ProspectTableProps) {
  const { rows, selected, onSelectedChange, selectAll, pagination } = props;
  const cols = { ...DEFAULT_COLUMNS, ...props.columns };
  const visibleIds = rows.map((r) => r.id);
  const selectedVisible = visibleIds.filter((id) => selected.has(id)).length;
  const allVisible = rows.length > 0 && selectedVisible === rows.length;
  const headerState: boolean | 'indeterminate' = allVisible ? true : selectedVisible > 0 ? 'indeterminate' : false;

  const toggleVisible = () => {
    const next = new Set(selected);
    if (allVisible) visibleIds.forEach((id) => next.delete(id));
    else visibleIds.forEach((id) => next.add(id));
    onSelectedChange(next);
  };
  const toggleRow = (id: number, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    onSelectedChange(next);
  };

  const showSelectAll = Boolean(selectAll && allVisible && selectAll.total > rows.length);
  const allFilteredSelected = Boolean(selectAll && selected.size >= selectAll.total);

  return (
    <TooltipPrimitive.Provider delayDuration={150}>
      {(showSelectAll || selectAll?.notice) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2 text-sm text-slate-700">
          {showSelectAll && !allFilteredSelected && !selectAll?.notice && (
            <>
              <span>Tutti i {rows.length} visibili sono selezionati.</span>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto px-0"
                onClick={selectAll!.onSelectAll}
                disabled={selectAll!.pending}
                aria-busy={selectAll!.pending}
              >
                Seleziona tutti i {selectAll!.total.toLocaleString('it-IT')} filtrati
              </Button>
            </>
          )}
          {showSelectAll && allFilteredSelected && !selectAll?.notice && (
            <span>Tutti i {selectAll!.total.toLocaleString('it-IT')} filtrati sono selezionati.</span>
          )}
          {selectAll?.notice && <span>{selectAll.notice}</span>}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className={cn('w-full text-sm', props.busy && 'opacity-70')} aria-busy={props.busy || undefined}>
          <caption className="sr-only">{props.caption}</caption>
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
              <th scope="col" className="w-10 px-4 py-2">
                <Checkbox
                  checked={headerState}
                  onCheckedChange={toggleVisible}
                  disabled={rows.length === 0}
                  aria-label={`Seleziona tutti i visibili (${rows.length})`}
                />
              </th>
              <th scope="col" className="px-3 py-2">Nome</th>
              {cols.sources && <th scope="col" className="px-3 py-2">Fonti</th>}
              {cols.company && <th scope="col" className="px-3 py-2">Azienda / ruolo</th>}
              {cols.status && <th scope="col" className="px-3 py-2">Stato</th>}
              {cols.email && (
                <th scope="col" className="px-3 py-2">
                  <span aria-hidden="true">✉</span>
                  <span className="sr-only">Email</span>
                </th>
              )}
              {cols.fit && <th scope="col" className="px-3 py-2">Fit</th>}
              {cols.lists && <th scope="col" className="px-3 py-2">Liste</th>}
              {cols.lastTouchpoint && <th scope="col" className="px-3 py-2">Ultimo touchpoint</th>}
              {cols.capturedAt && <th scope="col" className="px-3 py-2">Catturato il</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => {
              const name = row.full_name ?? row.linkedin_url;
              const isSelected = selected.has(row.id);
              return (
                <tr key={row.id} data-prospect-id={row.id} className={cn('align-top', isSelected && 'bg-sky-50/60')}>
                  <td className="px-4 py-2.5">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={(v) => toggleRow(row.id, v === true)}
                      aria-label={`Seleziona ${name}`}
                      className="mt-0.5"
                    />
                  </td>
                  <td className="max-w-72 px-3 py-2.5">
                    <Link
                      to={`/prospects/${row.id}` as never}
                      search={(props.listId ? { list: props.listId } : undefined) as never}
                      className="font-medium text-slate-900 hover:underline focus-visible:underline"
                    >
                      {name}
                    </Link>
                    {row.headline && <p className="line-clamp-2 text-xs text-slate-500">{row.headline}</p>}
                  </td>
                  {cols.sources && (
                    <td className="px-3 py-2.5">
                      <SourcesCell row={row} />
                    </td>
                  )}
                  {cols.company && (
                    <td className="max-w-48 px-3 py-2.5 text-slate-700">
                      <CompanyCell row={row} />
                    </td>
                  )}
                  {cols.status && (
                    <td className="px-3 py-2.5">
                      <StatusBadge status={row.status} />
                    </td>
                  )}
                  {cols.email && (
                    <td className="px-3 py-2.5">
                      <EmailCell row={row} />
                    </td>
                  )}
                  {cols.fit && (
                    <td className="px-3 py-2.5">
                      <FitCell row={row} withIcp={props.fitWithIcp} />
                    </td>
                  )}
                  {cols.lists && (
                    <td className="px-3 py-2.5">
                      <ListsCell row={row} />
                    </td>
                  )}
                  {cols.lastTouchpoint && (
                    <td className="px-3 py-2.5 whitespace-nowrap text-slate-600">
                      {row.last_touchpoint_at ? <time dateTime={row.last_touchpoint_at}>{formatDay(row.last_touchpoint_at)}</time> : '—'}
                    </td>
                  )}
                  {cols.capturedAt && (
                    <td className="px-3 py-2.5 whitespace-nowrap text-slate-600">
                      <time dateTime={row.last_captured_at ?? row.created_at}>{formatDay(row.last_captured_at ?? row.created_at)}</time>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pagination && <Pager {...pagination} />}
    </TooltipPrimitive.Provider>
  );
}

// ---------------------------------------------------------------------------
// Celle
// ---------------------------------------------------------------------------

/** Tooltip accessibile (hover e focus da tastiera) su un elemento focalizzabile. */
function Hint({ label, content, children, className }: { label: string; content: ReactNode; children: ReactNode; className?: string }) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>
        <span
          tabIndex={0}
          aria-label={label}
          className={cn('inline-flex cursor-default items-center rounded focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:outline-none', className)}
        >
          {children}
        </span>
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          sideOffset={4}
          className="z-50 max-w-xs rounded-md bg-slate-900 px-2.5 py-1.5 text-xs leading-snug text-white shadow-lg"
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-slate-900" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

function SourcesCell({ row }: { row: ProspectRow }) {
  const kinds = SOURCE_KINDS.filter((k) => (row.source_counts[k] ?? 0) > 0);
  if (kinds.length === 0) return <span className="text-slate-400">—</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {kinds.map((kind) => {
        const count = row.source_counts[kind] ?? 0;
        const Icon = SOURCE_ICONS[kind];
        const label = `${SOURCE_KIND_LABELS[kind]}${count > 1 ? ` ×${count}` : ''}`;
        const lines = row.sources.filter((s) => s.kind === kind).map(describeSource);
        return (
          <Hint
            key={kind}
            label={label}
            className="gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700"
            content={
              <ul className="space-y-1">
                {lines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            }
          >
            <Icon className="size-3.5" aria-hidden="true" />
            <span aria-hidden="true">{count > 1 ? `×${count}` : SOURCE_KIND_LABELS[kind]}</span>
          </Hint>
        );
      })}
    </div>
  );
}

function CompanyCell({ row }: { row: ProspectRow }) {
  if (!row.title && !row.company_name) return <span className="text-slate-400">—</span>;
  return (
    <>
      {row.company_name && <p className="truncate">{row.company_name}</p>}
      {row.title && <p className="truncate text-xs text-slate-500">{row.title}</p>}
    </>
  );
}

/**
 * ✉ della riga: con email · "email non disponibile" se Apollo ha risposto senza email (FLOW D.3: tooltip con
 * data e provider; la riga resta selezionabile per "Riprova anche quelli senza risultato") · senza email.
 */
function EmailCell({ row }: { row: ProspectRow }) {
  if (row.has_email) {
    return (
      <span className="inline-flex text-emerald-700" title="Con email">
        <MailIcon className="size-4" aria-hidden="true" />
        <span className="sr-only">con email</span>
      </span>
    );
  }
  if (row.apollo_matched_at) {
    return (
      <Hint
        label={`Email non disponibile: cercata su Apollo il ${formatDay(row.apollo_matched_at)}`}
        content={`Cercata su Apollo il ${formatDay(row.apollo_matched_at)}: nessuna email di lavoro disponibile (contatti EU o dato assente).`}
        className="gap-1 text-xs whitespace-nowrap text-slate-500"
      >
        <MailXIcon className="size-4 text-slate-400" aria-hidden="true" />
        <span aria-hidden="true">email non disponibile</span>
      </Hint>
    );
  }
  return (
    <span className="inline-flex text-slate-400" title="Senza email">
      <MailXIcon className="size-4" aria-hidden="true" />
      <span className="sr-only">senza email</span>
    </span>
  );
}

function FitCell({ row, withIcp }: { row: ProspectRow; withIcp?: boolean }) {
  const state = row.analysis_state;
  if (!state) {
    return (
      <span className="text-slate-400">
        <span aria-hidden="true">—</span>
        <span className="sr-only">non analizzato</span>
      </span>
    );
  }
  const analysis = row.latest_analysis;
  const isFit = state === 'alto' || state === 'medio' || state === 'basso';
  const icpName = isFit && analysis ? analysis.icp_name : null;
  const text = `${ANALYSIS_STATE_LABELS[state]}${withIcp && icpName ? ` · ${icpName}` : ''}`;
  const detail =
    state === 'rifiutata'
      ? REFUSAL_TEXT
      : state === 'errore'
        ? (row.analysis_error ?? 'Analisi non riuscita.')
        : state === 'non_arricchibile'
          ? `Profilo senza dati pubblici: arricchimento tentato il ${formatDay(row.enrichment_attempted_at)}.`
          : [analysis?.fit_reason, icpName && `ICP: ${icpName}`].filter(Boolean).join(' · ') || `Fit ${state}`;
  return (
    <Hint
      label={`Fit: ${text}`}
      content={detail}
      className={cn('rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset', FIT_STYLE[state])}
    >
      <span aria-hidden="true">{text}</span>
    </Hint>
  );
}

function ListsCell({ row }: { row: ProspectRow }) {
  if (row.memberships.length === 0) return <span className="text-xs text-slate-500">In Inbox</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {row.memberships.map((m) => (
        <Link
          key={m.list_id}
          to="/lists/$id"
          params={{ id: String(m.list_id) }}
          className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-200"
        >
          {m.list_name}
        </Link>
      ))}
    </div>
  );
}

function Pager({ page, pageSize, total, onPageChange }: NonNullable<ProspectTableProps['pagination']>) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Paginazione" className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-2 text-sm text-slate-600">
      <span>
        {from}–{to} di {total.toLocaleString('it-IT')}
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
