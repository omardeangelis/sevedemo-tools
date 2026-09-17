import { ApolloConfigError, ApolloRateLimitError, createApolloClient, type ApolloClient } from '../apollo/client.js';
import { mapPeople, mapPerson, type ApolloPerson } from '../apollo/mappers/people.js';
import {
  APOLLO_BULK_MAX,
  chunk,
  matchPeopleRequest,
  searchPeopleRequest,
  type PeopleMatchDetail,
  type PeopleSearchParams,
} from '../apollo/requests.js';
import { APOLLO_KEY_BLOCKER, config } from '../config.js';
import { lastContactsByCompany } from '../db/candidates.js';
import { getCompany, type Company } from '../db/companies.js';
import { getIcp } from '../db/icps.js';
import { db, nowIso } from '../db/index.js';
import { addMembers, getList, type ListView } from '../db/lists.js';
import { addSource, upsertProspect } from '../db/prospects.js';
import { cleanList, field, hasEmail } from '../util/fields.js';
import { archivedListText } from './source-company.js';
import type { ApolloPeopleCounts, ApolloPeopleParams, ContactsOptions, JobHandler, JobPreview, JobResult } from './types.js';

/*
 * Job `apollo_people` — trova contatti nelle aziende scelte (apollo-lookalike SPEC F, S-6; PLAN T8):
 * una ricerca gratuita per azienda (`mixed_people/api_search`, niente URL LinkedIn) + `people/bulk_match`
 * per id delle persone trovate (lotti da 10, 1 credito a persona rivelata). Solo chi arriva con l'URL
 * LinkedIn diventa prospect (identità invariata); il match porta anche l'email di lavoro.
 * Preview (`planContacts`) e avvio stanno in `server/routes/contacts.ts`; la pipeline `autoContacts`
 * (T9) chiama `runApolloPeople` con le proprie deps. Contratto `params`/`result.counts`: `types.ts`.
 */

export type { ApolloPeopleCounts, ApolloPeopleParams } from './types.js';

/** Dipendenze iniettabili del job (convenzione Apollo in `types.ts`: JSON grezzo, mapper nell'handler). */
export type Deps = {
  /**
   * `POST mixed_people/api_search` per UNA azienda (`searchPeopleRequest`, P-6): risposta grezza da
   * leggere con `mapPeople` (id, nome, titolo: niente URL LinkedIn). 0 crediti; 403 → `config:`.
   */
  searchPeople: (params: PeopleSearchParams) => Promise<unknown>;
  /**
   * `POST people/bulk_match` per al massimo 10 persone (`matchPeopleRequest`, per id): risposta grezza
   * con `matches[]` nell'ordine dei dettagli (anche ripetuti o `null`) e `credits_consumed`.
   */
  matchPeople: (details: PeopleMatchDetail[]) => Promise<unknown>;
};

/** Tetto di persone per azienda accettato (SPEC F1). */
export const APOLLO_PEOPLE_PER_COMPANY_MAX = 100;
/** Aziende al massimo per avvio (stesso cap della tabella candidate, P-17). */
export const CONTACTS_COMPANIES_MAX = 500;

/** Alias di `APOLLO_KEY_BLOCKER` (`config.ts`) per gli import esistenti in `tests/jobs.test.ts`. */
export const APOLLO_KEY_MISSING_TEXT = APOLLO_KEY_BLOCKER;

// ---------------------------------------------------------------------------
// Testi e formati
// ---------------------------------------------------------------------------

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

const ROME = 'Europe/Rome';
const DAY = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', timeZone: ROME });
const DAY_YEAR = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', year: 'numeric', timeZone: ROME });
const YEAR = new Intl.DateTimeFormat('it-IT', { year: 'numeric', timeZone: ROME });

/** "16 set" (con l'anno se non è quello corrente), come nelle date brevi della UI. */
export function shortDateText(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return (YEAR.format(date) === YEAR.format(new Date()) ? DAY : DAY_YEAR).format(date);
}

/** Nome leggibile di un'azienda (il nome può mancare nelle aziende a doppia chiave). */
function companyLabel(company: Company): string {
  return company.name ?? company.domain ?? company.linkedin_url ?? `Azienda ${company.id}`;
}

