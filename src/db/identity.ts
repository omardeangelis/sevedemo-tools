import { memberIdOf, normalizeLinkedinUrl } from '../util/fields.js';
import { db, nowIso } from './index.js';
import { mergePeopleAuto } from './person-merge.js';

/*
 * Identità dei prospect (steering crm-foundation 2026-09-16). La stessa persona arriva in due forme:
 * lo slug pubblico `/in/<slug>` (commenti, sourcing) e l'id membro `ACoAA…` (reazioni, spesso anche
 * come URL `/in/ACoAA…`). `linkedin_url` resta la chiave unica e passa allo slug appena è noto;
 * `member_urn` è la seconda chiave (unica se presente). Quando una fonte rivela che due prospect sono
 * la stessa persona si uniscono (`mergeProspects`): fonti, liste, attività e analisi non si perdono.
 */

/** Chiavi d'identità normalizzate di un input. */
export interface IdentityKeys {
  /** URL normalizzato così come è arrivato (slug o forma id membro). */
  url: string;
  /** L'URL, se è uno slug pubblico. */
  vanityUrl?: string;
  memberUrn?: string;
}

interface IdentityRow {
  id: number;
  /** Nullo per le persone aggiunte a mano senza LinkedIn (people-first-crm E2). */
  linkedin_url: string | null;
  member_urn: string | null;
}

/** Chiavi da URL (qualunque forma) + id membro opzionale; `undefined` se l'URL non è LinkedIn. */
export function identityKeys(linkedinUrl: unknown, memberUrn?: unknown): IdentityKeys | undefined {
  const url = normalizeLinkedinUrl(linkedinUrl);
  if (!url) return undefined;
  const urnInUrl = memberIdOf(url);
  return { url, vanityUrl: urnInUrl ? undefined : url, memberUrn: memberIdOf(memberUrn) ?? urnInUrl };
}

function rowById(id: number): IdentityRow | undefined {
  return db.prepare('SELECT id, linkedin_url, member_urn FROM prospects WHERE id = ?').get(id) as IdentityRow | undefined;
}

function rowByUrl(url: string): IdentityRow | undefined {
  return db.prepare('SELECT id, linkedin_url, member_urn FROM prospects WHERE linkedin_url = ?').get(url) as
    | IdentityRow
    | undefined;
}

/** Per id membro: colonna `member_urn` o, in mancanza, URL in forma id membro. */
function rowByUrn(urn: string): IdentityRow | undefined {
  return db
    .prepare(
      `SELECT id, linkedin_url, member_urn FROM prospects WHERE member_urn = ? OR linkedin_url = ?
       ORDER BY member_urn IS NULL LIMIT 1`,
    )
    .get(urn, `https://www.linkedin.com/in/${urn}`) as IdentityRow | undefined;
}

/**
 * Persona che ha già queste chiavi LinkedIn (URL o id membro), per i controlli dei doppioni degli inserimenti
 * e delle modifiche manuali (people-first-crm C7, E5). Non unisce nulla.
 */
export function findByLinkedinKeys(keys: IdentityKeys): number | undefined {
  return (rowByUrl(keys.url) ?? (keys.memberUrn ? rowByUrn(keys.memberUrn) : undefined))?.id;
}

function urnOf(row: IdentityRow): string | undefined {
  return row.member_urn ?? memberIdOf(row.linkedin_url);
}

/** Due id membro possono appartenere alla stessa persona solo se uno manca o coincidono. */
function compatible(a: string | null | undefined, b: string | null | undefined): boolean {
  return !a || !b || a === b;
}

/**
 * Omonimo nella forma opposta: per un input solo-id, l'unico prospect solo-slug (senza id membro)
 * con stesso nome e headline; per un input solo-slug, l'unico prospect in forma id membro. Nome e
 * headline devono esserci entrambi; più omonimi → nessun aggancio. Le persone senza LinkedIn (aggiunte a
 * mano) non si agganciano mai per nome: si uniscono solo con "Unisci" (people-first-crm E1).
 */
function nameTwin(keys: IdentityKeys, person: { fullName: string | null; headline: string | null }): IdentityRow | undefined {
  if (!person.fullName || !person.headline) return undefined;
  if (Boolean(keys.vanityUrl) === Boolean(keys.memberUrn)) return undefined;
  const rows = db
    .prepare('SELECT id, linkedin_url, member_urn FROM prospects WHERE full_name = ? AND headline = ? AND linkedin_url IS NOT NULL')
    .all(person.fullName, person.headline) as IdentityRow[];
  const twins = rows.filter((r) => {
    const urnOnly = memberIdOf(r.linkedin_url) !== undefined;
    return keys.vanityUrl ? urnOnly : !urnOnly && r.member_urn === null;
  });
  return twins.length === 1 ? twins[0] : undefined;
}

