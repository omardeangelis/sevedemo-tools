import { z } from 'zod';
import { lazyAnthropicClient, type AnalysisClient } from '../analysis/analyze.js';
import { config } from '../config.js';
import { pendingProposal } from '../db/profile.js';
import {
  GENERATION_SOURCES,
  isGenerationSource,
  planSources,
  readSources,
  realSourceDeps,
  SOURCE_TOOLS,
  type GenerationSource,
  type SourceDeps,
  type SourceOutcome,
  type SourcePlan,
  type SourceRemedy,
} from '../profile/sources.js';
import { proposeProfile, saveProposal, type DiscardReason, type ProposalDraft } from '../profile/generate.js';
import { runLog } from '../runs/log.js';
import type { ToolId } from '../runs/tools.js';
import { formatDay } from './enrich-companies.js';
import { plural } from './errors.js';
import type { JobHandler, JobPreview, JobResult } from './types.js';

/*
 * Job `generate_profile` — "Genera profilo e servizi" (own-profile-services M4: T24 kind e blocchi, T25 stima, T26
 * elaborazione). Legge le tre fonti pubbliche scelte nell'anteprima (`src/profile/sources.ts`), le fa elaborare una
 * volta sola al modello e salva **una proposta**: nessun valore del profilo cambia finché l'utente non applica (E1).
 * Se nessuna fonte ha prodotto contenuto il modello non si chiama (D14): esito neutro, nessuna spesa, la proposta
 * pendente resta com'era. Una fonte che fallisce non ferma le altre (C12) e conta come fallita per il suo strumento
 * (`tool_errors`, P-26).
 */

/**
 * `params` congelati dalla route all'avvio: le fonti scelte (disponibili e non escluse) e quelle da rileggere anche se
 * lette di recente (D9). "Riprova…" riparte dalle stesse fonti (D12).
 */
export interface GenerateProfileParams {
  sources: GenerationSource[];
  force: GenerationSource[];
}

const sourceList = z.array(z.enum(GENERATION_SOURCES)).max(GENERATION_SOURCES.length);
/** Scelta dell'anteprima (query della preview e corpo dell'avvio): fonti escluse e fonti da rileggere. */
export const generateChoiceSchema = z.object({ exclude: sourceList.optional(), force: sourceList.optional() }).strict();
export type GenerateChoice = z.infer<typeof generateChoiceSchema>;

/** Lettura tollerante dei `params` salvati (anche quelli scritti a mano o da versioni vecchie). */
function paramsOf(raw: unknown): GenerateProfileParams {
  const read = (key: string): GenerationSource[] => {
    const value = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>)[key] : undefined;
    return Array.isArray(value) ? [...new Set(value.filter(isGenerationSource))] : [];
  };
  return { sources: read('sources'), force: read('force') };
}

/** Dipendenze iniettabili: le due fonti che chiamano uno strumento e il client del modello. */
export type Deps = { sources: SourceDeps; client: AnalysisClient };

/** Deps reali: actor del profilo, un client Cloudflare per run (`realSourceDeps`) e il client Anthropic. */
export function realDeps(): Deps {
  return { sources: realSourceDeps(), client: lazyAnthropicClient('nessuna proposta creata.') };
}

// ---------------------------------------------------------------------------
// Anteprima (D2–D9, P-28)
// ---------------------------------------------------------------------------

/** Una fonte nell'anteprima: gli avvisi che la riguardano vivono qui e solo qui (P-28), mai in `warnings`. */
export interface PreviewSource {
  kind: GenerationSource;
  /** `selected` = si legge (o si riprende, se fresca); `excluded` = tolta dall'utente; `unavailable` = col motivo. */
  state: 'selected' | 'excluded' | 'unavailable';
  address: string | null;
  /** Motivo di `unavailable`, con dove si risolve (D8, C11). */
  reason: string | null;
  /** Lo stesso motivo in poche parole (riga della card, G4). */
  short_reason: string | null;
  /** Dove si risolve: il frontend ne fa il link della riga. */
  remedy: SourceRemedy | null;
  /** Il tetto di pagine del sito (`CLOUDFLARE_MAX_PAGES`), anche con la fonte esclusa; `null` per le altre fonti. */
  max_pages: number | null;
  /** Lettura recente dello stesso indirizzo: senza rilettura si riprende quella, gratis (C4). */
  fresh_at: string | null;
  /** Rilettura chiesta di una fonte fresca ("Rileggilo comunque", D9). */
  forced: boolean;
  /** Strumento che la lettura chiamerebbe; `null` per i post e per una fonte fresca non riletta. */
  tool: ToolId | null;
  /** Costo della fonte in questa generazione (D4): 0 se non si paga, `null` se il prezzo non è configurato (D5). */
  est_cost_usd: number | null;
}