/** Elenco di nomi con al massimo `max` voci e "(+N)". */
function namesText(names: string[], max = 5): string {
  const shown = names.slice(0, max).join(', ');
  return names.length > max ? `${shown} (+${names.length - max})` : shown;
}

/** Etichette delle seniority Apollo (FLOW C.2). */
const SENIORITY_LABELS: Record<string, string> = {
  owner: 'Owner',
  founder: 'Founder',
  c_suite: 'C-suite',
  vp: 'VP',
  head: 'Head',
  director: 'Director',
  manager: 'Manager',
  senior: 'Senior',
  entry: 'Entry',
};

// ---------------------------------------------------------------------------
// Blocker, stima e piano (preview)
// ---------------------------------------------------------------------------

/** Blocker della lista di destinazione (SPEC F3): mancante, inesistente, di un altro ICP, archiviata. */
export function listBlockers(icpId: number, listId: number | undefined): string[] {
  if (listId === undefined) return ['Scegli una lista di destinazione.'];
  const list = getList(listId);
  if (!list) return ['La lista di destinazione non esiste.'];
  if (list.icp_id !== icpId) {
    const icpName = getIcp(icpId)?.name;
    return [`La lista '${list.name}' non è dell'ICP${icpName ? ` '${icpName}'` : ''}: scegli una lista di questo ICP.`];
  }
  if (list.archived_at) return [archivedListText(list.name)];
  return [];
}

function keyBlockers(): string[] {
  return config.apolloApiKey.trim() === '' ? [APOLLO_KEY_BLOCKER] : [];
}

/**
 * Blocker di configurazione del kind (registry `CONFIG_BLOCKERS`, usato anche da "Riprova" con T6):
 * chiave Apollo mancante, lista mancante/archiviata/di un altro ICP. Stessi testi della preview.
 */
export function configBlockers(params: ApolloPeopleParams): string[] {
  return [...keyBlockers(), ...listBlockers(params.icpId, params.listId)];
}

export interface ContactsEstimate {
  /** Aziende con dominio + ⌈aziende × tetto / 10⌉ match (tetto, SPEC F2). */
  requests: number;
  /** Aziende con dominio × tetto: 1 credito per persona rivelata (tetto). */
  est_credits: number;
  /** `est_credits × APOLLO_CREDIT_USD`, `null` senza prezzo (C5). */
  est_cost_usd: number | null;
}

/** Stima del passo contatti per `companiesWithDomain` aziende (usata anche dalla pipeline, SPEC H1). */
export function contactsEstimate(companiesWithDomain: number, perCompany: number): ContactsEstimate {
  const est_credits = companiesWithDomain * perCompany;
  const requests = companiesWithDomain + Math.ceil(est_credits / APOLLO_BULK_MAX);
  const price = config.prices.apolloCreditUsd;
  const est_cost_usd = price === null ? null : Math.round(est_credits * price * 10_000) / 10_000;
  return { requests, est_credits, est_cost_usd };
}

/** Input della preview/avvio: i campi assenti prendono i default (ICP della lista, config). */
export interface ContactsInput {
  companyIds: readonly number[];
  listId?: number;
  /** Assente = `target_roles` dell'ICP; `[]` = nessun ruolo (warning). */
  roles?: readonly string[];
  /** Assente o `[]` = nessun filtro. Valori validati dalla route (`APOLLO_SENIORITIES`). */
  seniorities?: readonly string[];
  /** Assente = `target_locations` dell'ICP; `[]` = ovunque. */
  locations?: readonly string[];
  /** Assente = `APOLLO_PEOPLE_PER_COMPANY`. */
  perCompany?: number;
}

/**
 * Opzioni del passo contatti con i default risolti (SPEC F1): ruoli e località dall'ICP se assenti,
 * seniority vuote = nessun filtro, tetto da `APOLLO_PEOPLE_PER_COMPANY`. Usata dalla preview e dalla
 * pipeline `autoContacts` (T9), che poi verifica la lista con `listBlockers`. `listId` è ripreso così com'è.
 */
export function resolveContactsOptions(
  icpId: number,
  input: Omit<ContactsInput, 'companyIds'>,
): Omit<ContactsOptions, 'listId'> & { listId: number | undefined } {
  const icp = getIcp(icpId);
  return {
    listId: input.listId,
    roles: input.roles !== undefined ? cleanList(input.roles) : (icp?.target_roles ?? []),
    seniorities: cleanList(input.seniorities ?? []),
    locations: input.locations !== undefined ? cleanList(input.locations) : (icp?.target_locations ?? []),
    perCompany: input.perCompany ?? config.apolloPeoplePerCompany,
  };
}

