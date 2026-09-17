import type Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import {
  hasProfileData,
  latestAnalysis,
  loadAnalysisSubject,
  recordAnalysisFailure,
  saveAnalysis,
  type AnalysisErrorKind,
  type AnalysisSubject,
} from '../db/analyses.js';
import type { Activity } from '../db/activities.js';
import { getIcpContext, type IcpContext } from '../db/icps.js';
import type { AnalysisView } from '../db/prospects.js';
import { enrichOneInline, type Deps as EnrichDeps } from '../jobs/enrich.js';
import { buildAnalysisInput, type AnalysisContext, type AnalysisInput } from './prompt.js';
import { ANALYSIS_JSON_SCHEMA, parseAnalysis, type AnalysisOutput } from './schema.js';

/*
 * Analisi AI di un prospect (crm-foundation T11, D8/D12/P5): un prospect arricchito (o con About
 * compilato), l'ICP e l'azienda dell'utente → riassunto, 3 angoli, fit. Structured outputs
 * (`output_config.format`) + parse zod con 1 retry; refusal / risposta troncata / non valida
 * lasciano un'attività `analysis` con `meta.error` e nessuna riga `analyses`. Mai lancia per
 * errori del modello o del provider: l'esito è nel risultato (la route e il job lo traducono).
 */

/** Budget dell'arricchimento inline (`enrichFirst`) e deadline condivisa dei tentativi al modello. */
export const ENRICH_FIRST_TIMEOUT_MS = 120_000;
export const ANALYSIS_TIMEOUT_MS = 90_000;
/** Tetto alto: con Opus 5 il ragionamento conta nel limite (i 4000 del PLAN rischiavano risposte troncate). Resta sotto la soglia non-streaming dell'SDK. */
export const ANALYSIS_MAX_TOKENS = 16_000;

/** Risposta del modello: il sottoinsieme di `Anthropic.Message` che l'analisi legge (i fake restano piccoli). */
export interface AnalysisResponse {
  content: Array<{ type: string; text?: string }>;
  stop_reason: string | null;
  stop_details?: { category?: string | null; explanation?: string | null } | null;
}

/** Client Anthropic iniettabile: `new Anthropic()` lo soddisfa, i test passano un fake. */
export interface AnalysisClient {
  messages: {
    create(body: Anthropic.MessageCreateParamsNonStreaming, options?: { signal?: AbortSignal }): Promise<AnalysisResponse>;
  };
}

/** Testi mostrati all'utente (FLOW, error paths dell'analisi). */
export const ANALYSIS_MESSAGES = {
  refusal: 'Il modello ha rifiutato di analizzare questo profilo. Puoi riprovare o scrivere il messaggio a mano.',
  invalid_output: 'Risposta del modello non valida (2 tentativi). Riprova tra poco.',
  max_tokens: 'Risposta del modello troncata (limite di token raggiunto). Riprova tra poco.',
  not_enriched: 'Profilo non arricchito: arricchiscilo prima (oppure usa "Arricchisci e analizza").',
  not_enrichable: 'Profilo senza dati pubblici: analisi non possibile. Puoi compilare a mano About/ruolo e riprovare.',
} as const;

export type AnalyzeResult =
  | { outcome: 'analyzed'; prospectId: number; analysis: AnalysisView; enrichedFirst: boolean }
  | { outcome: 'skipped_same_input'; prospectId: number; analysis: AnalysisView; enrichedFirst: boolean }
  | { outcome: 'not_found' | 'icp_not_found'; prospectId: number }
  | { outcome: 'not_enriched'; prospectId: number; error: string }
  /** `enrichFirst` senza dati sul profilo. */
  | { outcome: 'not_enrichable'; prospectId: number; error: string }
  /** `enrichFirst` fallito per il provider o la configurazione (`actor:` / `config:`). */
  | { outcome: 'enrich_error'; prospectId: number; error: string }
  /**
   * Il modello non ha prodotto un'analisi: `activity` è la voce `analysis` con `meta.error`
   * (assente per gli errori di configurazione, che non riguardano il prospect).
   */
  | {
      outcome: 'failed';
      prospectId: number;
      errorKind: AnalysisErrorKind;
      error: string;
      enrichedFirst: boolean;
      activity: Activity | null;
    };

