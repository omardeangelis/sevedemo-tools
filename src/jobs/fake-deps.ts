import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AnalysisClient, AnalysisResponse } from '../analysis/analyze.js';
import { SUMMARY_MAX_CHARS, type AnalysisOutput } from '../analysis/schema.js';
import { ACTORS } from '../apify/actors.js';
import { createApolloClient } from '../apollo/client.js';
import {
  enrichOrganizationsRequest,
  matchPeopleRequest,
  searchOrganizationsRequest,
  searchPeopleRequest,
  type ApolloOp,
  type ApolloRequest,
  type PeopleMatchDetail,
} from '../apollo/requests.js';
import { config, ROOT } from '../config.js';
import { createCompany, findCompanyByDomain, findCompanyByUrl } from '../db/companies.js';
import { createIcp, getIcp, setReferenceCompany } from '../db/icps.js';
import { db } from '../db/index.js';
import { findJob } from '../db/jobs.js';
import { addMembers, createList, getList } from '../db/lists.js';
import { addSource, upsertProspect } from '../db/prospects.js';
import { getSettings, updateSettings } from '../db/settings.js';
import { mapProfileDetailItem, type Enrichment } from '../enrich/profile-detail.js';
import { memberIdOf, normalizeDomain, normalizeLinkedinUrl, normalizeProfileUrl } from '../util/fields.js';
import type { Deps as AnalyzeDeps } from './analyze.js';
import type { Deps as ApolloPeopleDeps } from './apollo-people.js';
import { enrichCompanies, type Deps as EnrichCompaniesDeps } from './enrich-companies.js';
import type { Deps as EnrichDeps } from './enrich.js';
import type { DepsByKind } from './handlers.js';
import type { Deps as LookalikeDeps } from './lookalike-companies.js';
import type { EmployeeFilters, Deps as SourceDeps } from './source-company.js';
import { syncInteractions, type Deps as SyncDeps } from './sync-interactions.js';
import type { JobKind } from './types.js';

/*
 * Deps fixture-backed del server e2e (`E2E_FAKE_JOBS=1`, crm-foundation T20): il dispatcher
 * `resolveDeps(kind)` di T6 le sceglie al posto di `realDeps()`. Nessuna chiamata ad Apify o
 * Claude: gli item escono da `tests/fixtures/e2e/*.json` con il layout degli actor reali, così
 * mapper e job girano davvero. I percorsi non felici si pilotano con `params.__fixture` del job
 * (letto dalla riga `jobs` via `JOB_ID`, l'env del processo figlio) o con parole chiave nei dati
 * (slug del profilo, dell'azienda, del prospect): l'elenco completo è in `tests/e2e/README.md`.
 * I job Apollo (apollo-lookalike T16) passano dal client Apollo vero con un `fetch` finto che serve le
 * fixture `apollo-*.json`: stessi body, stessi errori (`config:` / `actor:apollo:<op>:`) della produzione.
 */

const FIXTURES_DIR = path.join(ROOT, 'tests', 'fixtures', 'e2e');
const DAY_MS = 86_400_000;

/** Testo comune degli errori simulati: `FAIL_ONCE` riconosce i fallimenti precedenti da qui. */
const SIMULATED = 'errore simulato dal server e2e';

/**
 * Percorso pilotato: `default` = fixture complete. `noscope`, `unrecognized`, `hourly`, `badkey` valgono solo
 * per i job Apollo (per gli altri kind equivalgono a `default`).
 */
type E2eScenario = 'default' | 'empty' | 'fail' | 'warn' | 'partial' | 'nodata' | 'noscope' | 'unrecognized' | 'hourly' | 'badkey';

const FIXTURE_SCENARIOS: readonly E2eScenario[] = ['empty', 'fail', 'warn', 'partial', 'nodata', 'noscope', 'unrecognized', 'hourly', 'badkey'];

// ---------------------------------------------------------------------------
// Fixture e scenario
// ---------------------------------------------------------------------------

const cache = new Map<string, unknown>();

