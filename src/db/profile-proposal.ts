import type { DiscardedItem, ProposedService, ProposedValue } from '../profile/generate.js';
import type { GenerationSource } from '../profile/sources.js';
import { cleanText, jsonObject, serviceNameKey } from '../util/fields.js';
import { db, nowIso } from './index.js';
import {
  applyProfileValues,
  PROFILE_FIELD_KEYS,
  readProfileFields,
  restoreProfileValue,
  saveProfileByHand,
  type ProfileFieldKey,
  type ProfileValue,
} from './profile.js';
import type { FieldOrigin } from './schema.js';
import {
  createService,
  deleteService,
  getService,
  listServices,
  restoreService,
  SERVICE_TEXT_FIELDS,
  updateService,
  type Service,
  type ServiceTextField,
} from './services.js';

/*
 * La proposta di profilo e servizi (own-profile-services T27–T28, rivista il 2026-10-03: FLOW C e "Cosa chiede al
 * server la revisione"). La riga di `profile_proposals` conserva ciò che il modello ha proposto e, in `decisions`, le
 * decisioni dell'utente voce per voce. Una voce **da decidere** ha lo stato ricalcolato a ogni lettura contro i valori
 * di oggi (P-12): nuova, modificata, invariata, in conflitto con ciò che l'utente ha scritto a mano. Una voce
 * **decisa** è il ricordo di un gesto — applicata, applicata con le modifiche dell'utente, rifiutata — con il valore
 * di prima, per "prima: …" e per Annulla. "Aperta" è derivata: resta almeno una voce da decidere. Ogni scrittura passa
 * da una transazione e restituisce la proposta riletta; niente si scrive da sé (H3).
 */

