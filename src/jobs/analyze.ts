import Anthropic from '@anthropic-ai/sdk';
import pLimit from 'p-limit';
import { z } from 'zod';
import { analysisContext, analysisInput, analyzeProspect, type AnalysisClient, type AnalyzeResult } from '../analysis/analyze.js';
import { config } from '../config.js';
import { hasProfileData } from '../db/analyses.js';
import { getIcp, getIcpContext, type IcpContext } from '../db/icps.js';
import { db } from '../db/index.js';
import { getList, isListArchived } from '../db/lists.js';
import type { ToolId } from '../runs/tools.js';
import { enrichOneInline, realDeps as enrichRealDeps, type Deps as EnrichDeps } from './enrich.js';
import { attributeError, excluded, plural } from './errors.js';
import type { JobHandler, JobPreview, JobResult, RunOutcomeWrite } from './types.js';

/*
 * Job `analyze` — analisi AI in bulk su una lista o su una selezione (crm-foundation T11, P5):
 * prima arricchisce i prospect senza dati (a concorrenza `enrichConcurrency`), poi analizza a
 * concorrenza 3. Un prospect che fallisce non ferma il job; la configurazione mancante sì (`config:`).
 */

/** Dipendenze iniettabili (I/O esterno): il client Anthropic e le deps di enrichment di T10. */
export type Deps = {
  client: AnalysisClient;
  enrich: EnrichDeps;
};

/**
 * Ambito: membri di una lista (ICP = quello della lista) oppure una selezione con ICP esplicito. Chi ha già
 * un'analisi per l'ICP si salta sempre, salvo `onlyMissing: false` ("Includi chi è già analizzato", che salta
 * comunque gli input identici); `force` rianalizza anche con input identico (resta per l'analisi singola, F11).
 */
export type AnalyzeParams = (
  | { listId: number; prospectIds?: undefined; icpId?: undefined }
  | { prospectIds: number[]; icpId: number; listId?: undefined }
) & {
  /**
   * Salta i prospect che hanno già un'analisi per l'ICP, anche se i dati sono cambiati. Default `true` su lista
   * **e** su selezione (own-profile-services F8, P-9): nessuna rianalisi nasce da sé.
   */
  onlyMissing?: boolean;
  force?: boolean;
};

const ANALYZE_CONCURRENCY = 3;

const paramsSchema = z
  .object({
    listId: z.number().int().positive().optional(),
    prospectIds: z.array(z.number().int().positive()).min(1).optional(),
    icpId: z.number().int().positive().optional(),
    onlyMissing: z.boolean().optional(),
    force: z.boolean().optional(),
  })
  .refine((p) => (p.listId === undefined) !== (p.prospectIds === undefined), 'serve listId oppure prospectIds')
  .refine((p) => p.listId !== undefined || p.icpId !== undefined, 'con prospectIds serve icpId');

// ---------------------------------------------------------------------------
// Pianificazione (condivisa da job e preview)
// ---------------------------------------------------------------------------

export interface AnalysisPlan {
  /** ICP dell'analisi (della lista o esplicito); `null` se la lista non esiste. */
  icpId: number | null;
  /** Prospect esistenti nell'ambito. */
  selected: number;
  /** Da arricchire prima (nessun dato sul profilo, nessun tentativo recente senza esito). */
  enrichTargets: number[];
  /** Da analizzare, nell'ordine dell'ambito: include quelli da arricchire prima. */
  analyzeTargets: number[];
  /** Ultima analisi per l'ICP con lo stesso input: saltati salvo `force` (contati solo con `onlyMissing: false`). */
  skipped_same_input: number;
  /** Già analizzati per l'ICP: saltati con `onlyMissing` (il default) senza confrontare l'input (P-8). */
  skipped_analyzed: number;
  /** Già analizzati con input cambiato che finiscono tra i bersagli (solo con `onlyMissing: false` o `force`). */
  to_redo: number;
  /** Senza dati e arricchimento tentato negli ultimi `freshnessDays` senza esito. */
  not_enrichable: number;
  /** Id richiesti che non esistono (solo ambito `prospectIds`). */
  not_found: number;
  /** Persone senza profilo LinkedIn (aggiunte a mano): escluse, fuori da stima e spesa (people-first-crm E11). */
  no_linkedin: number;
}

