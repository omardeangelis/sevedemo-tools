import { config } from '../config.js';
import type { JobResult, JobState } from '../jobs/types.js';

/*
 * Strumenti esterni del CRM e attribuzione degli esiti (people-first-crm SPEC J2–J5, FLOW G.2, T30;
 * own-profile-services A6, P-26). Un run appartiene a ogni strumento che usa (`jobs.tools`, fissato all'avvio da
 * `RUN_TOOLS`); `failedTools` dice per chi conta come fallito: se il run è fallito, leggendo il prefisso
 * dell'errore; se è riuscito, dagli strumenti delle fonti fallite che l'esito dichiara (`tool_errors`).
 * Funzioni pure: nessun accesso al DB.
 */

export const TOOL_IDS = ['apify', 'apollo', 'anthropic', 'cloudflare'] as const;
export type ToolId = (typeof TOOL_IDS)[number];

/** Valore di ogni variabile del `.env` degli strumenti, letto adesso (la config è mutabile nei test). */
const ENV_VALUES = {
  APIFY_TOKEN: () => config.apifyToken,
  APOLLO_API_KEY: () => config.apolloApiKey,
  ANTHROPIC_API_KEY: () => config.anthropicApiKey,
  CLOUDFLARE_ACCOUNT_ID: () => config.cloudflareAccountId,
  CLOUDFLARE_API_TOKEN: () => config.cloudflareApiToken,
} satisfies Record<string, () => string>;
export type ToolEnvVar = keyof typeof ENV_VALUES;

export interface Tool {
  id: ToolId;
  label: string;
  /**
   * Variabili del `.env` dello strumento, nell'ordine in cui la card le nomina (J2: "APOLLO_API_KEY ·
   * Configurata"; own-profile-services P-13: Cloudflare ne ha due).
   */
  env_vars: readonly ToolEnvVar[];
  /** La variabile che porta il segreto, oscurata ovunque (J10, A7): l'identificativo dell'account Cloudflare no. */
  secret: ToolEnvVar;
  /** Cosa abilita nel CRM (FLOW G.2). */
  enables: string;
  /** Variabili vuote o assenti, nell'ordine di `env_vars`. */
  missing: () => ToolEnvVar[];
  /** Tutte le variabili presenti (J5, A4: "Configurata" non dice che sono valide). */
  configured: () => boolean;
}

function tool(def: Pick<Tool, 'id' | 'label' | 'env_vars' | 'secret' | 'enables'>): Tool {
  const missing = () => def.env_vars.filter((v) => ENV_VALUES[v]().trim() === '');
  return { ...def, missing, configured: () => missing().length === 0 };
}

export const TOOLS: Record<ToolId, Tool> = {
  apify: tool({
    id: 'apify',
    label: 'Apify',
    env_vars: ['APIFY_TOKEN'],
    secret: 'APIFY_TOKEN',
    enables: "Abilita: sync delle interazioni, persone di un'azienda, arricchimento dei profili.",
  }),
  apollo: tool({
    id: 'apollo',
    label: 'Apollo',
    env_vars: ['APOLLO_API_KEY'],
    secret: 'APOLLO_API_KEY',
    enables: 'Abilita: aziende simili, contatti ed email di lavoro.',
  }),
  anthropic: tool({
    id: 'anthropic',
    label: 'Anthropic',
    env_vars: ['ANTHROPIC_API_KEY'],
    secret: 'ANTHROPIC_API_KEY',
    enables: "Abilita: analisi AI delle persone (riassunto, angoli, fit dell'AI).",
  }),
  cloudflare: tool({
    id: 'cloudflare',
    label: 'Cloudflare',
    env_vars: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'],
    secret: 'CLOUDFLARE_API_TOKEN',
    enables: 'Abilita: lettura del tuo sito per la generazione del profilo.',
  }),
};

/**
 * Sostituisce i valori dei segreti configurati con `***` (J10, A7). Sta qui perché è il modulo che conosce le
 * chiavi: lo usano il log dei run in scrittura e chi salva l'esito di un job. Itera il catalogo, quindi un
 * segreto è coperto dal momento in cui lo strumento esiste, prima di qualunque client.
 */
