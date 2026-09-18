/**
 * Opzioni di `createApp()`: tutte facoltative, arrivano ai router via context
 * (`c.get('opts')`). Aperte: un task può leggere una chiave nuova senza toccare `app.ts`.
 */
export interface AppOptions {
  /** Override del processo figlio dei job (T6), es. `{command: 'node', args: ['-e', '']}` nei test. */
  jobs?: { command?: string; args?: string[] };
  [key: string]: unknown;
}

/** Env Hono condiviso da `app.ts` e da tutti i router in `server/routes/`. */
export type AppEnv = { Variables: { opts: AppOptions } };
