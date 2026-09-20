import { config } from '../config.js';
import type { JobState } from '../jobs/types.js';

/*
 * Strumenti esterni del CRM e attribuzione degli esiti (people-first-crm SPEC J2–J5, FLOW G.2, T30).
 * Un run appartiene a ogni strumento che usa (`jobs.tools`, fissato all'avvio da `RUN_TOOLS`); quando
 * fallisce, `failedTools` dice per chi conta come fallito, leggendo il prefisso dell'errore.
 * Funzioni pure: nessun accesso al DB.
 */

export const TOOL_IDS = ['apify', 'apollo', 'anthropic'] as const;
export type ToolId = (typeof TOOL_IDS)[number];

export interface Tool {
  id: ToolId;
  label: string;
  /** Variabile del `.env` che porta la chiave (J2: "APOLLO_API_KEY · Configurata"). */
  env_var: string;
  /** Cosa abilita nel CRM (FLOW G.2). */
  enables: string;
  /** Chiave presente nella configurazione (J5: "Configurata" non dice che è valida). */
  configured: () => boolean;
}

/** Valore della chiave di ogni strumento, letto adesso (la config è mutabile nei test). */
const TOOL_KEYS: Record<ToolId, () => string> = {
  apify: () => config.apifyToken,
  apollo: () => config.apolloApiKey,
  anthropic: () => config.anthropicApiKey,
};

export const TOOLS: Record<ToolId, Tool> = {
  apify: {
    id: 'apify',
    label: 'Apify',
    env_var: 'APIFY_TOKEN',
    enables: "Abilita: sync delle interazioni, persone di un'azienda, arricchimento dei profili.",
    configured: () => TOOL_KEYS.apify().trim() !== '',
  },
  apollo: {
    id: 'apollo',
    label: 'Apollo',
    env_var: 'APOLLO_API_KEY',
    enables: 'Abilita: aziende simili, contatti ed email di lavoro.',
    configured: () => TOOL_KEYS.apollo().trim() !== '',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    env_var: 'ANTHROPIC_API_KEY',
    enables: "Abilita: analisi AI delle persone (riassunto, angoli, fit dell'AI).",
    configured: () => TOOL_KEYS.anthropic().trim() !== '',
  },
};

/**
 * Sostituisce i valori delle chiavi configurate con `***` (J10). Sta qui perché è il modulo che conosce le
 * chiavi: lo usano il log dei run in scrittura e chi salva l'esito di un job.
 */
export function redactSecrets(text: string): string {
  let out = text;
  for (const tool of TOOL_IDS) {
    const secret = TOOL_KEYS[tool]();
    if (secret.length >= 6) out = out.split(secret).join('***');
  }
  return out;
}

export function isToolId(value: unknown): value is ToolId {
  return typeof value === 'string' && (TOOL_IDS as readonly string[]).includes(value);
}

/** Strumento nominato da un errore `config:` (la variabile del `.env`), il primo che compare. */
function toolOfEnvVar(error: string): ToolId | undefined {
  let found: { tool: ToolId; at: number } | undefined;
  for (const tool of TOOL_IDS) {
    const at = error.indexOf(TOOLS[tool].env_var);
    if (at >= 0 && (found === undefined || at < found.at)) found = { tool, at };
  }
  return found?.tool;
}

/**
 * Strumento a cui l'errore si può ricondurre, o `undefined` se non si può (J4). L'id dell'actor è il testo
 * tra `actor:` e il `:` successivo: `apollo` (gli errori Apollo sono `actor:apollo:<operazione>:`),
 * `<owner>/<name>` = un actor Apify (anche dismesso); ogni altro id è il modello dell'analisi, che cambia
 * con `ANALYSIS_MODEL`, quindi conta per Anthropic se il run lo usa.
 */
function toolNamedBy(error: string, tools: readonly ToolId[]): ToolId | undefined {
  const actor = /^actor:([^:]+):/.exec(error);
  if (actor) {
    const id = actor[1]!;
    if (id === 'apollo') return 'apollo';
    if (id.includes('/')) return 'apify';
    return tools.includes('anthropic') ? 'anthropic' : undefined;
  }
  return toolOfEnvVar(error);
}

/**
 * Strumenti del run riconosciuti, nell'ordine in cui il kind li ha salvati (il primo è quello principale:
 * l'analisi è di Anthropic, che arricchisce con Apify solo se serve). `jobs.tools` è JSON: una riga vecchia
 * può contenere altro, e i valori sconosciuti o ripetuti si scartano.
 */
export function toolsOfRun(tools: readonly unknown[]): ToolId[] {
  return [...new Set(tools.filter(isToolId))];
}

/**
 * Strumenti per cui il run conta come fallito (J4): quello nominato dall'errore se è tra gli strumenti del
 * run, altrimenti **tutti** quelli del run (un errore che non si può ricondurre a nessuno li riguarda tutti).
 * Run non falliti: nessuno.
 */
export function failedTools(job: { state: JobState; error: string | null; tools: readonly unknown[] }): ToolId[] {
  if (job.state !== 'failed') return [];
  const tools = toolsOfRun(job.tools);
  const named = job.error ? toolNamedBy(job.error, tools) : undefined;
  return named && tools.includes(named) ? [named] : tools;
}
