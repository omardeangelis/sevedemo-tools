/** Utility tolleranti per leggere campi da output di actor con schemi non garantiti. */

/** Ritorna il primo campo non vuoto tra quelli indicati. */
export function field(obj: unknown, ...names: string[]): any {
  if (!obj || typeof obj !== 'object') return undefined;
  const rec = obj as Record<string, unknown>;
  for (const n of names) {
    const v = rec[n];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

/**
 * Id membro LinkedIn (`ACoAA…`, `ACwAA…`): la forma non pubblica con cui alcuni actor
 * identificano una persona al posto dello slug. Case-sensitive.
 */
const MEMBER_ID_RE = /^AC[A-Za-z0-9]AA[A-Za-z0-9_-]{15,}$/;

/**
 * Normalizza un URL LinkedIn in una chiave stabile per il dedup:
 * https://www.linkedin.com/in/<slug> (senza query/hash/trailing slash).
 * Lo slug pubblico di `/in/<slug>` è abbassato di caso (LinkedIn lo tratta
 * case-insensitive); gli id membro (/in/ACwAA...) restano invariati: sono
 * case-sensitive e abbassarli di caso li rende irrisolvibili dall'enrichment.
 * Ritorna undefined se non è un URL valido.
 */
export function normalizeLinkedinUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  let u = raw.trim();
  if (!u) return undefined;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try {
    const url = new URL(u);
    if (!/linkedin\.com$/i.test(url.hostname) && !/\.linkedin\.com$/i.test(url.hostname)) {
      // non è un host linkedin: non lo usiamo come chiave
      return undefined;
    }
    const path = url.pathname
      .replace(/\/+$/, '')
      .replace(/^(\/in\/)([^/]+)/i, (_, prefix: string, slug: string) =>
        prefix.toLowerCase() + (MEMBER_ID_RE.test(slug) ? slug : slug.toLowerCase()),
      );
    return 'https://www.linkedin.com' + path;
  } catch {
    return undefined;
  }
}

/**
 * Id membro (`ACoAA…`) contenuto in un valore: id nudo, URN (`urn:li:fsd_profile:ACoAA…`,
 * anche percent-encoded come nella query `miniProfileUrn`) o URL `/in/ACoAA…`.
 * Undefined per gli slug pubblici e per i valori non stringa.
 */
export function memberIdOf(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const s = raw.trim();
  if (MEMBER_ID_RE.test(s)) return s;
  let decoded = s;
  try {
    decoded = decodeURIComponent(s);
  } catch {
    // percent-encoding malformato: si cerca sul testo così com'è
  }
  const urn = /urn:li:[A-Za-z_]*[Pp]rofile:([A-Za-z0-9_-]+)/.exec(decoded);
  if (urn && MEMBER_ID_RE.test(urn[1])) return urn[1];
  const slug = /^https:\/\/www\.linkedin\.com\/in\/([^/]+)/.exec(normalizeLinkedinUrl(s) ?? '')?.[1];
  return slug && MEMBER_ID_RE.test(slug) ? slug : undefined;
}

/**
 * Chiavi d'identità di un profilo letto da un actor: `linkedinUrl` normalizzato (lo slug
 * pubblico quando l'item lo espone, anche se l'URL è in forma id membro) e `memberUrn`
 * (id membro da un campo dedicato o dall'URL). Senza URL né slug → `linkedinUrl` assente:
 * i profili nascosti ("LinkedIn Member") restano scartati anche se hanno un id.
 */
export function profileKeys(input: { url?: unknown; publicIdentifier?: unknown; memberId?: unknown }): {
  linkedinUrl?: string;
  memberUrn?: string;
} {
  const pub = typeof input.publicIdentifier === 'string' ? input.publicIdentifier.trim() : '';
  const slugUrl =
    pub && !MEMBER_ID_RE.test(pub) && /^[^/?#\s]+$/.test(pub)
      ? normalizeLinkedinUrl(`https://www.linkedin.com/in/${pub}`)
      : undefined;
  return {
    linkedinUrl: slugUrl ?? normalizeLinkedinUrl(input.url),
    memberUrn: memberIdOf(input.memberId) ?? memberIdOf(input.url),
  };
}

/**
 * True se l'email è presente: non null/undefined e non vuota dopo `.trim()`.
 * Definizione unica di "senza email" (assente / vuota / soli spazi); nessuna
 * validazione di sintassi — conta solo la presenza.
 */
export function hasEmail(email: string | null | undefined): boolean {
  return typeof email === 'string' && email.trim() !== '';
}

/** Tronca una stringa a maxLen caratteri (per non gonfiare i prompt). */
export function truncate(s: unknown, maxLen: number): string {
  if (typeof s !== 'string') {
    if (s == null) return '';
    try { s = JSON.stringify(s); } catch { s = String(s); }
  }
  const str = s as string;
  return str.length > maxLen ? str.slice(0, maxLen) + '…' : str;
}

/**
 * URL di un profilo persona (`/in/<slug>`) normalizzato con `normalizeLinkedinUrl`
 * e ridotto a https://www.linkedin.com/in/<slug> (via sotto-path come `/recent-activity/…`).
 * Slug pubblico in minuscolo, id membro invariato. Undefined se non è un URL LinkedIn di una persona.
 */
export function normalizeProfileUrl(raw: unknown): string | undefined {
  const url = normalizeLinkedinUrl(raw);
  const m = url && /^https:\/\/www\.linkedin\.com\/in\/([^/]+)/i.exec(url);
  return m ? `https://www.linkedin.com/in/${m[1]}` : undefined;
}

/**
 * URL di una pagina aziendale normalizzato: https://www.linkedin.com/company/<slug>
 * (via query/hash e sotto-path come `/about`, `/people`). Lo slug è abbassato di
 * caso: i vanity name aziendali sono case-insensitive, così `Acme` e `acme` sono
 * la stessa azienda. Undefined se non è un URL LinkedIn `/company/…`.
 */
export function normalizeCompanyUrl(raw: unknown): string | undefined {
  const url = normalizeLinkedinUrl(raw);
  const m = url && /^https:\/\/www\.linkedin\.com\/company\/([^/]+)/i.exec(url);
  return m ? `https://www.linkedin.com/company/${m[1].toLowerCase()}` : undefined;
}

/**
 * Host di piattaforme condivise: un sito ospitato qui non identifica un'azienda (SPEC apollo-lookalike B2).
 * Confronto per suffisso: vale anche per i sottodomini (`acme.wixsite.com`, `it.linkedin.com`).
 */
export const SHARED_HOSTS = ['linkedin.com', 'facebook.com', 'instagram.com', 'google.com', 'sites.google.com', 'wixsite.com'] as const;

const DOMAIN_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const DOMAIN_TLD_RE = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

/**
 * Dominio di un'azienda da un sito o da un dominio scritto a mano (SPEC apollo-lookalike B2): minuscolo;
 * senza schema, credenziali, porta, percorso, query e frammento; senza il prefisso `www.`; gli altri
 * sottodomini restano (`shop.acme.it` ≠ `acme.it`); IDN in punycode. Undefined per host di piattaforme
 * condivise (`SHARED_HOSTS`), schemi diversi da http/https, IP, host senza punto e testo non valido.
 */
export function normalizeDomain(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  let s = raw.trim();
  if (!s) return undefined;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    if (!/^https?:\/\//i.test(s)) return undefined;
  } else if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(s)) {
    // schema senza "//" (es. mailto:), non una porta
    return undefined;
  } else {
    s = `https://${s}`;
  }
  let host: string;
  try {
    host = new URL(s).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  host = host.replace(/\.$/, '').replace(/^www\./, '');
  const labels = host.split('.');
  if (labels.length < 2 || !labels.every((l) => DOMAIN_LABEL_RE.test(l)) || !DOMAIN_TLD_RE.test(labels.at(-1)!)) {
    return undefined;
  }
  if (SHARED_HOSTS.some((shared) => host === shared || host.endsWith(`.${shared}`))) return undefined;
  return host;
}

/** Testo libero da input utente: trim; vuoto/assente → `null`. */
export function cleanText(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

/** Lista di stringhe da input utente (chip): trim, vuoti scartati, doppioni (case-insensitive) rimossi. */
export function cleanList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of v) {
    const t = cleanText(item);
    if (t === null || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
}
