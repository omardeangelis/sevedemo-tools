import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Root del progetto (la cartella che contiene `src/`, `data/`, ...). */
export const ROOT = path.resolve(here, '..');

function int(v: string | undefined, fallback: number): number {
  const n = v ? Number.parseInt(v, 10) : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === '') return fallback;
  return v === '1' || v.toLowerCase() === 'true' || v.toLowerCase() === 'yes';
}

/** Numero opzionale: `null` se la variabile è assente/vuota/non numerica. */
function optionalFloat(v: string | undefined): number | null {
  const n = v ? Number.parseFloat(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

/** Modalità di scraping dei dipendenti (harvestapi): il mapping sull'input reale sta in `apify/actors.ts`. */
export const EMPLOYEES_MODES = ['Short', 'Full', 'Full+email'] as const;
export type EmployeesMode = (typeof EMPLOYEES_MODES)[number];

function employeesMode(v: string | undefined, fallback: EmployeesMode): EmployeesMode {
  return (EMPLOYEES_MODES as readonly string[]).includes(v ?? '') ? (v as EmployeesMode) : fallback;
}

/**
 * Configurazione letta a import-time dal `.env`. Oggetto volutamente mutabile:
 * i test possono azzerare `apifyToken`/`anthropicApiKey` per simulare credenziali mancanti.
 */
export const config = {
  apifyToken: process.env.APIFY_TOKEN ?? '',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',

  // --- Analisi AI (D12) ---
  analysisModel: process.env.ANALYSIS_MODEL || 'claude-opus-5',
  /** Structured outputs (`output_config.format`); `ANALYSIS_STRUCTURED=0` → prompt JSON-only + zod. */
  analysisStructured: bool(process.env.ANALYSIS_STRUCTURED, true),

  // --- Sync interazioni (P6) ---
  /** Post del mio profilo scaricati a ogni sync. */
  postsPerSync: int(process.env.POSTS_PER_SYNC, 10),
  /** Post più vecchi di così non si ri-sincronizzano mai (salvo `force`). */
  postRecencyDays: int(process.env.POST_RECENCY_DAYS, 90),
  /** Un post già sincronizzato si ri-scarica solo dopo questi giorni (salvo `force`). */
  syncCooldownDays: int(process.env.SYNC_COOLDOWN_DAYS, 7),
  /** Cap di reazioni lette per post (anti-spesa sui post virali). */
  reactionsPerPost: int(process.env.REACTIONS_PER_POST, 300),
  /** Cap di commenti letti per post (apimaestro `limit`, 1-100). */
  commentsPerPost: int(process.env.COMMENTS_PER_POST, 100),

  // --- Sourcing da azienda ---
  /** Default di `maxItems` per azienda. */
  employeesPerCompany: int(process.env.EMPLOYEES_PER_COMPANY, 50),
  employeesMode: employeesMode(process.env.EMPLOYEES_MODE, 'Short'),

  // --- Enrichment ---
  enrichConcurrency: int(process.env.ENRICH_CONCURRENCY, 3),
  /** Un tentativo di enrichment senza esito si ripete solo dopo questi giorni (salvo `retryFailed`). */
  freshnessDays: int(process.env.FRESHNESS_DAYS, 90),

  /** Costi indicativi in USD per `est_cost_usd` delle preview (PLAN §5). `null` = stima non disponibile. */
  prices: {
    postsPer1000Usd: 5,
    reactionsPer1000Usd: 5,
    commentsPer1000Usd: 5,
    employeesPer1000Usd: { Short: 4, Full: 8, 'Full+email': 12 } as Record<EmployeesMode, number>,
    profileDetailUsd: optionalFloat(process.env.PRICE_PROFILE_DETAIL_USD),
    analysisPerProspectUsd: 0.03,
  },

  paths: {
    db: process.env.DB_PATH ?? path.join(ROOT, 'data', 'crm.db'),
    exports: path.join(ROOT, 'exports'),
  },
};

export function requireApify(): void {
  if (!config.apifyToken) {
    throw new Error('APIFY_TOKEN mancante. Copia .env.example in .env e inserisci il token Apify.');
  }
}

export function requireAnthropic(): void {
  if (!config.anthropicApiKey) {
    throw new Error('ANTHROPIC_API_KEY mancante. Copia .env.example in .env e inserisci la API key Anthropic.');
  }
}
