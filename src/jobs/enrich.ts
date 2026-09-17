import pLimit from 'p-limit';
import { z } from 'zod';
import { ACTORS } from '../apify/actors.js';
import { ApolloRateLimitError, createApolloClient, type ApolloClient } from '../apollo/client.js';
import { APOLLO_BULK_MAX, chunk, matchPeopleRequest, type PeopleMatchDetail } from '../apollo/requests.js';
import { APOLLO_KEY_BLOCKER, config } from '../config.js';
import { addActivity } from '../db/activities.js';
import { findCompanyByUrl } from '../db/companies.js';
import { setProspectIdentity } from '../db/identity.js';
import { db, nowIso } from '../db/index.js';
import { getList, isListArchived } from '../db/lists.js';
import { alignMatches, applyApolloMatch, creditsConsumed } from '../enrich/apollo-match.js';
import { enrichProfileDetails, type Enrichment } from '../enrich/profile-detail.js';
import { hasEmail } from '../util/fields.js';
import { ENRICH_PROVIDERS, type EnrichProvider, type JobHandler, type JobResult } from './types.js';

/*
 * Job `enrich` — enrichment on-demand di prospect scelti o dei membri di una lista (crm-foundation
 * T10). Un profilo che fallisce non ferma il job (isolamento per item); la configurazione mancante
 * sì (`config:`). `enrichOneInline` è la variante sincrona per l'analisi con `enrichFirst` (T11).
 *
 * Provider (apollo-lookalike T10, SPEC G): `apify` (default, profilo completo, scrive `enriched_at`) o
 * `apollo` (solo email di lavoro via `people/bulk_match`, lotti da 10: scrive `apollo_matched_at`, mai
 * `enriched_at`/`enrichment_attempted_at`, così l'analisi continua a richiedere Apify).
 */

/** Dipendenze iniettabili del job (I/O esterno). */
export type Deps = {
  /**
   * Profile-detail degli URL: chiave = URL di **input**; un URL assente dalla mappa = nessun dato
   * sul profilo. Rigetta su errore del provider (`actor:<id>: …`) o di configurazione (`config: …`).
   * Il job la chiama con un URL per volta, a concorrenza `config.enrichConcurrency`.
   */
  enrich: (urls: string[]) => Promise<Map<string, Enrichment>>;
  /**
   * `POST people/bulk_match` per al massimo 10 dettagli (`matchPeopleRequest`: `{id}` se l'id Apollo è
   * noto, altrimenti `{linkedin_url}`): risposta grezza con `matches[]` nell'ordine dei dettagli e
   * `credits_consumed`. Rigetta con `config:` / `actor:apollo:people/bulk_match:` (errori del client).
   * Facoltativa nel tipo perché l'analisi con `enrichFirst` usa solo Apify; il job con
   * `provider: 'apollo'` senza di essa fallisce con `config:`.
   */
  matchPeople?: (details: PeopleMatchDetail[]) => Promise<unknown>;
};

/** Ambito: prospect scelti (selezione, dettaglio) oppure i membri di una lista. */
export type EnrichParams = ({ prospectIds: number[]; listId?: undefined } | { listId: number; prospectIds?: undefined }) & {
  /**
   * Default `apify` (job salvati prima di apollo-lookalike T10); le route lo salvano sempre esplicito.
   * Con `apollo` l'ambito è "senza email" e la freschezza si legge da `apollo_matched_at` (P-7).
   */
  provider?: EnrichProvider;
  /** Default `true`: salta i prospect già arricchiti; `false` li riarricchisce. Ignorato con `apollo`. */
  onlyMissing?: boolean;
  /** Default `false`: con `true` riprova anche i tentati senza esito negli ultimi `freshnessDays`. */
  retryFailed?: boolean;
};

