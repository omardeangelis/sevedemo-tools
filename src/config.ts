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

/** Intero riportato in `[min, max]`; assente/vuoto/non numerico → `fallback`. */
function clampedInt(v: string | undefined, fallback: number, min: number, max = Number.POSITIVE_INFINITY): number {
  return Math.min(max, Math.max(min, int(v, fallback)));
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
 * i test possono azzerare `apifyToken`/`anthropicApiKey`/`apolloApiKey` per simulare credenziali mancanti.
 */
export const config = {
  apifyToken: process.env.APIFY_TOKEN ?? '',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  /** Apollo (apollo-lookalike): piano a pagamento, master key o chiave con permesso di ricerca persone. */
  apolloApiKey: process.env.APOLLO_API_KEY ?? '',

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

  // --- Apollo (apollo-lookalike) ---
  /** Tetto di pagine di aziende lette per ricerca (il dialog ne propone 1). */
  apolloMaxCompanyPages: clampedInt(process.env.APOLLO_MAX_COMPANY_PAGES, 3, 1, 100),
  /** Persone proposte per azienda nella ricerca contatti. */
  apolloPeoplePerCompany: clampedInt(process.env.APOLLO_PEOPLE_PER_COMPANY, 10, 1, 100),
  /**
   * Richieste al minuto verso Apollo usate dagli avvisi delle preview. Default 20 = limite più stretto
   * letto dagli header nello smoke reale del 2026-09-17 (arricchimento e match: 20/min, 100/h, 600/24h;
   * ricerche: 50/min, 200/h, 600/24h). Il client rispetta comunque gli header `x-*-requests-left`.
   */
  apolloRateLimitPerMinute: clampedInt(process.env.APOLLO_RATE_LIMIT_PER_MINUTE, 20, 1),

  /** Costi indicativi in USD per `est_cost_usd` delle preview (PLAN §5). `null` = stima non disponibile. */
  prices: {
    postsPer1000Usd: 5,
    reactionsPer1000Usd: 5,
    commentsPer1000Usd: 5,
    employeesPer1000Usd: { Short: 4, Full: 8, 'Full+email': 12 } as Record<EmployeesMode, number>,
    profileDetailUsd: optionalFloat(process.env.PRICE_PROFILE_DETAIL_USD),
    analysisPerProspectUsd: 0.03,
    /** Prezzo in USD di un credito Apollo: `null` = stima non disponibile. */
    apolloCreditUsd: optionalFloat(process.env.APOLLO_CREDIT_USD),
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

/**
 * Blocker "chiave Apollo mancante" dei kind Apollo (`enrich_companies`, `lookalike_companies`,
 * `apollo_people`, `enrich` con provider `apollo`): unico testo per preview, avvio (400 `blocked`),
 * "Riprova" e verifica del job (`config: …`).
 */
export const APOLLO_KEY_BLOCKER = 'APOLLO_API_KEY mancante nel .env — nessun job avviato.';

export function requireApollo(): void {
  if (!config.apolloApiKey.trim()) {
    throw new Error('APOLLO_API_KEY mancante nel .env. Copia .env.example in .env e inserisci la API key Apollo.');
  }
}
