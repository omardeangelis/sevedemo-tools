import { config } from '../config.js';
import { today } from '../db/index.js';
import {
  upsertCandidate,
  isFresh,
  getByIds,
  updateEnrichment,
  updateScore,
  updateEmail,
  type ContactRow,
} from '../db/contacts.js';
import { logRun, newRunId, saveSelection, type SelectionRow } from '../db/runs.js';
import { dailyStrategies, getStrategy } from '../strategies/registry.js';
import type { RawCandidate, Strategy } from '../strategies/types.js';
import { enrichProfiles } from '../enrich/profile.js';
import { scoreMany } from '../score/claude.js';
import { draftMany } from '../email/draft.js';
import { selectBucket } from './select.js';
import { runGeoGatePre, runGeoGatePost } from './geo-gate.js';
import { exportContacts } from '../export/csv.js';

interface Tagged extends RawCandidate {
  strategyId: string;
}

const FREELANCE_KW = [
  'freelance', 'freelancer', 'libero professionista', 'libera professionista', 'p.iva',
  'partita iva', 'consulente', 'autonomo', 'open to work', 'disponibile',
];
const AZIENDA_KW = [
  'recruiter', 'talent', 'head hunter', 'headhunter', 'hr', 'human resources', 'hiring',
  'people', 'founder', 'co-founder', 'ceo', 'owner', 'titolare', 'cto', 'head of', 'manager',
  'director', 'imprenditore',
];
const SECTOR_KW = [
  'design', 'ux', 'ui', 'developer', 'sviluppatore', 'software', 'engineer', 'marketing', 'seo',
  'growth', 'brand', 'content', 'data', 'frontend', 'backend', 'full stack', 'prodotto', 'product',
];
const ALL_KW = [...FREELANCE_KW, ...AZIENDA_KW, ...SECTOR_KW];

function log(msg: string): void {
  console.log(msg);
}

/**
 * Estrae candidati dalle strategie con **primazia** (spec influencer-post-respondents):
 * la strategia primaria (`config.primaryStrategyId`) è eseguita **per prima** e riceve
 * una quota **dominante** (`primaryCap = round(POOL * primaryWeight)`); le altre si
 * dividono il **residuo** con carry-over. Una sola chiamata `source()` per strategia
 * (no doppio costo API). Il residuo è calcolato sui candidati **realmente** resi dalla
 * primaria, non sul cap: se la primaria rende poco, le altre riempiono fino a
 * `min(Σ disponibili, POOL)` senza under-fill. Dedup per URL; il canale errore (T1)
 * resta popolato nel `catch`.
 */
export async function gather(
  strategies: Strategy[],
  totalLimit: number,
): Promise<{
  candidates: Tagged[];
  sourcedByStrategy: Map<string, number>;
  errorByStrategy: Map<string, string>;
}> {
  const candidates: Tagged[] = [];
  const seen = new Set<string>();
  const sourcedByStrategy = new Map<string, number>();
  const errorByStrategy = new Map<string, string>();
  /** Ultimo `want` richiesto a ogni strategia (per decidere chi può avere ancora supply). */
  const askedByStrategy = new Map<string, number>();

  /** Chiede `ask` candidati a una strategia, deduplica, ritorna quanti univoci aggiunti. */
  const runOne = async (strat: Strategy, ask: number): Promise<number> => {
    const want = Math.max(1, ask);
    askedByStrategy.set(strat.id, want);
    log(`  → sorgente: ${strat.id} (max ${want})`);
    try {
      const raw = await strat.source(want);
      sourcedByStrategy.set(strat.id, raw.length);
      let added = 0;
      for (const c of raw) {
        if (seen.has(c.linkedinUrl)) continue;
        seen.add(c.linkedinUrl);
        candidates.push({ ...c, strategyId: strat.id });
        added++;
      }
      return added;
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      log(`    ⚠️  ${strat.id}: ${m}`);
      sourcedByStrategy.set(strat.id, 0);
      errorByStrategy.set(strat.id, m);
      return 0;
    }
  };

  const primary = strategies.find((s) => s.id === config.primaryStrategyId);
  const others = strategies.filter((s) => s.id !== config.primaryStrategyId);

  let remaining = totalLimit;

  // Fase 1 — la primaria per prima, con la sua quota dominante. Se è l'UNICA
  // strategia (es. runStrategy della primaria) prende l'intero limit, niente split.
  if (primary) {
    const primaryAsk =
      others.length === 0
        ? totalLimit
        : Math.min(totalLimit, Math.round(totalLimit * config.primaryWeight));
    const added = await runOne(primary, primaryAsk);
    remaining = totalLimit - added;
  }

  // Fase 2 — le altre si dividono il residuo con carry-over: la quota è ricalcolata
  // sul residuo CORRENTE (non una quota pesata fissa), così il budget non consumato
  // dalla primaria rifluisce davvero.
  let strategiesLeft = others.length;
  for (const strat of others) {
    if (remaining <= 0) break;
    const ask = Math.min(remaining, Math.ceil(remaining / strategiesLeft));
    const added = await runOne(strat, ask);
    remaining -= added;
    strategiesLeft--;
  }

  // Fase 3 — RECLAIM (AC3: "riflusso senza ridurre il totale estratto"). Il cap della
  // primaria riserva budget alle altre per la diversità; se le altre NON lo consumano
  // (supply-thin), quel budget resterebbe orfano e il pool si riempirebbe sotto
  // `min(Σ disponibili, POOL)`. Qui lo recuperiamo: in ordine (primaria per prima),
  // ri-chiediamo SOLO alle strategie che avevano reso almeno quanto chiesto (segnale di
  // supply residua) il loro target cumulativo. È una SECONDA chiamata `source()` bounded
  // (al più una per strategia) che scatta SOLO quando la fase 2 lascia il pool incompleto
  // — nel caso comune (primaria a basso volume) la fase 2 riempie e questa fase è saltata.
  if (remaining > 0) {
    const reclaimOrder = primary ? [primary, ...others] : others;
    for (const strat of reclaimOrder) {
      if (remaining <= 0) break;
      const sourced = sourcedByStrategy.get(strat.id) ?? 0;
      const asked = askedByStrategy.get(strat.id) ?? 0;
      // Ha reso meno di quanto chiesto ⇒ supply esaurita ⇒ niente da recuperare.
      if (asked === 0 || sourced < asked) continue;
      const cumulativeAsk = Math.min(totalLimit, asked + remaining);
      const added = await runOne(strat, cumulativeAsk);
      remaining -= added;
    }
  }

  return { candidates: candidates.slice(0, totalLimit), sourcedByStrategy, errorByStrategy };
}