interface PlanRow {
  id: number;
  about: string | null;
  enriched_at: string | null;
  enrichment_attempted_at: string | null;
  linkedin_url: string | null;
}

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ');

function scopeRows(params: AnalyzeParams): { rows: PlanRow[]; notFound: number } {
  const columns = 'p.id, p.about, p.enriched_at, p.enrichment_attempted_at, p.linkedin_url';
  if (params.prospectIds !== undefined) {
    const ids = [...new Set(params.prospectIds)];
    if (ids.length === 0) return { rows: [], notFound: 0 };
    const found = new Map(
      (db.prepare(`SELECT ${columns} FROM prospects p WHERE p.id IN (${placeholders(ids.length)})`).all(...ids) as PlanRow[]).map(
        (r) => [r.id, r],
      ),
    );
    const rows = ids.flatMap((id) => found.get(id) ?? []);
    return { rows, notFound: ids.length - rows.length };
  }
  const rows = db
    .prepare(
      `SELECT ${columns} FROM list_members lm JOIN prospects p ON p.id = lm.prospect_id
       WHERE lm.list_id = ? ORDER BY lm.added_at, p.id`,
    )
    .all(params.listId) as PlanRow[];
  return { rows, notFound: 0 };
}

function latestHashes(ids: number[], icpId: number): Map<number, string> {
  if (ids.length === 0) return new Map();
  const rows = db
    .prepare(
      `SELECT prospect_id, input_hash FROM (
         SELECT prospect_id, input_hash, ROW_NUMBER() OVER (PARTITION BY prospect_id ORDER BY created_at DESC, id DESC) AS rn
         FROM analyses WHERE icp_id = ? AND prospect_id IN (${placeholders(ids.length)})
       ) WHERE rn = 1`,
    )
    .all(icpId, ...ids) as Array<{ prospect_id: number; input_hash: string }>;
  return new Map(rows.map((r) => [r.prospect_id, r.input_hash]));
}

/** ICP dell'ambito: quello della lista, oppure `icpId` della selezione. */
export function scopeIcpId(params: AnalyzeParams): number | null {
  if (params.listId === undefined) return params.icpId;
  return getList(params.listId)?.icp_id ?? null;
}

/**
 * Chi arricchire e chi analizzare per l'ambito. Un prospect già analizzato per l'ICP si salta sempre con
 * `onlyMissing` (il default, F8), senza leggerne contesto e impronta (P-8); con `onlyMissing: false` si salta
 * solo se l'input è identico; `force` rifà tutto. Non verifica che la lista sia attiva né la configurazione:
 * quelli sono blocchi della preview e `config:` del job.
 */
