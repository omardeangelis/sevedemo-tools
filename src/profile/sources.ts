import { CLOUDFLARE_MIN_PAGE_TEXT_CHARS, createCloudflareClient, type CloudflareClient, type SiteRead } from '../cloudflare/client.js';
import { pageText } from '../cloudflare/mappers.js';
import { ACTORS } from '../apify/actors.js';
import { config } from '../config.js';
import { db, nowIso } from '../db/index.js';
import type { ProfileSourceKind, ProfileSourceOutcome } from '../db/schema.js';
import { getSettings } from '../db/settings.js';
import { enrichProfileDetails, type Enrichment } from '../enrich/profile-detail.js';
import { attributeError, withoutAttribution } from '../jobs/errors.js';
import { runLog } from '../runs/log.js';
import { redactSecrets, TOOLS, type ToolId } from '../runs/tools.js';
import { field, jsonObject, normalizeLinkedinUrl, siteUrl } from '../util/fields.js';

/*
 * Le tre fonti pubbliche della generazione del profilo (own-profile-services T23: C1–C5, C8, C11–C14, B9): il
 * profilo LinkedIn dell'utente (actor no-cookie, C3), il suo sito (Cloudflare, `readSite`: senza browser, con il
 * browser solo se quasi vuoto) e i suoi post già salvati per intero (C8). Il record d'impresa di Apollo non è una
 * fonte (decisione dell'utente del 2026-10-02, PLAN P-29): `apollo` resta nel CHECK di `profile_sources` senza righe.
 *
 * Ogni lettura è isolata (C12) e scrive la sua riga di `profile_sources` con esito e motivo (C13). Una lettura
 * riuscita dello **stesso indirizzo** entro `FRESHNESS_DAYS` non si ripaga (C4): se ne riprende il contenuto. Nessuna
 * scrittura tocca `companies` (B9). Il log dice quale strumento si chiama, mai cosa si legge (D10, D11).
 */

export const GENERATION_SOURCES = ['linkedin', 'website', 'posts'] as const satisfies readonly ProfileSourceKind[];
export type GenerationSource = (typeof GENERATION_SOURCES)[number];

export function isGenerationSource(value: unknown): value is GenerationSource {
  return (GENERATION_SOURCES as readonly unknown[]).includes(value);
}

/** Strumento esterno di ciascuna fonte: i post sono già nel CRM e non costano niente. */
export const SOURCE_TOOLS: Record<GenerationSource, ToolId | null> = { linkedin: 'apify', website: 'cloudflare', posts: null };

/** Tetti del testo passato al modello: un sito o un archivio di post grandi non diventano un prompt senza fine. */
const SITE_PAGE_MAX_CHARS = 8_000;
const SITE_MAX_CHARS = 40_000;
const POSTS_MAX_CHARS = 40_000;

const DAY_MS = 86_400_000;

/** Le due fonti che chiamano uno strumento esterno: deps iniettate (reali in `generate-profile.ts`, finte in e2e). */
export interface SourceDeps {
  /** Profilo LinkedIn con l'actor no-cookie (C3); `undefined` = l'actor non ha restituito il profilo. */
  readProfile: (url: string) => Promise<Enrichment | undefined>;
  /** Lettura del sito (`client.readSite`, un client per run: il ritmo di una richiesta ogni 10 s vive lì). */
  readSite: (input: { url: string; maxPages: number }) => Promise<SiteRead>;
}

/**
 * Deps reali: l'actor del profilo come l'arricchimento (`enrichProfileDetails`, un URL) e **un** client Cloudflare per
 * run, creato alla prima lettura del sito, che logga solo attese e ritentativi.
 */
export function realSourceDeps(): SourceDeps {
  let client: CloudflareClient | undefined;
  return {
    readProfile: async (url) => {
      if (!config.apifyToken.trim()) throw new Error('config: APIFY_TOKEN mancante nel .env: profilo LinkedIn non letto.');
      return (await enrichProfileDetails([url])).get(url);
    },
    readSite: (input) =>
      (client ??= createCloudflareClient({
        accountId: config.cloudflareAccountId,
        apiToken: config.cloudflareApiToken,
        log: runLog.warn,
      })).readSite(input),
  };
}