/** Persiste i candidati; ritorna gli id da processare (nuovi o non più freschi). */
function persist(candidates: Tagged[]): { toProcess: number[]; newByStrategy: Map<string, number> } {
  const toProcess: number[] = [];
  const newByStrategy = new Map<string, number>();

  for (const c of candidates) {
    const { id, isNew } = upsertCandidate({
      linkedinUrl: c.linkedinUrl,
      fullName: c.fullName,
      headline: c.headline,
      sourceStrategy: c.strategyId,
      sourcePostUrl: c.sourcePostUrl,
      sourceDetail: c.sourceDetail,
      raw: c.raw,
    });
    if (isNew) {
      newByStrategy.set(c.strategyId, (newByStrategy.get(c.strategyId) ?? 0) + 1);
      toProcess.push(id);
    } else if (!isFresh(id, config.freshnessDays)) {
      toProcess.push(id);
    }
  }
  return { toProcess, newByStrategy };
}

/** Pre-filtro low-cost per keyword sull'headline: tiene i più promettenti fino a enrichCap. */
function prefilter(ids: number[], cap: number): ContactRow[] {
  const rows = getByIds(ids);
  if (rows.length <= cap) return rows;
  const scored = rows.map((r) => {
    const h = (r.headline ?? '').toLowerCase();
    const score = ALL_KW.reduce((acc, kw) => (h.includes(kw) ? acc + 1 : acc), 0);
    return { r, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, cap).map((s) => s.r);
}

/** Enrichment + scoring per gli id indicati. Ritorna le righe scored. */
async function enrichAndScore(rows: ContactRow[]): Promise<ContactRow[]> {
  if (rows.length === 0) return [];

  // Gate geografico pre-enrichment (conservativo): scarta i profili palesemente fuori
  // Italia leggendo raw_json, PRIMA di pagare l'enrichment Apify (spec: italy-geo-gate).
  rows = runGeoGatePre(rows);
  if (rows.length === 0) return [];

  log(`  → enrichment di ${rows.length} profili...`);
  const urls = rows.map((r) => r.linkedin_url);
  const enrichment = await enrichProfiles(urls);
  for (const r of rows) {
    const e = enrichment.get(r.linkedin_url);
    if (e) updateEnrichment(r.id, e);
  }

  const refreshed = getByIds(rows.map((r) => r.id));

  // Gate geografico post-enrichment (strict): ora contacts.location è valorizzata da
  // dev_fusion → tiene solo l'Italia; foreign/unknown sono tombstonati e non proseguono.
  const gated = runGeoGatePost(refreshed);

  log(`  → scoring con ${config.scoringModel}...`);
  const results = await scoreMany(gated);
  let ok = 0;
  for (const res of results) {
    if (res.result) {
      updateScore(res.id, {
        role: res.result.role,
        bucket: res.result.bucket,
        sector: res.result.sector,
        fitScore: res.result.fit_score,
        shortDescription: res.result.short_description,
        reason: res.result.reason,
        signals: res.result.signals ?? {},
      });
      ok++;
    } else {
      log(`    ⚠️  scoring id=${res.id}: ${res.error}`);
    }
  }
  log(`  → scored ${ok}/${results.length}`);
  // Ritorna SOLO le righe sopravvissute ai gate (`gated`): così i tombstone rejected_geo
  // non rientrano nel set ritornato e nell'export di runStrategy (che usa il valore di
  // ritorno) — altrimenti viola AC#1/AC#4.
  return getByIds(gated.map((r) => r.id)).filter((r) => r.status === 'scored');
}

/** Run completo giornaliero: 200 → dedup → prefiltro → enrich → score → 20+20 → email → export. */
export async function runDaily(): Promise<void> {
  const date = today();
  const runId = newRunId(date);
  const strategies = dailyStrategies();
  log(`\n📥 Run giornaliero ${date} — strategie attive: ${strategies.map((s) => s.id).join(', ')}`);

  const { candidates, sourcedByStrategy, errorByStrategy } = await gather(strategies, config.poolSize);
  log(`  Estratti ${candidates.length} candidati (post-dedup in-memory).`);

  const { toProcess, newByStrategy } = persist(candidates);
  log(`  Da processare (nuovi/stale): ${toProcess.length}.`);

  const prefiltered = prefilter(toProcess, config.enrichCap);
  log(`  Pre-filtro → ${prefiltered.length} profili da arricchire (cap ${config.enrichCap}).`);

  await enrichAndScore(prefiltered);

  // Selezione 20 + 20
  const freelance = selectBucket('freelance', config.targetFreelance, config.minFitScore);
  const azienda = selectBucket('azienda', config.targetAzienda, config.minFitScore);
  log(`  Selezionati: ${freelance.length} freelance + ${azienda.length} azienda.`);

  const selectionRows: SelectionRow[] = [
    ...freelance.map((c, i) => ({ bucket: 'freelance', contactId: c.id, rank: i + 1 })),
    ...azienda.map((c, i) => ({ bucket: 'azienda', contactId: c.id, rank: i + 1 })),
  ];
  // La Selezione nasce `in_review` come figlia di questo Run; i contatti restano
  // `scored` (stadio del dato) — niente più status `selected` sul contatto.
  saveSelection(date, selectionRows, runId);

  // Bozze email per i selezionati
  const selectedRows = getByIds(selectionRows.map((r) => r.contactId));
  log(`  → bozze email con ${config.emailModel} per ${selectedRows.length} contatti...`);
  const drafts = await draftMany(selectedRows);
  let skipped = 0;
  for (const d of drafts) {
    if (d.draft) updateEmail(d.id, d.draft.subject, d.draft.body);
    else if (d.skipped) skipped++;
    else log(`    ⚠️  email id=${d.id}: ${d.error}`);
  }
  if (skipped) log(`  → ${skipped} bozze saltate (contatto senza email, modello non chiamato).`);

  // Export
  // Artefatto CSV su disco invariato (batch). L'export "validato" della Selezione
  // (state → exported) è un'azione esplicita dell'operatore, non più qui.
  const finalRows = getByIds(selectionRows.map((r) => r.contactId));
  const out = exportContacts(finalRows, `daily-${date}`);

  // Log per strategia
  for (const strat of strategies) {
    logRun({
      runDate: date,
      strategy: strat.id,
      runId,
      itemsIn: sourcedByStrategy.get(strat.id) ?? 0,
      itemsNew: newByStrategy.get(strat.id) ?? 0,
      error: errorByStrategy.get(strat.id),
    });
  }

  log(`\n✅ Fatto. ${out.count} contatti esportati:`);
  log(`   CSV:  ${out.csvPath}`);
  log(`   JSON: ${out.jsonPath}`);
}

/** Run di una singola strategia (per accumulare dati di confronto). Non produce i 40. */
export async function runStrategy(id: string, limit: number): Promise<void> {
  const date = today();
  const runId = newRunId(date);
  const strat = getStrategy(id);
  if (!strat) throw new Error(`Strategia sconosciuta: "${id}".`);

  log(`\n📥 Run strategia "${id}" (limit ${limit}).`);
  const { candidates, sourcedByStrategy, errorByStrategy } = await gather([strat], limit);
  log(`  Estratti ${candidates.length} candidati.`);

  const { toProcess, newByStrategy } = persist(candidates);
  log(`  Da processare (nuovi/stale): ${toProcess.length}.`);

  const prefiltered = prefilter(toProcess, Math.min(limit, config.enrichCap));
  const scored = await enrichAndScore(prefiltered);

  logRun({
    runDate: date,
    strategy: id,
    runId,
    itemsIn: sourcedByStrategy.get(id) ?? 0,
    itemsNew: newByStrategy.get(id) ?? 0,
    error: errorByStrategy.get(id),
  });

  const out = exportContacts(scored, `strategy-${id}-${date}`);
  log(`\n✅ ${scored.length} contatti scored ed esportati:`);
  log(`   CSV:  ${out.csvPath}`);
  log(`   JSON: ${out.jsonPath}`);
}
