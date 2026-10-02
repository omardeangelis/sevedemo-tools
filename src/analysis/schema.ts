import { z } from 'zod';
import { FIT_LEVELS } from '../db/schema.js';

/*
 * Forma dell'analisi AI di un prospect (crm-foundation T11, D8/D12): riassunto, 3 angoli di
 * apertura motivati, fit leggero rispetto all'ICP. Lo schema zod è la verità: valida la risposta
 * del modello (anche in modalità JSON-only) e genera il JSON Schema per `output_config.format`.
 * Con almeno un servizio dell'utente la risposta porta anche il servizio più affine e il perché
 * (own-profile-services F2); senza, la forma resta quella di prima di un carattere (F6).
 */

export const SUMMARY_MAX_CHARS = 600;
export const ANGLES_COUNT = 3;

export const AnalysisSchema = z.object({
  summary: z
    .string()
    .trim()
    .min(1)
    .max(SUMMARY_MAX_CHARS)
    .describe(`Riassunto neutro del profilo, in italiano, al massimo ${SUMMARY_MAX_CHARS} caratteri.`),
  angles: z
    .array(
      z.object({
        title: z.string().trim().min(1).describe("Titolo breve dell'angolo di apertura."),
        rationale: z
          .string()
          .trim()
          .min(1)
          .describe("Perché funziona: l'elemento concreto di bio, esperienze o segnali a cui è ancorato."),
      }),
    )
    .length(ANGLES_COUNT)
    .describe(`Esattamente ${ANGLES_COUNT} angoli di apertura, dal più promettente.`),
  fit: z.enum(FIT_LEVELS).describe("Fit rispetto all'ICP: alto, medio o basso."),
  fit_reason: z.string().trim().min(1).describe('Una frase che motiva il fit.'),
});

/**
 * La forma con il servizio più affine (F2). Stringhe libere, non un enum dei nomi: una risposta che non
 * nomina un servizio esistente resta un'analisi valida e il campo resta vuoto (F3), lo decide chi la salva.
 */
export const ServiceAnalysisSchema = AnalysisSchema.extend({
  best_service: z
    .string()
    .trim()
    .describe("Nome del servizio dell'utente più affine a questa persona, scritto come nell'elenco dei servizi."),
  best_service_reason: z.string().trim().describe('Una frase sul perché quel servizio è il più affine.'),
});

export type AnalysisOutput = z.infer<typeof AnalysisSchema> &
  Partial<Pick<z.infer<typeof ServiceAnalysisSchema>, 'best_service' | 'best_service_reason'>>;

/**
 * Parole chiave che structured outputs non accetta: i limiti (lunghezze, esattamente 3 angoli)
 * restano nelle `description` per il modello e li fa rispettare il parse zod.
 */
const UNSUPPORTED_KEYWORDS = new Set([
  '$schema',
  'minLength',
  'maxLength',
  'maxItems',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'pattern',
]);

function toStructuredOutputSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toStructuredOutputSchema);
  if (node === null || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (UNSUPPORTED_KEYWORDS.has(key)) continue;
    // `minItems` è ammesso solo a 0 o 1.
    if (key === 'minItems' && typeof value === 'number' && value > 1) continue;
    out[key] = toStructuredOutputSchema(value);
  }
  if (out.type === 'object') out.additionalProperties = false;
  return out;
}

/** JSON Schema per `output_config: {format: {type: 'json_schema', schema}}` (derivato da `AnalysisSchema`). */
export const ANALYSIS_JSON_SCHEMA = toStructuredOutputSchema(z.toJSONSchema(AnalysisSchema)) as Record<string, unknown>;
const SERVICE_ANALYSIS_JSON_SCHEMA = toStructuredOutputSchema(z.toJSONSchema(ServiceAnalysisSchema)) as Record<string, unknown>;

/** Lo schema della risposta: con il servizio più affine solo quando il prompt lo chiede (`AnalysisInput.asksService`). */
export function analysisJsonSchema(withService: boolean): Record<string, unknown> {
  return withService ? SERVICE_ANALYSIS_JSON_SCHEMA : ANALYSIS_JSON_SCHEMA;
}

export type ParsedAnalysis = { ok: true; value: AnalysisOutput } | { ok: false; error: string };

/**
 * Legge il testo della risposta: JSON (tollerante a un blocco ```json``` o a testo attorno in
 * modalità JSON-only) validato con `AnalysisSchema`, o con `ServiceAnalysisSchema` se il servizio più affine
 * è stato chiesto (`withService`). Mai lancia: `ok:false` con il motivo.
 */
export function parseAnalysis(text: string, opts: { withService?: boolean } = {}): ParsedAnalysis {
  let raw = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(raw);
  if (fenced) raw = fenced[1];
  else if (!raw.startsWith('{')) {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) raw = raw.slice(start, end + 1);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'la risposta non è JSON valido' };
  }
  const parsed = (opts.withService ? ServiceAnalysisSchema : AnalysisSchema).safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || '(radice)'}: ${i.message}`);
    return { ok: false, error: issues.join('; ') };
  }
  return { ok: true, value: parsed.data };
}
