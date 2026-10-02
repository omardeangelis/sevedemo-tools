import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api, errorText, isApiError, queryKeys } from '../../api/client';
import {
  PROPOSED_SERVICE_FIELDS,
  type GenerationSource,
  type Profile,
  type ProposalApplyTarget,
  type ProposalFieldItem,
  type ProposalItemStatus,
  type ProposalServiceItem,
  type ProposalView,
  type ProposedServiceField,
} from '../../api/types';
import { fmtDayMonth } from '../../lib/dates';
import { countText } from '../../lib/format';
import { useDialogFocusReturn } from '../BulkBar';
import { toast } from '../ui/toaster';
import { dayTime, SOURCE_COUNT, SOURCE_NAMES } from './GenerateCard';
import { PROFILE_FIELD_LABELS } from './ProfileForms';

/*
 * La proposta in attesa (own-profile-services T31, FLOW A.5–A.6, C.2–C.8; E3–E10, E12, G9, G10, G-11). Sta **sopra**
 * le card che modificherebbe. Il confronto arriva dal server ricalcolato adesso (P-12): qui solo l'ordine per
 * decisione (in conflitto → nuovo → modificato → invariato), le azioni e il focus. Un conflitto ha il suo verbo
 * ("Sostituisci il tuo testo") ed è fuori da "Applica tutto" (E8, E9).
 */

const SERVICE_FIELD_LABELS: Record<ProposedServiceField, string> = {
  description: 'Descrizione',
  audience: 'A chi serve',
  problem: 'Problema',
  proof: 'Prove',
};
const ORDER: Record<ProposalItemStatus, number> = { conflict: 0, new: 1, changed: 2, unchanged: 3 };
const byDecision = <T extends { status: ProposalItemStatus }>(items: T[]) => [...items].sort((a, b) => ORDER[a.status] - ORDER[b.status]);

const plural = countText;
/** Una voce che "Applica tutto" applicherebbe: nuova o modificata, mai un conflitto (E8). */
const isApplicable = (status: ProposalItemStatus) => status === 'new' || status === 'changed';
const sourcesText = (sources: GenerationSource[]) => `da: ${sources.map((s) => SOURCE_NAMES[s]).join(', ')}`;

/** Chiave di una voce: per il focus dopo un'applicazione e per "Applicato ora". */
type ItemKey = `field:${string}` | `service:${string}`;
const fieldKey = (f: ProposalFieldItem): ItemKey => `field:${f.key}`;
const serviceKey = (s: ProposalServiceItem): ItemKey => `service:${s.name}`;

/**
 * Quando la sezione sparisce (applicato tutto, scartata) il bottone premuto sparisce con lei: il focus va al titolo di
 * una card che resta, mai `body` (G9, lezione di TD-4).
 */
function cardTitle(anchor: 'azienda' | 'genera'): HTMLElement | null {
  const title = document.getElementById(anchor)?.closest('section')?.querySelector<HTMLElement>('h2') ?? null;
  if (title) title.tabIndex = -1;
  return title;
}

/** La proposta non è più in attesa: il profilo lo sa subito (nessuna rilettura della proposta che risponderebbe 404). */
function forgetProposal(queryClient: ReturnType<typeof useQueryClient>): void {
  queryClient.setQueryData<Profile>(queryKeys.profile, (profile) => (profile ? { ...profile, pending_proposal: null } : profile));
  queryClient.removeQueries({ queryKey: queryKeys.proposal });
}

