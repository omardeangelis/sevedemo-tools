/**
 * Wrapper eseguito come processo figlio del server (mai importato da esso).
 * Esegue il run daily e scrive LUI l'esito terminale in kv: così l'esito
 * sopravvive anche a un restart del server durante il run.
 */
import { runDaily } from '../pipeline/run.js';
import { writeTerminalStatus } from './jobs.js';

try {
  await runDaily();
  writeTerminalStatus({ state: 'succeeded' });
} catch (err) {
  writeTerminalStatus({
    state: 'failed',
    error: err instanceof Error ? err.message : String(err),
  });
  process.exitCode = 1;
}
