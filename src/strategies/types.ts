/** Un candidato grezzo prodotto da una strategia, prima di enrichment e scoring. */
export interface RawCandidate {
  /** URL LinkedIn normalizzato: è la chiave di dedup. */
  linkedinUrl: string;
  fullName?: string;
  headline?: string;
  /** Se il candidato proviene da un post (reactors), il link del post di riferimento. */
  sourcePostUrl?: string;
  /**
   * Sotto-fonte all'interno della strategia (spec influencer-post-respondents): da
   * quale ramo arriva il candidato. Nullable → le strategie esistenti non lo settano.
   */
  sourceDetail?: 'commenter' | 'tagged-person' | 'company-expansion';
  /** Payload originale dell'actor, per audit. */
  raw: unknown;
}

/**
 * Una strategia di estrazione. È un plug-in intercambiabile: produce candidati grezzi.
 * Il BUCKET finale (freelance/azienda) NON è deciso qui ma da Claude in base al ruolo.
 */
export interface Strategy {
  id: string;
  description: string;
  /** Se true, richiede LINKEDIN_LI_AT ed è soggetta al cap conservativo. */
  requiresCookie: boolean;
  /** Bucket prevalente atteso (solo indicativo, per la documentazione). */
  bucketHint: 'freelance' | 'azienda' | 'misto';
  /** Estrae fino a `limit` candidati. */
  source(limit: number): Promise<RawCandidate[]>;
}
