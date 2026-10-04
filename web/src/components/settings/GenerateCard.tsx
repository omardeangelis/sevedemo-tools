import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowDownIcon, ChevronDownIcon, ChevronUpIcon, SparklesIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { api } from '../../api/client';
import type {
  GenerateChoice,
  GenerateProfilePreview,
  GenerationSource,
  PreviewSource,
  Profile,
  ProfileSourceRow,
  RunSourceOutcome,
} from '../../api/types';
import { fmtDayMonth } from '../../lib/dates';
import { countText, fmtCount } from '../../lib/format';
import { describeJobError, formatCost, useJobPreview, useJobStart } from '../../lib/jobs';
import { revealAndFocus } from '../../lib/motion';
import { JobPreviewDialog } from '../JobPreviewDialog';
import { RunLink } from '../runs/parts';
import { Card } from '../ui';
import { td, th } from './parts';

/*
 * "Genera profilo e servizi" (own-profile-services T30, FLOW A.2, B, E.1; G3–G5, H5). La card dice lo stato (mai
 * generato / ultima generazione con l'esito per fonte), anticipa quali fonti sono pronte e perché le altre no, e apre
 * l'anteprima: una spunta per fonte disponibile col suo costo, le non disponibili come elenco col motivo e il link,
 * la riga dell'elaborazione sempre ultima. Gli avvisi di una fonte arrivano già sulla sua riga (P-28): il riquadro
 * giallo del dialog mostra solo quelli generali.
 */

export const SOURCE_LABELS: Record<GenerationSource, string> = { linkedin: 'Profilo LinkedIn', website: 'Sito', posts: 'I miei post' };
/** Nomi nelle frasi ("Pronte 2 fonti su 3: profilo LinkedIn · i miei post"); li usa anche la sezione Proposta. */
export const SOURCE_NAMES: Record<GenerationSource, string> = { linkedin: 'profilo LinkedIn', website: 'sito', posts: 'i miei post' };
/** Le fonti della generazione (C1). */
export const SOURCE_COUNT = Object.keys(SOURCE_NAMES).length;

