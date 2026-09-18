import { ApolloConfigError, ApolloRateLimitError, lazyApolloClient } from '../apollo/client.js';
import { mapOrganizations, type ApolloOrganization } from '../apollo/mappers/organizations.js';
import { APOLLO_BULK_MAX, chunk, enrichOrganizationsRequest } from '../apollo/requests.js';
import { apolloKeyBlockers, config } from '../config.js';
import {
  apolloStateOf,
  getCompany,
  upsertCompany,
  type Company,
  type CompanyApolloState,
  type CompanyKey,
  type CompanyKeyConflict,
} from '../db/companies.js';
import { getIcp, listReferenceCompanies } from '../db/icps.js';
import { db, nowIso } from '../db/index.js';
import { field, normalizeDomain } from '../util/fields.js';
import { attributeApolloError } from './errors.js';
import {
  ICP_MISSING_BLOCKER,
  type EnrichCompaniesCounts,
  type EnrichCompaniesParams,
  type JobHandler,
  type JobPreview,
  type JobResult,
} from './types.js';

/*
 * Job `enrich_companies` — arricchimento Apollo delle aziende: referenze di un ICP o singola azienda
 * (apollo-lookalike SPEC C, PLAN T7c). Tre pezzi:
 * - `planEnrichCompanies` → preview (conteggi, elenco per il dialog, warning, blocker) e `params` da congelare;
 * - `enrichCompanies` → nucleo riusabile (anche da `lookalike_companies` per le candidate nuove, S-7):
 *   lotti da 10 domini, abbinamento organizzazione ↔ azienda richiesta, scrittura con le Regole di unione;
 * - `handler` → verifica di configurazione, nucleo, esito (fallito prima della prima scrittura, parziale dopo).
 * Contratto `params`/`result.counts`: `types.ts`.
 */

/** Dipendenze iniettabili del job (convenzione Apollo in `types.ts`: JSON grezzo, mapper nell'handler). */
export type Deps = {
  /**
   * `POST organizations/bulk_enrich` per al massimo 10 domini (`enrichOrganizationsRequest`): risposta
   * grezza da leggere con `mapOrganizations`. Rigetta con `config:` / `actor:apollo:organizations/bulk_enrich:`.
   */
  enrichOrganizations: (domains: string[]) => Promise<unknown>;
};

const OP = 'organizations/bulk_enrich';

/**
 * Blocker di configurazione del kind (registry `CONFIG_BLOCKERS`, usato anche da "Riprova" con T6):
 * chiave Apollo mancante e ICP sparito (AL-TD-4: la route risponde 404 prima della preview).
 */
export function configBlockers(params?: EnrichCompaniesParams): string[] {
  const blockers = apolloKeyBlockers();
  if (params?.icpId !== undefined && !getIcp(params.icpId)) blockers.push(ICP_MISSING_BLOCKER);
  return blockers;
}

// ---------------------------------------------------------------------------
// Testi
// ---------------------------------------------------------------------------