export interface ContactsPlan {
  /** Preview uniforme **senza** il blocker "job in corso" (lo aggiunge la route). */
  preview: JobPreview;
  /** Blocker che impediscono l'avvio (400 `blocked`): tutti quelli della preview tranne il job in corso. */
  startBlockers: string[];
  /** `params` da congelare sul job; `null` se c'è un blocker. */
  params: ApolloPeopleParams | null;
}

interface ResolvedCompanies {
  /** Aziende esistenti, senza doppioni, nell'ordine richiesto. */
  found: Company[];
  withDomain: Company[];
  withoutDomain: Company[];
  /** Id che non esistono più (unite o eliminate). */
  missing: number[];
}

function resolveCompanies(ids: readonly number[]): ResolvedCompanies {
  const out: ResolvedCompanies = { found: [], withDomain: [], withoutDomain: [], missing: [] };
  for (const id of new Set(ids)) {
    const company = getCompany(id);
    if (!company) {
      out.missing.push(id);
      continue;
    }
    out.found.push(company);
    (company.domain ? out.withDomain : out.withoutDomain).push(company);
  }
  return out;
}

function missingCompaniesText(n: number): string {
  return n === 1
    ? '1 azienda selezionata non esiste più (unita o eliminata): esclusa.'
    : `${n} aziende selezionate non esistono più (unite o eliminate): escluse.`;
}

function noRolesText(icpHasRoles: boolean, perCompany: number): string {
  const anyone = `verranno prese le prime ${perCompany} persone qualunque per azienda.`;
  return icpHasRoles ? `Nessun ruolo indicato: ${anyone}` : `L'ICP non ha ruoli target: ${anyone}`;
}

/**
 * Preview di "Trova contatti" (SPEC F1–F3, FLOW C.2) e `params` risolti da salvare sul job: ruoli e
 * località di default dall'ICP, tetto dalla config. `counts` = {companies, with_domain, without_domain,
 * per_company, requests, est_credits}.
 */
export function planContacts(icpId: number, input: ContactsInput): ContactsPlan {
  const icp = getIcp(icpId);
  const { roles, locations, seniorities, perCompany } = resolveContactsOptions(icpId, input);
  const companies = resolveCompanies(input.companyIds);
  const estimate = contactsEstimate(companies.withDomain.length, perCompany);

  const listProblems = icp ? listBlockers(icpId, input.listId) : ['ICP inesistente.'];
  const blockers = [...keyBlockers()];
  if (companies.found.length === 0) blockers.push('Nessuna azienda selezionata.');
  else if (companies.withDomain.length === 0) blockers.push('Nessuna delle aziende selezionate ha un sito: Apollo cerca per dominio.');
  blockers.push(...listProblems);

  const warnings: string[] = [];
  if (companies.missing.length > 0) warnings.push(missingCompaniesText(companies.missing.length));
  if (companies.withDomain.length > 0 && companies.withoutDomain.length > 0) {
    const names = namesText(companies.withoutDomain.map(companyLabel));
    warnings.push(
      companies.withoutDomain.length === 1
        ? `${names} è senza sito: esclusa (Apollo cerca per dominio).`
        : `${names} sono senza sito: escluse (Apollo cerca per dominio).`,
    );
  }
  if (roles.length === 0) warnings.push(noRolesText((icp?.target_roles.length ?? 0) > 0, perCompany));
  if (input.listId !== undefined && listProblems.length === 0 && companies.withDomain.length > 0) {
    const searched = lastContactsByCompany(
      companies.withDomain.map((c) => c.id),
      input.listId,
    );
    if (searched.size > 0) {
      const listName = getList(input.listId)?.name ?? '';
      const latest = [...searched.values()].sort().at(-1)!;
      const who =
        companies.withDomain.length === 1
          ? `${companyLabel(companies.withDomain[0])} già cercata`
          : `${searched.size} di ${companies.withDomain.length} aziende già cercate`;
      warnings.push(
        `${who} per '${listName}' il ${shortDateText(latest)}: le persone già in lista non si duplicano, ma il match si ripaga.`,
      );
    }
  }
  if (estimate.requests > config.apolloRateLimitPerMinute) {
    warnings.push(
      `Fino a ${estimate.requests} richieste Apollo, oltre il limite di ${config.apolloRateLimitPerMinute} al minuto: ` +
        'il job rispetterà il limite e durerà più a lungo, e si ferma con esito parziale se Apollo limita.',
    );
  }

  return {
    preview: {
      counts: {
        companies: companies.found.length,
        with_domain: companies.withDomain.length,
        without_domain: companies.withoutDomain.length,
        per_company: perCompany,
        requests: estimate.requests,
        est_credits: estimate.est_credits,
      },
      est_cost_usd: estimate.est_cost_usd,
      warnings,
      blockers,
    },
    startBlockers: blockers,
    params:
      blockers.length === 0 && input.listId !== undefined
        ? {
            icpId,
            companyIds: [...new Set(input.companyIds)],
            listId: input.listId,
            roles,
            seniorities,
            locations,
            perCompany,
          }
        : null,
  };
}