/** "20 set, 10:12". */
export function dayTime(iso: string): string {
  return `${fmtDayMonth(iso)}, ${new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
}

const shortUrl = (url: string) => url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
const num = (meta: Record<string, unknown>, key: string) => (typeof meta[key] === 'number' ? (meta[key] as number) : null);

/** H5: quante voci la nuova proposta mostrerebbe come conflitti invece di sovrascriverle. */
function manualCounts(profile: Profile): { fields: number; services: number } {
  return {
    fields: Object.values(profile.fields).filter((f) => f.value !== null && f.origin === 'manual').length,
    services: profile.services.filter((s) => s.origin === 'manual').length,
  };
}

function manualWarning(profile: Profile): string | null {
  const { fields, services } = manualCounts(profile);
  if (fields + services === 0) return null;
  const parts = [
    fields > 0 ? `${countText(fields, 'campo', 'campi')} su ${Object.keys(profile.fields).length}` : null,
    services > 0 ? countText(services, 'servizio', 'servizi') : null,
  ].filter(Boolean);
  const them = fields + services === 1 ? "l'hai scritto" : 'li hai scritti';
  const shown = fields + services === 1 ? 'lo mostra come conflitto e non lo sovrascrive' : 'li mostra come conflitti e non li sovrascrive';
  return `${parts.join(' e ')} ${them} a mano: una nuova proposta ${shown}.`;
}

/** La riga che anticipa le fonti (G4): *"Pronte 2 fonti su 3: profilo LinkedIn · i miei post. Sito non impostato."* */
function readinessLine(preview: GenerateProfilePreview): string {
  const ready = preview.sources.filter((s) => s.state !== 'unavailable');
  const missing = preview.sources.filter((s) => s.state === 'unavailable').map((s) => s.short_reason ?? SOURCE_LABELS[s.kind]);
  const head =
    ready.length === 0
      ? `Nessuna fonte pronta su ${SOURCE_COUNT}.`
      : `${ready.length === 1 ? 'Pronta 1 fonte' : `Pronte ${ready.length} fonti`} su ${SOURCE_COUNT}: ${ready.map((s) => SOURCE_NAMES[s.kind]).join(' · ')}.`;
  return missing.length > 0 ? `${head} ${missing.join(' · ')}.` : head;
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

export function GenerateCard({ profile, open, onOpenChange }: GenerateCardProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Anteprima senza scelte: dice quali fonti sono pronte e se qualcosa bloccherebbe l'avvio (G4). Non spende.
  const ready = useJobPreview('generate_profile', {}, { enabled: !open });
  const last = profile.last_generation;
  const warning = manualWarning(profile);
  // `#proposta` senza una proposta in attesa (FLOW, ancore): la pagina resta in cima e la card lo dice.
  const [noProposal] = useState(() => window.location.hash === '#proposta' && profile.pending_proposal === null);

  // Deep-link `/settings/profile#genera` (Oggi, G6): focus sul bottone, mai l'apertura del dialog che spende.
  useEffect(() => {
    if (window.location.hash !== '#genera') return;
    document.getElementById('genera')?.scrollIntoView();
    buttonRef.current?.focus();
  }, []);

  const blockers = ready.data?.blockers ?? [];
  return (
    <Card id="genera" title="Genera profilo e servizi" className="scroll-mt-6">
      <div className="flex flex-col gap-3 px-4 py-4 text-sm">
        {noProposal && <p className="text-slate-600">Nessuna proposta in attesa.</p>}
        <p className="font-medium text-slate-900">
          {last?.finished_at ? <>Ultima generazione: {dayTime(last.finished_at)}{lastSourcesText(runRows(profile))}</> : 'Mai generato.'}
        </p>
        {profile.pending_proposal && <PendingLine pending={profile.pending_proposal} />}
        <p className="text-slate-600">
          Il CRM legge le tue superfici pubbliche — profilo LinkedIn, sito e i tuoi post — e ti propone chi sei, cosa vendi e i
          tuoi servizi. Niente viene scritto finché non applichi tu.
        </p>
        {warning && <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900 ring-1 ring-amber-200 ring-inset">{warning}</p>}
        {ready.data && <p className="text-slate-600">{readinessLine(ready.data)}</p>}
        {blockers.length > 0 && <p className="text-red-700">Non si può ancora generare: {blockers[0]}</p>}
        <div>
          {/* Con una proposta aperta il pieno della pagina è la decisione da prendere, non una spesa che la sostituirebbe. */}
          <Button ref={buttonRef} type="button" variant={profile.pending_proposal ? 'outline' : 'default'} onClick={() => onOpenChange(true)}>
            {last ? 'Genera di nuovo…' : 'Genera profilo e servizi…'}
          </Button>
        </div>
        {last && <LastOutcome profile={profile} />}
      </div>
      <GenerateDialog profile={profile} open={open} onOpenChange={onOpenChange} />
    </Card>
  );
}

/**
 * Le fonti come le ha trattate **l'ultimo run** (FLOW E.1, rev. 2026-10-03: ripresa, esclusa da te); per i run di prima
 * della revisione, l'ultima lettura di ogni fonte.
 */
type SourceRowView = Omit<ProfileSourceRow, 'outcome' | 'read_at'> & {
  outcome: RunSourceOutcome['outcome'];
  read_at: string | null;
  reused: boolean;
};

function runRows(profile: Profile): SourceRowView[] {
  const run = profile.last_generation?.sources;
  if (run) return run;
  return profile.sources.map((r) => ({ ...r, reused: false }));
}

/** Lette o riprese in quel run (la riga di stato in alto). */
function lastSourcesText(rows: SourceRowView[]): string {
  const read = rows.filter((r) => r.outcome === 'read').map((r) => SOURCE_NAMES[r.kind]);
  return read.length > 0 ? ` · fonti lette: ${read.join(', ')}` : ' · nessuna fonte letta';
}

/** "letta" / "ripresa" / "esclusa da te" / "non letta" a parole (accessibilità: niente icone). */
function outcomeWord(row: SourceRowView): string {
  if (row.outcome === 'read') return row.reused ? 'ripresa' : 'letta';
  if (row.outcome === 'empty') return 'letta, nessun contenuto utile';
  if (row.outcome === 'excluded') return 'esclusa da te';
  return 'non letta';
}

function outcomeDetail(row: SourceRowView): string {
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

/** L'esito accordato al nome della fonte ("sito letto", "i miei post letti"): la tabella dice "letta" (la fonte). */
function outcomeAgreed(row: SourceRowView): string {
  const many = row.kind === 'posts';
  const word = (stem: string) => `${stem}${many ? 'i' : 'o'}`;
  if (row.outcome === 'read') return row.reused ? word('ripres') : word('lett');
  if (row.outcome === 'empty') return `${word('lett')}, nessun contenuto utile`;
  if (row.outcome === 'excluded') return `${word('esclus')} da te`;
  return `non ${word('lett')}`;
}

/** "Fonti: profilo LinkedIn letto · sito non letto · i miei post letti" (la tabella chiusa, FLOW E.1). */
function sourcesLine(rows: SourceRowView[]): string {
  return `Fonti: ${rows.map((r) => `${SOURCE_NAMES[r.kind]} ${outcomeAgreed(r)}`).join(' · ')}`;
}

/**
 * Con una proposta aperta la card la annuncia in cima, con il conto di adesso (FLOW E.1): la proposta comincia nella
 * prima schermata invece che sotto la tabella.
 */
function PendingLine({ pending }: { pending: NonNullable<Profile['pending_proposal']> }) {
  const conflicts = pending.conflicts > 0 ? `, ${pending.conflicts} in conflitto` : '';
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900 ring-1 ring-sky-200 ring-inset">
      <p className="flex items-center gap-2">
        <SparklesIcon aria-hidden="true" className="size-4 shrink-0 text-sky-600" />
        <span>
          Proposta in attesa: {countText(pending.to_decide, 'voce da decidere', 'voci da decidere')}
          {conflicts}.
        </span>
      </p>
      <a href="#proposta" onClick={focusProposal} className="inline-flex items-center gap-1 font-medium underline underline-offset-2">
        Rivedi la proposta
        <ArrowDownIcon aria-hidden="true" className="size-3.5" />
      </a>
    </div>
  );
}

/** "Rivedi la proposta" dalla card: la pagina scende alla sezione e il focus va sul suo titolo (mai sul link). */
function focusProposal(event: MouseEvent): void {
  const title = document.querySelector<HTMLElement>('#proposta h2');
  if (!title) return;
  event.preventDefault();
  revealAndFocus(title);
}

/**
 * La frase d'esito segue la vita della proposta (FLOW E.1, rev. 2026-10-03): aperta → il conto la dice in cima alla
 * card; chiusa → al passato con le decisioni; senza proposta di quel run (nessuna novità, nessun contenuto, fallita)
 * → il riepilogo del job.
 */
function outcomeText(profile: Profile): string | null {
  const last = profile.last_generation!;
  const proposal = profile.last_proposal;
  if (!proposal || proposal.job_id !== last.job_id || last.counts.no_news === 1) return last.summary;
  if (proposal.open) return null;
  const { applied, edited, rejected, decided } = proposal.summary;
  if (decided === 0) return last.summary;
  const parts = [
    applied > 0 ? countText(applied, 'applicata', 'applicate') : null,
    edited > 0 ? `${edited} con le tue modifiche` : null,
    rejected > 0 ? countText(rejected, 'rifiutata', 'rifiutate') : null,
  ].filter(Boolean);
  return `Proposta del ${fmtDayMonth(proposal.created_at)} chiusa: ${parts.join(' · ')}.`;
}

/** L'esito onesto vive nella pagina (G5): una riga per fonte, la frase dell'esito, il run. */
function LastOutcome({ profile }: { profile: Profile }) {
  const uid = useId();
  const last = profile.last_generation!;
  const poor = last.counts.poor === 1;
  const rows = runRows(profile);
  const open = profile.pending_proposal !== null;
  // Con una proposta aperta la tabella si chiude in una riga (FLOW E.1); si riapre con "Esito per fonte".
  const [showTable, setShowTable] = useState(!open);
  // Chiusa la proposta la tabella si apre; riaperta (Annulla dopo la chiusura) torna in una riga, e la proposta risale.
  useEffect(() => {
    setShowTable(!open);
  }, [open]);
  const text = outcomeText(profile);
  const neutral = poor || last.counts.no_content === 1 || last.counts.no_news === 1;
  const model = last.counts.no_content === 1 ? 'non chiamata' : profile.last_proposal?.job_id === last.job_id ? profile.last_proposal.model : null;
  return (
    <div className="flex flex-col gap-2 border-t border-slate-100 pt-3">
      {rows.length > 0 && (
        <Collapsible open={showTable} onOpenChange={setShowTable} className="flex flex-col gap-2">
          {(open || !showTable) && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-slate-600">{sourcesLine(rows)}</p>
              <CollapsibleTrigger asChild>
                <Button type="button" variant="ghost" size="sm">
                  Esito per fonte
                  {showTable ? <ChevronUpIcon data-icon="inline-end" aria-hidden="true" /> : <ChevronDownIcon data-icon="inline-end" aria-hidden="true" />}
                </Button>
              </CollapsibleTrigger>
            </div>
          )}
          <CollapsibleContent>
            <table id={`${uid}-table`} className="w-full">
              <caption className="pb-1 text-left text-xs font-medium text-slate-600">Esito dell'ultima generazione per fonte</caption>
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
                {rows.map((row) => (
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
          </CollapsibleContent>
        </Collapsible>
      )}
      {last.state === 'failed' ? (
        <p role="status" className="text-red-700">
          Generazione fallita: {describeJobError(last.error).message}
        </p>
      ) : (
        text && <p className={neutral ? 'text-slate-600' : 'text-slate-900'}>{text}</p>
      )}
      {last.warnings.length > 0 && (
        <ul className="list-disc pl-5 text-amber-900">
          {last.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {poor && (
        <p className="flex flex-wrap gap-x-3 gap-y-1">
          <a href="#profilo" className="font-medium underline">
            Aggiungi il sito
          </a>
          <Link to="/settings/posts" className="font-medium underline">
            Sincronizza i post
          </Link>
          <a href="#servizi" className="font-medium underline">
            Scrivi un servizio a mano
          </a>
        </p>
      )}
      <p className="flex flex-wrap gap-x-3 text-slate-600">
        {model && <span>Elaborazione: {model}</span>}
        <RunLink run={{ id: last.job_id }} className="underline">
          Vedi il run
        </RunLink>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Anteprima (FLOW B)
// ---------------------------------------------------------------------------

function sourceDetail(source: PreviewSource, data: GenerateProfilePreview): string {
  const cost = source.est_cost_usd === null ? 'costo non disponibile' : source.est_cost_usd === 0 ? 'nessun costo' : formatCost(source.est_cost_usd);
  if (source.kind === 'linkedin') {
    const where = source.address ? `${shortUrl(source.address)} · ` : '';
    if (source.fresh_at && !source.forced) return `${where}già letto il ${fmtDayMonth(source.fresh_at)}: si riprende quella lettura, senza ripagarla`;
    return `${where}1 lettura con Apify (${cost})`;
  }
  if (source.kind === 'website') {
    const where = source.address ? `${shortUrl(source.address)} · ` : '';
    if (source.fresh_at && !source.forced) return `${where}già letto il ${fmtDayMonth(source.fresh_at)}: si riprende quella lettura`;
    return `${where}fino a ${source.max_pages} pagine con Cloudflare (nessun costo in denaro: è una delle 5 letture al giorno del piano gratuito)`;
  }
  const complete = data.counts.posts_complete ?? 0;
  const excerpts = data.counts.posts_excerpts ?? 0;
  const rest = excerpts === 1 ? "1 ha solo l'estratto: non entra" : `${fmtCount(excerpts)} hanno solo l'estratto: non entrano`;
  return `${fmtCount(complete)} post con testo integrale${excerpts > 0 ? ` (${rest})` : ''} · nessun costo`;
}

/** Dove si risolve una fonte non disponibile (`remedy` dal server). */
function remedyLink(source: PreviewSource, close: () => void): ReactNode {
  const cls = 'font-medium underline';
  if (source.remedy === 'connections') {
    return (
      <Link to="/settings/connections" onClick={close} className={cls}>
        Vai a Connessioni
      </Link>
    );
  }
  if (source.remedy === 'addresses') {
    return (
      <a href="#profilo" onClick={close} className={cls}>
        Vai a «I tuoi indirizzi pubblici»
      </a>
    );
  }
  if (source.remedy === 'posts') {
    return (
      <Link to="/settings/posts" onClick={close} className={cls}>
        Vai a «I miei post»
      </Link>
    );
  }
  return null;
}

function costPieces(data: GenerateProfilePreview): string {
  const paid = data.sources.filter((s) => s.state === 'selected' && (s.est_cost_usd ?? 0) > 0);
  const pieces = [
    ...paid.map((s) => `${SOURCE_NAMES[s.kind]} ${formatCost(s.est_cost_usd)}`),
    ...(data.processing.est_cost_usd !== null ? [`elaborazione ${formatCost(data.processing.est_cost_usd)}`] : []),
  ];
  return pieces.join(' + ');
}

/** Riassunto dell'anteprima (anche in "Riprova…"): fonti, pagine, post, e da cosa viene il costo. */
function GenerateSummary({ data }: { data: GenerateProfilePreview }) {
  const c = data.counts;
  const posts = data.sources.find((s) => s.kind === 'posts')?.state === 'selected' ? c.posts_complete : 0;
  const units = [
    c.profile_reads ? '1 lettura del profilo' : null,
    c.site_max_pages ? `fino a ${c.site_max_pages} pagine del sito` : null,
    '1 elaborazione',
  ].filter(Boolean);
  const pieces = costPieces(data);
  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
      <p>
        Fonti da leggere: {c.sources_selected} su {SOURCE_COUNT}
        {c.site_max_pages ? ` · Pagine del sito: fino a ${c.site_max_pages}` : ''}
        {posts ? ` · Post con testo integrale: ${fmtCount(posts)}` : ''}
      </p>
      {data.est_cost_usd !== null ? (
        pieces && <p className="text-slate-600">= {pieces}</p>
      ) : (
        <p className="text-slate-600">
          Stima non disponibile — {units.join(', ')}
          {data.missing_prices.length > 0 && `; imposta ${data.missing_prices.join(' e ')} nel .env per vedere il costo`}.
        </p>
      )}
    </div>
  );
}

/** Le fonti di un'anteprima in sola lettura ("Riprova…": stesse fonti scelte, D12). */
export function GenerateSourcesReadOnly({ data }: { data: GenerateProfilePreview }) {
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-1 text-sm">
        {data.sources.map((s) => (
          <li key={s.kind}>
            <span className="font-medium text-slate-900">{SOURCE_LABELS[s.kind]}</span> —{' '}
            {s.state === 'selected' ? sourceDetail(s, data) : s.state === 'excluded' ? 'esclusa' : `non disponibile: ${s.reason}`}
          </li>
        ))}
      </ul>
      <GenerateSummary data={data} />
    </div>
  );
}

function GenerateDialog({ profile, open, onOpenChange }: GenerateCardProps) {
  const [choice, setChoice] = useState<Required<GenerateChoice>>({ exclude: [], force: [] });
  const [announcement, setAnnouncement] = useState('');
  const changed = useRef(false);
  const preview = useJobPreview('generate_profile', choice, { enabled: open, keepPrevious: true });
  const data = preview.data;

  // Alla chiusura, non all'apertura: riaprendo, la prima anteprima è già quella senza scelte.
  useEffect(() => {
    if (open) return;
    setChoice({ exclude: [], force: [] });
    setAnnouncement('');
    changed.current = false;
  }, [open]);

  // Annuncio dopo ogni esclusione o rilettura, quando l'anteprima ricalcolata arriva (G9).
  useEffect(() => {
    if (!changed.current || !data || preview.isFetching) return;
    changed.current = false;
    const cost = data.est_cost_usd === null ? 'stima del costo non disponibile' : `costo stimato ${formatCost(data.est_cost_usd)}`;
    setAnnouncement(`Anteprima aggiornata: ${countText(data.counts.sources_selected, 'fonte', 'fonti')}, ${cost}.`);
  }, [data, preview.isFetching]);

  const start = useJobStart((vars: GenerateChoice) => api.profile.generate(vars), { onStarted: () => onOpenChange(false) });

  const toggle = (key: 'exclude' | 'force', kind: GenerationSource, on: boolean) => {
    changed.current = true;
    setChoice((cur) => ({ ...cur, [key]: on ? [...new Set([...cur[key], kind])] : cur[key].filter((k) => k !== kind) }));
  };

  const warning = manualWarning(profile);
  const choosable = data?.sources.filter((s) => s.state !== 'unavailable') ?? [];
  const unavailable = data?.sources.filter((s) => s.state === 'unavailable') ?? [];
  const close = () => onOpenChange(false);

  return (
    <JobPreviewDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Genera profilo e servizi"
      description={
        <>
          Legge le fonti che scegli e le fa elaborare una volta sola. Controlla fonti e costo prima di avviare.
          {warning && <span className="mt-1 block text-amber-900">{warning}</span>}
        </>
      }
      preview={preview}
      summary={(d) => <GenerateSummary data={d as GenerateProfilePreview} />}
      startLabel="Avvia"
      starting={start.isPending}
      onStart={() => start.mutate(choice)}
    >
      {data && (
        <>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-slate-900">Fonti da leggere</legend>
            <p className="text-xs text-slate-500">Si legge solo ciò che è pubblico: nessun login, nessun cookie.</p>
            {choosable.map((s) => (
              <div key={s.kind} className="flex flex-col gap-1">
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={s.state === 'selected'}
                    onCheckedChange={(v) => toggle('exclude', s.kind, v !== true)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium text-slate-900">{SOURCE_LABELS[s.kind]}</span>
                    <span className="block text-slate-600">{sourceDetail(s, data)}</span>
                    {s.kind === 'website' && s.state === 'selected' && (
                      <span className="block text-xs text-slate-500">
                        Dalla pagina iniziale seguendo i link del sito, fino a {s.max_pages} pagine.
                      </span>
                    )}
                  </span>
                </label>
                {s.fresh_at && s.state === 'selected' && (
                  <label className="ml-6 flex items-start gap-2 text-sm">
                    <Checkbox checked={s.forced} onCheckedChange={(v) => toggle('force', s.kind, v === true)} className="mt-0.5" />
                    <span>
                      Rileggilo comunque
                      <span className="block text-xs text-slate-500">
                        {s.kind === 'linkedin'
                          ? 'Una lettura nuova con Apify: il suo costo torna nella stima.'
                          : "Una lettura nuova del sito: un'altra delle 5 letture al giorno del piano gratuito."}
                      </span>
                    </span>
                  </label>
                )}
              </div>
            ))}
            <p className="text-sm">
              <span className="font-medium text-slate-900">Elaborazione AI (Anthropic)</span>
              <span className="block text-slate-600">
                Una elaborazione delle fonti lette · Modello: {data.processing.model} ·{' '}
                {data.processing.est_cost_usd === null ? 'costo non disponibile' : formatCost(data.processing.est_cost_usd)}
              </span>
            </p>
          </fieldset>
          {unavailable.length > 0 && (
            <div className="text-sm">
              <p className="font-medium text-slate-700">Non disponibili ({unavailable.length})</p>
              <ul className="mt-1 flex flex-col gap-1 text-slate-600">
                {unavailable.map((s) => (
                  <li key={s.kind}>
                    {SOURCE_LABELS[s.kind]} — {s.reason} {remedyLink(s, close)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p role="status" aria-live="polite" className="sr-only">
            {announcement}
          </p>
        </>
      )}
    </JobPreviewDialog>
  );
}