export function planAnalysis(
  params: AnalyzeParams,
  now: number = Date.now(),
  icp?: IcpContext | null,
  opts: { enrichTargetsOnly?: boolean } = {},
): AnalysisPlan {
  const icpId = scopeIcpId(params);
  const { rows, notFound } = scopeRows(params);
  const plan: AnalysisPlan = {
    icpId,
    selected: rows.length,
    enrichTargets: [],
    analyzeTargets: [],
    skipped_same_input: 0,
    skipped_analyzed: 0,
    to_redo: 0,
    not_enrichable: 0,
    not_found: notFound,
    no_linkedin: 0,
  };
  const context = icpId === null ? null : (icp ?? getIcpContext(icpId));
  if (icpId === null || !context) return plan;

  const onlyMissing = params.onlyMissing ?? true;
  const hashes = latestHashes(
    rows.map((r) => r.id),
    icpId,
  );
  const cutoff = now - config.freshnessDays * 86_400_000;
  for (const r of rows) {
    if (r.linkedin_url === null) {
      plan.no_linkedin += 1;
      continue;
    }
    const latest = hashes.get(r.id);
    if (!hasProfileData(r)) {
      if (latest !== undefined && onlyMissing && !params.force) plan.skipped_analyzed += 1;
      else if (r.enrichment_attempted_at !== null && Date.parse(r.enrichment_attempted_at) > cutoff) plan.not_enrichable += 1;
      else {
        plan.enrichTargets.push(r.id);
        plan.analyzeTargets.push(r.id);
      }
      continue;
    }
    if (latest !== undefined && !params.force) {
      // P-8: con `onlyMissing` il confronto dell'input (una lettura + un hash a persona) non serve a nessun
      // conteggio mostrato. `enrichTargetsOnly`: chi ha già i dati non entra mai in `enrichTargets`.
      if (onlyMissing || opts.enrichTargetsOnly) {
        plan.skipped_analyzed += 1;
        continue;
      }
      const ctx = analysisContext(r.id, context);
      if (ctx && analysisInput(ctx).inputHash === latest) {
        plan.skipped_same_input += 1;
        continue;
      }
    }
    plan.analyzeTargets.push(r.id);
  }
  plan.to_redo = plan.analyzeTargets.filter((id) => hashes.has(id)).length;
  return plan;
}

/** Blocker "chiave Anthropic mancante": stesso testo in preview, avvio, analisi singola e "Riprova". */
export const ANTHROPIC_BLOCKER = 'ANTHROPIC_API_KEY mancante nel .env — nessuna analisi avviata.';

/**
 * Blocker di configurazione dell'analisi bulk (preview, avvio e "Riprova" via registry `CONFIG_BLOCKERS`,
 * apollo-lookalike T6): chiave Anthropic mancante, lista o ICP spariti, lista archiviata, token Apify
 * mancante quando l'ambito ha prospect da arricchire prima. Senza `plan` lo ricalcola dai `params`
 * (lo stato dei prospect può essere cambiato dopo il lancio). Il "job in corso" lo aggiunge la preview.
 */
export function configBlockers(params: AnalyzeParams, plan?: AnalysisPlan): string[] {
  const blockers: string[] = [];
  if (!config.anthropicApiKey.trim()) blockers.push(ANTHROPIC_BLOCKER);
  if (params.listId !== undefined) {
    // Lista sparita: la route risponde 404 prima di arrivare qui; conta per "Riprova".
    if (!getList(params.listId)) blockers.push('Lista non trovata.');
    else if (isListArchived(params.listId)) {
      blockers.push('Lista archiviata: analisi disabilitata (lettura ed export restano possibili).');
    }
  } else if (params.icpId !== undefined && !getIcp(params.icpId)) {
    blockers.push('ICP non trovato.');
  }
  // Il piano serve solo senza token Apify (conta i prospect da arricchire prima).
  if (!config.apifyToken.trim()) {
    const toEnrich = (plan ?? planAnalysis(params)).enrichTargets.length;
    if (toEnrich > 0) {
      const who = plural(toEnrich, 'persona va arricchita', 'persone vanno arricchite');
      blockers.push(`APIFY_TOKEN mancante nel .env: ${who} prima dell'analisi — nessun job avviato.`);
    }
  }
  return blockers;
}

/**
 * Strumenti del run (J3): il modello di Anthropic sempre; anche Apify se il piano prevede di arricchire
 * qualcuno prima di analizzarlo (P5). Il piano si rilegge adesso (è il momento dell'avvio), senza il
 * confronto degli input, che qui non serve.
 */
export function toolsOf(params: AnalyzeParams): ToolId[] {
  return withApify(planAnalysis(params, Date.now(), undefined, { enrichTargetsOnly: true }).enrichTargets.length > 0);
}