/**
 * Prospect che corrisponde alle chiavi (per `upsertProspect`, dentro la sua transazione): per URL,
 * poi per id membro, poi — solo se `person` è passato — per omonimo nella forma opposta. Se URL e id
 * membro puntano a due prospect diversi e compatibili, unisce il secondo nel primo.
 */
export function resolveProspect(
  keys: IdentityKeys,
  person?: { fullName: string | null; headline: string | null },
): { id?: number; mergedIds: number[] } {
  const byUrl = rowByUrl(keys.url);
  const byUrn = keys.memberUrn ? rowByUrn(keys.memberUrn) : undefined;
  if (byUrl && byUrn && byUrl.id !== byUrn.id) {
    // Slug già legato a un altro id membro: evidenze in conflitto, vince l'URL senza unire.
    if (!compatible(urnOf(byUrl), keys.memberUrn)) return { id: byUrl.id, mergedIds: [] };
    mergeProspects(byUrl.id, byUrn.id);
    return { id: byUrl.id, mergedIds: [byUrn.id] };
  }
  const found = byUrl ?? byUrn ?? (person ? nameTwin(keys, person) : undefined);
  return { id: found?.id, mergedIds: [] };
}

/**
 * Scrive le chiavi sul prospect: lo slug sostituisce l'URL attuale (forma id membro o slug
 * cambiato), l'id membro si aggiunge se manca. Mai un valore già usato da un altro prospect.
 */
export function applyIdentity(id: number, keys: IdentityKeys): void {
  const row = rowById(id);
  if (!row) return;
  const vanityFree = keys.vanityUrl && keys.vanityUrl !== row.linkedin_url && !rowByUrl(keys.vanityUrl);
  const url = vanityFree ? keys.vanityUrl! : row.linkedin_url;
  let urn = row.member_urn;
  const candidate = memberIdOf(row.linkedin_url) ?? keys.memberUrn;
  if (!urn && candidate) {
    const holder = rowByUrn(candidate);
    if (!holder || holder.id === id) urn = candidate;
  }
  if (url === row.linkedin_url && urn === row.member_urn) return;
  db.prepare('UPDATE prospects SET linkedin_url = ?, member_urn = ?, updated_at = ? WHERE id = ?').run(url, urn, nowIso(), id);
}

/**
 * Unisce il prospect `dropId` in `keepId` e lo cancella (unioni automatiche dei job): delega a
 * `mergePeopleAuto` (`db/person-merge.ts`, people-first-crm E9). Fonti, membership, attività e analisi passano a
 * `keepId`; i dati impostati a mano su una qualsiasi delle due restano (il più recente se su entrambe), il
 * resto in backfill; stato dal cambio più recente; `created_at` il più vecchio; `apollo_matched_at` il più
 * recente; URL = lo slug pubblico tra i due, id membro = quello noto.
 */
export function mergeProspects(keepId: number, dropId: number): void {
  mergePeopleAuto(keepId, dropId);
}

/**
 * Per l'enrichment: il provider restituisce l'URL canonico (slug) e/o l'id membro del prospect `id`.
 * `id` resta (è il prospect su cui si sta lavorando), assorbe i duplicati compatibili che hanno già
 * quelle chiavi e poi le prende. Lancia se `id` non esiste; un URL non LinkedIn non cambia nulla.
 */
export function setProspectIdentity(
  id: number,
  input: { linkedinUrl?: unknown; memberUrn?: unknown },
): { id: number; mergedIds: number[] } {
  return db.transaction(() => {
    const current = rowById(id);
    if (!current) throw new Error(`Persona inesistente: ${id}`);
    const keys = identityKeys(input.linkedinUrl ?? current.linkedin_url, input.memberUrn);
    if (!keys) return { id, mergedIds: [] };

    const mergedIds: number[] = [];
    const bySlug = keys.vanityUrl ? rowByUrl(keys.vanityUrl) : undefined;
    if (bySlug && bySlug.id !== id && compatible(urnOf(bySlug), urnOf(rowById(id)!) ?? keys.memberUrn)) {
      mergeProspects(id, bySlug.id);
      mergedIds.push(bySlug.id);
    }
    const byUrn = keys.memberUrn ? rowByUrn(keys.memberUrn) : undefined;
    if (byUrn && byUrn.id !== id && compatible(urnOf(rowById(id)!), keys.memberUrn)) {
      mergeProspects(id, byUrn.id);
      mergedIds.push(byUrn.id);
    }
    applyIdentity(id, keys);
    return { id, mergedIds };
  })();
}