export const ITEM_STATUSES = ['new', 'changed', 'unchanged', 'conflict'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

/** Come si è chiusa una voce: applicata com'era, applicata con le modifiche dell'utente (scritta a mano), rifiutata. */
export const DECISIONS = ['applied', 'edited', 'rejected'] as const;
export type Decision = (typeof DECISIONS)[number];

/** Campi di un servizio che la proposta può nominare (le note restano dell'utente). */
export const PROPOSED_SERVICE_FIELDS = ['description', 'audience', 'problem', 'proof'] as const;
export type ProposedServiceField = (typeof PROPOSED_SERVICE_FIELDS)[number];

/** Un servizio come lo ricorda una decisione: ciò che Annulla controlla e rimette. */
export type ServiceSnapshot = Pick<Service, 'id' | 'name' | ServiceTextField | 'origin' | 'origin_at'>;
type ServiceValueKey = 'name' | ServiceTextField;
const SERVICE_VALUE_KEYS: readonly ServiceValueKey[] = ['name', ...SERVICE_TEXT_FIELDS];

interface DecisionBase {
  decision: Decision;
  at: string;
  /** Lo stato della voce quando è stata decisa: il rifiuto di un conflitto è "hai tenuto il tuo testo". */
  status: ItemStatus;
}

export interface FieldDecision extends DecisionBase {
  /** Il valore scritto; `null` per un rifiuto. */
  value: string | null;
  /** Il valore di prima, con la sua provenienza. */
  before: ProfileValue;
}

export interface ServiceDecision extends DecisionBase {
  /** Il servizio prima della decisione; `null` se non esisteva. */
  before: ServiceSnapshot | null;
  /** Il servizio dopo la scrittura; `null` per un rifiuto. */
  after: ServiceSnapshot | null;
  /** Nome e campi che la scrittura ha cambiato ("aggiornato: descrizione, a chi serve"). */
  changed: ServiceValueKey[];
}

export interface ProposalFieldItem {
  key: ProfileFieldKey;
  /** Ricalcolato adesso per una voce da decidere; quello del momento della decisione per una decisa. */
  status: ItemStatus;
  current: string | null;
  current_origin: FieldOrigin | null;
  current_origin_at: string | null;
  proposed: string;
  sources: GenerationSource[];
  decision: FieldDecision | null;
}

export interface ProposalServiceItem {
  /** Il nome proposto: è la chiave del confronto, a meno di maiuscole e spazi (B10). */
  name: string;
  status: ItemStatus;
  /** Il servizio dell'utente con lo stesso nome normalizzato, se c'è. */
  existing: Service | null;
  proposed: Record<ProposedServiceField, string | null>;
  /** Campi proposti diversi da quelli di oggi (per un servizio nuovo: quelli proposti). */
  changed_fields: ProposedServiceField[];
  sources: GenerationSource[];
  decision: ServiceDecision | null;
}

export interface ProposalSourceOutcome {
  kind: GenerationSource;
  outcome: string;
  reused: boolean;
  read_at: string | null;
  reason: string | null;
}

export interface ProposalSummary {
  /** Voci decise + voci da decidere: il "di 6" di "Decise 4 di 6". Le invariate non contano. */
  total: number;
  decided: number;
  /** Nuove, modificate e in conflitto non ancora decise. */
  to_decide: number;
  /** Conflitti non ancora decisi. */
  conflicts: number;
  /** Nuove e modificate non ancora decise: ciò che l'azione di massa applicherebbe (E8). */
  applicable: number;
  /** Voci da decidere uguali al profilo di oggi (nascoste, contate e nominate). */
  unchanged: number;
  applied: number;
  edited: number;
  rejected: number;
  /** Campi da decidere compilati senza provenienza che l'azione di massa sostituirebbe (G-11, E14). */
  without_origin: ProfileFieldKey[];
}

export interface ProposalView {
  id: number;
  job_id: number | null;
  model: string;
  created_at: string;
  /** Almeno una voce da decidere. Chiusa, la proposta non è più "in attesa" ma resta l'ultima (E11). */
  open: boolean;
  /** Esito di ogni fonte alla generazione (G5). */
  sources: ProposalSourceOutcome[];
  /** Voci lasciate fuori dal sistema (E6): senza fonte, nome già proposto, … */
  discarded: DiscardedItem[];
  fields: ProposalFieldItem[];
  services: ProposalServiceItem[];
  summary: ProposalSummary;
  apply_all: { count: number; disabled_reason: string | null };
}

export const NO_PROPOSAL = 'Nessuna proposta in attesa.';
const NOTHING_TO_APPLY = 'Niente da applicare: non resta nessuna voce da decidere.';
const conflictsOnly = (n: number) =>
  n === 1
    ? 'La voce rimasta cambierebbe un testo scritto da te: decidila da sola.'
    : `Le ${n} voci rimaste cambierebbero testi scritti da te: decidile una per una.`;

interface ProposalRow {
  id: number;
  job_id: number | null;
  model: string;
  created_at: string;
  fields: Partial<Record<string, ProposedValue>>;
  services: ProposedService[];
  sources: ProposalSourceOutcome[];
  discarded: DiscardedItem[];
  decisions: Record<string, FieldDecision | ServiceDecision>;
}

const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? '').trim() === (b ?? '').trim();

/** Chiave di una voce in `decisions` e in `except`: `field:<campo>` o `service:<nome proposto>`. */
export const fieldItemKey = (key: ProfileFieldKey) => `field:${key}`;
export const serviceItemKey = (name: string) => `service:${name}`;

function parseArray<T>(text: string): T[] {
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
}

/** L'ultima proposta così come è stata salvata, `undefined` se non c'è. */
function proposalRow(): ProposalRow | undefined {
  const row = db.prepare(`SELECT * FROM profile_proposals ORDER BY id DESC LIMIT 1`).get() as
    | (Omit<ProposalRow, 'fields' | 'services' | 'sources' | 'discarded' | 'decisions'> &
        Record<'fields' | 'services' | 'sources' | 'discarded' | 'decisions', string>)
    | undefined;
  if (!row) return undefined;
  // Una colonna illeggibile vale come proposta senza campi (o senza decisioni).
  return {
    id: row.id,
    job_id: row.job_id,
    model: row.model,
    created_at: row.created_at,
    fields: jsonObject(row.fields) as ProposalRow['fields'],
    services: parseArray<ProposedService>(row.services),
    sources: parseArray<ProposalSourceOutcome>(row.sources),
    discarded: parseArray<DiscardedItem>(row.discarded),
    decisions: jsonObject(row.decisions) as ProposalRow['decisions'],
  };
}

