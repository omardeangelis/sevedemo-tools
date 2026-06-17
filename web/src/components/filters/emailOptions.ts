/**
 * Single source of truth for the email-presence (tri-state) filter options.
 *
 * Consumed by:
 * - the Contatti page URL-backed select (`contacts.index.tsx`)
 * - the Selezioni pool local-state select (`selections.$date.tsx`, wired in T5)
 *
 * Replaces the previous forks `EMAIL_OPTIONS` / `EMAIL_FILTER_OPTIONS`.
 * Semantics: '' = no filter (Tutti), 'with' = has email, 'without' = no email.
 */
export type EmailFilterValue = '' | 'with' | 'without';

export const EMAIL_FILTER_OPTIONS: ReadonlyArray<{ value: EmailFilterValue; label: string }> = [
  { value: '', label: 'Tutti' },
  { value: 'with', label: 'Con email' },
  { value: 'without', label: 'Senza email' },
];