/**
 * Esito del run di un'analisi singola (J4): analizzata = completato; rifiuto del modello o profilo senza
 * dati = completato con avvisi (lo strumento ha risposto); il resto è fallito, con l'errore attribuito al
 * modello quando non porta già un prefisso suo.
 */
export function detachedOutcome(r: AnalyzeResult, who: string): RunOutcomeWrite {
  const ok = (summary: string, counts: Record<string, number>, warnings: string[] = []) =>
    ({ state: 'succeeded', result: { summary, counts, warnings } }) as const;
  switch (r.outcome) {
    case 'analyzed':
    case 'skipped_same_input':
      return ok(`Analisi di ${who}: 1 analizzata.`, { analyzed: 1, enriched_first: r.enrichedFirst ? 1 : 0 });
    case 'not_enrichable':
      return ok(`Analisi di ${who}: profilo senza dati, non analizzata.`, { analyzed: 0, not_enrichable: 1 }, [r.error]);
    case 'failed':
      if (r.errorKind === 'refusal') {
        return ok(`Analisi di ${who}: profilo rifiutato dal modello.`, { analyzed: 0, refusals: 1 }, [r.error]);
      }
      return { state: 'failed', error: attributeError(r.error, `actor:${config.analysisModel}`) };
    case 'enrich_error':
      return { state: 'failed', error: attributeError(r.error) };
    default:
      return { state: 'failed', error: attributeError(`${who} non è più nel CRM: analisi interrotta.`) };
  }
}

/**
 * Strumenti dell'**analisi singola** dalla scheda (P-13): la persona è una sola e i suoi dati sono già letti,
 * quindi la regola di `toolsOf` si applica a lei senza ricalcolare il piano.
 */
export function toolsOfSingle(subject: Parameters<typeof hasProfileData>[0], enrichFirst: boolean | undefined): ToolId[] {
  return withApify(enrichFirst === true && !hasProfileData(subject));
}

const withApify = (enrichesFirst: boolean): ToolId[] => (enrichesFirst ? ['anthropic', 'apify'] : ['anthropic']);

/**
 * Preview uniforme (P7) + `model` dai `params` salvati: conteggi del piano, stima, warning, blocchi di
 * configurazione. La usano la route della preview e "Riprova…" (registry `RETRY_PREVIEWS`,
 * people-first-crm T17); il blocker "job in corso" lo aggiunge il server (`withRunningBlocker`).
 */
export function previewFromParams(params: AnalyzeParams): JobPreview & { model: string } {
  const plan = planAnalysis(params);
  const icp = plan.icpId === null ? null : getIcpContext(plan.icpId);
  const estimate = estimateAnalysisCostUsd(plan);

  const warnings: string[] = [];
  if (icp && !icp.company.description) warnings.push('Descrizione della tua azienda vuota: angoli meno mirati.');
  if (icp && !icp.icp.pains && !icp.icp.description) warnings.push("L'ICP non ha pains/descrizione: il fit sarà poco affidabile.");
  if (estimate.enrichmentUnavailable) {
    warnings.push(
      "Prezzo per profilo non configurato (PRICE_PROFILE_DETAIL_USD): stima arricchimento non disponibile, la stima copre solo l'analisi.",
    );
  }
  if (plan.no_linkedin > 0) warnings.push(`${plan.no_linkedin} senza LinkedIn: ${excluded(plan.no_linkedin)}.`);
  const empty = emptyScopeBlocker(plan, params.listId !== undefined);

  return {
    counts: {
      selected: plan.selected,
      to_enrich: plan.enrichTargets.length,
      to_analyze: plan.analyzeTargets.length,
      skipped_same_input: plan.skipped_same_input,
      skipped_analyzed: plan.skipped_analyzed,
      to_redo: plan.to_redo,
      not_enrichable: plan.not_enrichable,
      not_found: plan.not_found,
      no_linkedin: plan.no_linkedin,
    },
    est_cost_usd: estimate.usd,
    warnings,
    blockers: [...configBlockers(params, plan), ...(empty ? [empty] : [])],
    model: config.analysisModel,
  };
}

