import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { api, isApiError } from '../api/client';
import {
  APOLLO_EMPLOYEE_RANGES,
  ICP_ORIGIN,
  LOOKALIKE_PER_PAGE,
  type ContactsOptionsInput,
  type IcpDetail,
  type IcpListRef,
  type Job,
  type JobPreview,
  type LookalikeFilterValues,
  type LookalikePerPage,
  type LookalikePreview,
  type LookalikePreviewParams,
  type LookalikeReference,
  type LookalikeStartInput,
} from '../api/types';
import { useJobPreview, useJobStart } from '../lib/jobs';
import { addChips, ChipsInput } from './ChipsInput';
import {
  checkPerCompany,
  contactsPreviewOptions,
  contactsStartOptions,
  ContactsFields,
  CreateIcpList,
  initialContactsForm,
  mergeIcpLists,
  type ContactsFormState,
} from './ContactsDialog';
import { JobPreviewDialog, type JobPreviewQuery } from './JobPreviewDialog';

/*
 * "Trova aziende simili" (apollo-lookalike T12a, FLOW A.2, SPEC D2–D6, S-7): `JobPreviewDialog` con le
 * referenze usate, i filtri derivati modificabili (chip con origine, fasce di dipendenti con la mappatura,
 * località), aziende per pagina 25 · 50 · 100, pagine di ricerca, ripartenza "continuo dalla pagina N" /
 * "Ricomincia dalla pagina 1", riga dei crediti sempre visibile, costo, warning e blocker del server e la
 * spunta pipeline "Trova subito i contatti" (T13, FLOW E, SPEC H1–H4): con la spunta compaiono i campi di
 * "Trova contatti" (`ContactsFields`) e la riga dei crediti somma ricerca + persone trovate; senza liste attive
 * la spunta è disabilitata con il motivo e "Crea lista" inline. Filtri modificati → `custom=1`; la preview si
 * ricalcola (con debounce) a ogni modifica. Avvio → `POST /api/icps/:id/lookalike` (con `autoContacts` se la
 * pipeline è attiva); l'esito lo notifica il JobBanner.
 */

/** Default del server: fuori dai parametri così card e dialog condividono la stessa preview. */
export const DEFAULT_PAGES = 1;
export const DEFAULT_PER_PAGE: LookalikePerPage = 25;

const DEBOUNCE_MS = 300;

/** Data breve in italiano ("16 set", con l'anno se non è quello corrente). */
export function shortDay(iso: string | null | undefined): string {
  const date = new Date(iso ?? '');
  if (Number.isNaN(date.getTime())) return 'data ignota';
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  if (date.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return date.toLocaleDateString('it-IT', opts);
}

/** `51-100` → `51–100`. */
export const rangeLabel = (range: string) => range.replace('-', '–');

const nf = (value: number | undefined) => (value ?? 0).toLocaleString('it-IT');

/** Parametri della preview senza i valori di default (chiave condivisa con la card). */
export function lookalikePreviewParams(
  icpId: number,
  input: {
    pages?: number;
    perPage?: LookalikePerPage;
    restart?: boolean;
    filters?: LookalikeFilterValues | null;
    /** Pipeline attiva (opzioni del passo contatti); `null`/assente = spenta. */
    contacts?: ContactsOptionsInput | null;
  },
): LookalikePreviewParams {
  return {
    icpId,
    ...(input.pages !== undefined && input.pages !== DEFAULT_PAGES ? { pages: input.pages } : {}),
    ...(input.perPage !== undefined && input.perPage !== DEFAULT_PER_PAGE ? { perPage: input.perPage } : {}),
    ...(input.restart ? { restart: true } : {}),
    ...(input.filters ? { filters: input.filters } : {}),
    ...(input.contacts ? { contacts: input.contacts } : {}),
  };
}

/** Valori con cui si apre il dialog ("Riusa questi filtri" di una ricerca precedente). */
export interface LookalikeDialogValues {
  filters?: LookalikeFilterValues;
  perPage?: LookalikePerPage;
  pages?: number;
}

export interface LookalikeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Liste, ruoli e località servono alla pipeline (liste attive, default dei contatti). */
  icp: Pick<IcpDetail, 'id' | 'name' | 'company_size' | 'target_roles' | 'target_locations' | 'lists'>;
  /** Valori con cui si apre il form (letti a ogni apertura); assenti = filtri derivati, 1 pagina da 25. */
  initial?: LookalikeDialogValues;
  onStarted?: (job: Job) => void;
}