export interface GenerateProfilePreview extends JobPreview {
  sources: PreviewSource[];
  /** La riga dell'elaborazione, sempre ultima e non escludibile: modello e costo (`null` = prezzo non configurato). */
  processing: { model: string; est_cost_usd: number | null };
  /** Variabili di prezzo che mancano ai pezzi di questa generazione: senza, `est_cost_usd` è `null` (D5). */
  missing_prices: string[];
}

export const NO_SOURCE_BLOCKER = 'Nessuna fonte disponibile: imposta il profilo LinkedIn o il sito, oppure sincronizza i tuoi post.';
export const ALL_EXCLUDED_BLOCKER = 'Hai escluso tutte le fonti: scegline almeno una.';
export const ANTHROPIC_BLOCKER =
  "ANTHROPIC_API_KEY mancante nel .env: senza l'elaborazione la generazione non può partire. Vai a Connessioni.";

/** Una fonte scelta si legge davvero (chiama il suo strumento) se non è fresca o se ne è chiesta la rilettura. */
const readsNow = (plan: SourcePlan, params: GenerateProfileParams) => plan.freshAt === null || params.force.includes(plan.kind);

function previewSources(plans: SourcePlan[], params: GenerateProfileParams): PreviewSource[] {
  return plans.map((plan) => {
    const state = plan.unavailable !== null ? 'unavailable' : params.sources.includes(plan.kind) ? 'selected' : 'excluded';
    return {
      kind: plan.kind,
      state,
      address: plan.address,
      reason: plan.unavailable?.reason ?? null,
      short_reason: plan.unavailable?.short ?? null,
      remedy: plan.unavailable?.remedy ?? null,
      max_pages: plan.kind === 'website' ? config.cloudflareMaxPages : null,
      fresh_at: plan.freshAt,
      forced: plan.freshAt !== null && params.force.includes(plan.kind),
      tool: state === 'selected' && readsNow(plan, params) ? SOURCE_TOOLS[plan.kind] : null,
      // Solo il profilo costa denaro (l'actor); sito e post no (D4). Una lettura ripresa non si ripaga (C4).
      est_cost_usd: plan.kind === 'linkedin' && state === 'selected' && readsNow(plan, params) ? config.prices.profileDetailUsd : 0,
    };
  });
}

/**
 * Blocker di configurazione (D6, D7): unica fonte per anteprima, avvio e "Riprova" (`retryJob`). `plans` = le fonti già
 * pianificate da chi chiama (un solo `planSources()` per richiesta).
 */
export function configBlockers(rawParams?: unknown, plans: SourcePlan[] = planSources()): string[] {
  const params = paramsOf(rawParams);
  const blockers: string[] = [];
  if (!config.anthropicApiKey.trim()) blockers.push(ANTHROPIC_BLOCKER);
  const available = plans.filter((p) => p.unavailable === null);
  if (available.length === 0) blockers.push(NO_SOURCE_BLOCKER);
  else if (!available.some((p) => params.sources.includes(p.kind))) blockers.push(ALL_EXCLUDED_BLOCKER);
  return blockers;
}

