import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, PencilIcon, Undo2Icon, XIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import {
  PROPOSED_SERVICE_FIELDS,
  type GenerationSource,
  type ProposalFieldItem,
  type ProposalItemStatus,
  type ProposalServiceItem,
  type ProposedServiceField,
  type ServiceValueKey,
} from '../../api/types';
import { fmtDayMonth } from '../../lib/dates';
import { animateRowChange } from '../../lib/motion';
import { Spinner } from '../ui';
import { SOURCE_NAMES } from './GenerateCard';
import { textareaCls } from './parts';
import { PROFILE_FIELD_LABELS } from './ProfileForms';

/*
 * Le righe della proposta (own-profile-services FLOW C.4–C.8, rev. 2026-10-03; forma: PROPOSAL-DESIGN §2.3–§2.8).
 * Una voce da decidere è bianca, con i testi interi e tre verbi sempre nello stesso ordine (prendi · rielabora · no);
 * una voce decisa arretra in una riga compatta che dice in parole cosa è successo, con Annulla. Le icone sono
 * decorative: lo stato è sempre in testo, dentro il nome accessibile del titolo.
 */

export type ItemKey = `field:${string}` | `service:${string}`;
export const fieldKey = (f: ProposalFieldItem): ItemKey => `field:${f.key}`;
export const serviceKey = (s: ProposalServiceItem): ItemKey => `service:${s.name}`;

export type Verb = 'accept' | 'edit' | 'reject' | 'undo';

export const SERVICE_FIELD_LABELS: Record<ProposedServiceField, string> = {
  description: 'Descrizione',
  audience: 'A chi serve',
  problem: 'Problema',
  proof: 'Prove',
};
/** Nome e campi di un servizio in minuscolo, nelle frasi ("aggiornato: descrizione, a chi serve"). */
const SERVICE_VALUE_WORDS: Record<ServiceValueKey, string> = {
  name: 'nome',
  description: 'descrizione',
  audience: 'a chi serve',
  problem: 'problema',
  proof: 'prove',
  notes: 'note',
};