function fieldItems(row: ProposalRow): ProposalFieldItem[] {
  const fields = readProfileFields();
  return PROFILE_FIELD_KEYS.flatMap((key): ProposalFieldItem[] => {
    const proposed = row.fields[key];
    if (!proposed) return [];
    const current = fields[key];
    const decision = (row.decisions[fieldItemKey(key)] as FieldDecision | undefined) ?? null;
    const status: ItemStatus =
      decision?.status ??
      (current.value === null ? 'new' : same(current.value, proposed.value) ? 'unchanged' : current.origin === 'manual' ? 'conflict' : 'changed');
    return [
      {
        key,
        status,
        current: current.value,
        current_origin: current.origin,
        current_origin_at: current.origin_at,
        proposed: proposed.value,
        sources: proposed.sources,
        decision,
      },
    ];
  });
}

/** Il servizio dell'utente che la voce proposta descrive (stesso nome a meno di maiuscole e spazi). */
function matchingService(name: string, services: readonly Service[]): Service | null {
  const key = serviceNameKey(name);
  return services.find((s) => serviceNameKey(s.name) === key) ?? null;
}

function serviceItems(row: ProposalRow): ProposalServiceItem[] {
  const services = listServices();
  return row.services.map((s) => {
    const existing = matchingService(s.name, services);
    const proposed = Object.fromEntries(PROPOSED_SERVICE_FIELDS.map((f) => [f, s[f] ?? null])) as ProposalServiceItem['proposed'];
    const changed_fields = PROPOSED_SERVICE_FIELDS.filter((f) => proposed[f] !== null && !same(proposed[f], existing?.[f]));
    const decision = (row.decisions[serviceItemKey(s.name)] as ServiceDecision | undefined) ?? null;
    const status: ItemStatus =
      decision?.status ??
      (existing === null ? 'new' : changed_fields.length === 0 ? 'unchanged' : existing.origin === 'manual' ? 'conflict' : 'changed');
    return { name: s.name, status, existing, proposed, changed_fields, sources: s.sources, decision };
  });
}

const applicable = (status: ItemStatus) => status === 'new' || status === 'changed';
const decidable = (status: ItemStatus) => status !== 'unchanged';

function viewOf(row: ProposalRow): ProposalView {
  const fields = fieldItems(row);
  const services = serviceItems(row);
  const all = [...fields, ...services];
  const open = all.filter((i) => i.decision === null);
  const count = (status: ItemStatus) => open.filter((i) => i.status === status).length;
  const decided = all.filter((i) => i.decision !== null);
  const by = (decision: Decision) => decided.filter((i) => i.decision!.decision === decision).length;
  const toDecide = open.filter((i) => decidable(i.status)).length;
  const applicableCount = count('new') + count('changed');
  const conflicts = count('conflict');
  return {
    id: row.id,
    job_id: row.job_id,
    model: row.model,
    created_at: row.created_at,
    open: toDecide > 0,
    sources: row.sources,
    discarded: row.discarded,
    fields,
    services,
    summary: {
      total: decided.length + toDecide,
      decided: decided.length,
      to_decide: toDecide,
      conflicts,
      applicable: applicableCount,
      unchanged: count('unchanged'),
      applied: by('applied'),
      edited: by('edited'),
      rejected: by('rejected'),
      without_origin: fields.filter((f) => f.decision === null && f.status === 'changed' && f.current_origin === null).map((f) => f.key),
    },
    apply_all: {
      count: applicableCount,
      disabled_reason: applicableCount > 0 ? null : conflicts > 0 ? conflictsOnly(conflicts) : NOTHING_TO_APPLY,
    },
  };
}

