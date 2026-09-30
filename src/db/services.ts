import { cleanText, serviceNameKey } from '../util/fields.js';
import type { FieldOrigin } from './schema.js';
import { db, nowIso } from './index.js';

/**
 * Servizi dell'utente (own-profile-services B2, B3, B4, B6, B10). Solo il nome è obbligatorio; l'ordine lo
 * dichiara l'utente (`position`). `name_key` la scrive **solo** questo modulo, con `serviceNameKey` (unico
 * normalizzatore, P-23), a ogni scrittura del nome: l'indice unico vede esattamente ciò che confronta l'API.
 */

const SERVICE_TEXT_FIELDS = ['description', 'audience', 'problem', 'proof', 'notes'] as const;
type ServiceTextField = (typeof SERVICE_TEXT_FIELDS)[number];

export interface Service {
  id: number;
  name: string;
  description: string | null;
  audience: string | null;
  problem: string | null;
  proof: string | null;
  notes: string | null;
  position: number;
  origin: FieldOrigin;
  origin_at: string;
  created_at: string;
}

export type ServiceInput = { name: string } & Partial<Record<ServiceTextField, string | null>>;

/** Un altro servizio ha già questo nome a meno di maiuscole e spazi (B10). */
export class ServiceNameTakenError extends Error {
  readonly code = 'service_exists';
  constructor(readonly existing: Service) {
    super(
      `Hai già un servizio con questo nome: «${existing.name}». I nomi si distinguono a meno di maiuscole e spazi.`,
    );
    this.name = 'ServiceNameTakenError';
  }
}

const COLUMNS = `id, name, ${SERVICE_TEXT_FIELDS.join(', ')}, position, origin, origin_at, created_at`;

export function listServices(): Service[] {
  return db.prepare(`SELECT ${COLUMNS} FROM services ORDER BY position, id`).all() as Service[];
}

function getService(id: number): Service | undefined {
  return db.prepare(`SELECT ${COLUMNS} FROM services WHERE id = ?`).get(id) as Service | undefined;
}

function assertNameFree(key: string, exceptId?: number): void {
  const taken = db.prepare(`SELECT id FROM services WHERE name_key = ? AND id IS NOT ?`).get(key, exceptId ?? null) as
    | { id: number }
    | undefined;
  if (taken) throw new ServiceNameTakenError(getService(taken.id)!);
}

/**
 * Modifica a mano: i campi non nominati in `patch` restano come sono. Solo un valore che cambia davvero
 * marca il servizio "scritto da te" adesso (B6): salvare il dialog senza toccare nulla non trasforma una voce
 * applicata da una proposta in un futuro conflitto (FLOW, "Provenienza che cambia natura").
 * `undefined` se il servizio non esiste (può essere stato eliminato da un'altra scheda).
 */
export function updateService(id: number, patch: Partial<ServiceInput>): Service | undefined {
  return db.transaction(() => {
    const current = getService(id);
    if (!current) return undefined;
    const next: Record<string, string | null> = {};
    if (patch.name !== undefined && patch.name.trim() !== current.name) next.name = patch.name.trim();
    for (const f of SERVICE_TEXT_FIELDS) {
      if (patch[f] === undefined) continue;
      const value = cleanText(patch[f]);
      if (value !== current[f]) next[f] = value;
    }
    if (Object.keys(next).length === 0) return current;
    if (next.name !== undefined) {
      next.name_key = serviceNameKey(next.name!);
      assertNameFree(next.name_key, id);
    }
    const values = { ...next, origin: 'manual', origin_at: nowIso() };
    const sets = Object.keys(values).map((c) => `${c} = @${c}`);
    db.prepare(`UPDATE services SET ${sets.join(', ')} WHERE id = @id`).run({ ...values, id });
    return getService(id);
  })();
}

/** `false` se il servizio non esiste. Le analisi che lo citano conservano il nome di allora (F5). */
export function deleteService(id: number): boolean {
  return db.prepare(`DELETE FROM services WHERE id = ?`).run(id).changes > 0;
}

/**
 * Ordine dichiarato dall'utente (B4), posizioni riscritte contigue da 1. `ids` è l'ordine completo visto
 * dal client: da un'altra scheda può citare un servizio già eliminato (ignorato) o non conoscerne uno nuovo
 * (resta in coda nel suo ordine attuale). Così il riordino converge all'ultimo clic senza lock (FLOW, due tab).
 * Non tocca la provenienza: l'ordine non è un valore del servizio.
 */
export function reorderServices(ids: number[]): Service[] {
  db.transaction(() => {
    const current = db.prepare(`SELECT id FROM services ORDER BY position, id`).pluck().all() as number[];
    const known = new Set(current);
    const listed = ids.filter((id) => known.has(id));
    const inList = new Set(listed);
    const rest = current.filter((id) => !inList.has(id));
    const setPosition = db.prepare(`UPDATE services SET position = ? WHERE id = ?`);
    [...listed, ...rest].forEach((id, i) => setPosition.run(i + 1, id));
  })();
  return listServices();
}

/** Crea il servizio in fondo all'elenco, scritto a mano. Il nome arriva già validato non vuoto dalla route. */
export function createService(input: ServiceInput): Service {
  const name = input.name.trim();
  const key = serviceNameKey(name);
  const id = db.transaction(() => {
    assertNameFree(key);
    const { next } = db.prepare(`SELECT COALESCE(MAX(position), 0) + 1 AS next FROM services`).get() as { next: number };
    return db
      .prepare(
        `INSERT INTO services (name, name_key, ${SERVICE_TEXT_FIELDS.join(', ')}, position, origin, origin_at)
         VALUES (@name, @name_key, ${SERVICE_TEXT_FIELDS.map((f) => `@${f}`).join(', ')}, @position, 'manual', @origin_at)`,
      )
      .run({
        name,
        name_key: key,
        ...Object.fromEntries(SERVICE_TEXT_FIELDS.map((f) => [f, cleanText(input[f])])),
        position: next,
        origin_at: nowIso(),
      }).lastInsertRowid as number;
  })();
  return getService(id)!;
}
