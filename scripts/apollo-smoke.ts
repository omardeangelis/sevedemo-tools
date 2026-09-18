/**
 * Smoke reale Apollo (apollo-lookalike T0, SPEC A5): verifica manuale, eseguita dall'utente, dei permessi
 * della chiave, dei crediti, dei limiti di rate e dei campi realmente restituiti. Chiama UNA volta ciascuna
 * operazione Apollo usata dal CRM, con le richieste costruite dai builder di produzione
 * (`src/apollo/requests.ts`, URL da `buildApolloUrl`): lo smoke verifica esattamente ciò che i job inviano.
 *
 *   npm run apollo:smoke -- --domain acme.it --linkedin https://www.linkedin.com/in/<slug>
 *       → stampa costo atteso e chiamate previste, esce con codice 2: nessuna chiamata
 *   npm run apollo:smoke -- --domain acme.it --linkedin https://www.linkedin.com/in/<slug> --yes
 *       → 4 chiamate reali (≈ 4 crediti)
 *
 * Codici di uscita: 0 tutto riuscito; 1 argomenti/chiave non validi (con --yes) o almeno un'operazione
 * fallita; 2 manca --yes (nessuna chiamata, qualunque siano gli argomenti).
 *
 * Le risposte finiscono in `tests/fixtures/apollo/raw/` (ignorata da git) e, se riuscite, in una copia
 * anonimizzata in `tests/fixtures/apollo/smoke/<operazione>.json`: le fixture ricavate dalla documentazione
 * (`tests/fixtures/apollo/<operazione>.json`, usate dai test dei mapper) non vengono mai toccate. Le copie
 * smoke vanno riviste a mano prima del commit (TD-29: il repo è pubblico). Usa `fetch` diretto (non il client) per
 * stampare gli header; non dipende da `src/config.ts`. Importare questo modulo non esegue nulla: `main()`
 * gira solo quando il file è il punto d'ingresso.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { APOLLO_API_BASE_URL, APOLLO_REQUEST_TIMEOUT_MS, buildApolloUrl } from '../src/apollo/client.js';
import {
  enrichOrganizationsRequest,
  matchPeopleRequest,
  searchOrganizationsRequest,
  searchPeopleRequest,
  type ApolloRequest,
  type OrganizationSearchFilters,
  type PeopleMatchDetail,
} from '../src/apollo/requests.js';

/**
 * Operazioni del smoke, nell'ordine di esecuzione. `path` = `ApolloRequest.path` dei builder; `file` è
 * condiviso con le fixture ricavate dalla documentazione; `credits` = massimo atteso.
 */
export const SMOKE_OPS = [
  { key: 'enrich', path: 'organizations/bulk_enrich', file: 'organizations-bulk-enrich.json', label: 'arricchimento azienda', credits: 1 },
  { key: 'companies', path: 'mixed_companies/search', file: 'mixed-companies-search.json', label: 'ricerca aziende', credits: 1 },
  { key: 'people', path: 'mixed_people/api_search', file: 'mixed-people-api-search.json', label: 'ricerca persone', credits: 0 },
  { key: 'match', path: 'people/bulk_match', file: 'people-bulk-match.json', label: 'match persone (bulk)', credits: 2 },
] as const;

export type SmokeOp = (typeof SMOKE_OPS)[number];

export const EXPECTED_CREDITS = SMOKE_OPS.reduce((sum, op) => sum + op.credits, 0);

const PER_PAGE = 5;
const FALLBACK_LOCATION = 'Italy';

/** Campi dell'azienda usati dal punteggio e dalle regole di unione: la ricerca documentata non li garantisce. */
const COMPANY_COVERAGE_FIELDS = ['industry', 'keywords', 'estimated_num_employees', 'city', 'state', 'country', 'primary_domain', 'linkedin_url'];
/** Campi che decidono il flusso "Trova contatti" (ricerca gratuita → bulk_match per id). */
const PEOPLE_COVERAGE_FIELDS = ['id', 'linkedin_url', 'last_name', 'last_name_obfuscated', 'organization.primary_domain'];