// ---------------------------------------------------------------------------
// Esecuzione
// ---------------------------------------------------------------------------

/** Esito di `runApolloPeople`: `counts` con tutte le chiavi, anche negli esiti parziali. */
export interface ApolloPeopleOutcome extends JobResult {
  counts: ApolloPeopleCounts & Record<string, number>;
  warnings: string[];
}

export interface ApolloPeopleContext {
  /** Riga di avanzamento (stdout del job); assente = silenzio. */
  log?: (line: string) => void;
}

function zeroCounts(): ApolloPeopleCounts & Record<string, number> {
  return {
    people_read: 0,
    people_matched: 0,
    companies_done: 0,
    companies: 0,
    without_domain: 0,
    added: 0,
    prospects_new: 0,
    prospects_seen: 0,
    already_in_list: 0,
    skipped_no_url: 0,
    apollo_id_taken: 0,
    with_email: 0,
    credits_used: 0,
    requests: 0,
  };
}

/** Conteggi di scrittura di un'azienda, sommati al totale solo a transazione chiusa. */
interface WriteTally {
  added: number;
  addedExisting: number;
  prospects_new: number;
  prospects_seen: number;
  already_in_list: number;
  skipped_no_url: number;
  apollo_id_taken: number;
  with_email: number;
}

const ATTRIBUTED_RE = /^(actor|config|process):/;

function messageOf(err: unknown): string {
  const message = (err instanceof Error ? err.message : String(err)).trim() || 'errore sconosciuto';
  return ATTRIBUTED_RE.test(message) ? message : `process: ${message}`;
}

function withTail(message: string, tail: string): string {
  return `${message}${/[.!?)]$/.test(message) ? ' ' : '. '}${tail}`;
}

/**
 * Errore con cui `runApolloPeople` fa fallire il passo contatti dopo aver iniziato a chiamare Apollo
 * (AL-TD-5): `message` è attribuito (`actor:`/`config:`/`process:` in testa) e dichiara i crediti già
 * spesi; `counts` sono i conteggi parziali fino all'errore (letti dalla pipeline T9); `detail` è il
 * messaggio attribuito dell'errore d'origine, senza code.
 */
export class ApolloPeopleError extends Error {
  readonly counts: ApolloPeopleCounts & Record<string, number>;
  readonly detail: string;
  constructor(message: string, counts: ApolloPeopleCounts & Record<string, number>, detail: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'ApolloPeopleError';
    this.counts = counts;
    this.detail = detail;
  }
}

/**
 * Ricerca + match di UNA azienda, poi le scritture in UNA transazione. Se un match fallisce dopo che
 * altri lotti della stessa azienda sono stati rivelati (e pagati), le persone già rivelate si salvano
 * comunque (stessa transazione) e l'errore risale: l'azienda non conta come completata.
 */