/** L'ultima proposta, aperta o chiusa, con il confronto di adesso; `undefined` se non ce n'è nessuna. */
export function readProposal(): ProposalView | undefined {
  const row = proposalRow();
  return row ? viewOf(row) : undefined;
}

export interface ProposalState {
  /** La proposta aperta (resta una voce da decidere), `null` se non c'è: sezione Proposta, avviso dell'anteprima. */
  pending_proposal: { id: number; created_at: string; model: string; to_decide: number; conflicts: number } | null;
  /** L'ultima proposta, aperta o chiusa, per la frase d'esito della card della generazione (FLOW E.1). */
  last_proposal: { id: number; job_id: number | null; created_at: string; model: string; open: boolean; summary: ProposalSummary } | null;
}

/** Proposta aperta e ultima proposta: la parte di `GET /api/profile` che viene dalla proposta (B7). */
export function proposalState(): ProposalState {
  const view = readProposal();
  if (!view) return { pending_proposal: null, last_proposal: null };
  const { id, job_id, created_at, model, open, summary } = view;
  return {
    pending_proposal: open ? { id, created_at, model, to_decide: summary.to_decide, conflicts: summary.conflicts } : null,
    last_proposal: { id, job_id, created_at, model, open, summary },
  };
}

/** La proposta aperta, `null` se non c'è (o se è tutta decisa). */
export function pendingProposal(): ProposalState['pending_proposal'] {
  return proposalState().pending_proposal;
}

// ---------------------------------------------------------------------------
// Decisioni: applica (anche con le modifiche dell'utente), rifiuta, annulla
// ---------------------------------------------------------------------------

/** Una voce sola: un campo, o un servizio per il nome proposto. */
export type ItemTarget = { field: ProfileFieldKey } | { service: string };
/** Una voce, o tutte quelle da decidere tranne `except` (chiavi `field:…` / `service:…`: le voci aperte in Modifica). */
export type Target = ItemTarget | { all: true; except?: string[] };

/** I valori del dialog dei servizi ("Modifica…" di un servizio): scritti a mano. */
export type ServiceEdit = { name: string } & Partial<Record<ServiceTextField, string | null>>;

/** La proposta vista dal client non è più l'ultima (rigenerata altrove). */
export class ProposalStaleError extends Error {
  readonly code = 'proposal_stale';
  constructor() {
    super('Questa proposta non è più quella corrente: la pagina si aggiorna.');
    this.name = 'ProposalStaleError';
  }
}

/** La voce non è più nello stato in cui il client l'ha vista: nulla scritto, il confronto si rilegge. */
export class ProposalItemChangedError extends Error {
  readonly code = 'item_changed';
  constructor(message = "La voce è cambiata dopo che l'hai vista: rileggi la proposta.") {
    super(message);
    this.name = 'ProposalItemChangedError';
  }
}

/** La voce è già decisa (in un'altra scheda): nulla scritto. */
export class ProposalItemDecidedError extends Error {
  readonly code = 'item_decided';
  constructor() {
    super("Questa voce l'hai già decisa in un'altra scheda: la pagina si aggiorna.");
    this.name = 'ProposalItemDecidedError';
  }
}

/** Annulla su una voce che è già da decidere (annullata in un'altra scheda). */
export class ProposalItemOpenError extends Error {
  readonly code = 'item_open';
  constructor() {
    super("Questa decisione è già stata annullata in un'altra scheda: la pagina si aggiorna.");
    this.name = 'ProposalItemOpenError';
  }
}

/** Annulla rifiutato: il campo o il servizio è cambiato dopo la decisione, rimettere il valore di prima lo perderebbe. */
export class ProposalUndoBlockedError extends Error {
  readonly code = 'undo_blocked';
  constructor(message: string) {
    super(message);
    this.name = 'ProposalUndoBlockedError';
  }
}

