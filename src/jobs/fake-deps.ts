import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { analysisContext, analysisInput, type AnalysisClient, type AnalysisResponse } from '../analysis/analyze.js';
import { SERVICES_HEADING } from '../analysis/prompt.js';
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
import { changeStatus } from '../db/activities.js';
import { saveAnalysis } from '../db/analyses.js';
import { setManualFit } from '../db/fits.js';
import { createIcp, getIcp, getIcpContext, setReferenceCompany } from '../db/icps.js';
import { db } from '../db/index.js';
import { completeJob, findJob, insertJob } from '../db/jobs.js';
import { appendRunLog } from '../db/runs.js';
import { addMembers, createList, getList } from '../db/lists.js';
import { createPerson } from '../db/people.js';
import { setNextAction } from '../db/next-actions.js';
import { addDays, addSource, updateProspect, upsertProspect } from '../db/prospects.js';
import { LEGACY_EXCERPT_MAX } from '../db/schema.js';
import { getSettings, updateSettings } from '../db/settings.js';
import { mapProfileDetailItem, type Enrichment } from '../enrich/profile-detail.js';
import { runLog } from '../runs/log.js';
import { localDate, memberIdOf, normalizeDomain, normalizeLinkedinUrl, normalizeProfileUrl, truncate } from '../util/fields.js';
import type { Deps as AnalyzeDeps } from './analyze.js';
import type { Deps as ApolloPeopleDeps } from './apollo-people.js';
import { enrichCompanies, type Deps as EnrichCompaniesDeps } from './enrich-companies.js';
import type { Deps as EnrichDeps } from './enrich.js';
import type { DepsByKind } from './handlers.js';
import type { Deps as LookalikeDeps } from './lookalike-companies.js';
import type { EmployeeFilters, Deps as SourceDeps } from './source-company.js';
import { syncInteractions, type Deps as SyncDeps } from './sync-interactions.js';
import { NotImplementedError, type JobKind } from './types.js';

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
type E2eScenario =
  | 'default'
  | 'empty'
  | 'fail'
  | 'warn'
  | 'partial'
  | 'nodata'
  | 'noscope'
  | 'unrecognized'
  | 'hourly'
  | 'badkey'
  /** `LOG_FLOOD`: dati normali, ma il log del run supera il tetto di J11 (troncamento nel dettaglio). */
  | 'log-flood';

const FIXTURE_SCENARIOS: readonly E2eScenario[] = [
  'empty',
  'fail',
  'warn',
  'partial',
  'nodata',
  'noscope',
  'unrecognized',
  'hourly',
  'badkey',
  'log-flood',
];

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
  // own-profile-services: definite con le deps finte del kind (T29).
  generate_profile: [],
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