const paramsSchema = z
  .object({
    prospectIds: z.array(z.number().int().positive()).min(1).optional(),
    listId: z.number().int().positive().optional(),
    provider: z.enum(ENRICH_PROVIDERS).optional(),
    onlyMissing: z.boolean().optional(),
    retryFailed: z.boolean().optional(),
  })
  .refine((p) => (p.prospectIds === undefined) !== (p.listId === undefined), 'serve prospectIds oppure listId');

// ---------------------------------------------------------------------------
// Pianificazione (condivisa da job e preview)
// ---------------------------------------------------------------------------

export interface EnrichPlan {
  /** Prospect esistenti nell'ambito (id richiesti trovati o membri della lista). */
  selected: number;
  /** Id da passare al provider, nell'ordine dell'ambito. */
  targets: number[];
  /** Già arricchiti, saltati (`onlyMissing`; sempre 0 con `apollo`). */
  skipped_enriched: number;
  /** Con email già presente, saltati (solo `apollo`: chi ha un'email non si ripaga mai, SPEC G2). */
  skipped_with_email: number;
  /**
   * Tentati senza esito negli ultimi `freshnessDays`, saltati (salvo `retryFailed`): `apify` legge
   * `enrichment_attempted_at`, `apollo` legge `apollo_matched_at`.
   */
  skipped_fresh: number;
  /** Id richiesti che non esistono (solo ambito `prospectIds`). */
  not_found: number;
}

interface PlanRow {
  id: number;
  email: string | null;
  enriched_at: string | null;
  enrichment_attempted_at: string | null;
  apollo_matched_at: string | null;
}

const PLAN_COLUMNS = ['id', 'email', 'enriched_at', 'enrichment_attempted_at', 'apollo_matched_at'];

/** Provider dei `params`: assente = `apify` (job anteriori ad apollo-lookalike T10). */
export function enrichProvider(params: Pick<EnrichParams, 'provider'>): EnrichProvider {
  return params.provider ?? 'apify';
}

/**
 * Chi arricchire. `apify`: `enriched_at` nullo (o qualunque, con `onlyMissing:false`) e tentativo
 * assente, più vecchio di `freshnessDays` o riprovato con `retryFailed`. `apollo` (P-7): senza email
 * e con `apollo_matched_at` assente, più vecchia di `freshnessDays` o riprovata con `retryFailed`
 * (`onlyMissing` ignorato). Non verifica che la lista esista.
 */
export function planEnrichment(params: EnrichParams, now: number = Date.now()): EnrichPlan {
  let rows: PlanRow[];
  let notFound = 0;
  if (params.prospectIds !== undefined) {
    const ids = [...new Set(params.prospectIds)];
    const found = new Map(
      (ids.length === 0
        ? []
        : (db
            .prepare(`SELECT ${PLAN_COLUMNS.join(', ')} FROM prospects WHERE id IN (${ids.map(() => '?').join(', ')})`)
            .all(...ids) as PlanRow[])
      ).map((r) => [r.id, r]),
    );
    rows = ids.flatMap((id) => found.get(id) ?? []);
    notFound = ids.length - rows.length;
  } else {
    rows = db
      .prepare(
        `SELECT ${PLAN_COLUMNS.map((col) => `p.${col}`).join(', ')}
         FROM list_members lm JOIN prospects p ON p.id = lm.prospect_id
         WHERE lm.list_id = ? ORDER BY lm.added_at, p.id`,
      )
      .all(params.listId) as PlanRow[];
  }

  const onlyMissing = params.onlyMissing ?? true;
  const cutoff = now - config.freshnessDays * 86_400_000;
  const recent = (at: string | null) => !params.retryFailed && at !== null && Date.parse(at) > cutoff;
  const plan: EnrichPlan = {
    selected: rows.length,
    targets: [],
    skipped_enriched: 0,
    skipped_with_email: 0,
    skipped_fresh: 0,
    not_found: notFound,
  };
  if (enrichProvider(params) === 'apollo') {
    for (const r of rows) {
      if (hasEmail(r.email)) plan.skipped_with_email += 1;
      else if (recent(r.apollo_matched_at)) plan.skipped_fresh += 1;
      else plan.targets.push(r.id);
    }
    return plan;
  }
  for (const r of rows) {
    if (r.enriched_at !== null) {
      if (onlyMissing) plan.skipped_enriched += 1;
      else plan.targets.push(r.id);
    } else if (recent(r.enrichment_attempted_at)) {
      plan.skipped_fresh += 1;
    } else {
      plan.targets.push(r.id);
    }
  }
  return plan;
}

