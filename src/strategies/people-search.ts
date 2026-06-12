import { runActor } from '../apify/client.js';
import { ACTORS, profileSearchInput } from '../apify/actors.js';
import { field, normalizeLinkedinUrl } from '../util/fields.js';
import { kvGet, kvSet } from '../db/kv.js';
import { loadQueries } from './seeds.js';
import type { RawCandidate, Strategy } from './types.js';

/**
 * harvestapi/linkedin-profile-search fattura a pagina di ricerca ($0.10/pagina, fino a
 * 25 profili) — chiedere meno di una pagina intera per query costa quanto chiederla tutta.
 */
export const SEARCH_PAGE_SIZE = 25;

/**
 * Piano di acquisto page-aligned: usa il minimo numero di query sufficiente a coprire
 * `limit` e assegna a ciascuna un numero intero di pagine (in totale esattamente
 * ceil(limit / 25) pagine). Ritorna le pagine da chiedere a ciascuna query usata.
 */
export function planSearchPages(limit: number, queryCount: number): number[] {
  const pagesNeeded = Math.max(1, Math.ceil(limit / SEARCH_PAGE_SIZE));
  const queriesUsed = Math.max(1, Math.min(queryCount, pagesNeeded));
  const base = Math.floor(pagesNeeded / queriesUsed);
  const extra = pagesNeeded % queriesUsed;
  return Array.from({ length: queriesUsed }, (_, i) => base + (i < extra ? 1 : 0));
}

export function mapProfileItem(item: any): RawCandidate | null {
  const url = normalizeLinkedinUrl(
    field(item, 'linkedinUrl', 'profileUrl', 'url', 'publicProfileUrl', 'profileLink'),
  );
  if (!url) return null;

  // harvestapi non espone fullName/headline: nome da firstName+lastName,
  // headline ricostruita dalla posizione corrente ("<title> @ <company>").
  const composedName = [field(item, 'firstName'), field(item, 'lastName')].filter(Boolean).join(' ');
  const position = Array.isArray(item?.currentPositions) ? item.currentPositions[0] : undefined;
  const positionHeadline = [field(position, 'title'), field(position, 'companyName')]
    .filter(Boolean)
    .join(' @ ');

  return {
    linkedinUrl: url,
    fullName: field(item, 'fullName', 'name', 'displayName') ?? (composedName || undefined),
    headline: field(item, 'headline', 'subtitle', 'occupation', 'title') ?? (positionHeadline || undefined),
    raw: item,
  };
}

/**
 * Factory per una strategia di people-search no-cookie basata su un file di query.
 * Usa solo le query necessarie a coprire il `limit` (a pagine intere, vedi
 * `planSearchPages`) e ruota il punto di partenza nel file tra un run e l'altro,
 * così nei giorni successivi si pescano query (e profili) diversi. Le query oltre
 * il piano fanno da riserva: vengono chiamate (una pagina ciascuna) solo se le
 * precedenti hanno reso meno del previsto. Deduplica per URL.
 */
export function makePeopleSearchStrategy(opts: {
  id: string;
  description: string;
  queriesFile: string;
  bucketHint: Strategy['bucketHint'];
}): Strategy {
  return {
    id: opts.id,
    description: opts.description,
    requiresCookie: false,
    bucketHint: opts.bucketHint,
    async source(limit: number): Promise<RawCandidate[]> {
      const queries = loadQueries(opts.queriesFile);
      const pages = planSearchPages(limit, queries.length);

      const cursorKey = `query-cursor:${opts.queriesFile}`;
      const cursor = Number.parseInt(kvGet(cursorKey) ?? '0', 10) || 0;

      const out: RawCandidate[] = [];
      const seen = new Set<string>();
      let used = 0;

      for (let i = 0; i < queries.length; i++) {
        if (out.length >= limit) break;
        const q = queries[(cursor + i) % queries.length];
        const maxItems = (pages[i] ?? 1) * SEARCH_PAGE_SIZE;
        const input = profileSearchInput(q.query, q.location ?? 'Italy', maxItems);
        const { items } = await runActor(ACTORS.profileSearch, input);
        used++;
        for (const it of items) {
          const c = mapProfileItem(it);
          if (!c || seen.has(c.linkedinUrl)) continue;
          seen.add(c.linkedinUrl);
          out.push(c);
          if (out.length >= limit) break;
        }
      }

      kvSet(cursorKey, String((cursor + used) % queries.length));
      return out;
    },
  };
}