/** Riga di `profile_sources` senza il contenuto: ciò che anteprima, card ed esito mostrano (G5). */
export interface SourceRow {
  kind: GenerationSource;
  read_at: string;
  outcome: ProfileSourceOutcome;
  reason: string | null;
  meta: Record<string, unknown>;
}

interface StoredRow extends SourceRow {
  content: string | null;
}

/**
 * Le righe delle tre fonti, nell'ordine delle fonti. Il testo letto (fino a decine di migliaia di caratteri) si carica
 * solo quando serve, cioè per riprendere una lettura recente.
 */
function storedRows(withContent: true): StoredRow[];
function storedRows(withContent?: false): SourceRow[];
function storedRows(withContent = false): Array<SourceRow | StoredRow> {
  const rows = db
    .prepare(
      `SELECT kind, read_at, outcome, reason, ${withContent ? 'content, ' : ''}meta FROM profile_sources
       WHERE kind IN ('linkedin', 'website', 'posts')
       ORDER BY CASE kind WHEN 'linkedin' THEN 0 WHEN 'website' THEN 1 ELSE 2 END`,
    )
    .all() as Array<Omit<StoredRow, 'meta'> & { meta: string }>;
  return rows.map((r) => ({ ...r, meta: jsonObject(r.meta) }));
}

/** L'ultima lettura di ogni fonte, nell'ordine delle fonti; le fonti mai lette non ci sono. */
export function listSourceRows(): SourceRow[] {
  return storedRows();
}

function writeRow(row: StoredRow): void {
  db.prepare(
    `INSERT INTO profile_sources (kind, read_at, outcome, reason, content, meta) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (kind) DO UPDATE SET read_at = excluded.read_at, outcome = excluded.outcome, reason = excluded.reason,
       content = excluded.content, meta = excluded.meta`,
  ).run(row.kind, row.read_at, row.outcome, row.reason, row.content, JSON.stringify(row.meta));
}

// ---------------------------------------------------------------------------
// Cosa si può leggere adesso (D3, D8, C4, C8, C11): anteprima e lettura partono da qui
// ---------------------------------------------------------------------------

/** Dove si risolve una fonte non disponibile: gli indirizzi pubblici, Connessioni, I miei post. */
export type SourceRemedy = 'addresses' | 'connections' | 'posts';

export interface Unavailable {
  /** Il motivo per esteso, con dove si risolve (D8, C11). */
  reason: string;
  /** Lo stesso motivo in poche parole, per la riga della card che anticipa le fonti (*"Sito non impostato"*). */
  short: string;
  remedy: SourceRemedy;
}

export interface SourcePlan {
  kind: GenerationSource;
  /** Indirizzo che la lettura userebbe (profilo, sito); `null` per i post. */
  address: string | null;
  /** Perché la fonte non si può leggere; `null` = disponibile. */
  unavailable: Unavailable | null;
  /** Ultima lettura riuscita dello stesso indirizzo entro `FRESHNESS_DAYS`: si salta salvo rilettura (C4). */
  freshAt: string | null;
  /** Post con testo integrale e post con solo l'estratto (C8); `null` per le altre fonti. */
  posts: { complete: number; excerpts: number } | null;
}

const WHERE_ADDRESSES = 'Aggiungilo in «I tuoi indirizzi pubblici».';

