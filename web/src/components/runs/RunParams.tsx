import { useQuery } from '@tanstack/react-query';
import { api, queryKeys } from '../../api/client';
import type { JobKind } from '../../api/types';
import { companyRowName, countText } from '../../lib/format';

/*
 * Parametri di un run in forma leggibile (people-first-crm J7, FLOW G.4): *"Lista: CTO startup IT · 12
 * aziende · Ruoli: CTO, Head of Engineering"*. Una riga per parametro noto, nell'ordine in cui il run li ha
 * salvati; le chiavi che non sono qui non si mostrano (tecniche o senza senso per chi legge). Liste, ICP e
 * aziende si mostrano col nome, chiesto solo se il run ne ha uno; un id sparito resta come `#12`.
 * Le opzioni che significano cose diverse da un kind all'altro (`force`) prendono le parole del **suo** kind.
 */

/** Contesto di una riga: il kind del run e i nomi già letti di liste, ICP e aziende. */
interface Ctx {
  kind: JobKind;
  list: (id: number) => string;
  icp: (id: number) => string;
  company: (id: number) => string;
}

type Render = (value: unknown, ctx: Ctx) => string | null;

const named = (label: string): Render => (v) =>
  Array.isArray(v) && v.length > 0 ? `${label}: ${v.join(', ')}` : null;

const counted = (one: string, many: string): Render => (v) =>
  Array.isArray(v) && v.length > 0 ? countText(v.length, one, many) : null;

const yesNo = (yes: string, no: string): Render => (v) => (typeof v === 'boolean' ? (v ? yes : no) : null);

/** Opzione che cambia significato col kind: `force` rilegge i post per il sync, rianalizza per l'analisi. */
const byKind = (per: Partial<Record<JobKind, Render>>, fallback: Render): Render => (v, ctx) =>
  (per[ctx.kind] ?? fallback)(v, ctx);

const num = (text: (n: number) => string): Render => (v) => (typeof v === 'number' ? text(v) : null);

/** Come si scrive ogni parametro: una funzione per chiave, il resto non si mostra. */
const LABELS: Record<string, Render> = {
  listId: (v, ctx) => (typeof v === 'number' ? `Lista: ${ctx.list(v)}` : null),
  icpId: (v, ctx) => (typeof v === 'number' ? `ICP: ${ctx.icp(v)}` : null),
  companyId: (v, ctx) => (typeof v === 'number' ? `Azienda: ${ctx.company(v)}` : null),
  prospectIds: counted('persona', 'persone'),
  companyIds: counted('azienda', 'aziende'),
  roles: named('Ruoli'),
  seniorities: named('Seniority'),
  locations: named('Località'),
  keywords: named('Parole chiave'),
  ranges: named('Fasce di dipendenti'),
  provider: (v) => (v === 'apollo' ? 'Strumento: Apollo (email di lavoro)' : v === 'apify' ? 'Strumento: Apify' : null),
  pages: num((n) => `${countText(n, 'pagina', 'pagine')} da leggere`),
  perPage: num((n) => `${n} aziende per pagina`),
  startPage: num((n) => `Dalla pagina ${n}`),
  perCompany: num((n) => `Massimo ${countText(n, 'persona', 'persone')} per azienda`),
  maxItems: num((n) => `Massimo ${countText(n, 'persona', 'persone')}`),
  mode: (v) => (typeof v === 'string' ? `Profilo: ${v}` : null),
  force: byKind(
    { analyze: yesNo('Rianalizza anche chi è già analizzato', 'Solo chi non è ancora analizzato') },
    yesNo('Rilegge anche i post già sincronizzati', 'Solo i post da sincronizzare'),
  ),
  postsOnly: yesNo('Solo elenco post', 'Post e interazioni'),
  onlyMissing: yesNo('Solo chi non ha dati', 'Tutte le persone scelte'),
  retryFailed: yesNo('Ritenta anche chi era fallito', 'Salta chi era già stato tentato'),
  retryNotFound: yesNo('Ritenta le aziende "non trovate"', 'Salta le aziende "non trovate"'),
  enrichFirst: yesNo('Arricchisce prima di analizzare', 'Analizza solo chi ha dati'),
  restart: yesNo('Riparte dalla pagina 1', 'Continua dalla ricerca precedente'),
  __fixture: (v) => (typeof v === 'string' ? `Scenario di prova: ${v}` : null),
};

export function RunParams({ kind, params }: { kind: JobKind; params: Record<string, unknown> }) {
  const listId = typeof params.listId === 'number' ? params.listId : null;
  const icpId = typeof params.icpId === 'number' ? params.icpId : null;
  const companyId = typeof params.companyId === 'number' ? params.companyId : null;
  const lists = useQuery({
    queryKey: queryKeys.listsIndex(true),
    queryFn: () => api.lists.list({ includeArchived: true }),
    enabled: listId !== null,
  });
  const icps = useQuery({ queryKey: queryKeys.icps, queryFn: api.icps.list, enabled: icpId !== null });
  const company = useQuery({
    queryKey: queryKeys.company(companyId ?? 0),
    queryFn: () => api.companies.get(companyId!),
    enabled: companyId !== null,
    retry: false,
  });

  const ctx: Ctx = {
    kind,
    list: (id) => lists.data?.items.find((l) => l.id === id)?.name ?? `#${id}`,
    icp: (id) => icps.data?.items.find((i) => i.id === id)?.name ?? `#${id}`,
    company: (id) => (company.data ? companyRowName({ company_id: id, name: company.data.name, domain: company.data.domain }) : `#${id}`),
  };

  const parts = Object.entries(params)
    .map(([key, value]) => (value === null || value === undefined ? null : (LABELS[key]?.(value, ctx) ?? null)))
    .filter((part): part is string => part !== null);

  if (parts.length === 0) return <p className="text-sm text-slate-500">Nessun parametro: il job legge le impostazioni.</p>;
  return <p className="text-sm text-slate-700">{parts.join(' · ')}</p>;
}