/** Testo non salvato nel form della card per quel campo (FLOW, "Campo in modifica mentre applichi"). */
function unsavedInForm(item: ProposalFieldItem): boolean {
  const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-profile-field="${item.key}"]`);
  return el !== null && el.value.trim() !== (item.current ?? '').trim();
}

export function ProposalSection({ profile }: { profile: Profile }) {
  const pending = profile.pending_proposal;
  const query = useQuery({
    queryKey: queryKeys.proposal,
    queryFn: api.profile.proposal.get,
    enabled: pending !== null,
    retry: false,
  });
  if (!pending) return null;
  // La proposta è cambiata (rigenerata altrove): si aspetta la lettura nuova invece di mostrare la vecchia.
  const view = query.data && query.data.id === pending.id ? query.data : undefined;
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
  return <Proposal key={view.id} view={view} />;
}

function Proposal({ view }: { view: ProposalView }) {
  const queryClient = useQueryClient();
  const uid = useId();
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [appliedNow, setAppliedNow] = useState<ReadonlySet<ItemKey>>(new Set());
  const [announcement, setAnnouncement] = useState('');
  const [discarding, setDiscarding] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const discardRef = useRef<HTMLButtonElement>(null);
  /** Dopo un'applicazione il focus va alla voce successiva da decidere (o al titolo), a confronto riletto. */
  const refocus = useRef(false);

  // Deep-link `/settings/profile#proposta` (JobBanner, "Rivedi la proposta"): la sezione arriva dopo il caricamento.
  useEffect(() => {
    if (window.location.hash === '#proposta') document.getElementById('proposta')?.scrollIntoView();
  }, []);

  useLayoutEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    (listRef.current?.querySelector<HTMLElement>('[data-decide="true"] h4') ?? document.getElementById(`${uid}-title`))?.focus();
  }, [view, uid]);

  const fields = byDecision(view.fields);
  const services = byDecision(view.services);
  const decidable = (status: ProposalItemStatus) => status !== 'unchanged';
  const visible = <T extends { status: ProposalItemStatus }>(items: T[], key: (i: T) => ItemKey) =>
    items.filter((i) => showUnchanged || decidable(i.status) || appliedNow.has(key(i)));

  const readSources = view.sources.filter((s) => s.outcome === 'read').length;
  const { to_review, conflicts, unchanged, filled_without_origin } = view.summary;
  // Sotto il titolo con la data: da dove viene e cosa resta da decidere (FLOW C.2).
  const header = [
    `Da ${readSources} ${readSources === 1 ? 'fonte' : 'fonti'} su ${view.sources.length || SOURCE_COUNT}`,
    plural(to_review, 'voce da rivedere', 'voci da rivedere'),
    ...(conflicts > 0 ? [plural(conflicts, 'conflitto', 'conflitti')] : []),
    ...(unchanged > 0 ? [`${unchanged} ${unchanged === 1 ? 'invariata nascosta' : 'invariate nascoste'}`] : []),
    ...(view.discarded.length > 0 ? [plural(view.discarded.length, 'voce scartata', 'voci scartate')] : []),
  ].join(' · ');
  const everythingNew = view.fields.every((f) => f.status === 'new') && conflicts === 0;

  const apply = useMutation({
    mutationFn: (vars: { target: ProposalApplyTarget; expected?: ProposalItemStatus; key?: ItemKey; label: string; unsaved: boolean }) =>
      api.profile.proposal.apply(view.id, vars.target, vars.expected),
    onSuccess: (result, vars) => {
      // Niente più da decidere: prima il focus sul titolo della card che ha ricevuto i valori (A.6), poi la sezione sparisce.
      if (!result.proposal) cardTitle('azienda')?.focus();
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile, exact: true });
      if (result.proposal) queryClient.setQueryData(queryKeys.proposal, result.proposal);
      else forgetProposal(queryClient);
      const left =
        result.conflicts_left === 0
          ? ''
          : result.conflicts_left === 1
            ? ' Resta 1 voce in conflitto.'
            : ` Restano ${result.conflicts_left} voci in conflitto.`;
      const unsavedTail = vars.unsaved ? ' Avevi modifiche non salvate in quel campo: sono ancora nel form. Salva o ricarica la pagina.' : '';
      if ('all' in vars.target) {
        const conflictsText = result.conflicts_left > 0 ? ` · ${plural(result.conflicts_left, 'conflitto non toccato', 'conflitti non toccati')}` : '';
        toast({ title: `${result.applied === 1 ? 'Applicata 1 voce' : `Applicate ${result.applied} voci`}${conflictsText}.`, description: unsavedTail.trim() || undefined });
        setAppliedNow(
          new Set([
            ...view.fields.filter((f) => isApplicable(f.status)).map(fieldKey),
            ...view.services.filter((s) => isApplicable(s.status)).map(serviceKey),
          ]),
        );
      } else {
        toast({ title: `Applicato: ${vars.label}.`, description: unsavedTail.trim() || undefined });
        if (vars.key) setAppliedNow((cur) => new Set([...cur, vars.key!]));
      }
      setAnnouncement(`${'all' in vars.target ? `Applicate ${result.applied} voci.` : `Applicato: ${vars.label}.`}${left}`);
      refocus.current = result.proposal !== null;
    },
    onError: (err, vars) => {
      if (isApiError(err, 'proposal_stale')) {
        toast({ tone: 'warning', title: err.message });
        void queryClient.invalidateQueries({ queryKey: queryKeys.profile });
        return;
      }
      if (isApiError(err, 'item_changed')) void queryClient.invalidateQueries({ queryKey: queryKeys.proposal });
      else if (!vars.key) toast({ tone: 'error', title: 'Proposta non applicata', description: errorText(err) });
    },
  });

  /** L'errore dell'ultima applicazione, accanto alla sua riga (una sola applicazione alla volta). */
  const rowError = (key: ItemKey): string | undefined => {
    const err = apply.error;
    if (!err || apply.variables?.key !== key || isApiError(err, 'proposal_stale')) return undefined;
    return isApiError(err, 'item_changed') ? err.message : `Non applicato: ${errorText(err)}`;
  };

  const applyField = (item: ProposalFieldItem) =>
    apply.mutate({
      target: { field: item.key },
      expected: item.status,
      key: fieldKey(item),
      label: PROFILE_FIELD_LABELS[item.key],
      unsaved: unsavedInForm(item),
    });
  const applyService = (item: ProposalServiceItem) =>
    apply.mutate({ target: { service: item.name }, expected: item.status, key: serviceKey(item), label: item.name, unsaved: false });
  const applyAll = () =>
    apply.mutate({
      target: { all: true },
      label: 'tutto',
      unsaved: view.fields.some((f) => isApplicable(f.status) && unsavedInForm(f)),
    });

  const allHintId = `${uid}-all-hint`;
  const allReasonId = `${uid}-all-reason`;
  const allDisabled = view.apply_all.disabled_reason !== null;
  const allHint =
    conflicts > 0
      ? `Applica solo le ${view.apply_all.count} voci che non hai scritto a mano. I ${plural(conflicts, 'conflitto resta', 'conflitti restano')} da decidere uno per uno.`
      : `Applica le ${plural(view.apply_all.count, 'voce non scritta', 'voci non scritte')} a mano. Nessun conflitto da decidere.`;

  const fieldCounts = groupCounts(view.fields);
  const serviceCounts = groupCounts(view.services);

  return (
    <section
      id="proposta"
      aria-labelledby={`${uid}-title`}
      className="scroll-mt-6 rounded-xl border border-sky-200 bg-white shadow-sm ring-1 ring-sky-100"
    >
      <header className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3">
        <h2 id={`${uid}-title`} tabIndex={-1} className="text-sm font-semibold text-slate-900">
          Proposta del {dayTime(view.created_at)}
        </h2>
        <p className="text-sm text-slate-600">{header}.</p>
        {filled_without_origin > 0 ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200 ring-inset">
            {plural(filled_without_origin, 'campo è già compilato', 'campi sono già compilati')}: Applica tutto{' '}
            {filled_without_origin === 1 ? 'lo sostituisce' : 'li sostituisce'}. Il testo attuale è qui sopra ogni proposta.
          </p>
        ) : (
          everythingNew && (
            <p className="text-sm text-slate-600">Non hai scritto nulla a mano in questi campi: puoi applicare tutto e correggere dopo.</p>
          )
        )}
        <div className="flex flex-wrap items-start gap-2">
          <div className="flex flex-col items-start gap-1">
            <Button
              type="button"
              onClick={applyAll}
              disabled={allDisabled || apply.isPending}
              aria-busy={apply.isPending && 'all' in (apply.variables?.target ?? {})}
              aria-describedby={allDisabled ? allReasonId : allHintId}
            >
              Applica tutto
            </Button>
            {allDisabled ? (
              <p id={allReasonId} className="max-w-md text-xs text-slate-600">
                {view.apply_all.disabled_reason}
              </p>
            ) : (
              <p id={allHintId} className="max-w-md text-xs text-slate-500">
                {allHint}
              </p>
            )}
          </div>
          <Button ref={discardRef} type="button" variant="outline" onClick={() => setDiscarding(true)}>
            Scarta la proposta…
          </Button>
          {unchanged > 0 && (
            <Button type="button" variant="ghost" aria-expanded={showUnchanged} onClick={() => setShowUnchanged((v) => !v)}>
              {showUnchanged ? `Nascondi le ${unchanged} voci invariate` : `Mostra le ${plural(unchanged, 'voce invariata', 'voci invariate')}`}
            </Button>
          )}
        </div>
        <p className="text-xs text-slate-500">Una voce che non applichi resta qui finché non la scarti o non generi di nuovo.</p>
        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>
      </header>

      <div ref={listRef} className="flex flex-col gap-4 px-4 py-4">
        {view.fields.length > 0 && (
          <Group id={`${uid}-fields`} title={`Campi del profilo (${fieldCounts})`}>
            {visible(fields, fieldKey).map((item) => (
              <FieldRow
                key={item.key}
                item={item}
                appliedNow={appliedNow.has(fieldKey(item))}
                error={rowError(fieldKey(item))}
                busy={apply.isPending && apply.variables?.key === fieldKey(item)}
                disabled={apply.isPending}
                onApply={() => applyField(item)}
              />
            ))}
          </Group>
        )}
        {view.services.length > 0 && (
          <Group id={`${uid}-services`} title={`Servizi (${serviceCounts})`}>
            {visible(services, serviceKey).map((item) => (
              <ServiceRow
                key={item.name}
                item={item}
                appliedNow={appliedNow.has(serviceKey(item))}
                error={rowError(serviceKey(item))}
                busy={apply.isPending && apply.variables?.key === serviceKey(item)}
                disabled={apply.isPending}
                onApply={() => applyService(item)}
              />
            ))}
          </Group>
        )}
      </div>

      <DiscardDialog view={view} open={discarding} onClose={() => setDiscarding(false)} returnFocusTo={() => discardRef.current} />
    </section>
  );
}