function postCounts(): { complete: number; excerpts: number } {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(text_complete = 1), 0) AS complete, COALESCE(SUM(text_complete = 0), 0) AS excerpts
       FROM posts WHERE text_excerpt IS NOT NULL`,
    )
    .get() as { complete: number; excerpts: number };
  return { complete: row.complete, excerpts: row.excerpts };
}

/** Le credenziali che mancano a uno strumento, come motivo con il rimedio; `null` se ci sono tutte. */
function missingVars(tool: ToolId, short: string): Unavailable | null {
  const missing = TOOLS[tool].missing();
  if (missing.length === 0) return null;
  return {
    reason: `${missing.join(' e ')} ${missing.length === 1 ? 'mancante' : 'mancanti'} nel .env. Vai a Connessioni.`,
    short,
    remedy: 'connections',
  };
}

function freshRead(row: SourceRow | undefined, address: string, now: number): string | null {
  if (!row || row.outcome !== 'read' || row.meta.address !== address) return null;
  return now - Date.parse(row.read_at) < config.freshnessDays * DAY_MS ? row.read_at : null;
}

/** Le tre fonti come stanno adesso, nell'ordine delle fonti (`rows` = le righe già lette da chi chiama). */
export function planSources(now = Date.now(), rows: readonly SourceRow[] = storedRows()): SourcePlan[] {
  const settings = getSettings();
  const byKind = new Map(rows.map((r) => [r.kind, r]));

  const plan = (kind: GenerationSource, address: string | null, unavailable: Unavailable | null, posts: SourcePlan['posts'] = null) => ({
    kind,
    address,
    unavailable,
    freshAt: address === null || unavailable !== null ? null : freshRead(byKind.get(kind), address, now),
    posts,
  });

  const profileUrl = normalizeLinkedinUrl(settings.own_profile_url) ?? null;
  const linkedin = plan(
    'linkedin',
    profileUrl,
    profileUrl === null
      ? { reason: `Nessun profilo LinkedIn impostato. ${WHERE_ADDRESSES}`, short: 'Profilo LinkedIn non impostato', remedy: 'addresses' }
      : missingVars('apify', 'Profilo LinkedIn senza APIFY_TOKEN'),
  );

  const site = siteUrl(settings.website_url) ?? null;
  const website = plan(
    'website',
    site,
    settings.website_url === null
      ? { reason: `Nessun sito impostato. ${WHERE_ADDRESSES}`, short: 'Sito non impostato', remedy: 'addresses' }
      : site === null
        ? {
            reason: "L'indirizzo salvato non è un sito. Correggilo in «I tuoi indirizzi pubblici».",
            short: 'Sito non valido',
            remedy: 'addresses',
          }
        : missingVars('cloudflare', 'Sito senza credenziali Cloudflare'),
  );

  const counts = postCounts();
  const posts = plan(
    'posts',
    null,
    counts.complete > 0
      ? null
      : counts.excerpts > 0
        ? {
            reason:
              "Nessun post con testo integrale: i post sincronizzati prima di oggi hanno solo l'estratto. Sincronizza di nuovo per conservarlo.",
            short: 'Nessun post con testo integrale',
            remedy: 'posts',
          }
        : { reason: 'Nessun post sincronizzato. Sincronizza i tuoi post.', short: 'Nessun post sincronizzato', remedy: 'posts' },
    counts,
  );

  return [linkedin, website, posts];
}

// ---------------------------------------------------------------------------
// Testo per l'elaborazione
// ---------------------------------------------------------------------------

function dateOf(value: unknown): string | null {
  const year = field(value, 'year');
  return typeof year === 'number' || typeof year === 'string' ? String(year) : null;
}

/** Il profilo come testo: chi è, cosa fa ora, cosa ha fatto (le esperienze con la loro descrizione). */
function profileText(profile: Enrichment): string {
  const lines: string[] = [];
  const add = (label: string, value: string | undefined) => {
    if (value?.trim()) lines.push(`${label}: ${value.trim()}`);
  };
  add('Nome', profile.fullName);
  add('Titolo', profile.headline);
  add('Ruolo attuale', [profile.title, profile.company].filter(Boolean).join(' · ') || undefined);
  add('Località', profile.location);
  if (profile.about?.trim()) lines.push('', 'Informazioni:', profile.about.trim());
  const experience = field(profile.raw, 'experience');
  if (Array.isArray(experience) && experience.length > 0) {
    lines.push('', 'Esperienze:');
    for (const e of experience) {
      const title = field(e, 'title', 'position');
      const company = field(e, 'company', 'company_name');
      const head = [title, company].filter((v): v is string => typeof v === 'string' && v.trim() !== '').join(' · ');
      if (!head) continue;
      const from = dateOf(field(e, 'start_date', 'startDate'));
      const to = field(e, 'is_current', 'isCurrent') === true ? 'oggi' : dateOf(field(e, 'end_date', 'endDate'));
      const period = from ? ` (${from}–${to ?? '?'})` : '';
      const description = field(e, 'description');
      lines.push(`- ${head}${period}${typeof description === 'string' && description.trim() ? `: ${description.trim()}` : ''}`);
    }
  }
  return lines.join('\n').trim();
}

/** Il sito come testo: una sezione per pagina letta, ciascuna e l'insieme entro i tetti. */
function siteText(site: SiteRead): string {
  const parts: string[] = [];
  let total = 0;
  for (const page of site.pages) {
    if (page.status !== 'completed' || page.markdown === null || pageText(page) === '') continue;
    const section = `## ${page.title ?? page.url} (${page.url})\n${page.markdown.trim().slice(0, SITE_PAGE_MAX_CHARS)}`;
    if (total + section.length > SITE_MAX_CHARS) break;
    parts.push(section);
    total += section.length;
  }
  return parts.join('\n\n');
}

