import Anthropic from '@anthropic-ai/sdk';
import pLimit from 'p-limit';
import { z } from 'zod';
import { config, requireAnthropic } from '../config.js';
import type { ContactRow } from '../db/contacts.js';
import { truncate } from '../util/fields.js';

let _client: Anthropic | null = null;
function client(): Anthropic {
  requireAnthropic();
  if (!_client) _client = new Anthropic({ apiKey: config.anthropicApiKey });
  return _client;
}

const EMAIL_SYSTEM = `Sei un copywriter per SeVedemo, piattaforma italiana di ricerca lavoro per freelance.
Scrivi una bozza di cold-email in ITALIANO, breve (60-110 parole), personale e non spammosa.

Due angoli a seconda del bucket:
- bucket "freelance": la persona è un freelance/P.IVA. Invitala a usare SeVedemo per TROVARE lavoro/clienti. Tono da pari, concreto.
- bucket "azienda": la persona assume/decide (recruiter, founder, talent...). Invitala a PUBBLICARE offerte e trovare freelance qualificati su SeVedemo. Tono professionale, orientato al valore.

Regole:
- Usa il nome proprio se disponibile.
- Aggancia un dettaglio reale dal profilo (ruolo, settore) e, se presente un post di riferimento, citalo con naturalezza ("ho visto la tua reazione al post di...").
- 1 sola call-to-action chiara. Niente promesse esagerate, niente emoji a raffica (max 1).
- Includi un breve PS di opt-out ("Se non è il momento, ignora pure questa mail.").
Rispondi SEMPRE chiamando lo strumento write_email.`;

const EMAIL_TOOL = {
  name: 'write_email',
  description: 'Restituisce oggetto e corpo della cold-email personalizzata.',
  input_schema: {
    type: 'object' as const,
    properties: {
      subject: { type: 'string' },
      body: { type: 'string' },
    },
    required: ['subject', 'body'],
  },
};

const EmailSchema = z.object({ subject: z.string(), body: z.string() });
export type EmailDraft = z.infer<typeof EmailSchema>;

function contactBrief(c: ContactRow): string {
  return [
    `Bucket: ${c.bucket}`,
    `Nome: ${c.full_name ?? 'n/d'}`,
    `Ruolo: ${c.role ?? c.headline ?? 'n/d'}`,
    `Settore: ${c.sector ?? 'n/d'}`,
    `Azienda: ${c.company ?? 'n/d'}`,
    `Descrizione: ${c.short_description ?? 'n/d'}`,
    c.source_post_url ? `Post di riferimento: ${c.source_post_url}` : '',
    `About (estratto): ${truncate(c.about, 600) || 'n/d'}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export async function draftOne(contact: ContactRow): Promise<EmailDraft> {
  const msg = await client().messages.create({
    model: config.emailModel,
    max_tokens: 600,
    system: EMAIL_SYSTEM,
    tools: [EMAIL_TOOL as any],
    tool_choice: { type: 'tool', name: 'write_email' },
    messages: [{ role: 'user', content: contactBrief(contact) }],
  });
  const block = msg.content.find((b) => b.type === 'tool_use') as
    | { type: 'tool_use'; input: unknown }
    | undefined;
  if (!block) throw new Error('Nessun tool_use nella risposta email.');
  return EmailSchema.parse(block.input);
}

export async function draftMany(
  contacts: ContactRow[],
): Promise<Array<{ id: number; draft?: EmailDraft; error?: string }>> {
  const limit = pLimit(config.scoringConcurrency);
  return Promise.all(
    contacts.map((c) =>
      limit(async () => {
        try {
          const draft = await draftOne(c);
          return { id: c.id, draft };
        } catch (err) {
          return { id: c.id, error: err instanceof Error ? err.message : String(err) };
        }
      }),
    ),
  );
}