export interface SmokeDeps {
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  log: (line: string) => void;
  writeFile: (filePath: string, content: string) => Promise<void>;
  /**
   * Cartella delle fixture Apollo: raw in `<fixturesDir>/raw/`, copie anonimizzate in `<fixturesDir>/smoke/`.
   * Le fixture docs in `<fixturesDir>/` non vengono mai scritte.
   */
  fixturesDir: string;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function realDeps(): SmokeDeps {
  return {
    fetch: globalThis.fetch,
    env: process.env,
    log: (line) => console.log(line),
    writeFile: async (filePath, content) => {
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, content);
    },
    fixturesDir: path.join(ROOT, 'tests', 'fixtures', 'apollo'),
  };
}

// --- Argomenti ---------------------------------------------------------------------------------------

interface CliArgs {
  domain?: string;
  linkedin?: string;
  yes: boolean;
  help: boolean;
  problems: string[];
}

function parseCli(argv: string[]): CliArgs {
  const args: CliArgs = { yes: false, help: false, problems: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    const eq = token.indexOf('=');
    const name = token.startsWith('--') && eq > 0 ? token.slice(0, eq) : token;
    const inline = token.startsWith('--') && eq > 0 ? token.slice(eq + 1) : undefined;
    if (name === '--yes' && inline === undefined) args.yes = true;
    else if ((name === '--help' || name === '-h') && inline === undefined) args.help = true;
    else if (name === '--domain' || name === '--linkedin') {
      const value = inline ?? (argv[i + 1]?.startsWith('--') ? undefined : argv[++i]);
      if (value === undefined) args.problems.push(`${name} richiede un valore`);
      else if (name === '--domain') args.domain = value;
      else args.linkedin = value;
    } else args.problems.push(`argomento non riconosciuto: ${token}`);
  }
  return args;
}