/** Anteprima dai `params` (route e "Riprova…"): fonti, conteggi, stima, avvisi che non sono di una fonte, blocker. */
export function previewFromParams(rawParams: unknown, plans: SourcePlan[] = planSources()): GenerateProfilePreview {
  const params = paramsOf(rawParams);
  const sources = previewSources(plans, params);
  const selected = plans.filter((p) => sources.find((s) => s.kind === p.kind)!.state === 'selected');
  const posts = plans.find((p) => p.kind === 'posts')!.posts!;
  const counts = {
    sources_available: plans.filter((p) => p.unavailable === null).length,
    sources_selected: selected.length,
    profile_reads: selected.some((p) => p.kind === 'linkedin' && readsNow(p, params)) ? 1 : 0,
    site_max_pages: selected.some((p) => p.kind === 'website' && readsNow(p, params)) ? config.cloudflareMaxPages : 0,
    // I post integrali che ci sono, anche con la fonte esclusa: la riga della fonte li dice comunque (D3).
    posts_complete: posts.complete,
    posts_excerpts: posts.excerpts,
    generations: 1,
  };
  const pending = pendingProposal();
  const warnings = pending
    ? [`C'è una proposta del ${formatDay(pending.created_at)} non applicata: una nuova generazione la sostituisce. Le voci già applicate restano.`]
    : [];
  const processing = { model: config.profileModel, est_cost_usd: config.prices.profileGenerationUsd };
  const missing_prices = [
    ...(sources.some((s) => s.est_cost_usd === null) ? ['PRICE_PROFILE_DETAIL_USD'] : []),
    ...(processing.est_cost_usd === null ? ['PRICE_PROFILE_GENERATION_USD'] : []),
  ];
  const pieces = [...sources.map((s) => s.est_cost_usd), processing.est_cost_usd];
  const est_cost_usd = pieces.some((c) => c === null) ? null : pieces.reduce<number>((sum, c) => sum + c!, 0);
  return { counts, est_cost_usd, warnings, blockers: configBlockers(params, plans), sources, processing, missing_prices };
}

/** Dalla scelta dell'anteprima ai `params` da congelare: le fonti disponibili non escluse, le riletture fra queste. */
export function planGenerateProfile(choice: GenerateChoice = {}): { params: GenerateProfileParams; preview: GenerateProfilePreview } {
  const exclude = new Set(choice.exclude ?? []);
  const plans = planSources();
  const sources = plans.filter((p) => p.unavailable === null && !exclude.has(p.kind)).map((p) => p.kind);
  const force = (choice.force ?? []).filter((kind) => sources.includes(kind));
  const params = { sources, force };
  return { params, preview: previewFromParams(params, plans) };
}

/** Strumenti del run: quelli delle fonti che si leggono davvero, più Anthropic per l'elaborazione. */
export function toolsOf(rawParams: unknown): ToolId[] {
  const params = paramsOf(rawParams);
  const tools = previewSources(planSources(), params)
    .map((s) => s.tool)
    .filter((t): t is ToolId => t !== null);
  return [...new Set<ToolId>([...tools, 'anthropic'])];
}

// ---------------------------------------------------------------------------
// Esecuzione
// ---------------------------------------------------------------------------

/** Nome della fonte negli esiti. */
export const SOURCE_LABELS: Record<GenerationSource, string> = { linkedin: 'Profilo LinkedIn', website: 'Sito', posts: 'I miei post' };

/** Conteggi dell'esito per fonte: la tabella della card li rilegge con le righe di `profile_sources` (P-16). */
function sourceCounts(outcomes: SourceOutcome[]) {
  const n = (outcome: SourceOutcome['outcome']) => outcomes.filter((o) => o.outcome === outcome).length;
  return {
    sources_read: n('read'),
    sources_reused: outcomes.filter((o) => o.reused).length,
    sources_empty: n('empty'),
    sources_failed: n('failed'),
    sources_unavailable: n('unavailable'),
    sources_excluded: n('excluded'),
  };
}

/** Avvisi dell'esito: le fonti fallite col motivo, poi gli avvisi di ciascuna fonte (C13). */
function outcomeWarnings(outcomes: SourceOutcome[]): string[] {
  return outcomes.flatMap((o) => [
    ...(o.outcome === 'failed' ? [`${SOURCE_LABELS[o.kind]} non letto: ${o.reason}`] : []),
    ...o.warnings.map((w) => `${SOURCE_LABELS[o.kind]}: ${w}`),
  ]);
}

function toolErrors(outcomes: SourceOutcome[]): JobResult['tool_errors'] {
  const errors = Object.fromEntries(outcomes.flatMap((o) => (o.toolError ? [[o.toolError.tool, o.toolError.error]] : [])));
  return Object.keys(errors).length > 0 ? errors : undefined;
}