/**
 * Blocco "niente da analizzare" (own-profile-services G-12): con zero da analizzare **Avvia** si disabilita
 * invece di far partire un job che non fa niente. Il motivo è quello vero dell'ambito: "dati identici" solo
 * quando è davvero così (casella "Includi chi è già analizzato" accesa e tutti con l'input di allora), altrimenti
 * i gruppi che restano fuori. `null` se c'è almeno una persona da analizzare.
 */
function emptyScopeBlocker(plan: AnalysisPlan, isList: boolean): string | null {
  if (plan.analyzeTargets.length > 0) return null;
  const n = plan.selected;
  if (n === 0) return isList ? 'Nessuna persona da analizzare: la lista è vuota.' : 'Nessuna persona da analizzare: le persone scelte non sono più nel CRM.';
  const one = n === 1;
  const noneHas = one ? "l'unica persona non ha" : `nessuna delle ${n} ha`;
  if (plan.skipped_same_input === n) {
    return one
      ? "L'unica persona ha gli stessi dati di quando è stata analizzata: non ci sarebbe nulla da rifare."
      : `Nessuna delle ${n} ha dati diversi da quando è stata analizzata: non ci sarebbe nulla da rifare.`;
  }
  if (plan.skipped_analyzed === n) {
    const who = one ? "l'unica persona ha" : `tutte e ${n} hanno`;
    return `Nessuna persona da analizzare: ${who} già un'analisi per questo ICP. Per ${one ? 'rifarla' : 'rifarle'} spunta «Includi chi è già analizzato».`;
  }
  if (plan.no_linkedin === n) return `Nessuna persona da analizzare: ${noneHas} un profilo LinkedIn.`;
  if (plan.not_enrichable === n) {
    return `Nessuna persona da analizzare: ${noneHas} dati sul profilo (arricchimento tentato di recente senza esito).`;
  }
  const parts = [
    plan.skipped_analyzed > 0 && `${plural(plan.skipped_analyzed, 'ha', 'hanno')} già un'analisi per questo ICP`,
    plan.skipped_same_input > 0 && `${plan.skipped_same_input} con gli stessi dati dell'ultima analisi`,
    plan.no_linkedin > 0 && `${plan.no_linkedin} senza LinkedIn`,
    plan.not_enrichable > 0 && `${plan.not_enrichable} senza dati sul profilo`,
  ].filter((p): p is string => typeof p === 'string');
  return `Nessuna persona da analizzare: ${parts.join(', ')}.`;
}

export interface AnalysisCostEstimate {
  /** Analisi (+ arricchimenti se il prezzo per profilo è configurato). */
  usd: number;
  /** `true` se servono arricchimenti ma `PRICE_PROFILE_DETAIL_USD` non è configurato (la stima copre solo l'analisi). */
  enrichmentUnavailable: boolean;
}

/** Stima per la preview: `to_analyze × analisi` + `to_enrich × profile-detail` (mai un prezzo inventato). */
export function estimateAnalysisCostUsd(plan: Pick<AnalysisPlan, 'enrichTargets' | 'analyzeTargets'>): AnalysisCostEstimate {
  const analysis = plan.analyzeTargets.length * config.prices.analysisPerProspectUsd;
  const price = config.prices.profileDetailUsd;
  const toEnrich = plan.enrichTargets.length;
  const enrichment = toEnrich > 0 && price !== null ? toEnrich * price : 0;
  return { usd: Number((analysis + enrichment).toFixed(4)), enrichmentUnavailable: toEnrich > 0 && price === null };
}

// ---------------------------------------------------------------------------
// Job bulk
// ---------------------------------------------------------------------------

