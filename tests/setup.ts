import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolamento DB: deve girare prima che qualunque test importi src/config.ts.
// La config è letta a import-time: per questo i test importano i moduli che
// toccano il DB con `await import()` dinamico, mai con import statici hoisted.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sevedemo-test-${process.pid}-`));
process.env.DB_PATH = path.join(dir, 'crm-test.db');

// Il `.env` locale NON viene letto (come in scripts/e2e-server.ts): i test assumono i default
// di src/config.ts, e un valore personale (es. `ANALYSIS_MODEL`) li farebbe fallire. Vale anche
// per i processi figli dei job, che ereditano `process.env`.
process.env.DOTENV_CONFIG_PATH = os.devNull;
process.env.DOTENV_CONFIG_QUIET = 'true';

// Credenziali fittizie deterministiche: la config le legge a import-time (config.ts)
// e dotenv non sovrascrive variabili già impostate. Così `requireApify()`/
// `requireAnthropic()`/`requireApollo()` e i blocker delle preview non dipendono dal `.env`
// locale, e le eventuali chiavi reali sono mascherate — i test non chiamano mai le API vere.
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.APIFY_TOKEN = 'test-apify-token';
process.env.APOLLO_API_KEY = 'test-apollo-key';

// Parametri fissati anche contro variabili esportate nella shell: il modello atteso dai test
// e, per il resto, stringa vuota = default di src/config.ts (int/bool/optionalFloat la ignorano).
process.env.ANALYSIS_MODEL = 'claude-opus-5';
for (const key of [
  'ANALYSIS_STRUCTURED',
  'POSTS_PER_SYNC',
  'POST_RECENCY_DAYS',
  'SYNC_COOLDOWN_DAYS',
  'REACTIONS_PER_POST',
  'COMMENTS_PER_POST',
  'EMPLOYEES_PER_COMPANY',
  'EMPLOYEES_MODE',
  'ENRICH_CONCURRENCY',
  'FRESHNESS_DAYS',
  'PRICE_PROFILE_DETAIL_USD',
  'APOLLO_MAX_COMPANY_PAGES',
  'APOLLO_PEOPLE_PER_COMPANY',
  'APOLLO_RATE_LIMIT_PER_MINUTE',
  'APOLLO_CREDIT_USD',
]) {
  process.env[key] = '';
}
