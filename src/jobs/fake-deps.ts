import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AnalysisClient, AnalysisResponse } from '../analysis/analyze.js';
import { SUMMARY_MAX_CHARS, type AnalysisOutput } from '../analysis/schema.js';
import { ACTORS } from '../apify/actors.js';
import { config, ROOT } from '../config.js';
import { createCompany, findCompanyByUrl } from '../db/companies.js';
import { createIcp, setReferenceCompany } from '../db/icps.js';
import { db } from '../db/index.js';
import { findJob } from '../db/jobs.js';
import { addMembers, createList } from '../db/lists.js';
import { getSettings, updateSettings } from '../db/settings.js';
import { mapProfileDetailItem, type Enrichment } from '../enrich/profile-detail.js';
import { memberIdOf, normalizeLinkedinUrl } from '../util/fields.js';
import type { Deps as AnalyzeDeps } from './analyze.js';
import type { Deps as EnrichDeps } from './enrich.js';
import type { DepsByKind } from './handlers.js';
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
 */

const FIXTURES_DIR = path.join(ROOT, 'tests', 'fixtures', 'e2e');
const DAY_MS = 86_400_000;

/** Testo comune degli errori simulati: `FAIL_ONCE` riconosce i fallimenti precedenti da qui. */
const SIMULATED = 'errore simulato dal server e2e';

/** Percorso pilotato: `default` = fixture complete. */
type E2eScenario = 'default' | 'empty' | 'fail' | 'warn' | 'partial' | 'nodata';

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

/** Scenario da un valore di `__fixture` (`EMPTY`, `FAIL`, `FAIL_ONCE`, `WARN`, `PARTIAL`, `NODATA`). */
function scenarioOfFixture(value: string, kind: JobKind): E2eScenario {
  const v = value.trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (v === 'fail-once') return failOnce(kind);
  if (v === 'empty' || v === 'fail' || v === 'warn' || v === 'partial' || v === 'nodata') return v;
  if (v !== 'default') console.warn(`[e2e] __fixture sconosciuto: ${value} (uso le fixture complete)`);
  return 'default';
}

/**
 * Parole chiave nei dati, per kind e in ordine di precedenza. Distinte per kind perché i dati
 * si propagano: le persone estratte da `company/acme-nodata` hanno `acme-nodata` nello slug e
 * arrivano "senza dati" all'arricchimento, mentre `fail` nello slug azienda fermerebbe già il sourcing.
 */
const TRIGGER_WORDS: Record<JobKind, Array<[word: string, scenario: E2eScenario | 'fail-once']>> = {
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
};

/** Scenario dalle parole chiave nei testi (minuscolo, spazi come trattini: "Acme Nodata" vale `acme-nodata`). */
function scenarioOfText(texts: Array<string | null | undefined>, kind: JobKind): E2eScenario {
  const haystack = texts.map((t) => (t ?? '').toLowerCase().replace(/\s+/g, '-')).join(' ');
  const hit = TRIGGER_WORDS[kind].find(([word]) => haystack.includes(word));
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

  return {
    profile_url: E2E_SEED_PROFILE_URL,
    icp_id: icp.id,
    list_id: list.id,
    company_id: company.id,
    sync_summary: sync.summary,
    prospects: rows.map((r) => ({ ...r, in_list: memberIds.includes(r.id) })),
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
  };
  return factories[kind]() as DepsByKind[K];
}