/**
 * Stima per la preview: `apify` = `targets × PRICE_PROFILE_DETAIL_USD`; `apollo` = `targets` crediti ×
 * `APOLLO_CREDIT_USD` (SPEC C5/G3). `null` se il prezzo non è configurato (mai inventato).
 */
export function estimateEnrichCostUsd(targets: number, provider: EnrichProvider = 'apify'): number | null {
  if (targets === 0) return 0;
  const price = provider === 'apollo' ? config.prices.apolloCreditUsd : config.prices.profileDetailUsd;
  return price === null ? null : Number((targets * price).toFixed(4));
}

/**
 * Blocker di configurazione del job (preview, avvio e, con T6, "Riprova" via `CONFIG_BLOCKERS`):
 * chiave del provider scelto mancante, lista archiviata. Il blocker "nessun profilo da cercare"
 * dipende dallo stato dei prospect, non dalla configurazione: lo aggiunge la route.
 */
export function configBlockers(params: EnrichParams): string[] {
  const blockers: string[] = [];
  if (enrichProvider(params) === 'apollo') {
    if (!config.apolloApiKey.trim()) blockers.push(APOLLO_KEY_BLOCKER);
  } else if (!config.apifyToken.trim()) {
    blockers.push('APIFY_TOKEN mancante nel .env — nessun job avviato.');
  }
  if (params.listId !== undefined && isListArchived(params.listId)) {
    blockers.push('Lista archiviata: arricchimento disabilitato (lettura ed export restano possibili).');
  }
  return blockers;
}

// ---------------------------------------------------------------------------
// Un profilo: chiamata al provider + applicazione
// ---------------------------------------------------------------------------

export type EnrichOutcome = 'enriched' | 'no_data' | 'error' | 'not_found';

/** Esito dell'arricchimento di un prospect (`enrichOneInline`, e per item nel job). */
export interface EnrichOneResult {
  /**
   * Il prospect arricchito: resta sempre lo stesso id (assorbe i duplicati rivelati dall'URL
   * canonico), quindi è quello da rileggere dopo.
   */
  prospectId: number;
  /** `enriched` = dati salvati · `no_data` = profilo senza dati · `error` = provider/config · `not_found` = id inesistente. */
  outcome: EnrichOutcome;
  /** Il prospect ha un'email dopo l'arricchimento (anche se c'era già). */
  withEmail: boolean;
  /** Prospect duplicati uniti in `prospectId` (identità, steering 2026-09-16). */
  mergedIds: number[];
  /** Messaggio attribuito (`actor:<id>: …` / `config: …`) quando `outcome === 'error'`. */
  error?: string;
}

const ACTOR = ACTORS.profileDetail;

interface ProspectKeyRow {
  id: number;
  linkedin_url: string;
  email: string | null;
}

function keyRow(id: number): ProspectKeyRow | undefined {
  return db.prepare('SELECT id, linkedin_url, email FROM prospects WHERE id = ?').get(id) as ProspectKeyRow | undefined;
}

