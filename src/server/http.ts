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

/** Legge il body JSON e lo valida con `schema`: 400 `{error, issues[]}` se malformato o non valido. */
export async function readJson<S extends z.ZodType>(c: Context<any>, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw httpError(400, 'Body JSON non valido.');
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw httpError(400, 'Dati non validi.', { issues });
  }
  return parsed.data;
}

/** Id numerico positivo da un path param: 404 se non lo è (la risorsa non può esistere). */
export function idParam(c: Context<any>, name = 'id'): number {
  const raw = c.req.param(name);
  const id = Number(raw);
  if (!raw || !Number.isInteger(id) || id <= 0) throw httpError(404, 'Risorsa inesistente.');
  return id;
}