/** Conteggi di `result.counts`. */
export interface AnalyzeCounts {
  [key: string]: number;
  selected: number;
  targets: number;
  enriched_first: number;
  analyzed: number;
  skipped_same_input: number;
  skipped_analyzed: number;
  not_enrichable: number;
  refusals: number;
  errors: number;
  not_found: number;
  prospects_merged: number;
  /** Senza LinkedIn: esclusi (E11). */
  no_linkedin: number;
}

function summarize(c: AnalyzeCounts): string {
  const parts: string[] = [];
  const attempted = c.analyzed + c.refusals + c.errors + c.not_enrichable;
  if (attempted === 0 && c.skipped_same_input + c.skipped_analyzed === 0) parts.push('nessuna persona da analizzare');
  else parts.push(plural(c.analyzed, 'analizzato', 'analizzati'));
  if (c.enriched_first) parts.push(plural(c.enriched_first, 'arricchito prima', 'arricchiti prima'));
  if (c.skipped_same_input) parts.push(`${plural(c.skipped_same_input, 'saltato', 'saltati')} (dati identici)`);
  if (c.skipped_analyzed) parts.push(`${plural(c.skipped_analyzed, 'già analizzato', 'già analizzati')} (saltati: usa "Rianalizza")`);
  if (c.refusals) parts.push(plural(c.refusals, 'rifiutato dal modello', 'rifiutati dal modello'));
  if (c.errors) parts.push(plural(c.errors, 'errore', 'errori'));
  if (c.not_enrichable) parts.push(`${plural(c.not_enrichable, 'non analizzabile', 'non analizzabili')} (profilo senza dati)`);
  if (c.prospects_merged) parts.push(plural(c.prospects_merged, 'duplicato unito', 'duplicati uniti'));
  if (c.not_found) parts.push(plural(c.not_found, 'non trovato', 'non trovati'));
  return `Analisi completata: ${parts.join(' · ')}.`;
}

/**
 * Analizza l'ambito secondo `planAnalysis`: arricchisce i mancanti (P5), poi analizza. Lancia
 * `config:` su parametri/lista/ICP non validi o configurazione mancante, e l'errore del modello se
 * **nessuna** analisi riesce e almeno una fallisce per errore (provider giù: job `failed`).
 */
