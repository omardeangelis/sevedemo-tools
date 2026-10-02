import type { DiscardedItem, ProposedService, ProposedValue } from '../profile/generate.js';
import type { GenerationSource } from '../profile/sources.js';
import { jsonObject, serviceNameKey } from '../util/fields.js';
import { db } from './index.js';
import { applyProfileValues, getProfile, PROFILE_FIELD_KEYS, type ProfileFieldKey } from './profile.js';
import type { FieldOrigin } from './schema.js';
import { createService, listServices, updateService, type Service } from './services.js';

/*
 * La proposta pendente letta **adesso** (own-profile-services T27: E3, E4, E9, G-11, P-12). La riga di
 * `profile_proposals` conserva solo ciò che il modello ha proposto: lo stato di ogni voce — nuova, modificata,
 * invariata, in conflitto con ciò che l'utente ha scritto a mano — si ricalcola a ogni lettura contro i valori di oggi,
 * così un servizio eliminato dopo la generazione torna "nuovo" e una voce applicata risulta invariata. Applicare e
 * scartare (T28) passano dallo stesso confronto, dentro una transazione: niente si scrive da sé (H3).
 */

export const ITEM_STATUSES = ['new', 'changed', 'unchanged', 'conflict'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

/** Campi di un servizio che la proposta può nominare (le note restano dell'utente). */
export const PROPOSED_SERVICE_FIELDS = ['description', 'audience', 'problem', 'proof'] as const;
export type ProposedServiceField = (typeof PROPOSED_SERVICE_FIELDS)[number];

export interface ProposalFieldItem {
  key: ProfileFieldKey;
  status: ItemStatus;
  current: string | null;
  current_origin: FieldOrigin | null;
  current_origin_at: string | null;
  proposed: string;
  sources: GenerationSource[];
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
}

export interface ProposalSourceOutcome {
  kind: GenerationSource;
  outcome: string;
  reused: boolean;
  read_at: string | null;
  reason: string | null;
}

export interface ProposalView {
  id: number;
  job_id: number | null;
  model: string;
  created_at: string;
  /** Esito di ogni fonte alla generazione (G5). */
  sources: ProposalSourceOutcome[];
  discarded: DiscardedItem[];
  fields: ProposalFieldItem[];
  services: ProposalServiceItem[];
  summary: {
    /** Nuove e modificate: ciò che "Applica tutto" applicherebbe. */
    to_review: number;
    conflicts: number;
    unchanged: number;
    /** Campi già compilati senza provenienza che "Applica tutto" sostituirebbe (G-11, E14). */
    filled_without_origin: number;
  };
  apply_all: { count: number; disabled_reason: string | null };
}

export const NO_PROPOSAL = 'Nessuna proposta in attesa.';
const ALL_CONFLICTS = 'Ogni voce della proposta cambierebbe un testo scritto da te: decidili uno per uno.';
const NOTHING_TO_APPLY = 'Niente da applicare: la proposta coincide con il profilo.';

interface ProposalRow {
  id: number;
  job_id: number | null;
  model: string;
  created_at: string;
  fields: Partial<Record<string, ProposedValue>>;
  services: ProposedService[];
  sources: ProposalSourceOutcome[];
  discarded: DiscardedItem[];
}

const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? '').trim() === (b ?? '').trim();

function parseArray<T>(text: string): T[] {
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
}

/** La proposta pendente così come è stata salvata, `undefined` se non c'è. */
function proposalRow(): ProposalRow | undefined {
  const row = db.prepare(`SELECT * FROM profile_proposals ORDER BY id DESC LIMIT 1`).get() as
    | (Omit<ProposalRow, 'fields' | 'services' | 'sources' | 'discarded'> & Record<'fields' | 'services' | 'sources' | 'discarded', string>)
    | undefined;
  if (!row) return undefined;
  // Una colonna illeggibile vale come proposta senza campi.
  const fields = jsonObject(row.fields) as ProposalRow['fields'];
  return {
    id: row.id,
    job_id: row.job_id,
    model: row.model,
    created_at: row.created_at,
    fields,
    services: parseArray<ProposedService>(row.services),
    sources: parseArray<ProposalSourceOutcome>(row.sources),
    discarded: parseArray<DiscardedItem>(row.discarded),
  };
}

