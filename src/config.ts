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

function float(v: string | undefined, fallback: number): number {
  const n = v ? Number.parseFloat(v) : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}

function list(v: string | undefined, fallback: string[]): string[] {
  if (!v) return fallback;
  const parts = v.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : fallback;
}

export const config = {
  apifyToken: process.env.APIFY_TOKEN ?? '',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  /** Cookie li_at: se vuoto, le strategie cookie restano disabilitate. */
  linkedinLiAt: process.env.LINKEDIN_LI_AT ?? '',

  scoringModel: process.env.SCORING_MODEL ?? 'claude-haiku-4-5-20251001',
  emailModel: process.env.EMAIL_MODEL ?? 'claude-sonnet-4-6',

  poolSize: int(process.env.POOL_SIZE, 200),
  enrichCap: int(process.env.ENRICH_CAP, 120),
  targetFreelance: int(process.env.TARGET_FREELANCE, 20),
  targetAzienda: int(process.env.TARGET_AZIENDA, 20),
  freshnessDays: int(process.env.FRESHNESS_DAYS, 90),
  cookieMaxProfiles: int(process.env.COOKIE_MAX_PROFILES, 100),
  scoringConcurrency: int(process.env.SCORING_CONCURRENCY, 6),
  minFitScore: int(process.env.MIN_FIT_SCORE, 50),

  // --- Fonte primaria influencer-post-respondents ---
  /** Strategia primaria del run giornaliero (budget dominante + eseguita per prima). */
  primaryStrategyId: process.env.PRIMARY_STRATEGY_ID ?? 'influencer-post-respondents',
  /** Quota di POOL_SIZE riservata alla primaria (cap, non forzata): ~50% di default. */
  primaryWeight: float(process.env.PRIMARY_WEIGHT, 0.5),
  /** Post per influencer da scaricare (apimaestro `total_posts`). */
  postsPerInfluencer: int(process.env.POSTS_PER_INFLUENCER, 5),
  /** Commenti per post da scaricare (apimaestro `limit`, 1-100). */
  commentsPerPost: int(process.env.COMMENTS_PER_POST, 100),
  /** Finestra di freschezza dei post in giorni (D6: solo post recenti). */
  postRecencyDays: int(process.env.POST_RECENCY_DAYS, 90),
  /** Ruoli decisionali per l'espansione-azienda. */
  companyExpansionRoles: list(process.env.COMPANY_EXPANSION_ROLES, [
    'CEO', 'CTO', 'Founder', 'Co-founder', 'Head of Engineering', 'HR', 'Talent',
  ]),
  /** Cap di candidati per singola azienda espansa. */
  companyExpansionPerCompany: int(process.env.COMPANY_EXPANSION_PER_COMPANY, 3),
  /**
   * Emissione dei candidati `tagged-person` nel pipeline. Default OFF finché lo smoke
   * reale (T14) non conferma la risolvibilità dell'URN sul path enrichment daily
   * (`dev_fusion`). Vedi tech-debt/lead-engine/influencer-post-respondents.md.
   */
  taggedPersonEnabled: bool(process.env.TAGGED_PERSON_ENABLED, false),

  paths: {
    db: process.env.DB_PATH ?? path.join(ROOT, 'data', 'sevedemo.db'),
    seeds: path.join(ROOT, 'data', 'seeds'),
    exports: path.join(ROOT, 'exports'),
  },
} as const;

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
