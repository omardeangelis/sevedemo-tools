/**
 * Processo figlio di `scripts/migration-check.ts` (own-profile-services T2, T3): sulla **copia** già migrata
 * conta le analisi "da aggiornare" con il criterio di prima del rilascio (input intero cambiato), fa girare il
 * backfill dell'impronta della persona (`backfillSubjectHashes`, lo stesso che parte all'avvio del server) e le
 * riconta con il criterio nuovo della scheda (`isAnalysisStale`). È la prova, su righe vere, dell'unica scrittura
 * del piano su righe esistenti.
 *
 * Perché un processo a parte: quel codice legge il DB globale di `src/db/index.ts`, che lo script principale non
 * importa mai. Qui `DB_PATH` è la copia (lo imposta il padre) e il processo rifiuta di partire se punta fuori
 * da `os.tmpdir()`, dentro `data/` o dentro il repo. Il `.env` non si legge (`DOTENV_CONFIG_PATH`): l'impronta
 * dell'input non dipende dalla configurazione.
 *
 * Stampa su stdout un JSON di soli numeri.
 */
import fs from 'node:fs';
import os from 'node:os';
import { isScratchPath } from './scratch-paths.js';

export interface AnalysesCheck {
  /** Coppie persona–ICP con almeno un'analisi (l'ultima è quella che la scheda mostra). */
  latest: number;
  /** Quante risultavano "da aggiornare" prima del rilascio: input intero diverso da quello di oggi. */
  staleBefore: number;
  /** Righe di `analyses` che il backfill ha riempito. */
  backfilled: number;
  /** Righe di `analyses` ancora senza impronta dopo il backfill (deve essere 0, P-4). */
  subjectHashNull: number;
  /** Quante risultano "da aggiornare" dopo il backfill, con il criterio della scheda (impronta della persona). */
  staleAfter: number;
}

const dbPath = process.env.DB_PATH;
if (!dbPath || !fs.existsSync(dbPath) || !isScratchPath(dbPath)) {
  console.error(`Rifiutato: DB_PATH deve essere una copia esistente in ${os.tmpdir()}, fuori da data/ e dal repo.`);
  process.exit(2);
}

const { db } = await import('../src/db/index.js');
const { getIcpContext } = await import('../src/db/icps.js');
const { latestAnalysis } = await import('../src/db/analyses.js');
const { analysisContext, analysisInput, isAnalysisStale } = await import('../src/analysis/analyze.js');
const { backfillSubjectHashes } = await import('../src/db/subject-hash.js');
type Latest = NonNullable<ReturnType<typeof latestAnalysis>>;
type Ctx = NonNullable<ReturnType<typeof analysisContext>>;

const pairs = db.prepare('SELECT DISTINCT prospect_id, icp_id FROM analyses ORDER BY prospect_id, icp_id').all() as Array<{
  prospect_id: number;
  icp_id: number;
}>;
const icps = new Map<number, ReturnType<typeof getIcpContext>>();

/** Ultime analisi per cui `stale` vale, rilette adesso dal DB. */
function countStale(stale: (latest: Latest, ctx: Ctx) => boolean): number {
  let n = 0;
  for (const { prospect_id, icp_id } of pairs) {
    if (!icps.has(icp_id)) icps.set(icp_id, getIcpContext(icp_id));
    const icp = icps.get(icp_id);
    const latest = latestAnalysis(prospect_id, icp_id);
    const ctx = icp ? analysisContext(prospect_id, icp) : null;
    if (latest && ctx && stale(latest, ctx)) n += 1;
  }
  return n;
}

// Il criterio di prima del rilascio: l'input intero (utente + ICP + persona) è cambiato dall'analisi.
const staleBefore = countStale((latest, ctx) => latest.input_hash !== analysisInput(ctx).inputHash);
const backfilled = backfillSubjectHashes();
const subjectHashNull = db.prepare('SELECT COUNT(*) FROM analyses WHERE subject_hash IS NULL').pluck().get() as number;
const staleAfter = countStale((latest, ctx) => isAnalysisStale(latest, ctx.prospect));
db.close();

const report: AnalysesCheck = { latest: pairs.length, staleBefore, backfilled, subjectHashNull, staleAfter };
process.stdout.write(JSON.stringify(report));
