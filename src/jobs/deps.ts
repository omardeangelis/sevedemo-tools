import { fakeDeps } from './fake-deps.js';
import { REAL_DEPS, type DepsByKind } from './handlers.js';
import type { JobKind } from './types.js';

/**
 * Dispatcher puro delle deps di un job (crm-foundation T6): con `E2E_FAKE_JOBS=1` le
 * deps fixture-backed di `fake-deps.ts` (T20), altrimenti `realDeps()` del kind
 * (T8–T11). Letto a ogni chiamata, non a import-time: il figlio eredita l'env del server.
 */
export function resolveDeps<K extends JobKind>(kind: K): DepsByKind[K] {
  return process.env.E2E_FAKE_JOBS === '1' ? fakeDeps(kind) : REAL_DEPS[kind]();
}
