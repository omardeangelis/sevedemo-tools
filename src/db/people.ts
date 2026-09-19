import { cleanText, isCalendarDate, isEmailLike, localDate, normalizeProfileUrl } from '../util/fields.js';
import { addActivity, changeStatus } from './activities.js';
import { getCompany } from './companies.js';
import { findByLinkedinKeys, identityKeys, type IdentityKeys } from './identity.js';
import { db, nowIso } from './index.js';
import { addMembers } from './lists.js';
import { markManual, type ManualColumn } from './manual-fields.js';
import { setNextAction } from './next-actions.js';
import { notMergeableReason, readPerson } from './person-merge.js';
import { updateProspect, type ProspectPatch } from './prospects.js';
import type { ProspectStatus, SourceKind } from './schema.js';

/*
 * Persone gestite a mano (people-first-crm). Il nome "prospect" resta in tabelle, tipi e path API (PLAN P-8);
 * "persona" è la parola dell'interfaccia. Qui: collegamento all'azienda deciso dall'utente (D1–D5, D7),
 * aggiunta a mano con controllo dei doppioni e "Aggiungi l'incontro" (C1–C11).
 */

export type LinkCompanyOutcome = 'ok' | 'not_found' | 'company_not_found';

/**
 * Collega (o cambia) l'azienda della persona e marca il collegamento come impostato a mano: da qui nessun
 * job lo cambia più (D7). `company_not_found` se l'azienda non esiste più (es. unita a un'altra).
 */
export function linkCompany(prospectId: number, companyId: number): LinkCompanyOutcome {
  return db
    .transaction((): LinkCompanyOutcome => {
      if (!db.prepare('SELECT 1 FROM prospects WHERE id = ?').get(prospectId)) return 'not_found';
      if (!getCompany(companyId)) return 'company_not_found';
      db.prepare('UPDATE prospects SET company_id = ?, updated_at = ? WHERE id = ?').run(companyId, nowIso(), prospectId);
      markManual(prospectId, ['company_id']);
      return 'ok';
    })
    .immediate();
}

/**
 * Scollega l'azienda (D5): il nome resta come testo (`company_name`, se era vuoto prende quello
 * dell'azienda), il collegamento risulta "rimosso a mano" e nessun job lo rifà (D7). Le fonti non cambiano.
 */
export function unlinkCompany(prospectId: number): 'ok' | 'not_found' {
  return db
    .transaction((): 'ok' | 'not_found' => {
      if (!db.prepare('SELECT 1 FROM prospects WHERE id = ?').get(prospectId)) return 'not_found';
      db.prepare(
        `UPDATE prospects
         SET company_name = COALESCE(company_name, (SELECT c.name FROM companies c WHERE c.id = prospects.company_id)),
             company_id = NULL, updated_at = ?
         WHERE id = ?`,
      ).run(nowIso(), prospectId);
      markManual(prospectId, ['company_id']);
      return 'ok';
    })
    .immediate();
}

// ---------------------------------------------------------------------------
// Riepilogo di una persona nei pannelli dei doppioni (C7–C10, E5)
// ---------------------------------------------------------------------------

export interface PersonRef {
  id: number;
  full_name: string | null;
  headline: string | null;
  title: string | null;
  /** Azienda collegata, altrimenti il nome scritto sulla persona. */
  company_name: string | null;
  linkedin_url: string | null;
  email: string | null;
  status: ProspectStatus;
  /** Prima fonte (la più vecchia): "commento del 2 set", "persone di Acme del 5 giu"… */
  first_source: { kind: SourceKind; captured_at: string; label: string; met_on: string | null } | null;
  next_action_on: string | null;
  next_action_text: string | null;
  /** Data dell'incontro della fonte "Aggiunta a mano", se c'è (C9: "Ha già la fonte … (5 giu)"). */
  manual_met_on: string | null;
}