/** "a, b e c". */
export function listText(words: string[]): string {
  return words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} e ${words.at(-1)}`;
}

const sourcesText = (sources: GenerationSource[]) => `da: ${sources.map((s) => SOURCE_NAMES[s]).join(', ')}`;
const quote = (text: string) => `«${text}»`;

/** Lo stato di una riga mentre una sua azione è in corso (una sola alla volta nella sezione). */
export interface RowActivity {
  /** Il verbo in corso su questa riga, `null` se nessuno. */
  busy: Verb | null;
  /** L'attesa supera 300 ms: lo spinner sostituisce l'icona del bottone premuto (§2.3). */
  slow: boolean;
  /** Un'azione è in corso nella sezione: i bottoni sono `aria-disabled` (mai `disabled`: il focus resta). */
  locked: boolean;
  error?: ReactNode;
}

// ---------------------------------------------------------------------------
// Riga che cambia forma al suo posto (M1/M2)
// ---------------------------------------------------------------------------

/**
 * `li` della voce: anima l'altezza quando la voce passa da "da decidere" a "decisa" (o torna), solo se `animate`
 * conferma che il cambio viene da un'azione su questa riga (mai da un'azione di massa o da una rilettura).
 */
export function ItemRow(props: { itemKey: ItemKey; decided: boolean; animate: (key: ItemKey) => boolean; children: ReactNode }) {
  const li = useRef<HTMLLIElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const height = useRef(0);
  const { itemKey, decided, animate } = props;

  useLayoutEffect(() => {
    const el = li.current;
    if (!el || !animate(itemKey)) return;
    const running = el.getAnimations().length > 0;
    const from = running ? el.getBoundingClientRect().height : height.current;
    el.getAnimations().forEach((a) => a.cancel());
    height.current = animateRowChange(el, content.current, from);
  }, [decided, itemKey, animate]);

  // Dopo ogni commit (Modifica aperta, errori, Mostra tutto): l'altezza da cui partirà la prossima animazione.
  useLayoutEffect(() => {
    const el = li.current;
    if (el && el.getAnimations().length === 0) height.current = el.getBoundingClientRect().height;
  });

  return (
    <li
      ref={li}
      data-item-key={itemKey}
      data-decided={decided ? 'true' : undefined}
      className={cn('transition-colors duration-150 ease-[ease]', decided ? 'bg-slate-50/70' : 'bg-white')}
    >
      <div ref={content}>{props.children}</div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Pezzi della riga da decidere
// ---------------------------------------------------------------------------

const BADGE: Record<Exclude<ProposalItemStatus, 'unchanged'>, { label: string; className: string }> = {
  new: { label: 'Nuovo', className: 'border-sky-200 bg-sky-50 text-sky-800' },
  changed: { label: 'Modificato', className: 'border-slate-200 bg-slate-50 text-slate-700' },
  conflict: { label: 'In conflitto', className: 'border-amber-300 bg-amber-50 text-amber-900' },
};

const titleCls =
  'flex flex-wrap items-center gap-x-2 gap-y-1 scroll-mt-[calc(var(--proposal-strip,4rem)+0.75rem)] rounded-sm text-sm font-semibold text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2';

function PendingHeader(props: { id: string; name: string; status: ProposalItemStatus; tail?: ReactNode; sources: GenerationSource[] }) {
  const badge = props.status === 'unchanged' ? null : BADGE[props.status];
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
      <h4 id={props.id} tabIndex={-1} className={titleCls}>
        <span>{props.name}</span>
        {badge && (
          <Badge variant="outline" className={badge.className}>
            {badge.label}
          </Badge>
        )}
        {props.tail}
      </h4>
      <p className="pt-0.5 text-xs text-slate-500">{sourcesText(props.sources)}</p>
    </div>
  );
}

/** Una coppia del confronto: etichetta nella colonna di `6rem`, testo con la riga di chi lo ha scritto (§1, principio 4). */
function Pair(props: { label: string; tone: 'now' | 'mine' | 'proposed'; children: ReactNode }) {
  return (
    <>
      <dt className={cn('text-xs/5 font-medium', props.tone === 'proposed' ? 'text-sky-700' : 'text-slate-500')}>{props.label}</dt>
      <dd
        className={cn(
          'max-w-[68ch] border-l-2 pl-3 text-sm/5 whitespace-pre-line',
          props.tone === 'proposed' && 'border-sky-400 text-slate-900',
          props.tone === 'now' && 'border-slate-200 text-slate-600',
          props.tone === 'mine' && 'border-amber-300 text-slate-700',
        )}
      >
        {props.children}
      </dd>
    </>
  );
}

const compareCls = 'grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-2';

/** Ora sopra, Proposta sotto (paragrafi: affiancarli li spezza); campo oggi vuoto ⇒ solo la proposta (finding 20). */
function Compare(props: { now: string | null; proposed: string; mine: boolean; proposedLabel?: string; children?: ReactNode }) {
  return (
    <dl className={compareCls}>
      {props.now !== null && (
        <Pair label="Ora" tone={props.mine ? 'mine' : 'now'}>
          {props.now}
        </Pair>
      )}
      {props.children ?? (
        <Pair label={props.now === null ? (props.proposedLabel ?? 'Proposta') : 'Proposta'} tone="proposed">
          {props.proposed}
        </Pair>
      )}
    </dl>
  );
}

interface VerbSpec {
  verb: Exclude<Verb, 'undo'>;
  label: string;
  /** Nome accessibile completo, con la voce (oggi lo screen reader leggeva sette "Applica" uguali). */
  aria: string;
}

const VERB_ICONS = { accept: CheckIcon, edit: PencilIcon, reject: XIcon } as const;

/** I tre verbi: `outline` `sm`, sempre nello stesso ordine, nessuno primario (§2.4). */
function VerbBar(props: { verbs: VerbSpec[]; activity: RowActivity; onVerb: (verb: Exclude<Verb, 'undo'>) => void; note?: string }) {
  const { busy, slow, locked } = props.activity;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {props.verbs.map(({ verb, label, aria }) => {
        const Icon = VERB_ICONS[verb];
        const pressed = busy === verb;
        return (
          <Button
            key={verb}
            type="button"
            size="sm"
            variant="outline"
            data-verb={verb}
            aria-label={aria}
            aria-disabled={locked || undefined}
            aria-busy={pressed || undefined}
            className={cn(!slow && 'aria-disabled:opacity-100')}
            onClick={() => {
              if (!locked) props.onVerb(verb);
            }}
          >
            {pressed && slow ? (
              <Spinner className="size-3.5 border-current border-t-transparent" />
            ) : (
              <Icon data-icon="inline-start" aria-hidden="true" />
            )}
            {label}
          </Button>
        );
      })}
      {props.note && <p className="ml-1 text-xs text-slate-500">{props.note}</p>}
    </div>
  );
}

function RowError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-sm text-red-700">
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Campo da decidere (con la Modifica in riga)
// ---------------------------------------------------------------------------

export interface FieldEditing {
  text: string;
  error: string | null;
}

export function FieldPending(props: {
  item: ProposalFieldItem;
  /** Data della proposta: "compilato da prima del 2 ott" (E14). */
  proposalDate: string;
  /** C'è l'azione di massa (almeno 2 voci da decidere): la nota E14 dice che lo sostituirebbe. */
  bulk: boolean;
  activity: RowActivity;
  editing: FieldEditing | null;
  onVerb: (verb: Exclude<Verb, 'undo'>) => void;
  onEditChange: (text: string) => void;
  onEditSubmit: () => void;
  onEditCancel: () => void;
}) {
  const { item } = props;
  const uid = useId();
  const label = PROFILE_FIELD_LABELS[item.key];
  const conflict = item.status === 'conflict';
  const tail = conflict ? (
    <span className="text-xs font-normal text-slate-600">
      con ciò che hai scritto a mano{item.current_origin_at ? ` · scritto da te il ${fmtDayMonth(item.current_origin_at)}` : ''}
    </span>
  ) : item.status === 'changed' && item.current_origin === null ? (
    <span className="text-xs font-normal text-amber-800">
      compilato da prima del {fmtDayMonth(props.proposalDate)}
      {props.bulk ? ": l'azione di massa lo sostituisce" : ''}
    </span>
  ) : null;
  const verbs: VerbSpec[] = conflict
    ? [
        { verb: 'accept', label: 'Sostituisci il tuo testo', aria: `Sostituisci il tuo testo di ${label}` },
        { verb: 'edit', label: 'Modifica', aria: `Modifica ${label}` },
        { verb: 'reject', label: 'Tieni il tuo testo', aria: `Tieni il tuo testo per ${label}` },
      ]
    : [
        { verb: 'accept', label: 'Applica', aria: `Applica ${label}` },
        { verb: 'edit', label: 'Modifica', aria: `Modifica ${label}` },
        { verb: 'reject', label: 'Rifiuta', aria: `Rifiuta ${label}` },
      ];
  return (
    <article aria-labelledby={`${uid}-title`} className="flex flex-col gap-3 px-4 py-4">
      <PendingHeader id={`${uid}-title`} name={label} status={item.status} tail={tail} sources={item.sources} />
      <Compare now={item.current} proposed={item.proposed} mine={conflict}>
        {props.editing && (
          <FieldEditor
            label={label}
            editing={props.editing}
            activity={props.activity}
            onChange={props.onEditChange}
            onSubmit={props.onEditSubmit}
            onCancel={props.onEditCancel}
          />
        )}
      </Compare>
      {!props.editing && (
        <>
          <VerbBar verbs={verbs} activity={props.activity} onVerb={props.onVerb} note={conflict ? 'Fuori dalle azioni di massa.' : undefined} />
          <RowError>{props.activity.error}</RowError>
        </>
      )}
    </article>
  );
}

/** "Modifica": la casella prende il posto del testo proposto, nella stessa colonna (§2.5). Esc non la chiude (FLOW). */
function FieldEditor(props: {
  label: string;
  editing: FieldEditing;
  activity: RowActivity;
  onChange: (text: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const uid = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  const { text, error } = props.editing;
  const { busy, slow, locked } = props.activity;

  // All'apertura: focus e cursore in fondo, si ritocca e non si riscrive.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  // Dopo un errore il focus torna nella casella.
  useEffect(() => {
    if (error) ref.current?.focus();
  }, [error]);

  const rows = Math.min(12, Math.max(3, Math.ceil(text.length / 90) + text.split('\n').length - 1));
  return (
    <div className="col-start-2 flex flex-col gap-1.5">
      <label htmlFor={`${uid}-text`} className="text-xs font-medium text-slate-700">
        Il tuo testo per «{props.label}»
      </label>
      <textarea
        ref={ref}
        id={`${uid}-text`}
        rows={rows}
        value={text}
        aria-invalid={error ? true : undefined}
        aria-describedby={cn(`${uid}-hint`, error && `${uid}-error`)}
        className={cn(
          textareaCls,
          'max-h-80 min-h-20 max-w-[68ch] resize-y bg-white field-sizing-content aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20',
        )}
        onChange={(e) => props.onChange(e.target.value)}
      />
      <p id={`${uid}-hint`} className="text-xs text-slate-500">
        Si salva come scritto da te: la prossima generazione lo mostrerà come conflitto invece di sovrascriverlo.
      </p>
      {error && (
        <p id={`${uid}-error`} role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex gap-1.5">
        <Button
          type="button"
          size="sm"
          data-verb="edit-submit"
          aria-disabled={locked || undefined}
          aria-busy={busy === 'edit' || undefined}
          className={cn(!slow && 'aria-disabled:opacity-100')}
          onClick={() => {
            if (!locked) props.onSubmit();
          }}
        >
          {busy === 'edit' && slow ? (
            <Spinner className="size-3.5 border-current border-t-transparent" />
          ) : (
            <CheckIcon data-icon="inline-start" aria-hidden="true" />
          )}
          Applica il tuo testo
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={`Annulla la modifica di ${props.label}`}
          aria-disabled={locked || undefined}
          className={cn(!slow && 'aria-disabled:opacity-100')}
          onClick={() => {
            if (!locked) props.onCancel();
          }}
        >
          Annulla
        </Button>
      </div>
      <RowError>{props.activity.error}</RowError>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Servizio da decidere
// ---------------------------------------------------------------------------

/** "Cambiano descrizione e a chi serve · invariati: nome, problema, prove." / "Riempie 3 campi vuoti · cambia «A chi serve», scritto da te." */
function serviceSynopsis(item: ProposalServiceItem): string | null {
  if (!item.existing) return null;
  const fills = item.changed_fields.filter((f) => !item.existing![f]);
  const changes = item.changed_fields.filter((f) => item.existing![f]);
  if (item.status === 'conflict') {
    const parts = [
      fills.length > 0 ? `Riempie ${fills.length === 1 ? '1 campo vuoto' : `${fills.length} campi vuoti`}` : null,
      changes.length > 0
        ? `${changes.length === 1 ? 'cambia' : 'cambiano'} ${listText(changes.map((f) => quote(SERVICE_FIELD_LABELS[f])))}, ${changes.length === 1 ? 'scritto' : 'scritti'} da te`
        : null,
    ].filter(Boolean) as string[];
    const text = parts.join(' · ');
    return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
  }
  const same = ['nome', ...PROPOSED_SERVICE_FIELDS.filter((f) => !item.changed_fields.includes(f)).map((f) => SERVICE_FIELD_LABELS[f].toLowerCase())];
  const verb = item.changed_fields.length === 1 ? 'Cambia' : 'Cambiano';
  return `${verb} ${listText(item.changed_fields.map((f) => SERVICE_FIELD_LABELS[f].toLowerCase()))} · invariati: ${same.join(', ')}.`;
}

export function ServicePending(props: { item: ProposalServiceItem; activity: RowActivity; onVerb: (verb: Exclude<Verb, 'undo'>) => void }) {
  const { item } = props;
  const uid = useId();
  const conflict = item.status === 'conflict';
  const proposed = PROPOSED_SERVICE_FIELDS.filter((f) => item.proposed[f] !== null);
  const verbs: VerbSpec[] =
    item.status === 'new'
      ? [
          { verb: 'accept', label: 'Aggiungi il servizio', aria: `Aggiungi il servizio ${item.name}` },
          { verb: 'edit', label: 'Modifica…', aria: `Modifica ${item.name} prima di aggiungerlo` },
          { verb: 'reject', label: 'Rifiuta', aria: `Rifiuta ${item.name}` },
        ]
      : conflict
        ? [
            { verb: 'accept', label: 'Sostituisci con la proposta', aria: `Sostituisci ${item.name} con la proposta` },
            { verb: 'edit', label: 'Modifica…', aria: `Modifica ${item.name} prima di aggiornarlo` },
            { verb: 'reject', label: 'Tieni il tuo servizio', aria: `Tieni il tuo servizio ${item.name}` },
          ]
        : [
            { verb: 'accept', label: 'Aggiorna il servizio', aria: `Aggiorna il servizio ${item.name}` },
            { verb: 'edit', label: 'Modifica…', aria: `Modifica ${item.name} prima di aggiornarlo` },
            { verb: 'reject', label: 'Rifiuta', aria: `Rifiuta ${item.name}` },
          ];
  const synopsis = serviceSynopsis(item);
  return (
    <article aria-labelledby={`${uid}-title`} className="flex flex-col gap-3 px-4 py-4">
      <PendingHeader
        id={`${uid}-title`}
        name={item.name}
        status={item.status}
        sources={item.sources}
        tail={
          conflict && item.existing ? (
            <span className="text-xs font-normal text-slate-600">scritto da te il {fmtDayMonth(item.existing.origin_at)}</span>
          ) : null
        }
      />
      {synopsis && <p className="text-sm text-slate-700">{synopsis}</p>}
      {item.existing && item.existing.name !== item.name && (
        <p className="text-xs text-slate-600">
          Corrisponde al tuo servizio «{item.existing.name}» (il confronto ignora maiuscole e spazi). Il nome resta il tuo.
        </p>
      )}
      {item.status === 'new' ? (
        <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3">
          {proposed.map((f) => (
            <div key={f} className="contents">
              <dt className="py-1 text-xs/5 font-medium text-slate-500">{SERVICE_FIELD_LABELS[f]}</dt>
              <dd className="max-w-[68ch] border-l-2 border-sky-400 py-1 pl-3 text-sm/5 whitespace-pre-line text-slate-900">
                {item.proposed[f]}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <>
          <dl className="flex flex-col gap-3">
            {item.changed_fields.map((f) => (
              <div key={f}>
                <dt className="mb-1.5 text-xs font-semibold text-slate-700">{SERVICE_FIELD_LABELS[f]}</dt>
                <dd>
                  <Compare now={item.existing?.[f] || null} proposed={item.proposed[f]!} mine={conflict} proposedLabel="Si aggiunge" />
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-slate-500">I campi che la proposta non nomina restano come sono.</p>
        </>
      )}
      <VerbBar
        verbs={verbs}
        activity={props.activity}
        onVerb={props.onVerb}
        note={
          conflict
            ? 'Fuori dalle azioni di massa.'
            : item.status === 'new'
              ? "Si aggiunge in fondo a «I miei servizi»: l'ordine lo decidi tu."
              : undefined
        }
      />
      <RowError>{props.activity.error}</RowError>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Voce decisa (§2.6)
// ---------------------------------------------------------------------------

type Outcome = 'done' | 'edited' | 'declined';

const OUTCOME_ICON = {
  done: { Icon: CheckIcon, className: 'text-emerald-600' },
  edited: { Icon: PencilIcon, className: 'text-emerald-600' },
  declined: { Icon: XIcon, className: 'text-slate-400' },
} as const;

interface DecidedPhrase {
  outcome: Outcome;
  /** La parola di stato ("applicato", "rifiutato", "hai tenuto il tuo testo"). */
  word: string;
  /** Il resto della frase, testo normale e selezionabile (" · prima: «…»", ": resta «…»"). */
  rest: string;
  /** Il testo applicato su una riga (un campo che era vuoto). */
  applied?: string | null;
}

export function fieldPhrase(item: ProposalFieldItem): DecidedPhrase {
  const d = item.decision!;
  const before = d.before.value;
  if (d.decision === 'rejected') {
    if (d.status === 'conflict') return { outcome: 'declined', word: 'hai tenuto il tuo testo', rest: '' };
    return { outcome: 'declined', word: 'rifiutato', rest: before ? `: resta ${quote(before)}` : ': il campo resta vuoto' };
  }
  const word = d.decision === 'edited' ? 'applicato con le tue modifiche' : 'applicato';
  return {
    outcome: d.decision === 'edited' ? 'edited' : 'done',
    word,
    rest: before ? ` · prima: ${quote(before)}` : '',
    applied: before ? null : d.value,
  };
}

export function servicePhrase(item: ProposalServiceItem): DecidedPhrase {
  const d = item.decision!;
  if (d.decision === 'rejected') {
    if (d.status === 'conflict') return { outcome: 'declined', word: "hai tenuto il tuo servizio com'è", rest: '' };
    return { outcome: 'declined', word: 'rifiutato', rest: d.before ? ": resta com'è" : ': non è stato aggiunto' };
  }
  const edited = d.decision === 'edited';
  const outcome: Outcome = edited ? 'edited' : 'done';
  if (!d.before) {
    return { outcome, word: edited ? 'aggiunto con le tue modifiche' : 'aggiunto', rest: ' in fondo a «I miei servizi»' };
  }
  const changed = d.changed.filter((k) => k !== 'name' || edited);
  // Il testo sostituito resta leggibile: solo i campi che avevano un valore.
  const replaced = d.changed
    .filter((k) => k !== 'name' && d.before![k])
    .map((k) => `${SERVICE_VALUE_WORDS[k].charAt(0).toUpperCase()}${SERVICE_VALUE_WORDS[k].slice(1)} ${quote(d.before![k]!)}`);
  return {
    outcome,
    word: edited ? 'aggiornato con le tue modifiche' : 'aggiornato',
    rest: `${changed.length > 0 ? `: ${changed.map((k) => SERVICE_VALUE_WORDS[k]).join(', ')}` : ''}${replaced.length > 0 ? ` · prima: ${replaced.join('; ')}` : ''}`,
  };
}

export function DecidedItem(props: { name: string; phrase: DecidedPhrase; activity: RowActivity; onUndo: () => void }) {
  const uid = useId();
  const { outcome, word, rest, applied } = props.phrase;
  const { Icon, className } = OUTCOME_ICON[outcome];
  const clampRef = useRef<HTMLDivElement>(null);
  const appliedRef = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);
  const { busy, slow, locked } = props.activity;

  // "Mostra tutto" solo se un taglio c'è davvero: nella frase o nel testo applicato.
  useLayoutEffect(() => {
    if (open) return;
    const cut = (el: HTMLElement | null) => el !== null && el.scrollHeight > el.clientHeight + 1;
    setClipped(cut(clampRef.current) || cut(appliedRef.current));
  }, [open, rest, applied]);

  return (
    <article aria-labelledby={`${uid}-title`} className="flex items-start gap-3 px-4 py-3">
      <Icon aria-hidden="true" className={cn('mt-0.5 size-4 shrink-0', className)} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div ref={clampRef} className={cn('text-sm/5 text-slate-600', !open && 'line-clamp-2')}>
          <h4
            id={`${uid}-title`}
            tabIndex={-1}
            className="inline scroll-mt-[calc(var(--proposal-strip,4rem)+0.75rem)] rounded-sm font-medium text-slate-800 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {props.name} —{' '}
            <span className={cn('font-medium', outcome === 'declined' ? 'text-slate-600' : 'text-emerald-700')}>{word}</span>
          </h4>
          {rest}
        </div>
        {applied && (
          <p ref={appliedRef} className={cn('text-sm/5 whitespace-pre-line text-slate-500', !open && 'line-clamp-1')}>
            {applied}
          </p>
        )}
        {(clipped || open) && (
          <button
            type="button"
            aria-expanded={open}
            className="w-fit text-xs font-medium text-slate-500 underline-offset-2 hover:underline"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? 'Riduci' : 'Mostra tutto'}
          </button>
        )}
        <RowError>{props.activity.error}</RowError>
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        data-verb="undo"
        aria-label={`Annulla la decisione su ${props.name}`}
        aria-disabled={locked || undefined}
        aria-busy={busy === 'undo' || undefined}
        className={cn('shrink-0 text-slate-600', !slow && 'aria-disabled:opacity-100')}
        onClick={() => {
          if (!locked) props.onUndo();
        }}
      >
        {busy === 'undo' && slow ? (
          <Spinner className="size-3.5 border-current border-t-transparent" />
        ) : (
          <Undo2Icon data-icon="inline-start" aria-hidden="true" />
        )}
        Annulla
      </Button>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Invariati (§2.7)
// ---------------------------------------------------------------------------

export function UnchangedRow(props: { groupName: string; items: Array<{ name: string; value: string }> }) {
  const [open, setOpen] = useState(false);
  const n = props.items.length;
  return (
    <Collapsible asChild open={open} onOpenChange={setOpen}>
      <li className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-white px-4 py-2.5 text-sm">
        <p className="min-w-0 flex-1 text-slate-500">
          Invariati ({n}): <span className="text-slate-700">{props.items.map((i) => i.name).join(', ')}</span>
        </p>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" aria-label={`${open ? 'Nascondi' : 'Mostra'} ${n === 1 ? "l'invariato" : `i ${n} invariati`} ${props.groupName}`}>
            {open ? 'Nascondi' : 'Mostra'}
            {open ? <ChevronUpIcon data-icon="inline-end" aria-hidden="true" /> : <ChevronDownIcon data-icon="inline-end" aria-hidden="true" />}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent asChild>
          <ul className="flex basis-full flex-col gap-1.5 pt-1 pb-0.5">
            {props.items.map((i) => (
              <li key={i.name} className="text-sm text-slate-600">
                <span className="font-medium text-slate-700">{i.name}</span> · uguale al tuo: {quote(i.value)}
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      </li>
    </Collapsible>
  );
}
