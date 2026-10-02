import { listSourceRows, type SourceRow } from '../profile/sources.js';
import { siteUrl } from '../util/fields.js';
import { findLatestFinishedJob } from './jobs.js';
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

/**
 * C11 (riscritto il 2026-10-02 con la fonte Apollo tolta, PLAN P-29): un indirizzo che non è un sito si salva comunque,
 * ma la generazione non potrà leggerlo. Un dominio proprio non serve più: un sito su Wix o Google Sites si legge.
 */
const WEBSITE_NOT_A_SITE = "Questo non sembra l'indirizzo di un sito: la generazione non potrà leggerlo.";

/** Avviso per il sito salvato, `null` se manca o se è un sito che si può leggere (`siteUrl`). */
export function websiteWarning(websiteUrl: string | null): string | null {
  return websiteUrl !== null && !siteUrl(websiteUrl) ? WEBSITE_NOT_A_SITE : null;
}

export interface ProfileValue {
  value: string | null;
  origin: FieldOrigin | null;
  origin_at: string | null;
}

/** La lettura unica di B7: valori, provenienza, servizi, fonti lette, ultima generazione e proposta in attesa. */
export interface Profile {
  inputs: {
    own_profile_url: ProfileValue;
    /** `warning`: l'indirizzo salvato non è un sito che la generazione può leggere (C11). */
    website_url: ProfileValue & { warning: string | null };
  };
  fields: Record<ProfileFieldKey, ProfileValue>;
  /** Campi generabili compilati di cui il CRM non sa chi li ha scritti (E14): la testata della proposta li dichiara. */
  filled_without_origin: number;
  services: Service[];
  /** Stessa readiness di `GET /api/settings` (es. l'avviso "Descrizione azienda vuota" sotto il campo). */
  readiness: Readiness;
  /** Ultima lettura di ogni fonte, senza il testo letto (G5, D11); le fonti mai lette non ci sono. */
  sources: SourceRow[];
  /** L'ultima generazione conclusa (G5): esito, data, conteggi; `null` se non è mai partita. */
  last_generation: {
    job_id: number;
    state: 'succeeded' | 'failed';
    finished_at: string | null;
    summary: string | null;
    counts: Record<string, number>;
    warnings: string[];
    error: string | null;
  } | null;
  /** La proposta in attesa (E11): il dettaglio è `GET /api/profile/proposal`. */
  pending_proposal: { id: number; created_at: string; model: string } | null;
}

function origins(): Map<string, { origin: FieldOrigin; origin_at: string }> {
  const rows = db.prepare(`SELECT field, origin, origin_at FROM profile_field_origin`).all() as Array<{
    field: string;
    origin: FieldOrigin;
    origin_at: string;
  }>;
  return new Map(rows.map(({ field, ...rest }) => [field, rest]));
}

/** La proposta in attesa (E11), `null` se non c'è: la lettura comune a profilo, anteprima ed esito. */
export function pendingProposal(): Profile['pending_proposal'] {
  return (
    (db.prepare(`SELECT id, created_at, model FROM profile_proposals ORDER BY id DESC LIMIT 1`).get() as
      | Profile['pending_proposal']
      | undefined) ?? null
  );
}

function lastGeneration(): Profile['last_generation'] {
  const job = findLatestFinishedJob('generate_profile');
  if (!job || job.state === 'running') return null;
  return {
    job_id: job.id,
    state: job.state,
    finished_at: job.finished_at,
    summary: job.result?.summary ?? null,
    counts: job.result?.counts ?? {},
    warnings: job.result?.warnings ?? [],
    error: job.error,
  };
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
      website_url: { ...valueOf('website_url'), warning: websiteWarning(settings.website_url) },
    },
    fields,
    filled_without_origin: PROFILE_FIELD_KEYS.filter((k) => fields[k].value !== null && fields[k].origin === null).length,
    services: listServices(),
    readiness: getReadiness(),
    sources: listSourceRows(),
    last_generation: lastGeneration(),
    pending_proposal: pendingProposal(),
  };
}

/**
 * Salvataggio a mano dal form (B6): come `updateSettings`, e ogni valore che **cambia davvero** diventa
 * "scritto da te" adesso. Il form dell'azienda manda tutti i suoi campi insieme: senza il confronto, correggere
 * la descrizione marcherebbe anche nome e offerta (G-11). Un valore svuotato perde la provenienza: non c'è più
 * niente da rispettare.
 */
export function saveProfileByHand(patch: Partial<Settings>): Settings {
  return saveProfileValues(patch, 'manual');
}

/**
 * Valori applicati da una proposta (own-profile-services T28, E7–E8): come il salvataggio a mano, ma la provenienza è
 * "dalla proposta". Solo un valore che cambia davvero la riceve.
 */
export function applyProfileValues(patch: Partial<Record<ProfileFieldKey, string>>): Settings {
  return saveProfileValues(patch, 'proposal');
}

function saveProfileValues(patch: Partial<Settings>, origin: FieldOrigin): Settings {
  return db.transaction(() => {
    const before = getSettings();
    const after = updateSettings(patch);
    const mark = db.prepare(
      `INSERT INTO profile_field_origin (field, origin, origin_at) VALUES (?, ?, ?)
       ON CONFLICT (field) DO UPDATE SET origin = excluded.origin, origin_at = excluded.origin_at`,
    );
    const unmark = db.prepare(`DELETE FROM profile_field_origin WHERE field = ?`);
    const at = nowIso();
    for (const key of Object.keys(patch) as SettingKey[]) {
      if (after[key] === before[key]) continue;
      if (after[key] === null) unmark.run(key);
      else mark.run(key, origin, at);
    }
    return after;
  })();
}