/** Errore del provider attribuito: i prefissi `actor:`/`config:`/`process:` restano, il resto è dell'actor. */
function providerError(err: unknown): string {
  const message = (err instanceof Error ? err.message : String(err)).trim() || 'errore sconosciuto';
  return /^(actor|config|process):/.test(message) ? message : `actor:${ACTOR}: ${message}`;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number | undefined): Promise<T> {
  if (!timeoutMs) return promise;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`actor:${ACTOR}: nessuna risposta entro ${Math.round(timeoutMs / 1000)} s`)),
      timeoutMs,
    );
  });
  // Un esito tardivo del provider si ignora (nessuna scrittura): la gara lo gestisce comunque.
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Azienda in anagrafica per URL LinkedIn, altrimenti per nome esatto se univoco (best-effort). */
function matchCompanyId(e: Enrichment): number | null {
  const byUrl = e.companyUrl ? findCompanyByUrl(e.companyUrl) : undefined;
  if (byUrl) return byUrl.id;
  const name = e.company?.trim();
  if (!name) return null;
  const ids = db.prepare('SELECT id FROM companies WHERE name = ? COLLATE NOCASE').pluck().all(name) as number[];
  return ids.length === 1 ? ids[0] : null;
}

/** Stringhe vuote o di soli spazi valgono "assente": non devono coprire un valore salvato. */
function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * Scrive l'esito sul prospect `id` in una transazione. Con dati: identità (URL canonico + id
 * membro → `setProspectIdentity`, il prospect resta e assorbe i duplicati), campi del profilo
 * aggiornati coi valori nuovi non vuoti, email/telefono/azienda collegata solo se mancanti (mai
 * sovrascritti né azzerati), `raw_json`, `enriched_at`. Sempre `enrichment_attempted_at` e
 * un'attività `enrichment` con l'esito.
 */
