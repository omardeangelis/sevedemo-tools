import { config } from '../config.js';
import { db } from '../db/index.js';
import {
  applyProgressiveEnrichment,
  isEnrichmentFresh,
  updateEmail,
  getByIds,
  type ContactRow,
} from '../db/contacts.js';
import { ACTORS } from '../apify/actors.js';
import { enrichProfileDetails } from '../enrich/profile-detail.js';
import { draftMany } from '../email/draft.js';
import { hasEmail } from '../util/fields.js';

export interface EnrichSelectionParams {
  date: string;
  /** Restringe a un bucket della Selezione (es. azione "Arricchisci email" del bucket). */
  bucket?: string;
  /** Restringe a un singolo contatto (azione per-riga). */
  contactId?: number;
}

export interface EnrichSummary {
  /** Membri "da arricchire" (senza email) considerati. = attempted + skippedFresh. */
  eligible: number;
  /** Profili effettivamente passati all'actor (eleggibili e non freschi). */
  attempted: number;
  /** Quanti hanno ottenuto un'email dopo il tentativo. */
  emailsRecovered: number;
  /** Bozze generate (sui soli contatti con email recuperata). */
  draftsGenerated: number;
  /** Saltati perché tentati di recente (freshness) → nessuna spesa Apify. */
  skippedFresh: number;
}

/**
 * Enrichment progressivo on-demand mirato al **recupero email** dei membri "da
 * arricchire" di una Selezione **in revisione**. Per ogni target chiama apimaestro,
 * scrive in modo status-preserving (timbrando anche i miss), e per chi recupera
 * un'email genera la bozza (stesso percorso `draftMany`). Idempotente per freshness:
 * un contatto tentato di recente è saltato finché il tentativo non è "stale".
 *
 * I contatti di una Selezione `exported` non sono mai bersaglio (filtro `in_review`).
 */
export async function enrichSelectionEmails(params: EnrichSelectionParams): Promise<EnrichSummary> {
  const { date, bucket, contactId } = params;

  const rows = db
    .prepare(
      `SELECT c.* FROM daily_selection d
         JOIN contacts c ON c.id = d.contact_id
        WHERE d.date = ? AND d.state = 'in_review'
          AND (? IS NULL OR d.bucket = ?)
          AND (? IS NULL OR d.contact_id = ?)
        ORDER BY d.bucket, d.rank`,
    )
    .all(date, bucket ?? null, bucket ?? null, contactId ?? null, contactId ?? null) as ContactRow[];

  // "Da arricchire" = senza email (predicato canonico).
  const withoutEmail = rows.filter((r) => !hasEmail(r.email));
  const summary: EnrichSummary = {
    eligible: withoutEmail.length,
    attempted: 0,
    emailsRecovered: 0,
    draftsGenerated: 0,
    skippedFresh: 0,
  };

  // Freshness: salta chi è stato tentato di recente (anti-spesa).
  const targets = withoutEmail.filter((r) => {
    if (isEnrichmentFresh(r.id, config.freshnessDays)) {
      summary.skippedFresh += 1;
      return false;
    }
    return true;
  });
  if (targets.length === 0) return summary;

  const enrichment = await enrichProfileDetails(targets.map((r) => r.linkedin_url));

  for (const r of targets) {
    // Timbra il tentativo anche sul miss (e ?? {}): distingue "tentato" da "mai tentato".
    applyProgressiveEnrichment(r.id, enrichment.get(r.linkedin_url) ?? {}, ACTORS.profileDetail);
    summary.attempted += 1;
  }

  // Chi ora ha un'email → genera la bozza (riapre il guard di email-draft-guard).
  const recovered = getByIds(targets.map((r) => r.id)).filter((r) => hasEmail(r.email));
  summary.emailsRecovered = recovered.length;

  if (recovered.length > 0) {
    const drafts = await draftMany(recovered);
    for (const d of drafts) {
      if (d.draft) {
        updateEmail(d.id, d.draft.subject, d.draft.body);
        summary.draftsGenerated += 1;
      }
    }
  }

  return summary;
}
