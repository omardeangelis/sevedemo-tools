/**
 * Regole di somiglianza v1 (SPEC apollo-lookalike, "Regole di somiglianza (v1, deterministiche)").
 * Modulo puro: nessuna I/O, nessuna configurazione. Deriva i filtri della ricerca aziende dalle
 * referenze **arricchite** di un ICP e dall'ICP stesso, e calcola punteggio, componenti e ragioni di una
 * candidata. Le costanti (pesi, numero di parole chiave, fasce di lettura) cambiano solo con una nuova
 * `SCORING_VERSION`: i punteggi già salvati non si ricalcolano (SPEC D14).
 *
 * Scelte di rappresentazione:
 * - le fasce di dipendenti sono etichette `1-10` … `10001+` nell'ordine canonico di Apollo; il formato
 *   della richiesta Apollo (`"1,10"`) lo costruisce `src/apollo/requests.ts`;
 * - `parts` conserva le componenti arrotondate a 3 decimali (`0.333`), mentre `score` è calcolato dalle
 *   componenti **non** arrotondate e poi arrotondato a 2 decimali: ricalcolare da `parts` con gli stessi
 *   pesi può scostarsi al massimo di 0,01 (solo sui casi al limite dell'arrotondamento);
 * - `origins` dice per ogni valore di filtro da dove viene: nomi delle referenze e/o `ICP_ORIGIN`.
 */
import { createHash } from 'node:crypto';

export const SCORING_VERSION = 'v1';

/** Parole chiave tenute dalle referenze (i settori dell'ICP si aggiungono oltre queste). */
export const TOP_KEYWORDS = 10;

/** Pesi delle componenti del punteggio; la somma è 1. */
export const SCORE_WEIGHTS = { keywords: 0.5, size: 0.3, location: 0.2 } as const;

/** Fasce di lettura del punteggio (SPEC D14), in ordine crescente di soglia minima inclusa. */
export const SCORE_BUCKETS = [
  { bucket: 'basso', min: 0 },
  { bucket: 'medio', min: 0.34 },
  { bucket: 'alto', min: 0.67 },
] as const;

export type ScoreBucket = (typeof SCORE_BUCKETS)[number]['bucket'];

/** Fasce fisse di dipendenti di Apollo, in ordine canonico. */
export const APOLLO_EMPLOYEE_RANGES = [
  '1-10',
  '11-20',
  '21-50',
  '51-100',
  '101-200',
  '201-500',
  '501-1000',
  '1001-2000',
  '2001-5000',
  '5001-10000',
  '10001+',
] as const;

export type EmployeeRange = (typeof APOLLO_EMPLOYEE_RANGES)[number];

/** Origine dei valori di filtro che arrivano dall'ICP (le referenze usano il proprio nome). */
export const ICP_ORIGIN = 'ICP';

/**
 * Azienda letta dalle regole: una referenza arricchita o una candidata. Compatibile con l'output di
 * `mapOrganization` e costruibile da una riga `companies` + `apollo_json`. I tag sono `tags` se presenti,
 * altrimenti `keywords` ∪ {`industry`}.
 */
export interface SimilarityCompany {
  name?: string | null;
  tags?: readonly string[] | null;
  keywords?: readonly string[] | null;
  industry?: string | null;
  employees?: number | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
}

/** Campi dell'ICP usati dalle regole (stessi nomi delle colonne di `icps`). */
export interface SimilarityIcp {
  target_industries?: readonly string[] | null;
  company_size?: string | null;
  target_locations?: readonly string[] | null;
}

/** Filtri di una ricerca aziende (etichette di fascia, non il formato della richiesta Apollo). */
export interface SearchFilters {
  keywords: string[];
  ranges: string[];
  locations: string[];
}

/** Per ogni valore di filtro, le origini: nomi delle referenze e/o `ICP_ORIGIN`. */
export interface FilterOrigins {
  keywords: Record<string, string[]>;
  ranges: Record<string, string[]>;
  locations: Record<string, string[]>;
}

export interface DerivedFilters extends SearchFilters {
  origins: FilterOrigins;
  /** Note in italiano per il dialog (es. dimensione dell'ICP non riconoscibile). */
  notes: string[];
}

export interface ScoreParts {
  keywords: number;
  size: number;
  /** `null` = componente esclusa (sede non disponibile). */
  location: number | null;
}

export interface CandidateScore {
  score: number;
  parts: ScoreParts;
  reasons: string[];
}

// --- Normalizzazione ----------------------------------------------------------------------------------

/** Valore testuale confrontabile: minuscolo, spazi ridotti; vuoto o non stringa → `undefined`. */
export function normalizeTag(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
  return t === '' ? undefined : t;
}

