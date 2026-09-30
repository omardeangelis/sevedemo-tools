import type { ToolId } from '../runs/tools.js';
import { NotImplementedError, type JobHandler, type JobPreview } from './types.js';

/*
 * Job `generate_profile` — generazione di profilo e servizi dalle fonti pubbliche (own-profile-services M4).
 * Pre-cablato a stub da T1 (PLAN P-3): il kind entra in `JOB_KINDS` con l'unica migrazione del piano e il
 * registry deve essere completo, ma nessuna route lo raggiunge fino a M4. T23–T26 sostituiscono questi stub
 * senza toccare `handlers.ts`.
 */

/** `params` del kind: le fonti scelte nell'anteprima (definiti da T24). */
export type GenerateProfileParams = Record<string, unknown>;

/** Dipendenze iniettabili: le quattro fonti e il modello (definite da T23 e T26). */
export type Deps = Record<string, never>;

/** Deps reali (T23): il messaggio è diverso da quello delle deps finte (`fake-deps.ts`). */
export function realDeps(): Deps {
  throw new NotImplementedError('generate_profile: deps reali (own-profile-services T23)');
}

/** Blocker di configurazione (T24). */
export function configBlockers(_params?: GenerateProfileParams): string[] {
  throw new NotImplementedError('generate_profile: blocker di configurazione (own-profile-services T24)');
}

/** Anteprima dai `params` salvati, per "Riprova…" (T24–T25). */
export function previewFromParams(_params: GenerateProfileParams): JobPreview {
  throw new NotImplementedError('generate_profile: anteprima (own-profile-services T24)');
}

/** Strumenti usati da un run, dalle fonti scelte (T24). */
export function toolsOf(_params: GenerateProfileParams): ToolId[] {
  throw new NotImplementedError('generate_profile: strumenti del run (own-profile-services T24)');
}

/** Handler registrato in `HANDLERS.generate_profile` (T24–T26). */
export const handler: JobHandler<GenerateProfileParams, Deps> = async () => {
  throw new NotImplementedError('generate_profile: handler (own-profile-services T24)');
};