/** "2 da rivedere · 4 invariati" / "1 nuovo · 1 in conflitto · 2 invariati". */
function groupCounts(items: Array<{ status: ProposalItemStatus }>): string {
  const n = (s: ProposalItemStatus) => items.filter((i) => i.status === s).length;
  return [
    n('conflict') > 0 && `${n('conflict')} in conflitto`,
    n('new') > 0 && `${n('new')} ${n('new') === 1 ? 'nuovo' : 'nuovi'}`,
    n('changed') > 0 && `${n('changed')} ${n('changed') === 1 ? 'modificato' : 'modificati'}`,
    n('unchanged') > 0 && `${n('unchanged')} ${n('unchanged') === 1 ? 'invariato' : 'invariati'}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

function Group({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h3 id={id} tabIndex={-1} className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
        {title}
      </h3>
      <ul className="flex flex-col divide-y divide-slate-100 rounded-lg border border-slate-200">{children}</ul>
    </section>
  );
}

function statusText(status: ProposalItemStatus, origin?: { at: string | null }): string {
  if (status === 'new') return 'Nuovo';
  if (status === 'changed') return 'Modificato';
  if (status === 'unchanged') return 'Invariato';
  return `In conflitto con ciò che hai scritto a mano${origin?.at ? ` · scritto da te il ${fmtDayMonth(origin.at)}` : ''}`;
}

interface RowProps<T> {
  item: T;
  appliedNow: boolean;
  error?: string;
  busy: boolean;
  disabled: boolean;
  onApply: () => void;
}

function RowShell(props: { decide: boolean; title: ReactNode; meta: string; children: ReactNode; actions?: ReactNode; error?: string }) {
  const id = useId();
  return (
    <li data-decide={props.decide ? 'true' : undefined}>
      <article aria-labelledby={id} className="flex flex-col gap-2 px-3 py-3 text-sm">
        <h4 id={id} tabIndex={-1} className="font-medium text-slate-900">
          {props.title}
        </h4>
        <p className="text-xs text-slate-500">{props.meta}</p>
        {props.children}
        {props.error && (
          <p role="alert" className="text-sm text-red-700">
            {props.error}
          </p>
        )}
        {props.actions && <div className="flex flex-col items-start gap-1">{props.actions}</div>}
      </article>
    </li>
  );
}

function NowAndProposed({ now, proposed }: { now: string | null; proposed: string }) {
  return (
    <dl className="flex flex-col gap-1.5">
      <div>
        <dt className="text-xs font-medium text-slate-500">Ora</dt>
        <dd className="whitespace-pre-line text-slate-700">{now ?? <span className="text-slate-400">vuoto</span>}</dd>
      </div>
      <div className="border-l-2 border-sky-300 pl-2">
        <dt className="text-xs font-medium text-slate-500">Proposta</dt>
        <dd className="whitespace-pre-line text-slate-900">{proposed}</dd>
      </div>
    </dl>
  );
}

function FieldRow({ item, appliedNow, error, busy, disabled, onApply }: RowProps<ProposalFieldItem>) {
  const label = PROFILE_FIELD_LABELS[item.key];
  const done = appliedNow && item.status === 'unchanged';
  const decide = item.status !== 'unchanged';
  return (
    <RowShell
      decide={decide}
      title={
        <>
          {label} · {done ? 'Applicato ora' : statusText(item.status, { at: item.current_origin_at })}
        </>
      }
      meta={sourcesText(item.sources)}
      error={error}
      actions={
        decide && (
          <>
            <Button type="button" size="sm" variant={item.status === 'conflict' ? 'outline' : 'default'} onClick={onApply} disabled={disabled} aria-busy={busy}>
              {item.status === 'conflict' ? 'Sostituisci il tuo testo' : 'Applica'}
            </Button>
            {item.status === 'conflict' && <p className="text-xs text-slate-500">Fuori da «Applica tutto». Il tuo testo non si recupera.</p>}
          </>
        )
      }
    >
      {!done && <NowAndProposed now={item.current} proposed={item.proposed} />}
    </RowShell>
  );
}

function ServiceRow({ item, appliedNow, error, busy, disabled, onApply }: RowProps<ProposalServiceItem>) {
  const done = appliedNow && item.status === 'unchanged';
  const decide = item.status !== 'unchanged';
  const fields = PROPOSED_SERVICE_FIELDS.filter((f) => item.proposed[f] !== null);
  const unchangedFields = PROPOSED_SERVICE_FIELDS.filter((f) => !item.changed_fields.includes(f));
  const meta = [
    item.status === 'changed' || item.status === 'conflict' ? `${item.changed_fields.length} campi su 4` : null,
    item.status === 'conflict' && item.existing ? `scritto da te il ${fmtDayMonth(item.existing.origin_at)}` : null,
    sourcesText(item.sources),
  ]
    .filter(Boolean)
    .join(' · ');
  const verb = item.status === 'new' ? 'Aggiungi questo servizio' : item.status === 'conflict' ? 'Sostituisci con la proposta' : 'Aggiorna il servizio';
  return (
    <RowShell
      decide={decide}
      title={
        <>
          {item.name} · {done ? 'Applicato ora' : item.status === 'conflict' ? 'In conflitto' : statusText(item.status)}
        </>
      }
      meta={meta}
      error={error}
      actions={
        decide && (
          <>
            <Button type="button" size="sm" variant={item.status === 'conflict' ? 'outline' : 'default'} onClick={onApply} disabled={disabled} aria-busy={busy}>
              {verb}
            </Button>
            {item.status === 'new' && <p className="text-xs text-slate-500">Si aggiunge in fondo: l'ordine lo decidi tu.</p>}
            {item.status === 'conflict' && <p className="text-xs text-slate-500">Fuori da «Applica tutto». I campi proposti sostituiscono i tuoi.</p>}
          </>
        )
      }
    >
      {item.existing && item.existing.name !== item.name && (
        <p className="text-xs text-slate-600">
          Corrisponde al tuo servizio «{item.existing.name}» (il confronto ignora maiuscole e spazi). Il nome resta il tuo.
        </p>
      )}
      {item.status === 'new' ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {fields.map((f) => (
            <div key={f} className="contents">
              <dt className="text-xs font-medium text-slate-500">{SERVICE_FIELD_LABELS[f]}</dt>
              <dd className="text-slate-800">{item.proposed[f]}</dd>
            </div>
          ))}
        </dl>
      ) : (
        decide && (
          <>
            {item.changed_fields.map((f) => (
              <div key={f}>
                <p className="text-xs font-semibold text-slate-600">{SERVICE_FIELD_LABELS[f]}</p>
                <NowAndProposed now={item.existing?.[f] ?? null} proposed={item.proposed[f]!} />
              </div>
            ))}
            <p className="text-xs text-slate-500">
              Invariati: nome{unchangedFields.length > 0 ? `, ${unchangedFields.map((f) => SERVICE_FIELD_LABELS[f].toLowerCase()).join(', ')}` : ''}. I
              campi che la proposta non nomina restano come sono.
            </p>
          </>
        )
      )}
    </RowShell>
  );
}

// ---------------------------------------------------------------------------
// Scarta, con conferma (E12, G10)
// ---------------------------------------------------------------------------

function DiscardDialog(props: { view: ProposalView; open: boolean; onClose: () => void; returnFocusTo: () => HTMLElement | null }) {
  const queryClient = useQueryClient();
  const cancelRef = useRef<HTMLButtonElement>(null);
  /** Scartata: il bottone che ha aperto il dialog sparisce con la sezione, il focus va al titolo della generazione. */
  const discarded = useRef(false);
  const focus = useDialogFocusReturn(() => (discarded.current ? cardTitle('genera') : props.returnFocusTo()));
  const toDecide = props.view.summary.to_review + props.view.summary.conflicts;

  const discard = useMutation({
    mutationFn: () => api.profile.proposal.discard(props.view.id),
    onSuccess: () => {
      discarded.current = true;
      props.onClose();
      forgetProposal(queryClient);
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile, exact: true });
      toast({ title: 'Proposta scartata. Il profilo non è cambiato.' });
    },
    onError: (err) => {
      if (isApiError(err, 'proposal_stale')) {
        props.onClose();
        toast({ tone: 'warning', title: err.message });
        void queryClient.invalidateQueries({ queryKey: queryKeys.profile });
      }
    },
  });

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open && !discard.isPending) props.onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          focus.onOpenAutoFocus();
          event.preventDefault();
          cancelRef.current?.focus();
        }}
        onCloseAutoFocus={focus.onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>Scartare la proposta del {fmtDayMonth(props.view.created_at)}?</DialogTitle>
          <DialogDescription>
            Spariscono {toDecide === 1 ? 'la voce non applicata' : `le ${toDecide} voci non applicate`}. Profilo e servizi non cambiano.
            Per riaverla serve una nuova generazione, con la sua spesa.
          </DialogDescription>
        </DialogHeader>
        {discard.error && !isApiError(discard.error, 'proposal_stale') && (
          <p role="alert" className="text-sm text-red-700">
            Proposta non scartata: {errorText(discard.error)}
          </p>
        )}
        <DialogFooter>
          <Button ref={cancelRef} type="button" variant="outline" disabled={discard.isPending} onClick={props.onClose}>
            Annulla
          </Button>
          <Button type="button" variant="destructive" disabled={discard.isPending} aria-busy={discard.isPending} onClick={() => discard.mutate()}>
            {discard.isPending ? 'Scarto…' : 'Scarta la proposta'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
