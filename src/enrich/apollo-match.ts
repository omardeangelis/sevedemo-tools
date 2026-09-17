import { mapPerson, type ApolloPerson } from '../apollo/mappers/people.js';
import type { PeopleMatchDetail } from '../apollo/requests.js';
import { addActivity } from '../db/activities.js';
import { db, nowIso } from '../db/index.js';
import { field, hasEmail, normalizeProfileUrl } from '../util/fields.js';

/*
 * Applicazione dell'esito di `people/bulk_match` a un prospect (apollo-lookalike T10, SPEC G4–G7, F6).
 * Apollo è un secondo provider di arricchimento **solo per l'email di lavoro**: non tocca mai
 * `enriched_at` né `enrichment_attempted_at` (lo stato derivato "arricchito" resta di Apify, G5) e non
 * usa l'id Apollo per l'identità del prospect.
 */

/** `email_found` = Apollo ha restituito un'email di lavoro · `no_email` = risposta senza email · `not_found` = id sparito. */
export type ApolloMatchOutcome = 'email_found' | 'no_email' | 'not_found';

export interface ApolloMatchResult {
  prospectId: number;
  outcome: ApolloMatchOutcome;
  /** Il prospect ha un'email dopo l'applicazione (anche se c'era già). */
  withEmail: boolean;
  /** L'id Apollo della persona è già di un **altro** prospect: non scritto (conteggio `apollo_id_taken`). */
  apolloIdTaken: boolean;
}

interface MatchRow {
  id: number;
  email: string | null;
  apollo_person_id: string | null;
}

/** Stringhe vuote o di soli spazi valgono "assente". */
function clean(value: string | undefined): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

const missing = (col: string) => `CASE WHEN ${col} IS NULL OR TRIM(${col}) = '' THEN COALESCE(?, ${col}) ELSE ${col} END`;

/**
 * Scrive su `prospectId`, in una transazione, la risposta di Apollo per il suo dettaglio (`person`
 * `undefined` = Apollo ha risposto senza abbinamento): email di lavoro, titolo e nome azienda **solo se
 * mancanti**; `apollo_person_id` solo se il prospect non ne ha uno e nessun altro lo possiede (F6);
 * **sempre** `apollo_matched_at = now` (G6); attività `enrichment` con provider Apollo ed esito (G7).
 * Va chiamata solo a risposta ricevuta: su errore del provider il prospect resta "da cercare".
 */
export function applyApolloMatch(
  prospectId: number,
  person: ApolloPerson | undefined,
  opts: { now?: string } = {},
): ApolloMatchResult {
  return db.transaction((): ApolloMatchResult => {
    const now = opts.now ?? nowIso();
    const current = db.prepare('SELECT id, email, apollo_person_id FROM prospects WHERE id = ?').get(prospectId) as
      | MatchRow
      | undefined;
    if (!current) return { prospectId, outcome: 'not_found', withEmail: false, apolloIdTaken: false };

    // `mapPerson` scarta già il segnaposto `email_not_unlocked@…`; le email personali non si chiedono mai.
    const email = clean(person?.email);
    db.prepare(
      `UPDATE prospects SET
         email = ${missing('email')}, title = ${missing('title')}, company_name = ${missing('company_name')},
         apollo_matched_at = ?, updated_at = ?
       WHERE id = ?`,
    ).run(email, clean(person?.title), clean(person?.companyName), now, now, prospectId);

    let apolloIdTaken = false;
    const apolloId = clean(person?.apolloId);
    if (apolloId !== null && current.apollo_person_id === null) {
      const owner = db.prepare('SELECT id FROM prospects WHERE apollo_person_id = ?').pluck().get(apolloId) as number | undefined;
      if (owner === undefined) {
        db.prepare('UPDATE prospects SET apollo_person_id = ? WHERE id = ? AND apollo_person_id IS NULL').run(apolloId, prospectId);
      } else {
        apolloIdTaken = true;
      }
    }

    const after = db.prepare('SELECT email FROM prospects WHERE id = ?').pluck().get(prospectId) as string | null;
    const withEmail = hasEmail(after);
    const outcome: ApolloMatchOutcome = email !== null ? 'email_found' : 'no_email';
    addActivity({
      prospectId,
      kind: 'enrichment',
      body:
        outcome === 'email_found'
          ? 'Arricchimento via Apollo: email di lavoro trovata'
          : 'Arricchimento via Apollo: nessuna email disponibile',
      meta: { provider: 'apollo', outcome, with_email: withEmail, ...(apolloIdTaken ? { apollo_id_taken: true } : {}) },
      occurredAt: now,
    });
    return { prospectId, outcome, withEmail, apolloIdTaken };
  })();
}

/** Chiave di confronto di un dettaglio o di una persona: id Apollo, altrimenti URL del profilo normalizzato. */
function detailKey(detail: PeopleMatchDetail): string | undefined {
  if (typeof detail.id === 'string' && detail.id.trim() !== '') return `id:${detail.id.trim()}`;
  const url = normalizeProfileUrl(detail.linkedin_url);
  return url ? `url:${url}` : undefined;
}

/**
 * Allinea `matches[]` di `people/bulk_match` ai dettagli richiesti. Apollo li restituisce **nello stesso
 * ordine** dei dettagli, con `null` per chi non è abbinato e la stessa persona ripetuta se due dettagli la
 * identificano: si allinea per posizione. Se la lunghezza non coincide (risposta anomala) l'ordine non è
 * affidabile e si abbina per chiave (id Apollo o URL del profilo): meglio "non disponibile" che l'email
 * di un altro. Ritorna `null` se la risposta non ha `matches[]` (da trattare come errore del provider).
 */
export function alignMatches(details: readonly PeopleMatchDetail[], response: unknown): Array<ApolloPerson | undefined> | null {
  const matches = field(response, 'matches');
  if (!Array.isArray(matches)) return null;
  const people = matches.map((m) => mapPerson(m) ?? undefined);
  if (people.length === details.length) return people;

  return details.map((detail) => {
    const key = detailKey(detail);
    if (key === undefined) return undefined;
    return people.find((p) => p !== undefined && (key.startsWith('id:') ? `id:${p.apolloId}` : `url:${p.linkedinUrl}`) === key);
  });
}

/**
 * Crediti consumati dal lotto: `credits_consumed` della risposta; se assente o illeggibile, le persone
 * abbinate distinte (Apollo addebita una volta la persona ripetuta).
 */
export function creditsConsumed(response: unknown, people: ReadonlyArray<ApolloPerson | undefined>): number {
  const declared = field(response, 'credits_consumed');
  if (typeof declared === 'number' && Number.isFinite(declared) && declared >= 0) return declared;
  return new Set(people.flatMap((p) => (p ? [p.apolloId ?? p.linkedinUrl ?? ''] : []))).size;
}
