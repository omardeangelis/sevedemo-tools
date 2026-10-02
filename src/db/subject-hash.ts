import { subjectHashOf } from '../analysis/prompt.js';
import { loadAnalysisSubject } from './analyses.js';
import { db } from './index.js';

/*
 * Backfill dell'impronta della persona sulle analisi salvate prima di own-profile-services (F6, F11, PLAN P-4,
 * P-25). Non sta in `schema.ts`: servirebbe il caricamento della persona, che importa `db/index.ts`, che importa
 * `schema.ts` (un ciclo), e `scripts/migration-check.ts` perderebbe l'isolamento dal DB reale. Lo chiama
 * `src/server/index.ts` all'avvio, come `fillMissingRunTools`.
 */

/**
 * Scrive `analyses.subject_hash` dove manca, dai dati **di oggi** della persona: è il reset una tantum del
 * badge "da aggiornare" (F6), dichiarato dalla migrazione e da chi chiama. Usa la stessa lettura della persona
 * (`loadAnalysisSubject`) e la stessa impronta (`subjectHashOf`) dell'analisi a runtime, così il valore combacia
 * byte per byte con quello che la scheda calcola dopo (una query duplicata segnerebbe ogni analisi da
 * aggiornare, l'opposto di F6). L'impronta non dipende dall'ICP: una lettura per persona. `analyses` è in
 * CASCADE sulla persona, quindi ogni riga ha la sua (nessun NULL resta, P-4). Idempotente: ritorna quante righe
 * ha scritto (0 quando non c'è niente da riempire).
 */
export function backfillSubjectHashes(): number {
  const ids = db.prepare('SELECT DISTINCT prospect_id FROM analyses WHERE subject_hash IS NULL').pluck().all() as number[];
  if (ids.length === 0) return 0;
  const update = db.prepare('UPDATE analyses SET subject_hash = ? WHERE prospect_id = ? AND subject_hash IS NULL');
  return db.transaction(() => {
    let written = 0;
    for (const id of ids) {
      const subject = loadAnalysisSubject(id);
      if (subject) written += update.run(subjectHashOf(subject), id).changes;
    }
    return written;
  })();
}
