import Anthropic from '@anthropic-ai/sdk';
import pLimit from 'p-limit';
import { z } from 'zod';
import { config, requireAnthropic } from '../config.js';
import type { ContactRow } from '../db/contacts.js';
import { SCORING_SYSTEM, CLASSIFY_TOOL, buildProfileText } from './rubric.js';

let _client: Anthropic | null = null;
function client(): Anthropic {
  requireAnthropic();
  if (!_client) _client = new Anthropic({ apiKey: config.anthropicApiKey });
  return _client;
}

const ScoreSchema = z.object({
  bucket: z.enum(['freelance', 'azienda', 'scarta']),
  role: z.string(),
  is_decision_maker: z.boolean().optional(),
  sector: z.enum(['tech', 'design', 'marketing', 'other']),
  fit_score: z.number().int().min(0).max(100),
  short_description: z.string(),
  reason: z.string(),
  signals: z
    .object({
      pIva: z.boolean().optional(),
      openToWork: z.boolean().optional(),
      hiring: z.boolean().optional(),
    })
    .partial()
    .optional(),
});

export type ScoreResult = z.infer<typeof ScoreSchema>;

/** Classifica un singolo profilo. Forza l'uso del tool per ottenere JSON valido. */
export async function scoreOne(contact: ContactRow): Promise<ScoreResult> {
  const msg = await client().messages.create({
    model: config.scoringModel,
    max_tokens: 700,
    system: SCORING_SYSTEM,
    tools: [CLASSIFY_TOOL as any],
    tool_choice: { type: 'tool', name: 'classify_profile' },
    messages: [{ role: 'user', content: buildProfileText(contact) }],
  });

  const block = msg.content.find((b) => b.type === 'tool_use') as
    | { type: 'tool_use'; input: unknown }
    | undefined;
  if (!block) throw new Error('Nessun tool_use nella risposta di scoring.');
  return ScoreSchema.parse(block.input);
}

/** Classifica più profili in concorrenza limitata. Ritorna [contactId, risultato | errore]. */
export async function scoreMany(
  contacts: ContactRow[],
): Promise<Array<{ id: number; result?: ScoreResult; error?: string }>> {
  const limit = pLimit(config.scoringConcurrency);
  return Promise.all(
    contacts.map((c) =>
      limit(async () => {
        try {
          const result = await scoreOne(c);
          return { id: c.id, result };
        } catch (err) {
          return { id: c.id, error: err instanceof Error ? err.message : String(err) };
        }
      }),
    ),
  );
}
