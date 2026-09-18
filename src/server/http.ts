import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';

/*
 * Helper HTTP condivisi dai router di `server/routes/` (convenzioni API di crm-foundation):
 * errori sempre `{error: '<messaggio leggibile>', code?, ...extra}`, restituiti da `onError` di `app.ts`.
 */

/** Eccezione HTTP con body JSON `{error, ...extra}` (es. `httpError(409, '…', {code: 'duplicate'})`). */
export function httpError(
  status: ContentfulStatusCode,
  error: string,
  extra: Record<string, unknown> = {},
): HTTPException {
  return new HTTPException(status, { res: Response.json({ error, ...extra }, { status }) });
}

/** Valida `raw` con `schema`: 400 `{error: message, issues[{path, message}]}` se non valido (`path` rinominabile). */
function parseOr400<S extends z.ZodType>(
  schema: S,
  raw: unknown,
  message: string,
  pathName: (path: string) => string = (path) => path,
): z.infer<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: pathName(i.path.join('.')), message: i.message }));
    throw httpError(400, message, { issues });
  }
  return parsed.data;
}

/** Legge il body JSON e lo valida con `schema`: 400 `{error, issues[]}` se malformato o non valido. */
export async function readJson<S extends z.ZodType>(c: Context<any>, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw httpError(400, 'Body JSON non valido.');
  }
  return parseOr400(schema, body, 'Dati non validi.');
}

/** Parametri della query string con un valore non vuoto (primo valore per chiave): i vuoti valgono assenti. */
export function nonEmptyQuery(c: Context<any>): Record<string, string> {
  return Object.fromEntries(Object.entries(c.req.query()).filter(([, v]) => v !== ''));
}

/**
 * Valida la query string con `schema`: 400 `{error: message, issues[]}` se non valida. Di default valida
 * `nonEmptyQuery(c)`; `opts.raw` = oggetto già costruito dalla route (liste ripetute, numeri, …),
 * `opts.pathName` = nome del parametro per `issues[].path` (es. con un prefisso).
 */
export function readQuery<S extends z.ZodType>(
  c: Context<any>,
  schema: S,
  message = 'Parametri della preview non validi.',
  opts: { raw?: unknown; pathName?: (path: string) => string } = {},
): z.infer<S> {
  return parseOr400(schema, opts.raw ?? nonEmptyQuery(c), message, opts.pathName);
}

/** Id numerico positivo da un path param: 404 se non lo è (la risorsa non può esistere). */
export function idParam(c: Context<any>, name = 'id'): number {
  const raw = c.req.param(name);
  const id = Number(raw);
  if (!raw || !Number.isInteger(id) || id <= 0) throw httpError(404, 'Risorsa inesistente.');
  return id;
}