function fieldItems(row: ProposalRow): ProposalFieldItem[] {
  const profile = getProfile();
  return PROFILE_FIELD_KEYS.flatMap((key): ProposalFieldItem[] => {
    const proposed = row.fields[key];
    if (!proposed) return [];
    const current = profile.fields[key];
    const status: ItemStatus =
      current.value === null ? 'new' : same(current.value, proposed.value) ? 'unchanged' : current.origin === 'manual' ? 'conflict' : 'changed';
    return [
      {
        key,
        status,
        current: current.value,
        current_origin: current.origin,
        current_origin_at: current.origin_at,
        proposed: proposed.value,
        sources: proposed.sources,
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
    const status: ItemStatus =
      existing === null ? 'new' : changed_fields.length === 0 ? 'unchanged' : existing.origin === 'manual' ? 'conflict' : 'changed';
    return { name: s.name, status, existing, proposed, changed_fields, sources: s.sources };
  });
}

/** La proposta pendente con il confronto di adesso, `undefined` se non c'è. */
export function readProposal(): ProposalView | undefined {
  const row = proposalRow();
  if (!row) return undefined;
  const fields = fieldItems(row);
  const services = serviceItems(row);
  const all = [...fields, ...services];
  const count = (status: ItemStatus) => all.filter((i) => i.status === status).length;
  const toApply = count('new') + count('changed');
  const conflicts = count('conflict');
  return {
    id: row.id,
    job_id: row.job_id,
    model: row.model,
    created_at: row.created_at,
    sources: row.sources,
    discarded: row.discarded,
    fields,
    services,
    summary: {
      to_review: toApply,
      conflicts,
      unchanged: count('unchanged'),
      filled_without_origin: fields.filter((f) => f.status === 'changed' && f.current_origin === null).length,
    },
    apply_all: {
      count: toApply,
      disabled_reason: toApply > 0 ? null : conflicts > 0 ? ALL_CONFLICTS : NOTHING_TO_APPLY,
    },
  };
}

// ---------------------------------------------------------------------------
// Applica e scarta (T28: E7, E8, E10, E11, E12, H3)
// ---------------------------------------------------------------------------

/** Cosa applicare: un campo, un servizio (per il nome proposto) o tutte le voci non scritte a mano. */
export type ApplyTarget = { field: ProfileFieldKey } | { service: string } | { all: true };

/** La proposta vista dal client non è più quella pendente (rigenerata o scartata altrove). */
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

export class ProposalItemNotFoundError extends Error {
  constructor() {
    super('Voce non trovata nella proposta.');
    this.name = 'ProposalItemNotFoundError';
  }
}

const toDecide = (status: ItemStatus) => status !== 'unchanged';
const applicable = (status: ItemStatus) => status === 'new' || status === 'changed';

function proposedPatch(item: ProposalServiceItem): Partial<Record<ProposedServiceField, string>> {
  return Object.fromEntries(PROPOSED_SERVICE_FIELDS.flatMap((f) => (item.proposed[f] === null ? [] : [[f, item.proposed[f]]])));
}

/** Un servizio nuovo si aggiunge in fondo col nome proposto; uno esistente cambia solo nei campi proposti (E7). */
function applyService(item: ProposalServiceItem): void {
  if (item.existing === null) createService({ name: item.name, ...proposedPatch(item) }, 'proposal');
  else updateService(item.existing.id, proposedPatch(item), 'proposal');
}

export interface ApplyResult {
  applied: number;
  conflicts_left: number;
  /** La proposta dopo l'applicazione; `null` quando non resta niente da decidere e non è più in attesa (FLOW A.6). */
  proposal: ProposalView | null;
}

/**
 * Applica una voce, o tutte quelle non scritte a mano (E8: i conflitti restano da decidere uno per uno, E9). Un campo in
 * conflitto si applica solo da solo ("Sostituisci il tuo testo"). `expected` = lo stato in cui il client ha visto la
 * voce: se nel frattempo è cambiato (servizio eliminato, campo riscritto a mano in un'altra scheda) non si scrive niente.
 * Ciò che non si applica resta nella proposta (E10); quando non resta niente da decidere la proposta non è più in attesa.
 */
export function applyProposal(proposalId: number, target: ApplyTarget, expected?: ItemStatus): ApplyResult {
  return db.transaction((): ApplyResult => {
    const view = readProposal();
    if (!view || view.id !== proposalId) throw new ProposalStaleError();

    let applied = 0;
    if ('all' in target) {
      const fields = view.fields.filter((f) => applicable(f.status));
      if (fields.length > 0) applyProfileValues(Object.fromEntries(fields.map((f) => [f.key, f.proposed])));
      const services = view.services.filter((s) => applicable(s.status));
      for (const s of services) applyService(s);
      applied = fields.length + services.length;
    } else if ('field' in target) {
      const item = view.fields.find((f) => f.key === target.field);
      if (!item) throw new ProposalItemNotFoundError();
      if (expected !== undefined && expected !== item.status) throw new ProposalItemChangedError();
      if (toDecide(item.status)) {
        applyProfileValues({ [item.key]: item.proposed });
        applied = 1;
      }
    } else {
      const item = view.services.find((s) => s.name === target.service);
      if (!item) throw new ProposalItemNotFoundError();
      if (expected !== undefined && expected !== item.status) {
        throw new ProposalItemChangedError(
          item.existing === null && expected !== 'new'
            ? `Il servizio «${item.name}» non è più nel CRM: la voce torna «Nuovo».`
            : undefined,
        );
      }
      if (toDecide(item.status)) {
        applyService(item);
        applied = 1;
      }
    }

    const after = readProposal()!;
    const open = [...after.fields, ...after.services].some((i) => toDecide(i.status));
    if (!open) db.prepare(`DELETE FROM profile_proposals WHERE id = ?`).run(proposalId);
    return { applied, conflicts_left: after.summary.conflicts, proposal: open ? after : null };
  })();
}

/** Scarta la proposta intera (E12): nessun valore del profilo né dei servizi cambia. */
export function discardProposal(proposalId: number): void {
  const row = proposalRow();
  if (!row || row.id !== proposalId) throw new ProposalStaleError();
  db.prepare(`DELETE FROM profile_proposals WHERE id = ?`).run(proposalId);
}
