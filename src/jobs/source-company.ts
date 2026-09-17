import { mapEmployees } from '../acquisition/mappers/employees.js';
import { ACTORS, companyEmployeesInput } from '../apify/actors.js';
import { runActor } from '../apify/client.js';
import { config, type EmployeesMode } from '../config.js';
import { getCompany } from '../db/companies.js';
import { getIcp, type Icp } from '../db/icps.js';
import { nowIso } from '../db/index.js';
import { addMembers, getList } from '../db/lists.js';
import { addSource, upsertProspect } from '../db/prospects.js';
import { cleanList, field } from '../util/fields.js';
import type { JobHandler, JobResult } from './types.js';

/*
 * Job `source_company` (crm-foundation T9): URL company → dipendenti filtrati per i ruoli
 * dell'ICP → prospect direttamente nella lista scelta (P2), stato `nuovo`. Registrato in
 * `HANDLERS` da `handlers.ts` (non si tocca); preview e avvio in `server/routes/companies.ts`.
 */

/** Parametri salvati sul job (`jobs.params`). Assenti = default di ICP della lista / config. */
export interface SourceCompanyParams {
  companyId: number;
  listId: number;
  /** Ruoli (job title) da cercare; assente = `target_roles` dell'ICP della lista. */
  roles?: string[];
  /** Località; assente = `target_locations` dell'ICP della lista. */
  locations?: string[];
  /** Tetto di persone lette; assente = `EMPLOYEES_PER_COMPANY`. */
  maxItems?: number;
  /** Modalità dell'actor; assente = `EMPLOYEES_MODE`. */
  mode?: EmployeesMode;
}

/** Filtri effettivi passati a `fetchEmployees`. */
export interface EmployeeFilters {
  jobTitles: string[];
  locations: string[];
  maxItems: number;
  mode: EmployeesMode;
}

/** Dipendenze iniettabili del job (I/O esterno). */
export type Deps = {
  /** Item grezzi dell'actor dei dipendenti per un'azienda (URL normalizzato). */
  fetchEmployees: (companyUrl: string, filters: EmployeeFilters) => Promise<unknown[]>;
};

/** Start fee di harvestapi per ogni run, oltre al prezzo per profilo (scoperta in T7, non in PLAN §5). */
export const EMPLOYEES_RUN_START_USD = 0.02;

/** Tetto dell'actor per `maxItems` (0 = tutti non è ammesso: la spesa deve essere limitata). */
export const EMPLOYEES_MAX_ITEMS = 2500;

/** Stima in USD di una run: `maxItems/1000 × tariffa della modalità + start fee`. */
export function estimateSourcingCostUsd(maxItems: number, mode: EmployeesMode): number {
  const usd = (maxItems / 1000) * config.prices.employeesPer1000Usd[mode] + EMPLOYEES_RUN_START_USD;
  return Math.round(usd * 10_000) / 10_000;
}

/** Filtri effettivi: ruoli/località passati, altrimenti quelli dell'ICP; tetto e modalità dalla config. */
export function resolveFilters(params: Omit<SourceCompanyParams, 'companyId' | 'listId'>, icp: Icp | undefined): EmployeeFilters {
  return {
    jobTitles: params.roles !== undefined ? cleanList(params.roles) : (icp?.target_roles ?? []),
    locations: params.locations !== undefined ? cleanList(params.locations) : (icp?.target_locations ?? []),
    maxItems: params.maxItems ?? config.employeesPerCompany,
    mode: params.mode ?? config.employeesMode,
  };
}

/**
 * `raw_json` di un prospect marcato arricchito dal sourcing: stessa busta dell'enrichment
 * profile-detail (`{source, experience, education, certifications}`), così chi legge il profilo
 * (analisi T11) trova le esperienze nello stesso punto qualunque sia la provenienza.
 */
function enrichmentRaw(item: unknown) {
  return {
    source: item,
    experience: field(item, 'experience', 'experiences'),
    education: field(item, 'education'),
    certifications: field(item, 'certifications'),
  };
}

