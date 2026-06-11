import type { ContactRow } from '../db/contacts.js';
import { field, truncate } from '../util/fields.js';

/** System prompt che definisce l'ICP di SeVedemo e la regola di routing per ruolo. */
export const SCORING_SYSTEM = `Sei l'analista di lead per SeVedemo, una piattaforma italiana di ricerca lavoro per freelance.

Devi classificare un profilo LinkedIn e assegnarlo a un BUCKET in base al RUOLO della persona:

- bucket "freelance": persone che lavorano (o vogliono lavorare) come freelance / liberi professionisti / P.IVA, in particolare in tech, design, marketing. Sono potenziali UTENTI che cercano lavoro su SeVedemo.
- bucket "azienda": persone che ASSUMONO o DECIDONO le assunzioni: decision maker, recruiter, head hunter, talent acquisition, talent manager, HR, hiring manager, founder, CEO, imprenditori. Sono potenziali CLIENTI da invitare a PUBBLICARE offerte su SeVedemo.
- bucket "scarta": profili non pertinenti (settori non affini, studenti senza segnali, dipendenti generici non decision maker e non freelance, profili poco chiari).

REGOLA DI ROUTING: se la persona ha un ruolo di assunzione/decisione → "azienda". Se è un freelance/P.IVA in cerca di lavoro → "freelance". In caso di ambiguità tra azienda e freelance, scegli in base a chi prende le decisioni di hiring.

SETTORI rilevanti: tech, design, marketing. Profili fuori da questi ambiti hanno fit basso (a meno di forti segnali).

fit_score (0-100): quanto il profilo è allineato all'ICP di SeVedemo (settore affine + segnali chiari + contattabilità). Penalizza profili vaghi, fuori settore o senza segnali. Premia: P.IVA/partita IVA, "freelance", "libero professionista", "open to work", per i freelance; "stiamo assumendo", "we're hiring", ruoli recruiter/talent/founder per le aziende.

short_description: 1-2 frasi in italiano che descrivono chi è la persona (ruolo, settore, segnali salienti).
reason: 1 frase sul perché è (o non è) in linea con SeVedemo.

Rispondi SEMPRE chiamando lo strumento classify_profile.`;

export const CLASSIFY_TOOL = {
  name: 'classify_profile',
  description: 'Classifica il profilo LinkedIn per la pipeline SeVedemo.',
  input_schema: {
    type: 'object' as const,
    properties: {
      bucket: { type: 'string', enum: ['freelance', 'azienda', 'scarta'] },
      role: { type: 'string', description: 'Ruolo normalizzato, es. "UX Designer freelance" o "Talent Acquisition"' },
      is_decision_maker: { type: 'boolean' },
      sector: { type: 'string', enum: ['tech', 'design', 'marketing', 'other'] },
      fit_score: { type: 'integer', minimum: 0, maximum: 100 },
      short_description: { type: 'string' },
      reason: { type: 'string' },
      signals: {
        type: 'object',
        properties: {
          pIva: { type: 'boolean' },
          openToWork: { type: 'boolean' },
          hiring: { type: 'boolean' },
        },
      },
    },
    required: ['bucket', 'role', 'sector', 'fit_score', 'short_description', 'reason'],
  },
};

/** Costruisce il testo del profilo da passare al modello, a partire dalla riga contatto. */
export function buildProfileText(c: ContactRow): string {
  let experience = '';
  if (c.raw_json) {
    try {
      const raw = JSON.parse(c.raw_json);
      const exp = field(raw, 'experience') ?? field(field(raw, 'source'), 'experience');
      if (exp) experience = truncate(exp, 1200);
    } catch {
      /* ignore */
    }
  }
  return [
    `Nome: ${c.full_name ?? 'n/d'}`,
    `Headline: ${c.headline ?? 'n/d'}`,
    `Località: ${c.location ?? 'n/d'}`,
    `Azienda: ${c.company ?? 'n/d'}`,
    `About: ${truncate(c.about, 1500) || 'n/d'}`,
    experience ? `Esperienze: ${experience}` : '',
    `Fonte estrazione: ${c.source_strategy ?? 'n/d'}${c.source_post_url ? ` (post: ${c.source_post_url})` : ''}`,
  ]
    .filter(Boolean)
    .join('\n');
}
