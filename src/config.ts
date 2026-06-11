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