/** I post con testo integrale, dal più recente, entro il tetto; quanti ne sono entrati. */
function postsText(): { text: string; used: number } {
  const rows = db
    .prepare(
      `SELECT text_excerpt AS text, posted_at FROM posts WHERE text_complete = 1 AND text_excerpt IS NOT NULL
       ORDER BY posted_at IS NULL, posted_at DESC, id DESC`,
    )
    .all() as Array<{ text: string; posted_at: string | null }>;
  const parts: string[] = [];
  let total = 0;
  for (const row of rows) {
    const section = `### Post${row.posted_at ? ` del ${row.posted_at.slice(0, 10)}` : ''}\n${row.text.trim()}`;
    if (total + section.length > POSTS_MAX_CHARS) break;
    parts.push(section);
    total += section.length;
  }
  return { text: parts.join('\n\n'), used: parts.length };
}

// ---------------------------------------------------------------------------
// Lettura
// ---------------------------------------------------------------------------

export interface SourceOutcome {
  kind: GenerationSource;
  /** `excluded` = tolta dall'utente nell'anteprima (D9): nessuna lettura, la riga resta com'era. */
  outcome: ProfileSourceOutcome | 'excluded';
  /** Contenuto ripreso da una lettura recente dello stesso indirizzo (C4): nessuna chiamata. */
  reused: boolean;
  /** Perché la fonte non è stata letta o non ha dato contenuto (C13, C14), a parole. */
  reason: string | null;
  /** Testo per l'elaborazione: non va mai nel log (D11). `null` se la fonte non ha dato contenuto. */
  content: string | null;
  /** Data della lettura (anche quella ripresa); `null` se la fonte non è stata letta. */
  readAt: string | null;
  meta: Record<string, unknown>;
  /** Avvisi della fonte che vanno sulla sua riga (P-28): seconda lettura con il browser, pagine rimaste in coda. */
  warnings: string[];
  /** Strumento della fonte fallita e motivo nella forma degli errori dei run, per `tool_errors` (P-26). */
  toolError?: { tool: ToolId; error: string };
}

const SITE_EMPTY = 'Nessun contenuto utile (pagina vuota, consenso obbligatorio o blocco): nessun valore è stato dedotto dal sito.';