/**
 * @example
 * const [open, setOpen] = useState(false);
 * <Button onClick={() => setOpen(true)}>Trova aziende simili</Button>
 * <LookalikeDialog open={open} onOpenChange={setOpen} icp={icp} />
 */
export function LookalikeDialog(props: LookalikeDialogProps) {
  // Nuova "sessione" a ogni apertura: il form si rimonta e rilegge `initial`.
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setSession((s) => s + 1);
  }
  return <LookalikeForm key={session} {...props} />;
}

type PagesCheck = { ok: true; value: number } | { ok: false; message: string };

/** Pagine: intero ≥ 1; il tetto (`APOLLO_MAX_COMPANY_PAGES`) lo dice il server con un 400 sulla preview. */
function checkPages(text: string, rejected: { from: number; message: string } | null): PagesCheck {
  const t = text.trim();
  const n = Number(t);
  if (t === '' || !Number.isInteger(n) || n < 1) {
    return { ok: false, message: 'Pagine di ricerca: inserisci un numero intero, almeno 1.' };
  }
  if (rejected && n >= rejected.from) return { ok: false, message: rejected.message };
  return { ok: true, value: n };
}

/** Messaggio del 400 della preview sul numero di pagine (`issues[path=pages]`), altrimenti `null`. */
function pagesIssueOf(error: unknown): string | null {
  if (!isApiError(error) || error.status !== 400) return null;
  return error.body?.issues?.find((i) => i.path === 'pages')?.message ?? null;
}

/** Unione delle origini per valore; ritorna `cur` se non c'è nulla di nuovo (niente render inutili). */
function mergeOrigins(cur: Record<string, string[]>, next: Record<string, string[]>): Record<string, string[]> {
  let merged: Record<string, string[]> | null = null;
  for (const [value, origins] of Object.entries(next)) {
    const known = (merged ?? cur)[value] ?? [];
    const added = origins.filter((o) => !known.includes(o));
    if (added.length === 0) continue;
    merged ??= { ...cur };
    merged[value] = [...known, ...added];
  }
  return merged ?? cur;
}

const pick = (f: LookalikeFilterValues): LookalikeFilterValues => ({
  keywords: [...f.keywords],
  ranges: [...f.ranges],
  locations: [...f.locations],
});

/** "dall'ICP · da Acme"; `[]` = aggiunto a mano; `undefined` = origine non ancora nota. */
function originText(origins: string[] | undefined): string | undefined {
  if (origins === undefined) return undefined;
  if (origins.length === 0) return 'aggiunto a mano';
  return origins.map((o) => (o === ICP_ORIGIN ? "dall'ICP" : `da ${o}`)).join(' · ');
}

/** Origini per valore con confronto normalizzato (minuscolo, spazi ridotti), come fa il server. */
function originLookup(map: Record<string, string[]> | undefined) {
  const norm = (v: string) => v.trim().replace(/\s+/g, ' ').toLowerCase();
  const byKey = new Map(Object.entries(map ?? {}).map(([k, v]) => [norm(k), v]));
  return (value: string) => (map ? originText(byKey.get(norm(value))) : undefined);
}