async function processCompany(
  company: Company & { domain: string },
  params: ApolloPeopleParams,
  list: ListView,
  deps: Deps,
  counts: ApolloPeopleCounts,
): Promise<{ addedExisting: number }> {
  counts.requests += 1;
  const searchRaw = await deps.searchPeople({
    domain: company.domain,
    titles: params.roles,
    seniorities: params.seniorities,
    locations: params.locations,
    perPage: params.perCompany,
  });
  const mapped = mapPeople(searchRaw);
  // Il tetto protegge i crediti anche se Apollo restituisse più di `per_page` persone.
  const found = [...mapped.withoutUrl, ...mapped.candidates].slice(0, params.perCompany);
  counts.people_read += found.length;

  const details: PeopleMatchDetail[] = found.map((p) => (p.apolloId ? { id: p.apolloId } : { linkedin_url: p.linkedinUrl! }));
  const revealed: ApolloPerson[] = [];
  const seen = new Set<string>();
  let matchError: unknown;
  for (const batch of details.length > 0 ? chunk(details, APOLLO_BULK_MAX) : []) {
    let raw: unknown;
    counts.requests += 1;
    try {
      raw = await deps.matchPeople(batch);
    } catch (err) {
      matchError = err;
      break;
    }
    // `matches[]` segue l'ordine dei dettagli e può ripetere una persona o contenere `null`: si allinea
    // per posizione e si tiene la prima occorrenza di ogni persona (id Apollo o URL).
    const matches = field(raw, 'matches');
    const items: unknown[] = Array.isArray(matches) ? matches : [];
    let fresh = 0;
    for (let j = 0; j < batch.length; j++) {
      const person = mapPerson(items[j]);
      if (!person) continue;
      const keys = [person.apolloId && `id:${person.apolloId}`, person.linkedinUrl && `url:${person.linkedinUrl}`].filter(
        (k): k is string => Boolean(k),
      );
      if (keys.some((k) => seen.has(k))) continue;
      keys.forEach((k) => seen.add(k));
      revealed.push(person);
      fresh += 1;
    }
    const consumed = field(raw, 'credits_consumed');
    counts.credits_used += typeof consumed === 'number' && Number.isFinite(consumed) && consumed >= 0 ? consumed : fresh;
  }
  counts.people_matched += revealed.length;

  const tally: WriteTally = {
    added: 0,
    addedExisting: 0,
    prospects_new: 0,
    prospects_seen: 0,
    already_in_list: 0,
    skipped_no_url: 0,
    apollo_id_taken: 0,
    with_email: 0,
  };
  if (revealed.length > 0) {
    db.transaction(() => {
      const now = nowIso();
      const markMatched = db.prepare('UPDATE prospects SET apollo_matched_at = ? WHERE id = ? RETURNING email').pluck();
      for (const person of revealed) {
        // F8: nessun prospect senza URL LinkedIn.
        if (!person.linkedinUrl) {
          tally.skipped_no_url += 1;
          continue;
        }
        // Backfill (default di `upsertProspect`): titolo, azienda, email e sede solo se mancanti (F5);
        // `company_id` solo se il prospect non ne ha già una. L'id Apollo non risolve mai l'identità (F6).
        const { id, created, apolloIdTaken } = upsertProspect({
          linkedinUrl: person.linkedinUrl,
          memberUrn: person.memberUrn,
          fullName: person.fullName,
          title: person.title,
          location: person.location,
          email: person.email,
          companyId: company.id,
          companyName: company.name ?? person.companyName,
          apolloPersonId: person.apolloId,
        });
        if (apolloIdTaken) tally.apollo_id_taken += 1;
        // G6/F5: Apollo ha risposto per questo prospect → l'arricchimento Apollo non lo ripaga.
        const email = markMatched.get(now, id) as string | null | undefined;
        if (hasEmail(email)) tally.with_email += 1;
        addSource(id, { kind: 'apollo_people', companyId: company.id, raw: person.raw }, { refreshCapturedAt: true });
        const membership = addMembers(list.id, [id]);
        tally[created ? 'prospects_new' : 'prospects_seen'] += 1;
        if (membership.added > 0) {
          tally.added += 1;
          if (!created) tally.addedExisting += 1;
        } else {
          tally.already_in_list += 1;
        }
      }
    })();
  }
  const { addedExisting, ...rest } = tally;
  for (const [key, value] of Object.entries(rest) as Array<[keyof typeof rest, number]>) counts[key] += value;
  if (matchError !== undefined) throw matchError;
  return { addedExisting };
}

function filtersText(params: ApolloPeopleParams): string {
  const parts: string[] = [];
  if (params.roles.length > 0) parts.push(`ruoli ${params.roles.join(', ')}`);
  if (params.seniorities.length > 0) parts.push(`seniority ${params.seniorities.map((s) => SENIORITY_LABELS[s] ?? s).join(', ')}`);
  if (params.locations.length > 0) parts.push(`località ${params.locations.join(', ')}`);
  return parts.length > 0 ? ` con ${parts.join(' · ')}` : ' senza filtri';
}

