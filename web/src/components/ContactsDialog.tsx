import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { api, queryKeys } from '../api/client';
import {
  APOLLO_PEOPLE_PER_COMPANY_MAX,
  APOLLO_SENIORITIES,
  APOLLO_SENIORITY_LABELS,
  type ApolloSeniority,
  type ContactsBody,
  type ContactsOptionsInput,
  type ContactsPreview,
  type ContactsPreviewParams,
  type Icp,
  type IcpListRef,
  type Job,
  type JobPreview,
} from '../api/types';
import { useJobPreview, useJobStart } from '../lib/jobs';
import { addChips, ChipsInput } from './ChipsInput';
import { JobPreviewDialog, type JobPreviewQuery } from './JobPreviewDialog';
import { ListPicker } from './ListPicker';

/*
 * "Trova contatti" (apollo-lookalike T13, FLOW C, SPEC F1–F3/F10/F12, steering S-6): `JobPreviewDialog` con
 * l'ambito in sola lettura, la lista di destinazione (obbligatoria), ruoli, seniority, località e tetto di
 * persone per azienda, riga dei crediti "fino a" sempre visibile, costo, warning e blocker del server. Avvio
 * → `POST /api/icps/:id/contacts`; l'esito lo notifica il JobBanner.
 *
 * Due modalità: `icp` (pagina ICP: liste attive di quell'ICP, default dall'ICP) e `company` (dettaglio
 * azienda, SPEC F12: tutte le liste attive raggruppate per ICP, i default di ruoli e località e l'ICP della
 * chiamata sono quelli della lista scelta). I campi (`ContactsFields`) si riusano nella pipeline di
 * `LookalikeDialog` (FLOW E.2).
 */

const nf = (value: number | undefined) => (value ?? 0).toLocaleString('it-IT');
const DEBOUNCE_MS = 300;

/** Azienda nell'ambito del dialog (stessa forma delle righe candidate: `{company_id, name, domain}`). */
export interface ContactsCompany {
  company_id: number;
  name: string | null;
  domain: string | null;
}

/** ICP da cui arrivano i default (ruoli, località) e, in modalità `icp`, le liste. */
export type ContactsIcp = Pick<Icp, 'id' | 'name' | 'target_roles' | 'target_locations'>;

/** Valori con cui aprire il dialog ("Riprova con altri filtri"): assenti = default dell'ICP e della config. */
export interface ContactsDialogValues {
  listId?: number;
  roles?: string[];
  seniorities?: ApolloSeniority[];
  locations?: string[];
  perCompany?: number;
}

interface ContactsDialogBaseProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Aziende in cui cercare (le senza dominio restano nell'ambito: il server le esclude con warning/blocker). */
  companies: ContactsCompany[];
  /** Valori iniziali, letti a ogni apertura. */
  initial?: ContactsDialogValues;
  /** Dopo l'avvio (202): il dialog si è già chiuso. */
  onStarted?: (job: Job) => void;
}

export type ContactsDialogProps = ContactsDialogBaseProps &
  (
    | {
        /** Pagina ICP: liste attive dell'ICP (preselezione se unica), default e chiamata sull'ICP. */
        mode: 'icp';
        icp: ContactsIcp & { lists: IcpListRef[] };
      }
    | {
        /** Dettaglio azienda (SPEC F12): tutte le liste attive per ICP; ICP della chiamata = ICP della lista. */
        mode: 'company';
        icp?: undefined;
      }
  );

// ---------------------------------------------------------------------------
// Stato dei campi (condiviso con la pipeline di LookalikeDialog)
// ---------------------------------------------------------------------------

export interface ContactsFormState {
  listId: number | null;
  /** `null` = ruoli dell'ICP (chiave assente nella richiesta); `[]` = nessun ruolo. */
  roles: string[] | null;
  roleDraft: string;
  seniorities: ApolloSeniority[];
  /** `null` = località dell'ICP; `[]` = ovunque. */
  locations: string[] | null;
  locationDraft: string;
  /** `null` = default della config (`APOLLO_PEOPLE_PER_COMPANY`). */
  perCompanyText: string | null;
}

