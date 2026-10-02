import { field } from '../util/fields.js';

/**
 * Lettura tollerante delle risposte di Cloudflare Browser Run (own-profile-services T20), come i mapper Apollo:
 * funzioni pure sul `result` della risposta, nessun campo dato per garantito.
 */

/** Una pagina della lettura: `status` è quello di Cloudflare (`completed`, `disallowed` = vietata da robots.txt, …). */
export interface CrawlPage {
  url: string;
  status: string;
  /** Codice HTTP con cui il sito ha risposto, se noto. */
  httpStatus: number | null;
  title: string | null;
  /** Testo della pagina in Markdown; `null` se la pagina non è stata letta. */
  markdown: string | null;
}

export interface CrawlStatus {
  /** `running`, `completed`, `errored`, `cancelled_by_user`, `cancelled_due_to_timeout`, `cancelled_due_to_limits`. */
  status: string;
  /** Pagine trovate e pagine concluse (lette o scartate). */
  total: number | null;
  finished: number | null;
  /** Tempo di browser consumato dichiarato da Cloudflare. */
  browserSeconds: number | null;
  pages: CrawlPage[];
  /** Presente solo se restano pagine da scaricare (risposte oltre 10 MB). */
  cursor: string | number | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/**
 * Il titolo arriva com'è scritto nell'HTML del sito, entità comprese (verifica reale del 2026-10-02:
 * `L&#39;onboarding…`): qui torna testo.
 */
function decodeEntities(text: string): string {
  return text.replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (entity, name: string) => {
    if (name[0] !== '#') return NAMED_ENTITIES[name.toLowerCase()] ?? entity;
    const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}

function mapPage(record: unknown): CrawlPage | undefined {
  const metadata = field(record, 'metadata');
  const url = str(field(record, 'url')) ?? str(field(metadata, 'url'));
  if (url === null) return undefined;
  const markdown: unknown = field(record, 'markdown');
  const title = str(field(metadata, 'title'));
  return {
    url,
    status: str(field(record, 'status')) ?? 'unknown',
    httpStatus: num(field(metadata, 'status')),
    title: title === null ? null : decodeEntities(title),
    markdown: typeof markdown === 'string' ? markdown : null,
  };
}

export function mapCrawlStatus(result: unknown): CrawlStatus {
  const records = field(result, 'records');
  const cursor = field(result, 'cursor');
  return {
    status: str(field(result, 'status')) ?? 'unknown',
    total: num(field(result, 'total')),
    finished: num(field(result, 'finished')),
    browserSeconds: num(field(result, 'browserSecondsUsed')),
    pages: Array.isArray(records) ? records.map(mapPage).filter((p): p is CrawlPage => p !== undefined) : [],
    cursor: typeof cursor === 'string' || typeof cursor === 'number' ? cursor : null,
  };
}
