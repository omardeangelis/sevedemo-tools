import { ApifyClient } from 'apify-client';
import { config, requireApify } from '../config.js';

let _client: ApifyClient | null = null;

function client(): ApifyClient {
  requireApify();
  if (!_client) _client = new ApifyClient({ token: config.apifyToken });
  return _client;
}

export interface ActorRunResult {
  items: any[];
  runId: string;
  datasetId: string;
}

/**
 * Esegue un actor Apify in modalità bloccante e ritorna gli item del dataset di default.
 * Gli errori dell'actor vengono propagati con un messaggio leggibile.
 */
export async function runActor(actorId: string, input: Record<string, unknown>): Promise<ActorRunResult> {
  try {
    const run = await client().actor(actorId).call(input);
    const { items } = await client().dataset(run.defaultDatasetId).listItems();
    return { items: items as any[], runId: run.id, datasetId: run.defaultDatasetId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Actor "${actorId}" fallito: ${msg}`);
  }
}
