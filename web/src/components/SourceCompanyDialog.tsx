import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { XIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { api, queryKeys } from '../api/client';
import {
  EMPLOYEES_MODES,
  type Company,
  type CompanyExistsErrorBody,
  type EmployeesMode,
  type Job,
  type JobPreview,
  type SourceStartInput,
} from '../api/types';
import { formatCost, useJobPreview, useJobStart } from '../lib/jobs';
import { JobPreviewDialog, type JobPreviewQuery } from './JobPreviewDialog';
import { ListPicker } from './ListPicker';

/*
 * Sourcing persone da azienda (crm-foundation T19, FLOW D.2): dialog "Cerca persone in Acme" costruito
 * sul `JobPreviewDialog` — lista di destinazione (`ListPicker` con creazione inline), ruoli e località
 * precompilati dall'ICP della lista (chip modificabili), massimo persone, modalità con prezzo — e
 * l'anteprima del server (`GET /api/companies/:id/source/preview`) che si aggiorna a ogni modifica.
 * Esporta anche i piccoli helper delle pagine Aziende (etichetta, avviso "Azienda già presente").
 * Un'azienda senza URL LinkedIn (solo dominio, apollo-lookalike T15) apre comunque il dialog: la preview del
 * server mostra il blocker "Azienda senza pagina LinkedIn: recuperala prima" e "Avvia ricerca" resta disabilitato.
 */

/** Tetto dell'actor per `maxItems` (specchio di `EMPLOYEES_MAX_ITEMS` in `src/jobs/source-company.ts`). */
export const EMPLOYEES_MAX_ITEMS = 2500;

/** "https://www.linkedin.com/company/acme-robotica/" → "linkedin.com/company/acme-robotica". */
export function shortCompanyUrl(url: string | null): string {
  return (url ?? '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
}

/** Nome dell'azienda o, finché l'anagrafica è vuota, lo slug della pagina LinkedIn (o il dominio se manca l'URL). */
export function companyLabel(company: Pick<Company, 'name' | 'linkedin_url'> & { domain?: string | null }): string {
  if (company.name) return company.name;
  const slug = /\/company\/([^/?#]+)/.exec(company.linkedin_url ?? '')?.[1];
  return slug ? decodeURIComponent(slug) : shortCompanyUrl(company.linkedin_url ?? company.domain ?? null);
}

/**
 * Badge "Senza pagina LinkedIn" (SPEC B12, FLOW F.2): testo sempre presente, il colore è accessorio. Spiega
 * perché "Estrai persone" è bloccato finché l'URL LinkedIn non è in anagrafica.
 */
export function NoLinkedinBadge({ className }: { className?: string }) {
  return (
    <span
      className={
        'inline-block rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-amber-900 ring-1 ring-amber-200 ring-inset' +
        (className ? ` ${className}` : '')
      }
    >
      Senza pagina LinkedIn
    </span>
  );
}

/**
 * Errore inline del 409 `company_exists` in creazione (FLOW F.1 e "Error paths"): "Azienda già presente con lo
 * stesso dominio: apri Acme" con il link al dettaglio dell'azienda che usa già la chiave (nessuna riga creata);
 * `listId` lo porta con sé (il dettaglio apre subito la ricerca di persone).
 */
export function CompanyExistsNotice({ id, conflict, listId }: { id?: string; conflict: CompanyExistsErrorBody; listId?: number }) {
  const what = conflict.key === 'domain' ? 'lo stesso dominio' : 'lo stesso URL LinkedIn';
  return (
    <p id={id} role="alert" className="text-sm text-red-700">
      Azienda già presente con {what}:{' '}
      <Link
        to="/companies/$id"
        params={{ id: String(conflict.company_id) }}
        search={listId ? { listId } : {}}
        className="font-medium text-red-900 underline"
      >
        apri {conflict.company_name}
      </Link>
    </p>
  );
}

/** Valori del form: lista preselezionata (`?listId=`) o i filtri di una ricerca precedente. */
export interface SourceDialogValues {
  listId?: number;
  roles?: string[];
  locations?: string[];
  maxItems?: number;
  mode?: EmployeesMode;
}

/** Filtri di un job `source_company` già eseguito ("Riprova con altri filtri" riapre il dialog con questi). */
export function sourceValuesFromJob(job: Job): SourceDialogValues {
  const p = job.params;
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined);
  return {
    listId: typeof p.listId === 'number' ? p.listId : undefined,
    roles: strings(p.roles),
    locations: strings(p.locations),
    maxItems: typeof p.maxItems === 'number' ? p.maxItems : undefined,
    mode: (EMPLOYEES_MODES as readonly unknown[]).includes(p.mode) ? (p.mode as EmployeesMode) : undefined,
  };
}

export interface SourceCompanyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company: Pick<Company, 'id' | 'name' | 'linkedin_url'> & { domain?: string | null };
  /** Valori con cui si apre il form (letti a ogni apertura). */
  initial?: SourceDialogValues;
  /** Dopo l'avvio (202): il dialog si chiude da solo, l'esito arriva dal `JobBanner`. */
  onStarted?: (job: Job) => void;
}

/**
 * "Estrai persone" da un'azienda (FLOW D): a ogni apertura il form riparte da `initial`.
 *
 * @example
 * const [open, setOpen] = useState(false);
 * <Button onClick={() => setOpen(true)}>Estrai persone</Button>
 * <SourceCompanyDialog open={open} onOpenChange={setOpen} company={company} initial={{ listId }} />
 */
export function SourceCompanyDialog(props: SourceCompanyDialogProps) {
  // Nuova "sessione" a ogni apertura: il form si rimonta e rilegge `initial` (niente stato vecchio).
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setSession((s) => s + 1);
  }
  return <SourceCompanyForm key={session} {...props} />;
}

const MODE_TEXT: Record<EmployeesMode, string> = {
  Short: 'nome, headline, ruolo',
  Full: "+ esperienze e formazione: l'analisi AI non richiederà l'arricchimento",
  'Full+email': '+ esperienze, formazione ed email',
};

const labelCls = 'text-xs font-medium text-slate-600';

/** Stato del campo "Massimo persone": vuoto (default del server), valido o non valido. */
function parseMax(text: string): { kind: 'empty' } | { kind: 'valid'; value: number } | { kind: 'invalid' } {
  const t = text.trim();
  if (t === '') return { kind: 'empty' };
  const n = Number(t);
  return Number.isInteger(n) && n >= 1 && n <= EMPLOYEES_MAX_ITEMS ? { kind: 'valid', value: n } : { kind: 'invalid' };
}

/** Aggiunge i valori scritti (separati da virgola) senza doppioni, ignorando maiuscole/minuscole. */
function addChips(values: string[], raw: string): string[] {
  const next = [...values];
  for (const part of raw.split(',')) {
    const value = part.trim();
    if (value && !next.some((v) => v.toLowerCase() === value.toLowerCase())) next.push(value);
  }
  return next;
}

function priceText(query: UseQueryResult<JobPreview>): string {
  if (query.data) return formatCost(query.data.est_cost_usd);
  return query.error ? 'stima non disponibile' : 'calcolo…';
}

function SourceCompanyForm({ open, onOpenChange, company, initial, onStarted }: SourceCompanyDialogProps) {
  const uid = useId();
  const queryClient = useQueryClient();
  const label = companyLabel(company);

  const [listId, setListId] = useState<number | null>(initial?.listId ?? null);
  const [mode, setMode] = useState<EmployeesMode>(initial?.mode ?? 'Short');
  // `null` = quelli dell'ICP della lista (il server li risolve uguali); array = scelti nel dialog.
  const [roles, setRoles] = useState<string[] | null>(initial?.roles ?? null);
  const [locations, setLocations] = useState<string[] | null>(initial?.locations ?? null);
  const [roleDraft, setRoleDraft] = useState('');
  const [locationDraft, setLocationDraft] = useState('');

  // Massimo persone: finché non lo tocco vale il default del server (mostrato nel campo appena noto).
  const [maxText, setMaxText] = useState(initial?.maxItems !== undefined ? String(initial.maxItems) : '');
  const [maxTouched, setMaxTouched] = useState(initial?.maxItems !== undefined);
  const [previewMax, setPreviewMax] = useState<number | undefined>(initial?.maxItems);
  const max = parseMax(maxText);
  const maxValue = max.kind === 'valid' ? max.value : null;
  const maxInvalid = max.kind === 'invalid' || (maxTouched && max.kind === 'empty');
  const maxSyncing = maxTouched && maxValue !== null && maxValue !== previewMax;
  useEffect(() => {
    if (!maxTouched || maxValue === null || maxValue === previewMax) return;
    // Una preview per numero digitato, non per tasto.
    const handle = setTimeout(() => setPreviewMax(maxValue), 300);
    return () => clearTimeout(handle);
  }, [maxTouched, maxValue, previewMax]);

  const list = useQuery({
    queryKey: queryKeys.list(listId ?? 0),
    queryFn: () => api.lists.get(listId!),
    enabled: open && listId !== null,
    retry: false,
  });
  const icpId = list.data?.icp_id;
  const icp = useQuery({ queryKey: queryKeys.icp(icpId ?? 0), queryFn: () => api.icps.get(icpId!), enabled: open && icpId !== undefined });

  const shownRoles = roles ?? icp.data?.target_roles ?? [];
  const shownLocations = locations ?? icp.data?.target_locations ?? [];

  const base = { companyId: company.id, listId: listId ?? undefined, maxItems: previewMax, roles: roles ?? undefined };
  // Una preview per modalità: il prezzo accanto a ogni opzione arriva dal server (mai un numero inventato).
  const previews: Record<EmployeesMode, UseQueryResult<JobPreview>> = {
    Short: useJobPreview('source_company', { ...base, mode: 'Short' }, { enabled: open }),
    Full: useJobPreview('source_company', { ...base, mode: 'Full' }, { enabled: open }),
    'Full+email': useJobPreview('source_company', { ...base, mode: 'Full+email' }, { enabled: open }),
  };
  const preview = previews[mode];

  const defaultMax = preview.data?.counts.max_items;
  useEffect(() => {
    if (!maxTouched && maxText === '' && typeof defaultMax === 'number') setMaxText(String(defaultMax));
  }, [defaultMax, maxTouched, maxText]);

  const maxError = maxInvalid
    ? `Inserisci un numero intero tra 1 e ${EMPLOYEES_MAX_ITEMS.toLocaleString('it-IT')}.`
    : null;
  // Il numero non valido blocca l'avvio come i blocchi del server. "Avvia" aspetta finché la preview non
  // riflette il numero digitato ed è stata letta in questa apertura (niente blocchi vecchi, es. job in corso).
  const shownPreview: JobPreviewQuery = {
    data:
      preview.data && maxError
        ? { ...preview.data, blockers: [...preview.data.blockers, `Massimo persone: ${maxError.toLowerCase()}`] }
        : preview.data,
    isPending: preview.isPending || maxSyncing || !preview.isFetchedAfterMount,
    isFetching: preview.isFetching,
    error: preview.error,
    refetch: preview.refetch,
  };

  const start = useJobStart((body: SourceStartInput) => api.companies.startSourcing(company.id, body), {
    onStarted: (job) => {
      onOpenChange(false);
      onStarted?.(job);
    },
  });

  const onStart = () => {
    if (listId === null || maxError) return;
    // Il testo scritto e non confermato con Invio vale come chip.
    const finalRoles = roleDraft.trim() ? addChips(shownRoles, roleDraft) : (roles ?? undefined);
    const finalLocations = locationDraft.trim() ? addChips(shownLocations, locationDraft) : (locations ?? undefined);
    start.mutate({
      listId,
      mode,
      maxItems: maxTouched ? previewMax : undefined,
      roles: finalRoles,
      locations: finalLocations,
    });
  };

  const noList = listId === null;
  const icpLoading = !noList && (list.isPending || (icpId !== undefined && icp.isPending));

  return (
    <JobPreviewDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Cerca persone in ${label}`}
      description="Legge le persone dell'azienda che corrispondono ai ruoli e le aggiunge alla lista scelta, con stato Nuovo."
      preview={shownPreview}
      summary={(data) => (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
          Fino a <span className="font-medium tabular-nums">{(data.counts.max_items ?? 0).toLocaleString('it-IT')}</span> persone
          lette da {label} in modalità {mode}
          {list.data ? ` → lista '${list.data.name}'` : ''}. La stima è sul massimo: se ne trova meno, costa meno.
        </p>
      )}
      startLabel="Avvia ricerca"
      starting={start.isPending}
      onStart={onStart}
    >
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium text-slate-900">Lista di destinazione</p>
        <ListPicker
          value={listId}
          disabled={start.isPending}
          onChange={(id, picked) => {
            queryClient.setQueryData(queryKeys.list(id), picked);
            setListId(id);
          }}
        />
        {list.data && (
          <p className="text-sm text-slate-600">
            {list.data.archived_at && (
              <>
                Lista selezionata: <span className="font-medium text-slate-900">{list.data.name}</span> (archiviata) ·{' '}
              </>
            )}
            ICP:{' '}
            <Link to="/icps/$id" params={{ id: String(list.data.icp.id) }} className="font-medium text-slate-900 underline-offset-2 hover:underline">
              {list.data.icp.name}
            </Link>
          </p>
        )}
      </div>

      <ChipsField
        id={`${uid}-roles`}
        label="Ruoli"
        item="ruolo"
        placeholder={noList ? 'Scegli prima la lista' : 'es. CTO'}
        hint={
          noList
            ? "Scegli la lista: i ruoli arrivano dal suo ICP."
            : icpLoading
              ? "Caricamento dei ruoli dell'ICP…"
              : roles === null
                ? "Ruoli target dell'ICP. Invio (o virgola) aggiunge un ruolo; la × lo toglie."
                : 'Ruoli scelti per questa ricerca. Invio (o virgola) aggiunge un ruolo; la × lo toglie.'
        }
        values={shownRoles}
        onValuesChange={setRoles}
        draft={roleDraft}
        onDraftChange={setRoleDraft}
        disabled={noList || icpLoading || start.isPending}
        onReset={roles !== null && icp.data ? () => setRoles(null) : undefined}
        resetLabel="Usa i ruoli dell'ICP"
      />

      <ChipsField
        id={`${uid}-locations`}
        label="Località (facoltativa)"
        item="località"
        placeholder={noList ? 'Scegli prima la lista' : 'es. Lombardia'}
        hint="Precompilata dalle località dell'ICP. Vuota = ovunque."
        values={shownLocations}
        onValuesChange={setLocations}
        draft={locationDraft}
        onDraftChange={setLocationDraft}
        disabled={noList || icpLoading || start.isPending}
        onReset={locations !== null && icp.data ? () => setLocations(null) : undefined}
        resetLabel="Usa le località dell'ICP"
      />

      <div className="flex flex-col gap-1">
        <label htmlFor={`${uid}-max`} className={labelCls}>
          Massimo persone
        </label>
        <Input
          id={`${uid}-max`}
          type="number"
          inputMode="numeric"
          min={1}
          max={EMPLOYEES_MAX_ITEMS}
          step={1}
          value={maxText}
          disabled={start.isPending}
          className="w-32"
          aria-invalid={maxError ? true : undefined}
          aria-describedby={maxError ? `${uid}-max-error` : `${uid}-max-hint`}
          onChange={(e) => {
            setMaxTouched(true);
            setMaxText(e.target.value);
          }}
        />
        {maxError ? (
          <p id={`${uid}-max-error`} role="alert" className="text-sm text-red-700">
            {maxError}
          </p>
        ) : (
          <p id={`${uid}-max-hint`} className="text-xs text-slate-500">
            Tetto di persone lette (1–{EMPLOYEES_MAX_ITEMS.toLocaleString('it-IT')}): il costo stimato dipende da questo numero.
          </p>
        )}
      </div>

      <fieldset disabled={start.isPending} className="flex flex-col gap-1">
        <legend className={labelCls}>Modalità</legend>
        {EMPLOYEES_MODES.map((m) => (
          <label key={m} className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1 text-sm hover:bg-slate-50">
            <input
              type="radio"
              name={`${uid}-mode`}
              value={m}
              checked={mode === m}
              onChange={() => setMode(m)}
              aria-describedby={m === 'Short' ? `${uid}-short-hint` : undefined}
              className="mt-0.5 size-4 accent-slate-900"
            />
            <span>
              <span className="font-medium text-slate-900">{m}</span>
              <span className="text-slate-700"> — {MODE_TEXT[m]} </span>
              <span className="whitespace-nowrap text-slate-600 tabular-nums">({priceText(previews[m])})</span>
              {m === 'Short' && (
                <span id={`${uid}-short-hint`} className="block text-xs text-slate-500">
                  Per analizzarli dovrai arricchirli (costo aggiuntivo per persona).
                </span>
              )}
            </span>
          </label>
        ))}
        <p className="text-xs text-slate-500">Prezzi stimati sul massimo di persone, con start fee $0,02 per run.</p>
      </fieldset>
    </JobPreviewDialog>
  );
}

/**
 * Campo a chip: Invio o virgola aggiungono il testo come chip (senza inviare nulla), la × rimuove.
 * `onReset` mostra l'azione per tornare ai valori dell'ICP.
 */
function ChipsField(props: {
  id: string;
  label: string;
  item: string;
  placeholder: string;
  hint: string;
  values: string[];
  onValuesChange: (values: string[]) => void;
  draft: string;
  onDraftChange: (draft: string) => void;
  disabled?: boolean;
  onReset?: () => void;
  resetLabel: string;
}) {
  const { id, values, draft, disabled } = props;
  const inputRef = useRef<HTMLInputElement>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' && event.key !== ',') return;
    event.preventDefault();
    if (draft.trim() === '') return;
    props.onValuesChange(addChips(values, draft));
    props.onDraftChange('');
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className={labelCls}>
          {props.label}
        </label>
        {props.onReset && (
          <button
            type="button"
            onClick={props.onReset}
            disabled={disabled}
            className="cursor-pointer text-xs font-medium text-slate-500 underline hover:text-slate-900 disabled:opacity-50"
          >
            {props.resetLabel}
          </button>
        )}
      </div>
      <div
        className={
          'flex flex-wrap items-center gap-1.5 rounded-lg border border-input px-2 py-1 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50' +
          (disabled ? ' opacity-60' : '')
        }
      >
        {values.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label={`${props.label} (${values.length})`}>
            {values.map((value) => (
              <li
                key={value}
                className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 py-0.5 pr-0.5 pl-2.5 text-xs font-medium text-slate-800"
              >
                {value}
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    props.onValuesChange(values.filter((v) => v !== value));
                    inputRef.current?.focus();
                  }}
                  aria-label={`Rimuovi ${props.item} ${value}`}
                  className="cursor-pointer rounded-full p-0.5 text-slate-500 hover:bg-slate-200 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:outline-none"
                >
                  <XIcon className="size-3" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <input
          ref={inputRef}
          id={id}
          value={draft}
          disabled={disabled}
          onChange={(e) => props.onDraftChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={values.length === 0 ? props.placeholder : `Aggiungi ${props.item}…`}
          aria-describedby={`${id}-hint`}
          className="h-6 min-w-32 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        />
      </div>
      <p id={`${id}-hint`} className="text-xs text-slate-500">
        {props.hint}
      </p>
    </div>
  );
}
