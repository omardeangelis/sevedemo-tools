import { z } from 'zod';
import { toStructuredOutputSchema } from '../analysis/schema.js';
import { PROFILE_FIELD_KEYS, type ProfileFieldKey } from '../db/profile.js';
import { GENERATION_SOURCES } from './sources.js';

/*
 * Forma della proposta di profilo e servizi (own-profile-services T26: E2, E5, E6, E13). Solo i campi **generabili**
 * (`PROFILE_FIELD_KEYS`) e i servizi: gli indirizzi che sono input della generazione non si propongono mai (E2). Ogni
 * voce cita le fonti da cui deriva (E5). Lo schema stretto genera il JSON Schema di structured outputs; la lettura
 * della risposta è più larga (chiavi in più, fonti qualunque) perché le voci fuori regola si **scartano e si contano**
 * (E6), non fanno fallire la proposta intera.
 */

/** Servizi proposti al massimo: un elenco più lungo non è un catalogo da rivedere voce per voce. */
export const PROPOSAL_MAX_SERVICES = 8;

const SOURCES_TEXT = `Fonti da cui deriva la voce, fra ${GENERATION_SOURCES.join(', ')}: almeno una, solo quelle che lo dicono davvero.`;

const FIELD_DESCRIPTIONS: Record<ProfileFieldKey, string> = {
  company_name: "Nome dell'attività (per un freelance anche il suo nome e cognome).",
  company_description: 'Di cosa si occupa, in una o due frasi.',
  company_offering: 'Cosa offre, in breve: i servizi in una riga.',
  positioning: 'Posizionamento: per chi lavora e che cosa lo distingue.',
  proof_points: 'Prove e risultati concreti che le fonti citano: numeri, casi, clienti.',
  tone_of_voice: 'Tono di voce di come scrive (dai post e dal sito).',
};

const proposedValue = (description: string) =>
  z
    .object({
      value: z.string().trim().min(1).describe(description),
      sources: z.array(z.enum(GENERATION_SOURCES)).describe(SOURCES_TEXT),
    })
    .nullable()
    .describe(`${description} null se le fonti non lo dicono.`);

const optionalText = (description: string) => z.string().trim().nullable().describe(`${description} null se le fonti non lo dicono.`);

const ProposedServiceSchema = z.object({
  name: z.string().trim().min(1).describe('Nome breve del servizio; se è uno dei servizi già scritti dall\'utente, lo stesso nome.'),
  description: optionalText('Cosa comprende il servizio.'),
  audience: optionalText('A chi serve.'),
  problem: optionalText('Quale problema risolve.'),
  proof: optionalText('Prove e risultati che lo sostengono.'),
  sources: z.array(z.enum(GENERATION_SOURCES)).describe(SOURCES_TEXT),
});

/** Lo schema stretto della risposta: da qui il JSON Schema per `output_config.format`. */
const ProposalSchema = z.object({
  fields: z.object(Object.fromEntries(PROFILE_FIELD_KEYS.map((k) => [k, proposedValue(FIELD_DESCRIPTIONS[k])])) as Record<
    ProfileFieldKey,
    ReturnType<typeof proposedValue>
  >),
  services: z
    .array(ProposedServiceSchema)
    .max(PROPOSAL_MAX_SERVICES)
    .describe(`I servizi che l'utente vende, uno per voce, dal più importante; al massimo ${PROPOSAL_MAX_SERVICES}.`),
});

export const PROPOSAL_JSON_SCHEMA = toStructuredOutputSchema(z.toJSONSchema(ProposalSchema)) as Record<string, unknown>;

// ---------------------------------------------------------------------------
// Lettura larga della risposta
// ---------------------------------------------------------------------------

const looseSources = z.array(z.string()).catch([]);
const looseText = z.string().trim().nullable().optional().catch(null);

/** Un valore proposto letto in modo tollerante: le fonti sconosciute si filtrano dopo, contro quelle lette. */
const LooseValue = z.object({ value: z.string().trim().min(1), sources: looseSources }).nullable().catch(null);
const LooseService = z.object({
  name: z.string().trim().min(1),
  description: looseText,
  audience: looseText,
  problem: looseText,
  proof: looseText,
  sources: looseSources,
});

/**
 * Risposta letta: `fields` con qualunque chiave (quelle non generabili si scartano, E2), servizi in ordine. Una voce
 * illeggibile (valore vuoto, servizio senza nome) vale come non proposta; una risposta senza `fields` o `services` no.
 */
export const LooseProposalSchema = z.object({
  fields: z.record(z.string(), LooseValue),
  services: z.array(LooseService.nullable().catch(null)).transform((list) => list.filter((s) => s !== null)),
});
export type LooseProposal = z.infer<typeof LooseProposalSchema>;
