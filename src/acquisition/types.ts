/**
 * Tipi grezzi dell'acquisizione: cosa i mapper puri estraggono dagli item degli actor,
 * prima dell'upsert come prospect (`upsertProspect`) e della fonte (`addSource`).
 */

/** Fonte da cui arriva un candidato: coincide con `sources.kind` (esclusa `manual`). */
export type CandidateKind = 'post_reaction' | 'post_comment' | 'company_employees';

/** Un candidato grezzo letto da un actor. */
export interface RawCandidate {
  /** URL LinkedIn normalizzato (`normalizeLinkedinUrl`): è la chiave di identità del prospect. */
  linkedinUrl: string;
  /**
   * Id membro (`ACoAA…`) quando l'actor lo espone: seconda chiave d'identità
   * (`prospects.member_urn`), lega la forma id e la forma slug della stessa persona.
   */
  memberUrn?: string;
  fullName?: string;
  headline?: string;
  /** Payload originale dell'item, per audit (`sources.raw_json`). */
  raw: unknown;
}

/** Chi ha reagito a un post (`apimaestro/linkedin-post-reactions`). */
export interface ReactionCandidate extends RawCandidate {
  kind: 'post_reaction';
  /** Tipo di reazione in maiuscolo (`LIKE`, `PRAISE`, `EMPATHY`, …) → `sources.reaction_type`. */
  reactionType?: string;
  /** URL del post echeggiato dall'actor (`_metadata.post_url`). */
  postUrl?: string;
}

/** Chi ha commentato (o risposto a un commento) un post. */
export interface CommentCandidate extends RawCandidate {
  kind: 'post_comment';
  /** Testo del commento → `sources.comment_text`. */
  commentText?: string;
  postUrl?: string;
}

/** Dipendente di un'azienda (`harvestapi/linkedin-company-employees`). */
export interface EmployeeCandidate extends RawCandidate {
  kind: 'company_employees';
  /** Ruolo corrente (posizione attuale). */
  title?: string;
  /** Nome dell'azienda corrente, come letto dall'actor. */
  companyName?: string;
  location?: string;
  /** Bio del profilo: presente solo in modalità Full / Full+email. */
  about?: string;
  /** Esperienze lavorative (item grezzi): presenti solo in modalità Full / Full+email. */
  experience?: unknown[];
  /** Email trovata dalla modalità Full+email (best-effort, layout non confermato). */
  email?: string;
}

/** Esito di un mapper su una lista di item: candidati validi + item scartati (senza URL). */
export interface MapResult<T extends RawCandidate> {
  candidates: T[];
  /** Item senza un URL LinkedIn normalizzabile (profili privati/anonimi) → `skipped_no_url`. */
  skipped: number;
}