/** Il testo di "Modifica" non si può applicare (vuoto, o uguale a quello di oggi). */
export class ProposalEditError extends Error {
  constructor(
    message: string,
    readonly code: 'edit_empty' | 'edit_same',
  ) {
    super(message);
    this.name = 'ProposalEditError';
  }
}

export class ProposalItemNotFoundError extends Error {
  constructor() {
    super('Voce non trovata nella proposta.');
    this.name = 'ProposalItemNotFoundError';
  }
}

const STATUS_LABELS: Record<ItemStatus, string> = { new: 'Nuovo', changed: 'Modificato', unchanged: 'Invariato', conflict: 'In conflitto' };

/** L'ultima proposta letta adesso, che dev'essere quella vista dal client. */
function current(proposalId: number): { row: ProposalRow; view: ProposalView } {
  const row = proposalRow();
  if (!row || row.id !== proposalId) throw new ProposalStaleError();
  return { row, view: viewOf(row) };
}

function findItem(view: ProposalView, target: ItemTarget): ProposalFieldItem | ProposalServiceItem {
  const item = 'field' in target ? view.fields.find((f) => f.key === target.field) : view.services.find((s) => s.name === target.service);
  if (!item) throw new ProposalItemNotFoundError();
  return item;
}

const isField = (item: ProposalFieldItem | ProposalServiceItem): item is ProposalFieldItem => 'key' in item;
const itemKey = (item: ProposalFieldItem | ProposalServiceItem) => (isField(item) ? fieldItemKey(item.key) : serviceItemKey(item.name));

/** Una voce si decide solo se è ancora da decidere e nello stato in cui il client l'ha vista. */
function assertDecidable(item: ProposalFieldItem | ProposalServiceItem, expected: ItemStatus | undefined): void {
  if (item.decision) throw new ProposalItemDecidedError();
  if (expected === undefined || expected === item.status) return;
  if (!isField(item) && item.existing === null && expected !== 'new') {
    throw new ProposalItemChangedError(`Il servizio «${item.name}» non è più nel CRM: la voce torna «Nuovo».`);
  }
  throw new ProposalItemChangedError(`La voce è cambiata dopo che l'hai vista: ora è «${STATUS_LABELS[item.status]}».`);
}

const snapshot = (s: Service): ServiceSnapshot => ({
  id: s.id,
  name: s.name,
  ...(Object.fromEntries(SERVICE_TEXT_FIELDS.map((f) => [f, s[f]])) as Record<ServiceTextField, string | null>),
  origin: s.origin,
  origin_at: s.origin_at,
});

const sameService = (a: Pick<Service, ServiceValueKey>, b: Pick<Service, ServiceValueKey>) => SERVICE_VALUE_KEYS.every((k) => a[k] === b[k]);

function proposedPatch(item: ProposalServiceItem): Partial<Record<ProposedServiceField, string>> {
  return Object.fromEntries(PROPOSED_SERVICE_FIELDS.flatMap((f) => (item.proposed[f] === null ? [] : [[f, item.proposed[f]]])));
}

/**
 * Il "no" della riga, da nominare quando il testo di Modifica non si può applicare: con la casella aperta i verbi sono
 * nascosti, quindi si dice anche come tornarci. Per un conflitto il "no" è tenere il proprio testo.
 */
function declineHint(status: ItemStatus, what: 'testo' | 'servizio'): string {
  return `annulla la modifica e scegli «${status === 'conflict' ? `Tieni il tuo ${what}` : 'Rifiuta'}»`;
}