/** Righe oltre il tetto di J11 (5.000), per vedere l'avviso di troncamento nel dettaglio del run. */
function floodRunLog(): void {
  for (let i = 1; i <= 5_500; i += 1) runLog.info(`Riga di prova ${i} (log lungo simulato dal server e2e)`);
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
/** Marcatore della persona per cui il modello nomina un servizio che non esiste (own-profile-services F3). */
const UNKNOWN_SERVICE_MARKER = 'e2e-servizio-inesistente';

/**
 * I servizi che il system prompt elenca (own-profile-services F1, F2): ci sono solo quando il prompt chiede il
 * servizio più affine, e allora la risposta finta lo porta come farebbe il modello.
 */
function servicesIn(system: unknown): string[] {
  if (typeof system !== 'string' || !system.includes(SERVICES_HEADING)) return [];
  const lines = system.slice(system.indexOf(SERVICES_HEADING) + SERVICES_HEADING.length).split('\n').slice(1);
  const end = lines.findIndex((l) => !l.startsWith('- '));
  return lines.slice(0, end === -1 ? undefined : end).map((l) => l.slice(2).split(' — ')[0].trim());
}

function userText(body: Parameters<AnalysisClient['messages']['create']>[0]): string {
  return body.messages
    .map((m) => (typeof m.content === 'string' ? m.content : m.content.map((b) => ('text' in b ? b.text : '')).join('\n')))
    .join('\n');
}

/**
 * Risposta del modello per il messaggio: marcatore `e2e-…` nei dati, poi profilo nominato nella
 * fixture (per `Nome:`), altrimenti l'analisi di default personalizzata.
 */
function analysisResponse(user: string, services: string[]): AnalysisResponse {
  const data = fixture<AnalysisFixture>('analysis.json');
  const line = (label: string) => new RegExp(`^${label}: (.+)$`, 'm').exec(user)?.[1]?.trim();
  const name = line('Nome') ?? 'Questa persona';
  const markers = user.toLowerCase().replace(/[ \t]+/g, '-');
  const marker = ANALYSIS_MARKER.exec(markers);
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
  if (services.length > 0) {
    // Il primo servizio dell'elenco, oppure (col marcatore) un nome che non è tra i servizi: analisi valida lo stesso.
    analysis.best_service = markers.includes(UNKNOWN_SERVICE_MARKER) ? 'Consulenza che non esiste' : services[0];
    analysis.best_service_reason = `Il primo dei tuoi servizi: analisi di esempio del server e2e, nessun modello è stato chiamato.`;
  }
  return { content: [{ type: 'text', text: JSON.stringify(analysis) }], stop_reason: 'end_turn' };
}

function analyzeDeps(forced: E2eScenario | undefined): AnalyzeDeps {
  return {
    client: {
      messages: {
        create: async (body) => {
          await latency();
          if (forced === 'fail') throw simulatedError('API del modello non raggiungibile');
          return analysisResponse(userText(body), servicesIn(body.system));
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
    log: runLog.warn,
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

/** `DB_PATH` dentro `data/` = i dati reali: reset, seed e volume li rifiutano. */
function assertNotRealData(what: string): void {
  if (path.resolve(config.paths.db).startsWith(path.join(ROOT, 'data') + path.sep)) {
    throw new Error(`${what} rifiutato: DB_PATH punta ai dati reali (${config.paths.db}).`);
  }
}

/** Protegge i dati reali: il reset è ammesso solo nel server e2e e mai su `data/`. */
function assertE2eDatabase(): void {
  if (process.env.E2E_FAKE_JOBS !== '1') {
    throw new Error('Reset dei dati consentito solo nel server e2e (E2E_FAKE_JOBS=1).');
  }
  assertNotRealData('Reset');
}

const BULK_FIRST = ['Marco', 'Giulia', 'Luca', 'Sara', 'Andrea', 'Chiara', 'Paolo', 'Elena', 'Davide', 'Francesca', 'Matteo', 'Anna', 'Stefano', 'Laura', 'Simone', 'Martina'];
const BULK_LAST = ['Rossi', 'Bianchi', 'Ferrari', 'Esposito', 'Romano', 'Colombo', 'Ricci', 'Marino', 'Greco', 'Bruno', 'Gallo', 'Conti', 'De Luca', 'Mancini', 'Costa', 'Giordano', 'Rizzo', 'Lombardi', 'Moretti', 'Barbieri'];
const BULK_TITLES = ['CTO', 'Head of Engineering', 'CFO', 'Marketing Manager', 'IT Manager', 'CEO', 'Operations Director', 'Sales Manager'];
const BULK_COMPANY = ['Tecno', 'Nord', 'Sud', 'Alpi', 'Mare', 'Digitale', 'Industrie', 'Logistica', 'Software', 'Meccanica'];

/**
 * Volume per il perf (people-first-crm T21, PLAN P-18) **in aggiunta** ai dati presenti: `companies` aziende con
 * dominio e pagina LinkedIn, `people` persone con nomi combinati, LinkedIn `bulk-…`, ruolo e azienda scritta, una su
 * tre collegata a un'azienda, metà con email, una fonte ciascuna (una su cinque "aggiunta a mano" con il contesto
 * dell'incontro in una nota, le altre "persone di un'azienda"), una su venti con una prossima azione da −3 a +10
 * giorni, una su venti scartata. SQL diretto in una transazione: 10.000 persone in pochi secondi.
 */
export function seedBulkPeople(people = 10_000, companies = 2_000): { people: number; companies: number } {
  // Aggiunge righe senza cancellare: basta che il DB non sia quello dei dati reali (anche fuori dal server e2e).
  assertNotRealData('Volume');
  const tag = Date.now().toString(36);
  const today = localDate();
  const now = Date.now();
  const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
  db.transaction(() => {
    const insertCompany = db.prepare(`INSERT INTO companies (name, domain, linkedin_url, website, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`);
    const companyIds: number[] = [];
    for (let i = 0; i < companies; i++) {
      const name = `${BULK_COMPANY[i % BULK_COMPANY.length]} ${BULK_COMPANY[Math.floor(i / BULK_COMPANY.length) % BULK_COMPANY.length]} ${i} Srl`;
      const domain = `bulk-${tag}-${i}.example`;
      companyIds.push(
        Number(insertCompany.run(name, domain, `https://www.linkedin.com/company/bulk-${tag}-${i}`, `https://${domain}`, at(i), at(i)).lastInsertRowid),
      );
    }
    const insertPerson = db.prepare(
      `INSERT INTO prospects (linkedin_url, full_name, headline, title, company_name, company_id, email, location, status,
         status_changed_at, next_action_on, next_action_text, next_action_set_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Italia', ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertSource = db.prepare(`INSERT INTO sources (prospect_id, kind, company_id, raw_json, captured_at) VALUES (?, ?, ?, ?, ?)`);
    const insertNote = db.prepare(`INSERT INTO activities (prospect_id, kind, body, meta, occurred_at, created_at) VALUES (?, 'note', ?, ?, ?, ?)`);
    for (let i = 0; i < people; i++) {
      const first = BULK_FIRST[i % BULK_FIRST.length];
      const last = BULK_LAST[Math.floor(i / BULK_FIRST.length) % BULK_LAST.length];
      const title = BULK_TITLES[i % BULK_TITLES.length];
      const companyId = companyIds.length > 0 ? companyIds[i % companyIds.length] : null;
      const companyName = companyId !== null ? `Azienda ${i % Math.max(companyIds.length, 1)}` : null;
      const discarded = i % 20 === 7;
      const action = i % 20 === 3 ? addDays(today, (i % 14) - 3) : null;
      const created = at(i);
      const id = Number(
        insertPerson.run(
          `https://www.linkedin.com/in/bulk-${tag}-${i}`,
          `${first} ${last}`,
          `${title} @ ${companyName ?? 'freelance'}`,
          title,
          companyName,
          i % 3 === 0 ? companyId : null,
          i % 2 === 0 ? `${first}.${last}.${i}@bulk-${tag}.example`.toLowerCase().replace(/\s+/g, '') : null,
          discarded ? 'scartato' : 'nuovo',
          discarded ? created : null,
          action,
          action ? 'Richiamare' : null,
          action ? created : null,
          created,
          created,
        ).lastInsertRowid,
      );
      if (i % 5 === 0 || companyId === null) {
        const metOn = addDays(today, -(i % 60));
        insertSource.run(id, 'manual', null, JSON.stringify({ met_on: metOn }), created);
        insertNote.run(id, `Evento ${i % 40}: conosciuto al tavolo tecnico`, JSON.stringify({ meeting: { met_on: metOn } }), `${metOn}T12:00:00.000Z`, created);
      } else {
        insertSource.run(id, 'company_employees', companyId, null, created);
      }
    }
  })();
  return { people, companies };
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
  prospects: Array<{ id: number; full_name: string | null; linkedin_url: string | null; in_list: boolean }>;
  /** Scenario Apollo (apollo-lookalike T16), dopo lo scenario base. */
  apollo: E2eApolloSeed;
  /** Scenario people-first-crm (T9): persone a mano, doppioni, prossima azione. */
  people: E2ePeopleSeed;
  /** Scenario people-first-crm (T30): run con log, esiti e strumenti per Connessioni. */
  runs: E2eRunsSeed;
  /** Scenario own-profile-services (T6): post misti, una persona cambiata dopo l'analisi, tre già analizzate. */
  own_profile: E2eOwnProfileSeed;
}

/** Id dello scenario own-profile-services del seed (FLOW F.3–F.6, edge case "Post misti"). */
export interface E2eOwnProfileSeed {
  /** Post salvato come prima del rilascio: estratto troncato di `truncate(testo, 300)`, `text_complete = 0` (C6). */
  truncated_post_id: number | null;
  /** Post con testo integrale (`text_complete = 1`). */
  complete_post_id: number | null;
  /**
   * "Elena Sartori", aggiunta a mano con LinkedIn e About: analisi AI **medio** per l'ICP 1, poi l'About corretto a
   * mano dopo l'analisi → la sua analisi risulta **da aggiornare** (F13). Nessun'altra analisi del seed lo è.
   */
  stale_id: number;
  /** Tre persone con un'analisi per l'ICP 1 (Luca Bernardi, Marco Ferri, Elena Sartori): la selezione di F8. */
  analyzed_ids: number[];
}

/** Run del seed (FLOW G.2–G.6): uno per strumento, più un run precedente al rilascio del log. */
export interface E2eRunsSeed {
  /** "Contatti Apollo" fallito per la chiave Apollo (401): Apollo risulta `failing` in Connessioni (J5). */
  apollo_failed_id: number;
  /** "Analisi" fallita per `ANTHROPIC_API_KEY` con Apify tra gli strumenti: conta solo per Anthropic (J4). */
  anthropic_failed_id: number;
  /** "Sync interazioni" completato con avvisi: Apify resta sano. */
  apify_warned_id: number;
  /** Run precedente al rilascio del log (`logged = 0`): "Log non disponibile per questo run" (J11). */
  legacy_id: number;
}

/** Id dello scenario people-first-crm del seed (FLOW A, C10, C8, F, B). */
export interface E2ePeopleSeed {
  /** "Giulia Neri" aggiunta a mano con sola email e contesto "DevFest Milano" (FLOW F): fuori da Da smistare. */
  manual_email_only_id: number;
  /** "Giulia Neri" arrivata dai job con LinkedIn `giulia-neri-e2e` e id membro (FLOW F: il conflitto di Unisci). */
  giulia_jobs_id: number;
  /** "Sara Conti" senza LinkedIn né email (C10: avviso per nome). */
  no_linkedin_id: number;
  /** "Anna Bianchi" e "Ufficio Beta": stessa email `info@beta-e2e.example` (C8). */
  shared_email_ids: number[];
  /** "Marco Riva" dai job (commento), LinkedIn `marco-riva-e2e` (C7) con prossima azione a oggi + 10 giorni. */
  linkedin_known_id: number;
  next_action_id: number;
  /** Azienda "Nuvola Srl" (`nuvola.example`) per il campo Azienda del form (FLOW A.2). */
  nuvola_company_id: number;
  /**
   * Fit (T19, FLOW E): "Luca Bernardi" con l'analisi AI **medio** per l'ICP 1 e nessun fit tuo; "Marco Ferri" con AI
   * **medio** e fit tuo **alto** ("Tuo: alto · AI: medio").
   */
  ai_medio_id: number;
  manual_fit_id: number;
  /**
   * Prossime azioni relative al giorno del seed (T23, FLOW D): Paolo Ranieri **scaduta** (oggi − 3, *"Richiamare per
   * la demo"*), Sara Conti **oggi** (*"Mandare la proposta"*), Anna Bianchi tra 3 giorni (*"Follow-up dopo
   * l'evento"*), Federico Mancini **scartato** con una prossima azione a ieri (fuori da Oggi); Marco Riva a + 10.
   */
  next_actions: { overdue_id: number; today_id: number; soon_id: number; discarded_id: number };
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
  const people = seedPeople(icp.id);
  const runs = seedRuns(apollo.icp_id, apollo.list_id);
  const own_profile = seedOwnProfile(icp.id, people);

  return {
    profile_url: E2E_SEED_PROFILE_URL,
    icp_id: icp.id,
    list_id: list.id,
    company_id: company.id,
    sync_summary: sync.summary,
    prospects: rows.map((r) => ({ ...r, in_list: memberIds.includes(r.id) })),
    apollo,
    people,
    runs,
    own_profile,
  };
}

/** Run finto già concluso, con il suo log: tempi realistici, nessun processo, nessuna spesa. */
function seedRun(
  kind: JobKind,
  params: object,
  tools: string[],
  opts: {
    minutesAgo: number;
    seconds: number;
    lines: Array<[level: 'info' | 'warn' | 'error', message: string]>;
    outcome: { error: string } | { summary: string; counts?: Record<string, number>; warnings?: string[] };
  },
): number {
  const job = insertJob(kind, params, tools);
  const start = Date.now() - opts.minutesAgo * 60_000;
  const end = start + opts.seconds * 1000;
  db.prepare('UPDATE jobs SET created_at = ?, started_at = ? WHERE id = ?').run(
    new Date(start).toISOString(),
    new Date(start).toISOString(),
    job.id,
  );
  appendRunLog(
    job.id,
    opts.lines.map(([level, message], i) => ({
      at: new Date(start + Math.round(((i + 1) / (opts.lines.length + 1)) * (end - start))).toISOString(),
      level,
      message,
    })),
  );
  if ('error' in opts.outcome) completeJob(job.id, { state: 'failed', error: opts.outcome.error });
  else {
    completeJob(job.id, {
      state: 'succeeded',
      result: { summary: opts.outcome.summary, counts: opts.outcome.counts ?? {}, warnings: opts.outcome.warnings ?? [] },
    });
  }
  db.prepare('UPDATE jobs SET finished_at = ? WHERE id = ?').run(new Date(end).toISOString(), job.id);
  return job.id;
}

/**
 * Run del seed (people-first-crm T30, FLOW G): uno fallito per Apollo, uno fallito per Anthropic in un run
 * che usa anche Apify (attribuzione J4), uno di Apify completato con avvisi e uno precedente al rilascio del
 * log. Righe `jobs` scritte a mano: nessun processo, nessuna chiamata.
 */
function seedRuns(icpId: number, listId: number): E2eRunsSeed {
  const apollo_failed_id = seedRun(
    'apollo_people',
    { icpId, companyIds: [], listId, roles: [], seniorities: [], locations: [], perCompany: 10 },
    ['apollo'],
    {
      minutesAgo: 35,
      seconds: 4,
      lines: [
        ['info', 'Avvio: Contatti Apollo'],
        ['info', 'Apollo · ricerca persone · Gamma Welfare Srl'],
        ['error', 'Errore su Gamma Welfare Srl: config: chiave Apollo rifiutata (401). Verifica APOLLO_API_KEY nel .env.'],
        ['error', 'Fine: fallito — config: chiave Apollo rifiutata (401). Verifica APOLLO_API_KEY nel .env.'],
      ],
      outcome: { error: 'config: chiave Apollo rifiutata (401). Verifica APOLLO_API_KEY nel .env.' },
    },
  );
  const anthropic_failed_id = seedRun('analyze', { prospectIds: [], icpId, force: false }, ['anthropic', 'apify'], {
    minutesAgo: 90,
    seconds: 12,
    lines: [
      ['info', 'Avvio: Analisi'],
      ['info', 'Apify · profilo · Marco Ferri'],
      ['error', 'Fine: fallito — config: ANTHROPIC_API_KEY non valida o senza permessi per il modello configurato.'],
    ],
    outcome: { error: 'config: ANTHROPIC_API_KEY non valida o senza permessi per il modello configurato.' },
  });
  const apify_warned_id = seedRun('sync_interactions', { force: false, postsOnly: false }, ['apify'], {
    minutesAgo: 180,
    seconds: 46,
    lines: [
      ['info', 'Avvio: Sync interazioni'],
      ['info', 'Apify · post del profilo'],
      ['info', '2 post letti · 2 da sincronizzare'],
      ['info', 'Apify · reazioni · pagina 1 (2 post)'],
      ['warn', '0 reazioni lette da 1 post che ne dichiara 12: riprova più tardi.'],
      ['info', 'Fine: completato con avvisi'],
    ],
    outcome: {
      summary: 'Sync: 2 post sincronizzati · 6 reazioni · 3 commenti · 7 persone nuove.',
      counts: { posts: 2, reactions: 6, comments: 3, prospects_new: 7 },
      warnings: ['0 reazioni lette da 1 post che ne dichiara 12: riprova più tardi.'],
    },
  });
  // Precedente al rilascio del log: la riga c'è, le righe no (J11).
  const legacy = insertJob('enrich', { prospectIds: [], provider: 'apify', onlyMissing: true, retryFailed: false }, ['apify']);
  const when = new Date(Date.now() - 5 * DAY_MS).toISOString();
  db.prepare('UPDATE jobs SET logged = 0, created_at = ?, started_at = ?, finished_at = ? WHERE id = ?').run(when, when, when, legacy.id);
  completeJob(legacy.id, { state: 'succeeded', result: { summary: 'Arricchimento: 4 arricchiti (3 con email).', counts: { enriched: 4 }, warnings: [] } });
  db.prepare('UPDATE jobs SET finished_at = ? WHERE id = ?').run(when, legacy.id);

  return { apollo_failed_id, anthropic_failed_id, apify_warned_id, legacy_id: legacy.id };
}

/** Crea una persona a mano per il seed (lancia se il form la rifiuterebbe: è un errore del seed). */
function seedManual(input: Parameters<typeof createPerson>[0]): number {
  const result = createPerson(input);
  if (!result.ok) throw new Error(`Seed e2e: persona a mano rifiutata (${result.code}).`);
  return result.id;
}

/**
 * Scenario people-first-crm (T9): due "Giulia Neri" (a mano con sola email / dai job con LinkedIn), "Sara
 * Conti" senza LinkedIn, due persone con la stessa email, "Marco Riva" dai job con una prossima azione a oggi
 * + 10 giorni (fuori dalle finestre di Oggi: i conteggi di Oggi restano fissi) e l'azienda "Nuvola Srl".
 */
function seedPeople(icpId: number): E2ePeopleSeed {
  const today = localDate();
  const postId = db.prepare('SELECT id FROM posts ORDER BY id LIMIT 1').pluck().get() as number;
  const fromJobs = (fields: Parameters<typeof upsertProspect>[0], kind: 'post_reaction' | 'post_comment', text?: string) => {
    const { id } = upsertProspect(fields);
    addSource(id, { kind, postId, reactionType: kind === 'post_reaction' ? 'LIKE' : null, commentText: text ?? null });
    return id;
  };

  const giuliaJobs = fromJobs(
    {
      linkedinUrl: 'https://www.linkedin.com/in/giulia-neri-e2e',
      memberUrn: 'ACoAAE2eGiuliaNeri0001AbCdEf',
      fullName: 'Giulia Neri',
      headline: 'CFO · Pagamenti Srl',
      title: 'CFO',
      companyName: 'Pagamenti Srl',
      location: 'Milano',
    },
    'post_reaction',
  );
  const giuliaManual = seedManual({
    fullName: 'Giulia Neri',
    email: 'giulia.neri@pagamenti-e2e.example',
    meeting: { context: 'DevFest Milano: talk sulla migrazione a Kubernetes, vuole una call a ottobre', metOn: addDays(today, -6) },
  });
  const sara = seedManual({
    fullName: 'Sara Conti',
    title: 'CFO',
    companyName: 'Pagamenti Srl',
    phone: '+39 02 1234 5678',
    meeting: { context: 'Meetup fintech di Milano', metOn: addDays(today, -20) },
  });
  const shared = [
    fromJobs(
      { linkedinUrl: 'https://www.linkedin.com/in/anna-bianchi-e2e', fullName: 'Anna Bianchi', title: 'Marketing', companyName: 'Beta', email: 'info@beta-e2e.example' },
      'post_comment',
      'Interessante, ne parliamo?',
    ),
    fromJobs(
      { linkedinUrl: 'https://www.linkedin.com/in/ufficio-beta-e2e', fullName: 'Ufficio Beta', companyName: 'Beta', email: 'info@beta-e2e.example' },
      'post_reaction',
    ),
  ];
  const marco = fromJobs(
    {
      linkedinUrl: 'https://www.linkedin.com/in/marco-riva-e2e',
      fullName: 'Marco Riva',
      headline: 'Head of Engineering @ Beta',
      title: 'Head of Engineering',
      companyName: 'Beta',
    },
    'post_comment',
    'Anche noi stiamo migrando a Kubernetes',
  );
  setNextAction(marco, { on: addDays(today, 10), text: 'Richiamare' });
  const nuvola = createCompany({ website: 'nuvola.example', name: 'Nuvola Srl' });

  // Fit (T19): analisi AI salvate come quelle del job (impronta della persona coerente: non "da aggiornare") + un
  // fit tuo.
  const byName = (name: string) => db.prepare('SELECT id FROM prospects WHERE full_name = ? ORDER BY id LIMIT 1').pluck().get(name) as number;
  const luca = byName('Luca Bernardi');
  const ferri = byName('Marco Ferri');
  saveSeedAnalysis(luca, icpId);
  saveSeedAnalysis(ferri, icpId);
  setManualFit(ferri, icpId, { fit: 'alto', reason: 'Ci ho parlato al DevFest: il progetto di migrazione parte a ottobre.' });

  // Prossime azioni (T23): scaduta, di oggi, tra 3 giorni e una su uno scartato (fuori da Oggi e dalla vista).
  const paolo = byName('Paolo Ranieri');
  const federico = byName('Federico Mancini');
  setNextAction(paolo, { on: addDays(today, -3), text: 'Richiamare per la demo' });
  setNextAction(sara, { on: today, text: 'Mandare la proposta' });
  setNextAction(shared[0], { on: addDays(today, 3), text: "Follow-up dopo l'evento" });
  setNextAction(federico, { on: addDays(today, -1), text: 'Ricontattare a gennaio' });
  changeStatus(federico, 'scartato');

  return {
    manual_email_only_id: giuliaManual,
    giulia_jobs_id: giuliaJobs,
    no_linkedin_id: sara,
    shared_email_ids: shared,
    linkedin_known_id: marco,
    next_action_id: marco,
    nuvola_company_id: nuvola.id,
    ai_medio_id: luca,
    manual_fit_id: ferri,
    next_actions: { overdue_id: paolo, today_id: sara, soon_id: shared[0], discarded_id: federico },
  };
}

/**
 * Analisi AI **medio** salvata come quella del job (analisi di default della fixture, stesse impronte di
 * `analysisInput`): per la scheda la persona non è cambiata dopo l'analisi.
 */
function saveSeedAnalysis(id: number, icpId: number): void {
  const icp = getIcpContext(icpId)!;
  const ctx = analysisContext(id, icp)!;
  const vars = { nome: ctx.prospect.full_name ?? '', headline: ctx.prospect.headline ?? '', icp: icp.icp.name };
  const output = fillTemplate(fixture<AnalysisFixture>('analysis.json').default, vars);
  const { inputHash, subjectHash } = analysisInput(ctx);
  saveAnalysis({ prospectId: id, icpId, icpName: icp.icp.name, model: config.analysisModel, output: { ...output, fit: 'medio' }, inputHash, subjectHash });
}

/**
 * Scenario own-profile-services (T6): l'armatura degli smoke di M1a. Post misti (C6): il post più lungo di 300
 * caratteri torna com'era salvato prima del rilascio (estratto troncato, `text_complete = 0`); l'altro resta
 * integrale. "Elena Sartori", aggiunta a mano (fuori da Da smistare e dalle liste), ha un'analisi e poi l'About
 * corretto a mano: è l'unica "da aggiornare" (F13). Con Luca Bernardi e Marco Ferri fa la selezione di tre già
 * analizzate per F8.
 */
function seedOwnProfile(icpId: number, people: E2ePeopleSeed): E2eOwnProfileSeed {
  const posts = db.prepare('SELECT id, text_excerpt FROM posts ORDER BY id').all() as Array<{ id: number; text_excerpt: string | null }>;
  const long = posts.find((p) => (p.text_excerpt?.length ?? 0) > LEGACY_EXCERPT_MAX);
  if (long) {
    db.prepare('UPDATE posts SET text_excerpt = ?, text_complete = 0 WHERE id = ?').run(truncate(long.text_excerpt, LEGACY_EXCERPT_MAX), long.id);
  }
  const complete = posts.find((p) => p.id !== long?.id);

  const created = createPerson({
    fullName: 'Elena Sartori',
    title: 'CTO',
    companyName: 'Logistica Adriatica Srl',
    linkedinUrl: 'https://www.linkedin.com/in/elena-sartori-e2e',
    meeting: { context: 'Webinar sulla migrazione dei WMS al cloud', metOn: addDays(localDate(), -12) },
  });
  if (!created.ok) throw new Error(`[e2e] seed: Elena Sartori non creata (${created.code})`);
  const elena = created.id;
  updateProspect(elena, { about: 'Guido un team di 12 sviluppatori; il WMS gira ancora su un server in sede.' });
  saveSeedAnalysis(elena, icpId);
  // Dopo l'analisi: About corretto a mano sulla scheda → la persona è cambiata (F13).
  updateProspect(elena, {
    about: 'Guido un team di 12 sviluppatori; il WMS gira ancora su un server in sede e lo migriamo al cloud entro il 2027.',
  });

  return {
    truncated_post_id: long?.id ?? null,
    complete_post_id: complete?.id ?? null,
    stale_id: elena,
    analyzed_ids: [people.ai_medio_id, people.manual_fit_id, elena],
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
  const scenario = jobScenario(kind);
  // `LOG_FLOOD` non cambia i dati: riempie il log per mostrare il troncamento (J11).
  if (scenario === 'log-flood') floodRunLog();
  const forced = scenario === 'log-flood' ? undefined : scenario;
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
    // Stub fino a T29 (own-profile-services): messaggio diverso da quello delle deps reali.
    generate_profile: () => {
      throw new NotImplementedError('generate_profile: deps finte (own-profile-services T29)');
    },
  };
  return factories[kind]() as DepsByKind[K];
}