async function readOne(plan: SourcePlan, deps: SourceDeps): Promise<Omit<SourceOutcome, 'reused'>> {
  const tool = SOURCE_TOOLS[plan.kind];
  try {
    if (plan.kind === 'linkedin') {
      runLog.info(`Apify · profilo · ${/\/in\/([^/?#]+)/.exec(plan.address!)?.[1] ?? plan.address}`);
      const profile = await deps.readProfile(plan.address!);
      const content = profile ? profileText(profile) : '';
      return content
        ? { kind: 'linkedin', outcome: 'read', reason: null, content, readAt: nowIso(), meta: { address: plan.address }, warnings: [] }
        : {
            kind: 'linkedin',
            outcome: 'empty',
            reason: "LinkedIn non ha restituito il profilo: controlla l'indirizzo in «I tuoi indirizzi pubblici».",
            content: null,
            readAt: nowIso(),
            meta: { address: plan.address },
            warnings: [],
          };
    }

    if (plan.kind === 'website') {
      runLog.info(`Cloudflare · sito · ${new URL(plan.address!).host.replace(/^www\./, '')}`);
      const site = await deps.readSite({ url: plan.address!, maxPages: config.cloudflareMaxPages });
      const read = site.pages.filter((p) => p.status === 'completed').length;
      const queued = site.pages.filter((p) => p.status === 'queued').length;
      const meta = { address: plan.address, pages_read: read, pages_queued: queued, max_pages: config.cloudflareMaxPages, render: site.render };
      const warnings: string[] = [];
      if (site.withoutBrowser) {
        warnings.push(
          'Senza browser le pagine del sito erano quasi vuote: riletto con il browser, che costa un\'altra lettura del giorno.',
        );
      }
      if (queued > 0) {
        warnings.push(`${queued === 1 ? '1 pagina trovata non è stata letta' : `${queued} pagine trovate non sono state lette`}: Cloudflare ha chiuso la lettura prima.`);
      }
      const useful = site.pages.some((p) => pageText(p).length >= CLOUDFLARE_MIN_PAGE_TEXT_CHARS);
      const content = useful ? siteText(site) : '';
      return content
        ? { kind: 'website', outcome: 'read', reason: null, content, readAt: nowIso(), meta, warnings }
        : { kind: 'website', outcome: 'empty', reason: SITE_EMPTY, content: null, readAt: nowIso(), meta, warnings };
    }

    const { text, used } = postsText();
    return {
      kind: 'posts',
      outcome: 'read',
      reason: null,
      content: text,
      readAt: nowIso(),
      meta: { ...plan.posts, used },
      warnings: [],
    };
  } catch (err) {
    const fallback = plan.kind === 'website' ? 'actor:cloudflare:crawl' : `actor:${ACTORS.profileDetail}`;
    // Nessuna riga qui: il motivo è un avviso dell'esito, che `runJob` scrive nel log una volta sola.
    const error = redactSecrets(attributeError(err, fallback));
    return {
      kind: plan.kind,
      outcome: 'failed',
      reason: withoutAttribution(error),
      content: null,
      readAt: nowIso(),
      meta: { address: plan.address },
      warnings: [],
      ...(tool ? { toolError: { tool, error } } : {}),
    };
  }
}

/**
 * Legge le fonti scelte nell'anteprima (`include`) e scrive per ciascuna la sua riga; `force` rilegge anche una fonte
 * fresca (D9). Una fonte non disponibile adesso scrive l'esito `unavailable` col motivo anche se non era fra le scelte
 * (non si poteva scegliere). Le fonti si leggono insieme, ognuna per conto suo: una che fallisce non ferma le altre.
 */
export async function readSources(
  options: { include: readonly GenerationSource[]; force: readonly GenerationSource[] },
  deps: SourceDeps,
  now = Date.now(),
): Promise<SourceOutcome[]> {
  const rows = storedRows(true);
  const stored = new Map(rows.map((r) => [r.kind, r]));
  return Promise.all(
    planSources(now, rows).map(async (plan): Promise<SourceOutcome> => {
      if (plan.unavailable !== null) {
        const outcome: SourceOutcome = {
          kind: plan.kind,
          outcome: 'unavailable',
          reused: false,
          reason: plan.unavailable.reason,
          content: null,
          readAt: nowIso(),
          meta: plan.posts ? { ...plan.posts } : { address: plan.address },
          warnings: [],
        };
        writeRow({ kind: plan.kind, read_at: outcome.readAt!, outcome: 'unavailable', reason: outcome.reason, content: null, meta: outcome.meta });
        return outcome;
      }
      if (!options.include.includes(plan.kind)) {
        return { kind: plan.kind, outcome: 'excluded', reused: false, reason: null, content: null, readAt: null, meta: {}, warnings: [] };
      }
      const row = stored.get(plan.kind);
      if (plan.freshAt !== null && row && !options.force.includes(plan.kind)) {
        return { kind: plan.kind, outcome: 'read', reused: true, reason: null, content: row.content, readAt: row.read_at, meta: row.meta, warnings: [] };
      }
      const outcome = await readOne(plan, deps);
      writeRow({
        kind: plan.kind,
        read_at: outcome.readAt!,
        outcome: outcome.outcome as ProfileSourceOutcome,
        reason: outcome.reason,
        content: outcome.content,
        meta: outcome.meta,
      });
      return { ...outcome, reused: false };
    }),
  );
}