/** Fixture JSON (copia: chi la legge può modificarla). Letta da disco a runtime: `tests/` è fuori da `rootDir`. */
function fixture<T>(name: string): T {
  if (!cache.has(name)) cache.set(name, JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8')));
  return structuredClone(cache.get(name)) as T;
}

/** Latenza finta per rendere visibile lo stato "in corso" nella UI (`E2E_FAKE_DELAY_MS`, default 0). */
async function latency(): Promise<void> {
  const ms = Number(process.env.E2E_FAKE_DELAY_MS ?? 0);
  if (Number.isFinite(ms) && ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `FAIL_ONCE`: fallisce solo se nessun job precedente dello stesso kind **con gli stessi `params`**
 * è già fallito con un errore simulato. Il "Riprova" copia i `params`, quindi riesce; gli altri job
 * (es. un `FAIL` precedente) non contano. Senza job corrente (`JOB_ID` assente) basta il kind.
 */
function failOnce(kind: JobKind): E2eScenario {
  const failedBefore = db
    .prepare(
      `SELECT EXISTS (
         SELECT 1 FROM jobs WHERE kind = @kind AND state = 'failed' AND error LIKE @simulated
           AND (@id IS NULL OR (id < @id AND params = (SELECT params FROM jobs WHERE id = @id)))
       ) AS e`,
    )
    .get({ kind, simulated: `%${SIMULATED}%`, id: currentJobId() ?? null }) as { e: number };
  return failedBefore.e === 1 ? 'default' : 'fail';
}

/**
 * Scenario da un valore di `__fixture` (`EMPTY`, `FAIL`, `FAIL_ONCE`, `WARN`, `PARTIAL`, `NODATA`; per i job
 * Apollo anche `NOSCOPE`, `UNRECOGNIZED`, `HOURLY`, `BADKEY`).
 */
function scenarioOfFixture(value: string, kind: JobKind): E2eScenario {
  const v = value.trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (v === 'fail-once') return failOnce(kind);
  if ((FIXTURE_SCENARIOS as readonly string[]).includes(v)) return v as E2eScenario;
  if (v !== 'default') console.warn(`[e2e] __fixture sconosciuto: ${value} (uso le fixture complete)`);
  return 'default';
}

type TriggerWords = Array<[word: string, scenario: E2eScenario | 'fail-once']>;

/**
 * Parole chiave dei job Apollo (tutti, anche l'arricchimento con provider Apollo), in ordine di precedenza.
 * Prefisso `apollo-` perché i dati si propagano: un'azienda `…-fail` pensata per il sourcing Apify non deve far
 * fallire anche i job Apollo (il contrario resta possibile: `apollo-fail` in uno slug LinkedIn contiene `fail`).
 * Dove si cercano: `apolloJobTexts` (ICP e liste del job) e i testi di ogni chiamata (vedi `apolloDeps`).
 */
const APOLLO_TRIGGER_WORDS: TriggerWords = [
  ['apollo-fail-once', 'fail-once'],
  ['apollo-fail', 'fail'],
  ['apollo-empty', 'empty'],
  ['apollo-partial', 'partial'],
  ['apollo-hourly', 'hourly'],
  ['apollo-noscope', 'noscope'],
  ['apollo-badkey', 'badkey'],
  ['apollo-unrecognized', 'unrecognized'],
];

/**
 * Parole chiave nei dati, per kind e in ordine di precedenza. Distinte per kind perché i dati
 * si propagano: le persone estratte da `company/acme-nodata` hanno `acme-nodata` nello slug e
 * arrivano "senza dati" all'arricchimento, mentre `fail` nello slug azienda fermerebbe già il sourcing.
 */
const TRIGGER_WORDS: Record<JobKind, TriggerWords> = {
  // slug del mio profilo (Impostazioni)
  sync_interactions: [
    ['fail-once', 'fail-once'],
    ['fail', 'fail'],
    ['empty', 'empty'],
    ['warn', 'warn'],
    ['partial', 'partial'],
  ],
  // slug dell'azienda
  source_company: [
    ['fail-once', 'fail-once'],
    ['fail', 'fail'],
    ['empty', 'empty'],
  ],
  // URL, nome, headline, azienda o ruolo del prospect
  enrich: [
    ['enrich-error', 'fail'],
    ['nodata', 'nodata'],
  ],
  // l'analisi usa i marcatori `e2e-…` nel messaggio al modello (vedi `analysisResponse`)
  analyze: [],
  // Job Apollo (apollo-lookalike T16): nome dell'ICP o della lista, filtri, domini, prospect.
  enrich_companies: APOLLO_TRIGGER_WORDS,
  lookalike_companies: APOLLO_TRIGGER_WORDS,
  apollo_people: APOLLO_TRIGGER_WORDS,
};

/** Scenario dalle parole chiave nei testi (minuscolo, spazi come trattini: "Acme Nodata" vale `acme-nodata`). */
function scenarioOfText(
  texts: Array<string | null | undefined>,
  kind: JobKind,
  words: TriggerWords = TRIGGER_WORDS[kind],
): E2eScenario {
  const haystack = texts.map((t) => (t ?? '').toLowerCase().replace(/\s+/g, '-')).join(' ');
  const hit = words.find(([word]) => haystack.includes(word));
  if (!hit) return 'default';
  return hit[1] === 'fail-once' ? failOnce(kind) : hit[1];
}

function currentJobId(): number | undefined {
  const id = Number(process.env.JOB_ID);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

/** Scenario imposto dal job in corso (`params.__fixture`), se le deps servono proprio quel job. */
function jobScenario(kind: JobKind): E2eScenario | undefined {
  const jobId = currentJobId();
  const job = jobId === undefined ? undefined : findJob(jobId);
  const value = job?.kind === kind ? job.params.__fixture : undefined;
  return typeof value === 'string' ? scenarioOfFixture(value, kind) : undefined;
}

function simulatedError(detail: string): Error {
  return new Error(`${SIMULATED} (${detail})`);
}

// ---------------------------------------------------------------------------
// sync_interactions: post → reazioni + commenti
// ---------------------------------------------------------------------------

type FixtureItem = Record<string, any>;

/** Chiave del post: l'id attività nell'URL o l'id nudo. */
function activityKey(value: string): string | undefined {
  if (/^\d{10,}$/.test(value)) return value;
  return /(?:activity|ugcPost)[-:](\d{10,})/.exec(value)?.[1];
}

/** Toglie le chiavi di controllo `_e2e_*` e porta la data del post a "N giorni fa" rispetto a oggi. */
function livePost(item: FixtureItem): FixtureItem {
  const days = item._e2e_days_ago;
  const out = Object.fromEntries(Object.entries(item).filter(([key]) => !key.startsWith('_e2e_')));
  if (typeof days === 'number') {
    const at = new Date(Date.now() - days * DAY_MS);
    out.posted_at = {
      date: at.toISOString().slice(0, 19).replace('T', ' '),
      relative: `${days} ${days === 1 ? 'giorno' : 'giorni'} fa • Visibile a tutti`,
      timestamp: at.getTime(),
    };
  }
  return out;
}

function syncDeps(forced: E2eScenario | undefined, opts: { delay?: boolean } = {}): SyncDeps {
  const posts = () => fixture<FixtureItem[]>('posts.json');
  // Scenario: `__fixture` del job, altrimenti lo slug del mio profilo (es. `/in/demo-empty`).
  const scenario = (profileUrl?: string) =>
    forced ?? scenarioOfText([profileUrl ?? getSettings().own_profile_url], 'sync_interactions');
  const defaultPost = () => posts().find((p) => !p._e2e_only_in)!;

  return {
    fetchPosts: async (profileUrl, totalPosts) => {
      if (opts.delay !== false) await latency();
      const s = scenario(profileUrl);
      if (s === 'fail') throw simulatedError('run di apimaestro/linkedin-profile-posts non riuscita');
      if (s === 'empty') return [];
      return posts()
        .filter((p) => !p._e2e_only_in || p._e2e_only_in === s)
        .slice(0, totalPosts ?? Number.POSITIVE_INFINITY)
        .map(livePost);
    },

    fetchReactions: async (postUrls, page, limit = 100) => {
      const all = fixture<FixtureItem[]>('reactions.json');
      const known = new Set(posts().map((p) => p.url));
      const start = (Math.max(1, page) - 1) * limit;
      return postUrls.flatMap((url) => {
        // Post sconosciuto alla fixture: riceve le reazioni del primo post (URL riscritto).
        const source = known.has(url) ? url : defaultPost().url;
        return all
          .filter((r) => r._metadata?.post_url === source)
          .slice(start, start + limit)
          .map((r) => ({ ...r, _metadata: { ...r._metadata, post_url: url, page_number: page } }));
      });
    },

    fetchComments: async (postRef, limit = 100) => {
      const key = activityKey(postRef) ?? postRef;
      const post = posts().find((p) => p.urn?.activity_urn === key || p.url === postRef);
      if (post?._e2e_comments_fail_in && post._e2e_comments_fail_in === scenario()) {
        throw new Error(`actor:${ACTORS.postComments}: ${SIMULATED} (commenti del post non leggibili)`);
      }
      // Post sconosciuto alla fixture: riceve i commenti del primo post (`post_input` riscritto).
      const source = post ? post.urn.activity_urn : defaultPost().urn.activity_urn;
      return fixture<FixtureItem[]>('comments.json')
        .filter((c) => c.post_input === source)
        .slice(0, limit)
        .map((c) => ({ ...c, post_input: key }));
    },
  };
}

// ---------------------------------------------------------------------------
// source_company: dipendenti di un'azienda
// ---------------------------------------------------------------------------

interface EmployeesFixture {
  /** Persone "modello" per qualunque azienda: `{azienda}`, `{slug}`, `{hash}`, `{dominio}` si riempiono. */
  default: FixtureItem[];
  /** Persone fisse per slug di azienda (es. chi è anche nelle interazioni del sync). */
  companies: Record<string, FixtureItem[]>;
}

/** Sostituisce i segnaposto `{nome}` in tutte le stringhe di un valore JSON. */
function fillTemplate<T>(value: T, vars: Record<string, string>): T {
  if (typeof value === 'string') return value.replace(/\{(\w+)\}/g, (all, key: string) => vars[key] ?? all) as T;
  if (Array.isArray(value)) return value.map((v) => fillTemplate(v, vars)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillTemplate(v, vars)])) as T;
  }
  return value;
}

/** Nome leggibile: quello in anagrafica se diverso dallo slug, altrimenti lo slug in parole. */
function companyDisplayName(companyUrl: string, slug: string): string {
  const name = findCompanyByUrl(companyUrl)?.name?.trim();
  if (name && name !== slug) return name;
  return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

/** Layout dell'item per modalità: Full+email completo, Full senza email, Short da risultato di ricerca. */
function employeeForMode(item: FixtureItem, mode: EmployeeFilters['mode']): FixtureItem {
  if (item.hidden || mode === 'Full+email') return item;
  const { emails: _emails, ...full } = item;
  if (mode === 'Full') return full;
  return {
    id: item.id,
    publicIdentifier: item.publicIdentifier,
    name: [item.firstName, item.lastName].filter(Boolean).join(' '),
    position: item.headline,
    location: { linkedinText: item.location?.linkedinText },
    // Nei risultati Short l'URL arriva spesso in forma id membro: lo slug sta in `publicIdentifier`.
    linkedinUrl: `https://www.linkedin.com/in/${item.id}`,
    photo: item.photo,
  };
}

function sourceDeps(forced: E2eScenario | undefined): SourceDeps {
  return {
    fetchEmployees: async (companyUrl, filters) => {
      await latency();
      const slug = companyUrl.slice(companyUrl.lastIndexOf('/') + 1);
      const scenario = forced ?? scenarioOfText([slug], 'source_company');
      if (scenario === 'fail') throw simulatedError('run di harvestapi/linkedin-company-employees non riuscita');
      if (scenario === 'empty') return [];

      const data = fixture<EmployeesFixture>('employees.json');
      const safeSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '') || 'azienda';
      const vars = {
        azienda: companyDisplayName(companyUrl, slug),
        slug: safeSlug,
        hash: createHash('sha256').update(slug).digest('hex').slice(0, 8),
        dominio: `${safeSlug}.example`,
      };
      // I ruoli non filtrano: la fixture torna sempre le stesse persone (prevedibile negli scenari).
      return fillTemplate(data.companies[slug] ?? data.default, vars)
        .slice(0, filters.maxItems)
        .map((item) => employeeForMode(item, filters.mode));
    },
  };
}

// ---------------------------------------------------------------------------
// enrich: profile-detail
// ---------------------------------------------------------------------------

interface ProfileDetailFixture {
  /** Slug o id membro dei profili che l'actor non restituisce (privati). */
  no_data: string[];
  /** Item di `apimaestro/linkedin-profile-detail` (layout annidato `basic_info.*`). */
  profiles: FixtureItem[];
}

interface ProspectKeys {
  linkedin_url: string;
  member_urn: string | null;
  full_name: string | null;
  headline: string | null;
  company_name: string | null;
  title: string | null;
  location: string | null;
}

/** Il prospect che l'URL identifica (per URL o id membro), per chiavi e profilo sintetico. */
function prospectByUrl(url: string, memberUrn: string | undefined): ProspectKeys | undefined {
  return db
    .prepare(
      `SELECT linkedin_url, member_urn, full_name, headline, company_name, title, location FROM prospects
       WHERE linkedin_url = ? OR (? IS NOT NULL AND member_urn = ?) LIMIT 1`,
    )
    .get(url, memberUrn ?? null, memberUrn ?? null) as ProspectKeys | undefined;
}

/** Slug (in minuscolo) e id membro con cui la fixture può conoscere il profilo, da URL e prospect salvato. */
function identityKeysOf(url: string, row: ProspectKeys | undefined): Set<string> {
  const keys = new Set<string>();
  for (const value of [slugOf(url), slugOf(row?.linkedin_url), row?.member_urn]) {
    if (value) keys.add(memberIdOf(value) ? value : value.toLowerCase());
  }
  return keys;
}

const slugOf = (url: string | undefined) => (url ? /\/in\/([^/?#]+)/.exec(url)?.[1] : undefined);

/**
 * Profilo sintetico per chi non è nella fixture (es. dipendenti estratti in modalità Short):
 * costruito dai dati già salvati sul prospect, nello stesso layout dell'actor.
 */
function syntheticProfile(url: string, memberUrn: string | undefined, row: ProspectKeys | undefined): FixtureItem {
  const slug = slugOf(url);
  const vanity = slug && !memberIdOf(slug) ? slug : undefined;
  const name = row?.full_name ?? vanity?.replace(/-/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase()) ?? 'Profilo LinkedIn';
  const role = row?.title ?? row?.headline ?? 'Professionista';
  const company = row?.company_name ?? undefined;
  return {
    basic_info: {
      fullname: name,
      headline: row?.headline ?? role,
      public_identifier: vanity,
      profile_url: url,
      urn: memberUrn ?? row?.member_urn ?? undefined,
      about: `Profilo sintetico del server e2e: ${name} si occupa di ${role}${company ? ` in ${company}` : ''}. Segue da vicino progetti di digitalizzazione e scelta dei fornitori software.`,
      location: { full: row?.location ?? 'Italia' },
      current_company: company,
    },
    experience: [{ title: role, company, is_current: true, description: 'Esperienza generata dal server e2e.' }],
    education: [],
    certifications: [],
  };
}

function enrichDeps(forced: E2eScenario | undefined): EnrichDeps {
  let apollo: ApolloFakeDeps | undefined;
  return {
    // Il job chiama con un URL per volta; qui si accetta comunque un batch.
    enrich: async (urls) => {
      const data = fixture<ProfileDetailFixture>('profile-detail.json');
      const result = new Map<string, Enrichment>();
      for (const input of urls) {
        await latency();
        const url = normalizeLinkedinUrl(input) ?? input;
        const memberUrn = memberIdOf(url);
        const row = prospectByUrl(url, memberUrn);
        const texts = [url, row?.full_name, row?.headline, row?.company_name, row?.title];
        const scenario = forced ?? scenarioOfText(texts, 'enrich');
        if (scenario === 'fail') {
          throw new Error(`actor:${ACTORS.profileDetail}: ${SIMULATED} (profilo ${url} non leggibile)`);
        }
        if (scenario === 'empty' || scenario === 'nodata') continue;

        const keys = identityKeysOf(url, row);
        if (data.no_data.some((k) => keys.has(k))) continue;
        const item =
          data.profiles.find((p) => keys.has(p.basic_info?.public_identifier) || keys.has(p.basic_info?.urn)) ??
          syntheticProfile(url, memberUrn, row);
        const { url: canonical, enrichment } = mapProfileDetailItem(item);
        if (canonical) result.set(input, enrichment);
      }
      return result;
    },
    // Provider Apollo (apollo-lookalike T10/T16): `people/bulk_match` dalle fixture, deps create al primo uso.
    matchPeople: (details) => (apollo ??= apolloDeps('enrich', forced)).matchPeople(details),
  };
}

// ---------------------------------------------------------------------------
// analyze: client Claude fake
// ---------------------------------------------------------------------------

type AnalysisOutcome = 'ok' | 'refusal' | 'invalid_json';

interface AnalysisFixture {
  /** Analisi per chi non è in `profiles`: `{nome}`, `{headline}`, `{icp}` si riempiono dal messaggio. */
  default: AnalysisOutput;
  profiles: Array<{ name: string; outcome: AnalysisOutcome; analysis?: AnalysisOutput }>;
}

/** Marcatori nel messaggio al modello (About, headline, azienda, commenti…); spazi come trattini. */
const ANALYSIS_MARKER = /e2e-(refusal|invalid-json|fit-(alto|medio|basso))/;

function userText(body: Parameters<AnalysisClient['messages']['create']>[0]): string {
  return body.messages
    .map((m) => (typeof m.content === 'string' ? m.content : m.content.map((b) => ('text' in b ? b.text : '')).join('\n')))
    .join('\n');
}

/**
 * Risposta del modello per il messaggio: marcatore `e2e-…` nei dati, poi profilo nominato nella
 * fixture (per `Nome:`), altrimenti l'analisi di default personalizzata.
 */
function analysisResponse(user: string): AnalysisResponse {
  const data = fixture<AnalysisFixture>('analysis.json');
  const line = (label: string) => new RegExp(`^${label}: (.+)$`, 'm').exec(user)?.[1]?.trim();
  const name = line('Nome') ?? 'Questa persona';
  const marker = ANALYSIS_MARKER.exec(user.toLowerCase().replace(/[ \t]+/g, '-'));
  const named = data.profiles.find((p) => p.name.toLowerCase() === name.toLowerCase());

  const outcome: AnalysisOutcome =
    marker?.[1] === 'refusal' ? 'refusal' : marker?.[1] === 'invalid-json' ? 'invalid_json' : (named?.outcome ?? 'ok');
  if (outcome === 'refusal') {
    return { content: [], stop_reason: 'refusal', stop_details: { category: null, explanation: `Rifiuto simulato (${SIMULATED}).` } };
  }
  if (outcome === 'invalid_json') {
    return { content: [{ type: 'text', text: 'Profilo interessante, direi fit alto: scrivigli subito!' }], stop_reason: 'end_turn' };
  }

  const vars = {
    nome: name,
    headline: line('Headline') ?? 'ruolo non indicato',
    icp: /all'ICP "(.+)"/.exec(user)?.[1] ?? 'ICP',
  };
  const analysis = named?.analysis ?? fillTemplate(data.default, vars);
  analysis.summary = analysis.summary.slice(0, SUMMARY_MAX_CHARS);
  if (marker?.[2]) analysis.fit = marker[2] as AnalysisOutput['fit'];
  return { content: [{ type: 'text', text: JSON.stringify(analysis) }], stop_reason: 'end_turn' };
}

function analyzeDeps(forced: E2eScenario | undefined): AnalyzeDeps {
  return {
    client: {
      messages: {
        create: async (body) => {
          await latency();
          if (forced === 'fail') throw simulatedError('API del modello non raggiungibile');
          return analysisResponse(userText(body));
        },
      },
    },
    // `FAIL`/`EMPTY` del job valgono anche per l'arricchimento dei mancanti (P5).
    enrich: enrichDeps(forced === 'fail' || forced === 'empty' || forced === 'nodata' ? forced : undefined),
  };
}

// ---------------------------------------------------------------------------
// Job Apollo (apollo-lookalike T16): "Apollo finto" dietro il client vero
// ---------------------------------------------------------------------------
//
// Le deps dei job Apollo eseguono le richieste di `requests.ts` con `createApolloClient` e un `fetch` finto
// che risponde con le fixture `apollo-*.json` (layout reale: ricerca aziende senza campi descrittivi,
// `bulk_enrich` completo, ricerca persone senza URL LinkedIn, `bulk_match` con `matches[]` allineati e
// `credits_consumed`). Gli errori escono dal client stesso a partire dallo stato HTTP simulato: stesse
// classi (`ApolloConfigError`, `ApolloRateLimitError` con o senza `window`, `ApolloProviderError`) e stessi
// testi della produzione, così gli handler prendono le stesse strade.

/** Chiavi Apollo che le deps fake servono (tutte e quattro: la pipeline usa anche quelle dei contatti). */
type ApolloFakeDeps = LookalikeDeps & EnrichCompaniesDeps & ApolloPeopleDeps;

/** Kind che chiamano Apollo (`enrich` solo con `provider: 'apollo'`). */
type ApolloKind = 'enrich_companies' | 'lookalike_companies' | 'apollo_people' | 'enrich';

/** Risposta HTTP simulata. */
interface FakeReply {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

/** `PARTIAL`: 429 oltre i tentativi alla **2ª** chiamata di queste operazioni (pagina, azienda, lotto 2). */
const PARTIAL_OPS: Record<ApolloKind, readonly ApolloOp[]> = {
  enrich_companies: ['organizations/bulk_enrich'],
  lookalike_companies: ['mixed_companies/search', 'mixed_people/api_search'],
  apollo_people: ['mixed_people/api_search'],
  enrich: ['people/bulk_match'],
};

/** `HOURLY`: limite orario esaurito alla **2ª** chiamata di arricchimento o match (qualunque kind). */
const HOURLY_OPS: readonly ApolloOp[] = ['organizations/bulk_enrich', 'people/bulk_match'];

/** Risposta d'errore dello scenario per la chiamata `n` dell'operazione; `undefined` = risposta normale. */
function apolloFailure(kind: ApolloKind, op: ApolloOp, scenario: E2eScenario, n: number): FakeReply | undefined {
  switch (scenario) {
    case 'fail':
      return { status: 500, body: { error: `${SIMULATED} (Apollo non disponibile)` } };
    case 'badkey':
      return { status: 401, body: { error: 'Invalid access credentials.' } };
    case 'noscope':
      return op === 'mixed_people/api_search' ? { status: 403, body: { error: 'Forbidden: API key without people search scope.' } } : undefined;
    case 'partial':
      return n === 2 && PARTIAL_OPS[kind].includes(op)
        ? { status: 429, body: { error: 'Too many requests.' }, headers: { 'retry-after': '60' } }
        : undefined;
    case 'hourly':
      return n === 2 && HOURLY_OPS.includes(op)
        ? { status: 429, body: { error: 'Hourly limit reached.' }, headers: { 'x-rate-limit-hourly': '100', 'x-hourly-requests-left': '0' } }
        : undefined;
    default:
      return undefined;
  }
}

interface ApolloSearchFixture {
  /** Organizzazioni nel layout della ricerca, nell'ordine delle pagine. */
  organizations: FixtureItem[];
  /** Item che nessun mapper riconosce (scenario `UNRECOGNIZED`). */
  unrecognized: FixtureItem[];
}

interface ApolloPeopleFixture {
  /** Persone "modello" per qualunque dominio: `{dominio}`, `{slug}`, `{azienda}` si riempiono. */
  default: FixtureItem[];
  /** Persone fisse per dominio. */
  companies: Record<string, FixtureItem[]>;
}

interface ApolloMatchFixture {
  /** Persona rivelata per ruolo dei modelli: id `e2e--<ruolo>--<dominio>`. */
  default: Record<string, FixtureItem>;
  /** Persone fisse, abbinate per id Apollo o per URL LinkedIn. */
  people: FixtureItem[];
}

/** Segnaposto dei modelli di persona per un dominio. */
function apolloVars(domain: string): Record<string, string> {
  return { dominio: domain, slug: domain.replace(/\./g, '-'), azienda: findCompanyByDomain(domain)?.name ?? domain };
}

/** Una pagina di `mixed_companies/search`: le organizzazioni della fixture tagliate per `perPage`. */
function searchBody(page: number, perPage: number, scenario: E2eScenario): unknown {
  const data = fixture<ApolloSearchFixture>('apollo-search.json');
  const all = scenario === 'empty' ? [] : scenario === 'unrecognized' ? data.unrecognized : data.organizations;
  const start = (page - 1) * perPage;
  const organizations = all.slice(start, start + perPage);
  return {
    breadcrumbs: [],
    partial_results_only: false,
    has_join: false,
    disable_eu_prospecting: false,
    partial_results_limit: 10000,
    pagination: { page, per_page: perPage, total_entries: all.length, total_pages: Math.ceil(all.length / perPage) },
    accounts: [],
    organizations,
    model_ids: organizations.map((o) => o.id).filter(Boolean),
    num_fetch_result: null,
  };
}

/** `organizations/bulk_enrich`: le organizzazioni della fixture con quei domini (assente = non trovata). */
function bulkEnrichBody(domains: readonly string[], scenario: E2eScenario): unknown {
  const all = scenario === 'empty' ? [] : fixture<{ organizations: FixtureItem[] }>('apollo-organizations.json').organizations;
  const organizations = domains.flatMap((d) => all.filter((o) => o.primary_domain === normalizeDomain(d)));
  return {
    status: 'success',
    error_code: null,
    error_message: null,
    total_requested_domains: domains.length,
    unique_domains: new Set(domains).size,
    unique_enriched_records: organizations.length,
    missing_records: domains.length - organizations.length,
    organizations,
  };
}

/** `mixed_people/api_search` di un dominio: persone fisse o modello, tagliate al tetto per azienda. */
function peopleBody(domain: string, perPage: number, scenario: E2eScenario): unknown {
  if (scenario === 'empty') return { total_entries: 0, people: [] };
  const data = fixture<ApolloPeopleFixture>('apollo-people.json');
  const people = data.companies[domain] ?? fillTemplate(data.default, apolloVars(domain));
  return { total_entries: people.length, people: people.slice(0, perPage) };
}

/** Persona rivelata per un dettaglio del match: id fisso, id di un modello, oppure URL LinkedIn. */
function matchedPerson(data: ApolloMatchFixture, detail: PeopleMatchDetail): FixtureItem | null {
  if (detail.id !== undefined) {
    const fixed = data.people.find((p) => p.id === detail.id);
    if (fixed) return fixed;
    const model = /^e2e--(.+?)--(.+)$/.exec(detail.id);
    const template = model ? data.default[model[1]!] : undefined;
    return template ? fillTemplate(template, apolloVars(model![2]!)) : null;
  }
  const url = normalizeProfileUrl(detail.linkedin_url);
  return (url && data.people.find((p) => normalizeProfileUrl(p.linkedin_url) === url)) || null;
}

/** `people/bulk_match`: `matches[]` allineati ai dettagli (`null` = non abbinata), 1 credito per abbinata. */
function matchBody(details: readonly PeopleMatchDetail[], scenario: E2eScenario): unknown {
  const data = fixture<ApolloMatchFixture>('apollo-match.json');
  const matches = details.map((d) => (scenario === 'empty' ? null : matchedPerson(data, d)));
  const found = matches.filter((m) => m !== null).length;
  return {
    status: 'success',
    error_code: null,
    error_message: null,
    total_requested_enrichments: details.length,
    unique_enriched_records: found,
    missing_records: details.length - found,
    credits_consumed: found,
    matches,
  };
}

/** Testi del job Apollo in corso per le parole chiave: nome dell'ICP e delle liste (con il loro ICP). */
function apolloJobTexts(kind: ApolloKind): Array<string | null | undefined> {
  const jobId = currentJobId();
  const job = jobId === undefined ? undefined : findJob(jobId);
  if (!job || job.kind !== kind) return [];
  const params = job.params as Record<string, unknown>;
  const texts: Array<string | null | undefined> = [];
  const addList = (id: unknown) => {
    const list = typeof id === 'number' ? getList(id) : null;
    if (list) texts.push(list.name, getIcp(list.icp_id)?.name);
  };
  if (typeof params.icpId === 'number') texts.push(getIcp(params.icpId)?.name);
  addList(params.listId);
  const auto = params.autoContacts;
  if (auto && typeof auto === 'object') addList((auto as { listId?: unknown }).listId);
  return texts;
}

/** Nome, azienda, ruolo e URL dei prospect di un lotto di match (arricchimento con provider Apollo). */
function prospectTexts(details: readonly PeopleMatchDetail[]): Array<string | null | undefined> {
  const byId = db.prepare('SELECT full_name, company_name, title, linkedin_url FROM prospects WHERE apollo_person_id = ?');
  const byUrl = db.prepare('SELECT full_name, company_name, title, linkedin_url FROM prospects WHERE linkedin_url = ?');
  return details.flatMap((d) => {
    const row = (d.id !== undefined ? byId.get(d.id) : byUrl.get(normalizeProfileUrl(d.linkedin_url) ?? '')) as
      | Record<string, string | null>
      | undefined;
    return row ? [row.full_name, row.company_name, row.title, row.linkedin_url] : [d.linkedin_url];
  });
}

/**
 * Deps Apollo fixture-backed del kind. Lo scenario si decide **a ogni chiamata**: `params.__fixture` del job,
 * altrimenti le parole `apollo-…` nei testi del job (`apolloJobTexts`) e della chiamata (domini e nomi delle
 * aziende, parole chiave e località della ricerca, prospect del match). La latenza finta vale una volta per
 * operazione (la pipeline farebbe decine di chiamate).
 */
function apolloDeps(kind: ApolloKind, forced: E2eScenario | undefined, opts: { delay?: boolean } = {}): ApolloFakeDeps {
  let reply: FakeReply = { status: 500, body: { error: 'nessuna risposta preparata' } };
  // Chiave fissa: i blocker di configurazione li applicano gli handler prima di chiamare le deps.
  const client = createApolloClient({
    apiKey: 'e2e-fake-apollo-key',
    sleep: async () => {},
    fetch: async () =>
      new Response(JSON.stringify(reply.body), {
        status: reply.status,
        headers: { 'content-type': 'application/json', ...reply.headers },
      }),
  });
  const calls = new Map<ApolloOp, number>();
  const jobTexts = apolloJobTexts(kind);
  // Azienda dell'ultima ricerca persone: i suoi match ne seguono lo scenario.
  let companyTexts: Array<string | null | undefined> = [];

  async function send(request: ApolloRequest, texts: Array<string | null | undefined>, body: (s: E2eScenario) => unknown) {
    const n = (calls.get(request.op) ?? 0) + 1;
    calls.set(request.op, n);
    if (n === 1 && opts.delay !== false) await latency();
    const scenario = forced ?? scenarioOfText([...jobTexts, ...texts], kind, APOLLO_TRIGGER_WORDS);
    reply = apolloFailure(kind, request.op, scenario, n) ?? { status: 200, body: body(scenario) };
    return client.post(request);
  }

  return {
    enrichOrganizations: (domains) =>
      send(
        enrichOrganizationsRequest(domains),
        domains.flatMap((d) => [d, findCompanyByDomain(d)?.name]),
        (s) => bulkEnrichBody(domains, s),
      ),
    searchOrganizations: (filters, page, perPage) =>
      send(
        searchOrganizationsRequest(filters, page, perPage),
        [...filters.keywords, ...filters.locations],
        (s) => searchBody(page, perPage, s),
      ),
    searchPeople: (params) => {
      companyTexts = [params.domain, findCompanyByDomain(params.domain)?.name];
      return send(searchPeopleRequest(params), companyTexts, (s) => peopleBody(params.domain, params.perPage, s));
    },
    matchPeople: (details) =>
      send(matchPeopleRequest(details), kind === 'enrich' ? prospectTexts(details) : companyTexts, (s) => matchBody(details, s)),
  };
}

// ---------------------------------------------------------------------------
// Reset del server e2e
// ---------------------------------------------------------------------------

/** Protegge i dati reali: il reset è ammesso solo nel server e2e e mai su `data/`. */
function assertE2eDatabase(): void {
  if (process.env.E2E_FAKE_JOBS !== '1') {
    throw new Error('Reset dei dati consentito solo nel server e2e (E2E_FAKE_JOBS=1).');
  }
  const dataDir = path.join(ROOT, 'data') + path.sep;
  if (path.resolve(config.paths.db).startsWith(dataDir)) {
    throw new Error(`Reset rifiutato: DB_PATH punta ai dati reali (${config.paths.db}).`);
  }
}

/**
 * Azzera il DB del server e2e: svuota tutte le tabelle (anche quelle aggiunte in futuro) e
 * riparte dagli id 1, così gli scenari agent-browser hanno id prevedibili.
 */
export function resetE2eData(): { ok: true } {
  assertE2eDatabase();
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .pluck()
    .all() as string[];
  // I vincoli FK si sospendono solo fuori transazione; better-sqlite3 è sincrono, nessuno si infila.
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      for (const table of tables) db.prepare(`DELETE FROM "${table}"`).run();
      db.prepare('DELETE FROM sqlite_sequence').run();
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }
  return { ok: true };
}

/** Esito di `seedE2eData`: gli id per navigare subito (`/lists/<list_id>`, `/prospects/<id>`). */
export interface E2eSeed {
  profile_url: string;
  icp_id: number;
  list_id: number;
  company_id: number;
  sync_summary: string;
  prospects: Array<{ id: number; full_name: string | null; linkedin_url: string; in_list: boolean }>;
  /** Scenario Apollo (apollo-lookalike T16), dopo lo scenario base. */
  apollo: E2eApolloSeed;
}

/** Id dello scenario Apollo del seed: pagina ICP, liste, aziende e prospect da usare negli scenari. */
export interface E2eApolloSeed {
  /** ICP "HR tech Milano" (esempio della SPEC): referenze Acme (arricchita), Beta (da arricchire), Delta (senza sito). */
  icp_id: number;
  /** Lista attiva "HR tech Milano — decisori": 11 prospect senza email + Carlo Gentile (con email). */
  list_id: number;
  reference_ids: { acme: number; beta: number; delta: number };
  /** "Paghe Semplici Srl": solo dominio `nolinkedin.example`, nessuna referenza. */
  nolinkedin_company_id: number;
  /** ICP "Software house Torino" con la propria lista (liste raggruppate per ICP, SPEC F12). */
  other_icp_id: number;
  other_list_id: number;
  /** Referenze del secondo ICP: chiavi in conflitto con Apollo e dominio che Apollo non conosce. */
  other_reference_ids: { key_conflict: number; not_found: number };
  /** Carlo Gentile: possiede l'id Apollo `e2e-id-preso` (la persona `id-preso` dei contatti lo trova già preso). */
  id_taken_prospect_id: number;
  /** Prospect della lista senza email, abbinabili per URL dall'arricchimento Apollo. */
  email_target_prospect_ids: number[];
}

/** Profilo dell'utente nello scenario base (nessuna parola chiave di trigger). */
const E2E_SEED_PROFILE_URL = 'https://www.linkedin.com/in/utente-demo-e2e';

/** Prospect del sync messi in lista dallo scenario base (gli altri restano in Inbox). */
const SEED_LIST_MEMBERS = ['Luca Bernardi', 'Marco Ferri'];

/**
 * Scenario base per partire da un DB non vuoto: azzera, salva profilo e azienda, crea un ICP con
 * ruoli e un'azienda di riferimento vinta, una lista, esegue il sync fixture (7 prospect, senza
 * riga `jobs`) e mette 2 prospect in lista. Nessuna analisi né arricchimento.
 */
export async function seedE2eData(): Promise<E2eSeed> {
  resetE2eData();
  updateSettings({
    own_profile_url: E2E_SEED_PROFILE_URL,
    company_name: 'Officina Codice Srl',
    company_description:
      'Sviluppo software su misura e migrazioni al cloud per PMI manifatturiere e logistiche italiane, senza fermare la produzione.',
    company_offering: 'Assessment tecnico di due settimane, poi un team dedicato che affianca quello interno.',
  });
  const icp = createIcp({
    name: 'CTO di PMI manifatturiere',
    description: 'Responsabili tecnici di PMI industriali con un gestionale o una piattaforma da modernizzare.',
    target_roles: ['CTO', 'Head of Engineering', 'VP Engineering', 'IT Manager'],
    target_industries: ['Manifattura', 'Software industriale', 'Logistica'],
    target_locations: ['Italia'],
    company_size: '20-250 dipendenti',
    pains: 'Migrazioni al cloud che rischiano di fermare la produzione; turnover degli sviluppatori; fornitori poco affidabili.',
  });
  const company = createCompany({
    linkedin_url: 'https://www.linkedin.com/company/ferronova-digitale-e2e',
    name: 'Ferronova Digitale Srl',
    industry: 'Software per la manifattura',
    size: '51-200 dipendenti',
    location: 'Brescia',
  });
  setReferenceCompany(icp.id, company.id, { outcome: 'vinta', notes: 'Migrazione MES di uno stabilimento chiusa nel 2025.' });
  const list = createList({
    icpId: icp.id,
    name: 'CTO manifattura Nord Italia',
    description: 'Decisori tecnici da contattare questo trimestre.',
  })!;

  const sync = await syncInteractions({}, syncDeps('default', { delay: false }));
  const rows = db.prepare('SELECT id, full_name, linkedin_url FROM prospects ORDER BY id').all() as Array<
    Omit<E2eSeed['prospects'][number], 'in_list'>
  >;
  const memberIds = rows.filter((r) => SEED_LIST_MEMBERS.includes(r.full_name ?? '')).map((r) => r.id);
  addMembers(list.id, memberIds);
  const apollo = await seedApollo();

  return {
    profile_url: E2E_SEED_PROFILE_URL,
    icp_id: icp.id,
    list_id: list.id,
    company_id: company.id,
    sync_summary: sync.summary,
    prospects: rows.map((r) => ({ ...r, in_list: memberIds.includes(r.id) })),
    apollo,
  };
}

/** Prospect senza email della lista Apollo: [nome, slug, ruolo, azienda]. Abbinati per URL in `apollo-match.json`. */
const APOLLO_SEED_PROSPECTS: ReadonlyArray<[fullName: string, slug: string, title: string, company: string]> = [
  ['Marta Ferrari', 'marta-ferrari-e2e', 'Head of People', 'Gamma Welfare Srl'],
  ['Andrea Colombo', 'andrea-colombo-e2e', 'CTO', 'Turni Facili Srl'],
  ['Serena Fabbri', 'serena-fabbri-e2e', 'HR Director', 'Epsilon Paghe Cloud Srl'],
  ['Lorenzo Marini', 'lorenzo-marini-e2e', 'Head of Engineering', 'Welfare Lab Srl'],
  ['Giorgia Bellini', 'giorgia-bellini-e2e', 'Talent Acquisition Manager', 'Recluta Facile Srl'],
  ['Davide Rinaldi', 'davide-rinaldi-e2e', 'CTO', 'People Metrics Srl'],
  ['Elisa Caruso', 'elisa-caruso-e2e', 'Head of People', 'Onboard Italia Srl'],
  ['Riccardo Ferraro', 'riccardo-ferraro-e2e', 'HR Manager', 'Busta Chiara Srl'],
  ['Valeria Testa', 'valeria-testa-e2e', 'Chief People Officer', 'HR Bridge Srl'],
  ['Simone Grasso', 'simone-grasso-e2e', 'CTO', 'Ferie Smart Srl'],
  ['Federico Mancini', 'federico-mancini-e2e', 'Head of People Operations', 'Benefit Hub Srl'],
];

/** Giorni fa dell'arricchimento Apollo di Acme nel seed ("arricchita il <data>"). */
const APOLLO_SEED_ENRICHED_DAYS_AGO = 7;

/**
 * Scenario Apollo del seed (apollo-lookalike T16): ICP dell'esempio SPEC con 3 referenze (Acme arricchita
 * col nucleo reale dell'arricchimento sulle fixture, Beta da arricchire, Delta senza sito) e una lista; azienda
 * solo-dominio `nolinkedin.example`; secondo ICP con lista e referenze "in conflitto" / "non trovata"; lista
 * con 11 prospect senza email + il proprietario dell'id Apollo `e2e-id-preso`. Nessuna candidata né job.
 */
async function seedApollo(): Promise<E2eApolloSeed> {
  const icp = createIcp({
    name: 'HR tech Milano',
    description: "Fornitori di software HR dell'area milanese simili ai clienti già vinti.",
    target_roles: ['CTO', 'Head of People'],
    target_industries: ['hr tech'],
    target_locations: ['Milano'],
    company_size: '10-50',
    pains: 'Integrazioni con paghe e presenze fragili; rilasci lenti; team tecnico piccolo.',
  });
  const acme = createCompany({
    linkedin_url: 'https://www.linkedin.com/company/acme-hr-software-e2e',
    website: 'https://www.acme-hr.example',
    name: 'Acme HR Software Srl',
  });
  const beta = createCompany({ website: 'beta-payroll.example', name: 'Beta Payroll Srl' });
  const delta = createCompany({ linkedin_url: 'https://www.linkedin.com/company/delta-people-e2e', name: 'Delta People Srl' });
  setReferenceCompany(icp.id, acme.id, { outcome: 'vinta', notes: 'Integrazione paghe–presenze chiusa nel 2025.' });
  setReferenceCompany(icp.id, beta.id, { outcome: 'vinta' });
  setReferenceCompany(icp.id, delta.id, { outcome: 'in_trattativa' });
  await enrichCompanies([acme.id], apolloDeps('enrich_companies', 'default', { delay: false }), {
    now: Date.now() - APOLLO_SEED_ENRICHED_DAYS_AGO * DAY_MS,
  });
  const list = createList({ icpId: icp.id, name: 'HR tech Milano — decisori', description: 'Contatti Apollo delle aziende simili.' })!;
  const nolinkedin = createCompany({ website: 'nolinkedin.example', name: 'Paghe Semplici Srl' });

  const other = createIcp({
    name: 'Software house Torino',
    target_roles: ['CTO', 'Head of Engineering'],
    target_industries: ['software house'],
    target_locations: ['Torino'],
    company_size: '20-100',
  });
  const conflict = createCompany({
    linkedin_url: 'https://www.linkedin.com/company/conflitto-chiavi-e2e',
    website: 'conflitto-chiavi.example',
    name: 'Conflitto Chiavi Srl',
  });
  const notFound = createCompany({ website: 'non-trovata.example', name: 'Non Trovata Srl' });
  setReferenceCompany(other.id, conflict.id, { outcome: 'vinta' });
  setReferenceCompany(other.id, notFound.id, { outcome: 'persa' });
  const otherList = createList({ icpId: other.id, name: 'Software house — CTO' })!;

  const targets = APOLLO_SEED_PROSPECTS.map(([fullName, slug, title, companyName]) => {
    const { id } = upsertProspect({
      linkedinUrl: `https://www.linkedin.com/in/${slug}`,
      fullName,
      title,
      companyName,
      headline: `${title} @ ${companyName}`,
    });
    addSource(id, { kind: 'manual' });
    return id;
  });
  const owner = upsertProspect({
    linkedinUrl: 'https://www.linkedin.com/in/carlo-gentile-e2e',
    fullName: 'Carlo Gentile',
    title: 'HR Director',
    headline: 'HR Director @ Acme HR Software',
    companyId: acme.id,
    companyName: 'Acme HR Software Srl',
    email: 'carlo.gentile@acme-hr.example',
    apolloPersonId: 'e2e-id-preso',
  }).id;
  addSource(owner, { kind: 'manual' });
  addMembers(list.id, [...targets, owner]);

  return {
    icp_id: icp.id,
    list_id: list.id,
    reference_ids: { acme: acme.id, beta: beta.id, delta: delta.id },
    nolinkedin_company_id: nolinkedin.id,
    other_icp_id: other.id,
    other_list_id: otherList.id,
    other_reference_ids: { key_conflict: conflict.id, not_found: notFound.id },
    id_taken_prospect_id: owner,
    email_target_prospect_ids: targets,
  };
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * Deps fake del kind. Lo scenario del job (`params.__fixture`) si legge qui, alla risoluzione:
 * nel processo figlio `JOB_ID` identifica la riga; nel processo del server (analisi singola
 * sincrona) `JOB_ID` non c'è e valgono solo i trigger nei dati.
 */
export function fakeDeps<K extends JobKind>(kind: K): DepsByKind[K] {
  const forced = jobScenario(kind);
  const factories: { [P in JobKind]: () => DepsByKind[P] } = {
    sync_interactions: () => syncDeps(forced),
    source_company: () => sourceDeps(forced),
    enrich: () => enrichDeps(forced),
    analyze: () => analyzeDeps(forced),
    enrich_companies: () => {
      const { enrichOrganizations } = apolloDeps('enrich_companies', forced);
      return { enrichOrganizations };
    },
    lookalike_companies: () => apolloDeps('lookalike_companies', forced),
    apollo_people: () => {
      const { searchPeople, matchPeople } = apolloDeps('apollo_people', forced);
      return { searchPeople, matchPeople };
    },
  };
  return factories[kind]() as DepsByKind[K];
}
