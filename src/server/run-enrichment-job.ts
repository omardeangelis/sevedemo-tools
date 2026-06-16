/**
 * Wrapper eseguito come processo figlio del server (mai importato da esso).
 * Esegue l'enrichment progressivo di una Selezione e scrive LUI l'esito terminale
 * (con `result`) in kv: così l'esito sopravvive a un restart del server durante il run.
 *
 * Argv: [date, bucket?, contactId?] — stringhe vuote = filtro assente.
 */
import { enrichSelectionEmails } from '../pipeline/enrich-selection.js';
import { writeEnrichmentTerminalStatus } from './jobs.js';

const [date, bucketArg, contactArg] = process.argv.slice(2);
const bucket = bucketArg ? bucketArg : undefined;
const contactId = contactArg ? Number(contactArg) : undefined;

try {
  const result = await enrichSelectionEmails({ date, bucket, contactId });
  writeEnrichmentTerminalStatus({ state: 'succeeded', result });
} catch (err) {
  writeEnrichmentTerminalStatus({
    state: 'failed',
    error: err instanceof Error ? err.message : String(err),
  });
  process.exitCode = 1;
}
