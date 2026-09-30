import { normalizeDomain } from '../util/fields.js';
import type { FieldOrigin } from './schema.js';
import { listServices, type Service } from './services.js';
import { getReadiness, getSettings, updateSettings, type Readiness, type SettingKey, type Settings } from './settings.js';
import { db, nowIso } from './index.js';

/**
 * Il profilo dell'utente (own-profile-services B1, B5–B8): i valori stanno in `settings` (i consumatori di oggi
 * non cambiano, B8), la provenienza di ciascuno in `profile_field_origin` (P-10). Nessuna riga = nessuna
 * provenienza: è il caso dei tre campi dell'azienda già nel database prima del rilascio (G-11, E14), che la
 * ricevono solo quando l'utente li riscrive.
 */

/** Campi generabili: gli unici che una proposta può nominare (E2); gli input (`own_profile_url`, `website_url`) mai. */
export const PROFILE_FIELD_KEYS = [
  'company_name',
  'company_description',
  'company_offering',
  'positioning',
  'proof_points',
  'tone_of_voice',
] as const satisfies readonly SettingKey[];
export type ProfileFieldKey = (typeof PROFILE_FIELD_KEYS)[number];

/** C11: il sito si salva comunque, ma senza un dominio la fonte Apollo non sarà disponibile. */
const WEBSITE_NO_DOMAIN =
  "Non riesco a ricavare un dominio da questo indirizzo: il record d'impresa resterà non disponibile.";

/** Avviso per il sito salvato, `null` se manca o se ne ricava un dominio. */
export function websiteWarning(websiteUrl: string | null): string | null {
  return websiteUrl !== null && !normalizeDomain(websiteUrl) ? WEBSITE_NO_DOMAIN : null;
}

export interface ProfileValue {
  value: string | null;
  origin: FieldOrigin | null;
  origin_at: string | null;
}

/** La lettura unica di B7. Le chiavi di M4 esistono già, a `null` finché la generazione non le riempie (P-21). */
export interface Profile {
  inputs: {
    own_profile_url: ProfileValue;
    /** `domain` = ciò che la fonte Apollo userebbe; senza, `warning` lo dice (C11). */
    website_url: ProfileValue & { domain: string | null; warning: string | null };
  };
  fields: Record<ProfileFieldKey, ProfileValue>;
  /** Campi generabili compilati di cui il CRM non sa chi li ha scritti (E14): la testata della proposta li dichiara. */
  filled_without_origin: number;
  services: Service[];
  /** Stessa readiness di `GET /api/settings` (es. l'avviso "Descrizione azienda vuota" sotto il campo). */
  readiness: Readiness;
  /** Record d'impresa di Apollo per il dominio del sito, così com'è arrivato (B9, C10): sola lettura. */
  apollo_record: { read_at: string; record: unknown } | null;
  /** M4 (T23, T30): esito dell'ultima lettura per fonte. */
  sources: null;
  /** M4 (T26): data e modello dell'ultima generazione. */
  last_generation: null;
  /** M4 (T26, T31): la proposta in attesa. */
  pending_proposal: null;
}

function origins(): Map<string, { origin: FieldOrigin; origin_at: string }> {
  const rows = db.prepare(`SELECT field, origin, origin_at FROM profile_field_origin`).all() as Array<{
    field: string;
    origin: FieldOrigin;
    origin_at: string;
  }>;
  return new Map(rows.map(({ field, ...rest }) => [field, rest]));
}

function apolloRecord(): Profile['apollo_record'] {
  const row = db.prepare(`SELECT read_at, content FROM profile_sources WHERE kind = 'apollo' AND content IS NOT NULL`).get() as
    | { read_at: string; content: string }
    | undefined;
  if (!row) return null;
  try {
    return { read_at: row.read_at, record: JSON.parse(row.content) };
  } catch {
    return null;
  }
}

export function getProfile(): Profile {
  const settings = getSettings();
  const byField = origins();
  const valueOf = (key: SettingKey): ProfileValue => {
    const o = byField.get(key);
    return { value: settings[key], origin: o?.origin ?? null, origin_at: o?.origin_at ?? null };
  };
  const fields = Object.fromEntries(PROFILE_FIELD_KEYS.map((k) => [k, valueOf(k)])) as Profile['fields'];
  return {
    inputs: {
      own_profile_url: valueOf('own_profile_url'),
      website_url: {
        ...valueOf('website_url'),
        domain: normalizeDomain(settings.website_url) ?? null,
        warning: websiteWarning(settings.website_url),
      },
    },
    fields,
    filled_without_origin: PROFILE_FIELD_KEYS.filter((k) => fields[k].value !== null && fields[k].origin === null).length,
    services: listServices(),
    readiness: getReadiness(),
    apollo_record: apolloRecord(),
    sources: null,
    last_generation: null,
    pending_proposal: null,
  };
}

/**
 * Salvataggio a mano dal form (B6): come `updateSettings`, e ogni valore che **cambia davvero** diventa
 * "scritto da te" adesso. Il form dell'azienda manda tutti i suoi campi insieme: senza il confronto, correggere
 * la descrizione marcherebbe anche nome e offerta (G-11). Un valore svuotato perde la provenienza: non c'è più
 * niente da rispettare.
 */
export function saveProfileByHand(patch: Partial<Settings>): Settings {
  return db.transaction(() => {
    const before = getSettings();
    const after = updateSettings(patch);
    const mark = db.prepare(
      `INSERT INTO profile_field_origin (field, origin, origin_at) VALUES (?, 'manual', ?)
       ON CONFLICT (field) DO UPDATE SET origin = excluded.origin, origin_at = excluded.origin_at`,
    );
    const unmark = db.prepare(`DELETE FROM profile_field_origin WHERE field = ?`);
    const at = nowIso();
    for (const key of Object.keys(patch) as SettingKey[]) {
      if (after[key] === before[key]) continue;
      if (after[key] === null) unmark.run(key);
      else mark.run(key, at);
    }
    return after;
  })();
}