/** Dominio in forma `acme.it`: minuscolo, senza schema, `www.`, porta, path e query. */
export function normalizeDomainArg(raw: string): string | undefined {
  let host = raw.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  host = host.split(/[/?#]/)[0]!.replace(/:\d+$/, '').replace(/^www\./, '').replace(/\.$/, '');
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) ? host : undefined;
}

/** URL di un profilo persona (`linkedin.com/in/<slug>`) in forma `https://www.linkedin.com/in/<slug>`. */
export function normalizeProfileArg(raw: string): string | undefined {
  const m = raw.trim().match(/^(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([^/?#\s]+)\/?(?:[?#]\S*)?$/i);
  return m ? `https://www.linkedin.com/in/${m[1]}` : undefined;
}

// --- Filtri e dettagli derivati dai passi precedenti ------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Prima organizzazione di una risposta di bulk_enrich (tollerante: `organizations[]` o `organization`). */
function firstOrganization(json: unknown): Record<string, unknown> | undefined {
  if (!isRecord(json)) return undefined;
  if (Array.isArray(json.organizations)) return json.organizations.find(isRecord);
  return isRecord(json.organization) ? json.organization : undefined;
}

/**
 * Filtri della ricerca aziende: keyword (max 2) e paese dell'azienda arricchita al passo 1; senza
 * arricchimento, solo la località di ripiego `Italy`. Nessuna fascia di dipendenti.
 */
export function companiesSearchFilters(org: Record<string, unknown> | undefined): OrganizationSearchFilters {
  const keywords = Array.isArray(org?.keywords)
    ? org.keywords.filter((k): k is string => typeof k === 'string' && k.trim() !== '').slice(0, 2)
    : [];
  const country = typeof org?.country === 'string' && org.country.trim() !== '' ? org.country.trim() : FALLBACK_LOCATION;
  return { keywords, ranges: [], locations: [country] };
}

/** Dettagli del bulk_match: id Apollo della prima persona trovata al passo 3 (se c'è) e URL del profilo. */
export function matchDetails(peopleJson: unknown, linkedin: string): PeopleMatchDetail[] {
  const people = isRecord(peopleJson) && Array.isArray(peopleJson.people) ? peopleJson.people : [];
  const first = people.find((p) => isRecord(p) && typeof p.id === 'string' && p.id.trim() !== '') as Record<string, unknown> | undefined;
  const details: PeopleMatchDetail[] = [];
  if (first) details.push({ id: String(first.id) });
  details.push({ linkedin_url: linkedin });
  return details;
}

// --- Lettura delle risposte ------------------------------------------------------------------------

/** Header utili per rate limit e crediti (i nomi esatti di Apollo vanno confermati dal smoke). */
const INTERESTING_HEADER = /^x-rate-limit-|^retry-after$|credit|usage|requests-left|^x-(?:minute|hourly|daily|24-hour)-/i;

function interestingHeaders(headers: Headers): string[] {
  const out: string[] = [];
  headers.forEach((value, name) => {
    if (INTERESTING_HEADER.test(name)) out.push(`${name.toLowerCase()}=${value}`);
  });
  return out.sort();
}

function isPrimitiveLeaf(value: unknown): boolean {
  return value === null || typeof value === 'number' || typeof value === 'boolean';
}

/** Riassunto della forma di una risposta: chiavi di primo livello, conteggi e nomi dei campi (mai i valori testuali). */
export function describeShape(json: unknown): string[] {
  if (json === undefined) return ['forma: corpo non JSON'];
  if (!isRecord(json)) return [`forma: ${Array.isArray(json) ? `array[${json.length}]` : typeof json}`];
  const parts: string[] = [];
  const fields: string[] = [];
  const collectFields = (label: string, record: Record<string, unknown>, depth: number) => {
    fields.push(`campi ${label}: ${Object.keys(record).join(', ') || '(nessuno)'}`);
    if (depth >= 2) return;
    for (const [k, v] of Object.entries(record)) {
      if (isRecord(v) && !Object.values(v).every(isPrimitiveLeaf)) collectFields(`${label}.${k}`, v, depth + 1);
    }
  };
  for (const [key, value] of Object.entries(json)) {
    if (Array.isArray(value)) {
      parts.push(`${key}[${value.length}]`);
      const first = value.find(isRecord);
      if (first) collectFields(`${key}[0]`, first, 1);
    } else if (isRecord(value)) {
      if (Object.values(value).every(isPrimitiveLeaf)) {
        parts.push(`${key}{${Object.entries(value).map(([k, v]) => `${k}=${v}`).join(', ')}}`);
      } else {
        parts.push(`${key}{${Object.keys(value).length} campi}`);
        collectFields(key, value, 1);
      }
    } else if (isPrimitiveLeaf(value)) parts.push(`${key}=${value}`);
    else parts.push(key === 'status' ? `${key}="${String(value)}"` : key);
  }
  return [`forma: ${parts.join(', ') || '(oggetto vuoto)'}`, ...fields];
}

/** Valore a un percorso puntato (`organization.primary_domain`). */
function valueAt(record: unknown, dotted: string): unknown {
  let node = record;
  for (const part of dotted.split('.')) node = isRecord(node) ? node[part] : undefined;
  return node;
}

/** Presente = non nullo, non stringa vuota, non lista vuota. */
function isPresent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** "campo: presente in X/N <nome>" per ogni campo, solo conteggi. */
function coverageLines(list: unknown, fields: readonly string[], noun: string, label: string): string[] {
  const items = Array.isArray(list) ? list.filter(isRecord) : [];
  if (items.length === 0) return [`copertura ${label}: nessuna ${noun === 'aziende' ? 'azienda' : 'persona'}`];
  return [
    `copertura ${label} (${items.length} ${noun}):`,
    ...fields.map((f) => `  ${f}: presente in ${items.filter((item) => isPresent(valueAt(item, f))).length}/${items.length} ${noun}`),
  ];
}

const LOCKED_EMAIL_RE = /^email_not_unlocked@/i;

/** Copertura del bulk_match per dettaglio (ordine assunto = ordine dei dettagli) e campi crediti dichiarati. */
function matchCoverageLines(json: unknown, details: readonly PeopleMatchDetail[]): string[] {
  const lines: string[] = [];
  const matches = isRecord(json) && Array.isArray(json.matches) ? json.matches : [];
  if (matches.length !== details.length) {
    lines.push(`attenzione: ${matches.length} match per ${details.length} dettagli (l'allineamento per posizione non è garantito)`);
  }
  details.forEach((detail, i) => {
    const by = detail.id !== undefined ? 'per id' : 'per linkedin_url';
    const match = matches[i];
    if (!isRecord(match)) {
      lines.push(`match ${i + 1} (${by}): nessun risultato`);
      return;
    }
    const email = match.email;
    const emailState = !isPresent(email) ? 'email assente' : typeof email === 'string' && LOCKED_EMAIL_RE.test(email) ? 'email bloccata (email_not_unlocked)' : 'email presente';
    const sameKey =
      detail.id !== undefined
        ? match.id === detail.id
        : typeof match.linkedin_url === 'string' && profileKey(match.linkedin_url) === profileKey(detail.linkedin_url);
    lines.push(
      `match ${i + 1} (${by}): linkedin_url ${isPresent(match.linkedin_url) ? 'presente' : 'assente'}, ${emailState}, ` +
        `organization.primary_domain ${isPresent(valueAt(match, 'organization.primary_domain')) ? 'presente' : 'assente'}, ` +
        `chiave coincide con il dettaglio: ${sameKey ? 'sì' : 'no'}`,
    );
  });
  const credits = isRecord(json) ? Object.entries(json).filter(([k]) => /credit/i.test(k)) : [];
  lines.push(
    credits.length > 0
      ? `crediti dichiarati nella risposta: ${credits.map(([k, v]) => (isPrimitiveLeaf(v) ? `${k}=${v}` : `${k} (presente)`)).join(', ')}`
      : 'crediti dichiarati nella risposta: nessun campo sui crediti',
  );
  return lines;
}

function profileKey(url: string): string {
  return url.toLowerCase().replace(/^(?:https?:\/\/)?(?:[a-z]{2,3}\.)?/, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
}

function errorMessage(json: unknown, text: string): string {
  const raw = isRecord(json) ? (json.error ?? json.message ?? json.error_message ?? json.errors ?? text) : text;
  const message = typeof raw === 'string' ? raw : JSON.stringify(raw);
  return message.length > 300 ? `${message.slice(0, 300)}…` : message;
}

function remedyFor(op: SmokeOp, status: number, retryAfter: string | null): string | undefined {
  if (status === 401) return 'chiave non valida o revocata: controlla APOLLO_API_KEY nel .env';
  if (status === 403 && op.key === 'people') {
    return 'permesso negato: usa una master key o una chiave con il permesso di ricerca persone (mixed_people_api_search)';
  }
  if (status === 403) return "permesso negato per questo endpoint: usa una master key o abilita l'endpoint sulla chiave (serve un piano a pagamento)";
  if (status === 422) return 'parametri rifiutati da Apollo: annota la risposta in PLAN §7 prima di scrivere i mapper';
  if (status === 429) return `limite di rate raggiunto: riprova tra ${retryAfter ?? '?'} secondi (retry-after)`;
  if (status >= 500) return 'errore lato Apollo: riprova più tardi';
  return undefined;
}

// --- Anonimizzazione -------------------------------------------------------------------------------

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const PROFILE_URL_RE = /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/(?:in|pub|sales\/lead|sales\/people)\/[^\s"'?#]+(?:\?[^\s"']*)?/gi;
/** Chiavi il cui oggetto (o i cui elementi) è una persona. */
const PERSON_CONTAINER_KEYS = new Set(['person', 'people', 'persons', 'contact', 'contacts', 'matches', 'employees']);
const PERSON_MARKER_KEYS = ['first_name', 'last_name', 'last_name_obfuscated'];
const PERSON_NAME_KEY = /^(?:name|first_name|middle_name|last_name|last_name_obfuscated|full_name|nickname)$/;
/** Indirizzi (anche di aziende: una via può portare il nome di una persona), mascherati ovunque nell'albero. */
const ADDRESS_KEY = /^(?:raw_address|street_address|postal_code|formatted_address)$/;
const PERSON_ADDRESS_KEY = /^address$/;
/** Headline di una persona: con azienda e città la rende riconoscibile anche senza nome. */
const PERSON_HEADLINE_KEY = /^headline$/;
const ADDRESS_PLACEHOLDER = '<indirizzo>';
const PERSON_SOCIAL_KEY = /^(?:twitter_url|facebook_url|github_url)$/;
/** Ruolo e id Apollo di una persona: con l'azienda la rendono riconoscibile (e ricercabile) anche senza nome. */
const PERSON_ROLE_KEY = /^title$/;
const PERSON_ID_KEY = /^id$/;
/** Storico lavorativo di una persona: datori di lavoro, ruoli e id ne ricostruiscono il profilo. */
const PERSON_HISTORY_KEY = /^employment_history$/;
const JOB_TEXT_KEY = /^(?:_id|id|key|organization_id|organization_name|title|description|degree|major|grade_level|kind)$/;
const PHONE_KEY = /phone|(?:^|_)number$/i;
const PHOTO_KEY = /photo|avatar|headshot|picture/i;
const PHONE_LIKE = /\d[\d\s().+-]{5,}\d/;

/**
 * Copia anonimizzata di una risposta Apollo: sostituisce email, URL di profili LinkedIn, nomi, headline, ruoli,
 * id e storico lavorativo delle persone, indirizzi (di persone e aziende), telefoni e foto con segnaposto;
 * mantiene chiavi, ordine, tipi
 * (null e stringhe vuote restano tali) e gli altri dati aziendali. Pura e
 * deterministica: lo stesso valore diventa sempre lo stesso segnaposto. Non intercetta nomi dentro testi
 * liberi: la copia va comunque rivista a mano.
 */
export function anonymize(value: unknown): unknown {
  const seen = { email: new Map<string, string>(), profile: new Map<string, string>(), person: new Map<string, number>() };
  let anonymousPeople = 0;

  const placeholder = (map: Map<string, string>, original: string, make: (n: number) => string) => {
    if (!map.has(original)) map.set(original, make(map.size + 1));
    return map.get(original)!;
  };
  const scrub = (text: string) =>
    text
      .replace(EMAIL_RE, (email) => placeholder(seen.email, email.toLowerCase(), (n) => `persona-${n}@esempio.invalid`))
      .replace(PROFILE_URL_RE, (url) => {
        // Stesso profilo scritto in modi diversi (schema, www, query, slash finale) → stesso segnaposto.
        return placeholder(seen.profile, profileKey(url), (n) => `https://www.linkedin.com/in/persona-${n}`);
      });

  const personNumber = (record: Record<string, unknown>) => {
    const id = typeof record.id === 'string' || typeof record.id === 'number' ? String(record.id) : `#${++anonymousPeople}`;
    if (!seen.person.has(id)) seen.person.set(id, seen.person.size + 1);
    return seen.person.get(id)!;
  };

  const personName = (key: string, n: number) => {
    if (key === 'first_name') return `Nome${n}`;
    if (key === 'last_name' || key === 'last_name_obfuscated') return `Cognome${n}`;
    if (key === 'middle_name' || key === 'nickname') return '';
    return `Nome${n} Cognome${n}`;
  };

  const job = (node: unknown, n: number, i: number): unknown => {
    if (!isRecord(node)) return node;
    const masked = (key: string) =>
      key === 'organization_name' ? `Azienda ${i}` : key === 'title' ? '<ruolo>' : /(?:id|key)$/.test(key) ? `persona-${n}-lavoro-${i}` : '<testo>';
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => [key, typeof value === 'string' && value !== '' && JOB_TEXT_KEY.test(key) ? masked(key) : value]),
    );
  };

  const walk = (node: unknown, parentKey: string | undefined, inPhone: boolean): unknown => {
    if (Array.isArray(node)) return node.map((item) => walk(item, parentKey, inPhone));
    if (isRecord(node)) {
      const isPerson =
        PERSON_MARKER_KEYS.some((k) => k in node) || (parentKey !== undefined && PERSON_CONTAINER_KEYS.has(parentKey));
      const n = isPerson ? personNumber(node) : 0;
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(node)) {
        const phone = inPhone || PHONE_KEY.test(key);
        const text = typeof child === 'string' && child !== '';
        if (text && PHOTO_KEY.test(key)) out[key] = 'https://media.esempio.invalid/foto-segnaposto.jpg';
        else if (text && ADDRESS_KEY.test(key)) out[key] = ADDRESS_PLACEHOLDER;
        else if (text && isPerson && PERSON_NAME_KEY.test(key)) out[key] = personName(key, n);
        else if (text && isPerson && PERSON_ADDRESS_KEY.test(key)) out[key] = ADDRESS_PLACEHOLDER;
        else if (text && isPerson && PERSON_HEADLINE_KEY.test(key)) out[key] = '<headline>';
        else if (text && isPerson && PERSON_SOCIAL_KEY.test(key)) out[key] = `https://esempio.invalid/social/persona-${n}`;
        else if (text && isPerson && PERSON_ROLE_KEY.test(key)) out[key] = '<ruolo>';
        else if (isPerson && PERSON_ID_KEY.test(key) && (text || typeof child === 'number')) out[key] = `persona-${n}`;
        else if (isPerson && PERSON_HISTORY_KEY.test(key) && Array.isArray(child)) {
          out[key] = child.map((item, i) => walk(job(item, n, i + 1), key, phone));
        }
        else out[key] = walk(child, key, phone);
      }
      return out;
    }
    if (typeof node === 'string') return inPhone && PHONE_LIKE.test(node) ? '+39 000 0000000' : scrub(node);
    if (typeof node === 'number' && inPhone && Math.abs(node) >= 100_000) return 390_000_000_000;
    return node;
  };

  return walk(value, undefined, false);
}

// --- Esecuzione -------------------------------------------------------------------------------------

interface OpOutcome {
  op: SmokeOp;
  ok: boolean;
  status: number | null;
  json: unknown;
}

function printPlan(log: (line: string) => void, domain: string | undefined, linkedin: string | undefined, hasKey: boolean, fixturesDir: string) {
  const d = domain ?? '<dominio>';
  const enrichUrl = domain ? buildApolloUrl(enrichOrganizationsRequest([domain])) : `${APOLLO_API_BASE_URL}organizations/bulk_enrich?domains[]=<dominio>`;
  log('Smoke reale Apollo (SPEC A5): verifica di permessi della chiave, crediti, limiti di rate e campi restituiti.');
  log(
    `Costo atteso: ≈ ${EXPECTED_CREDITS} crediti Apollo (1 arricchimento azienda + 1 pagina di ricerca + fino a 2 match persona; ` +
      'la ricerca persone è gratuita). Il prezzo del credito dipende dal piano.',
  );
  log('Chiamate previste (una per operazione, costruite da src/apollo/requests.ts):');
  log(`  1. POST ${enrichUrl} — arricchimento di ${d}, dominio in query, senza body (1 credito)`);
  log(
    `  2. POST ${APOLLO_API_BASE_URL}mixed_companies/search — 1 pagina da ${PER_PAGE} aziende (1 credito), filtrate per ` +
      `keyword e paese dell'azienda arricchita (senza arricchimento: organization_locations=["${FALLBACK_LOCATION}"])`,
  );
  log(`  3. POST ${APOLLO_API_BASE_URL}mixed_people/api_search — ${PER_PAGE} persone di ${d} (0 crediti, serve il permesso di ricerca persone)`);
  log(
    `  4. POST ${APOLLO_API_BASE_URL}people/bulk_match — fino a 2 match (1 credito per persona trovata): per id della prima ` +
      `persona del passo 3 e per ${linkedin ?? '<URL profilo LinkedIn>'}; reveal_personal_emails=false, reveal_phone_number=false`,
  );
  log(`Chiave APOLLO_API_KEY: ${hasKey ? 'presente' : 'mancante'}`);
  log(
    `Risposte: raw in ${path.join(fixturesDir, 'raw')} (ignorata da git), copia anonimizzata in ${path.join(fixturesDir, 'smoke')} ` +
      `(da rivedere prima del commit); le fixture docs in ${fixturesDir} non vengono toccate`,
  );
}

async function callOp(op: SmokeOp, request: ApolloRequest, apiKey: string, deps: SmokeDeps, log: (line: string) => void, index: number): Promise<OpOutcome> {
  if (request.path !== op.path) throw new Error(`smoke: richiesta ${request.path} al posto di ${op.path}`);
  const url = buildApolloUrl(request);
  const title = `[${index}/${SMOKE_OPS.length}] ${op.label} — POST ${op.path}`;
  let res: Response;
  try {
    // Stessi header del client di produzione (`src/apollo/client.ts`).
    res = await deps.fetch(url, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', Accept: 'application/json' },
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      signal: AbortSignal.timeout(APOLLO_REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    log(`${title} → errore di rete: ${err instanceof Error ? err.message : String(err)}`);
    return { op, ok: false, status: null, json: undefined };
  }

  const text = await res.text().catch(() => '');
  let json: unknown;
  try {
    json = text === '' ? undefined : JSON.parse(text);
  } catch {
    json = undefined;
  }

  log(`${title} → HTTP ${res.status}${res.ok ? ' OK' : ''}`);
  const permission = res.status === 401 || res.status === 403 ? 'NEGATO' : res.ok ? 'ok' : 'non verificabile';
  log(`      permesso: ${permission}`);
  const headers = interestingHeaders(res.headers);
  log(`      header: ${headers.length > 0 ? headers.join(', ') : 'nessun header di rate limit o crediti'}`);
  if (!res.ok) {
    log(`      errore: ${errorMessage(json, text)}`);
    const remedy = remedyFor(op, res.status, res.headers.get('retry-after'));
    if (remedy) log(`      rimedio: ${remedy}`);
  }
  for (const line of describeShape(json)) log(`      ${line}`);

  // Raw sempre (diagnostica, ignorata da git); copia anonimizzata in smoke/ solo se riuscita (un errore non
  // sovrascrive l'ultima copia buona). Mai sui percorsi delle fixture docs, da cui dipendono i test dei mapper.
  let saved = true;
  const rawPath = path.join(deps.fixturesDir, 'raw', op.file);
  const anonPath = path.join(deps.fixturesDir, 'smoke', op.file);
  try {
    await deps.writeFile(rawPath, json === undefined ? text : `${JSON.stringify(json, null, 2)}\n`);
    if (res.ok && isRecord(json)) {
      const copy = { _source: 'smoke', _captured_at: new Date().toISOString(), ...(anonymize(json) as Record<string, unknown>) };
      await deps.writeFile(anonPath, `${JSON.stringify(copy, null, 2)}\n`);
      log(`      salvato: ${rawPath} + copia anonimizzata ${anonPath}`);
    } else {
      log(`      salvato: ${rawPath} (nessuna copia anonimizzata: risposta non riuscita)`);
    }
  } catch (err) {
    saved = false;
    log(`      impossibile salvare le risposte: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { op, ok: res.ok && saved, status: res.status, json };
}

export async function main(argv: string[], deps: SmokeDeps): Promise<number> {
  const cli = parseCli(argv);
  const apiKey = deps.env.APOLLO_API_KEY?.trim() ?? '';
  // La chiave non compare mai nell'output, nemmeno se Apollo la riecheggia in un errore.
  const log = (line: string) => deps.log(apiKey ? line.split(apiKey).join('[chiave nascosta]') : line);

  if (cli.help) {
    log('Uso: npm run apollo:smoke -- --domain <dominio> --linkedin <URL profilo LinkedIn> [--yes]');
    log('Senza --yes stampa costo e chiamate previste ed esce con codice 2 senza chiamare Apollo.');
    return 0;
  }

  const problems = [...cli.problems];
  const domain = cli.domain === undefined ? undefined : normalizeDomainArg(cli.domain);
  if (cli.domain === undefined) problems.push('manca --domain <dominio> (es. --domain acme.it)');
  else if (!domain) problems.push(`--domain non valido: "${cli.domain}" (atteso un dominio come acme.it)`);
  const linkedin = cli.linkedin === undefined ? undefined : normalizeProfileArg(cli.linkedin);
  if (cli.linkedin === undefined) problems.push('manca --linkedin <URL profilo> (es. --linkedin https://www.linkedin.com/in/<slug>)');
  else if (!linkedin) problems.push(`--linkedin non valido: "${cli.linkedin}" (atteso un profilo persona linkedin.com/in/<slug>)`);
  if (!apiKey) problems.push('APOLLO_API_KEY mancante nel .env');

  printPlan(log, domain, linkedin, apiKey !== '', deps.fixturesDir);
  if (problems.length > 0) {
    log('Da correggere prima di eseguire:');
    for (const p of problems) log(`  - ${p}`);
  }

  if (!cli.yes) {
    log(`Nessuna chiamata eseguita. Per eseguire davvero (≈ ${EXPECTED_CREDITS} crediti) ripeti il comando aggiungendo --yes.`);
    return 2;
  }
  if (problems.length > 0 || !domain || !linkedin) {
    log('Nessuna chiamata eseguita.');
    return 1;
  }

  log('');
  const [enrichOp, companiesOp, peopleOp, matchOp] = SMOKE_OPS;
  const indent = (lines: string[]) => lines.forEach((line) => log(`      ${line}`));

  const enrich = await callOp(enrichOp, enrichOrganizationsRequest([domain]), apiKey, deps, log, 1);

  const filters = companiesSearchFilters(enrich.ok ? firstOrganization(enrich.json) : undefined);
  const companies = await callOp(companiesOp, searchOrganizationsRequest(filters, 1, PER_PAGE), apiKey, deps, log, 2);
  if (companies.ok && isRecord(companies.json)) {
    indent(coverageLines(companies.json.organizations, COMPANY_COVERAGE_FIELDS, 'aziende', 'organizations[]'));
    indent(coverageLines(companies.json.accounts, COMPANY_COVERAGE_FIELDS, 'aziende', 'accounts[]'));
  }

  const people = await callOp(peopleOp, searchPeopleRequest({ domain, perPage: PER_PAGE }), apiKey, deps, log, 3);
  if (people.ok && isRecord(people.json)) {
    indent(coverageLines(people.json.people, PEOPLE_COVERAGE_FIELDS, 'persone', 'people[]'));
  }

  const details = matchDetails(people.ok ? people.json : undefined, linkedin);
  if (details.length < 2) log('      (nessuna persona dal passo 3: il match usa solo l\'URL LinkedIn)');
  const match = await callOp(matchOp, matchPeopleRequest(details), apiKey, deps, log, 4);
  if (match.ok) indent(matchCoverageLines(match.json, details));

  const outcomes = [enrich, companies, people, match];
  log('');
  log('Riepilogo:');
  for (const o of outcomes) {
    const status = o.status === null ? 'errore di rete' : `HTTP ${o.status}`;
    log(`  - ${o.op.label}: ${o.ok ? 'riuscita' : 'FALLITA'} (${status})`);
  }
  log(
    `Crediti attesi: ≈ ${EXPECTED_CREDITS} al massimo (solo per le operazioni riuscite e le persone trovate). Verifica il ` +
      'consumo reale nella dashboard Apollo e confrontalo con gli header e i campi crediti stampati sopra.',
  );
  log('Rivedi a mano le copie anonimizzate prima di committarle (TD-29) e annota gli scostamenti in PLAN §7.');
  return outcomes.every((o) => o.ok) ? 0 : 1;
}

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(path.resolve(entry));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  loadDotenv({ path: path.join(ROOT, '.env'), quiet: true });
  process.exitCode = await main(process.argv.slice(2), realDeps());
}