/** Errore di configurazione (azienda/lista mancante, lista archiviata): prefisso `config:`. */
function configError(message: string): Error {
  return new Error(`config: ${message}`);
}

/** Testo del blocco "lista archiviata" (preview e job). */
export function archivedListText(listName: string): string {
  return `La lista '${listName}' è archiviata: riattivala per aggiungere persone.`;
}

/** Blocker del sourcing su un'azienda senza URL LinkedIn (SPEC B14; stesso testo dell'errore `config:` del job). */
export const NO_LINKEDIN_BLOCKER = 'Azienda senza pagina LinkedIn: recuperala prima (Anagrafica → URL LinkedIn).';

/**
 * Blocker di configurazione del sourcing, dai `params` (preview, avvio e "Riprova" via registry
 * `CONFIG_BLOCKERS`, apollo-lookalike T6): azienda sparita o senza pagina LinkedIn, token Apify
 * mancante, lista assente/inesistente/archiviata. Il "job in corso" non è qui: lo aggiunge la preview.
 */
export function configBlockers(params: Pick<SourceCompanyParams, 'companyId'> & { listId?: number }): string[] {
  const blockers: string[] = [];
  const company = getCompany(params.companyId);
  if (!company) blockers.push('Azienda non trovata.');
  else if (!company.linkedin_url) blockers.push(NO_LINKEDIN_BLOCKER);
  if (!config.apifyToken.trim()) blockers.push('APIFY_TOKEN mancante nel .env — nessun job avviato.');
  if (params.listId === undefined) blockers.push('Scegli la lista di destinazione.');
  else {
    const list = getList(params.listId);
    if (!list) blockers.push('La lista di destinazione non esiste.');
    else if (list.archived_at) blockers.push(archivedListText(list.name));
  }
  return blockers;
}

/**
 * Fallimento dell'actor → `actor:<id>: <messaggio>` (senza il prefisso ridondante di `runActor`).
 * Un messaggio già attribuito (`actor:`/`config:`/`process:`, es. token mancante o deps fake) resta.
 */
function actorError(err: unknown): Error {
  const message = (err instanceof Error ? err.message : String(err)).trim();
  if (/^(actor|config|process):/.test(message)) return new Error(message);
  const detail = message.replace(/^Actor "[^"]*" fallito:\s*/, '') || 'errore sconosciuto';
  return new Error(`actor:${ACTORS.companyEmployees}: ${detail}`);
}

/** `n persona letta` / `n persone lette`. */
function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Esito leggibile (FLOW D.3): conteggi se l'actor ha letto qualcuno, altrimenti "zero neutro"
 * con i filtri usati e il suggerimento per allargarli.
 */
function summarize(
  companyName: string,
  listName: string,
  filters: EmployeeFilters,
  counts: Record<string, number>,
  addedExisting: number,
): string {
  if (counts.fetched === 0) {
    const roles = filters.jobTitles.length ? ` con ruoli ${filters.jobTitles.join(', ')}` : '';
    const hint =
      filters.jobTitles.length && filters.locations.length
        ? ' Amplia i ruoli o togli la località.'
        : filters.jobTitles.length
          ? ' Amplia i ruoli.'
          : filters.locations.length
            ? ' Togli la località.'
            : '';
    return `Nessuna persona trovata in ${companyName}${roles}.${hint}`;
  }
  const parts = [`Sourcing ${companyName} completato: ${plural(counts.fetched, 'persona letta', 'persone lette')}`];
  parts.push(
    counts.added_to_list
      ? `${plural(counts.added_to_list, 'aggiunta', 'aggiunte')} a '${listName}' (${plural(counts.prospects_new, 'nuova', 'nuove')}, ${addedExisting} già in archivio)`
      : `nessuna aggiunta a '${listName}'`,
  );
  if (counts.already_in_list) parts.push(`${counts.already_in_list} già in lista`);
  if (counts.marked_enriched) parts.push(`${plural(counts.marked_enriched, 'arricchita', 'arricchite')} dal profilo completo`);
  if (counts.prospects_merged) parts.push(plural(counts.prospects_merged, 'duplicato unito', 'duplicati uniti'));
  if (counts.skipped_no_url) parts.push(`${counts.skipped_no_url} senza profilo pubblico`);
  return `${parts.join(' · ')}.`;
}

