import { memberIdOf } from '../util/fields.js';
import { db, nowIso } from './index.js';
import { MANUAL_COLUMNS, parseManualFields, type ManualColumn, type ManualFields } from './manual-fields.js';

/*
 * Unione di due persone (people-first-crm PLAN P-19): un solo posto dove si spostano i dati. Fonti, liste,
 * attività e analisi passano alla persona che resta; l'altra si cancella. Due regole per i valori:
 * - `auto` (E9): unioni dei job (stesso profilo rivelato da un arricchimento o da una fonte). Ciò che l'utente
 *   ha impostato a mano su **una qualsiasi** delle due resta (se entrambe: il più recente), i campi mai
 *   toccati si riempiono come prima (backfill); prossima azione = la impostata più di recente; stato = il
 *   cambio più recente;
 * - `manual` (E6–E8): "Unisci" dalla scheda, con anteprima; resta la persona della scheda (sotto).
 */

/** Colonne descrittive che non sono "dati a mano": backfill dalla persona assorbita. */
const FILL_COLUMNS = ['raw_json', 'enriched_at', 'enrichment_attempted_at', 'apollo_person_id'] as const;

/** Riga di `prospects` letta per l'unione. */
export type PersonRow = Record<string, any> & {
  id: number;
  linkedin_url: string | null;
  member_urn: string | null;
  manual_fields: string;
  status: string;
  status_changed_at: string | null;
  next_action_on: string | null;
  next_action_text: string | null;
  next_action_set_at: string | null;
  created_at: string;
};

export function readPerson(id: number): PersonRow | undefined {
  return db.prepare('SELECT * FROM prospects WHERE id = ?').get(id) as PersonRow | undefined;
}

/** Valori finali della persona che resta. */
export interface MergedValues {
  linkedin_url: string | null;
  member_urn: string | null;
  fields: Record<ManualColumn | (typeof FILL_COLUMNS)[number], unknown>;
  manual_fields: ManualFields;
  apollo_matched_at: string | null;
  status: string;
  status_changed_at: string | null;
  next_action: { on: string | null; text: string | null; set_at: string | null };
  created_at: string;
}

const latest = (...values: Array<string | null | undefined>): string | null =>
  values.filter((v): v is string => Boolean(v)).sort().at(-1) ?? null;

const isEmpty = (value: unknown) => value === null || value === undefined || (typeof value === 'string' && value.trim() === '');

/** Unione delle marcature: per ogni colonna la data più recente. */
function mergeManualFields(a: ManualFields, b: ManualFields): ManualFields {
  const out: ManualFields = { ...a };
  for (const [col, at] of Object.entries(b) as Array<[ManualColumn, string]>) out[col] = latest(out[col], at)!;
  return out;
}

/** Profilo LinkedIn di default: lo slug pubblico tra i due, id membro = quello noto (regola di identity.ts). */
export function defaultLinkedin(keep: PersonRow, drop: PersonRow): { url: string | null; urn: string | null } {
  const urls = [keep.linkedin_url, drop.linkedin_url].filter((u): u is string => Boolean(u));
  const url = urls.find((u) => !memberIdOf(u)) ?? urls[0] ?? null;
  const urn = keep.member_urn ?? drop.member_urn ?? memberIdOf(keep.linkedin_url) ?? memberIdOf(drop.linkedin_url) ?? null;
  return { url, urn };
}

/** Regola automatica (E9): vedi l'intestazione del file. */
export function autoMergedValues(keep: PersonRow, drop: PersonRow): MergedValues {
  const km = parseManualFields(keep.manual_fields);
  const dm = parseManualFields(drop.manual_fields);
  const fields = {} as MergedValues['fields'];
  for (const col of MANUAL_COLUMNS) {
    const k = km[col];
    const d = dm[col];
    if (k || d) fields[col] = (d ?? '') > (k ?? '') ? drop[col] : keep[col];
    else fields[col] = isEmpty(keep[col]) ? drop[col] : keep[col];
  }
  for (const col of FILL_COLUMNS) fields[col] = keep[col] ?? drop[col];

  const statusFrom = (drop.status_changed_at ?? '') > (keep.status_changed_at ?? '') ? drop : keep;
  const actionFrom = (drop.next_action_set_at ?? '') > (keep.next_action_set_at ?? '') ? drop : keep;
  const { url, urn } = defaultLinkedin(keep, drop);
  return {
    linkedin_url: url,
    member_urn: urn,
    fields,
    manual_fields: mergeManualFields(km, dm),
    apollo_matched_at: latest(keep.apollo_matched_at, drop.apollo_matched_at),
    status: statusFrom.status,
    status_changed_at: statusFrom.status_changed_at,
    next_action: { on: actionFrom.next_action_on, text: actionFrom.next_action_text, set_at: actionFrom.next_action_set_at },
    created_at: [keep.created_at, drop.created_at].sort()[0],
  };
}

