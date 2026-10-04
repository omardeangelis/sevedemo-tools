import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';
import { ArrowDownIcon, CircleCheckIcon, SparklesIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { api, errorText, isApiError, queryKeys } from '../../api/client';
import {
  PROPOSED_SERVICE_FIELDS,
  type Profile,
  type ProposalDiscarded,
  type ProposalFieldItem,
  type ProposalItemStatus,
  type ProposalItemTarget,
  type ProposalServiceItem,
  type ProposalView,
  type ServiceInput,
} from '../../api/types';
import { fmtDayMonth } from '../../lib/dates';
import { countText } from '../../lib/format';
import { animateSettle, revealAndFocus } from '../../lib/motion';
import { useDialogFocusReturn } from '../BulkBar';
import { toast } from '../ui/toaster';
import { dayTime, SOURCE_COUNT } from './GenerateCard';
import { PROFILE_FIELD_LABELS } from './ProfileForms';
import {
  DecidedItem,
  FieldPending,
  fieldKey,
  fieldPhrase,
  ItemRow,
  listText,
  SERVICE_FIELD_LABELS,
  serviceKey,
  servicePhrase,
  ServicePending,
  UnchangedRow,
  type FieldEditing,
  type ItemKey,
  type RowActivity,
  type Verb,
} from './ProposalRows';
import { ProposalServiceDialog, type ProposalServiceEditing } from './ServicesCard';

/*
 * La proposta di profilo e servizi (own-profile-services FLOW A.5–A.7 e C, rivisti il 2026-10-03; forma:
 * PROPOSAL-DESIGN). Ogni voce si decide da sola — Applica, Modifica o Rifiuta —, ogni decisione si annulla dalla sua
 * riga, e la proposta si chiude da sé quando non resta niente da decidere. Il confronto e le decisioni arrivano dal
 * server (P-12); qui l'ordine della visita, le azioni (una alla volta), il focus dopo ognuna e la live region.
 */

const STATUS_RANK: Record<ProposalItemStatus, number> = { conflict: 0, new: 1, changed: 2, unchanged: 3 };
const GROUP_ORDER = { fields: 0, services: 1 } as const;

type Item = { key: ItemKey; group: 'fields'; data: ProposalFieldItem } | { key: ItemKey; group: 'services'; data: ProposalServiceItem };

const itemsOf = (view: ProposalView): Item[] => [
  ...view.fields.map((f): Item => ({ key: fieldKey(f), group: 'fields', data: f })),
  ...view.services.map((s): Item => ({ key: serviceKey(s), group: 'services', data: s })),
];
const isDecided = (i: Item) => i.data.decision !== null;
/** Una riga della lista: da decidere (non invariata) o già decisa. Le invariate stanno nella riga in fondo al gruppo. */
const isRow = (i: Item) => isDecided(i) || i.data.status !== 'unchanged';
const nameOf = (i: Item) => (i.group === 'fields' ? PROFILE_FIELD_LABELS[i.data.key] : i.data.name);
const targetOf = (i: Item): ProposalItemTarget => (i.group === 'fields' ? { field: i.data.key } : { service: i.data.name });

/**
 * L'ordine della visita (FLOW C.3, C.7): da decidere prima (In conflitto → Nuovo → Modificato), poi le decise; poi
 * resta quello — una voce decisa non salta sotto il cursore —, e una voce comparsa dopo va in coda.
 */
function initialRanks(view: ProposalView): Map<ItemKey, number> {
  const items = itemsOf(view).map((item, index) => ({ item, index }));
  items.sort(
    (a, b) =>
      Number(isDecided(a.item)) - Number(isDecided(b.item)) ||
      STATUS_RANK[a.item.data.status] - STATUS_RANK[b.item.data.status] ||
      a.index - b.index,
  );
  return new Map(items.map(({ item }, i) => [item.key, i]));
}

function plural(n: number, one: string, many: string): string {
  return countText(n, one, many);
}

/** "Decise 4 di 6 · ne restano 2, 2 in conflitto" (FLOW C.2, C.9). */
function progressText(s: ProposalView['summary']): { lead: string; rest: string; conflicts: string } {
  const conflicts = s.conflicts > 0 ? `${s.conflicts} in conflitto` : '';
  if (s.decided === 0 && s.to_decide === 1) return { lead: 'Resta 1 voce da decidere', rest: conflicts ? ', ' : '', conflicts };
  const lead = `Decise ${s.decided} di ${s.total}`;
  if (s.decided === 0) return { lead, rest: conflicts ? ' · ' : '', conflicts };
  const left = s.to_decide === 0 ? '' : s.to_decide === 1 ? ' · ne resta 1' : ` · ne restano ${s.to_decide}`;
  return { lead, rest: `${left}${conflicts ? ', ' : ''}`, conflicts };
}

/** "Restano 5 voci da decidere, 2 in conflitto." · "Proposta chiusa: hai deciso tutte le voci." */
function remainingText(s: ProposalView['summary']): string {
  if (s.to_decide === 0) return 'Proposta chiusa: hai deciso tutte le voci.';
  const head = s.to_decide === 1 ? 'Resta 1 voce da decidere' : `Restano ${s.to_decide} voci da decidere`;
  return `${head}${s.conflicts > 0 ? `, ${s.conflicts} in conflitto` : ''}.`;
}

const LEFT_OUT_REASON: Record<ProposalDiscarded['reason'], string> = {
  no_source: 'senza fonte',
  duplicate: 'con un nome già proposto',
  not_generable: 'non generabili',
  too_many: 'oltre il numero massimo di servizi',
};

/** "1 voce lasciata fuori perché senza fonte" (E6): mai "scartata", che sembrerebbe una decisione tua. */
function leftOutText(discarded: ProposalDiscarded[]): string | null {
  const n = discarded.length;
  if (n === 0) return null;
  if (discarded.every((d) => d.reason === 'no_source')) {
    return n === 1 ? '1 voce lasciata fuori perché senza fonte' : `${n} voci lasciate fuori perché senza fonte`;
  }
  const reasons = (Object.keys(LEFT_OUT_REASON) as Array<ProposalDiscarded['reason']>)
    .map((r) => [r, discarded.filter((d) => d.reason === r).length] as const)
    .filter(([, c]) => c > 0)
    .map(([r, c]) => `${c} ${LEFT_OUT_REASON[r]}`);
  return `${n === 1 ? '1 voce lasciata fuori' : `${n} voci lasciate fuori`} (${reasons.join(', ')})`;
}

/** Il titolo di una card che resta, per il focus quando la sezione sparisce (mai `body`, TD-4). */
function cardTitle(anchor: 'azienda' | 'genera'): HTMLElement | null {
  const title = document.getElementById(anchor)?.closest('section')?.querySelector<HTMLElement>('h2') ?? null;
  if (title) {
    title.tabIndex = -1;
    // Lo scorrimento si ferma sopra la card, non sul bordo del titolo.
    title.style.scrollMarginTop = '4rem';
  }
  return title;
}

/** Testo non salvato nel form della card per quel campo (FLOW, "Campo in modifica mentre applichi"). */
function unsavedInForm(item: ProposalFieldItem): boolean {
  const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-profile-field="${item.key}"]`);
  return el !== null && el.value.trim() !== (item.current ?? '').trim();
}
const UNSAVED = 'Avevi modifiche non salvate in quel campo: sono ancora nel form. Salva o ricarica la pagina.';

// ---------------------------------------------------------------------------
// La sezione: quale proposta mostrare durante la visita
// ---------------------------------------------------------------------------

export function ProposalSection({ profile }: { profile: Profile }) {
  const pendingId = profile.pending_proposal?.id ?? null;
  // La proposta aperta all'arrivo resta sulla pagina anche chiusa, per la visita in corso (riepilogo con Annulla);
  // a un nuovo caricamento una proposta chiusa non c'è più (FLOW A.7).
  const [shownId, setShownId] = useState(pendingId);
  useEffect(() => {
    if (pendingId !== null) setShownId(pendingId);
  }, [pendingId]);
  /** Dopo "proposta non più corrente" il focus va sul titolo della nuova, o sulla card della generazione. */
  const refocusAfterStale = useRef(false);

  const query = useQuery({
    queryKey: queryKeys.proposal,
    queryFn: api.profile.proposal.get,
    enabled: shownId !== null,
    retry: false,
  });
  const view = query.data && (query.data.id === pendingId || (pendingId === null && query.data.id === shownId)) ? query.data : undefined;

  useEffect(() => {
    if (!refocusAfterStale.current || query.isFetching) return;
    if (!view) {
      refocusAfterStale.current = false;
      cardTitle('genera')?.focus();
    }
  }, [view, query.isFetching]);

  if (shownId === null) return null;
  if (!view) {
    if (query.error && !isApiError(query.error, 'no_proposal')) {
      return (
        <section className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          Proposta non caricata: {errorText(query.error)}{' '}
          <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
            Riprova
          </Button>
        </section>
      );
    }
    return null;
  }
  return <Proposal key={view.id} view={view} staleRef={refocusAfterStale} />;
}

// ---------------------------------------------------------------------------
// La proposta
// ---------------------------------------------------------------------------

type Action =
  | { kind: 'accept' | 'reject' | 'undo'; item: Item; unsaved: boolean }
  | { kind: 'edit'; item: Item; value: string; unsaved: boolean }
  | { kind: 'apply-all'; except: ItemKey[]; unsaved: boolean };

type ActionResult = { proposal: ProposalView; applied?: number; fields?: number; services?: number };

/** Dove va il focus dopo il prossimo commit. */
type FocusTarget = { type: 'item'; key: ItemKey; far?: boolean } | { type: 'title' } | { type: 'verb'; key: ItemKey; verb: string };

function Proposal({ view, staleRef }: { view: ProposalView; staleRef: MutableRefObject<boolean> }) {
  const queryClient = useQueryClient();
  const uid = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const settleRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const [ranks] = useState(() => initialRanks(view));
  const [drafts, setDrafts] = useState<Partial<Record<ItemKey, FieldEditing>>>({});
  const [errors, setErrors] = useState<Partial<Record<ItemKey, ReactNode>>>({});
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [rejectingAll, setRejectingAll] = useState(false);
  const [serviceEditing, setServiceEditing] = useState<{ key: ItemKey; editing: ProposalServiceEditing } | null>(null);
  const [slow, setSlow] = useState(false);
  const focusNext = useRef<FocusTarget | null>(null);
  /** Dove torna il focus quando si chiude il dialog del rifiuto in blocco (calcolato alla conferma). */
  const rejectReturn = useRef<FocusTarget | null>(null);
  const onStale = () => {
    staleRef.current = true;
  };
  /** Le righe da animare al prossimo commit: solo quelle di un'azione su una riga sola (M1/M2). */
  const animateKeys = useRef(new Set<ItemKey>());
  /** La proposta si è chiusa durante questa visita: il riepilogo entra (M8), al caricamento no. */
  const closedNow = useRef(false);
  const serviceReturn = useRef<() => HTMLElement | null>(() => null);

  const consumeAnimation = useCallback((key: ItemKey) => animateKeys.current.delete(key), []);

  // Ordine di lettura: i campi, poi i servizi; dentro ogni gruppo il rango iniziale, le voci comparse dopo in coda.
  const rank = (key: ItemKey) => ranks.get(key) ?? ranks.size + 1;
  const readingOrder = (items: Item[]) =>
    items.filter(isRow).sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group] || rank(a.key) - rank(b.key));
  const all = itemsOf(view);
  const rows = readingOrder(all);
  const rowsOf = (group: Item['group']) => rows.filter((i) => i.group === group);
  const unchangedOf = (group: Item['group']) => all.filter((i) => i.group === group && !isRow(i));

  const s = view.summary;
  const editingKeys = (Object.keys(drafts) as ItemKey[]).filter((k) => all.some((i) => i.key === k && !isDecided(i)));
  const editingApplicable = editingKeys.filter((k) => {
    const i = all.find((x) => x.key === k)!;
    return i.data.status === 'new' || i.data.status === 'changed';
  }).length;
  const massApply = s.applicable - editingApplicable;
  const massReject = s.to_decide - editingKeys.length;
  const showBulk = s.to_decide >= 2;

  // Deep-link `#proposta` e "Rivedi la proposta" (banner, card) anche sulla stessa pagina: focus sul titolo, mai sul
  // link. Arrivata la proposta nuova dopo "non più corrente", lo stesso (FLOW, Error paths).
  const hash = useRouterState({ select: (state) => state.location.hash });
  useEffect(() => {
    const stale = staleRef.current;
    staleRef.current = false;
    if ((hash === 'proposta' || stale) && titleRef.current) revealAndFocus(titleRef.current);
  }, [hash, staleRef]);

  // Dopo un'azione: il focus dove dice il FLOW, a confronto riletto (mai `body`).
  useLayoutEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    if (target.type === 'title') {
      if (titleRef.current) revealAndFocus(titleRef.current);
      return;
    }
    if (target.type === 'verb') {
      elementOf(target)?.focus();
      return;
    }
    const title = elementOf(target);
    if (!title) return;
    if (target.far) revealAndFocus(title);
    else {
      title.focus({ preventScroll: true });
      title.scrollIntoView({ block: 'nearest' });
    }
  }, [view, drafts]);

  // L'altezza vera della striscia sticky (a 760 px i bottoni vanno a capo): i titoli delle voci la usano come margine
  // di scorrimento, così il titolo che riceve il focus non finisce sotto la striscia.
  useLayoutEffect(() => {
    const section = sectionRef.current;
    const strip = stripRef.current;
    if (!section) return;
    const update = () => section.style.setProperty('--proposal-strip', `${strip?.offsetHeight ?? 0}px`);
    update();
    if (!strip) return;
    const observer = new ResizeObserver(update);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [view.open]);

  // Il riepilogo che entra quando la proposta si chiude adesso (M8).
  useLayoutEffect(() => {
    if (!view.open && closedNow.current && settleRef.current) {
      closedNow.current = false;
      animateSettle(settleRef.current);
    }
  }, [view.open]);

  /** Dopo una scrittura: proposta riletta in cache, profilo (valori, servizi, proposta aperta) riletto. */
  const accept = (next: ProposalView) => {
    if (view.open && !next.open) closedNow.current = true;
    queryClient.setQueryData(queryKeys.proposal, next);
    void queryClient.invalidateQueries({ queryKey: queryKeys.profile, exact: true });
  };

  /** L'elemento di un bersaglio del focus, adesso. */
  const elementOf = (target: FocusTarget | null): HTMLElement | null => {
    if (!target || target.type === 'title') return titleRef.current;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-item-key="${CSS.escape(target.key)}"]`);
    return (target.type === 'verb' ? row?.querySelector<HTMLElement>(`[data-verb="${target.verb}"]`) : row?.querySelector<HTMLElement>('h4')) ?? null;
  };

  /** La voce successiva da decidere in ordine di lettura; se non ce n'è dopo, la prima rimasta; poi il titolo. */
  const nextFocus = (next: ProposalView, after: ItemKey | null): FocusTarget => {
    const order = readingOrder(itemsOf(next));
    const open = order.filter((i) => !isDecided(i));
    if (open.length === 0) return { type: 'title' };
    const at = after === null ? -1 : order.findIndex((i) => i.key === after);
    const following = order.slice(at + 1).find((i) => !isDecided(i));
    return following ? { type: 'item', key: following.key } : { type: 'item', key: open[0]!.key, far: true };
  };

  const clearError = (key: ItemKey) =>
    setErrors((cur) => {
      if (!(key in cur)) return cur;
      const { [key]: _gone, ...rest } = cur;
      return rest;
    });

  const run = useMutation({
    mutationFn: async (a: Action): Promise<ActionResult> => {
      const p = api.profile.proposal;
      if (a.kind === 'apply-all') return p.apply(view.id, { all: true, except: a.except.length > 0 ? a.except : undefined });
      const target = targetOf(a.item);
      const expected = a.item.data.status;
      if (a.kind === 'accept') return p.apply(view.id, target, { expectedStatus: expected });
      if (a.kind === 'edit') return p.apply(view.id, target, { expectedStatus: expected, value: a.value });
      if (a.kind === 'reject') return p.reject(view.id, target, expected);
      return p.undo(view.id, target);
    },
    onMutate: () => setSlow(false),
    onSuccess: (r, a) => {
      if (a.kind === 'apply-all') {
        // Un'azione di massa riuscita supera gli errori di prima, di riga e di massa.
        setBulkError(null);
        setErrors({});
        accept(r.proposal);
        const fields = r.fields ?? 0;
        const services = r.services ?? 0;
        const parts = [fields > 0 && plural(fields, 'campo', 'campi'), services > 0 && plural(services, 'servizio', 'servizi')].filter(Boolean);
        const left = r.proposal.summary.conflicts;
        toast({
          title: `${r.applied === 1 ? 'Applicata 1 voce' : `Applicate ${r.applied} voci`}${parts.length > 0 ? `: ${parts.join(' e ')}` : ''}.${
            left > 0 ? ` ${left === 1 ? 'Resta 1 conflitto.' : `Restano ${left} conflitti.`}` : ''
          }`,
          description: a.unsaved ? UNSAVED : undefined,
        });
        setAnnouncement(`${r.applied === 1 ? 'Applicata 1 voce.' : `Applicate ${r.applied} voci.`} ${remainingText(r.proposal.summary)}`);
        const target = nextFocus(r.proposal, null);
        focusNext.current = target.type === 'item' ? { ...target, far: true } : target;
        return;
      }
      const { item } = a;
      clearError(item.key);
      animateKeys.current.add(item.key);
      if (a.kind === 'edit')
        setDrafts((cur) => {
          const { [item.key]: _done, ...rest } = cur;
          return rest;
        });
      accept(r.proposal);
      const name = nameOf(item);
      const conflict = item.data.status === 'conflict';
      const edited = itemsOf(r.proposal).find((i) => i.key === item.key)?.data.decision?.decision === 'edited';
      const what =
        a.kind === 'undo'
          ? `Di nuovo da decidere: ${name}.`
          : a.kind === 'reject'
            ? conflict
              ? `${item.group === 'fields' ? 'Hai tenuto il tuo testo' : 'Hai tenuto il tuo servizio'}: ${name}.`
              : `Rifiutato: ${name}.`
            : edited
              ? `Applicato con le tue modifiche: ${name}.`
              : `Applicato: ${name}.`;
      setAnnouncement(a.kind === 'undo' ? what : `${what} ${remainingText(r.proposal.summary)}`);
      // L'unico toast di una decisione singola: il form della card aveva testo non salvato in quel campo.
      if (a.unsaved) toast({ title: `Applicato: ${name}.`, description: UNSAVED });
      focusNext.current = a.kind === 'undo' ? { type: 'item', key: item.key } : nextFocus(r.proposal, item.key);
    },
    onError: (err, a) => {
      if (isApiError(err, 'proposal_stale')) {
        toast({ tone: 'warning', title: err.message });
        onStale();
        void queryClient.invalidateQueries({ queryKey: queryKeys.profile });
        return;
      }
      if (a.kind === 'apply-all') {
        setBulkError(`Voci non applicate: ${errorText(err)} Nessuna voce è cambiata.`);
        return;
      }
      const { item } = a;
      if (a.kind === 'edit' && (isApiError(err, 'edit_empty') || isApiError(err, 'edit_same'))) {
        setDrafts((cur) => ({ ...cur, [item.key]: { text: a.value, error: err.message } }));
        return;
      }
      if (isApiError(err, 'item_changed') || isApiError(err, 'item_decided') || isApiError(err, 'item_open')) {
        // La riga si ridisegna nel nuovo stato (o con la decisione registrata), focus sul suo titolo.
        setErrors((cur) => ({ ...cur, [item.key]: err.message }));
        focusNext.current = { type: 'item', key: item.key };
        void queryClient.invalidateQueries({ queryKey: queryKeys.proposal });
        return;
      }
      if (a.kind === 'undo' && isApiError(err, 'undo_blocked')) {
        setErrors((cur) => ({ ...cur, [item.key]: <UndoBlocked item={item} message={err.message} /> }));
        return;
      }
      // Rete o 500: la riga resta com'era, il focus resta sul bottone premuto (aria-disabled, mai disabled).
      const prefix =
        a.kind === 'undo' ? 'Decisione non annullata' : a.kind === 'reject' ? (item.data.status === 'conflict' ? 'Non tenuto' : 'Non rifiutato') : 'Non applicato';
      const message = `${prefix}: ${errorText(err)}`;
      if (a.kind === 'edit') setDrafts((cur) => ({ ...cur, [item.key]: { text: a.value, error: message } }));
      else setErrors((cur) => ({ ...cur, [item.key]: message }));
    },
  });

  // Lo spinner solo se l'attesa si sente (dopo 300 ms): in locale la risposta arriva in decine di ms.
  useEffect(() => {
    if (!run.isPending) return;
    const timer = window.setTimeout(() => setSlow(true), 300);
    return () => window.clearTimeout(timer);
  }, [run.isPending]);

  const pendingAction = run.isPending ? run.variables : undefined;
  const activity = (key: ItemKey): RowActivity => {
    const busy: Verb | null = pendingAction && pendingAction.kind !== 'apply-all' && pendingAction.item.key === key ? pendingAction.kind : null;
    return { busy, slow, locked: run.isPending || serviceEditing !== null, error: errors[key] };
  };

  const onVerb = (item: Item, verb: Exclude<Verb, 'undo'>) => {
    if (verb === 'edit') {
      if (item.group === 'fields') {
        clearError(item.key);
        setDrafts((cur) => ({ ...cur, [item.key]: { text: item.data.proposed, error: null } }));
      } else openServiceEditor(item as Extract<Item, { group: 'services' }>);
      return;
    }
    run.mutate({
      kind: verb === 'accept' ? 'accept' : 'reject',
      item,
      unsaved: verb === 'accept' && item.group === 'fields' && unsavedInForm(item.data),
    });
  };

  const openServiceEditor = (item: Extract<Item, { group: 'services' }>) => {
    const s = item.data;
    const existing = s.existing;
    // Un servizio esistente: i tuoi valori; i campi oggi vuoti già compilati con la proposta. Così salvare senza
    // toccare niente vuol dire "tieni i miei testi, prendi il resto" (FLOW C.6), e sopra resta solo ciò che li cambierebbe.
    const values: ServiceInput = existing
      ? {
          name: existing.name,
          ...Object.fromEntries(PROPOSED_SERVICE_FIELDS.map((f) => [f, existing[f] || s.proposed[f]])),
          notes: existing.notes,
        }
      : { name: s.name, ...Object.fromEntries(PROPOSED_SERVICE_FIELDS.map((f) => [f, s.proposed[f]])) };
    const proposedFields = existing ? s.changed_fields.filter((f) => existing[f]) : [];
    const editButton = () =>
      listRef.current?.querySelector<HTMLElement>(`[data-item-key="${CSS.escape(item.key)}"] [data-verb="edit"]`) ?? null;
    serviceReturn.current = editButton;
    clearError(item.key);
    setServiceEditing({
      key: item.key,
      editing: {
        mode: 'proposal',
        title: existing ? `Modifica prima di aggiornare «${existing.name}»` : 'Modifica prima di aggiungere',
        submitLabel: existing ? 'Aggiorna il servizio' : 'Aggiungi il servizio',
        values,
        proposed:
          existing && proposedFields.length > 0 ? (
            <div className="rounded-lg bg-sky-50 px-3 py-2 ring-1 ring-sky-200 ring-inset">
              <p className="mb-1 text-xs font-medium text-sky-800">
                La proposta al posto dei tuoi testi{proposedFields.length < s.changed_fields.length ? ' (i campi vuoti sono già compilati qui sotto)' : ''}
              </p>
              <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
                {proposedFields.map((f) => (
                  <div key={f} className="contents">
                    <dt className="text-xs/5 font-medium text-slate-500">{SERVICE_FIELD_LABELS[f]}</dt>
                    <dd className="text-slate-900">{s.proposed[f]}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : undefined,
        save: async (body) => {
          const r = await api.profile.proposal.apply(view.id, { service: s.name }, { expectedStatus: s.status, serviceValues: body });
          animateKeys.current.add(item.key);
          accept(r.proposal);
          setAnnouncement(`Applicato con le tue modifiche: ${s.name}. ${remainingText(r.proposal.summary)}`);
          const target = nextFocus(r.proposal, item.key);
          serviceReturn.current = () =>
            target.type === 'title'
              ? titleRef.current
              : (listRef.current?.querySelector<HTMLElement>(`[data-item-key="${CSS.escape(target.key)}"] h4`) ?? null);
        },
        onSaved: () => setServiceEditing(null),
        onError: (err) => {
          if (isApiError(err, 'proposal_stale')) {
            setServiceEditing(null);
            toast({ tone: 'warning', title: err.message });
            onStale();
            void queryClient.invalidateQueries({ queryKey: queryKeys.profile });
          } else if (isApiError(err, 'item_changed') || isApiError(err, 'item_decided') || isApiError(err, 'edit_same')) {
            void queryClient.invalidateQueries({ queryKey: queryKeys.proposal });
          }
        },
      },
    });
  };

  const applyAll = () => {
    if (run.isPending || massApply === 0) return;
    const unsaved = view.fields.some((f) => !f.decision && (f.status === 'new' || f.status === 'changed') && !editingKeys.includes(fieldKey(f)) && unsavedInForm(f));
    run.mutate({ kind: 'apply-all', except: editingKeys, unsaved });
  };

  // --- Testi della testata e della striscia -------------------------------------------------------------------
  const readSources = view.sources.filter((src) => src.outcome === 'read').length;
  const provenance = [`Da ${readSources} ${readSources === 1 ? 'fonte' : 'fonti'} su ${view.sources.length || SOURCE_COUNT}`, leftOutText(view.discarded)]
    .filter(Boolean)
    .join(' · ');
  const applyLabel =
    s.conflicts > 0 || editingKeys.length > 0
      ? s.conflicts > 0
        ? massApply === 0
          ? 'Applica le voci senza conflitto'
          : massApply === 1
            ? 'Applica la voce senza conflitto'
            : `Applica le ${massApply} voci senza conflitto`
        : massApply === 1
          ? 'Applica la voce rimasta'
          : `Applica le ${massApply} voci rimaste`
      : s.decided === 0
        ? `Applica tutte le ${massApply} voci`
        : massApply === 1
          ? 'Applica la voce rimasta'
          : `Applica le ${massApply} voci rimaste`;
  const applyDisabledReason =
    massApply > 0
      ? null
      : s.conflicts === 1
        ? 'La voce rimasta cambierebbe un testo scritto da te: decidila da sola.'
        : s.conflicts > 1
          ? `Le ${s.conflicts} voci rimaste cambierebbero testi scritti da te: decidile una per una.`
          : 'Le voci rimaste sono in modifica: applicale dalla loro riga.';
  // Un conflitto aperto in Modifica è già contato fra le voci in modifica.
  const editingConflicts = editingKeys.filter((k) => all.find((x) => x.key === k)?.data.status === 'conflict').length;
  const conflictsOut = s.conflicts - editingConflicts;
  const hints = [
    applyDisabledReason ??
      (conflictsOut === 1
        ? 'Il conflitto resta fuori: decidilo da solo.'
        : conflictsOut > 1
          ? `I ${conflictsOut} conflitti restano fuori: decidili uno per uno.`
          : null),
    editingKeys.length === 1 ? '1 voce in modifica resta fuori.' : editingKeys.length > 1 ? `${editingKeys.length} voci in modifica restano fuori.` : null,
  ].filter(Boolean);
  const withoutOrigin = s.without_origin.map((k) => PROFILE_FIELD_LABELS[k]);
  const e14 =
    withoutOrigin.length > 0
      ? `${listText(withoutOrigin)} ${withoutOrigin.length === 1 ? 'è compilato' : 'sono compilati'} da prima del ${fmtDayMonth(view.created_at)}: «${applyLabel}» ${
          withoutOrigin.length === 1 ? 'lo sostituisce' : 'li sostituisce'
        }. Il testo attuale è nella ${withoutOrigin.length === 1 ? 'sua' : 'loro'} riga.`
      : null;
  const emptyProfile = s.decided === 0 && s.conflicts === 0 && view.fields.every((f) => f.status === 'new');
  const progress = progressText(s);
  const ratio = s.total > 0 ? s.decided / s.total : 1;

  const hintId = `${uid}-hint`;
  const e14Id = `${uid}-e14`;

  // --- Riepilogo (proposta chiusa, FLOW A.7) --------------------------------------------------------------------
  const summaryParts = [
    s.applied > 0 && plural(s.applied, 'applicata', 'applicate'),
    s.edited > 0 && `${s.edited} con le tue modifiche`,
    s.rejected > 0 && plural(s.rejected, 'rifiutata', 'rifiutate'),
  ].filter(Boolean);
  const closingText = `${s.total === 1 ? 'Hai deciso la voce' : `Hai deciso tutte le ${s.total} voci`}: ${summaryParts.join(' · ')}.${
    s.unchanged > 0 ? ` ${s.unchanged === 1 ? '1 era già uguale' : `${s.unchanged} erano già uguali`} al tuo profilo.` : ''
  }`;

  return (
    <section
      ref={sectionRef}
      id="proposta"
      aria-labelledby={`${uid}-title`}
      className={cn(
        'scroll-mt-6 rounded-xl border bg-white shadow-sm ring-1 transition-[border-color,box-shadow] duration-200 ease-[ease]',
        view.open ? 'border-sky-200 ring-sky-100' : 'border-slate-200 ring-transparent',
      )}
    >
      <div className={cn('flex flex-col gap-1.5 px-4 pt-4', view.open ? 'pb-3' : 'border-b border-slate-100 pb-4')}>
        <div className="flex items-center gap-2">
          {view.open ? (
            <SparklesIcon aria-hidden="true" className="size-4 shrink-0 text-sky-600" />
          ) : (
            <CircleCheckIcon aria-hidden="true" className="size-4 shrink-0 text-emerald-600" />
          )}
          <h2
            ref={titleRef}
            id={`${uid}-title`}
            tabIndex={-1}
            className="scroll-mt-6 rounded-sm text-base font-semibold text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2"
          >
            Proposta del {dayTime(view.created_at)}
            {!view.open && <span className="font-normal text-slate-500"> · chiusa</span>}
          </h2>
        </div>
        {view.open ? (
          <>
            <p className="text-sm text-slate-600">{provenance}.</p>
            <p className="text-xs text-slate-500">
              Decidi voce per voce: Applica, Modifica o Rifiuta. Ogni decisione si annulla dalla sua riga; la proposta si chiude
              quando non resta niente da decidere.
            </p>
            {showBulk && e14 && (
              <p id={e14Id} className="mt-1 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200 ring-inset">
                {e14}
              </p>
            )}
            {showBulk && !e14 && emptyProfile && (
              <p className="text-sm text-slate-600">Non hai scritto nulla a mano in questi campi: puoi applicare tutto e correggere dopo.</p>
            )}
          </>
        ) : (
          <div ref={settleRef} className="flex flex-col gap-1.5">
            <p className="text-sm text-slate-700">{closingText}</p>
            {s.applied + s.edited > 0 && (
              <a
                href="#azienda"
                className="inline-flex w-fit items-center gap-1 text-sm font-medium text-slate-900 underline underline-offset-2"
                onClick={(event) => {
                  const title = cardTitle('azienda');
                  if (!title) return;
                  event.preventDefault();
                  revealAndFocus(title);
                }}
              >
                Vedi il profilo aggiornato
                <ArrowDownIcon aria-hidden="true" className="size-3.5" />
              </a>
            )}
          </div>
        )}
      </div>

      {view.open && (
        <div
          ref={stripRef}
          className="sticky top-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-slate-100 bg-white/95 px-4 py-2.5 supports-backdrop-filter:backdrop-blur-sm"
        >
          <div className="flex items-center gap-3">
            <p className="text-sm text-slate-700">
              <span className="font-semibold text-slate-900 tabular-nums">{progress.lead}</span>
              <span className="tabular-nums">{progress.rest}</span>
              {progress.conflicts && <span className="text-amber-800 tabular-nums">{progress.conflicts}</span>}
            </p>
            <div aria-hidden="true" className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full w-full rounded-full bg-sky-500 transition-transform duration-[250ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
                style={{ transform: `translateX(${(ratio - 1) * 100}%)` }}
              />
            </div>
          </div>
          {showBulk && (
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                aria-disabled={massApply === 0 || run.isPending || serviceEditing !== null || undefined}
                aria-busy={(pendingAction?.kind === 'apply-all') || undefined}
                aria-describedby={cn(hints.length > 0 && hintId, e14 && e14Id) || undefined}
                className={cn(massApply > 0 && !slow && 'aria-disabled:opacity-100')}
                onClick={applyAll}
              >
                {applyLabel}
              </Button>
              <Button
                type="button"
                variant="outline"
                data-reject-all
                aria-disabled={massReject === 0 || run.isPending || serviceEditing !== null || undefined}
                className={cn(massReject > 0 && !slow && 'aria-disabled:opacity-100')}
                onClick={() => {
                  if (!run.isPending && massReject > 0) setRejectingAll(true);
                }}
              >
                {massReject === 1 ? 'Rifiuta la voce da decidere…' : `Rifiuta le ${massReject} voci da decidere…`}
              </Button>
            </div>
          )}
          {/* Nella striscia: con la striscia fissata, il motivo e l'errore dell'azione di massa restano visibili. */}
          {showBulk && hints.length > 0 && (
            <p id={hintId} className="basis-full text-xs text-slate-600 sm:text-right">
              {hints.join(' ')}
            </p>
          )}
          {bulkError && (
            <p role="alert" className="basis-full text-sm text-red-700 sm:text-right">
              {bulkError}
            </p>
          )}
        </div>
      )}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <div ref={listRef} className="flex flex-col gap-6 px-4 pt-3 pb-4">
        {(['fields', 'services'] as const).map((group) => {
          const groupRows = rowsOf(group);
          const unchanged = unchangedOf(group);
          if (groupRows.length + unchanged.length === 0) return null;
          const open = groupRows.filter((i) => !isDecided(i)).length;
          const decided = groupRows.length - open;
          const title = group === 'fields' ? 'Campi del profilo' : 'Servizi';
          const counts = [
            open > 0 && `${open} da decidere`,
            decided > 0 && `${decided} ${decided === 1 ? 'deciso' : 'decisi'}`,
            unchanged.length > 0 && `${unchanged.length} ${unchanged.length === 1 ? 'invariato' : 'invariati'}`,
          ].filter(Boolean);
          return (
            <section key={group} aria-labelledby={`${uid}-${group}`} className="flex flex-col gap-2">
              <h3
                id={`${uid}-${group}`}
                className="flex flex-wrap items-baseline gap-x-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase"
              >
                {title}
                <span className="font-normal tracking-normal normal-case">· {counts.join(' · ')}</span>
              </h3>
              <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
                {groupRows.map((item) => (
                  <ItemRow key={item.key} itemKey={item.key} decided={isDecided(item)} animate={consumeAnimation}>
                    {renderItem(item)}
                  </ItemRow>
                ))}
                {unchanged.length > 0 && (
                  <UnchangedRow
                    groupName={group === 'fields' ? 'dei campi del profilo' : 'dei servizi'}
                    items={unchanged.map((i) => ({
                      name: nameOf(i),
                      value: i.group === 'fields' ? (i.data.current ?? '') : serviceValueText(i.data),
                    }))}
                  />
                )}
              </ul>
            </section>
          );
        })}
      </div>

      <RejectAllDialog
        view={view}
        count={massReject}
        except={editingKeys}
        open={rejectingAll}
        onClose={() => setRejectingAll(false)}
        onDone={(next, rejected) => {
          setRejectingAll(false);
          setBulkError(null);
          setErrors({});
          accept(next);
          toast({
            title: `${rejected === 1 ? 'Rifiutata 1 voce' : `Rifiutate ${rejected} voci`}: non è stato scritto niente.${next.open ? '' : ' La proposta è chiusa.'}`,
          });
          setAnnouncement(`${rejected === 1 ? 'Rifiutata 1 voce.' : `Rifiutate ${rejected} voci.`} ${remainingText(next.summary)}`);
          // Il focus lo rimette il dialog alla chiusura (dentro, il focus trap lo terrebbe): riepilogo o voce rimasta.
          rejectReturn.current = nextFocus(next, null);
        }}
        onStale={() => {
          setRejectingAll(false);
          onStale();
        }}
        returnFocusTo={() => {
          const target = rejectReturn.current;
          rejectReturn.current = null;
          if (target) return elementOf(target);
          return titleRef.current?.closest('section')?.querySelector<HTMLElement>('[data-reject-all]') ?? null;
        }}
      />
      <ProposalServiceDialog
        editing={serviceEditing?.editing ?? null}
        onClose={() => setServiceEditing(null)}
        returnFocusTo={() => serviceReturn.current()}
      />
    </section>
  );

  function renderItem(item: Item): ReactNode {
    const act = activity(item.key);
    if (item.group === 'fields') {
      if (item.data.decision) {
        return <DecidedItem name={nameOf(item)} phrase={fieldPhrase(item.data)} activity={act} onUndo={() => run.mutate({ kind: 'undo', item, unsaved: false })} />;
      }
      const draft = drafts[item.key] ?? null;
      return (
        <FieldPending
          item={item.data}
          proposalDate={view.created_at}
          bulk={showBulk}
          activity={act}
          editing={draft}
          onVerb={(verb) => onVerb(item, verb)}
          onEditChange={(text) => setDrafts((cur) => ({ ...cur, [item.key]: { text, error: null } }))}
          onEditSubmit={() => {
            const text = draft?.text ?? '';
            run.mutate({ kind: 'edit', item, value: text, unsaved: unsavedInForm(item.data) });
          }}
          onEditCancel={() => {
            setDrafts((cur) => {
              const { [item.key]: _gone, ...rest } = cur;
              return rest;
            });
            focusNext.current = { type: 'verb', key: item.key, verb: 'edit' };
          }}
        />
      );
    }
    if (item.data.decision) {
      return <DecidedItem name={nameOf(item)} phrase={servicePhrase(item.data)} activity={act} onUndo={() => run.mutate({ kind: 'undo', item, unsaved: false })} />;
    }
    return <ServicePending item={item.data} activity={act} onVerb={(verb) => onVerb(item, verb)} />;
  }
}

/** Un servizio invariato in una riga: "A chi serve «…» · Problema «…»". */
function serviceValueText(s: ProposalServiceItem): string {
  return PROPOSED_SERVICE_FIELDS.filter((f) => s.proposed[f] !== null)
    .map((f) => `${SERVICE_FIELD_LABELS[f]}: ${s.proposed[f]}`)
    .join(' · ');
}

/** Annulla rifiutato perché il valore è cambiato dopo la decisione: il motivo e dove si cambia adesso (FLOW, Error paths). */
function UndoBlocked({ item, message }: { item: Item; message: string }) {
  if (item.group === 'services') {
    return (
      <>
        {message}{' '}
        <a href="#servizi" className="font-medium underline">
          Vai a «I miei servizi»
        </a>
      </>
    );
  }
  const label = PROFILE_FIELD_LABELS[item.data.key];
  return (
    <>
      «{label}» è cambiato dopo che l'hai applicato: per cambiarlo usa «La mia azienda».{' '}
      <a
        href="#azienda"
        className="font-medium underline"
        onClick={(event) => {
          const field = document.querySelector<HTMLElement>(`[data-profile-field="${item.data.key}"]`);
          if (!field) return;
          event.preventDefault();
          revealAndFocus(field, 'center');
        }}
      >
        Vai al campo
      </a>
    </>
  );
}

// ---------------------------------------------------------------------------
// Rifiuta le voci da decidere, con conferma (E12, G10)
// ---------------------------------------------------------------------------

function RejectAllDialog(props: {
  view: ProposalView;
  count: number;
  except: ItemKey[];
  open: boolean;
  onClose: () => void;
  onDone: (next: ProposalView, rejected: number) => void;
  onStale: () => void;
  returnFocusTo: () => HTMLElement | null;
}) {
  const queryClient = useQueryClient();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const focus = useDialogFocusReturn(props.returnFocusTo);
  // I numeri di quando si è aperto: confermato, la proposta cambia mentre il dialog si chiude ("0 voci").
  const live = { count: props.count, conflicts: props.view.summary.conflicts, applied: props.view.summary.applied + props.view.summary.edited };
  const [snapshot, setSnapshot] = useState(live);
  useEffect(() => {
    if (props.open) setSnapshot(live);
  }, [props.open]); // solo all'apertura
  const { count, conflicts, applied } = props.open ? live : snapshot;
  const { view } = props;

  const reject = useMutation({
    mutationFn: () => api.profile.proposal.reject(view.id, { all: true, except: props.except.length > 0 ? props.except : undefined }),
    onSuccess: (r) => props.onDone(r.proposal, r.rejected),
    onError: (err) => {
      if (isApiError(err, 'proposal_stale')) {
        toast({ tone: 'warning', title: err.message });
        props.onStale();
        void queryClient.invalidateQueries({ queryKey: queryKeys.profile });
      }
    },
  });

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open && !reject.isPending) props.onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-md"
        onOpenAutoFocus={(event) => {
          focus.onOpenAutoFocus();
          event.preventDefault();
          reject.reset();
          cancelRef.current?.focus();
        }}
        onCloseAutoFocus={focus.onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>{count === 1 ? 'Rifiutare la voce da decidere?' : `Rifiutare le ${count} voci da decidere?`}</DialogTitle>
          <DialogDescription>
            Profilo e servizi restano come sono
            {conflicts > 0 ? `, ${conflicts === 1 ? 'compreso il testo in conflitto' : `compresi i ${conflicts} testi in conflitto`}` : ''}.
            {applied > 0 ? ' Le voci che hai già applicato non cambiano.' : ''} Puoi annullare ogni rifiuto
            dalla sua riga finché resti su questa pagina; dopo, per riaverle serve una nuova generazione, con la sua spesa.
          </DialogDescription>
        </DialogHeader>
        {reject.error && !isApiError(reject.error, 'proposal_stale') && (
          <p role="alert" className="text-sm text-red-700">
            Voci non rifiutate: {errorText(reject.error)}
          </p>
        )}
        <DialogFooter>
          <Button ref={cancelRef} type="button" variant="outline" disabled={reject.isPending} onClick={props.onClose}>
            Annulla
          </Button>
          <Button type="button" variant="destructive" aria-disabled={reject.isPending || undefined} aria-busy={reject.isPending || undefined} onClick={() => !reject.isPending && reject.mutate()}>
            {count === 1 ? 'Rifiuta la voce' : `Rifiuta le ${count} voci`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