/** "Modifica" di un campo: un testo uguale alla proposta vale come Applica; vuoto o uguale a oggi non si applica. */
function fieldEditDecision(item: ProposalFieldItem, edit: string): Decision {
  const text = cleanText(edit);
  if (text === null) throw new ProposalEditError(`Scrivi un testo, oppure ${declineHint(item.status, 'testo')}.`, 'edit_empty');
  if (same(text, item.current)) {
    throw new ProposalEditError(
      `È uguale al testo di oggi: niente da applicare. Se va bene così, ${declineHint(item.status, 'testo')}.`,
      'edit_same',
    );
  }
  return same(text, item.proposed) ? 'applied' : 'edited';
}

/** Scrive (o no, per un rifiuto) il campo e restituisce la decisione da ricordare. */
function decideField(item: ProposalFieldItem, decision: Decision, edit?: string): FieldDecision {
  const before: ProfileValue = { value: item.current, origin: item.current_origin, origin_at: item.current_origin_at };
  let value: string | null = null;
  if (decision === 'applied') {
    applyProfileValues({ [item.key]: item.proposed });
    value = cleanText(item.proposed);
  } else if (decision === 'edited') {
    // Il testo dell'utente è scritto a mano (H5): la prossima generazione lo mostrerà come conflitto.
    saveProfileByHand({ [item.key]: edit });
    value = cleanText(edit);
  }
  return { decision, at: nowIso(), status: item.status, value, before };
}

/**
 * Scrive (o no) il servizio e restituisce la decisione. Applicato: un servizio nuovo si aggiunge in fondo col nome
 * proposto, uno esistente cambia solo nei campi proposti (E7). Con le modifiche: i valori del dialog, scritti a mano.
 */
function decideService(item: ProposalServiceItem, decision: Decision, edit?: ServiceEdit): ServiceDecision {
  const before = item.existing ? snapshot(item.existing) : null;
  let written: Service | undefined;
  if (decision === 'applied') {
    written = item.existing
      ? updateService(item.existing.id, proposedPatch(item), 'proposal')
      : createService({ name: item.name, ...proposedPatch(item) }, 'proposal');
  } else if (decision === 'edited') {
    written = item.existing ? updateService(item.existing.id, edit!, 'manual') : createService(edit!, 'manual');
  }
  const after = written ? snapshot(written) : null;
  const changed = after ? SERVICE_VALUE_KEYS.filter((k) => (before?.[k] ?? null) !== after[k]) : [];
  if (decision === 'edited' && before !== null && changed.length === 0) {
    throw new ProposalEditError(
      `È uguale al servizio di oggi: niente da applicare. Se va bene così, ${declineHint(item.status, 'servizio')}.`,
      'edit_same',
    );
  }
  return { decision, at: nowIso(), status: item.status, before, after, changed };
}

function decide(item: ProposalFieldItem | ProposalServiceItem, decision: Decision, edit?: string | ServiceEdit): FieldDecision | ServiceDecision {
  return isField(item) ? decideField(item, decision, edit as string | undefined) : decideService(item, decision, edit as ServiceEdit | undefined);
}

function saveDecisions(id: number, decisions: ProposalRow['decisions']): void {
  db.prepare(`UPDATE profile_proposals SET decisions = ? WHERE id = ?`).run(JSON.stringify(decisions), id);
}

/** Le voci da decidere che un'azione di massa tocca: tutte quelle che passano `keep`, tranne `except`. */
function bulkItems(view: ProposalView, except: readonly string[] | undefined, keep: (status: ItemStatus) => boolean) {
  const skip = new Set(except ?? []);
  return [...view.fields, ...view.services].filter((i) => i.decision === null && keep(i.status) && !skip.has(itemKey(i)));
}

export interface ApplyResult {
  applied: number;
  /** Quanti campi e quanti servizi (il toast dell'azione di massa: "Applicate 4 voci: 2 campi e 2 servizi."). */
  fields: number;
  services: number;
  /** La proposta riletta, aperta o chiusa. */
  proposal: ProposalView;
}

/**
 * Applica una voce — com'è, o con le modifiche dell'utente (`edit`: il testo di un campo, i valori del dialog per un
 * servizio) — oppure, con `all`, tutte le nuove e modificate da decidere: i conflitti restano fuori (E8, E9).
 * `expected` = lo stato in cui il client ha visto la voce: se nel frattempo è cambiato non si scrive niente.
 */