/** Data breve in italiano ("10 set", con l'anno se non è quello corrente); illeggibile → "data ignota". */
export function formatDay(iso: string | null | undefined, now: Date = new Date()): string {
  const date = new Date(iso ?? '');
  if (Number.isNaN(date.getTime())) return 'data ignota';
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  if (date.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return date.toLocaleDateString('it-IT', opts);
}

/** Elenco di nomi leggibile, troncato dopo `max` ("A, B, C e altre 4"). */
function names(list: string[], max = 10): string {
  if (list.length <= max) return list.join(', ');
  return `${list.slice(0, max).join(', ')} e altre ${list.length - max}`;
}

function companyLabel(c: Pick<Company, 'id' | 'name' | 'domain' | 'linkedin_url'>): string {
  return c.name ?? c.domain ?? c.linkedin_url ?? `azienda #${c.id}`;
}

/** Nome dell'ambito al singolare/plurale: referenze dell'ICP o aziende. */
function nounOf(references: boolean) {
  return (n: number) => (references ? (n === 1 ? 'referenza' : 'referenze') : n === 1 ? 'azienda' : 'aziende');
}

/** Valore di chiave accorciato per i messaggi (`https://www.linkedin.com/company/x` → `linkedin.com/company/x`). */
export function shortKey(value: string): string {
  return value.replace(/^https?:\/\/(www\.)?/i, '');
}

/** Nomi delle chiavi d'identità nei messaggi di conflitto. */
export const KEY_LABELS: Record<CompanyKey, string> = {
  linkedin_url: 'URL LinkedIn',
  domain: 'dominio',
  apollo_org_id: 'id Apollo',
};

/** Chiavi discordanti di un conflitto, per esito e warning (FLOW A.1b: "Apollo indica …, in anagrafica …"). */
function describeConflict(requestedId: number, conflict: CompanyKeyConflict): string {
  if (conflict.reason === 'too_many_companies') {
    return `le chiavi di Apollo corrispondono a ${conflict.company_ids.length} aziende diverse`;
  }
  const parts = conflict.details.map((d) =>
    d.company_id === requestedId
      ? `${KEY_LABELS[d.key]}: Apollo indica ${shortKey(d.input)}, in anagrafica ${shortKey(d.existing)}`
      : `${KEY_LABELS[d.matched_by]} di Apollo già usato da ${d.company_name ?? `azienda #${d.company_id}`} ` +
        `(${KEY_LABELS[d.key]} ${shortKey(d.existing)})`,
  );
  return [...new Set(parts)].join('; ');
}

// ---------------------------------------------------------------------------
// Pianificazione (preview; stato Apollo di un'azienda: `apolloStateOf` in `db/companies.ts`)
// ---------------------------------------------------------------------------

/** Riga dell'elenco nel dialog "Arricchisci le referenze con Apollo". */
export interface EnrichCompaniesPreviewItem {
  company_id: number;
  name: string | null;
  domain: string | null;
  state: CompanyApolloState;
  /** Data dell'ultimo esito Apollo (trovata o no); `null` se mai tentata. */
  apollo_enriched_at: string | null;
  /** L'azienda è nell'ambito del job (1 credito se Apollo la trova). */
  to_enrich: boolean;
  /** Testo pronto: "da arricchire", "arricchita il 10 set", "non trovata il 10 set · da ritentare", … */
  label: string;
}

export interface EnrichCompaniesPreviewCounts {
  [key: string]: number;
  /** Aziende nell'ambito: referenze dell'ICP (o 1 per la singola azienda). */
  references: number;
  with_domain: number;
  to_enrich: number;
  /** Con dominio, tentate senza esito di recente e non ritentate. */
  skipped_fresh: number;
  /** Con dominio e già trovate su Apollo (mai ripagate). */
  enriched: number;
  /** = `to_enrich` (1 credito per organizzazione trovata: tetto). */
  est_credits: number;
}

export interface EnrichCompaniesPreview extends JobPreview {
  counts: EnrichCompaniesPreviewCounts;
  items: EnrichCompaniesPreviewItem[];
}

export interface EnrichCompaniesPlan {
  /** Preview con i blocker che impediscono l'avvio (400 `blocked`); il "job in corso" lo aggiunge la route. */
  preview: EnrichCompaniesPreview;
  /** `params` da congelare all'avvio (`companyIds` = aziende `to_enrich`, nell'ordine dell'elenco). */
  params: EnrichCompaniesParams;
}

export type EnrichCompaniesScope = { icpId: number; companyId?: undefined } | { companyId: number; icpId?: undefined };

export interface PlanEnrichCompaniesOptions {
  retryNotFound?: boolean;
  now?: number;
}

/**
 * `est_cost_usd` di SPEC C5: crediti × `APOLLO_CREDIT_USD`; prezzo non configurato → `null` anche a 0
 * crediti (la UI dice "stima non disponibile": un costo vale solo se il prezzo è noto).
 */
export function estimateApolloCostUsd(credits: number): number | null {
  const price = config.prices.apolloCreditUsd;
  return price === null ? null : Number((credits * price).toFixed(4));
}

function itemLabel(state: CompanyApolloState, c: Pick<Company, 'apollo_enriched_at'>, toEnrich: boolean, now: Date): string {
  const day = formatDay(c.apollo_enriched_at, now);
  switch (state) {
    case 'da_arricchire':
      return 'da arricchire';
    case 'arricchita':
      return `arricchita il ${day}`;
    case 'senza_sito':
      return 'senza sito (ignorata)';
    case 'non_trovata':
      return `non trovata il ${day}${toEnrich ? ' · da ritentare' : ''}`;
    case 'in_conflitto':
      return `chiavi in conflitto il ${day}${toEnrich ? ' · da ritentare' : ''}`;
  }
}

/**
 * Preview dell'arricchimento (SPEC C1/C2/C4): referenze dell'ICP o singola azienda. `undefined` se l'ICP
 * o l'azienda non esistono (404 della route).
 */
export function planEnrichCompanies(
  scope: EnrichCompaniesScope,
  opts: PlanEnrichCompaniesOptions = {},
): EnrichCompaniesPlan | undefined {
  const now = opts.now ?? Date.now();
  const nowDate = new Date(now);
  const retryNotFound = opts.retryNotFound === true;
  let companies: Company[];
  if (scope.icpId !== undefined) {
    if (!getIcp(scope.icpId)) return undefined;
    companies = listReferenceCompanies(scope.icpId).map((r) => r.company);
  } else {
    const company = getCompany(scope.companyId);
    if (!company) return undefined;
    companies = [company];
  }

  const counts: EnrichCompaniesPreviewCounts = {
    references: companies.length,
    with_domain: 0,
    to_enrich: 0,
    skipped_fresh: 0,
    enriched: 0,
    est_credits: 0,
  };
  const items: EnrichCompaniesPreviewItem[] = [];
  const companyIds: number[] = [];
  const withoutDomain: string[] = [];
  const freshSkipped: string[] = [];
  for (const c of companies) {
    const { state, toEnrich, fresh } = apolloStateOf(c, { retryNotFound, now });
    if (c.domain !== null) counts.with_domain += 1;
    if (state === 'arricchita' && c.domain !== null) counts.enriched += 1;
    if (state === 'senza_sito') withoutDomain.push(companyLabel(c));
    if (toEnrich) {
      counts.to_enrich += 1;
      companyIds.push(c.id);
    } else if (fresh) {
      counts.skipped_fresh += 1;
      freshSkipped.push(`${companyLabel(c)} (${itemLabel(state, c, false, nowDate)})`);
    }
    items.push({
      company_id: c.id,
      name: c.name,
      domain: c.domain,
      state,
      apollo_enriched_at: c.apollo_enriched_at,
      to_enrich: toEnrich,
      label: itemLabel(state, c, toEnrich, nowDate),
    });
  }
  counts.est_credits = counts.to_enrich;

  const warnings: string[] = [];
  const blockers = configBlockers();
  if (scope.icpId !== undefined) {
    if (withoutDomain.length === 1) {
      warnings.push(`Referenza senza sito, ignorata: ${withoutDomain[0]}. Aggiungi il sito in Aziende per arricchirla.`);
    } else if (withoutDomain.length > 1) {
      warnings.push(`Referenze senza sito, ignorate: ${names(withoutDomain)}. Aggiungi il sito in Aziende per arricchirle.`);
    }
    if (freshSkipped.length > 0) {
      warnings.push(
        `${freshSkipped.length === 1 ? 'Tentata di recente senza esito, non ritentata' : 'Tentate di recente senza esito, non ritentate'}: ` +
          `${names(freshSkipped)}. Spunta «Ritenta anche le non trovate» per riprovare.`,
      );
    }
    if (counts.to_enrich === 0) blockers.push('Nessuna referenza da arricchire.');
  } else {
    const c = companies[0];
    const { state, toEnrich } = apolloStateOf(c, { retryNotFound, now });
    const day = formatDay(c.apollo_enriched_at, nowDate);
    if (state === 'arricchita') blockers.push(`Già arricchita il ${day}: i dati Apollo non si ricomprano.`);
    else if (state === 'senza_sito') blockers.push("Serve il sito web: aggiungilo in Anagrafica per arricchire l'azienda con Apollo.");
    else if (!toEnrich && state === 'non_trovata') {
      blockers.push(
        `Non trovata su Apollo il ${day}: si ritenta dopo ${config.freshnessDays} giorni, oppure spunta «Ritenta anche le non trovate».`,
      );
    } else if (!toEnrich && state === 'in_conflitto') {
      blockers.push(
        `Chiavi in conflitto con Apollo il ${day}: correggi l'URL LinkedIn o il sito in Anagrafica, oppure spunta «Ritenta anche le non trovate».`,
      );
    }
  }

  const params: EnrichCompaniesParams = {
    companyIds,
    ...(scope.icpId !== undefined ? { icpId: scope.icpId } : {}),
    retryNotFound,
  };
  return {
    preview: { counts, est_cost_usd: estimateApolloCostUsd(counts.est_credits), warnings, blockers, items },
    params,
  };
}

// ---------------------------------------------------------------------------
// Nucleo riusabile: arricchimento di aziende per id (T7c; T7b per le candidate nuove, S-7)
// ---------------------------------------------------------------------------

export interface EnrichCompaniesOptions {
  /** Istante degli esiti in ms (default adesso): `apollo_enriched_at` e confronto con `FRESHNESS_DAYS`. */
  now?: number;
  /** Ritenta anche le aziende tentate senza esito entro `FRESHNESS_DAYS` (default `false`). */
  retryNotFound?: boolean;
}

/**
 * Esito per azienda richiesta:
 * - `enriched`: organizzazione salvata (`apollo_org_id`, `apollo_json`, `apollo_enriched_at`);
 * - `not_found`: nessuna organizzazione per il dominio → marcata `{outcome:'not_found'}`;
 * - `key_conflict`: chiavi Apollo in conflitto → marcata `{outcome:'key_conflict', apollo_keys, conflict}`;
 * - `failed`: lotto in errore o non eseguito dopo un arresto → **nessuna** scrittura, resta da arricchire;
 * - `skipped`: non chiamata (inesistente, già trovata, senza dominio, tentata di recente) o cambiata
 *   durante la chiamata (dominio modificato, già arricchita da altri).
 */
export type EnrichCompanyOutcome = 'enriched' | 'not_found' | 'key_conflict' | 'failed' | 'skipped';

export interface EnrichCompanyResult {
  /** Id passato al nucleo. */
  requestedId: number;
  /**
   * Id dell'azienda dopo le scritture: il superstite se `upsertCompany` ha unito l'azienda richiesta a
   * un'altra (l'id richiesto non esiste più); `null` se l'azienda non esiste.
   */
  companyId: number | null;
  outcome: EnrichCompanyOutcome;
  /** `failed`: messaggio attribuito dell'errore; `skipped`: motivo; `key_conflict`: chiavi discordanti. */
  reason?: string;
}

export interface EnrichCompaniesRun {
  /** Conteggi del contratto (`credits_used` = organizzazioni restituite da Apollo, anche non abbinate). */
  counts: EnrichCompaniesCounts;
  /** Warning sugli esiti dei dati (non trovate, conflitti, organizzazioni non abbinate); gli errori stanno in `errors`/`stoppedBy`. */
  warnings: string[];
  /** Aziende con organizzazione salvata (id superstiti, senza doppioni). */
  enrichedIds: number[];
  /** Un esito per id richiesto (senza doppioni), nell'ordine d'ingresso. */
  results: EnrichCompanyResult[];
  /** Errori del provider dei lotti falliti che non hanno fermato il ciclo (SPEC C7). */
  errors: Error[];
  /**
   * Errore che ha fermato il ciclo: `ApolloConfigError` (401/403, `config:`) o `ApolloRateLimitError` con
   * finestra oraria/giornaliera esaurita. I lotti successivi non sono stati chiamati (`failed`).
   */
  stoppedBy?: Error;
  /** Aziende effettivamente mandate (o da mandare) ad Apollo: esclude le `skipped` iniziali. */
  requested: number;
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

/** Errori che fermano il ciclo: chiave rifiutata/senza permessi o limite orario/giornaliero esaurito. */
function stopsLoop(err: Error): boolean {
  if (err instanceof ApolloConfigError) return true;
  if (err instanceof ApolloRateLimitError) return err.window !== undefined;
  return /^config:/.test(err.message.trim());
}

/** Campi descrittivi da un'organizzazione Apollo (riempiono solo i vuoti, SPEC C3). */
export function organizationFields(org: ApolloOrganization): {
  name: string | null;
  website: string | null;
  industry: string | null;
  size: string | null;
  location: string | null;
} {
  const location = [org.city, org.state, org.country].filter(Boolean).join(', ');
  return {
    name: org.name ?? null,
    website: org.website ?? null,
    industry: org.industry ?? null,
    size: org.employees === undefined ? null : `${org.employees} dipendenti`,
    location: location === '' ? null : location,
  };
}

/** Domini con cui un'organizzazione può corrispondere al dominio richiesto. */
function orgDomains(org: ApolloOrganization): Set<string> {
  const raw = [org.domain, field(org.raw, 'primary_domain'), field(org.raw, 'domain'), field(org.raw, 'website_url'), org.website];
  return new Set(raw.map((v) => normalizeDomain(v)).filter((d): d is string => d !== undefined));
}

/**
 * Abbina le organizzazioni del lotto alle aziende richieste:
 * 1. dominio: `primary_domain` (o `domain`/sito) normalizzato uguale al dominio richiesto;
 * 2. URL LinkedIn dell'organizzazione uguale a quello già in anagrafica;
 * 3. **fallback** quando Apollo riporta un dominio primario diverso da quello chiesto (redirect, rebranding):
 *    se nel lotto restano esattamente una azienda e una organizzazione non abbinate, si abbinano tra loro
 *    (sempre vero nell'arricchimento della singola azienda). Con più residui l'abbinamento è ambiguo: le
 *    organizzazioni restano non abbinate (warning, credito comunque contato) e le aziende "non trovate".
 * L'azienda abbinata tiene il **proprio** dominio: quello primario di Apollo resta in `apollo_json`.
 */
function matchOrganizations(
  companies: Company[],
  orgs: ApolloOrganization[],
): { pairs: Array<[Company, ApolloOrganization]>; unmatched: ApolloOrganization[] } {
  const pairs = new Map<number, ApolloOrganization>();
  let left = [...orgs];
  const pairBy = (matches: (c: Company, org: ApolloOrganization) => boolean) => {
    left = left.filter((org) => {
      const company = companies.find((c) => !pairs.has(c.id) && matches(c, org));
      if (!company) return true;
      pairs.set(company.id, org);
      return false;
    });
  };
  pairBy((c, org) => c.domain !== null && orgDomains(org).has(c.domain));
  pairBy((c, org) => c.linkedin_url !== null && org.linkedinUrl === c.linkedin_url);
  const unpaired = companies.filter((c) => !pairs.has(c.id));
  if (unpaired.length === 1 && left.length === 1) {
    pairs.set(unpaired[0].id, left[0]);
    left = [];
  }
  return {
    pairs: companies.flatMap((c): Array<[Company, ApolloOrganization]> => (pairs.has(c.id) ? [[c, pairs.get(c.id)!]] : [])),
    unmatched: left,
  };
}

/** Marca il tentativo senza organizzazione (non trovata / chiavi in conflitto), mai sopra un'organizzazione già salvata. */
function markAttempt(companyId: number, outcome: Record<string, unknown>, at: string): void {
  db.prepare(
    `UPDATE companies SET apollo_org_id = NULL, apollo_json = ?, apollo_enriched_at = ?, updated_at = ?
     WHERE id = ? AND apollo_org_id IS NULL`,
  ).run(JSON.stringify(outcome), at, nowIso(), companyId);
}

/**
 * Arricchisce con Apollo le aziende indicate (SPEC C3/C7, B6/B7, Regole di unione). Salta (senza chiamare
 * Apollo) quelle inesistenti, già trovate, senza dominio o tentate di recente (salvo `retryNotFound`);
 * divide le altre in lotti da `APOLLO_BULK_MAX` domini; per lotto: `deps.enrichOrganizations` →
 * `mapOrganizations` → abbinamento (vedi `matchOrganizations`) → **una transazione** con `upsertCompany`
 * (dominio dell'azienda richiesta + URL LinkedIn, id, dati grezzi e campi descrittivi di Apollo, questi ultimi
 * solo se vuoti) per le abbinate e la marcatura `not_found` / `key_conflict` per le altre.
 * Un errore del provider su un lotto non ferma gli altri e non marca nulla (le aziende restano da
 * arricchire); `ApolloConfigError` e `ApolloRateLimitError` orario/giornaliero fermano il ciclo
 * (`stoppedBy`). Gli errori di scrittura sul DB non sono del provider: si propagano.
 */
export async function enrichCompanies(
  companyIds: readonly number[],
  deps: Deps,
  opts: EnrichCompaniesOptions = {},
): Promise<EnrichCompaniesRun> {
  const now = opts.now ?? Date.now();
  const at = new Date(now).toISOString();
  const counts: EnrichCompaniesCounts = { enriched: 0, not_found: 0, merged: 0, linkedin_acquired: 0, key_conflicts: 0, credits_used: 0 };
  const results = new Map<number, EnrichCompanyResult>();
  const warnings: string[] = [];
  const errors: Error[] = [];
  const enrichedIds = new Set<number>();
  const notFound: string[] = [];
  const conflicts: string[] = [];
  const unmatchedDomains: string[] = [];
  let stoppedBy: Error | undefined;

  const targets: Company[] = [];
  for (const id of new Set(companyIds)) {
    const company = getCompany(id);
    const skip = (reason: string) => results.set(id, { requestedId: id, companyId: company ? id : null, outcome: 'skipped', reason });
    if (!company) skip('azienda inesistente');
    else if (company.apollo_org_id !== null) skip('già arricchita');
    else if (company.domain === null) skip('senza sito');
    else if (!apolloStateOf(company, { retryNotFound: opts.retryNotFound, now }).toEnrich) skip('tentata di recente senza esito');
    else {
      targets.push(company);
      results.set(id, { requestedId: id, companyId: id, outcome: 'failed', reason: 'non eseguita' });
    }
  }

  /**
   * Azienda riletta nella transazione del lotto; se nel frattempo è sparita, è stata arricchita o ha cambiato
   * dominio → esito `skipped` e `undefined`.
   */
  const recheck = (requested: Company): Company | undefined => {
    const current = getCompany(requested.id);
    if (current && current.apollo_org_id === null && current.domain === requested.domain) return current;
    results.set(requested.id, {
      requestedId: requested.id,
      companyId: current ? current.id : null,
      outcome: 'skipped',
      reason: 'azienda modificata durante la chiamata ad Apollo',
    });
    return undefined;
  };
  const markNotFound = (current: Company) => {
    markAttempt(current.id, { outcome: 'not_found' }, at);
    counts.not_found += 1;
    notFound.push(`${companyLabel(current)} (${current.domain})`);
    results.set(current.id, { requestedId: current.id, companyId: current.id, outcome: 'not_found' });
  };

  for (const batch of chunk(targets, APOLLO_BULK_MAX)) {
    if (stoppedBy) {
      for (const c of batch) results.set(c.id, { requestedId: c.id, companyId: c.id, outcome: 'failed', reason: attributeApolloError(stoppedBy, OP) });
      continue;
    }
    let response: unknown;
    try {
      response = await deps.enrichOrganizations(batch.map((c) => c.domain!));
    } catch (err) {
      const error = toError(err);
      if (stopsLoop(error)) stoppedBy = error;
      else errors.push(error);
      for (const c of batch) results.set(c.id, { requestedId: c.id, companyId: c.id, outcome: 'failed', reason: attributeApolloError(error, OP) });
      continue;
    }

    const { items } = mapOrganizations(response);
    counts.credits_used += items.length;
    const { pairs, unmatched } = matchOrganizations(batch, items);
    for (const org of unmatched) unmatchedDomains.push(org.domain ?? org.name ?? org.apolloId ?? '?');
    const paired = new Set(pairs.map(([c]) => c.id));

    db.transaction(() => {
      for (const [requested, org] of pairs) {
        const current = recheck(requested);
        if (!current) continue;
        const res = upsertCompany({
          domain: current.domain,
          linkedinUrl: org.linkedinUrl,
          ...organizationFields(org),
          apollo: { orgId: org.apolloId ?? null, json: org.raw, enrichedAt: at },
        });
        if (res.keyConflict) {
          const detail = describeConflict(current.id, res.keyConflict);
          markAttempt(
            current.id,
            {
              outcome: 'key_conflict',
              apollo_keys: { domain: org.domain ?? null, linkedin_url: org.linkedinUrl ?? null, apollo_org_id: org.apolloId ?? null },
              conflict: res.keyConflict,
            },
            at,
          );
          counts.key_conflicts += 1;
          conflicts.push(`${companyLabel(current)} — ${detail}`);
          results.set(current.id, { requestedId: current.id, companyId: current.id, outcome: 'key_conflict', reason: detail });
        } else if (res.id === undefined) {
          // Irraggiungibile (il dominio c'è sempre): trattata come non trovata per non lasciarla sospesa.
          markNotFound(current);
        } else {
          counts.enriched += 1;
          counts.merged += res.mergedIds.length;
          if (res.linkedinAcquired) counts.linkedin_acquired += 1;
          enrichedIds.add(res.id);
          results.set(current.id, { requestedId: current.id, companyId: res.id, outcome: 'enriched' });
        }
      }
      for (const requested of batch) {
        if (paired.has(requested.id)) continue;
        const current = recheck(requested);
        if (current) markNotFound(current);
      }
    })();
  }

  if (notFound.length > 0) {
    const one = notFound.length === 1;
    warnings.push(
      `${one ? 'Non trovata' : 'Non trovate'} su Apollo: ${names(notFound)}. ${one ? 'Verifica il sito' : 'Verifica i siti'}: ` +
        `${one ? 'non verrà ritentata' : 'non verranno ritentate'} prima di ${config.freshnessDays} giorni, salvo «Ritenta anche le non trovate».`,
    );
  }
  if (conflicts.length > 0) {
    warnings.push(
      `Chiavi in conflitto con Apollo, nessun dato salvato: ${names(conflicts)}. ` +
        "Correggi l'URL LinkedIn o il sito in Anagrafica (o unisci le aziende), poi ritenta.",
    );
  }
  if (unmatchedDomains.length > 0) {
    const one = unmatchedDomains.length === 1;
    warnings.push(
      `Apollo ha restituito ${unmatchedDomains.length} ${one ? 'organizzazione non riconducibile' : 'organizzazioni non riconducibili'} ` +
        `ai domini richiesti (${names(unmatchedDomains)}): ${one ? 'non salvata' : 'non salvate'}.`,
    );
  }

  return {
    counts,
    warnings,
    enrichedIds: [...enrichedIds],
    results: [...results.values()],
    errors,
    ...(stoppedBy ? { stoppedBy } : {}),
    requested: targets.length,
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/** Esito leggibile (SPEC C6, FLOW A.1b): "1 referenza arricchita · 0 non trovate su Apollo (Delta) · 0 unioni · 1 URL LinkedIn acquisito". */
function summaryOf(run: EnrichCompaniesRun, references: boolean): string {
  const { counts } = run;
  const noun = nounOf(references);
  const namesOf = (outcome: EnrichCompanyOutcome) =>
    run.results
      .filter((r) => r.outcome === outcome && r.companyId !== null)
      .map((r) => {
        const c = getCompany(r.companyId!);
        return c ? companyLabel(c) : `azienda #${r.companyId}`;
      });
  const withNames = (list: string[]) => (list.length > 0 ? ` (${names(list, 5)})` : '');
  const parts = [
    `${counts.enriched} ${noun(counts.enriched)} ${counts.enriched === 1 ? 'arricchita' : 'arricchite'}`,
    `${counts.not_found} ${counts.not_found === 1 ? 'non trovata' : 'non trovate'} su Apollo${withNames(namesOf('not_found'))}`,
    `${counts.merged} ${counts.merged === 1 ? 'unione' : 'unioni'}`,
    `${counts.linkedin_acquired} URL LinkedIn ${counts.linkedin_acquired === 1 ? 'acquisito' : 'acquisiti'}`,
  ];
  if (counts.key_conflicts > 0) parts.push(`${counts.key_conflicts} con chiavi in conflitto${withNames(namesOf('key_conflict'))}`);
  return parts.join(' · ');
}

/**
 * Handler registrato in `HANDLERS.enrich_companies`. Chiave mancante → `config:`. Errore prima di qualunque
 * scrittura → throw (job `failed`, messaggio attribuito `actor:apollo:…` / `config:`); dopo almeno
 * un'azienda salvata (trovata, non trovata o in conflitto) → `succeeded` con warning (esito parziale, SPEC C7).
 */
export const handler: JobHandler<EnrichCompaniesParams, Deps> = async (params, deps): Promise<JobResult> => {
  const blockers = configBlockers(params);
  if (blockers.length > 0) throw new Error(`config: ${blockers.join(' ')}`);
  const companyIds = Array.isArray(params?.companyIds) ? params.companyIds.filter((id) => Number.isInteger(id) && id > 0) : [];
  const references = params?.icpId !== undefined;
  const noun = nounOf(references);

  const run = await enrichCompanies(companyIds, deps, { retryNotFound: params?.retryNotFound === true });
  const { counts } = run;
  const saved = counts.enriched + counts.not_found + counts.key_conflicts;
  const failure = run.stoppedBy ?? run.errors[0];
  if (saved === 0 && failure) {
    const message = attributeApolloError(failure, OP);
    throw new Error(/Nessun dato modificato\.?$/.test(message) ? message : `${message} Nessun dato modificato.`);
  }

  const warnings = [...run.warnings];
  if (run.stoppedBy) {
    const head =
      run.stoppedBy instanceof ApolloRateLimitError ? 'Limite Apollo raggiunto' : `Arricchimento interrotto (${attributeApolloError(run.stoppedBy, OP)})`;
    // Esito onesto (AL-TD-7): `saved` conta anche non trovate e chiavi in conflitto, che non sono
    // arricchimenti; solo quando coincidono si può dire "arricchite N" (testo del FLOW A.1b).
    const done =
      counts.enriched === saved
        ? `arricchite ${saved} ${noun(saved)} su ${run.requested}`
        : `elaborate ${saved} ${noun(saved)} su ${run.requested} (${counts.enriched} ${counts.enriched === 1 ? 'arricchita' : 'arricchite'})`;
    warnings.push(`${head}: ${done}; le altre restano da arricchire.`);
  }
  const failedBatches = new Map<string, number>();
  for (const r of run.results) {
    if (r.outcome !== 'failed' || (run.stoppedBy && r.reason === attributeApolloError(run.stoppedBy, OP))) continue;
    failedBatches.set(r.reason ?? '', (failedBatches.get(r.reason ?? '') ?? 0) + 1);
  }
  for (const [reason, n] of failedBatches) {
    warnings.push(`Errore Apollo (${reason}): ${n} ${noun(n)} ${n === 1 ? 'resta' : 'restano'} da arricchire; rilancia per completare.`);
  }
  const skipped = run.results.filter((r) => r.outcome === 'skipped');
  if (skipped.length > 0) {
    const reasons = [...new Set(skipped.map((r) => r.reason ?? 'motivo ignoto'))].join(', ');
    warnings.push(
      `${skipped.length} ${noun(skipped.length)} ${skipped.length === 1 ? 'saltata' : 'saltate'} (${reasons}): nessun credito speso.`,
    );
  }

  return { summary: summaryOf(run, references), counts: { ...counts }, warnings };
};

/** Deps reali: client Apollo creato alla prima chiamata (nessuna chiamata all'import né in `realDeps()`). */
export function realDeps(): Deps {
  const apollo = lazyApolloClient(() => config.apolloApiKey);
  return {
    enrichOrganizations: (domains) => apollo().post(enrichOrganizationsRequest(domains)),
  };
}
