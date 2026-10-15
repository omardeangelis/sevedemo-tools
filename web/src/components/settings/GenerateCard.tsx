import { useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useIsFetching } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowDownIcon, CircleAlertIcon, SparklesIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { api, queryKeys } from '../../api/client';
import type {
  GenerateChoice,
  GenerateProfilePreview,
  GenerationSource,
  Job,
  PreviewSource,
  Profile,
  RunSourceOutcome,
} from '../../api/types';
import { fmtDayMonth } from '../../lib/dates';
import { countText, fmtCount } from '../../lib/format';
import { describeJobError, formatCost, jobKindLabel, useCurrentJob, useJobPreview, useJobStart } from '../../lib/jobs';
import { canAnimate, EASE_OUT_QUINT, reducedMotion, revealAndFocus } from '../../lib/motion';
import { JobPreviewDialog } from '../JobPreviewDialog';
import { RunLink } from '../runs/parts';
import { Card, Spinner } from '../ui';
import { td, th } from './parts';

/*
 * "Analizza profilo" (own-profile-services T30; FLOW A.2, B, E.1, rev. 2026-10-04: poco testo). La card dice cosa fa,
 * quando è stata fatta l'ultima analisi e da quali fonti, e ha un bottone che apre l'anteprima. Mentre l'analisi gira,
 * al posto del bottone c'è "Analisi in corso…"; sotto, al più una fascia: un blocco di configurazione, l'ultima analisi
 * non riuscita o la proposta da rivedere. L'esito per fonte sta nella pagina del run (`AnalysisSourcesTable`).
 */

export const SOURCE_LABELS: Record<GenerationSource, string> = { linkedin: 'Profilo LinkedIn', website: 'Sito', posts: 'I miei post' };
/** Nomi nelle frasi ("Pronte 2 fonti su 3: profilo LinkedIn · i miei post"); li usa anche la sezione Proposta. */
export const SOURCE_NAMES: Record<GenerationSource, string> = { linkedin: 'profilo LinkedIn', website: 'sito', posts: 'i miei post' };
/** Le fonti della generazione (C1). */
export const SOURCE_COUNT = Object.keys(SOURCE_NAMES).length;
/** Nomi brevi nella riga dell'ultima analisi: *"LinkedIn, sito, post"*. */
const SOURCE_SHORT: Record<GenerationSource, string> = { linkedin: 'LinkedIn', website: 'sito', posts: 'post' };