export function applyProposal(proposalId: number, target: Target, opts: { expected?: ItemStatus; edit?: string | ServiceEdit } = {}): ApplyResult {
  return db.transaction((): ApplyResult => {
    const { row, view } = current(proposalId);
    const decisions = { ...row.decisions };
    let fields = 0;
    let services = 0;
    const items = 'all' in target ? bulkItems(view, target.except, applicable) : [findItem(view, target)];
    for (const item of items) {
      if (!('all' in target)) {
        assertDecidable(item, opts.expected);
        if (!decidable(item.status)) continue;
      }
      const decision = isField(item) && typeof opts.edit === 'string' ? fieldEditDecision(item, opts.edit) : opts.edit ? 'edited' : 'applied';
      decisions[itemKey(item)] = decide(item, decision, opts.edit);
      if (isField(item)) fields++;
      else services++;
    }
    saveDecisions(row.id, decisions);
    return { applied: fields + services, fields, services, proposal: viewOf({ ...row, decisions }) };
  })();
}

export interface RejectResult {
  rejected: number;
  proposal: ProposalView;
}

/**
 * Rifiuta una voce, o con `all` tutte quelle da decidere, conflitti compresi (E12): nessun valore cambia. Il rifiuto
 * di un conflitto è "tieni il tuo testo".
 */
export function rejectProposal(proposalId: number, target: Target, expected?: ItemStatus): RejectResult {
  return db.transaction((): RejectResult => {
    const { row, view } = current(proposalId);
    const decisions = { ...row.decisions };
    let rejected = 0;
    const items = 'all' in target ? bulkItems(view, target.except, decidable) : [findItem(view, target)];
    for (const item of items) {
      if (!('all' in target)) {
        assertDecidable(item, expected);
        if (!decidable(item.status)) continue;
      }
      decisions[itemKey(item)] = decide(item, 'rejected');
      rejected++;
    }
    saveDecisions(row.id, decisions);
    return { rejected, proposal: viewOf({ ...row, decisions }) };
  })();
}

/**
 * Annulla una decisione: la voce torna da decidere, ricalcolata adesso. Un campo applicato riprende il valore di prima
 * con la sua provenienza; un servizio aggiunto si toglie, uno aggiornato riprende nome, campi e provenienza di prima.
 * Rifiutato (`undo_blocked`) se il campo o il servizio è cambiato dopo la decisione: rimettere il valore di prima
 * cancellerebbe quella modifica.
 */
export function undoDecision(proposalId: number, target: ItemTarget): ProposalView {
  return db.transaction((): ProposalView => {
    const { row, view } = current(proposalId);
    const item = findItem(view, target);
    if (!item.decision) throw new ProposalItemOpenError();
    if (isField(item)) {
      const d = item.decision;
      if (d.decision !== 'rejected') {
        if (!same(readProfileFields()[item.key].value, d.value)) {
          throw new ProposalUndoBlockedError("Il campo è cambiato dopo che l'hai applicato: per cambiarlo usa il suo campo nel profilo.");
        }
        restoreProfileValue(item.key, d.before);
      }
    } else {
      const d = item.decision;
      if (d.after) {
        const service = getService(d.after.id);
        if (!service || !sameService(service, d.after)) {
          throw new ProposalUndoBlockedError(
            `Il servizio «${d.after.name}» è cambiato dopo che l'hai ${d.before ? 'aggiornato' : 'aggiunto'}: modificalo o eliminalo da «I miei servizi».`,
          );
        }
        if (d.before === null) deleteService(service.id);
        else restoreService(service.id, d.before);
      }
    }
    const decisions = { ...row.decisions };
    delete decisions[itemKey(item)];
    saveDecisions(row.id, decisions);
    return viewOf({ ...row, decisions });
  })();
}