function displayText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.trim().replace(/\s+/g, ' ');
  return t === '' ? undefined : t;
}

/** Ordinamento deterministico per unità di codice (indipendente dalla locale del processo). */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function uniqueNormalized(values: Iterable<unknown>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const n = normalizeTag(v);
    if (n === undefined || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Tag di un'azienda senza doppioni: `tags`, oppure `keywords` ∪ {`industry`}. */
function tagsOf(company: SimilarityCompany): string[] {
  if (Array.isArray(company.tags)) return uniqueNormalized(company.tags);
  return uniqueNormalized([...asArray(company.keywords), company.industry]);
}

function nameOf(company: SimilarityCompany, index: number): string {
  return displayText(company.name) ?? `Referenza ${index + 1}`;
}

// --- Fasce di dipendenti -------------------------------------------------------------------------------

/** Estremi di una fascia Apollo: `[min, max]`, `max` nullo per `10001+`. */
export function rangeBounds(range: string): [number, number | null] | undefined {
  const normalized = normalizeRange(range);
  if (!normalized) return undefined;
  const open = /^(\d+)\+$/.exec(normalized);
  if (open) return [Number(open[1]), null];
  const [min, max] = normalized.split('-').map(Number);
  return [min!, max!];
}

/**
 * Etichetta canonica di una fascia: accetta `1-10`, `1 - 10`, il formato Apollo `1,10` e `10001+`/`10001,`.
 * `undefined` se non è una delle fasce fisse di Apollo.
 */
export function normalizeRange(value: unknown): EmployeeRange | undefined {
  if (typeof value !== 'string') return undefined;
  const compact = value.replace(/\s+/g, '').replace(/[–—,]/g, '-').replace(/-$/, '+');
  return (APOLLO_EMPLOYEE_RANGES as readonly string[]).includes(compact) ? (compact as EmployeeRange) : undefined;
}

/** Fascia Apollo che contiene un numero di dipendenti; `undefined` senza dato o per valori < 1. */
export function rangeOf(employees: number | null | undefined): EmployeeRange | undefined {
  if (typeof employees !== 'number' || !Number.isFinite(employees)) return undefined;
  const n = Math.floor(employees);
  if (n < 1) return undefined;
  for (const range of APOLLO_EMPLOYEE_RANGES) {
    const [min, max] = rangeBounds(range)!;
    if (n >= min && (max === null || n <= max)) return range;
  }
  return undefined;
}

/** Fasce immediatamente inferiore e superiore (quelle che esistono), in ordine canonico. */
export function neighbours(range: string): EmployeeRange[] {
  const normalized = normalizeRange(range);
  if (!normalized) return [];
  const i = APOLLO_EMPLOYEE_RANGES.indexOf(normalized);
  return [APOLLO_EMPLOYEE_RANGES[i - 1], APOLLO_EMPLOYEE_RANGES[i + 1]].filter(
    (r): r is EmployeeRange => r !== undefined,
  );
}

/**
 * Intervallo di dipendenti dal testo libero `company_size` dell'ICP: `A-B` (anche con trattino lungo e
 * spazi) → `[A, B]`; `N+` → `[N, null]`. Separatori delle migliaia (`1.000`) e la parola finale
 * "dipendenti"/"employees" sono tollerati. Non riconoscibile → `null`.
 */
export function parseIcpSize(text: string | null | undefined): [number, number | null] | null {
  if (typeof text !== 'string') return null;
  const t = text.trim().toLowerCase().replace(/\s*(dipendenti|employees)$/, '');
  const num = (s: string) => {
    if (!/^\d{1,3}([.,' ]\d{3})*$|^\d+$/.test(s)) return undefined;
    return Number(s.replace(/[.,' ]/g, ''));
  };
  const open = /^(\d[\d.,' ]*?)\s*\+$/.exec(t);
  if (open) {
    const min = num(open[1]!);
    return min === undefined ? null : [min, null];
  }
  const closed = /^(\d[\d.,' ]*?)\s*[-–—]\s*(\d[\d.,' ]*)$/.exec(t);
  if (closed) {
    const min = num(closed[1]!);
    const max = num(closed[2]!);
    if (min === undefined || max === undefined || max < min || max < 1) return null;
    return [min, max];
  }
  return null;
}

// --- Derivazione dei filtri ----------------------------------------------------------------------------

function addOrigin(map: Map<string, string[]>, key: string, origin: string): void {
  const list = map.get(key);
  if (!list) map.set(key, [origin]);
  else if (!list.includes(origin)) list.push(origin);
}

/**
 * Filtri derivati (SPEC, Regole di somiglianza): parole chiave (prime `TOP_KEYWORDS` per frequenza tra
 * le referenze, poi alfabetico; settori dell'ICP in coda se mancanti), fasce (fascia di ogni referenza ±
 * adiacenti, più quelle che intersecano `company_size` dell'ICP) in ordine canonico, località (paesi delle
 * referenze, poi `target_locations` dell'ICP, senza doppioni). Le referenze vanno passate già filtrate
 * alle sole arricchite.
 */
export function deriveFilters(references: readonly SimilarityCompany[], icp: SimilarityIcp | null | undefined): DerivedFilters {
  const notes: string[] = [];

  // Parole chiave: frequenza = numero di referenze che contengono il tag.
  const tagCount = new Map<string, number>();
  const tagOrigins = new Map<string, string[]>();
  references.forEach((ref, i) => {
    for (const tag of tagsOf(ref)) {
      tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1);
      addOrigin(tagOrigins, tag, nameOf(ref, i));
    }
  });
  const keywords = [...tagCount.entries()]
    .sort((a, b) => b[1] - a[1] || compareText(a[0], b[0]))
    .slice(0, TOP_KEYWORDS)
    .map(([tag]) => tag);
  const keywordOrigins = new Map<string, string[]>(keywords.map((k) => [k, [...tagOrigins.get(k)!]]));
  for (const industry of uniqueNormalized(asArray(icp?.target_industries))) {
    if (!keywordOrigins.has(industry)) keywords.push(industry);
    addOrigin(keywordOrigins, industry, ICP_ORIGIN);
  }

  // Fasce di dipendenti.
  const rangeOrigins = new Map<string, string[]>();
  references.forEach((ref, i) => {
    const own = rangeOf(ref.employees);
    if (!own) return;
    for (const r of [own, ...neighbours(own)]) addOrigin(rangeOrigins, r, nameOf(ref, i));
  });
  const sizeText = displayText(icp?.company_size);
  if (sizeText !== undefined) {
    const interval = parseIcpSize(sizeText);
    if (interval) {
      const [icpMin, icpMax] = interval;
      for (const range of APOLLO_EMPLOYEE_RANGES) {
        const [min, max] = rangeBounds(range)!;
        if (min <= (icpMax ?? Infinity) && (max ?? Infinity) >= icpMin) addOrigin(rangeOrigins, range, ICP_ORIGIN);
      }
    } else {
      notes.push(
        `La dimensione dell'ICP "${sizeText}" non è riconoscibile (attesi "A-B" o "N+", es. "10-50" o "50+"): non entra nelle fasce di dipendenti.`,
      );
    }
  }
  const ranges: string[] = APOLLO_EMPLOYEE_RANGES.filter((r) => rangeOrigins.has(r));

  // Località: testo libero, confronto normalizzato, si tiene la prima grafia incontrata.
  const locationOrigins = new Map<string, string[]>();
  const locationByKey = new Map<string, string>();
  const addLocation = (value: unknown, origin: string) => {
    const shown = displayText(value);
    const key = normalizeTag(value);
    if (shown === undefined || key === undefined) return;
    if (!locationByKey.has(key)) locationByKey.set(key, shown);
    addOrigin(locationOrigins, locationByKey.get(key)!, origin);
  };
  references.forEach((ref, i) => addLocation(ref.country, nameOf(ref, i)));
  for (const location of asArray(icp?.target_locations)) addLocation(location, ICP_ORIGIN);
  const locations = [...locationByKey.values()];

  return {
    keywords,
    ranges,
    locations,
    origins: {
      keywords: Object.fromEntries(keywordOrigins),
      ranges: Object.fromEntries(ranges.map((r) => [r, rangeOrigins.get(r)!])),
      locations: Object.fromEntries(locationOrigins),
    },
    notes,
  };
}

// --- Confronto dei filtri (ripartenza, SPEC D6) --------------------------------------------------------

function canonicalFilters(filters: Partial<SearchFilters> | null | undefined) {
  const rawRanges = asArray(filters?.ranges);
  const known = new Set(rawRanges.map(normalizeRange).filter((r): r is EmployeeRange => r !== undefined));
  const unknown = uniqueNormalized(rawRanges.filter((r) => normalizeRange(r) === undefined)).sort(compareText);
  return {
    keywords: uniqueNormalized(asArray(filters?.keywords)).sort(compareText),
    ranges: [...APOLLO_EMPLOYEE_RANGES.filter((r) => known.has(r)), ...unknown],
    locations: uniqueNormalized(asArray(filters?.locations)).sort(compareText),
  };
}

/** Stessi insiemi normalizzati di parole chiave, fasce e località (ordine, maiuscole e doppioni ignorati). */
export function filtersEqual(a: Partial<SearchFilters> | null | undefined, b: Partial<SearchFilters> | null | undefined): boolean {
  return JSON.stringify(canonicalFilters(a)) === JSON.stringify(canonicalFilters(b));
}

/** Impronta stabile (sha256 esadecimale) della forma canonica dei filtri: uguale ⇔ `filtersEqual`. */
export function filtersHash(filters: Partial<SearchFilters> | null | undefined): string {
  return createHash('sha256').update(JSON.stringify(canonicalFilters(filters))).digest('hex');
}

// --- Punteggio -----------------------------------------------------------------------------------------

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * f) / f;
}

/**
 * Punteggio di una candidata (SPEC): 0,5 × parole chiave + 0,3 × dimensione + 0,2 × località, arrotondato
 * a 2 decimali. Località senza dato (candidata senza città né regione, o nessuna referenza con città o
 * regione) → componente `null`, esclusa, e somma pesata divisa per la somma dei pesi disponibili.
 * Ragioni: una per componente non nulla e non zero, più "località non disponibile da Apollo" se esclusa.
 */
export function scoreCandidate(
  candidate: SimilarityCompany,
  filters: Partial<SearchFilters> | null | undefined,
  references: readonly SimilarityCompany[],
): CandidateScore {
  const reasons: string[] = [];

  // Parole chiave.
  const filterKeywords = uniqueNormalized(asArray(filters?.keywords));
  const candidateTags = new Set(tagsOf(candidate));
  const common = filterKeywords.filter((k) => candidateTags.has(k));
  const keywords = filterKeywords.length > 0 && candidateTags.size > 0 ? common.length / filterKeywords.length : 0;
  if (common.length === 1) reasons.push(`1 parola chiave in comune: ${common[0]}`);
  else if (common.length > 1) reasons.push(`${common.length} parole chiave in comune: ${common.join(', ')}`);

  // Dimensione.
  const candidateRange = rangeOf(candidate.employees);
  let size = 0;
  if (candidateRange) {
    const adjacent = neighbours(candidateRange);
    const same: string[] = [];
    const near: string[] = [];
    references.forEach((ref, i) => {
      const r = rangeOf(ref.employees);
      if (r === candidateRange) same.push(nameOf(ref, i));
      else if (r && adjacent.includes(r)) near.push(nameOf(ref, i));
    });
    if (same.length > 0) {
      size = 1;
      reasons.push(`stessa fascia di dipendenti di ${same.join(', ')} (${candidateRange})`);
    } else if (near.length > 0) {
      size = 0.5;
      reasons.push(`fascia vicina a ${near.join(', ')}`);
    }
  }

  // Località.
  const city = normalizeTag(candidate.city);
  const state = normalizeTag(candidate.state);
  const referencesHaveLocation = references.some((ref) => normalizeTag(ref.city) || normalizeTag(ref.state));
  let location: number | null;
  if ((!city && !state) || !referencesHaveLocation) {
    location = null;
    reasons.push('località non disponibile da Apollo');
  } else {
    const sameCity = city ? references.flatMap((ref, i) => (normalizeTag(ref.city) === city ? [nameOf(ref, i)] : [])) : [];
    const sameState = state ? references.flatMap((ref, i) => (normalizeTag(ref.state) === state ? [nameOf(ref, i)] : [])) : [];
    if (sameCity.length > 0) {
      location = 1;
      reasons.push(`stessa città di ${sameCity.join(', ')} (${displayText(candidate.city)})`);
    } else if (sameState.length > 0) {
      location = 0.5;
      reasons.push(`stessa regione di ${sameState.join(', ')} (${displayText(candidate.state)})`);
    } else {
      location = 0;
    }
  }

  let weighted = SCORE_WEIGHTS.keywords * keywords + SCORE_WEIGHTS.size * size;
  let weights = SCORE_WEIGHTS.keywords + SCORE_WEIGHTS.size;
  if (location !== null) {
    weighted += SCORE_WEIGHTS.location * location;
    weights += SCORE_WEIGHTS.location;
  }

  return {
    score: round(weighted / weights, 2),
    parts: { keywords: round(keywords, 3), size, location },
    reasons,
  };
}

/** Fascia di lettura di un punteggio: basso < 0,34 ≤ medio < 0,67 ≤ alto. */
export function bucketOf(score: number): ScoreBucket {
  for (let i = SCORE_BUCKETS.length - 1; i > 0; i--) {
    if (score >= SCORE_BUCKETS[i]!.min - 1e-9) return SCORE_BUCKETS[i]!.bucket;
  }
  return 'basso';
}
