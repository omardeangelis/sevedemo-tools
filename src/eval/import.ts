import fs from 'node:fs';
import { parseCsv, truthy } from '../util/csv.js';
import { normalizeLinkedinUrl } from '../util/fields.js';
import { findByEmail, findByUrl } from '../db/contacts.js';
import { upsertOutcome } from '../db/runs.js';

/**
 * Importa gli esiti dell'outreach da un CSV esportato dal tool email.
 * Colonne riconosciute (case-insensitive): linkedin_url | email (almeno una per il match);
 * sent_at, opened, replied, positive_reply, converted, notes.
 */
export function importOutcomes(filePath: string): { matched: number; unmatched: number } {
  const text = fs.readFileSync(filePath, 'utf8');
  const rows = parseCsv(text);
  let matched = 0;
  let unmatched = 0;

  for (const row of rows) {
    const lower: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) lower[k.toLowerCase()] = v;

    const url = normalizeLinkedinUrl(lower['linkedin_url'] ?? lower['linkedinurl'] ?? lower['url']);
    const email = lower['email'];

    const contact =
      (url ? findByUrl(url) : undefined) ?? (email ? findByEmail(email) : undefined);

    if (!contact) {
      unmatched++;
      continue;
    }

    upsertOutcome({
      contactId: contact.id,
      strategy: contact.source_strategy,
      sentAt: lower['sent_at'] || lower['sentat'] || new Date().toISOString(),
      opened: truthy(lower['opened']),
      replied: truthy(lower['replied']),
      positiveReply: truthy(lower['positive_reply'] ?? lower['positivereply']),
      converted: truthy(lower['converted']),
      notes: lower['notes'] || null,
    });
    matched++;
  }
  return { matched, unmatched };
}
