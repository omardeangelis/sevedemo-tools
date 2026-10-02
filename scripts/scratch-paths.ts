import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/*
 * Percorsi per le prove sulla copia del DB reale (`migration-check.ts` e il suo processo figlio
 * `migration-check-analyses.ts`): un solo controllo di "copia scratch" per entrambi, così le due protezioni di
 * `data/crm.db` non possono divergere. Nessun import del progetto: non apre nessun DB.
 */

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(REPO_ROOT, 'data');

/** True se `target` è `dir` o sta dentro `dir` (percorsi risolti, link simbolici della tmp di macOS inclusi). */
export function isInside(target: string, dir: string): boolean {
  // realpath dell'antenato più profondo che esiste + il resto (la cartella può non esistere ancora).
  const real = (p: string): string => {
    const abs = path.resolve(p);
    try {
      return fs.realpathSync(abs);
    } catch {
      const parent = path.dirname(abs);
      return parent === abs ? abs : path.join(real(parent), path.basename(abs));
    }
  };
  const rel = path.relative(real(dir), real(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Posto buono per una copia di lavoro: dentro `os.tmpdir()` e fuori dal repo (quindi anche da `data/`). */
export function isScratchPath(target: string): boolean {
  return isInside(target, os.tmpdir()) && !isInside(target, REPO_ROOT);
}