function sourceLabel(kind: SourceKind, companyName: string | null): string {
  switch (kind) {
    case 'post_reaction':
      return 'reazione';
    case 'post_comment':
      return 'commento';
    case 'company_employees':
      return companyName ? `persone di ${companyName}` : "persone di un'azienda";
    case 'apollo_people':
      return companyName ? `contatti Apollo di ${companyName}` : 'contatti Apollo';
    case 'manual':
      return 'aggiunta a mano';
  }
}

/** Riepiloghi delle persone con questi id, nello stesso ordine (gli id spariti si saltano). */
export function personRefs(ids: number[]): PersonRef[] {
  if (ids.length === 0) return [];
  const marks = ids.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT p.id, p.full_name, p.headline, p.title, COALESCE(c.name, p.company_name) AS company_name, p.linkedin_url,
              p.email, p.status, p.next_action_on, p.next_action_text,
              (SELECT json_extract(s.raw_json, '$.met_on') FROM sources s WHERE s.prospect_id = p.id AND s.kind = 'manual') AS manual_met_on
       FROM prospects p LEFT JOIN companies c ON c.id = p.company_id
       WHERE p.id IN (${marks})`,
    )
    .all(...ids) as Array<Omit<PersonRef, 'first_source'>>;
  const firsts = db
    .prepare(
      `SELECT prospect_id, kind, captured_at, company_name, met_on FROM (
         SELECT s.prospect_id, s.kind, s.captured_at, c.name AS company_name,
                CASE WHEN s.kind = 'manual' THEN json_extract(s.raw_json, '$.met_on') END AS met_on,
                ROW_NUMBER() OVER (PARTITION BY s.prospect_id ORDER BY s.captured_at, s.id) AS rn
         FROM sources s LEFT JOIN companies c ON c.id = s.company_id
         WHERE s.prospect_id IN (${marks}))
       WHERE rn = 1`,
    )
    .all(...ids) as Array<{ prospect_id: number; kind: SourceKind; captured_at: string; company_name: string | null; met_on: string | null }>;
  const firstById = new Map(
    firsts.map((f) => [f.prospect_id, { kind: f.kind, captured_at: f.captured_at, label: sourceLabel(f.kind, f.company_name), met_on: f.met_on }]),
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [{ ...row, first_source: firstById.get(id) ?? null }] : [];
  });
}

// ---------------------------------------------------------------------------
// Doppioni (C7, C8, C10): LinkedIn blocca, email chiede, nome avvisa
// ---------------------------------------------------------------------------

/** Persona con questo profilo LinkedIn (qualunque forma dell'URL, anche id membro), `undefined` se nessuna. */
export function personByLinkedin(raw: unknown, excludeId?: number): number | undefined {
  const keys = identityKeys(normalizeProfileUrl(raw));
  if (!keys) return undefined;
  const id = findByLinkedinKeys(keys);
  return id === excludeId ? undefined : id;
}

/** Persone con questa email, senza distinzione di maiuscole né spazi (l'email non è una chiave: E1). */
export function peopleByEmail(raw: string | null | undefined, excludeId?: number): number[] {
  const email = raw?.trim().toLowerCase();
  if (!email) return [];
  return (db.prepare('SELECT id FROM prospects WHERE lower(trim(email)) = ? ORDER BY id').pluck().all(email) as number[]).filter(
    (id) => id !== excludeId,
  );
}

const nameKey = (name: string) => name.toLowerCase().replace(/\s+/g, '');

/** Persone con lo stesso nome (ignorando maiuscole e spazi). */
export function peopleByName(raw: string | null | undefined, excludeId?: number): number[] {
  const key = raw ? nameKey(raw) : '';
  if (!key) return [];
  const rows = db.prepare('SELECT id, full_name FROM prospects WHERE full_name IS NOT NULL ORDER BY id').all() as Array<{
    id: number;
    full_name: string;
  }>;
  return rows.filter((r) => r.id !== excludeId && nameKey(r.full_name) === key).map((r) => r.id);
}

export interface Duplicates {
  linkedin: PersonRef | null;
  email: PersonRef[];
  /** Stesso nome e nessun LinkedIn o email in comune (C10: avviso non bloccante). */
  name: PersonRef[];
}

export function findDuplicates(input: { linkedinUrl?: string; email?: string; name?: string; excludeId?: number }): Duplicates {
  const linkedinId = personByLinkedin(input.linkedinUrl, input.excludeId);
  const emailIds = peopleByEmail(input.email, input.excludeId);
  const taken = new Set([...(linkedinId === undefined ? [] : [linkedinId]), ...emailIds]);
  const nameIds = peopleByName(input.name, input.excludeId).filter((id) => !taken.has(id));
  return {
    linkedin: linkedinId === undefined ? null : (personRefs([linkedinId])[0] ?? null),
    email: personRefs(emailIds),
    name: personRefs(nameIds),
  };
}

// ---------------------------------------------------------------------------
// Aggiungi persona (C1–C11) e "Aggiungi l'incontro" (C9)
// ---------------------------------------------------------------------------

export interface MeetingInput {
  /** "Come vi siete conosciuti": diventa una nota con `meta.meeting` (l'unica cercabile, B5). */
  context?: string | null;
  /** Data dell'incontro `YYYY-MM-DD` (default oggi, fuso del computer). */
  metOn?: string | null;
}

export interface NextActionFormInput {
  on?: string | null;
  text?: string | null;
}

export interface CreatePersonInput {
  fullName?: string | null;
  title?: string | null;
  companyId?: number | null;
  companyName?: string | null;
  linkedinUrl?: string | null;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  meeting?: MeetingInput | null;
  listId?: number | null;
  status?: ProspectStatus | null;
  nextAction?: NextActionFormInput | null;
  /** C8: l'email è già di altre persone e l'utente ha scelto "Crea comunque". */
  createAnyway?: boolean;
}

export type FieldIssue = { path: string; message: string };

export type CreatePersonResult =
  | { ok: true; id: number }
  | { ok: false; code: 'invalid'; issues: FieldIssue[] }
  | { ok: false; code: 'linkedin_taken'; prospect: PersonRef }
  | { ok: false; code: 'email_taken'; prospects: PersonRef[] }
  | { ok: false; code: 'list_archived'; listName: string }
  | { ok: false; code: 'list_not_found' }
  | { ok: false; code: 'company_not_found' };

const text = (v: string | null | undefined) => cleanText(v);

export const PERSON_NOT_FOUND_MESSAGE = 'Persona non trovata.';
export const NO_CONTACT_MESSAGE = 'Serve almeno un recapito: profilo LinkedIn, email o telefono.';
export const NOT_A_PROFILE_MESSAGE = 'Non è il profilo di una persona: usa un URL del tipo https://www.linkedin.com/in/nome-cognome/';
export const INVALID_EMAIL_MESSAGE = 'Email non valida (es. nome@azienda.it).';
export const DATE_REQUIRED_MESSAGE = 'Scegli la data della prossima azione.';

/** Controlli di C3 sui campi della prossima azione e dell'incontro (anche per "Aggiungi l'incontro"). */
function meetingIssues(meeting: MeetingInput | null | undefined, nextAction: NextActionFormInput | null | undefined): FieldIssue[] {
  const issues: FieldIssue[] = [];
  if (meeting?.metOn && !isCalendarDate(meeting.metOn)) issues.push({ path: 'meeting.metOn', message: 'Data non valida (AAAA-MM-GG).' });
  if (nextAction?.on && !isCalendarDate(nextAction.on)) issues.push({ path: 'nextAction.on', message: 'Data non valida (AAAA-MM-GG).' });
  if (!nextAction?.on && text(nextAction?.text)) issues.push({ path: 'nextAction.on', message: DATE_REQUIRED_MESSAGE });
  return issues;
}

/** Lista scelta nel form: esiste e non è archiviata. */
function listProblem(listId: number | null | undefined): CreatePersonResult | undefined {
  if (listId == null) return undefined;
  const list = db.prepare('SELECT name, archived_at FROM lists WHERE id = ?').get(listId) as { name: string; archived_at: string | null } | undefined;
  if (!list) return { ok: false, code: 'list_not_found' };
  if (list.archived_at) return { ok: false, code: 'list_archived', listName: list.name };
  return undefined;
}

/** Nota del contesto dell'incontro, datata a mezzogiorno UTC della data dell'incontro (P-4, P-5). */
function addMeetingNote(prospectId: number, context: string | null, metOn: string): boolean {
  if (!context) return false;
  addActivity({ prospectId, kind: 'note', body: context, meta: { meeting: { met_on: metOn } }, occurredAt: `${metOn}T12:00:00.000Z` });
  return true;
}

/** Fonte "Aggiunta a mano" con la data dell'incontro (P-4: `captured_at` = ora dell'inserimento). */
function addManualSource(prospectId: number, metOn: string): void {
  db.prepare(`INSERT INTO sources (prospect_id, kind, raw_json, captured_at) VALUES (?, 'manual', ?, ?)`).run(
    prospectId,
    JSON.stringify({ met_on: metOn }),
    nowIso(),
  );
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && String((err as { code?: string }).code).startsWith('SQLITE_CONSTRAINT_UNIQUE');
}

/**
 * Aggiunge una persona a mano (C1–C11): nome + almeno un recapito; tutti i campi scritti e l'eventuale azienda
 * collegata risultano impostati a mano; fonte "Aggiunta a mano" con la data dell'incontro, nota del contesto,
 * cambio di stato se lo stato iniziale non è Nuovo (C6, K1), lista, prossima azione. Nessun job, nessuna spesa.
 * Doppioni: LinkedIn già presente → `linkedin_taken` (anche per corsa sull'indice unico); email già usata →
 * `email_taken` salvo `createAnyway`.
 */
export function createPerson(input: CreatePersonInput): CreatePersonResult {
  const fullName = text(input.fullName);
  const email = text(input.email);
  const phone = text(input.phone);
  const rawLinkedin = text(input.linkedinUrl);
  const profileUrl = rawLinkedin ? normalizeProfileUrl(rawLinkedin) : undefined;
  const keys = profileUrl ? identityKeys(profileUrl) : undefined;

  const issues: FieldIssue[] = [];
  if (!fullName) issues.push({ path: 'fullName', message: 'Inserisci il nome.' });
  if (!rawLinkedin && !email && !phone) issues.push({ path: 'contacts', message: NO_CONTACT_MESSAGE });
  if (rawLinkedin && !keys) issues.push({ path: 'linkedinUrl', message: NOT_A_PROFILE_MESSAGE });
  if (email && !isEmailLike(email)) issues.push({ path: 'email', message: INVALID_EMAIL_MESSAGE });
  issues.push(...meetingIssues(input.meeting, input.nextAction));
  if (issues.length > 0) return { ok: false, code: 'invalid', issues };

  const listError = listProblem(input.listId);
  if (listError) return listError;
  if (input.companyId != null && !getCompany(input.companyId)) return { ok: false, code: 'company_not_found' };

  const linkedinTaken = () => {
    const owner = keys ? findByLinkedinKeys(keys) : undefined;
    const ref = owner === undefined ? undefined : personRefs([owner])[0];
    return ref ? ({ ok: false, code: 'linkedin_taken', prospect: ref } as const) : undefined;
  };
  const taken = linkedinTaken();
  if (taken) return taken;
  if (email && !input.createAnyway) {
    const owners = peopleByEmail(email);
    if (owners.length > 0) return { ok: false, code: 'email_taken', prospects: personRefs(owners) };
  }

  const metOn = input.meeting?.metOn || localDate();
  const values: Partial<Record<ManualColumn, string | number | null>> = {
    full_name: fullName,
    title: text(input.title),
    company_id: input.companyId ?? null,
    company_name: input.companyId != null ? null : text(input.companyName),
    email,
    phone,
    location: text(input.location),
  };
  const written = (Object.keys(values) as ManualColumn[]).filter((c) => values[c] !== null && values[c] !== undefined);
  try {
    const id = db
      .transaction((): number => {
        const now = nowIso();
        const info = db
          .prepare(
            `INSERT INTO prospects (linkedin_url, member_urn, ${written.join(', ')}, created_at, updated_at)
             VALUES (?, ?, ${written.map(() => '?').join(', ')}, ?, ?)`,
          )
          .run(keys?.url ?? null, keys?.memberUrn ?? null, ...written.map((c) => values[c]), now, now);
        const personId = Number(info.lastInsertRowid);
        markManual(personId, written, now);
        addManualSource(personId, metOn);
        addMeetingNote(personId, text(input.meeting?.context), metOn);
        if (input.status && input.status !== 'nuovo') changeStatus(personId, input.status);
        if (input.listId != null) addMembers(input.listId, [personId]);
        if (input.nextAction?.on) setNextAction(personId, { on: input.nextAction.on, text: input.nextAction.text });
        return personId;
      })
      .immediate();
    return { ok: true, id };
  } catch (err) {
    // Corsa: un job ha scritto lo stesso profilo tra il controllo e l'inserimento.
    if (isUniqueViolation(err)) {
      const race = linkedinTaken();
      if (race) return race;
    }
    throw err;
  }
}

export interface AddMeetingInput {
  context?: string | null;
  metOn?: string | null;
  listId?: number | null;
  nextAction?: NextActionFormInput | null;
}

export type AddMeetingResult =
  | { ok: true; replacedNextAction: boolean; sourceCreated: boolean }
  | { ok: false; code: 'invalid'; issues: FieldIssue[] }
  | { ok: false; code: 'prospect_not_found' }
  | { ok: false; code: 'list_archived'; listName: string }
  | { ok: false; code: 'list_not_found' };

/**
 * "Aggiungi l'incontro a <persona>" (C9): fonte "Aggiunta a mano" solo se manca (altrimenti resta con la sua
 * data), la nota del contesto, la lista e la prossima azione del form (sostituisce quella che c'era). Gli altri
 * campi del form non la toccano; la data di aggiunta non cambia (H4); lo stato resta com'è.
 */
export function addMeeting(prospectId: number, input: AddMeetingInput): AddMeetingResult {
  const issues = meetingIssues(input, input.nextAction);
  if (issues.length > 0) return { ok: false, code: 'invalid', issues };
  const listError = listProblem(input.listId);
  if (listError) return listError as AddMeetingResult;
  const metOn = input.metOn || localDate();
  return db
    .transaction((): AddMeetingResult => {
      const person = db.prepare('SELECT next_action_on FROM prospects WHERE id = ?').get(prospectId) as
        | { next_action_on: string | null }
        | undefined;
      if (!person) return { ok: false, code: 'prospect_not_found' };
      const hasManual = db.prepare(`SELECT 1 FROM sources WHERE prospect_id = ? AND kind = 'manual'`).get(prospectId) !== undefined;
      if (!hasManual) addManualSource(prospectId, metOn);
      addMeetingNote(prospectId, text(input.context), metOn);
      if (input.listId != null) addMembers(input.listId, [prospectId]);
      const replacing = Boolean(input.nextAction?.on);
      if (replacing) setNextAction(prospectId, { on: input.nextAction!.on!, text: input.nextAction!.text });
      return { ok: true, replacedNextAction: replacing && person.next_action_on !== null, sourceCreated: !hasManual };
    })
    .immediate();
}

// ---------------------------------------------------------------------------
// Modifiche dalla scheda: LinkedIn (E3), conflitti d'identità (E5), recapiti (E4)
// ---------------------------------------------------------------------------

export type EditPersonInput = ProspectPatch & {
  linkedin_url?: string | null;
  /** E5: l'email è anche di altre persone e l'utente ha scelto "Salva comunque". */
  confirm_email_duplicate?: boolean;
};

export type EditPersonResult =
  | { ok: true }
  | { ok: false; code: 'not_found' | 'contact_required' | 'linkedin_required' | 'invalid_linkedin' | 'linkedin_locked' | 'invalid_email' }
  | { ok: false; code: 'linkedin_taken'; prospect: PersonRef; mergeable: boolean; reason: string | null }
  | { ok: false; code: 'email_taken'; prospects: MergeablePersonRef[] };

/** Persona che ha già l'email, con l'esito di "Unisci" (E7: due profili LinkedIn distinti non si uniscono). */
export type MergeablePersonRef = PersonRef & { mergeable: boolean; reason: string | null };

/** True se la persona ha almeno una fonte portata da un job (qualunque fonte tranne "Aggiunta a mano"). */
function hasJobSources(prospectId: number): boolean {
  return db.prepare(`SELECT 1 FROM sources WHERE prospect_id = ? AND kind <> 'manual' LIMIT 1`).get(prospectId) !== undefined;
}

/** URL LinkedIn di una modifica già normalizzato (`undefined` = non valido). */
export function profileKeysOf(raw: string): IdentityKeys | undefined {
  return identityKeys(normalizeProfileUrl(raw));
}

/**
 * Modifica dalla scheda (PATCH): anagrafica "a mano" (D8), profilo LinkedIn (E3: si aggiunge se manca, si
 * corregge solo con sole fonti manuali, non si rimuove) e controlli d'identità solo quando il valore cambia
 * (E5): un URL di un'altra persona non si salva (con `mergeable`/`reason` per "Unisci", E7); un'email di altre
 * persone chiede "Unisci" o "Salva comunque". Nessuna scrittura se un controllo fallisce.
 */
export function editPerson(id: number, input: EditPersonInput): EditPersonResult {
  return db
    .transaction((): EditPersonResult => {
      const current = readPerson(id);
      if (!current) return { ok: false, code: 'not_found' };

      let newKeys: IdentityKeys | undefined;
      if (input.linkedin_url !== undefined) {
        const raw = cleanText(input.linkedin_url);
        if (!raw) {
          if (current.linkedin_url !== null) return { ok: false, code: 'linkedin_required' };
        } else {
          const keys = profileKeysOf(raw);
          if (!keys) return { ok: false, code: 'invalid_linkedin' };
          if (keys.url !== current.linkedin_url) {
            if (current.linkedin_url !== null && hasJobSources(id)) return { ok: false, code: 'linkedin_locked' };
            const owner = findByLinkedinKeys(keys);
            if (owner !== undefined && owner !== id) {
              const other = readPerson(owner)!;
              const reason = notMergeableReason(current, other, keys.url) ?? null;
              return { ok: false, code: 'linkedin_taken', prospect: personRefs([owner])[0], mergeable: reason === null, reason };
            }
            newKeys = keys;
          }
        }
      }

      if (input.email !== undefined) {
        const email = cleanText(input.email);
        if (email && !isEmailLike(email)) return { ok: false, code: 'invalid_email' };
        const changed = (email ?? '').toLowerCase() !== (current.email ?? '').trim().toLowerCase();
        if (email && changed && !input.confirm_email_duplicate) {
          const owners = peopleByEmail(email, id);
          if (owners.length > 0) {
            const prospects = personRefs(owners).map((ref) => {
              const reason = notMergeableReason(current, readPerson(ref.id)!, newKeys?.url) ?? null;
              return { ...ref, mergeable: reason === null, reason };
            });
            return { ok: false, code: 'email_taken', prospects };
          }
        }
      }

      // E4 sul risultato finale, prima di scrivere qualunque cosa.
      const final = (col: 'email' | 'phone') => (input[col] !== undefined ? cleanText(input[col]) : cleanText(current[col]));
      if ((newKeys?.url ?? current.linkedin_url) === null && !final('email') && !final('phone')) {
        return { ok: false, code: 'contact_required' };
      }

      if (newKeys) {
        db.prepare('UPDATE prospects SET linkedin_url = ?, member_urn = COALESCE(member_urn, ?), updated_at = ? WHERE id = ?').run(
          newKeys.url,
          newKeys.memberUrn ?? null,
          nowIso(),
          id,
        );
      }
      const { linkedin_url: _url, confirm_email_duplicate: _confirm, ...patch } = input;
      updateProspect(id, patch);
      return { ok: true };
    })
    .immediate();
}
