import { config } from '../config.js';
import { today } from '../db/index.js';
import {
  upsertCandidate,
  isFresh,
  getByIds,
  updateEnrichment,
  updateScore,
  updateEmail,
  setStatus,
  type ContactRow,
} from '../db/contacts.js';
import { logRun, saveSelection, type SelectionRow } from '../db/runs.js';
import { dailyStrategies, getStrategy } from '../strategies/registry.js';
import type { RawCandidate, Strategy } from '../strategies/types.js';
import { enrichProfiles } from '../enrich/profile.js';
import { scoreMany } from '../score/claude.js';
import { draftMany } from '../email/draft.js';
import { selectBucket } from './select.js';
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

/** Estrae candidati dalle strategie, distribuendo il budget e deduplicando per URL. */
async function gather(
  strategies: Strategy[],
  totalLimit: number,
): Promise<{ candidates: Tagged[]; sourcedByStrategy: Map<string, number> }> {
  const perStrategy = Math.max(1, Math.ceil(totalLimit / strategies.length));
  const candidates: Tagged[] = [];
  const seen = new Set<string>();
  const sourcedByStrategy = new Map<string, number>();

  for (const strat of strategies) {
    log(`  → sorgente: ${strat.id} (max ${perStrategy})`);
    try {
      const raw = await strat.source(perStrategy);
      sourcedByStrategy.set(strat.id, raw.length);
      for (const c of raw) {
        if (seen.has(c.linkedinUrl)) continue;
        seen.add(c.linkedinUrl);
        candidates.push({ ...c, strategyId: strat.id });
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      log(`    ⚠️  ${strat.id}: ${m}`);
      sourcedByStrategy.set(strat.id, 0);
    }
  }
  return { candidates: candidates.slice(0, totalLimit), sourcedByStrategy };
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

  log(`  → enrichment di ${rows.length} profili...`);
  const urls = rows.map((r) => r.linkedin_url);
  const enrichment = await enrichProfiles(urls);
  for (const r of rows) {
    const e = enrichment.get(r.linkedin_url);
    if (e) updateEnrichment(r.id, e);
  }

  const refreshed = getByIds(rows.map((r) => r.id));
  log(`  → scoring con ${config.scoringModel}...`);
  const results = await scoreMany(refreshed);
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
  return getByIds(rows.map((r) => r.id)).filter((r) => r.status === 'scored');
}

/** Run completo giornaliero: 200 → dedup → prefiltro → enrich → score → 20+20 → email → export. */
export async function runDaily(): Promise<void> {
  const date = today();
  const strategies = dailyStrategies();
  log(`\n📥 Run giornaliero ${date} — strategie attive: ${strategies.map((s) => s.id).join(', ')}`);

  const { candidates, sourcedByStrategy } = await gather(strategies, config.poolSize);
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
  saveSelection(date, selectionRows);
  for (const row of selectionRows) setStatus(row.contactId, 'selected');

  // Bozze email per i selezionati
  const selectedRows = getByIds(selectionRows.map((r) => r.contactId));
  log(`  → bozze email con ${config.emailModel} per ${selectedRows.length} contatti...`);
  const drafts = await draftMany(selectedRows);
  for (const d of drafts) {
    if (d.draft) updateEmail(d.id, d.draft.subject, d.draft.body);
    else log(`    ⚠️  email id=${d.id}: ${d.error}`);
  }

  // Export
  const finalRows = getByIds(selectionRows.map((r) => r.contactId));
  const out = exportContacts(finalRows, `daily-${date}`);
  for (const r of finalRows) setStatus(r.id, 'exported');

  // Log per strategia
  for (const strat of strategies) {
    logRun({
      runDate: date,
      strategy: strat.id,
      itemsIn: sourcedByStrategy.get(strat.id) ?? 0,
      itemsNew: newByStrategy.get(strat.id) ?? 0,
    });
  }

  log(`\n✅ Fatto. ${out.count} contatti esportati:`);
  log(`   CSV:  ${out.csvPath}`);
  log(`   JSON: ${out.jsonPath}`);
}

/** Run di una singola strategia (per accumulare dati di confronto). Non produce i 40. */
export async function runStrategy(id: string, limit: number): Promise<void> {
  const date = today();
  const strat = getStrategy(id);
  if (!strat) throw new Error(`Strategia sconosciuta: "${id}".`);

  log(`\n📥 Run strategia "${id}" (limit ${limit}).`);
  const { candidates, sourcedByStrategy } = await gather([strat], limit);
  log(`  Estratti ${candidates.length} candidati.`);

  const { toProcess, newByStrategy } = persist(candidates);
  log(`  Da processare (nuovi/stale): ${toProcess.length}.`);

  const prefiltered = prefilter(toProcess, Math.min(limit, config.enrichCap));
  const scored = await enrichAndScore(prefiltered);

  logRun({
    runDate: date,
    strategy: id,
    itemsIn: sourcedByStrategy.get(id) ?? 0,
    itemsNew: newByStrategy.get(id) ?? 0,
  });

  const out = exportContacts(scored, `strategy-${id}-${date}`);
  log(`\n✅ ${scored.length} contatti scored ed esportati:`);
  log(`   CSV:  ${out.csvPath}`);
  log(`   JSON: ${out.jsonPath}`);
}