function widenHint(params: ApolloPeopleParams): string {
  const hints: string[] = [];
  if (params.roles.length > 0) hints.push('amplia i ruoli');
  const sen = params.seniorities.length > 0;
  const loc = params.locations.length > 0;
  if (sen || loc) hints.push(`togli ${sen && loc ? 'seniority e località' : sen ? 'la seniority' : 'la località'}`);
  if (hints.length === 0) return ' Apollo non ha persone per questi siti.';
  const text = hints.join(' o ');
  return ` ${text[0].toUpperCase()}${text.slice(1)}.`;
}

function excludedText(counts: ApolloPeopleCounts): string | undefined {
  return counts.without_domain > 0
    ? plural(counts.without_domain, 'azienda senza sito esclusa', 'aziende senza sito escluse')
    : undefined;
}

/** Esito leggibile (SPEC F10, FLOW C.3): successo, zero neutro con i filtri usati, parziale. */
function summarize(
  params: ApolloPeopleParams,
  counts: ApolloPeopleCounts,
  listName: string,
  info: { withDomain: number; addedExisting: number; partial: boolean },
): string {
  const excluded = excludedText(counts);
  if (info.withDomain === 0) {
    return `Contatti Apollo: nessuna azienda con sito da cercare${excluded ? ` (${excluded})` : ''}. Nessuna richiesta fatta.`;
  }
  if (counts.people_read === 0 && !info.partial) {
    const where = plural(counts.companies_done, 'azienda', 'aziende');
    return `Nessuna persona trovata in ${where}${filtersText(params)}.${widenHint(params)}${excluded ? ` ${excluded[0].toUpperCase()}${excluded.slice(1)}.` : ''}`;
  }
  const where = info.partial
    ? `${counts.companies_done} ${counts.companies_done === 1 ? 'azienda' : 'aziende'} su ${info.withDomain}`
    : plural(counts.companies_done, 'azienda', 'aziende');
  const parts = [`Contatti Apollo${info.partial ? ' (esito parziale)' : ''}: ${plural(counts.people_read, 'persona letta', 'persone lette')} in ${where}`];
  if (counts.people_read > 0 && counts.people_matched === 0) parts.push('nessuna persona rivelata dal match');
  parts.push(
    counts.added > 0
      ? `${plural(counts.added, 'aggiunta', 'aggiunte')} a '${listName}' (${plural(counts.added - info.addedExisting, 'nuova', 'nuove')}, ${info.addedExisting} già in archivio)`
      : `nessuna aggiunta a '${listName}'`,
  );
  if (counts.already_in_list > 0) parts.push(`${counts.already_in_list} già in lista`);
  if (counts.skipped_no_url > 0) {
    parts.push(`${counts.skipped_no_url} senza profilo LinkedIn (${counts.skipped_no_url === 1 ? 'saltata' : 'saltate'})`);
  }
  if (counts.apollo_id_taken > 0) parts.push(`${counts.apollo_id_taken} con id Apollo già assegnato`);
  if (counts.people_matched > 0) parts.push(`${counts.with_email} con email`);
  parts.push(plural(counts.credits_used, 'credito usato', 'crediti usati'));
  if (excluded) parts.push(excluded);
  return `${parts.join(' · ')}.`;
}

/** Warning dell'esito parziale (S-4, FLOW "Rate limit — C / E"): arresto dopo ≥ 1 azienda completata. */
function partialWarning(err: unknown, counts: ApolloPeopleCounts, withDomain: number, listName: string): string {
  const done = `${counts.companies_done === 1 ? 'completata' : 'completate'} ${counts.companies_done} ${counts.companies_done === 1 ? 'azienda' : 'aziende'} su ${withDomain}`;
  const added = counts.added > 0 ? `${plural(counts.added, 'aggiunta', 'aggiunte')} a '${listName}'` : `nessuna aggiunta a '${listName}'`;
  if (err instanceof ApolloRateLimitError) {
    return `Limite Apollo raggiunto: ${done} · ${added}. Rilancia sulle stesse aziende: chi è già in lista non si duplica.`;
  }
  return withTail(
    `${messageOf(err).replace(/[.\s]+$/, '')} · ${done} · ${added}`,
    "I dati salvati fino all'errore restano validi: rilancia sulle stesse aziende, chi è già in lista non si duplica.",
  );
}