export function initialContactsForm(initial?: ContactsDialogValues): ContactsFormState {
  return {
    listId: initial?.listId ?? null,
    roles: initial?.roles ? [...initial.roles] : null,
    roleDraft: '',
    seniorities: initial?.seniorities ? [...initial.seniorities] : [],
    locations: initial?.locations ? [...initial.locations] : null,
    locationDraft: '',
    perCompanyText: initial?.perCompany !== undefined ? String(initial.perCompany) : null,
  };
}

export const PER_COMPANY_ERROR = `Il massimo di persone per azienda va da 1 a ${APOLLO_PEOPLE_PER_COMPANY_MAX}.`;

export type PerCompanyCheck = { ok: true; value: number | undefined } | { ok: false; message: string };

/** Tetto per azienda: `null` = default; altrimenti intero 1–100 (stesso testo del 400 del server). */
export function checkPerCompany(text: string | null): PerCompanyCheck {
  if (text === null) return { ok: true, value: undefined };
  const t = text.trim();
  const n = Number(t);
  if (t === '' || !/^\d+$/.test(t) || n < 1 || n > APOLLO_PEOPLE_PER_COMPANY_MAX) return { ok: false, message: PER_COMPANY_ERROR };
  return { ok: true, value: n };
}

/**
 * Opzioni per la preview: solo i chip confermati (il testo in corso non ricalcola a ogni tasto); chiavi assenti
 * = default del server. `perCompany` = ultimo valore valido quando il campo è fuori range.
 */
export function contactsPreviewOptions(state: ContactsFormState, perCompany: number | undefined): ContactsOptionsInput {
  return {
    ...(state.listId !== null ? { listId: state.listId } : {}),
    ...(state.roles !== null ? { roles: state.roles } : {}),
    ...(state.seniorities.length > 0 ? { seniorities: APOLLO_SENIORITIES.filter((s) => state.seniorities.includes(s)) } : {}),
    ...(state.locations !== null ? { locations: state.locations } : {}),
    ...(perCompany !== undefined ? { perCompany } : {}),
  };
}

/** Opzioni per l'avvio: come la preview, ma il testo scritto e non confermato con Invio vale come chip. */
export function contactsStartOptions(
  state: ContactsFormState,
  icp: Pick<ContactsIcp, 'target_roles' | 'target_locations'> | null,
  perCompany: number | undefined,
): Omit<ContactsOptionsInput, 'listId'> {
  const withDraft = (values: string[] | null, defaults: string[] | undefined, draft: string) => {
    if (draft.trim() === '') return values ?? undefined;
    return addChips(values ?? defaults ?? [], draft);
  };
  const roles = withDraft(state.roles, icp?.target_roles, state.roleDraft);
  const locations = withDraft(state.locations, icp?.target_locations, state.locationDraft);
  return {
    ...(roles !== undefined ? { roles } : {}),
    ...(state.seniorities.length > 0 ? { seniorities: APOLLO_SENIORITIES.filter((s) => state.seniorities.includes(s)) } : {}),
    ...(locations !== undefined ? { locations } : {}),
    ...(perCompany !== undefined ? { perCompany } : {}),
  };
}