export async function analyzeMany(params: AnalyzeParams, deps: Deps): Promise<JobResult> {
  const parsed = paramsSchema.safeParse(params);
  if (!parsed.success) throw new Error(`config: parametri del job di analisi non validi (${parsed.error.issues[0]?.message}).`);
  const scope = parsed.data as AnalyzeParams;
  if (scope.listId !== undefined) {
    const list = getList(scope.listId);
    if (!list) throw new Error(`config: lista ${scope.listId} inesistente: nessuna analisi eseguita.`);
    if (isListArchived(scope.listId)) throw new Error(`config: la lista "${list.name}" è archiviata: nessuna analisi eseguita.`);
  }
  const icpId = scopeIcpId(scope)!;
  const icp = getIcpContext(icpId);
  if (!icp) throw new Error(`config: ICP ${icpId} inesistente: nessuna analisi eseguita.`);

  const plan = planAnalysis(scope, Date.now(), icp);
  const counts: AnalyzeCounts = {
    selected: plan.selected,
    targets: plan.analyzeTargets.length,
    enriched_first: 0,
    analyzed: 0,
    skipped_same_input: plan.skipped_same_input,
    skipped_analyzed: plan.skipped_analyzed,
    not_enrichable: plan.not_enrichable,
    refusals: 0,
    errors: 0,
    not_found: plan.not_found,
    prospects_merged: 0,
    no_linkedin: plan.no_linkedin,
  };
  const merged = new Set<number>();
  const dropped = new Set<number>();
  const errors: string[] = [];
  let configError: string | undefined;

  // Fase 1 (P5): arricchimento dei prospect senza dati.
  const enrichLimit = pLimit(Math.max(1, config.enrichConcurrency));
  await Promise.all(
    plan.enrichTargets.map((id) =>
      enrichLimit(async () => {
        if (configError || merged.has(id)) return;
        const r = await enrichOneInline(id, deps.enrich);
        for (const m of r.mergedIds) merged.add(m);
        counts.prospects_merged += r.mergedIds.length;
        if (r.outcome === 'enriched') {
          counts.enriched_first += 1;
          return;
        }
        dropped.add(id);
        if (r.outcome === 'no_data') counts.not_enrichable += 1;
        else if (r.outcome === 'error') {
          if (r.error!.startsWith('config:')) configError ??= r.error;
          else {
            counts.errors += 1;
            errors.push(r.error!);
          }
        } else if (!merged.has(id)) counts.not_found += 1;
      }),
    ),
  );
  if (configError) throw new Error(configError);

  // Fase 2: analisi.
  const listId = scope.listId ?? null;
  const analyzeLimit = pLimit(ANALYZE_CONCURRENCY);
  await Promise.all(
    plan.analyzeTargets.map((id) =>
      analyzeLimit(async () => {
        if (configError || dropped.has(id)) return;
        // Unito in un altro prospect durante l'arricchimento: l'analisi del sopravvissuto basta.
        if (merged.has(id)) return;
        const r = await analyzeProspect(id, icpId, { client: deps.client, force: scope.force, listId, icpContext: icp });
        switch (r.outcome) {
          case 'analyzed':
            counts.analyzed += 1;
            break;
          case 'skipped_same_input':
            counts.skipped_same_input += 1;
            break;
          case 'failed':
            if (r.error.startsWith('config:')) configError ??= r.error;
            else if (r.errorKind === 'refusal') counts.refusals += 1;
            else {
              counts.errors += 1;
              errors.push(r.error);
            }
            break;
          case 'not_enriched':
          case 'not_enrichable':
            counts.not_enrichable += 1;
            break;
          default:
            if (!merged.has(id)) counts.not_found += 1;
        }
      }),
    ),
  );
  if (configError) throw new Error(configError);

  if (counts.errors > 0 && counts.analyzed + counts.refusals === 0) {
    // Errore del modello attribuito per il job (`actor:<modello>: …`), i prefissi esistenti restano.
    const first = attributeError(errors[0], `actor:${config.analysisModel}`);
    throw new Error(counts.errors === 1 ? first : `${first} (tutte le ${counts.errors} analisi tentate in errore)`);
  }
  const warnings: string[] = [];
  if (counts.errors > 0) {
    warnings.push(
      `${plural(counts.errors, 'persona non analizzata', 'persone non analizzate')} per errore (${errors[0]}): filtra per fit "errore" e riprova.`,
    );
  }
  if (counts.refusals > 0) {
    warnings.push(
      `${plural(counts.refusals, 'profilo rifiutato', 'profili rifiutati')} dal modello: puoi riprovare o scrivere il messaggio a mano.`,
    );
  }
  return { summary: summarize(counts), counts, warnings };
}

/** Handler registrato in `HANDLERS.analyze`. */
export const handler: JobHandler<AnalyzeParams, Deps> = (params, deps) => analyzeMany(params, deps);

/**
 * Deps reali: client Anthropic creato alla prima chiamata (chiave verificata a ogni chiamata →
 * `config:`) ed enrichment apimaestro di T10.
 */
export function realDeps(): Deps {
  let anthropic: Anthropic | undefined;
  return {
    client: {
      messages: {
        create: async (body, options) => {
          if (!config.anthropicApiKey.trim()) {
            throw new Error('config: ANTHROPIC_API_KEY mancante nel .env: nessuna analisi eseguita.');
          }
          anthropic ??= new Anthropic({ apiKey: config.anthropicApiKey });
          return anthropic.messages.create(body, options);
        },
      },
    },
    enrich: enrichRealDeps(),
  };
}