function applyEnrichment(id: number, enrichment: Enrichment | undefined): EnrichOneResult {
  return db.transaction((): EnrichOneResult => {
    const now = nowIso();
    if (!keyRow(id)) return { prospectId: id, outcome: 'not_found', withEmail: false, mergedIds: [] };

    if (!enrichment) {
      db.prepare('UPDATE prospects SET enrichment_attempted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
      addActivity({
        prospectId: id,
        kind: 'enrichment',
        body: 'Arricchimento senza dati: profilo privato o non leggibile.',
        meta: { outcome: 'no_data', actor: ACTOR },
      });
      return { prospectId: id, outcome: 'no_data', withEmail: hasEmail(keyRow(id)!.email), mergedIds: [] };
    }

    const { mergedIds } =
      enrichment.canonicalUrl || enrichment.memberUrn
        ? setProspectIdentity(id, { linkedinUrl: enrichment.canonicalUrl, memberUrn: enrichment.memberUrn })
        : { mergedIds: [] as number[] };

    const missing = (col: string) => `CASE WHEN ${col} IS NULL OR TRIM(${col}) = '' THEN ? ELSE ${col} END`;
    db.prepare(
      `UPDATE prospects SET
         full_name = COALESCE(?, full_name), headline = COALESCE(?, headline), about = COALESCE(?, about),
         location = COALESCE(?, location), company_name = COALESCE(?, company_name), title = COALESCE(?, title),
         raw_json = COALESCE(?, raw_json),
         email = COALESCE(${missing('email')}, email), phone = COALESCE(${missing('phone')}, phone),
         company_id = COALESCE(company_id, ?),
         enriched_at = ?, enrichment_attempted_at = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      clean(enrichment.fullName),
      clean(enrichment.headline),
      clean(enrichment.about),
      clean(enrichment.location),
      clean(enrichment.company),
      clean(enrichment.title),
      enrichment.raw === undefined || enrichment.raw === null ? null : JSON.stringify(enrichment.raw),
      clean(enrichment.email),
      clean(enrichment.phone),
      matchCompanyId(enrichment),
      now,
      now,
      now,
      id,
    );

    const withEmail = hasEmail(keyRow(id)!.email);
    addActivity({
      prospectId: id,
      kind: 'enrichment',
      body: withEmail ? 'Profilo arricchito da LinkedIn (con email).' : 'Profilo arricchito da LinkedIn (senza email pubblica).',
      meta: { outcome: 'enriched', actor: ACTOR, with_email: withEmail, ...(mergedIds.length ? { merged_ids: mergedIds } : {}) },
    });
    return { prospectId: id, outcome: 'enriched', withEmail, mergedIds };
  })();
}

/**
 * Arricchisce un prospect: chiama il provider con il suo URL e applica l'esito. Un errore del
 * provider non stampa `enrichment_attempted_at` (il prossimo arricchimento lo riprova) e, se non è
 * di configurazione, lascia un'attività `enrichment` con `meta.error`.
 */
async function enrichOne(id: number, deps: Deps, timeoutMs?: number): Promise<EnrichOneResult> {
  const current = keyRow(id);
  if (!current) return { prospectId: id, outcome: 'not_found', withEmail: false, mergedIds: [] };

  let enrichment: Enrichment | undefined;
  try {
    const map = await withTimeout(deps.enrich([current.linkedin_url]), timeoutMs);
    // Un URL per chiamata: qualunque voce della mappa è quella del prospect (tollerante sulla chiave).
    enrichment = map.get(current.linkedin_url) ?? (map.size === 1 ? [...map.values()][0] : undefined);
  } catch (err) {
    const error = providerError(err);
    if (!error.startsWith('config:') && keyRow(id)) {
      addActivity({
        prospectId: id,
        kind: 'enrichment',
        body: `Arricchimento non riuscito: ${error}`,
        meta: { outcome: 'error', actor: ACTOR, error },
      });
    }
    return { prospectId: id, outcome: 'error', withEmail: hasEmail(current.email), mergedIds: [], error };
  }
  return applyEnrichment(id, enrichment);
}

/**
 * Arricchimento **sincrono** di un prospect, per l'analisi con `enrichFirst` (T11): nessun job,
 * nessun controllo di freschezza o di "già arricchito" (l'azione è esplicita). `timeoutMs`
 * (es. 120 000) trasforma un provider troppo lento in `outcome:'error'` senza scritture.
 * Non lancia per errori del provider/configurazione: li riporta in `error`.
 */
export async function enrichOneInline(
  prospectId: number,
  deps: Deps,
  opts: { timeoutMs?: number } = {},
): Promise<EnrichOneResult> {
  return enrichOne(prospectId, deps, opts.timeoutMs);
}

// ---------------------------------------------------------------------------
// Job bulk
// ---------------------------------------------------------------------------

/** Conteggi di `result.counts`. */
export interface EnrichCounts {
  [key: string]: number;
  selected: number;
  targets: number;
  enriched: number;
  no_data: number;
  with_email: number;
  errors: number;
  skipped_enriched: number;
  skipped_fresh: number;
  not_found: number;
  prospects_merged: number;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function summarize(c: EnrichCounts): string {
  const skipped: string[] = [];
  if (c.skipped_enriched) skipped.push(plural(c.skipped_enriched, 'già arricchito', 'già arricchiti'));
  if (c.skipped_fresh) {
    skipped.push(plural(c.skipped_fresh, 'tentato di recente senza risultato', 'tentati di recente senza risultato'));
  }
  const tail = skipped.length ? ` · saltati: ${skipped.join(', ')}` : '';
  const parts: string[] = [];
  if (c.enriched + c.no_data + c.errors > 0) {
    parts.push(`${plural(c.enriched, 'arricchito', 'arricchiti')} (${c.with_email} con email)`);
    if (c.no_data) parts.push(`${c.no_data} senza dati sul profilo`);
    if (c.errors) parts.push(`${c.errors} in errore`);
  } else {
    parts.push('nessun profilo da arricchire');
  }
  if (c.prospects_merged) parts.push(plural(c.prospects_merged, 'duplicato unito', 'duplicati uniti'));
  if (c.not_found) parts.push(plural(c.not_found, 'non trovato', 'non trovati'));
  return `Arricchimento: ${parts.join(' · ')}${tail}.`;
}

/**
 * Arricchisce i prospect dell'ambito (`prospectIds` o membri di `listId`) secondo `planEnrichment`.
 * Best-effort per item; lancia `config:` su parametri/lista non validi o configurazione mancante,
 * e l'errore del provider se **tutti** i profili tentati falliscono (actor giù: job `failed`).
 * Con `provider: 'apollo'` delega a `enrichWithApollo` (email di lavoro, lotti da 10).
 */
export async function enrichProspects(params: EnrichParams, deps: Deps): Promise<JobResult> {
  const parsed = paramsSchema.safeParse(params);
  if (!parsed.success) throw new Error(`config: parametri del job di arricchimento non validi (${parsed.error.issues[0]?.message}).`);
  const scope = parsed.data as EnrichParams;
  // Configurazione prima di qualunque lettura o chiamata (PLAN §9: check in cima all'handler).
  if (enrichProvider(scope) === 'apollo') {
    if (!config.apolloApiKey.trim()) throw new Error('config: APOLLO_API_KEY mancante nel .env: nessuna email cercata.');
    if (!deps.matchPeople) throw new Error('config: provider Apollo non disponibile (deps senza matchPeople): nessuna email cercata.');
  }
  if (scope.listId !== undefined) {
    const list = getList(scope.listId);
    if (!list) throw new Error(`config: lista ${scope.listId} inesistente: nessun profilo arricchito.`);
    if (isListArchived(scope.listId)) throw new Error(`config: la lista "${list.name}" è archiviata: nessun profilo arricchito.`);
  }

  if (enrichProvider(scope) === 'apollo') return enrichWithApollo(scope, deps.matchPeople!);

  const plan = planEnrichment(scope);
  const counts: EnrichCounts = {
    selected: plan.selected,
    targets: plan.targets.length,
    enriched: 0,
    no_data: 0,
    with_email: 0,
    errors: 0,
    skipped_enriched: plan.skipped_enriched,
    skipped_fresh: plan.skipped_fresh,
    not_found: plan.not_found,
    prospects_merged: 0,
  };
  const merged = new Set<number>();
  const errors: string[] = [];
  let configError: string | undefined;

  const limit = pLimit(Math.max(1, config.enrichConcurrency));
  await Promise.all(
    plan.targets.map((id) =>
      limit(async () => {
        // Già unito in un altro prospect arricchito in questo job, o configurazione rotta: niente spesa.
        if (configError || merged.has(id)) return;
        const r = await enrichOne(id, deps);
        for (const m of r.mergedIds) merged.add(m);
        counts.prospects_merged += r.mergedIds.length;
        if (r.outcome === 'enriched') {
          counts.enriched += 1;
          if (r.withEmail) counts.with_email += 1;
        } else if (r.outcome === 'no_data') {
          counts.no_data += 1;
        } else if (r.outcome === 'error') {
          if (r.error!.startsWith('config:')) configError ??= r.error;
          else {
            counts.errors += 1;
            errors.push(r.error!);
          }
        } else if (!merged.has(id)) {
          counts.not_found += 1;
        }
      }),
    ),
  );

  if (configError) throw new Error(configError);
  if (counts.errors > 0 && counts.enriched + counts.no_data === 0) {
    throw new Error(counts.errors === 1 ? errors[0] : `${errors[0]} (tutti i ${counts.errors} profili in errore)`);
  }
  const warnings =
    counts.errors > 0
      ? [
          `${plural(counts.errors, 'profilo non arricchito', 'profili non arricchiti')} per errore del provider (${errors[0]}): il prossimo arricchimento li riprova.`,
        ]
      : [];
  return { summary: summarize(counts), counts, warnings };
}

// ---------------------------------------------------------------------------
// Provider Apollo: email di lavoro (apollo-lookalike T10, SPEC G)
// ---------------------------------------------------------------------------

/** Conteggi di `result.counts` con `provider: 'apollo'`: sempre tutte le chiavi, anche nei parziali. */
export interface ApolloEnrichCounts {
  [key: string]: number;
  /** Prospect esistenti nell'ambito. */
  selected: number;
  /** Prospect da cercare secondo il piano (= `est_credits` della preview). */
  targets: number;
  /** Apollo ha restituito un'email di lavoro (salvata). */
  with_email: number;
  /** Apollo ha risposto senza email: contatti EU, persona non abbinata o dato assente. */
  unavailable: number;
  /** Email già presente: saltati dal piano o al momento del lotto (mai ripagati). */
  already_had_email: number;
  /** Con esito Apollo negli ultimi `freshnessDays`, saltati (salvo `retryFailed`). */
  skipped_fresh: number;
  /** Id richiesti inesistenti o spariti durante il job (unione). */
  not_found: number;
  /** Target non cercati per errore del provider o arresto: restano "da cercare" (`apollo_matched_at` nulla). */
  not_searched: number;
  /** Id Apollo già di un altro prospect: non scritto (SPEC F6). */
  apollo_id_taken: number;
  /** Somma di `credits_consumed` delle risposte. */
  credits_used: number;
}

const APOLLO_MATCH_OP = 'people/bulk_match';

/** Errore attribuito: i prefissi `actor:`/`config:`/`process:` restano, il resto è di `people/bulk_match`. */
function apolloError(err: unknown): string {
  const message = (err instanceof Error ? err.message : String(err)).trim() || 'errore sconosciuto';
  return /^(actor|config|process):/.test(message) ? message : `actor:apollo:${APOLLO_MATCH_OP}: ${message}`;
}

function summarizeApollo(c: ApolloEnrichCounts): string {
  const parts: string[] = [];
  if (c.targets === 0) {
    parts.push('nessun profilo da cercare');
  } else {
    parts.push(plural(c.with_email, 'email di lavoro trovata', 'email di lavoro trovate'));
    parts.push(`${plural(c.unavailable, 'non disponibile', 'non disponibili')} (contatti EU o dato assente)`);
  }
  if (c.already_had_email) parts.push(plural(c.already_had_email, 'già presente (saltata)', 'già presenti (saltate)'));
  if (c.skipped_fresh) parts.push(plural(c.skipped_fresh, 'tentato di recente (saltato)', 'tentati di recente (saltati)'));
  if (c.not_searched) parts.push(`${c.not_searched} ${c.not_searched === 1 ? 'resta' : 'restano'} da cercare`);
  if (c.apollo_id_taken) parts.push(`${c.apollo_id_taken} con id Apollo già assegnato`);
  if (c.not_found) parts.push(plural(c.not_found, 'non trovato', 'non trovati'));
  parts.push(plural(c.credits_used, 'credito usato', 'crediti usati'));
  return `Email via Apollo: ${parts.join(' · ')}.`;
}

interface MatchTargetRow {
  id: number;
  linkedin_url: string;
  email: string | null;
  apollo_person_id: string | null;
}

/**
 * Email di lavoro via `people/bulk_match` per i target del piano, a lotti da `APOLLO_BULK_MAX`. Ogni
 * lotto rilegge i prospect (spariti per unione → `not_found`; email arrivata nel frattempo → non si
 * paga), manda `{id}` se l'id Apollo è noto altrimenti `{linkedin_url}`, allinea `matches[]` per
 * posizione e applica l'esito con `applyApolloMatch` in una transazione (G4–G6).
 *
 * Errori: un errore del provider su un lotto lascia quei prospect "da cercare" (nessuna scrittura) e
 * si passa al lotto successivo; limite Apollo (`ApolloRateLimitError`) o `config:` fermano il job.
 * Nessun lotto elaborato → si lancia l'errore attribuito (job `failed`); almeno uno → esito parziale
 * riuscito con warning (G7, S-4).
 */
async function enrichWithApollo(
  scope: EnrichParams,
  matchPeople: NonNullable<Deps['matchPeople']>,
): Promise<JobResult> {
  const plan = planEnrichment(scope);
  const counts: ApolloEnrichCounts = {
    selected: plan.selected,
    targets: plan.targets.length,
    with_email: 0,
    unavailable: 0,
    already_had_email: plan.skipped_with_email,
    skipped_fresh: plan.skipped_fresh,
    not_found: plan.not_found,
    not_searched: 0,
    apollo_id_taken: 0,
    credits_used: 0,
  };
  let processed = 0;
  let firstError: string | undefined;
  let stop: { error: string; rateLimit: boolean } | undefined;

  for (const ids of chunk(plan.targets, APOLLO_BULK_MAX)) {
    if (stop) {
      counts.not_searched += ids.length;
      continue;
    }
    const rows = new Map(
      (
        db
          .prepare(`SELECT id, linkedin_url, email, apollo_person_id FROM prospects WHERE id IN (${ids.map(() => '?').join(', ')})`)
          .all(...ids) as MatchTargetRow[]
      ).map((r) => [r.id, r]),
    );
    const batch: Array<{ id: number; detail: PeopleMatchDetail }> = [];
    for (const id of ids) {
      const r = rows.get(id);
      if (!r) counts.not_found += 1;
      else if (hasEmail(r.email)) counts.already_had_email += 1;
      else batch.push({ id, detail: r.apollo_person_id ? { id: r.apollo_person_id } : { linkedin_url: r.linkedin_url } });
    }
    if (batch.length === 0) continue;

    const details = batch.map((b) => b.detail);
    let response: unknown;
    let people: ReturnType<typeof alignMatches>;
    try {
      response = await matchPeople(details);
      people = alignMatches(details, response);
      if (people === null) throw new Error(`actor:apollo:${APOLLO_MATCH_OP}: risposta senza matches[]`);
    } catch (err) {
      const error = apolloError(err);
      firstError ??= error;
      counts.not_searched += batch.length;
      if (err instanceof ApolloRateLimitError || error.startsWith('config:')) {
        stop = { error, rateLimit: err instanceof ApolloRateLimitError };
      }
      continue;
    }

    const matched = people;
    const now = nowIso();
    db.transaction(() => {
      batch.forEach(({ id }, i) => {
        const r = applyApolloMatch(id, matched[i], { now });
        if (r.outcome === 'not_found') counts.not_found += 1;
        else if (r.outcome === 'email_found') counts.with_email += 1;
        else counts.unavailable += 1;
        if (r.apolloIdTaken) counts.apollo_id_taken += 1;
      });
    })();
    counts.credits_used += creditsConsumed(response, matched);
    processed += 1;
  }

  if (firstError !== undefined && processed === 0) throw new Error(stop?.error ?? firstError);

  const warnings: string[] = [];
  if (firstError !== undefined) {
    const searched = counts.with_email + counts.unavailable;
    const progress =
      `${plural(searched, 'email cercata', 'email cercate')} su ${counts.targets} · ` +
      `${counts.with_email} ${counts.with_email === 1 ? 'trovata' : 'trovate'}. ` +
      (counts.not_searched === 1 ? 'Il restante resta "da cercare"' : `I ${counts.not_searched} restanti restano "da cercare"`);
    warnings.push(
      stop?.rateLimit
        ? `Limite Apollo raggiunto: ${progress} (${stop.error}).`
        : `Errore Apollo su una parte dei profili: ${progress} (${stop?.error ?? firstError}).`,
    );
  }
  return { summary: summarizeApollo(counts), counts, warnings };
}

/** Handler registrato in `HANDLERS.enrich`. */
export const handler: JobHandler<EnrichParams, Deps> = (params, deps) => enrichProspects(params, deps);

/**
 * Deps reali: apimaestro/linkedin-profile-detail via Apify (token verificato a ogni chiamata) e
 * `people/bulk_match` via client Apollo, creato alla prima chiamata (nessuna chiamata all'import).
 */
export function realDeps(): Deps {
  let client: ApolloClient | undefined;
  const apollo = () => (client ??= createApolloClient({ apiKey: config.apolloApiKey }));
  return {
    enrich: async (urls) => {
      if (!config.apifyToken.trim()) {
        throw new Error('config: APIFY_TOKEN mancante nel .env: nessun profilo arricchito.');
      }
      return enrichProfileDetails(urls);
    },
    matchPeople: (details) => apollo().post(matchPeopleRequest(details)),
  };
}