/** Handler registrato in `HANDLERS.generate_profile`. */
export const handler: JobHandler<GenerateProfileParams, Deps> = async (rawParams, deps) => {
  const params = paramsOf(rawParams);
  const outcomes = await readSources({ include: params.sources, force: params.force }, deps.sources);
  const counts = sourceCounts(outcomes);
  const warnings = outcomeWarnings(outcomes);
  const tool_errors = toolErrors(outcomes);
  const withContent = outcomes.filter((o) => o.content !== null && o.content !== '');

  if (withContent.length === 0) {
    const pending = pendingProposal();
    return {
      summary:
        'Nessuna fonte ha prodotto contenuto: il modello non è stato chiamato, nessuna spesa di elaborazione.' +
        (pending ? ` La proposta del ${formatDay(pending.created_at)} resta com'era.` : ''),
      counts: { ...counts, no_content: 1, fields_proposed: 0, services_proposed: 0, discarded: 0 },
      warnings,
      ...(tool_errors ? { tool_errors } : {}),
    };
  }

  runLog.info('Anthropic · elaborazione del profilo');
  const { draft, model } = await proposeProfile(deps.client, withContent);
  const proposalId = saveProposal(draft, outcomes, model);
  const fields = Object.keys(draft.fields).length;
  const services = draft.services.length;
  const poor = services === 0 && fields <= 2;
  const posts = outcomes.find((o) => o.kind === 'posts' && o.content);
  return {
    summary: poor
      ? `Proposta povera: ${plural(fields, 'campo', 'campi')} e ${servicesText(services)}. Le fonti lette dicono poco di cosa vendi.`
      : [
          `Proposta pronta: ${plural(fields, 'campo del profilo', 'campi del profilo')} e ${servicesText(services)}`,
          `fonti lette ${withContent.length} su ${GENERATION_SOURCES.length}`,
          ...(posts ? [postsText(posts)] : []),
        ].join(' · ') + `.${discardedText(draft)}`,
    counts: {
      ...counts,
      no_content: 0,
      poor: poor ? 1 : 0,
      proposal_id: proposalId,
      fields_proposed: fields,
      services_proposed: services,
      discarded: draft.discarded.length,
    },
    warnings,
    ...(tool_errors ? { tool_errors } : {}),
  };
};

function servicesText(n: number): string {
  return n === 0 ? 'nessun servizio' : plural(n, 'servizio', 'servizi');
}

/** "12 post per intero (30 solo estratto, non usati)" (C8). */
function postsText(posts: SourceOutcome): string {
  const used = typeof posts.meta.used === 'number' ? posts.meta.used : 0;
  const excerpts = typeof posts.meta.excerpts === 'number' ? posts.meta.excerpts : 0;
  return `${used} post per intero${excerpts > 0 ? ` (${excerpts} solo estratto, non usati)` : ''}`;
}

const DISCARD_ONE: Record<DiscardReason, string> = {
  no_source: '1 voce scartata perché senza fonte.',
  duplicate: '1 voce scartata: nome già proposto.',
  not_generable: '1 voce scartata: non è un campo che si propone.',
  too_many: '1 voce scartata: oltre il numero massimo di servizi.',
};
const DISCARD_MANY: Record<DiscardReason, (n: number) => string> = {
  no_source: (n) => `${n} senza fonte`,
  duplicate: (n) => `${n} con un nome già proposto`,
  not_generable: (n) => `${n} ${n === 1 ? 'non generabile' : 'non generabili'}`,
  too_many: (n) => `${n} oltre il numero massimo di servizi`,
};

/** Le voci scartate nell'esito (E6), dopo la frase principale: vuoto se nessuna. */
function discardedText(draft: ProposalDraft): string {
  const total = draft.discarded.length;
  if (total === 0) return '';
  if (total === 1) return ` ${DISCARD_ONE[draft.discarded[0]!.reason]}`;
  const reasons = (Object.keys(DISCARD_MANY) as DiscardReason[])
    .map((reason) => [reason, draft.discarded.filter((d) => d.reason === reason).length] as const)
    .filter(([, n]) => n > 0)
    .map(([reason, n]) => DISCARD_MANY[reason](n));
  return ` ${total} voci scartate: ${reasons.join(', ')}.`;
}