/** "20 set, 10:12". */
export function dayTime(iso: string): string {
  return `${fmtDayMonth(iso)}, ${timeOf(iso)}`;
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
const shortUrl = (url: string) => url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
const num = (meta: Record<string, unknown>, key: string) => (typeof meta[key] === 'number' ? (meta[key] as number) : null);

/** La scelta con cui il dialog si apre: la card la usa per la sua anteprima, così il dialog apre già pieno. */
const INITIAL_CHOICE: Required<GenerateChoice> = { exclude: [], force: [] };

// ---------------------------------------------------------------------------
// Analisi in corso
// ---------------------------------------------------------------------------

/** Un job appena finito: il profilo riletto arriva subito dopo. */
const SETTLE_MS = 10_000;

/**
 * L'analisi del profilo secondo il job corrente (la card e la card vuota dei servizi). `busy` resta vero anche quando il
 * job è finito ma il profilo riletto non lo conosce ancora (`lastJobId`): così la card non mostra per un attimo lo stato
 * di prima tra "in corso" e la proposta. `other` = un job di un altro tipo in corso.
 */
export function useProfileAnalysis(lastJobId: number | null): { busy: boolean; job: Job | null; other: Job | null } {
  const job = useCurrentJob().data?.job ?? null;
  const refreshing = useIsFetching({ queryKey: queryKeys.profile }) > 0;
  if (!job) return { busy: false, job: null, other: null };
  const mine = job.kind === 'generate_profile';
  if (job.state === 'running') return mine ? { busy: true, job, other: null } : { busy: false, job: null, other: job };
  const recent = job.finished_at !== null && Date.now() - Date.parse(job.finished_at) < SETTLE_MS;
  const settling = mine && job.id !== lastJobId && (refreshing || recent);
  return { busy: settling, job: settling ? job : null, other: null };
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export interface GenerateCardProps {
  profile: Profile;
  /** Il dialog lo apre anche la card vuota dei servizi (FLOW D.1): lo stato vive nella pagina. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const BAND = 'flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-b-[calc(var(--radius-xl)-1px)] border-t px-4 py-2.5 text-sm';
const BAND_LINK = 'inline-flex shrink-0 items-center gap-1 font-medium underline underline-offset-2';

/** Un blocco di configurazione visto dalla card (G4): il motivo e dove si risolve. */
interface Blocker {
  text: string;
  remedy: 'connections' | 'addresses';
}

/**
 * Solo i blocchi che la card sa nominare: la chiave di Anthropic e nessuna fonte. Mai il testo dei `blockers`
 * dell'anteprima, che comprende "C'è già un job in corso" (dopo **Avvia** sembrava un errore, feedback del 2026-10-04).
 */
function blockerOf(profile: Profile, preview: GenerateProfilePreview | undefined): Blocker | null {
  if (!profile.readiness.anthropic) return { text: 'Manca ANTHROPIC_API_KEY nel .env.', remedy: 'connections' };
  if (preview?.sources.every((s) => s.state === 'unavailable')) return { text: 'Nessuna fonte da leggere.', remedy: 'addresses' };
  return null;
}

export function GenerateCard({ profile, open, onOpenChange }: GenerateCardProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const statusFocused = useRef(false);
  const slotRef = useRef<HTMLDivElement>(null);
  const bandRef = useRef<HTMLDivElement>(null);
  const bandId = useId();
  const noteId = useId();
  const last = profile.last_generation;
  const pending = profile.pending_proposal;
  const analysis = useProfileAnalysis(last?.job_id ?? null);
  // Senza scelte, come il dialog all'apertura: dice solo se mancano tutte le fonti. Non spende.
  const ready = useJobPreview('generate_profile', INITIAL_CHOICE, { enabled: !open });
  // `#proposta` senza una proposta in attesa (FLOW, ancore): la pagina resta in cima e la card lo dice.
  const [noProposal] = useState(() => window.location.hash === '#proposta' && profile.pending_proposal === null);

  // Deep-link `/settings/profile#genera` (Oggi, G6): focus sul bottone (o sulla riga "in corso"), mai l'apertura del
  // dialog che spende.
  useEffect(() => {
    if (window.location.hash !== '#genera') return;
    document.getElementById('genera')?.scrollIntoView();
    (buttonRef.current ?? statusRef.current)?.focus();
  }, []);

  // Fine dell'analisi: il focus lasciato sulla riga "in corso" passa al bottone, e ciò che cambia entra in dissolvenza
  // (mai al montaggio: tornando sulla pagina lo stato finale è già lì).
  const wasBusy = useRef(analysis.busy);
  useLayoutEffect(() => {
    if (wasBusy.current === analysis.busy) return;
    wasBusy.current = analysis.busy;
    if (analysis.busy) return;
    if (statusFocused.current && (document.activeElement === null || document.activeElement === document.body)) {
      buttonRef.current?.focus({ preventScroll: true });
    }
    statusFocused.current = false;
    if (!canAnimate()) return;
    const easing = reducedMotion() ? 'ease' : EASE_OUT_QUINT;
    for (const el of [slotRef.current, bandRef.current]) el?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing });
  }, [analysis.busy]);

  const blocker = analysis.busy ? null : blockerOf(profile, ready.data);
  const failed = !analysis.busy && !blocker && last?.state === 'failed';
  const proposal = !analysis.busy && !blocker && !failed ? pending : null;
  const describedBy = [blocker && bandId, analysis.other && noteId].filter(Boolean).join(' ') || undefined;

  return (
    <Card id="genera" title="Analizza profilo" className="scroll-mt-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-4">
        <div className="flex min-w-0 flex-col gap-1 text-sm">
          {noProposal && !pending && <p className="text-slate-600">Nessuna proposta da rivedere.</p>}
          <p className="text-slate-600">Legge LinkedIn, sito e post e ti propone profilo e servizi. Decidi tu cosa applicare.</p>
          <LastLine profile={profile} running={analysis.busy ? analysis.job : null} />
          {analysis.other && (
            <p id={noteId} className="text-xs text-slate-500">
              In corso: {jobKindLabel(analysis.other)}. Potrai analizzare quando finisce.
            </p>
          )}
        </div>
        <div ref={slotRef} className="flex h-8 shrink-0 items-center">
          {analysis.busy ? (
            <p
              ref={statusRef}
              tabIndex={-1}
              onFocus={() => (statusFocused.current = true)}
              onBlur={() => (statusFocused.current = false)}
              className="flex items-center gap-2 rounded-md text-sm text-slate-600 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2"
            >
              <Spinner className="size-4 border-slate-300 border-t-slate-600 motion-reduce:animate-none" />
              Analisi in corso…
            </p>
          ) : (
            <Button
              ref={buttonRef}
              type="button"
              // Con una proposta da rivedere il pieno della pagina è la decisione da prendere, non una spesa che la sostituirebbe.
              variant={proposal ? 'outline' : 'default'}
              aria-describedby={describedBy}
              onClick={() => onOpenChange(true)}
            >
              <SparklesIcon data-icon="inline-start" aria-hidden="true" />
              {last ? 'Analizza di nuovo…' : 'Analizza…'}
            </Button>
          )}
        </div>
      </div>

      {blocker && (
        <div ref={bandRef} className={cn(BAND, 'border-amber-200 bg-amber-50 text-amber-900')}>
          <p id={bandId}>{blocker.text}</p>
          {blocker.remedy === 'connections' ? (
            <Link to="/settings/connections" className={BAND_LINK}>
              Vai a Connessioni
            </Link>
          ) : (
            <a href="#profilo" className={BAND_LINK}>
              Aggiungi il profilo LinkedIn o il sito
            </a>
          )}
        </div>
      )}
      {failed && last && (
        <div ref={bandRef} className={cn(BAND, 'border-red-200 bg-red-50 text-red-800')}>
          <p className="flex min-w-0 items-start gap-2">
            <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-red-600" />
            <span className="line-clamp-2">Ultima analisi non riuscita: {describeJobError(last.error).message}</span>
          </p>
          <RunLink run={{ id: last.job_id }} className={cn(BAND_LINK, 'text-red-800')}>
            Vedi il run<span className="sr-only"> dell'ultima analisi</span>
          </RunLink>
        </div>
      )}
      {proposal && (
        <div ref={bandRef} className={cn(BAND, 'border-sky-200 bg-sky-50 text-sky-900')}>
          <p className="flex items-center gap-2">
            <SparklesIcon aria-hidden="true" className="size-4 shrink-0 text-sky-600" />
            <span>
              Proposta da rivedere: {countText(proposal.to_decide, 'voce', 'voci')}
              {proposal.conflicts > 0 ? `, ${proposal.conflicts} in conflitto` : ''}.
            </span>
          </p>
          <a href="#proposta" onClick={focusProposal} className={BAND_LINK}>
            Rivedi la proposta
            <ArrowDownIcon aria-hidden="true" className="size-3.5" />
          </a>
        </div>
      )}

      <GenerateDialog open={open} onOpenChange={onOpenChange} fallbackFocus={() => statusRef.current} />
    </Card>
  );
}

/** "Rivedi la proposta" dalla card: la pagina scende alla sezione e il focus va sul suo titolo (mai sul link). */
function focusProposal(event: MouseEvent): void {
  const title = document.querySelector<HTMLElement>('#proposta h2');
  if (!title) return;
  event.preventDefault();
  revealAndFocus(title);
}

/** Le fonti dell'ultimo run; per i run di prima della revisione del 2026-10-03, l'ultima lettura di ogni fonte. */
function runRows(profile: Profile): RunSourceOutcome[] {
  return profile.last_generation?.sources ?? profile.sources.map((r) => ({ ...r, reused: false }));
}

/** Le fonti che non sono andate bene, in parole: *"sito non letto"*, *"post senza contenuto"*, *"sito con avvisi"*. */
function sourceProblems(rows: RunSourceOutcome[], warnings: string[]): string[] {
  return rows.flatMap((r) => {
    const name = SOURCE_SHORT[r.kind];
    if (r.outcome === 'failed') return [`${name} non ${r.kind === 'posts' ? 'letti' : 'letto'}`];
    if (r.outcome === 'empty') return [`${name} senza contenuto`];
    if (r.outcome === 'read' && warnings.some((w) => w.startsWith(`${SOURCE_LABELS[r.kind]}:`))) return [`${name} con avvisi`];
    return [];
  });
}

/**
 * Quando e da cosa (G5), in una riga: *"Ultima analisi: 3 ott, 14:30 · LinkedIn, sito, post · Vedi il run"*, con in
 * ambra le fonti andate male; *"Mai analizzato."*; durante l'analisi *"Avviata alle 14:31 · Vedi il run"*.
 */
function LastLine({ profile, running }: { profile: Profile; running: Job | null }) {
  const last = profile.last_generation;
  const runLink = (id: number, what: string) => (
    <RunLink run={{ id }} className="text-slate-700 underline">
      Vedi il run<span className="sr-only"> {what}</span>
    </RunLink>
  );
  if (running) {
    return (
      <p className="text-xs text-slate-500">
        {running.started_at ? `Avviata alle ${timeOf(running.started_at)} · ` : ''}
        {runLink(running.id, "dell'analisi in corso")}
      </p>
    );
  }
  if (!last?.finished_at) return <p className="text-xs text-slate-500">Mai analizzato.</p>;
  const parts: ReactNode[] = [];
  if (last.state === 'succeeded') {
    if (last.counts.no_content === 1) {
      parts.push('nessuna fonte con contenuto');
    } else {
      const rows = runRows(profile);
      const read = rows.filter((r) => r.outcome === 'read').map((r) => SOURCE_SHORT[r.kind]);
      if (read.length > 0) parts.push(read.join(', '));
      for (const problem of sourceProblems(rows, last.warnings)) {
        parts.push(
          <span key={problem} className="text-amber-800">
            {problem}
          </span>,
        );
      }
      if (last.counts.no_news === 1) parts.push('nessuna novità');
    }
  }
  return (
    <p className="text-xs text-slate-500">
      Ultima analisi: <time dateTime={last.finished_at}>{dayTime(last.finished_at)}</time>
      {parts.map((part, i) => (
        <span key={i}> · {part}</span>
      ))}
      {last.state === 'succeeded' && <> · {runLink(last.job_id, "dell'ultima analisi")}</>}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Esito per fonte (pagina del run)
// ---------------------------------------------------------------------------

/** "letta" / "ripresa" / "esclusa da te" / "non letta" a parole (accessibilità: niente icone). */
function outcomeWord(row: RunSourceOutcome): string {
  if (row.outcome === 'read') return row.reused ? 'ripresa' : 'letta';
  if (row.outcome === 'empty') return 'letta, nessun contenuto utile';
  if (row.outcome === 'excluded') return 'esclusa da te';
  return 'non letta';
}

function outcomeDetail(row: RunSourceOutcome): string {
  if (row.outcome === 'excluded') return 'non letta in questo run';
  if (row.outcome !== 'read' || row.read_at === null) return row.reason ?? '—';
  if (row.reused) return `lettura del ${fmtDayMonth(row.read_at)}, senza costo`;
  if (row.kind === 'website') {
    const read = num(row.meta, 'pages_read');
    const max = num(row.meta, 'max_pages');
    return read === null ? dayTime(row.read_at) : `${countText(read, 'pagina', 'pagine')}${max ? ` su ${max}` : ''} · ${dayTime(row.read_at)}`;
  }
  if (row.kind === 'posts') {
    const used = num(row.meta, 'used') ?? num(row.meta, 'complete') ?? 0;
    const excerpts = num(row.meta, 'excerpts') ?? 0;
    return `${fmtCount(used)} per intero${excerpts > 0 ? `, ${fmtCount(excerpts)} solo estratto (non usati)` : ''}`;
  }
  return dayTime(row.read_at);
}

/** L'esito di ogni fonte in un run dell'analisi (FLOW E.1, rev. 2026-10-04: sta nella pagina del run, non nella card). */
export function AnalysisSourcesTable({ sources }: { sources: RunSourceOutcome[] }) {
  return (
    <table className="w-full">
      <caption className="sr-only">Esito per fonte</caption>
      <thead>
        <tr>
          <th scope="col" className={th}>
            Fonte
          </th>
          <th scope="col" className={th}>
            Esito
          </th>
          <th scope="col" className={th}>
            Dettaglio
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {sources.map((row) => (
          <tr key={row.kind}>
            <th scope="row" className={`${td} text-left font-medium text-slate-900`}>
              {SOURCE_LABELS[row.kind]}
            </th>
            <td className={td}>{outcomeWord(row)}</td>
            <td className={`${td} text-slate-600`}>{outcomeDetail(row)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Anteprima (FLOW B, rev. 2026-10-04: una riga per fonte)
// ---------------------------------------------------------------------------

/** Il costo di una riga: *"gratis"*, *"≈ $0,01"*, o *"prezzo non impostato"* (mai un numero inventato, D5). */
function costText(value: number | null): string {
  return value === null ? 'prezzo non impostato' : value === 0 ? 'gratis' : formatCost(value);
}

/** Cosa si legge di una fonte: l'indirizzo, le pagine del sito (solo se si legge adesso), i post integrali. */
function sourceMeta(source: PreviewSource, data: GenerateProfilePreview): string {
  if (source.kind === 'posts') return `${fmtCount(data.counts.posts_complete ?? 0)} con testo completo`;
  const where = source.address ? shortUrl(source.address) : '';
  const readsNow = source.fresh_at === null || source.forced;
  return source.kind === 'website' && readsNow && source.max_pages ? `${where} · fino a ${source.max_pages} pagine` : where;
}

/** Dove si risolve una fonte non disponibile (`remedy` dal server). */
function remedyLink(source: PreviewSource, onNavigate?: () => void): ReactNode {
  const cls = 'shrink-0 font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900';
  if (source.remedy === 'connections') {
    return (
      <Link to="/settings/connections" onClick={onNavigate} className={cls}>
        Vai a Connessioni
      </Link>
    );
  }
  if (source.remedy === 'addresses') {
    return (
      <a href="#profilo" onClick={onNavigate} className={cls}>
        Vai agli indirizzi
      </a>
    );
  }
  if (source.remedy === 'posts') {
    return (
      <Link to="/settings/posts" onClick={onNavigate} className={cls}>
        Vai a I miei post
      </Link>
    );
  }
  return null;
}

type Toggle = (key: 'exclude' | 'force', kind: GenerationSource, on: boolean) => void;

const META = 'ml-auto flex min-w-0 items-center gap-1.5 text-xs text-slate-500';

/** Una fonte in una riga: spunta e nome a sinistra, indirizzo e costo a destra; sotto, "Rileggi" se letta di recente. */
function SourceRow({ source: s, data, onToggle, onNavigate }: { source: PreviewSource; data: GenerateProfilePreview; onToggle?: Toggle; onNavigate?: () => void }) {
  const metaId = useId();
  const name = SOURCE_LABELS[s.kind];
  if (s.state === 'unavailable') {
    return (
      <li className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2.5">
        <span className="flex shrink-0 items-center gap-2.5 text-sm text-slate-500">
          {onToggle && <span aria-hidden="true" className="size-4" />}
          {name}
        </span>
        <span className={META}>
          <span>{s.short_reason ?? s.reason}</span>
          {s.remedy && (
            <>
              <span aria-hidden="true">·</span>
              {remedyLink(s, onNavigate)}
            </>
          )}
        </span>
      </li>
    );
  }
  const selected = s.state === 'selected';
  const meta = sourceMeta(s, data);
  const cost = selected ? costText(s.est_cost_usd) : onToggle ? null : 'esclusa';
  return (
    <li className="px-3 py-2.5">
      <div className="flex items-center gap-3">
        {onToggle ? (
          <label className={cn('flex shrink-0 items-center gap-2.5 text-sm font-medium', selected ? 'text-slate-900' : 'text-slate-500')}>
            <Checkbox checked={selected} onCheckedChange={(v) => onToggle('exclude', s.kind, v !== true)} aria-describedby={metaId} />
            {name}
          </label>
        ) : (
          <span className={cn('shrink-0 text-sm font-medium', selected ? 'text-slate-900' : 'text-slate-500')}>{name}</span>
        )}
        <span id={metaId} className={META}>
          {meta && <span className="truncate">{meta}</span>}
          {meta && cost && <span aria-hidden="true">·</span>}
          {cost && <span className="shrink-0 tabular-nums">{cost}</span>}
        </span>
      </div>
      {s.fresh_at &&
        (onToggle ? (
          // Sempre presente con una lettura recente (spenta se la fonte è esclusa): la riga non cambia altezza.
          <label className="mt-1.5 ml-[1.625rem] flex items-center gap-2 text-xs text-slate-600">
            <Checkbox disabled={!selected} checked={s.forced} onCheckedChange={(v) => onToggle('force', s.kind, v === true)} />
            <span>
              Rileggi<span className="sr-only"> {SOURCE_NAMES[s.kind]}</span>
              <span className="text-slate-500"> · già letto il {fmtDayMonth(s.fresh_at)}</span>
            </span>
          </label>
        ) : (
          selected && (
            <p className="mt-1 text-xs text-slate-500">
              {s.forced ? 'Da rileggere' : `Si riprende la lettura del ${fmtDayMonth(s.fresh_at)}`}
            </p>
          )
        ))}
    </li>
  );
}

/** Le fonti e l'elaborazione, una riga ciascuna; con `onToggle` le spunte, senza (in "Riprova…") in sola lettura. */
function SourceList({ data, onToggle, onNavigate }: { data: GenerateProfilePreview; onToggle?: Toggle; onNavigate?: () => void }) {
  const list = (
    <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
      {data.sources.map((s) => (
        <SourceRow key={s.kind} source={s} data={data} onToggle={onToggle} onNavigate={onNavigate} />
      ))}
      <li className="flex items-center gap-3 rounded-b-[calc(var(--radius-lg)-1px)] bg-slate-50/60 px-3 py-2.5">
        <span className="flex shrink-0 items-center gap-2.5 text-sm font-medium text-slate-900">
          <SparklesIcon aria-hidden="true" className="size-4 text-sky-600" />
          Elaborazione AI
        </span>
        <span className={META}>
          <span className="truncate">{data.processing.model}</span>
          <span aria-hidden="true">·</span>
          <span className="shrink-0 tabular-nums">{costText(data.processing.est_cost_usd)}</span>
        </span>
      </li>
    </ul>
  );
  return onToggle ? (
    <fieldset>
      <legend className="mb-1.5 text-xs font-medium text-slate-500">Fonti</legend>
      {list}
    </fieldset>
  ) : (
    <div>
      <p className="mb-1.5 text-xs font-medium text-slate-500">Fonti</p>
      {list}
    </div>
  );
}

/** Perché la stima non c'è, in una riga sopra il costo: *"Per la stima mancano X e Y nel .env."* */
function PriceHint({ data }: { data: GenerateProfilePreview }) {
  const missing = data.missing_prices;
  if (missing.length === 0) return null;
  return (
    <p className="text-xs text-slate-500">
      Per la stima {missing.length === 1 ? 'manca' : 'mancano'} {missing.join(' e ')} nel .env.
    </p>
  );
}

/** Le fonti di un'anteprima in sola lettura ("Riprova…": stesse fonti scelte, D12). */
export function GenerateSourcesReadOnly({ data }: { data: GenerateProfilePreview }) {
  return (
    <div className="flex flex-col gap-2">
      <SourceList data={data} />
      <PriceHint data={data} />
    </div>
  );
}

function GenerateDialog({ open, onOpenChange, fallbackFocus }: Omit<GenerateCardProps, 'profile'> & { fallbackFocus: () => HTMLElement | null }) {
  const [choice, setChoice] = useState<Required<GenerateChoice>>(INITIAL_CHOICE);
  const [announcement, setAnnouncement] = useState('');
  const changed = useRef(false);
  const preview = useJobPreview('generate_profile', choice, { enabled: open, keepPrevious: true });
  // In chiusura le righe restano com'erano (come il resto del dialog): l'anteprima ricalcolata dopo "Avvia" non entra.
  const shown = useRef(preview.data);
  if (open) shown.current = preview.data;
  const data = shown.current;

  // Alla chiusura, non all'apertura: riaprendo, la prima anteprima è già quella senza scelte.
  useEffect(() => {
    if (open) return;
    setChoice(INITIAL_CHOICE);
    setAnnouncement('');
    changed.current = false;
  }, [open]);

  // Annuncio dopo ogni esclusione o rilettura, quando l'anteprima ricalcolata arriva (G9).
  useEffect(() => {
    if (!changed.current || !preview.data || preview.isFetching) return;
    changed.current = false;
    const d = preview.data;
    const cost = d.est_cost_usd === null ? 'stima del costo non disponibile' : `costo stimato ${formatCost(d.est_cost_usd)}`;
    setAnnouncement(`Anteprima aggiornata: ${countText(d.counts.sources_selected, 'fonte', 'fonti')}, ${cost}.`);
  }, [preview.data, preview.isFetching]);

  const start = useJobStart((vars: GenerateChoice) => api.profile.generate(vars), { onStarted: () => onOpenChange(false) });

  const toggle: Toggle = (key, kind, on) => {
    changed.current = true;
    setChoice((cur) => ({ ...cur, [key]: on ? [...new Set([...cur[key], kind])] : cur[key].filter((k) => k !== kind) }));
  };

  return (
    <JobPreviewDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Analizza profilo"
      description="Scegli le fonti. Niente cambia finché non applichi la proposta."
      preview={preview}
      summary={(d) => <PriceHint data={d as GenerateProfilePreview} />}
      startLabel="Avvia"
      starting={start.isPending}
      onStart={() => start.mutate(choice)}
      fallbackFocus={fallbackFocus}
    >
      {data && (
        <>
          <SourceList data={data} onToggle={toggle} onNavigate={() => onOpenChange(false)} />
          <p role="status" aria-live="polite" className="sr-only">
            {announcement}
          </p>
        </>
      )}
    </JobPreviewDialog>
  );
}
