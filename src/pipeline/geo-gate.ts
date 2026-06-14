/**
 * Gate geografico Italia (spec: italy-geo-gate).
 *
 * Scarta i profili LinkedIn fuori dall'Italia il prima possibile lungo il funnel:
 * un pre-gate conservativo (legge la località dal payload grezzo di people-search,
 * scarta solo su evidenza positiva di estero) e un post-gate strict (legge la
 * colonna `contacts.location` valorizzata dall'enrichment, tiene solo l'Italia).
 *
 * Le funzioni `classifyLocation`/`locationFromRaw`/`applyGeoGate` sono pure e totali
 * (non lanciano mai); i runner `runGeoGatePre/Post` sono best-effort (fail-open).
 */

import { field } from '../util/fields.js';
import { markRejectedGeo, type ContactRow } from '../db/contacts.js';

/** Normalizza una stringa in ` token token ` (lowercase, split su non-lettere/cifre,
 *  bordi a spazio) così il match è per parola/frase intera, accenti inclusi. */
function tokenize(s: string): string {
  const inner = s
    .toLowerCase()
    .normalize('NFC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .join(' ');
  return ` ${inner} `;
}

/** Paesi del mondo (nomi comuni EN) + varianti/abbreviazioni + nomi IT dei più
 *  frequenti. Lista deliberatamente completa: la località di people-search è spesso
 *  il solo paese (es. "Cyprus"); un paese non in lista cadrebbe in `unknown` e
 *  sfuggirebbe al pre-gate. ESCLUDE Italia, San Marino e Città del Vaticano (enclavi
 *  trattate come Italia, vedi D8). */
const FOREIGN_COUNTRIES = [
  'afghanistan', 'albania', 'algeria', 'andorra', 'angola', 'antigua and barbuda', 'argentina',
  'armenia', 'australia', 'austria', 'azerbaijan', 'bahamas', 'bahrain', 'bangladesh', 'barbados',
  'belarus', 'belgium', 'belize', 'benin', 'bhutan', 'bolivia', 'bosnia and herzegovina', 'bosnia',
  'botswana', 'brazil', 'brunei', 'bulgaria', 'burkina faso', 'burundi', 'cabo verde', 'cape verde',
  'cambodia', 'cameroon', 'canada', 'central african republic', 'chad', 'chile', 'china', 'colombia',
  'comoros', 'congo', 'democratic republic of the congo', 'costa rica', 'croatia', 'cuba', 'cyprus',
  'czechia', 'czech republic', 'denmark', 'djibouti', 'dominica', 'dominican republic', 'ecuador',
  'egypt', 'el salvador', 'equatorial guinea', 'eritrea', 'estonia', 'eswatini', 'swaziland',
  'ethiopia', 'fiji', 'finland', 'france', 'gabon', 'gambia', 'georgia', 'germany', 'ghana', 'greece',
  'grenada', 'guatemala', 'guinea', 'guinea-bissau', 'guyana', 'haiti', 'honduras', 'hungary',
  'iceland', 'india', 'indonesia', 'iran', 'iraq', 'ireland', 'israel', 'ivory coast', "cote d'ivoire",
  'jamaica', 'japan', 'jordan', 'kazakhstan', 'kenya', 'kiribati', 'kosovo', 'kuwait', 'kyrgyzstan',
  'laos', 'latvia', 'lebanon', 'lesotho', 'liberia', 'libya', 'liechtenstein', 'lithuania',
  'luxembourg', 'madagascar', 'malawi', 'malaysia', 'maldives', 'mali', 'malta', 'marshall islands',
  'mauritania', 'mauritius', 'mexico', 'micronesia', 'moldova', 'monaco', 'mongolia', 'montenegro',
  'morocco', 'mozambique', 'myanmar', 'burma', 'namibia', 'nauru', 'nepal', 'netherlands', 'holland',
  'new zealand', 'nicaragua', 'niger', 'nigeria', 'north korea', 'north macedonia', 'macedonia',
  'norway', 'oman', 'pakistan', 'palau', 'palestine', 'panama', 'papua new guinea', 'paraguay', 'peru',
  'philippines', 'poland', 'portugal', 'qatar', 'romania', 'russia', 'russian federation', 'rwanda',
  'saint kitts and nevis', 'saint lucia', 'saint vincent and the grenadines', 'samoa',
  'sao tome and principe', 'saudi arabia', 'senegal', 'serbia', 'seychelles', 'sierra leone',
  'singapore', 'slovakia', 'slovenia', 'solomon islands', 'somalia', 'south africa', 'south korea',
  'korea', 'south sudan', 'spain', 'sri lanka', 'sudan', 'suriname', 'sweden', 'switzerland', 'syria',
  'taiwan', 'tajikistan', 'tanzania', 'thailand', 'timor-leste', 'east timor', 'togo', 'tonga',
  'trinidad and tobago', 'tunisia', 'turkey', 'turkiye', 'turkmenistan', 'tuvalu', 'uganda', 'ukraine',
  'united arab emirates', 'united kingdom', 'great britain', 'britain', 'england', 'scotland', 'wales',
  'northern ireland', 'united states', 'united states of america', 'uruguay', 'uzbekistan', 'vanuatu',
  'venezuela', 'vietnam', 'yemen', 'zambia', 'zimbabwe',
  // Abbreviazioni
  'usa', 'u.s.a.', 'us', 'u.s.', 'uk', 'u.k.', 'uae', 'u.a.e.', 'drc',
  // Nomi IT dei paesi più frequenti nelle località
  'francia', 'germania', 'spagna', 'svizzera', 'regno unito', 'stati uniti', 'inghilterra', 'cipro',
  'grecia', 'paesi bassi', 'olanda', 'belgio', 'croazia', 'slovenia', 'austria', 'polonia',
  'portogallo', 'irlanda', 'danimarca', 'svezia', 'norvegia', 'finlandia', 'ungheria', 'turchia',
  'romania', 'serbia', 'spagna', 'malta',
].map(tokenize);

/** Token che identificano l'Italia a livello di paese, incluse le enclavi italofone
 *  San Marino e Città del Vaticano (decisione D8). */
const ITALY_COUNTRY = [
  'italy', 'italia', 'italie', 'italien', 'repubblica italiana',
  'san marino', 'repubblica di san marino',
  'vatican', 'vatican city', 'vaticano', 'città del vaticano', 'citta del vaticano',
  'holy see', 'santa sede',
].map(tokenize);

/** Regioni e città italiane (forma IT ed EN) per riconoscere località che riportano
 *  solo la città/regione senza il paese. */
const ITALY_PLACES = [
  // Regioni
  'lombardia', 'lombardy', 'lazio', 'veneto', 'piemonte', 'piedmont', 'toscana', 'tuscany',
  'sicilia', 'sicily', 'sardegna', 'sardinia', 'campania', 'puglia', 'apulia', 'calabria', 'liguria',
  'marche', 'abruzzo', 'umbria', 'emilia-romagna', 'emilia romagna', 'trentino', 'trentino-alto adige',
  'alto adige', 'friuli', 'friuli venezia giulia', 'molise', 'basilicata', "valle d'aosta", "val d'aosta",
  // Città principali
  'milano', 'milan', 'roma', 'rome', 'torino', 'turin', 'napoli', 'naples', 'genova', 'genoa',
  'palermo', 'bologna', 'firenze', 'florence', 'venezia', 'venice', 'bari', 'catania', 'verona',
  'messina', 'padova', 'padua', 'trieste', 'brescia', 'taranto', 'prato', 'parma', 'modena',
  'reggio emilia', 'reggio calabria', 'perugia', 'livorno', 'ravenna', 'cagliari', 'rimini', 'salerno',
  'ferrara', 'sassari', 'latina', 'monza', 'siracusa', 'pescara', 'bergamo', 'vicenza', 'trento',
  'bolzano', 'novara', 'piacenza', 'ancona', 'arezzo', 'udine', 'cesena', 'lecce', 'pesaro', 'como',
  'varese', 'lucca', 'pisa', 'siena', 'treviso', 'pavia', 'cremona', 'mantova',
].map(tokenize);

/** Città estere maggiori senza paese esplicito (ultimo segnale prima di `unknown`). */
const FOREIGN_CITIES = [
  'london', 'paris', 'madrid', 'berlin', 'amsterdam', 'rotterdam', 'dublin', 'lisbon', 'lisboa',
  'barcelona', 'valencia', 'munich', 'münchen', 'frankfurt', 'hamburg', 'cologne', 'zurich', 'zürich',
  'geneva', 'basel', 'bern', 'lyon', 'marseille', 'brussels', 'antwerp', 'vienna', 'wien', 'warsaw',
  'krakow', 'prague', 'budapest', 'bucharest', 'athens', 'thessaloniki', 'istanbul', 'ankara',
  'moscow', 'saint petersburg', 'kyiv', 'kiev', 'dubai', 'abu dhabi', 'doha', 'riyadh', 'tel aviv',
  'cairo', 'casablanca', 'new york', 'brooklyn', 'manhattan', 'san francisco', 'los angeles', 'chicago',
  'boston', 'seattle', 'austin', 'miami', 'washington', 'toronto', 'vancouver', 'montreal',
  'mexico city', 'sao paulo', 'buenos aires', 'bogota', 'lima', 'santiago', 'sydney', 'melbourne',
  'brisbane', 'perth', 'auckland', 'singapore', 'hong kong', 'shanghai', 'beijing', 'shenzhen',
  'tokyo', 'osaka', 'seoul', 'mumbai', 'delhi', 'new delhi', 'bangalore', 'bengaluru', 'hyderabad',
  'chennai', 'pune', 'jakarta', 'bangkok', 'manila', 'kuala lumpur', 'ho chi minh', 'hanoi', 'lagos',
  'nairobi', 'johannesburg', 'cape town', 'accra',
].map(tokenize);

function matchesAny(haystack: string, tokens: string[]): boolean {
  for (const t of tokens) {
    if (haystack.includes(t)) return true;
  }
  return false;
}

/**
 * Classifica una stringa di località come `italy` | `foreign` | `unknown`.
 *
 * Procedura ordinata (l'ordine conta):
 *   1. paese estero presente → `foreign` (domina: cattura "San Marino, California, United States");
 *   2. token-paese Italia, incluse le enclavi San Marino e Città del Vaticano (D8) → `italy`;
 *   3. regione/città italiana → `italy`;
 *   4. città estera maggiore → `foreign`;
 *   5. altrimenti → `unknown`.
 *
 * Funzione totale e case-insensitive, match per parola/frase intera (non substring nudo:
 * "india" non matcha dentro "indiana").
 */
export function classifyLocation(loc: string | null | undefined): 'italy' | 'foreign' | 'unknown' {
  if (typeof loc !== 'string') return 'unknown';
  const h = tokenize(loc);
  if (h.trim() === '') return 'unknown';

  if (matchesAny(h, FOREIGN_COUNTRIES)) return 'foreign';
  if (matchesAny(h, ITALY_COUNTRY)) return 'italy';
  if (matchesAny(h, ITALY_PLACES)) return 'italy';
  if (matchesAny(h, FOREIGN_CITIES)) return 'foreign';
  return 'unknown';
}

/**
 * Estrae una stringa di località dal payload grezzo di harvestapi profile-search, in
 * modo tollerante. Ordine di precedenza:
 *   `location.linkedinText` → `location` (stringa) → `location.parsed.text` →
 *   `geoLocation` → `addressWithCountry` → `addressWithoutCountry`.
 *
 * Ritorna `undefined` se nessun campo è presente o se il valore è vuoto. Funzione
 * totale (mai throw; input non-oggetto → `undefined`).
 *
 * NB: mira solo all'item della *people-search*. Dopo l'enrichment `updateEnrichment`
 * sovrascrive `raw_json` col payload dev_fusion (`{ experience, source }`), dove la
 * località vive sotto `source` — forma deliberatamente NON inseguita qui (la fonte
 * autoritativa post-enrichment è la colonna `contacts.location`, letta dal post-gate).
 */
export function locationFromRaw(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const rec = raw as Record<string, unknown>;
  const loc = rec.location;

  if (typeof loc === 'string') {
    if (loc.trim() !== '') return loc;
  } else if (loc && typeof loc === 'object') {
    const linkedinText = field(loc, 'linkedinText');
    if (typeof linkedinText === 'string') return linkedinText;
    const parsedText = field(field(loc, 'parsed'), 'text');
    if (typeof parsedText === 'string') return parsedText;
  }

  const fallback = field(rec, 'geoLocation', 'addressWithCountry', 'addressWithoutCountry');
  return typeof fallback === 'string' ? fallback : undefined;
}

/**
 * Partiziona righe in `{ kept, rejected }` secondo le due policy del gate (pura, no DB/I/O):
 *  - `mode='pre'` (pre-enrichment, conservativo): località = `locationFromRaw(JSON.parse(raw_json))`
 *    in try/catch (`raw_json` NULL o non-JSON → `unknown`, NON scartato); scarta solo `'foreign'`.
 *  - `mode='post'` (post-enrichment, strict): località = `classifyLocation(row.location)`; tiene solo
 *    `'italy'` (`'foreign'` ed `'unknown'` scartati).
 * L'ordine delle righe è preservato.
 */
export function applyGeoGate(
  rows: ContactRow[],
  mode: 'pre' | 'post',
): { kept: ContactRow[]; rejected: ContactRow[] } {
  const kept: ContactRow[] = [];
  const rejected: ContactRow[] = [];

  for (const r of rows) {
    if (mode === 'pre') {
      let parsed: unknown;
      try {
        parsed = r.raw_json ? JSON.parse(r.raw_json) : undefined;
      } catch {
        parsed = undefined;
      }
      // Conservativo: scarta solo con evidenza positiva di estero; italy/unknown proseguono.
      if (classifyLocation(locationFromRaw(parsed)) === 'foreign') rejected.push(r);
      else kept.push(r);
    } else {
      // Strict: tiene solo l'Italia; foreign e unknown vengono scartati (AC#1).
      if (classifyLocation(r.location) === 'italy') kept.push(r);
      else rejected.push(r);
    }
  }

  return { kept, rejected };
}

/**
 * Esegue il gate `mode`: partiziona, tombstona i `rejected` (`markRejectedGeo`), logga il
 * conteggio, ritorna i `kept`. Best-effort / fail-open: se qualunque passo lancia, logga un
 * warning e ritorna `rows` intatte — un errore del gate non deve mai fermare il run.
 */
function runGeoGate(rows: ContactRow[], mode: 'pre' | 'post'): ContactRow[] {
  try {
    const { kept, rejected } = applyGeoGate(rows, mode);
    for (const r of rejected) markRejectedGeo(r.id);
    if (rejected.length > 0) {
      console.log(`  → geo-gate (${mode}): scartati ${rejected.length} profili fuori Italia`);
    }
    return kept;
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    console.warn(`    ⚠️  geo-gate (${mode}) saltato (best-effort): ${m}`);
    return rows;
  }
}

/** Gate pre-enrichment (conservativo): scarta solo i `foreign` letti da `raw_json`. */
export function runGeoGatePre(rows: ContactRow[]): ContactRow[] {
  return runGeoGate(rows, 'pre');
}

/** Gate post-enrichment (strict): tiene solo gli `italy` letti da `contacts.location`. */
export function runGeoGatePost(rows: ContactRow[]): ContactRow[] {
  return runGeoGate(rows, 'post');
}
