import { config } from '../config.js';
import { cleanText } from '../util/fields.js';
import { TOOLS } from '../runs/tools.js';
import { db } from './index.js';

/**
 * Impostazioni dell'utente (PLAN crm-foundation §6 `settings`, chiave/valore) e
 * readiness per onboarding e blocker delle preview.
 */

export const SETTING_KEYS = [
  'own_profile_url',
  'company_name',
  'company_description',
  'company_offering',
  // own-profile-services B1: il sito (input della generazione) e tre campi generabili nuovi.
  'website_url',
  'positioning',
  'proof_points',
  'tone_of_voice',
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

/** Tutte le chiavi sempre presenti: `null` = non impostata. */
export type Settings = Record<SettingKey, string | null>;

/**
 * Cosa è pronto. `company` = descrizione azienda non vuota (senza, gli angoli AI sono
 * meno mirati: warning, non blocco). `icp`/`prospects` = almeno una riga, per i passi
 * 2 e 3 dell'onboarding.
 */
export interface Readiness {
  apify: boolean;
  anthropic: boolean;
  /** Chiave Apollo presente (i permessi si verificano al primo job, non in preview). */
  apollo: boolean;
  profile: boolean;
  company: boolean;
  icp: boolean;
  prospects: boolean;
}

export function getSettings(): Settings {
  const rows = db.prepare(`SELECT key, value FROM settings`).all() as Array<{ key: string; value: string | null }>;
  const settings = Object.fromEntries(SETTING_KEYS.map((k) => [k, null])) as Settings;
  for (const { key, value } of rows) {
    if ((SETTING_KEYS as readonly string[]).includes(key)) settings[key as SettingKey] = value;
  }
  return settings;
}

/**
 * Aggiorna solo le chiavi presenti in `patch`: trim, e vuoto/`null` cancella la chiave.
 * Nessuna validazione: l'URL del profilo lo normalizza/valida la route (`normalizeProfileUrl`).
 * Non scrive provenienza (own-profile-services B6): un gesto dell'utente passa da `saveProfileByHand`
 * (`src/db/profile.ts`).
 */
export function updateSettings(patch: Partial<Settings>): Settings {
  const upsert = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
  );
  const remove = db.prepare(`DELETE FROM settings WHERE key = ?`);
  db.transaction(() => {
    for (const key of SETTING_KEYS) {
      if (patch[key] === undefined) continue;
      const value = cleanText(patch[key]);
      if (value === null) remove.run(key);
      else upsert.run(key, value);
    }
  })();
  return getSettings();
}

function exists(table: 'icps' | 'prospects'): boolean {
  return (db.prepare(`SELECT EXISTS (SELECT 1 FROM ${table}) AS e`).get() as { e: number }).e === 1;
}

export function getReadiness(): Readiness {
  const s = getSettings();
  return {
    // Le tre chiavi le conosce il catalogo degli strumenti (J2): una sola definizione di "configurata".
    apify: TOOLS.apify.configured(),
    anthropic: TOOLS.anthropic.configured(),
    apollo: TOOLS.apollo.configured(),
    profile: s.own_profile_url !== null,
    company: s.company_description !== null,
    icp: exists('icps'),
    prospects: exists('prospects'),
  };
}