/**
 * Esegue il passo contatti (SPEC F4–F10) ed è riusato dalla pipeline (T9) sugli id delle candidate
 * create. Verifica chiave e lista **prima** di qualunque chiamata (`config:`). Errori: `ApolloConfigError`
 * o qualunque errore prima della prima azienda completata → lancia `ApolloPeopleError` (job fallito,
 * messaggio attribuito con i crediti già usati, conteggi parziali); dopo ≥ 1 azienda completata (limite,
 * provider) → esito parziale con warning.
 */
export async function runApolloPeople(
  params: ApolloPeopleParams,
  deps: Deps,
  ctx: ApolloPeopleContext = {},
): Promise<ApolloPeopleOutcome> {
  const blockers = configBlockers(params);
  if (blockers.length > 0) throw new Error(`config: ${blockers.join(' ')}`);
  const list = getList(params.listId)!;

  const companies = resolveCompanies(params.companyIds);
  const counts = zeroCounts();
  counts.companies = companies.found.length;
  counts.without_domain = companies.withoutDomain.length;
  const warnings: string[] = [];
  if (companies.missing.length > 0) warnings.push(missingCompaniesText(companies.missing.length));

  let addedExisting = 0;
  let vanished = 0;
  let failure: { err: unknown } | undefined;
  for (const selected of companies.withDomain) {
    // Un'unione manuale durante il job può far sparire l'azienda (o toglierle il dominio): si rilegge.
    const company = getCompany(selected.id);
    if (!company?.domain) {
      vanished += 1;
      continue;
    }
    try {
      const done = await processCompany(company as Company & { domain: string }, params, list, deps, counts);
      addedExisting += done.addedExisting;
      counts.companies_done += 1;
      ctx.log?.(`apollo_people: ${companyLabel(company)} completata (${counts.companies_done}/${companies.withDomain.length})`);
    } catch (err) {
      failure = { err };
      break;
    }
  }

  if (vanished > 0) {
    warnings.push(
      vanished === 1
        ? "1 azienda è stata unita, eliminata o ha perso il sito durante il job: saltata."
        : `${vanished} aziende sono state unite, eliminate o hanno perso il sito durante il job: saltate.`,
    );
  }
  if (failure) {
    const { err } = failure;
    if (err instanceof ApolloConfigError || counts.companies_done === 0) {
      // Esito onesto (AL-TD-5): i lotti di match già pagati restano nel messaggio e nei conteggi dell'errore.
      const detail = messageOf(err);
      const wrote = counts.prospects_new + counts.prospects_seen > 0;
      const tails = [wrote ? "I dati salvati fino all'errore restano validi." : 'Nessun dato modificato.'];
      if (counts.credits_used > 0) tails.unshift(`${plural(counts.credits_used, 'credito usato', 'crediti usati')}.`);
      throw new ApolloPeopleError(withTail(detail, tails.join(' ')), counts, detail, err);
    }
    warnings.push(partialWarning(err, counts, companies.withDomain.length, list.name));
  }
  if (counts.people_matched > 0 && counts.skipped_no_url * 2 > counts.people_matched) {
    warnings.push('Molte persone senza profilo LinkedIn: valuta ruoli più specifici.');
  }

  const summary = summarize(params, counts, list.name, {
    withDomain: companies.withDomain.length,
    addedExisting,
    partial: failure !== undefined,
  });
  return { summary, counts, warnings };
}

/** Handler registrato in `HANDLERS.apollo_people`. */
export const handler: JobHandler<ApolloPeopleParams, Deps> = (params, deps) => runApolloPeople(params, deps);

/** Deps reali: client Apollo creato alla prima chiamata (nessuna chiamata all'import né in `realDeps()`). */
export function realDeps(): Deps {
  let client: ApolloClient | undefined;
  const apollo = () => (client ??= createApolloClient({ apiKey: config.apolloApiKey }));
  return {
    searchPeople: (params) => apollo().post(searchPeopleRequest(params)),
    matchPeople: (details) => apollo().post(matchPeopleRequest(details)),
  };
}