export function redactSecrets(text: string): string {
  let out = text;
  for (const id of TOOL_IDS) {
    const secret = ENV_VALUES[TOOLS[id].secret]();
    if (secret.length >= 6) out = out.split(secret).join('***');
  }
  return out;
}

export function isToolId(value: unknown): value is ToolId {
  return typeof value === 'string' && (TOOL_IDS as readonly string[]).includes(value);
}

/** Strumento nominato da un errore `config:` (una variabile del `.env`), il primo che compare. */
function toolOfEnvVar(error: string): ToolId | undefined {
  let found: { tool: ToolId; at: number } | undefined;
  for (const id of TOOL_IDS) {
    for (const envVar of TOOLS[id].env_vars) {
      const at = error.indexOf(envVar);
      if (at >= 0 && (found === undefined || at < found.at)) found = { tool: id, at };
    }
  }
  return found?.tool;
}

/**
 * Strumento a cui l'errore si può ricondurre, o `undefined` se non si può (J4). L'id dell'actor è il testo
 * tra `actor:` e il `:` successivo: l'id di uno strumento del catalogo (gli errori Apollo e Cloudflare sono
 * `actor:<strumento>:<operazione>:`, P-14), `<owner>/<name>` = un actor Apify (anche dismesso); ogni altro id è il
 * modello dell'analisi, che cambia con `ANALYSIS_MODEL`, quindi conta per Anthropic se il run lo usa.
 */
function toolNamedBy(error: string, tools: readonly ToolId[]): ToolId | undefined {
  const actor = /^actor:([^:]+):/.exec(error);
  if (actor) {
    const id = actor[1]!;
    if (isToolId(id)) return id;
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

/** Run come lo leggono attribuzione e salute: stato, errore, strumenti fissati all'avvio, esito. */
export interface AttributableRun {
  state: JobState;
  error: string | null;
  tools: readonly unknown[];
  result?: Pick<JobResult, 'tool_errors'> | null;
}

/**
 * Strumenti per cui il run conta come fallito (J4), col motivo, nell'ordine del run. Run fallito: quello nominato
 * dall'errore se è tra gli strumenti del run, altrimenti **tutti** (un errore che non si può ricondurre a nessuno li
 * riguarda tutti), ognuno con l'errore del run. Run riuscito: gli strumenti delle fonti fallite dichiarati
 * dall'esito (P-26). In corso: nessuno.
 */
export function toolErrors(job: AttributableRun): Partial<Record<ToolId, string>> {
  const tools = toolsOfRun(job.tools);
  if (job.state === 'succeeded') {
    const declared = job.result?.tool_errors ?? {};
    return Object.fromEntries(tools.flatMap((t) => (typeof declared[t] === 'string' ? [[t, declared[t]]] : [])));
  }
  if (job.state !== 'failed') return {};
  const error = job.error ?? '';
  const named = error ? toolNamedBy(error, tools) : undefined;
  return Object.fromEntries((named && tools.includes(named) ? [named] : tools).map((t) => [t, error]));
}

/** Gli strumenti di `toolErrors`, nell'ordine del run. */
export function failedTools(job: AttributableRun): ToolId[] {
  return Object.keys(toolErrors(job)) as ToolId[];
}

/** Motivi per strumento senza i valori dei segreti (J10, A7). */
export function redactToolErrors(errors: Partial<Record<ToolId, string>>): Partial<Record<ToolId, string>> {
  return Object.fromEntries(Object.entries(errors).map(([tool, error]) => [tool, redactSecrets(error)]));
}

/** Esito di un run senza i valori dei segreti (J10, A7): riassunto, avvisi e motivi per strumento. */
export function redactResult(result: JobResult): JobResult {
  return {
    ...result,
    summary: redactSecrets(result.summary),
    warnings: result.warnings?.map(redactSecrets),
    tool_errors: result.tool_errors && redactToolErrors(result.tool_errors),
  };
}
