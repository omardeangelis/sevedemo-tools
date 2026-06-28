/**
 * Espansione-azienda: dalle aziende taggate nei post (`CompanyRef`) ai loro
 * decision-maker, via people-search `harvestapi` (lo stesso actor già validato dalle
 * strategie people-search). Una stessa azienda taggata in più post si espande **una
 * volta sola** (dedup per `companyUrn`, fallback nome).
 */
import { runActor } from '../apify/client.js';
import { ACTORS, profileSearchInput } from '../apify/actors.js';
import { mapProfileItem } from './people-search.js';
import type { CompanyRef } from './post-extract.js';
import type { RawCandidate } from './types.js';

/** Firma iniettabile della people-search (per i test, senza toccare Apify). */
export type PeopleSearch = (query: string, location: string, maxItems: number) => Promise<any[]>;

const defaultSearch: PeopleSearch = async (query, location, maxItems) => {
  const { items } = await runActor(ACTORS.profileSearch, profileSearchInput(query, location, maxItems));
  return items;
};

export interface CompanyExpansionOpts {
  /** Ruoli decisionali da cercare per azienda (es. CEO, CTO, Founder, HR…). */
  roles: string[];
  /** Cap di candidati per singola azienda (cumulativo su tutti i ruoli). */
  perCompany: number;
  location?: string;
  /** People-search iniettabile; default = harvest via `runActor`. */
  search?: PeopleSearch;
}

/** Chiave di dedup azienda: `companyUrn` se presente, altrimenti il nome normalizzato. */
function companyKey(c: CompanyRef): string {
  return c.companyUrn ? `urn:${c.companyUrn}` : `name:${(c.name ?? '').trim().toLowerCase()}`;
}

/**
 * Espande le aziende a candidati `company-expansion`. Dedup aziende cross-post, cap
 * per azienda, dedup candidati per URL. Errori di una singola ricerca non fanno
 * fallire l'intero modulo: la ricerca che lancia contribuisce 0.
 */
export async function expandCompanies(
  companies: CompanyRef[],
  opts: CompanyExpansionOpts,
): Promise<RawCandidate[]> {
  const search = opts.search ?? defaultSearch;
  const location = opts.location ?? 'Italy';
  const out: RawCandidate[] = [];
  const seenUrl = new Set<string>();
  const seenCompany = new Set<string>();

  for (const company of companies) {
    const key = companyKey(company);
    if (seenCompany.has(key)) continue;
    seenCompany.add(key);
    if (!company.name) continue;

    let perCompanyCount = 0;
    for (const role of opts.roles) {
      if (perCompanyCount >= opts.perCompany) break;
      const query = `${role} ${company.name}`;
      let items: any[] = [];
      try {
        items = await search(query, location, opts.perCompany);
      } catch {
        items = [];
      }
      for (const it of items) {
        if (perCompanyCount >= opts.perCompany) break;
        const mapped = mapProfileItem(it);
        if (!mapped || seenUrl.has(mapped.linkedinUrl)) continue;
        seenUrl.add(mapped.linkedinUrl);
        out.push({ ...mapped, sourceDetail: 'company-expansion' });
        perCompanyCount++;
      }
    }
  }
  return out;
}