function LookalikeForm({ open, onOpenChange, icp, initial, onStarted }: LookalikeDialogProps) {
  const uid = useId();

  // `null` = filtri derivati (referenze arricchite + ICP); array = scelti nel dialog (`custom=1`).
  const [filters, setFilters] = useState<LookalikeFilterValues | null>(initial?.filters ? pick(initial.filters) : null);
  const [keywordDraft, setKeywordDraft] = useState('');
  const [locationDraft, setLocationDraft] = useState('');
  const [perPage, setPerPage] = useState<LookalikePerPage>(initial?.perPage ?? DEFAULT_PER_PAGE);
  const [restart, setRestart] = useState(false);
  const [pagesText, setPagesText] = useState(String(initial?.pages ?? DEFAULT_PAGES));
  // Il tetto delle pagine non è nella preview: un 400 su `pages=N` vale per ogni N' ≥ N.
  const [rejectedPages, setRejectedPages] = useState<{ from: number; message: string } | null>(null);
  const [goodPages, setGoodPages] = useState(DEFAULT_PAGES);

  const pagesCheck = checkPages(pagesText, rejectedPages);
  const pages = pagesCheck.ok ? pagesCheck.value : goodPages;

  // Pipeline (FLOW E): disponibile solo con almeno una lista attiva dell'ICP (SPEC H4).
  const [pipeline, setPipeline] = useState(false);
  const [contacts, setContacts] = useState<ContactsFormState>(() => initialContactsForm());
  const patchContacts = (next: Partial<ContactsFormState>) => setContacts((cur) => ({ ...cur, ...next }));
  const [createdLists, setCreatedLists] = useState<IcpListRef[]>([]);
  const [creatingList, setCreatingList] = useState(false);
  const lists = mergeIcpLists(icp.lists, createdLists);
  const pipelineAvailable = lists.some((l) => l.archived_at === null);
  const pipelineOn = pipeline && pipelineAvailable;
  const perCheck = checkPerCompany(contacts.perCompanyText);
  const lastGoodPer = useRef<number | undefined>(undefined);
  if (perCheck.ok) lastGoodPer.current = perCheck.value;
  const contactsOptions = pipelineOn
    ? contactsPreviewOptions(contacts, perCheck.ok ? perCheck.value : lastGoodPer.current)
    : null;

  // Preview con debounce: una richiesta per modifica "ferma", non per tasto.
  const paramsKey = JSON.stringify(lookalikePreviewParams(icp.id, { pages, perPage, restart, filters, contacts: contactsOptions }));
  const [debouncedKey, setDebouncedKey] = useState(paramsKey);
  useEffect(() => {
    if (paramsKey === debouncedKey) return;
    const handle = setTimeout(() => setDebouncedKey(paramsKey), DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [paramsKey, debouncedKey]);
  const debounced = useMemo(() => JSON.parse(debouncedKey) as LookalikePreviewParams, [debouncedKey]);
  const syncing = paramsKey !== debouncedKey;

  const preview = useJobPreview('lookalike_companies', debounced, { enabled: open });
  const pagesIssue = pagesIssueOf(preview.error);
  const debouncedPages = debounced.pages ?? DEFAULT_PAGES;
  useEffect(() => {
    if (!pagesIssue) return;
    setRejectedPages((cur) => (cur && cur.from <= debouncedPages ? cur : { from: debouncedPages, message: pagesIssue }));
  }, [pagesIssue, debouncedPages]);
  useEffect(() => {
    if (preview.data) setGoodPages(debouncedPages);
  }, [preview.data, debouncedPages]);

  // Il form (chip, referenze, ripartenza) resta sull'ultima preview letta mentre la nuova si calcola.
  const [lastData, setLastData] = useState<LookalikePreview | undefined>(undefined);
  useEffect(() => {
    if (preview.data) setLastData(preview.data);
  }, [preview.data]);
  const formData = preview.data ?? lastData;

  // Default del tetto per azienda (config): dalla preview della pipeline senza `perCompany`.
  const [defaultPer, setDefaultPer] = useState<number | null>(null);
  useEffect(() => {
    const plan = preview.data?.contacts;
    if (plan && debounced.contacts && debounced.contacts.perCompany === undefined) setDefaultPer(plan.per_company);
  }, [preview.data, debounced]);

  // Origini delle fasce viste finora: con filtri scelti a mano il server le dà solo per i valori rimasti,
  // la mappatura invece descrive sempre la derivazione.
  const [rangeOrigins, setRangeOrigins] = useState<Record<string, string[]>>({});
  useEffect(() => {
    const data = preview.data;
    if (data) setRangeOrigins((cur) => mergeOrigins(cur, data.filters.origins.ranges));
  }, [preview.data]);

  const shown: LookalikeFilterValues = filters ?? (formData ? pick(formData.filters) : { keywords: [], ranges: [], locations: [] });
  const editFilters = (change: (current: LookalikeFilterValues) => LookalikeFilterValues) => {
    setFilters(change(shown));
    setRestart(false);
  };

  const start = useJobStart((body: LookalikeStartInput) => api.lookalike.start(icp.id, body), {
    onStarted: (job) => {
      onOpenChange(false);
      onStarted?.(job);
    },
  });
  const busy = start.isPending;
  const formReady = formData !== undefined;

  const onStart = () => {
    if (!preview.data || !pagesCheck.ok) return;
    if (pipelineOn && (!perCheck.ok || contacts.listId === null)) return;
    const base = filters ?? pick(preview.data.filters);
    // Il testo scritto e non confermato con Invio vale come chip.
    start.mutate({
      pages: pagesCheck.value,
      perPage,
      restart,
      keywords: keywordDraft.trim() ? addChips(base.keywords, keywordDraft) : base.keywords,
      ranges: base.ranges,
      locations: locationDraft.trim() ? addChips(base.locations, locationDraft) : base.locations,
      autoContacts:
        pipelineOn && perCheck.ok && contacts.listId !== null
          ? { listId: contacts.listId, ...contactsStartOptions(contacts, icp, perCheck.value) }
          : null,
    });
  };

  const localBlockers = [
    ...(pagesCheck.ok ? [] : [pagesCheck.message]),
    ...(pipelineOn && !perCheck.ok ? [perCheck.message] : []),
  ];
  const shownPreview: JobPreviewQuery = {
    data:
      preview.data && localBlockers.length > 0
        ? { ...preview.data, blockers: [...preview.data.blockers, ...localBlockers] }
        : preview.data,
    isPending: preview.isPending || syncing || !preview.isFetchedAfterMount || pagesIssue !== null,
    isFetching: preview.isFetching,
    error: pagesIssue ? null : preview.error,
    refetch: preview.refetch,
  };

  const keywordOrigin = originLookup(formData?.filters.origins.keywords);
  const locationOrigin = originLookup(formData?.filters.origins.locations);
  const restoreDerived =
    filters !== null ? (
      <button
        type="button"
        onClick={() => {
          setFilters(null);
          setRestart(false);
        }}
        disabled={busy}
        className="cursor-pointer text-xs font-medium text-slate-500 underline hover:text-slate-900 disabled:opacity-50"
      >
        Ripristina i filtri derivati
      </button>
    ) : undefined;

  const pagesInvalid = !pagesCheck.ok;

  return (
    <JobPreviewDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Trova aziende simili a ${icp.name}`}
      description="Apollo cerca aziende con filtri derivati dalle tue referenze e dall'ICP. Controlla i filtri e i crediti prima di avviare."
      preview={shownPreview}
      summary={(data) =>
        (data as LookalikePreview).contacts ? (
          <PipelineCreditsSummary data={data as LookalikePreview} />
        ) : (
          <CreditsSummary data={data as LookalikePreview} />
        )
      }
      startLabel={pipelineOn ? 'Avvia ricerca e contatti' : 'Avvia ricerca'}
      starting={busy}
      onStart={onStart}
    >
      <ReferencesUsed references={formData?.references} loading={!formReady} />

      <section aria-labelledby={`${uid}-filters`} className="flex flex-col gap-3">
        <div>
          <h3 id={`${uid}-filters`} className="text-sm font-medium text-slate-900">
            Filtri {filters === null ? 'derivati' : 'scelti'}, modificabili
          </h3>
          <p className="text-xs text-slate-500">Cambiare i filtri non cambia i crediti, solo i risultati.</p>
        </div>

        <ChipsInput
          id={`${uid}-keywords`}
          label="Parole chiave / settori"
          item="parola chiave"
          placeholder={formReady ? 'es. saas' : 'Caricamento dei filtri…'}
          hint="Dai settori Apollo delle referenze arricchite e dai settori dell'ICP (origine nel tooltip). Invio aggiunge, non avvia."
          values={shown.keywords}
          onValuesChange={(keywords) => editFilters((cur) => ({ ...cur, keywords }))}
          draft={keywordDraft}
          onDraftChange={setKeywordDraft}
          disabled={!formReady || busy}
          chipOrigin={keywordOrigin}
          labelAction={restoreDerived}
        />

        <fieldset
          disabled={!formReady || busy}
          aria-describedby={`${uid}-ranges-note`}
          className="flex flex-col gap-1.5"
        >
          <legend className="mb-1 text-xs font-medium text-slate-600">Fasce di dipendenti</legend>
          <div className="grid grid-cols-3 gap-x-3 gap-y-1.5 sm:grid-cols-4">
            {APOLLO_EMPLOYEE_RANGES.map((range) => {
              const checked = shown.ranges.includes(range);
              return (
                <label key={range} className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-800 tabular-nums">
                  <Checkbox
                    checked={checked}
                    disabled={!formReady || busy}
                    onCheckedChange={(value) =>
                      editFilters((cur) => ({
                        ...cur,
                        ranges:
                          value === true
                            ? APOLLO_EMPLOYEE_RANGES.filter((r) => r === range || cur.ranges.includes(r))
                            : cur.ranges.filter((r) => r !== range),
                      }))
                    }
                  />
                  {rangeLabel(range)}
                </label>
              );
            })}
          </div>
          <RangesNote
            id={`${uid}-ranges-note`}
            derived={formData?.filters.derived.ranges}
            origins={rangeOrigins}
            notes={formData?.filters.notes ?? []}
            icpSize={icp.company_size}
          />
        </fieldset>

        <ChipsInput
          id={`${uid}-locations`}
          label="Località"
          item="località"
          placeholder={formReady ? 'es. Milano' : 'Caricamento dei filtri…'}
          hint="Dalle località dell'ICP e dai paesi delle referenze arricchite. Vuoto = ovunque. Invio aggiunge, non avvia."
          values={shown.locations}
          onValuesChange={(locations) => editFilters((cur) => ({ ...cur, locations }))}
          draft={locationDraft}
          onDraftChange={setLocationDraft}
          disabled={!formReady || busy}
          chipOrigin={locationOrigin}
        />
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <fieldset disabled={busy} className="flex flex-col gap-1" aria-describedby={`${uid}-per-page-hint`}>
          <legend className="mb-1 text-xs font-medium text-slate-600">Aziende per pagina</legend>
          <div className="flex gap-3">
            {LOOKALIKE_PER_PAGE.map((value) => (
              <label key={value} className="flex cursor-pointer items-center gap-1.5 text-sm tabular-nums">
                <input
                  type="radio"
                  name={`${uid}-per-page`}
                  value={value}
                  checked={perPage === value}
                  onChange={() => {
                    setPerPage(value);
                    setRestart(false);
                  }}
                  className="size-4 accent-slate-900"
                />
                {value}
              </label>
            ))}
          </div>
          <p id={`${uid}-per-page-hint`} className="text-xs text-slate-500">
            Ogni azienda nuova si arricchisce subito: 1 credito ciascuna, così vedi punteggio, settore, dipendenti e sede.
          </p>
        </fieldset>

        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-pages`} className="text-xs font-medium text-slate-600">
            Pagine di ricerca
          </label>
          <Input
            id={`${uid}-pages`}
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={pagesText}
            disabled={busy}
            className="w-24"
            aria-invalid={pagesInvalid ? true : undefined}
            aria-describedby={pagesInvalid ? `${uid}-pages-error` : `${uid}-pages-hint`}
            onChange={(e) => {
              setPagesText(e.target.value);
              setRestart(false);
            }}
          />
          {pagesInvalid ? (
            <p id={`${uid}-pages-error`} role="alert" className="text-sm text-red-700">
              {pagesCheck.message}
            </p>
          ) : (
            <p id={`${uid}-pages-hint`} className="text-xs text-slate-500">
              1 pagina = fino a {perPage} aziende · 1 credito a pagina + 1 ad azienda nuova; massimo
              APOLLO_MAX_COMPANY_PAGES (default 3).
            </p>
          )}
        </div>
      </div>

      <ResumeRow
        data={formData}
        restart={restart}
        disabled={busy}
        onRestart={() => setRestart(true)}
        onContinue={() => setRestart(false)}
      />

      <section aria-label="Pipeline aziende e contatti" className="flex flex-col gap-3">
        <div className="flex items-start gap-2 text-sm">
          <Checkbox
            id={`${uid}-pipeline`}
            checked={pipelineOn}
            disabled={!pipelineAvailable || busy}
            onCheckedChange={(value) => setPipeline(value === true)}
            aria-describedby={`${uid}-pipeline-hint`}
            className="mt-0.5"
          />
          <div className={pipelineAvailable ? 'text-slate-800' : 'text-slate-500'}>
            <label htmlFor={`${uid}-pipeline`} className="font-medium">
              Trova subito i contatti nelle aziende trovate
            </label>
            <p id={`${uid}-pipeline-hint`} className="text-xs text-slate-500">
              {pipelineAvailable
                ? "Un solo job: dopo la ricerca, cerca le persone in tutte le aziende trovate e le mette in lista. Le aziende restano 'proposte': le vagli dopo."
                : 'Crea una lista per questo ICP per usare questa opzione.'}
            </p>
            {!pipelineAvailable && !creatingList && (
              <Button type="button" size="sm" variant="outline" className="mt-1.5" onClick={() => setCreatingList(true)} disabled={busy}>
                Crea lista
              </Button>
            )}
          </div>
        </div>
        {!pipelineAvailable && creatingList && (
          <CreateIcpList
            idPrefix={`${uid}-pipeline-list`}
            icpId={icp.id}
            title={`Nuova lista per ${icp.name}`}
            autoFocus
            disabled={busy}
            onCancel={() => setCreatingList(false)}
            onCreated={(list) => {
              setCreatedLists((cur) => [...cur, list]);
              setCreatingList(false);
              patchContacts({ listId: list.id });
              setPipeline(true);
            }}
          />
        )}
        {pipelineOn && (
          <div className="flex flex-col gap-3 border-l-2 border-slate-200 pl-3" data-testid="pipeline-fields">
            <ContactsFields
              idPrefix={`${uid}-contacts`}
              state={contacts}
              onChange={patchContacts}
              target={{ mode: 'icp', icp: { ...icp, lists } }}
              defaultPerCompany={defaultPer}
              perCompanyError={perCheck.ok ? null : perCheck.message}
              disabled={busy}
            />
          </div>
        )}
      </section>
    </JobPreviewDialog>
  );
}

// ---------------------------------------------------------------------------
// Sezioni
// ---------------------------------------------------------------------------

function referenceName(r: LookalikeReference): string {
  return r.name ?? r.domain ?? `Azienda #${r.company_id}`;
}

/** Stato di una referenza in una riga: "acme.it, arricchita il 10 set". */
function referenceDetail(r: LookalikeReference): string {
  const domain = r.domain ? `${r.domain}, ` : '';
  switch (r.status) {
    case 'enriched':
      return `${domain}arricchita il ${shortDay(r.enriched_at)}`;
    case 'to_enrich':
      return `${domain}non arricchita: i suoi settori non entrano nei filtri`;
    case 'not_found':
      return `${domain}non trovata su Apollo il ${shortDay(r.attempted_at)}: non entra nei filtri`;
    case 'key_conflict':
      return `${domain}chiavi in conflitto il ${shortDay(r.attempted_at)}: non entra nei filtri`;
    case 'no_domain':
      return 'senza sito: ignorata';
  }
}

function ReferencesUsed({ references, loading }: { references: LookalikeReference[] | undefined; loading: boolean }) {
  return (
    <section aria-label="Referenze usate" className="flex flex-col gap-1 text-sm">
      <h3 className="text-sm font-medium text-slate-900">Referenze usate</h3>
      {loading ? (
        <p className="text-slate-500">Caricamento delle referenze…</p>
      ) : !references || references.length === 0 ? (
        <p className="text-slate-600">Nessuna referenza: i filtri derivano solo dall'ICP.</p>
      ) : (
        <ul className="flex flex-col gap-0.5 text-slate-700">
          {references.map((r) => (
            <li key={r.company_id} data-reference-status={r.status}>
              <span className="font-medium text-slate-900">{referenceName(r)}</span> ({referenceDetail(r)}
              {r.status === 'no_domain' && (
                <>
                  {' — '}
                  <Link
                    to="/companies/$id"
                    params={{ id: String(r.company_id) }}
                    className="font-medium text-slate-900 underline"
                  >
                    aggiungi il sito
                  </Link>
                </>
              )}
              )
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Mappatura delle fasce derivate (FLOW A.2): "Dall'ICP "10-50" → 1–10, 11–20, 21–50 · da Acme: 21–50,
 * 51–100, 101–200 (con le fasce vicine)", più le note del server (es. dimensione dell'ICP non riconoscibile).
 */
function RangesNote(props: {
  id: string;
  derived: string[] | undefined;
  origins: Record<string, string[]>;
  notes: string[];
  icpSize: string | null;
}) {
  const { derived } = props;
  const parts: string[] = [];
  if (derived) {
    const byOrigin = new Map<string, string[]>();
    const unknown: string[] = [];
    for (const range of APOLLO_EMPLOYEE_RANGES) {
      if (!derived.includes(range)) continue;
      const origins = props.origins[range] ?? [];
      if (origins.length === 0) unknown.push(range);
      for (const origin of origins) byOrigin.set(origin, [...(byOrigin.get(origin) ?? []), range]);
    }
    const icpRanges = byOrigin.get(ICP_ORIGIN);
    if (icpRanges) parts.push(`Dall'ICP "${props.icpSize ?? ''}" → ${icpRanges.map(rangeLabel).join(', ')}`);
    for (const [origin, ranges] of byOrigin) {
      if (origin !== ICP_ORIGIN) parts.push(`da ${origin}: ${ranges.map(rangeLabel).join(', ')} (con le fasce vicine)`);
    }
    if (unknown.length > 0) parts.push(`derivate: ${unknown.map(rangeLabel).join(', ')}`);
  }
  return (
    <div id={props.id} className="text-xs text-slate-500">
      {parts.length > 0 ? (
        <p>{parts.join(' · ')}</p>
      ) : (
        derived && <p>Nessuna fascia derivata dall'ICP o dalle referenze arricchite.</p>
      )}
      {props.notes.map((note) => (
        <p key={note} className="text-amber-800">
          {note}
        </p>
      ))}
    </div>
  );
}

/** Ripartenza (SPEC D6): continua dalla pagina successiva a parità di filtri e dimensione, o ricomincia. */
function ResumeRow(props: {
  data: LookalikePreview | undefined;
  restart: boolean;
  disabled: boolean;
  onRestart: () => void;
  onContinue: () => void;
}) {
  const resume = props.data?.resume;
  if (!resume) return null;
  const date = shortDay(resume.last_run_at);
  const linkCls =
    'cursor-pointer font-medium text-slate-900 underline underline-offset-2 hover:text-slate-700 disabled:opacity-50';
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700" data-resume-next={resume.next_page ?? ''}>
      {resume.exhausted ? (
        <p>
          Ricerca del {date} esaurita con questi filtri (ultima pagina: {nf(resume.last_page_declared)} aziende su{' '}
          {resume.per_page}): si riparte dalla pagina 1. Cambia i filtri per trovare aziende diverse.
        </p>
      ) : props.restart || resume.next_page === null ? (
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span>Ricomincio dalla pagina 1 con i filtri della ricerca del {date}: ripaga pagine già lette.</span>
          <button type="button" className={linkCls} onClick={props.onContinue} disabled={props.disabled}>
            Continua dalla pagina {resume.next_page}
          </button>
        </p>
      ) : (
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span>
            Continuo dalla pagina {resume.next_page}: stessi filtri della ricerca del {date} (letta fino alla pagina{' '}
            {resume.last_page}).
          </span>
          <button type="button" className={linkCls} onClick={props.onRestart} disabled={props.disabled}>
            Ricomincia dalla pagina 1
          </button>
          <span className="text-xs text-slate-500">(ricominciare ripaga pagine già lette)</span>
        </p>
      )}
    </div>
  );
}

/**
 * Riga dei crediti con la pipeline attiva (FLOW E.2, SPEC H1, S-6/S-7): "Crediti stimati: fino a 26 (ricerca) +
 * fino a 250 (persone trovate) · fino a 25 aziende · fino a 250 persone · fino a 53 richieste per i contatti".
 */
function PipelineCreditsSummary({ data }: { data: LookalikePreview }) {
  const c = data.counts;
  const pages = c.pages ?? 0;
  const perPage = c.per_page ?? DEFAULT_PER_PAGE;
  const search = c.search_est_credits ?? pages + pages * perPage;
  const people = c.contacts_est_credits ?? 0;
  const total = c.est_credits ?? search + people;
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700" data-testid="credits-line">
      <p>
        <span className="font-medium">Crediti stimati:</span> fino a {nf(search)} (ricerca) + fino a {nf(people)} (persone
        trovate) · fino a {nf(c.contacts_companies)} aziende · fino a {nf(people)} persone · fino a {nf(c.contacts_requests)}{' '}
        richieste per i contatti (una ricerca per azienda + i match)
      </p>
      <p className="text-xs text-slate-500">
        Totale fino a {nf(total)} crediti · ricerca = {nf(pages)} {pages === 1 ? 'pagina' : 'pagine'} + fino a{' '}
        {nf(pages * perPage)} aziende nuove da arricchire · fino a {nf(c.requests)} richieste Apollo in tutto
      </p>
      {data.est_cost_usd === null && (
        <p className="text-xs text-slate-500">
          Stima non disponibile — imposta APOLLO_CREDIT_USD nel .env per vedere il costo; i crediti restano fino a {nf(total)}.
        </p>
      )}
    </div>
  );
}

/** Riga riassuntiva dei crediti, sempre visibile (anche a 0), con la scomposizione (SPEC C5/D3, S-7). */
function CreditsSummary({ data }: { data: LookalikePreview | JobPreview }) {
  const c = data.counts;
  const pages = c.pages ?? 0;
  const perPage = c.per_page ?? DEFAULT_PER_PAGE;
  const credits = c.est_credits ?? 0;
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700" data-testid="credits-line">
      <p>
        <span className="font-medium">Crediti stimati:</span> fino a {nf(credits)} = {nf(pages)}{' '}
        {pages === 1 ? 'pagina' : 'pagine'} di ricerca + fino a {nf(pages * perPage)} aziende nuove da arricchire (le
        già arricchite non si ripagano)
      </p>
      <p className="text-xs text-slate-500">
        {pages === 1 ? 'Pagina' : 'Pagine'} {nf(c.start_page ?? 1)}
        {pages > 1 ? `–${nf((c.start_page ?? 1) + pages - 1)}` : ''} · fino a {nf(c.requests)} richieste Apollo
      </p>
      {data.est_cost_usd === null && (
        <p className="text-xs text-slate-500">
          Stima non disponibile — imposta APOLLO_CREDIT_USD nel .env per vedere il costo; i crediti restano fino a{' '}
          {nf(credits)}.
        </p>
      )}
    </div>
  );
}
