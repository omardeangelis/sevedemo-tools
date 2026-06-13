import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContactRow } from '../src/db/contacts.js';

// Mock dell'SDK Anthropic: default export usato come `new Anthropic(...)`, con
// `messages.create` spiabile via vi.hoisted per asserire il numero di chiamate.
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: createMock };
  },
}));

function contact(over: Partial<ContactRow>): ContactRow {
  return {
    id: 0,
    linkedin_url: 'https://www.linkedin.com/in/x',
    full_name: 'Mario Rossi',
    headline: null,
    about: null,
    location: null,
    email: null,
    phone: null,
    company: null,
    role: null,
    bucket: 'freelance',
    sector: null,
    fit_score: null,
    short_description: null,
    score_reason: null,
    signals: null,
    source_strategy: null,
    source_post_url: null,
    email_subject: null,
    email_body: null,
    status: 'selected',
    raw_json: null,
    first_seen_at: '2026-06-13T00:00:00.000Z',
    last_evaluated_at: null,
    ...over,
  };
}

describe('hasEmail', () => {
  it('false per assente o vuota (null, undefined, stringa vuota, soli spazi)', async () => {
    const { hasEmail } = await import('../src/util/fields.js');
    expect(hasEmail(null)).toBe(false);
    expect(hasEmail(undefined)).toBe(false);
    expect(hasEmail('')).toBe(false);
    expect(hasEmail('   ')).toBe(false);
    expect(hasEmail('\t\n ')).toBe(false);
  });

  it('true per una qualunque email presente (nessuna validazione di sintassi)', async () => {
    const { hasEmail } = await import('../src/util/fields.js');
    expect(hasEmail('a@b.com')).toBe(true);
    expect(hasEmail('  a@b.com  ')).toBe(true);
    expect(hasEmail('non-una-email')).toBe(true);
  });
});

describe('draftMany — guard email', () => {
  beforeEach(() => {
    createMock.mockReset();
    createMock.mockResolvedValue({
      content: [{ type: 'tool_use', input: { subject: 'Oggetto', body: 'Corpo' } }],
    });
  });

  it('non chiama il modello per i contatti senza email; li ritorna come skipped', async () => {
    const { draftMany } = await import('../src/email/draft.js');
    const results = await draftMany([
      contact({ id: 1, email: 'mario@rossi.it' }),
      contact({ id: 2, email: null }),
      contact({ id: 3, email: '' }),
      contact({ id: 4, email: '   ' }),
    ]);

    // Il modello è invocato una sola volta: solo per il contatto con email.
    expect(createMock).toHaveBeenCalledTimes(1);

    const byId = new Map(results.map((r) => [r.id, r]));

    // Con email → bozza generata, nessuno skip.
    expect(byId.get(1)?.draft).toEqual({ subject: 'Oggetto', body: 'Corpo' });
    expect(byId.get(1)?.skipped).toBeFalsy();

    // Senza email → skipped, niente bozza, niente errore (no fallimento pipeline).
    for (const id of [2, 3, 4]) {
      expect(byId.get(id)?.skipped).toBe(true);
      expect(byId.get(id)?.draft).toBeUndefined();
      expect(byId.get(id)?.error).toBeUndefined();
    }
  });
});