/**
 * Nucleo dell'unione, dentro la transazione del chiamante: sposta fonti, membership, attività e analisi di
 * `drop` su `keep` (una fonte o membership già presente su `keep` resta quella: le righe in conflitto
 * spariscono col CASCADE), cancella `drop` e scrive `values` su `keep` (dopo la cancellazione: le chiavi uniche
 * di `drop` si liberano prima).
 */
export function applyMerge(keep: PersonRow, drop: PersonRow, values: MergedValues): void {
  for (const table of ['sources', 'list_members', 'activities', 'analyses']) {
    db.prepare(`UPDATE OR IGNORE ${table} SET prospect_id = ? WHERE prospect_id = ?`).run(keep.id, drop.id);
  }
  db.prepare('DELETE FROM prospects WHERE id = ?').run(drop.id);
  const columns = [...MANUAL_COLUMNS, ...FILL_COLUMNS];
  db.prepare(
    `UPDATE prospects SET linkedin_url = ?, member_urn = ?, ${columns.map((c) => `${c} = ?`).join(', ')},
       manual_fields = ?, apollo_matched_at = ?, status = ?, status_changed_at = ?,
       next_action_on = ?, next_action_text = ?, next_action_set_at = ?, created_at = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    values.linkedin_url,
    values.member_urn,
    ...columns.map((c) => values.fields[c] ?? null),
    JSON.stringify(values.manual_fields),
    values.apollo_matched_at,
    values.status,
    values.status_changed_at,
    values.next_action.on,
    values.next_action.text,
    values.next_action.set_at,
    values.created_at,
    nowIso(),
    keep.id,
  );
}

/** Unione automatica dei job (E9): `drop` confluisce in `keep`. Lancia se una delle due non esiste. */
export function mergePeopleAuto(keepId: number, dropId: number): void {
  if (keepId === dropId) return;
  db.transaction(() => {
    const keep = readPerson(keepId);
    const drop = readPerson(dropId);
    if (!keep || !drop) throw new Error(`Persona inesistente: ${keep ? dropId : keepId}`);
    applyMerge(keep, drop, autoMergedValues(keep, drop));
  })();
}

// ---------------------------------------------------------------------------
// Unione manuale ("Unisci" dalla scheda, E6–E8)
// ---------------------------------------------------------------------------

/** Campi della scheda che una `patch` di "Unisci" può portare (gli stessi del PATCH, E6). */
export type MergePatch = Partial<Record<Exclude<ManualColumn, 'company_id'>, string | null>> & { linkedin_url?: string | null };

export type MergeCheck =
  | { ok: true; keep: PersonRow; other: PersonRow; values: MergedValues; linkedinFrom: 'patch' | 'keep' | 'other' | null }
  | { ok: false; code: 'not_found' | 'other_not_found' }
  | { ok: false; code: 'not_mergeable'; reason: string; keep: PersonRow; other: PersonRow };

const shortUrl = (url: string) => url.replace(/^https:\/\/www\./, '');

/** Id membro di una persona: la colonna o quello dentro un URL `/in/ACoAA…`. */
const urnOf = (p: PersonRow) => p.member_urn ?? memberIdOf(p.linkedin_url) ?? null;

/**
 * Motivo per cui due persone non si possono unire (E7): due profili LinkedIn distinti. Con `patchUrl` (conflitto
 * nato dal LinkedIn che si sta salvando) conta solo l'id membro: l'URL della persona tenuta viene sostituito.
 */
export function notMergeableReason(keep: PersonRow, other: PersonRow, patchUrl?: string | null): string | undefined {
  const differentUrl = !patchUrl && keep.linkedin_url && other.linkedin_url && keep.linkedin_url !== other.linkedin_url;
  const keepUrn = urnOf(keep);
  const otherUrn = urnOf(other);
  const differentUrn = keepUrn && otherUrn && keepUrn !== otherUrn;
  if (!differentUrl && !differentUrn) return undefined;
  const otherProfile = other.linkedin_url ? ` (${shortUrl(other.linkedin_url)})` : '';
  return `${other.full_name ?? 'Questa persona'} ha un altro profilo LinkedIn${otherProfile}: sono due persone distinte e non si possono unire.`;
}

/**
 * Regola manuale (E6, E7): resta la persona della scheda (`keep`, con i valori della `patch` che si stava
 * salvando: contano come suoi); per ogni campo non vuoto resta il suo valore, quelli dell'altra riempiono solo
 * ciò che manca; stato della persona tenuta; prossima azione sua, dell'altra solo se manca.
 * Profilo LinkedIn: nel caso LinkedIn di E5 l'URL che si stava salvando + l'id membro dell'altra; altrimenti
 * quello di chi lo ha. I campi della `patch` risultano impostati a mano.
 */
export function manualMergeCheck(keepId: number, otherId: number, patch: MergePatch = {}, patchUrl?: string | null): MergeCheck {
  const keepRow = readPerson(keepId);
  if (!keepRow) return { ok: false, code: 'not_found' };
  const other = readPerson(otherId);
  if (!other || otherId === keepId) return { ok: false, code: 'other_not_found' };

  const now = nowIso();
  const patched: PersonRow = { ...keepRow };
  const patchedColumns: ManualColumn[] = [];
  for (const [col, value] of Object.entries(patch) as Array<[string, string | null | undefined]>) {
    if (col === 'linkedin_url' || value === undefined || !(MANUAL_COLUMNS as readonly string[]).includes(col)) continue;
    patched[col] = typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
    patchedColumns.push(col as ManualColumn);
  }
  const reason = notMergeableReason(patched, other, patchUrl);
  if (reason) return { ok: false, code: 'not_mergeable', reason, keep: keepRow, other };

  const fields = {} as MergedValues['fields'];
  for (const col of MANUAL_COLUMNS) fields[col] = isEmpty(patched[col]) ? other[col] : patched[col];
  for (const col of FILL_COLUMNS) fields[col] = patched[col] ?? other[col];

  const manual = mergeManualFields(parseManualFields(keepRow.manual_fields), parseManualFields(other.manual_fields));
  for (const col of patchedColumns) manual[col] = now;

  let linkedinFrom: 'patch' | 'keep' | 'other' | null;
  let url: string | null;
  let urn: string | null;
  if (patchUrl) {
    linkedinFrom = 'patch';
    url = patchUrl;
    urn = other.member_urn ?? memberIdOf(other.linkedin_url) ?? keepRow.member_urn ?? memberIdOf(patchUrl) ?? null;
  } else {
    ({ url, urn } = defaultLinkedin(patched, other));
    linkedinFrom = url === null ? null : url === patched.linkedin_url ? 'keep' : 'other';
  }
  const keepAction = patched.next_action_on !== null;
  return {
    ok: true,
    keep: patched,
    other,
    linkedinFrom,
    values: {
      linkedin_url: url,
      member_urn: urn,
      fields,
      manual_fields: manual,
      apollo_matched_at: latest(keepRow.apollo_matched_at, other.apollo_matched_at),
      status: keepRow.status,
      status_changed_at: keepRow.status_changed_at,
      next_action: keepAction
        ? { on: patched.next_action_on, text: patched.next_action_text, set_at: patched.next_action_set_at }
        : { on: other.next_action_on, text: other.next_action_text, set_at: other.next_action_set_at },
      created_at: [keepRow.created_at, other.created_at].sort()[0],
    },
  };
}

export interface MergePreview {
  mergeable: boolean;
  reason: string | null;
  /** Righe dell'altra persona che passano a quella tenuta. */
  moving: { sources: number; lists: number; activities: number; analyses: number };
  /** Le stesse in parole (FLOW F.3): fonti ("Reazione a 'Abbiamo migrato…'") e ultima analisi per ICP ("ICP, fit medio"). */
  moving_labels: { sources: string[]; analyses: string[] };
  /** `from`: di chi è l'URL che resta; `member_urn_from`: di chi è l'id membro (E7, "con l'id membro di #812"). */
  linkedin: {
    url: string | null;
    member_urn: string | null;
    from: 'patch' | 'keep' | 'other' | null;
    member_urn_from: 'patch' | 'keep' | 'other' | null;
  };
  /** Campi vuoti sulla persona tenuta che l'altra riempie. */
  filled: string[];
  /** Valori in conflitto: resta quello della persona tenuta. */
  conflicts: Array<{ field: string; keep: string; lose: string }>;
}

const display = (v: unknown) => (v === null || v === undefined ? '' : String(v));

const excerpt = (text: string | null) => {
  const t = text?.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > 30 ? `${t.slice(0, 30).trimEnd()}…` : t;
};

/** Fonti e analisi dell'altra persona in parole, per "Confluiscono". */
function movingLabels(otherId: number): MergePreview['moving_labels'] {
  const sources = db
    .prepare(
      `SELECT s.kind, p.text_excerpt AS post, c.name AS company FROM sources s
       LEFT JOIN posts p ON p.id = s.post_id LEFT JOIN companies c ON c.id = s.company_id
       WHERE s.prospect_id = ? ORDER BY s.captured_at, s.id`,
    )
    .all(otherId) as Array<{ kind: string; post: string | null; company: string | null }>;
  const analyses = db
    .prepare(
      `SELECT i.name, a.fit FROM analyses a JOIN icps i ON i.id = a.icp_id
       WHERE a.prospect_id = ? AND a.id = (SELECT MAX(a2.id) FROM analyses a2 WHERE a2.prospect_id = a.prospect_id AND a2.icp_id = a.icp_id)
       ORDER BY i.name COLLATE NOCASE`,
    )
    .all(otherId) as Array<{ name: string; fit: string }>;
  const postLabel = (what: string, post: string | null) => (excerpt(post) ? `${what} a '${excerpt(post)}'` : `${what} a un post`);
  const label = (s: (typeof sources)[number]) => {
    switch (s.kind) {
      case 'post_reaction':
        return postLabel('Reazione', s.post);
      case 'post_comment':
        return postLabel('Commento', s.post);
      case 'company_employees':
        return s.company ? `Persone di ${s.company}` : "Persone di un'azienda";
      case 'apollo_people':
        return s.company ? `Contatti Apollo di ${s.company}` : 'Contatti Apollo';
      default:
        return 'Aggiunta a mano';
    }
  };
  return { sources: sources.map(label), analyses: analyses.map((a) => `${a.name}, fit ${a.fit}`) };
}

/** Anteprima di "Unisci" (E6): cosa confluisce, cosa si aggiunge e quale valore resta per ogni conflitto. */
export function mergePreview(check: Extract<MergeCheck, { ok: true } | { code: 'not_mergeable' }>): MergePreview {
  const count = (table: string) =>
    db.prepare(`SELECT COUNT(*) FROM ${table} WHERE prospect_id = ?`).pluck().get(check.other.id) as number;
  const moving = { sources: count('sources'), lists: count('list_members'), activities: count('activities'), analyses: count('analyses') };
  const moving_labels = movingLabels(check.other.id);
  if (!check.ok) {
    const linkedin = { url: null, member_urn: null, from: null, member_urn_from: null };
    return { mergeable: false, reason: check.reason, moving, moving_labels, linkedin, filled: [], conflicts: [] };
  }
  const { keep, other } = check;
  const companyName = (id: unknown) =>
    id === null || id === undefined ? '' : ((db.prepare('SELECT name FROM companies WHERE id = ?').pluck().get(id) as string | undefined) ?? `#${id}`);
  const filled: string[] = [];
  const conflicts: MergePreview['conflicts'] = [];
  for (const col of MANUAL_COLUMNS) {
    if (isEmpty(other[col])) continue;
    if (isEmpty(keep[col])) filled.push(col);
    else if (display(keep[col]) !== display(other[col])) {
      conflicts.push(
        col === 'company_id'
          ? { field: col, keep: companyName(keep[col]), lose: companyName(other[col]) }
          : { field: col, keep: display(keep[col]), lose: display(other[col]) },
      );
    }
  }
  if (keep.status !== other.status) conflicts.push({ field: 'status', keep: keep.status, lose: other.status });
  if (keep.next_action_on && other.next_action_on) {
    const text = (p: PersonRow) => [p.next_action_on, p.next_action_text].filter(Boolean).join(' · ');
    if (text(keep) !== text(other)) conflicts.push({ field: 'next_action', keep: text(keep), lose: text(other) });
  } else if (!keep.next_action_on && other.next_action_on) {
    filled.push('next_action');
  }
  const urn = check.values.member_urn;
  const urnFrom = urn === null ? null : urn === urnOf(other) ? 'other' : urn === urnOf(keep) ? 'keep' : 'patch';
  return {
    mergeable: true,
    reason: null,
    moving,
    moving_labels,
    linkedin: { url: check.values.linkedin_url, member_urn: urn, from: check.linkedinFrom, member_urn_from: urnFrom },
    filled,
    conflicts,
  };
}

/** "Unisci" confermato (E8): resta una sola persona, nessun cambio di stato; l'altra risponde "non trovata". */
export function mergePeopleManual(
  keepId: number,
  otherId: number,
  patch: MergePatch = {},
  patchUrl?: string | null,
): 'ok' | 'not_found' | 'other_not_found' | { notMergeable: string } {
  return db
    .transaction(() => {
      const check = manualMergeCheck(keepId, otherId, patch, patchUrl);
      if (!check.ok) return check.code === 'not_mergeable' ? { notMergeable: check.reason } : check.code;
      applyMerge(check.keep, check.other, check.values);
      return 'ok' as const;
    })
    .immediate();
}