/**
 * Esegue il sourcing: risolve azienda e lista, legge i dipendenti, per ogni candidato
 * upsert del prospect (con id membro: niente aggancio per nome, il sourcing porta entrambe le
 * chiavi), fonte `company_employees` e membership della lista (idempotenti: rilanciare non duplica).
 */
export async function sourceCompany(params: SourceCompanyParams, deps: Deps): Promise<JobResult> {
  const company = getCompany(params.companyId);
  if (!company) throw configError(`Azienda inesistente (id ${params.companyId}).`);
  // Aziende a doppia chiave (apollo-lookalike): senza URL LinkedIn non c'è nulla da estrarre.
  const companyUrl = company.linkedin_url;
  if (!companyUrl) throw configError(NO_LINKEDIN_BLOCKER);
  const list = getList(params.listId);
  if (!list) throw configError(`Lista inesistente (id ${params.listId}).`);
  if (list.archived_at) throw configError(archivedListText(list.name));
  const filters = resolveFilters(params, getIcp(list.icp_id));

  let items: unknown[];
  try {
    items = await deps.fetchEmployees(companyUrl, filters);
  } catch (err) {
    throw actorError(err);
  }
  const { candidates, skipped } = mapEmployees(items);

  const counts = {
    fetched: Array.isArray(items) ? items.length : 0,
    prospects_new: 0,
    prospects_seen: 0,
    prospects_merged: 0,
    added_to_list: 0,
    already_in_list: 0,
    marked_enriched: 0,
    skipped_no_url: skipped,
  };
  let addedExisting = 0;
  // Full / Full+email: dati comprati più ricchi di quelli salvati → vincono (`refresh`).
  const fullProfile = filters.mode !== 'Short';

  for (const candidate of candidates) {
    // P10: profilo completo con bio o esperienze = già arricchito (non si ripaga profile-detail).
    const enriched = fullProfile && Boolean(candidate.about || candidate.experience?.length);
    const now = nowIso();
    const { id, created, mergedIds } = upsertProspect(
      {
        linkedinUrl: candidate.linkedinUrl,
        memberUrn: candidate.memberUrn,
        fullName: candidate.fullName,
        headline: candidate.headline,
        about: candidate.about,
        location: candidate.location,
        email: candidate.email,
        companyId: company.id,
        companyName: candidate.companyName ?? company.name,
        title: candidate.title,
        ...(enriched ? { raw: enrichmentRaw(candidate.raw), enrichedAt: now, enrichmentAttemptedAt: now } : {}),
      },
      { refresh: fullProfile },
    );
    counts[created ? 'prospects_new' : 'prospects_seen'] += 1;
    counts.prospects_merged += mergedIds.length;
    if (enriched) counts.marked_enriched += 1;
    addSource(id, { kind: 'company_employees', companyId: company.id, raw: candidate.raw });
    const { added, skipped: already } = addMembers(list.id, [id]);
    counts.added_to_list += added;
    counts.already_in_list += already;
    if (added && !created) addedExisting += 1;
  }

  const summary = summarize(company.name ?? companyUrl, list.name, filters, counts, addedExisting);
  return { summary, counts, warnings: [] };
}

/** Handler registrato in `HANDLERS.source_company`. */
export const handler: JobHandler<SourceCompanyParams, Deps> = (params, deps) => sourceCompany(params, deps);

/** Deps reali: una run di `harvestapi/linkedin-company-employees` per azienda. */
export function realDeps(): Deps {
  return {
    fetchEmployees: async (companyUrl, { jobTitles, locations, maxItems, mode }) => {
      // Token mancante = configurazione, non un fallimento dell'actor (la preview lo blocca prima).
      if (!config.apifyToken.trim()) throw configError('APIFY_TOKEN mancante nel .env.');
      const { items } = await runActor(
        ACTORS.companyEmployees,
        companyEmployeesInput([companyUrl], { jobTitles, locations, maxItems, mode }),
      );
      return items;
    },
  };
}