export interface AnalyzeOptions {
  client: AnalysisClient;
  /** Deps di enrichment (T10): obbligatorie solo con `enrichFirst`. */
  enrich?: EnrichDeps;
  /** Rianalizza anche se l'input è identico all'ultima analisi. */
  force?: boolean;
  /** Se il prospect non ha dati, lo arricchisce inline (sincrono, budget 120 s) prima di analizzarlo. */
  enrichFirst?: boolean;
  /** Lista di contesto per le attività (job su lista). */
  listId?: number | null;
  /** Override della deadline dei tentativi al modello (default 90 s). */
  timeoutMs?: number;
  /** Contesto ICP già letto (job bulk: una lettura per tutti i prospect). */
  icpContext?: IcpContext;
}

/** Contesto del prompt con il prospect completo (dati d'arricchimento inclusi). */
export type SubjectContext = AnalysisContext & { prospect: AnalysisSubject };

/** Contesto completo per il prompt, `null` se il prospect non esiste. */
export function analysisContext(prospectId: number, icp: IcpContext): SubjectContext | null {
  const prospect = loadAnalysisSubject(prospectId);
  if (!prospect) return null;
  return { company: icp.company, icp: icp.icp, referenceCompanies: icp.referenceCompanies, prospect };
}

/** Input del prompt nella modalità configurata (structured outputs o JSON-only). */
export function analysisInput(ctx: AnalysisContext): AnalysisInput {
  return buildAnalysisInput(ctx, { jsonOnly: !config.analysisStructured });
}

function errorText(err: unknown): string {
  const message = (err instanceof Error ? err.message : String(err)).replace(/\s+/g, ' ').trim() || 'errore sconosciuto';
  return message.length > 300 ? `${message.slice(0, 300)}…` : message;
}

/** Errore di configurazione del modello: chiave mancante (`config:` dalle deps) o rifiutata dall'API. */
function configErrorOf(err: unknown): string | undefined {
  const message = errorText(err);
  if (message.startsWith('config:')) return message;
  const status = (err as { status?: unknown } | null)?.status;
  if (status === 401 || status === 403) {
    return `config: ANTHROPIC_API_KEY non valida o senza permessi per ${config.analysisModel} (HTTP ${status}).`;
  }
  return undefined;
}

type ModelAttempt =
  | { ok: true; output: AnalysisOutput }
  | { ok: false; kind: AnalysisErrorKind; error: string; refusalCategory?: string | null; config?: boolean };

/** Chiamata al modello con 1 retry su risposta non valida, entro un'unica deadline condivisa. */
async function callModel(client: AnalysisClient, input: AnalysisInput, timeoutMs: number): Promise<ModelAttempt> {
  const signal = AbortSignal.timeout(timeoutMs);
  let lastIssue = '';
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const user =
      attempt === 1
        ? input.user
        : `${input.user}\n\nNota: la risposta precedente non era valida (${lastIssue}). Rispetta esattamente il formato richiesto.`;
    const body: Anthropic.MessageCreateParamsNonStreaming = {
      model: config.analysisModel,
      max_tokens: ANALYSIS_MAX_TOKENS,
      system: input.system,
      messages: [{ role: 'user', content: user }],
      ...(config.analysisStructured ? { output_config: { format: { type: 'json_schema', schema: ANALYSIS_JSON_SCHEMA } } } : {}),
    };

    let response: AnalysisResponse;
    try {
      response = await client.messages.create(body, { signal });
    } catch (err) {
      const configError = configErrorOf(err);
      if (configError) return { ok: false, kind: 'error', error: configError, config: true };
      if (signal.aborted) {
        return { ok: false, kind: 'error', error: `Nessuna risposta dal modello entro ${Math.round(timeoutMs / 1000)} s. Riprova tra poco.` };
      }
      return { ok: false, kind: 'error', error: `Chiamata al modello non riuscita: ${errorText(err)}` };
    }

    if (response.stop_reason === 'refusal') {
      return { ok: false, kind: 'refusal', error: ANALYSIS_MESSAGES.refusal, refusalCategory: response.stop_details?.category ?? null };
    }
    if (response.stop_reason === 'max_tokens') {
      return { ok: false, kind: 'max_tokens', error: ANALYSIS_MESSAGES.max_tokens };
    }
    const text = response.content
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('');
    const parsed = parseAnalysis(text);
    if (parsed.ok) return { ok: true, output: parsed.value };
    lastIssue = parsed.error;
  }
  return { ok: false, kind: 'invalid_output', error: ANALYSIS_MESSAGES.invalid_output };
}