/** Valore "fermo" di una chiave serializzata: cambia dopo `DEBOUNCE_MS` senza modifiche. */
export function useDebouncedKey(key: string): [debounced: string, syncing: boolean] {
  const [debounced, setDebounced] = useState(key);
  useEffect(() => {
    if (key === debounced) return;
    const handle = setTimeout(() => setDebounced(key), DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [key, debounced]);
  return [debounced, key !== debounced];
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

/**
 * @example
 * // Pagina ICP (candidate accettate)
 * <ContactsDialog mode="icp" icp={icp} open={open} onOpenChange={setOpen}
 *   companies={accepted.map((c) => ({ company_id: c.company_id, name: c.name, domain: c.domain }))} />
 * // Dettaglio azienda (SPEC F12)
 * <ContactsDialog mode="company" open={open} onOpenChange={setOpen}
 *   companies={[{ company_id: company.id, name: company.name, domain: company.domain }]} />
 */
export function ContactsDialog(props: ContactsDialogProps) {
  // Nuova "sessione" a ogni apertura: il form si rimonta e rilegge `initial`.
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setSession((s) => s + 1);
  }
  return <ContactsForm key={session} {...props} />;
}

function companyName(c: ContactsCompany): string {
  return c.name ?? c.domain ?? `Azienda #${c.company_id}`;
}

/** "Acme, Beta, Gamma… (+9)". */
export function namesPreview(names: string[], max = 3): string {
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')}… (+${names.length - max})`;
}

function ContactsForm(props: ContactsDialogProps) {
  const { open, onOpenChange, companies, onStarted } = props;
  const uid = useId();
  const [form, setForm] = useState(() => initialContactsForm(props.initial));
  const patch = (next: Partial<ContactsFormState>) => setForm((cur) => ({ ...cur, ...next }));

  // Modalità `company`: l'ICP è quello della lista scelta (liste e ICP dalle stesse query del ListPicker).
  const companyMode = props.mode === 'company';
  const lists = useQuery({ queryKey: queryKeys.listsIndex(), queryFn: () => api.lists.list(), enabled: companyMode && open });
  const icps = useQuery({ queryKey: queryKeys.icpsIndex, queryFn: api.icps.list, enabled: companyMode && open });
  const chosenList = companyMode ? lists.data?.items.find((l) => l.id === form.listId) : undefined;
  const icp: ContactsIcp | null =
    props.mode === 'icp' ? props.icp : chosenList ? (icps.data?.items.find((i) => i.id === chosenList.icp_id) ?? null) : null;
  const icpId = icp?.id ?? null;

  const perCheck = checkPerCompany(form.perCompanyText);
  const lastGoodPer = useRef<number | undefined>(undefined);
  if (perCheck.ok) lastGoodPer.current = perCheck.value;
  const perForPreview = perCheck.ok ? perCheck.value : lastGoodPer.current;

  const companyIds = useMemo(() => companies.map((c) => c.company_id), [companies]);
  const params: ContactsPreviewParams | null =
    icpId === null ? null : { icpId, companyIds, ...contactsPreviewOptions(form, perForPreview) };
  const [debouncedKey, syncing] = useDebouncedKey(JSON.stringify(params));
  const debounced = useMemo(() => JSON.parse(debouncedKey) as ContactsPreviewParams | null, [debouncedKey]);

  const preview = useJobPreview('apollo_people', debounced ?? { icpId: 0, companyIds: [] }, {
    enabled: open && debounced !== null,
  });

  // Default del tetto per azienda (config del server): letto da una preview senza `perCompany`.
  const [defaultPer, setDefaultPer] = useState<number | null>(null);
  useEffect(() => {
    if (preview.data && debounced && debounced.perCompany === undefined) setDefaultPer(preview.data.counts.per_company);
  }, [preview.data, debounced]);

  const start = useJobStart(({ icpId: id, body }: { icpId: number; body: ContactsBody }) => api.contacts.start(id, body), {
    onStarted: (job) => {
      onOpenChange(false);
      onStarted?.(job);
    },
  });
  const busy = start.isPending;

  const onStart = () => {
    if (!preview.data || !perCheck.ok || form.listId === null || icpId === null) return;
    start.mutate({
      icpId,
      body: { companyIds, listId: form.listId, ...contactsStartOptions(form, icp, perCheck.value) },
    });
  };

  const noListPreview: JobPreview = {
    counts: {},
    est_cost_usd: null,
    warnings: [],
    blockers: ['Scegli una lista di destinazione.'],
  };
  const shownPreview: JobPreviewQuery =
    params === null
      ? { data: noListPreview, isPending: false, error: null, refetch: () => undefined }
      : {
          data:
            preview.data && !perCheck.ok ? { ...preview.data, blockers: [...preview.data.blockers, perCheck.message] } : preview.data,
          isPending: preview.isPending || syncing || !preview.isFetchedAfterMount,
          isFetching: preview.isFetching,
          error: preview.error,
          refetch: preview.refetch,
        };

  const n = companies.length;
  return (
    <JobPreviewDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Trova contatti in ${n === 1 ? companyName(companies[0]) : `${nf(n)} aziende`}`}
      description="Apollo cerca le persone con i ruoli dell'ICP nelle aziende scelte, ne rivela profilo LinkedIn ed email di lavoro (1 credito a persona trovata) e le aggiunge alla lista in stato 'nuovo'."
      preview={shownPreview}
      summary={(data) =>
        params === null ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700" data-testid="contacts-credits-line">
            Scegli la lista di destinazione: ruoli, località e crediti stimati dipendono dal suo ICP.
          </p>
        ) : (
          <ContactsSummary data={data as ContactsPreview} companies={companies} />
        )
      }
      startLabel="Avvia ricerca"
      starting={busy}
      onStart={onStart}
    >
      <ScopeSection companies={companies} mode={props.mode} />
      <ContactsFields
        idPrefix={uid}
        state={form}
        onChange={patch}
        target={
          props.mode === 'icp'
            ? { mode: 'icp', icp: props.icp }
            : {
                mode: 'company',
                icp,
                onListChosen: (listIcpId) => {
                  // Default di ruoli e località dall'ICP della lista: si ricalcolano solo se l'ICP cambia.
                  if (chosenList && chosenList.icp_id === listIcpId) return;
                  patch({ roles: null, roleDraft: '', locations: null, locationDraft: '' });
                },
              }
        }
        defaultPerCompany={defaultPer}
        perCompanyError={perCheck.ok ? null : perCheck.message}
        disabled={busy}
      />
    </JobPreviewDialog>
  );
}

/** Ambito in sola lettura: "12 aziende accettate: Acme, Beta, Gamma… (+9)" con "mostra tutte". */
function ScopeSection({ companies, mode }: { companies: ContactsCompany[]; mode: 'icp' | 'company' }) {
  const uid = useId();
  const [expanded, setExpanded] = useState(false);
  const names = companies.map(companyName);
  const n = companies.length;
  const noun = mode === 'icp' ? (n === 1 ? 'azienda accettata' : 'aziende accettate') : n === 1 ? 'azienda' : 'aziende';
  return (
    <section aria-labelledby={`${uid}-scope`} className="flex flex-col gap-1 text-sm">
      <h3 id={`${uid}-scope`} className="text-sm font-medium text-slate-900">
        Ambito
      </h3>
      {n === 0 ? (
        <p className="text-slate-600">Nessuna azienda selezionata.</p>
      ) : (
        <p className="text-slate-700" data-testid="contacts-scope">
          {nf(n)} {noun}: {expanded ? names.join(', ') : namesPreview(names)}
          {n > 3 && (
            <>
              {' '}
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={`${uid}-all`}
                onClick={() => setExpanded((v) => !v)}
                className="cursor-pointer text-xs font-medium text-slate-500 underline hover:text-slate-900"
              >
                {expanded ? 'mostra meno' : 'mostra tutte'}
              </button>
            </>
          )}
        </p>
      )}
      {expanded && (
        <ul id={`${uid}-all`} className="flex max-h-40 flex-col gap-0.5 overflow-y-auto rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-700">
          {companies.map((c) => (
            <li key={c.company_id}>
              <span className="font-medium text-slate-900">{companyName(c)}</span>{' '}
              {c.domain ? `(${c.domain})` : <span className="text-amber-800">(senza sito: esclusa)</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Campi
// ---------------------------------------------------------------------------

export type ContactsFieldsTarget =
  | { mode: 'icp'; icp: ContactsIcp & { lists: IcpListRef[] } }
  | {
      mode: 'company';
      /** ICP della lista scelta (`null` finché non c'è). */
      icp: ContactsIcp | null;
      /** Chiamata quando si sceglie una lista, con l'ICP della lista (prima che lo stato si aggiorni). */
      onListChosen?: (icpId: number) => void;
    };

export interface ContactsFieldsProps {
  idPrefix: string;
  state: ContactsFormState;
  onChange: (patch: Partial<ContactsFormState>) => void;
  target: ContactsFieldsTarget;
  /** Default del tetto per azienda letto dalla preview (`null` = non ancora noto). */
  defaultPerCompany: number | null;
  perCompanyError: string | null;
  disabled?: boolean;
}

/** Lista di destinazione, ruoli, seniority, località e massimo per azienda (FLOW C.2). */
export function ContactsFields({ idPrefix, state, onChange, target, defaultPerCompany, perCompanyError, disabled }: ContactsFieldsProps) {
  const icp = target.icp;
  const perCompanyValue = state.perCompanyText ?? (defaultPerCompany !== null ? String(defaultPerCompany) : '');
  const noIcp = icp === null;

  return (
    <>
      <section aria-labelledby={`${idPrefix}-list`} className="flex flex-col gap-1.5">
        <h3 id={`${idPrefix}-list`} className="text-sm font-medium text-slate-900">
          Lista di destinazione
        </h3>
        {target.mode === 'icp' ? (
          <IcpListChoice
            idPrefix={idPrefix}
            icp={target.icp}
            value={state.listId}
            onChange={(listId) => onChange({ listId })}
            disabled={disabled}
          />
        ) : (
          <ListPicker
            value={state.listId}
            onChange={(listId, list) => {
              target.onListChosen?.(list.icp_id);
              onChange({ listId });
            }}
            disabled={disabled}
          />
        )}
        {icp && <p className="text-xs text-slate-500">ICP: {icp.name}</p>}
      </section>

      <ChipsInput
        id={`${idPrefix}-roles`}
        label="Ruoli"
        item="ruolo"
        placeholder={noIcp ? 'Scegli prima la lista' : 'es. CTO'}
        hint="Dai ruoli target dell'ICP. Vuoto = le prime persone qualunque per azienda. Invio aggiunge, non avvia."
        values={state.roles ?? icp?.target_roles ?? []}
        onValuesChange={(roles) => onChange({ roles })}
        draft={state.roleDraft}
        onDraftChange={(roleDraft) => onChange({ roleDraft })}
        disabled={disabled || noIcp}
      />

      <fieldset disabled={disabled} aria-describedby={`${idPrefix}-seniority-hint`} className="flex flex-col gap-1.5">
        <legend className="mb-1 text-xs font-medium text-slate-600">Seniority</legend>
        <div className="grid grid-cols-3 gap-x-3 gap-y-1.5">
          {APOLLO_SENIORITIES.map((seniority) => (
            <label key={seniority} className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-800">
              <Checkbox
                checked={state.seniorities.includes(seniority)}
                disabled={disabled}
                onCheckedChange={(value) =>
                  onChange({
                    seniorities:
                      value === true
                        ? APOLLO_SENIORITIES.filter((s) => s === seniority || state.seniorities.includes(s))
                        : state.seniorities.filter((s) => s !== seniority),
                  })
                }
              />
              {APOLLO_SENIORITY_LABELS[seniority]}
            </label>
          ))}
        </div>
        <p id={`${idPrefix}-seniority-hint`} className="text-xs text-slate-500">
          Filtro Apollo sul livello; lascia vuoto per non filtrare.
        </p>
      </fieldset>

      <ChipsInput
        id={`${idPrefix}-locations`}
        label="Località"
        item="località"
        placeholder={noIcp ? 'Scegli prima la lista' : 'es. Milano'}
        hint="Dalle località dell'ICP. Vuoto = ovunque. Invio aggiunge, non avvia."
        values={state.locations ?? icp?.target_locations ?? []}
        onValuesChange={(locations) => onChange({ locations })}
        draft={state.locationDraft}
        onDraftChange={(locationDraft) => onChange({ locationDraft })}
        disabled={disabled || noIcp}
      />

      <div className="flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-per-company`} className="text-xs font-medium text-slate-600">
          Massimo persone per azienda
        </label>
        <Input
          id={`${idPrefix}-per-company`}
          type="number"
          inputMode="numeric"
          min={1}
          max={APOLLO_PEOPLE_PER_COMPANY_MAX}
          step={1}
          value={perCompanyValue}
          placeholder={defaultPerCompany === null ? '…' : undefined}
          disabled={disabled}
          className="w-24"
          aria-invalid={perCompanyError ? true : undefined}
          aria-describedby={perCompanyError ? `${idPrefix}-per-company-error` : `${idPrefix}-per-company-hint`}
          onChange={(e) => onChange({ perCompanyText: e.target.value })}
        />
        {perCompanyError ? (
          <p id={`${idPrefix}-per-company-error`} role="alert" className="text-sm text-red-700">
            {perCompanyError}
          </p>
        ) : (
          <p id={`${idPrefix}-per-company-hint`} className="text-xs text-slate-500">
            Da 1 a {APOLLO_PEOPLE_PER_COMPANY_MAX}
            {defaultPerCompany !== null ? ` (default ${defaultPerCompany}, APOLLO_PEOPLE_PER_COMPANY)` : ''}: è il tetto dei
            crediti per azienda.
          </p>
        )}
      </div>
    </>
  );
}

/**
 * Liste **attive** dell'ICP come radio (preselezione se ce n'è una sola), con "Crea nuova lista" inline sull'ICP
 * (FLOW C.2). Nessun `<form>` annidato: vive dentro il dialog.
 */
export function IcpListChoice(props: {
  idPrefix: string;
  icp: Pick<ContactsIcp, 'id' | 'name'> & { lists: IcpListRef[] };
  value: number | null;
  onChange: (listId: number) => void;
  disabled?: boolean;
}) {
  const { icp, value, onChange, disabled, idPrefix } = props;
  // Liste create qui prima che il dettaglio ICP sia ricaricato.
  const [created, setCreated] = useState<IcpListRef[]>([]);
  const active = mergeIcpLists(icp.lists, created).filter((l) => l.archived_at === null);
  const [creating, setCreating] = useState(false);

  const preselected = useRef(false);
  useEffect(() => {
    if (preselected.current || value !== null) return;
    preselected.current = true;
    if (active.length === 1) onChange(active[0].id);
  }, [active, onChange, value]);

  const showForm = creating || active.length === 0;
  return (
    <div className="flex flex-col gap-2" role="group" aria-label={`Liste attive di ${icp.name}`}>
      {active.length > 0 && (
        <div className="flex flex-col gap-0.5 rounded-lg border border-slate-200 px-3 py-2">
          {active.map((list) => (
            <label key={list.id} className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-slate-100">
              <input
                type="radio"
                name={`${idPrefix}-list-choice`}
                value={list.id}
                checked={value === list.id}
                disabled={disabled}
                onChange={() => onChange(list.id)}
                className="size-4 accent-slate-900"
              />
              <span className="font-medium text-slate-900">{list.name}</span>
            </label>
          ))}
        </div>
      )}
      {showForm ? (
        <CreateIcpList
          idPrefix={`${idPrefix}-create`}
          icpId={icp.id}
          title={active.length === 0 ? 'Nessuna lista attiva per questo ICP: creane una' : 'Crea nuova lista'}
          disabled={disabled}
          onCancel={active.length > 0 ? () => setCreating(false) : undefined}
          onCreated={(list) => {
            setCreated((cur) => [...cur, list]);
            setCreating(false);
            onChange(list.id);
          }}
        />
      ) : (
        <Button type="button" variant="outline" size="sm" className="self-start" disabled={disabled} onClick={() => setCreating(true)}>
          + Crea nuova lista
        </Button>
      )}
    </div>
  );
}

/** Unione per id: le liste del dettaglio ICP prevalgono su quelle appena create. */
export function mergeIcpLists(lists: IcpListRef[], created: IcpListRef[]): IcpListRef[] {
  const ids = new Set(lists.map((l) => l.id));
  return [...lists, ...created.filter((l) => !ids.has(l.id))];
}

/** "Crea lista" inline su un ICP fisso: nome + bottone; Invio crea senza inviare il form esterno. */
export function CreateIcpList(props: {
  idPrefix: string;
  icpId: number;
  title: string;
  disabled?: boolean;
  autoFocus?: boolean;
  onCreated: (list: IcpListRef) => void;
  onCancel?: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => api.lists.create({ icpId: props.icpId, name: name.trim() }),
    onSuccess: (list) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.lists });
      void queryClient.invalidateQueries({ queryKey: queryKeys.icps });
      // Il blocker "Scegli una lista" / "Crea una lista per questo ICP" delle preview cambia.
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobPreviews });
      setName('');
      props.onCreated({ id: list.id, name: list.name, archived_at: list.archived_at });
    },
  });
  const error = create.error instanceof Error ? create.error.message : null;
  const canCreate = name.trim() !== '' && !create.isPending && !props.disabled;
  const submit = () => {
    if (canCreate) create.mutate();
  };
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-3">
      <p className="text-sm font-medium text-slate-900">{props.title}</p>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${props.idPrefix}-name`} className="text-xs font-medium text-slate-600">
          Nome della lista
        </label>
        <Input
          id={`${props.idPrefix}-name`}
          value={name}
          autoFocus={props.autoFocus}
          disabled={props.disabled}
          placeholder="es. HR tech — decisori"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${props.idPrefix}-error` : undefined}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
        />
      </div>
      {error && (
        <p id={`${props.idPrefix}-error`} role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={submit} disabled={!canCreate} aria-busy={create.isPending}>
          {create.isPending ? 'Creazione…' : 'Crea lista'}
        </Button>
        {props.onCancel && (
          <Button type="button" size="sm" variant="ghost" onClick={props.onCancel}>
            Annulla
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Anteprima
// ---------------------------------------------------------------------------

function plural(n: number, one: string, many: string): string {
  return `${nf(n)} ${n === 1 ? one : many}`;
}

/**
 * Riga dei crediti sempre visibile (FLOW C.2, S-6): "12 aziende · 11 con dominio · 1 senza dominio esclusa
 * (Delta) · fino a 110 persone · fino a 22 richieste Apollo · Crediti stimati: fino a 110 (1 per persona trovata)".
 */
export function ContactsSummary({ data, companies }: { data: ContactsPreview | JobPreview; companies: ContactsCompany[] }) {
  const c = data.counts;
  const withoutDomain = c.without_domain ?? 0;
  const credits = c.est_credits ?? 0;
  const noDomainNames = companies.filter((x) => !x.domain).map(companyName);
  const parts = [
    plural(c.companies ?? 0, 'azienda', 'aziende'),
    `${nf(c.with_domain)} con dominio`,
    withoutDomain > 0 &&
      `${nf(withoutDomain)} senza dominio ${withoutDomain === 1 ? 'esclusa' : 'escluse'}${noDomainNames.length > 0 ? ` (${namesPreview(noDomainNames)})` : ''}`,
    `fino a ${plural(credits, 'persona', 'persone')}`,
    `fino a ${plural(c.requests ?? 0, 'richiesta Apollo', 'richieste Apollo')} (una ricerca per azienda + i match a lotti da 10)`,
  ].filter((p): p is string => typeof p === 'string');
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700" data-testid="contacts-credits-line">
      <p>
        {parts.join(' · ')} · <span className="font-medium">Crediti stimati:</span> fino a {nf(credits)} (1 per persona trovata)
      </p>
      {data.est_cost_usd === null && (
        <p className="text-xs text-slate-500">
          Stima non disponibile — imposta APOLLO_CREDIT_USD nel .env per vedere il costo; i crediti restano fino a {nf(credits)}.
        </p>
      )}
      <p className="text-xs text-slate-500">
        La ricerca è gratuita; paghi solo le persone trovate, che arrivano con profilo LinkedIn ed email di lavoro. Riduci il
        massimo per azienda per spendere meno.
      </p>
    </div>
  );
}