/**
 * Analizza `prospectId` per `icpId`. Senza dati sul profilo: `not_enriched`, oppure con
 * `enrichFirst` arricchimento inline (T10) e poi analisi. Input identico all'ultima analisi →
 * `skipped_same_input` (nessuna chiamata) salvo `force`. Il prospect può cambiare id solo per
 * esserne unito un altro: l'id restituito è sempre quello da rileggere.
 */
export async function analyzeProspect(prospectId: number, icpId: number, opts: AnalyzeOptions): Promise<AnalyzeResult> {
  const icp = opts.icpContext ?? getIcpContext(icpId);
  if (!icp) return { outcome: 'icp_not_found', prospectId };

  let ctx = analysisContext(prospectId, icp);
  if (!ctx) return { outcome: 'not_found', prospectId };

  let enrichedFirst = false;
  if (!hasProfileData(ctx.prospect)) {
    if (!opts.enrichFirst) return { outcome: 'not_enriched', prospectId, error: ANALYSIS_MESSAGES.not_enriched };
    if (!opts.enrich) return { outcome: 'enrich_error', prospectId, error: 'config: deps di arricchimento mancanti.' };
    const enriched = await enrichOneInline(prospectId, opts.enrich, { timeoutMs: ENRICH_FIRST_TIMEOUT_MS });
    if (enriched.outcome === 'not_found') return { outcome: 'not_found', prospectId };
    if (enriched.outcome === 'no_data') return { outcome: 'not_enrichable', prospectId, error: ANALYSIS_MESSAGES.not_enrichable };
    if (enriched.outcome === 'error') return { outcome: 'enrich_error', prospectId, error: enriched.error ?? 'errore sconosciuto' };
    enrichedFirst = true;
    ctx = analysisContext(enriched.prospectId, icp);
    if (!ctx) return { outcome: 'not_found', prospectId };
  }

  const input = analysisInput(ctx);
  const latest = latestAnalysis(prospectId, icpId);
  if (!opts.force && latest && latest.input_hash === input.inputHash) {
    return { outcome: 'skipped_same_input', prospectId, analysis: latest, enrichedFirst };
  }

  const attempt = await callModel(opts.client, input, opts.timeoutMs ?? ANALYSIS_TIMEOUT_MS);
  if (!attempt.ok) {
    const activity = attempt.config
      ? null
      : recordAnalysisFailure({
          prospectId,
          icpId,
          model: config.analysisModel,
          kind: attempt.kind,
          error: attempt.error,
          listId: opts.listId,
          refusalCategory: attempt.refusalCategory,
        });
    return { outcome: 'failed', prospectId, errorKind: attempt.kind, error: attempt.error, enrichedFirst, activity };
  }

  const saved = saveAnalysis({
    prospectId,
    icpId,
    icpName: icp.icp.name,
    model: config.analysisModel,
    output: attempt.output,
    inputHash: input.inputHash,
    listId: opts.listId,
  });
  if (!saved) return { outcome: 'not_found', prospectId };
  return { outcome: 'analyzed', prospectId, analysis: saved.analysis, enrichedFirst };
}
