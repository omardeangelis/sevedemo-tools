import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ExternalLinkIcon, UsersIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { api, isApiError, queryKeys } from '../api/client';
import {
  REFERENCE_OUTCOMES,
  REFERENCE_OUTCOME_LABELS,
  type CompanyInput,
  type CompanyReferenceOf,
  type CompanyWithRefs,
  type Job,
  type ProspectQuery,
  type ReferenceOutcome,
} from '../api/types';
import { AddToListDialog } from '../components/AddToListDialog';
import { BulkBar } from '../components/BulkBar';
import { ProspectTable, formatDay, searchParam } from '../components/ProspectTable';
import {
  CompanyExistsNotice,
  SourceCompanyDialog,
  companyLabel,
  shortCompanyUrl,
  sourceValuesFromJob,
  type SourceDialogValues,
} from '../components/SourceCompanyDialog';
import { Card, ErrorBox, Loading, PageHeader } from '../components/ui';
import { toast } from '../components/ui/toaster';
import { describeJobError, isZeroOutcome, jobOutcomeTone, useCurrentJob } from '../lib/jobs';

/*
 * Dettaglio azienda (crm-foundation T19, FLOW D): anagrafica modificabile, ICP di cui è riferimento
 * (con esito), ricerche di persone già fatte (così non rilancio la stessa per sbaglio; "Riprova con
 * altri filtri" sugli esiti a zero) e prospect collegati (`ProspectTable` con `companyId`, selezione e
 * "Aggiungi a lista"). "Estrai persone" apre il `SourceCompanyDialog`; `?listId=` (dalla Lista, via
 * `/companies`) lo apre subito con quella lista preselezionata.
 */

interface CompanySearch {
  /** Lista da preselezionare: apre subito "Cerca persone". */
  listId?: number;
  /** Pagina dei prospect collegati. */
  page?: number;
}

export const Route = createFileRoute('/companies/$id')({
  component: CompanyRoute,
  validateSearch: (s: Record<string, unknown>): CompanySearch => ({
    listId: searchParam.id(s.listId),
    page: searchParam.page(s.page),
  }),
});

const PAGE_SIZE = 50;
const labelCls = 'text-xs font-medium text-slate-600';
const selectCls =
  'h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50';
const textareaCls =
  'min-h-16 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

/** Messaggio leggibile di un errore di scrittura (messaggi zod se presenti). */
function errorText(err: unknown): string {
  if (isApiError(err) && err.body?.issues?.length) return err.body.issues.map((i) => i.message).join(' ');
  return err instanceof Error ? err.message : 'Operazione non riuscita.';
}

function CompanyRoute() {
  const { id } = Route.useParams();
  const companyId = searchParam.id(id);
  return companyId === undefined ? <CompanyNotFound /> : <CompanyDetail key={companyId} companyId={companyId} />;
}

function CompanyNotFound() {
  return (
    <div className="py-20 text-center text-sm text-slate-500">
      <h1 className="text-lg font-semibold text-slate-900">Azienda non trovata</h1>
      <p className="mt-1">L'azienda non esiste.</p>
      <Link to="/companies" className="mt-3 inline-block font-medium text-slate-900 underline">
        Torna alle aziende
      </Link>
    </div>
  );
}

function CompanyDetail({ companyId }: { companyId: number }) {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const company = useQuery({
    queryKey: queryKeys.company(companyId),
    queryFn: () => api.companies.get(companyId),
    retry: (count, err) => !(isApiError(err) && err.status === 404) && count < 2,
  });

  // Dialog "Cerca persone": con `?listId=` si apre subito con la lista preselezionata; dopo un avvio
  // la prossima apertura ripropone l'ultima lista usata.
  const lastListId = useRef(search.listId);
  const [sourcing, setSourcing] = useState<{ open: boolean; initial?: SourceDialogValues }>(() => ({
    open: search.listId !== undefined,
    initial: search.listId !== undefined ? { listId: search.listId } : undefined,
  }));
  const openSourcing = (initial?: SourceDialogValues) =>
    setSourcing({ open: true, initial: initial ?? (lastListId.current ? { listId: lastListId.current } : undefined) });
  const onSourcingOpenChange = (open: boolean) => {
    setSourcing((cur) => ({ ...cur, open }));
    // Il deep-link ha fatto il suo lavoro: un reload non riapre il dialog.
    if (!open && search.listId !== undefined) void navigate({ search: (prev) => ({ ...prev, listId: undefined }), replace: true });
  };
  const onSourcingStarted = (job: Job) => {
    if (typeof job.params.listId === 'number') lastListId.current = job.params.listId;
  };

  if (company.isPending) return <Loading />;
  if (company.error) {
    if (isApiError(company.error) && company.error.status === 404) return <CompanyNotFound />;
    return (
      <div className="flex flex-col items-start gap-3">
        <ErrorBox error={company.error} />
        <Button type="button" variant="outline" onClick={() => void company.refetch()}>
          Riprova
        </Button>
      </div>
    );
  }

  const data = company.data;
  const label = companyLabel(data);

  return (
    <>
      <nav aria-label="Percorso" className="mb-2 text-sm text-slate-500">
        <Link to="/companies" className="hover:underline">
          Aziende
        </Link>{' '}
        / <span className="text-slate-700">{label}</span>
      </nav>
      <PageHeader
        title={label}
        subtitle={[data.industry, data.size, data.location].filter(Boolean).join(' · ') || shortCompanyUrl(data.linkedin_url)}
        actions={
          <>
            <a
              href={data.linkedin_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium hover:bg-muted"
            >
              <ExternalLinkIcon className="size-4" aria-hidden="true" />
              Apri su LinkedIn
            </a>
            <Button type="button" onClick={() => openSourcing()}>
              <UsersIcon aria-hidden="true" />
              Estrai persone
            </Button>
          </>
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card title="Anagrafica">
          {/* Rimontato quando cambia il salvato: il form riparte dai valori normalizzati dal server. */}
          <CompanyForm key={data.updated_at} company={data} />
        </Card>
        <div className="flex flex-col gap-6">
          <References company={data} />
          <SourcingHistory companyId={companyId} onRetry={(job) => openSourcing(sourceValuesFromJob(job))} />
        </div>
      </div>

      <LinkedProspects
        companyId={companyId}
        label={label}
        page={search.page ?? 1}
        onPageChange={(p) => void navigate({ search: (prev) => ({ ...prev, page: p > 1 ? p : undefined }) })}
        onSource={() => openSourcing()}
      />

      <SourceCompanyDialog
        open={sourcing.open}
        onOpenChange={onSourcingOpenChange}
        company={data}
        initial={sourcing.initial}
        onStarted={onSourcingStarted}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Anagrafica
// ---------------------------------------------------------------------------

type FieldKey = 'name' | 'linkedin_url' | 'website' | 'industry' | 'size' | 'location' | 'notes';

const FIELDS: ReadonlyArray<{ key: Exclude<FieldKey, 'notes'>; label: string; placeholder?: string }> = [
  { key: 'name', label: 'Nome', placeholder: 'es. Acme Robotica Srl' },
  { key: 'linkedin_url', label: 'URL LinkedIn', placeholder: 'https://www.linkedin.com/company/acme/' },
  { key: 'website', label: 'Sito web', placeholder: 'https://acme.it' },
  { key: 'industry', label: 'Settore', placeholder: 'es. Manifattura' },
  { key: 'size', label: 'Dimensione', placeholder: 'es. 51–200 dipendenti' },
  { key: 'location', label: 'Sede', placeholder: 'es. Bergamo' },
];

function CompanyForm({ company }: { company: CompanyWithRefs }) {
  const uid = useId();
  const queryClient = useQueryClient();
  const urlRef = useRef<HTMLInputElement>(null);
  const initial = (key: FieldKey) => company[key] ?? '';
  const [values, setValues] = useState<Record<FieldKey, string>>(() => ({
    name: initial('name'),
    linkedin_url: initial('linkedin_url'),
    website: initial('website'),
    industry: initial('industry'),
    size: initial('size'),
    location: initial('location'),
    notes: initial('notes'),
  }));
  const [urlError, setUrlError] = useState<string | null>(null);
  const [duplicateId, setDuplicateId] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: CompanyInput) => api.companies.update(company.id, body),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.company(company.id), updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.companies });
      // Nome e anagrafica compaiono nelle fonti dei prospect e nei riferimenti degli ICP.
      void queryClient.invalidateQueries({ queryKey: queryKeys.prospects });
      void queryClient.invalidateQueries({ queryKey: queryKeys.icps });
      toast({ title: 'Anagrafica salvata', description: companyLabel(updated) });
    },
    onError: (err) => {
      if (isApiError(err, 'duplicate') && typeof err.body?.existing_id === 'number') {
        setDuplicateId(err.body.existing_id);
        urlRef.current?.focus();
      } else if (isApiError(err, 'invalid_company_url')) {
        setUrlError(err.message);
        urlRef.current?.focus();
      } else {
        setFormError(errorText(err));
      }
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setUrlError(null);
    setDuplicateId(null);
    setFormError(null);
    const body: CompanyInput = {};
    for (const key of Object.keys(values) as FieldKey[]) {
      const next = values[key].trim();
      if (next === (company[key] ?? '')) continue;
      if (key === 'linkedin_url') {
        if (next === '') {
          setUrlError('Inserisci un URL del tipo linkedin.com/company/<nome>');
          urlRef.current?.focus();
          return;
        }
        body.linkedin_url = next;
      } else {
        body[key] = next === '' ? null : next;
      }
    }
    if (Object.keys(body).length === 0) {
      toast({ tone: 'neutral', title: 'Nessuna modifica da salvare' });
      return;
    }
    save.mutate(body);
  };

  const set = (key: FieldKey, value: string) => {
    setValues((cur) => ({ ...cur, [key]: value }));
    if (key === 'linkedin_url') {
      setUrlError(null);
      setDuplicateId(null);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4 px-4 py-4">
      {!company.name && (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
          Aggiungi il nome: lo vedi negli esiti delle ricerche, nelle fonti dei prospect e tra i riferimenti degli ICP.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((field) => {
          const isUrl = field.key === 'linkedin_url';
          const invalid = isUrl && (urlError !== null || duplicateId !== null);
          return (
            <div key={field.key} className={cn('flex flex-col gap-1', isUrl && 'sm:col-span-2')}>
              <label htmlFor={`${uid}-${field.key}`} className={labelCls}>
                {field.label}
              </label>
              <Input
                ref={isUrl ? urlRef : undefined}
                id={`${uid}-${field.key}`}
                type={isUrl || field.key === 'website' ? 'url' : 'text'}
                value={values[field.key]}
                placeholder={field.placeholder}
                aria-invalid={invalid || undefined}
                aria-describedby={isUrl && invalid ? `${uid}-url-error` : undefined}
                onChange={(e) => set(field.key, e.target.value)}
              />
              {isUrl && urlError && (
                <p id={`${uid}-url-error`} role="alert" className="text-sm text-red-700">
                  {urlError}
                </p>
              )}
              {isUrl && duplicateId !== null && <CompanyExistsNotice id={`${uid}-url-error`} companyId={duplicateId} />}
            </div>
          );
        })}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${uid}-notes`} className={labelCls}>
          Note
        </label>
        <textarea
          id={`${uid}-notes`}
          rows={3}
          value={values.notes}
          onChange={(e) => set('notes', e.target.value)}
          className={textareaCls}
          placeholder="es. Stanno migrando l'ERP; referente conosciuto a un evento."
        />
      </div>
      {formError && (
        <p role="alert" className="text-sm text-red-700">
          {formError}
        </p>
      )}
      <div>
        <Button type="submit" disabled={save.isPending} aria-busy={save.isPending}>
          {save.isPending ? 'Salvataggio…' : 'Salva anagrafica'}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Riferimento per gli ICP
// ---------------------------------------------------------------------------

/** Dopo ogni scrittura sui riferimenti: azienda, elenco aziende, ICP (dettaglio e conteggi). */
function useInvalidateReferences() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.companies }),
      queryClient.invalidateQueries({ queryKey: queryKeys.icps }),
    ]);
}

function References({ company }: { company: CompanyWithRefs }) {
  const refs = company.reference_of;
  return (
    <Card title={`Riferimento per ICP${refs.length > 0 ? ` (${refs.length})` : ''}`}>
      {refs.length === 0 ? (
        <p className="px-4 py-4 text-sm text-slate-500">
          Non è azienda di riferimento di nessun ICP. Segnala le aziende con cui hai trattato bene: aiutano l'analisi AI a capire
          chi è davvero un buon fit.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100" aria-label="ICP di cui è riferimento">
          {refs.map((ref) => (
            <ReferenceRow key={ref.icp_id} company={company} reference={ref} />
          ))}
        </ul>
      )}
      <AddReference company={company} />
    </Card>
  );
}

function ReferenceRow({ company, reference }: { company: CompanyWithRefs; reference: CompanyReferenceOf }) {
  const uid = useId();
  const invalidate = useInvalidateReferences();
  const label = companyLabel(company);

  const update = useMutation({
    mutationFn: (outcome: ReferenceOutcome) => api.icps.setReference(reference.icp_id, company.id, { outcome }),
    onSuccess: async (_saved, outcome) => {
      await invalidate();
      toast({ title: `Esito aggiornato per ${reference.icp_name}`, description: REFERENCE_OUTCOME_LABELS[outcome] });
    },
    onError: (err) => toast({ tone: 'error', title: 'Riferimento non aggiornato', description: errorText(err) }),
  });
  const remove = useMutation({
    mutationFn: () => api.icps.removeReference(reference.icp_id, company.id),
    onSuccess: async () => {
      await invalidate();
      toast({ title: `${label} non è più riferimento di ${reference.icp_name}` });
    },
    onError: (err) => toast({ tone: 'error', title: 'Rimozione non riuscita', description: errorText(err) }),
  });
  const outcome = update.isPending && update.variables ? update.variables : reference.outcome;

  return (
    <li className="flex flex-col gap-1 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to="/icps/$id" params={{ id: String(reference.icp_id) }} className="text-sm font-medium text-slate-900 hover:underline">
          {reference.icp_name}
        </Link>
        <div className="flex items-center gap-1">
          <label htmlFor={`${uid}-outcome`} className="sr-only">
            Esito con {label} per {reference.icp_name}
          </label>
          <select
            id={`${uid}-outcome`}
            value={outcome}
            disabled={update.isPending || remove.isPending}
            onChange={(e) => update.mutate(e.target.value as ReferenceOutcome)}
            className={selectCls}
          >
            {REFERENCE_OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {REFERENCE_OUTCOME_LABELS[o]}
              </option>
            ))}
          </select>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
            aria-busy={remove.isPending}
            aria-label={`Rimuovi ${label} dai riferimenti di ${reference.icp_name}`}
          >
            Rimuovi
          </Button>
        </div>
      </div>
      {reference.notes && <p className="text-sm text-slate-600">{reference.notes}</p>}
    </li>
  );
}

function AddReference({ company }: { company: CompanyWithRefs }) {
  const uid = useId();
  const invalidate = useInvalidateReferences();
  const icps = useQuery({ queryKey: queryKeys.icpsIndex, queryFn: api.icps.list });
  const [icpId, setIcpId] = useState('');
  const [outcome, setOutcome] = useState<ReferenceOutcome>('vinta');

  const add = useMutation({
    mutationFn: (target: { icpId: number; icpName: string }) => api.icps.setReference(target.icpId, company.id, { outcome }),
    onSuccess: async (_saved, target) => {
      await invalidate();
      setIcpId('');
      toast({ title: `${companyLabel(company)} è riferimento di ${target.icpName}`, description: `Esito: ${REFERENCE_OUTCOME_LABELS[outcome]}` });
    },
    onError: (err) => toast({ tone: 'error', title: 'Riferimento non salvato', description: errorText(err) }),
  });

  if (!icps.data) return null;
  if (icps.data.items.length === 0) {
    return (
      <p className="border-t border-slate-100 px-4 py-3 text-sm text-slate-500">
        Per segnarla come riferimento{' '}
        <Link to="/icps/$id" params={{ id: 'nuovo' }} className="font-medium text-slate-900 underline">
          crea prima un ICP
        </Link>
        .
      </p>
    );
  }
  const available = icps.data.items.filter((icp) => !company.reference_of.some((r) => r.icp_id === icp.id));
  if (available.length === 0) return null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const icp = available.find((i) => String(i.id) === icpId);
    if (icp) add.mutate({ icpId: icp.id, icpName: icp.name });
  };

  return (
    <form onSubmit={submit} aria-label="Segna come azienda di riferimento" className="flex flex-wrap items-end gap-2 border-t border-slate-100 bg-slate-50 px-4 py-3">
      <div className="flex flex-col gap-1">
        <label htmlFor={`${uid}-icp`} className={labelCls}>
          Riferimento per l'ICP
        </label>
        <select id={`${uid}-icp`} value={icpId} onChange={(e) => setIcpId(e.target.value)} className={cn(selectCls, 'bg-white')}>
          <option value="">Scegli l'ICP…</option>
          {available.map((icp) => (
            <option key={icp.id} value={icp.id}>
              {icp.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${uid}-outcome`} className={labelCls}>
          Esito
        </label>
        <select
          id={`${uid}-outcome`}
          value={outcome}
          onChange={(e) => setOutcome(e.target.value as ReferenceOutcome)}
          className={cn(selectCls, 'bg-white')}
        >
          {REFERENCE_OUTCOMES.map((o) => (
            <option key={o} value={o}>
              {REFERENCE_OUTCOME_LABELS[o]}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" size="sm" variant="outline" disabled={icpId === '' || add.isPending} aria-busy={add.isPending}>
        Segna come riferimento
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Ricerche di persone (job di sourcing su questa azienda)
// ---------------------------------------------------------------------------

const OUTCOME_TEXT = {
  running: 'In corso',
  success: 'Completata',
  neutral: 'Nessun risultato',
  warning: 'Attenzione',
  error: 'Errore',
} as const;

const OUTCOME_STYLE = {
  running: 'bg-sky-100 text-sky-800',
  success: 'bg-emerald-100 text-emerald-800',
  neutral: 'bg-slate-100 text-slate-700',
  warning: 'bg-amber-100 text-amber-900',
  error: 'bg-red-100 text-red-800',
} as const;

function SourcingHistory({ companyId, onRetry }: { companyId: number; onRetry: (job: Job) => void }) {
  const jobs = useQuery({ queryKey: queryKeys.jobsIndex(100), queryFn: () => api.jobs.list(100) });
  const lists = useQuery({ queryKey: queryKeys.listsIndex(true), queryFn: () => api.lists.list({ includeArchived: true }) });
  // Un job che parte o finisce cambia lo storico: si ricarica al cambio del job corrente.
  const currentData = useCurrentJob().data;
  const currentKey = currentData === undefined ? undefined : currentData.job ? `${currentData.job.id}:${currentData.job.state}` : 'none';
  const seenKey = useRef(currentKey);
  const refetchJobs = jobs.refetch;
  useEffect(() => {
    if (currentKey === seenKey.current) return;
    const firstLoad = seenKey.current === undefined;
    seenKey.current = currentKey;
    if (!firstLoad) void refetchJobs();
  }, [currentKey, refetchJobs]);

  const items = (jobs.data?.items ?? []).filter((j) => j.kind === 'source_company' && j.params.companyId === companyId);
  const listName = (id: unknown) => lists.data?.items.find((l) => l.id === id)?.name;

  return (
    <Card title={`Ricerche di persone${items.length > 0 ? ` (${items.length})` : ''}`}>
      {jobs.isPending ? (
        <p className="px-4 py-3 text-sm text-slate-500">Caricamento…</p>
      ) : jobs.error ? (
        <div className="p-4">
          <ErrorBox error={jobs.error} />
        </div>
      ) : items.length === 0 ? (
        <p className="px-4 py-4 text-sm text-slate-500">Nessuna ricerca di persone ancora per questa azienda.</p>
      ) : (
        <ol className="divide-y divide-slate-100" aria-label="Ricerche di persone, dalla più recente">
          {items.map((job) => {
            const tone = jobOutcomeTone(job);
            const values = sourceValuesFromJob(job);
            const err = job.state === 'failed' ? describeJobError(job.error) : null;
            const canRetry = job.state === 'failed' || (job.state === 'succeeded' && isZeroOutcome(job));
            const when = job.started_at ?? job.created_at;
            return (
              <li key={job.id} className="flex flex-col gap-1 px-4 py-3 text-sm" data-job-id={job.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', OUTCOME_STYLE[tone])}>{OUTCOME_TEXT[tone]}</span>
                  <time dateTime={when} className="text-slate-600">
                    {formatDay(when)}, {new Date(when).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                  </time>
                  <span className="text-xs text-slate-500">#{job.id}</span>
                </div>
                <p className="text-slate-700">
                  {values.listId !== undefined && (
                    <>
                      Lista{' '}
                      <Link to="/lists/$id" params={{ id: String(values.listId) }} className="font-medium text-slate-900 hover:underline">
                        {listName(values.listId) ?? `#${values.listId}`}
                      </Link>{' '}
                      ·{' '}
                    </>
                  )}
                  {values.roles?.length ? `ruoli ${values.roles.join(', ')}` : 'nessun ruolo'}
                  {values.locations?.length ? ` · ${values.locations.join(', ')}` : ''}
                  {values.maxItems !== undefined && ` · max ${values.maxItems}`}
                  {values.mode && ` · ${values.mode}`}
                </p>
                {err ? (
                  <p className="break-words text-red-800">
                    {err.label && <span className="font-medium">{err.label}: </span>}
                    {err.message}
                  </p>
                ) : (
                  job.result?.summary && <p className="break-words text-slate-600">{job.result.summary}</p>
                )}
                {canRetry && (
                  <div>
                    <Button type="button" size="sm" variant="outline" onClick={() => onRetry(job)}>
                      Riprova con altri filtri
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Prospect collegati
// ---------------------------------------------------------------------------

const capText = (count: number, total: number) =>
  `Selezionati i primi ${count.toLocaleString('it-IT')} di ${total.toLocaleString('it-IT')}: affina i filtri per il resto.`;

function LinkedProspects(props: {
  companyId: number;
  label: string;
  page: number;
  onPageChange: (page: number) => void;
  onSource: () => void;
}) {
  const { companyId, page } = props;
  const query: ProspectQuery = { companyId, page, pageSize: PAGE_SIZE };
  const prospects = useQuery({
    queryKey: queryKeys.prospectsSearch(query),
    queryFn: () => api.prospects.search(query),
    placeholderData: keepPreviousData,
  });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [capNotice, setCapNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const updateSelection = (next: Set<number>) => {
    setSelected(next);
    setCapNotice(null);
  };

  const selectAll = useMutation({
    mutationFn: () => api.prospects.searchIds({ companyId }),
    onSuccess: ({ ids, total, capped }) => {
      setSelected((cur) => new Set([...cur, ...ids]));
      setCapNotice(capped ? capText(ids.length, total) : null);
    },
    onError: (err) => toast({ tone: 'error', title: 'Selezione non riuscita', description: err instanceof Error ? err.message : undefined }),
  });

  const total = prospects.data?.total ?? 0;
  const rows = prospects.data?.items ?? [];

  return (
    <>
      <Card title={`Prospect collegati${prospects.data ? ` (${total})` : ''}`} className="mt-6">
        {prospects.isPending ? (
          <Loading />
        ) : prospects.error ? (
          <div className="flex flex-col items-start gap-3 p-4">
            <ErrorBox error={prospects.error} />
            <Button type="button" variant="outline" onClick={() => void prospects.refetch()}>
              Riprova
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
            <p className="text-sm font-medium text-slate-700">Nessun prospect collegato a {props.label}.</p>
            <p className="max-w-md text-sm text-slate-500">
              Estrai le persone con i ruoli del tuo ICP: finiscono nella lista che scegli e compaiono qui.
            </p>
            <Button type="button" onClick={props.onSource}>
              <UsersIcon aria-hidden="true" />
              Estrai persone
            </Button>
          </div>
        ) : (
          <ProspectTable
            caption={`Prospect collegati a ${props.label}`}
            rows={rows}
            selected={selected}
            onSelectedChange={updateSelection}
            columns={{ lists: true, capturedAt: false }}
            fitWithIcp
            busy={prospects.isFetching && prospects.isPlaceholderData}
            selectAll={{ total, onSelectAll: () => selectAll.mutate(), pending: selectAll.isPending, notice: capNotice }}
            pagination={{ page, pageSize: PAGE_SIZE, total, onPageChange: props.onPageChange }}
          />
        )}
      </Card>

      <BulkBar count={selected.size} onClear={() => updateSelection(new Set())} notice={capNotice}>
        <Button type="button" size="sm" onClick={() => setAdding(true)}>
          Aggiungi a lista
        </Button>
      </BulkBar>

      <AddToListDialog
        open={adding}
        onOpenChange={setAdding}
        prospectIds={[...selected]}
        onAdded={() => updateSelection(new Set())}
      />
    </>
  );
}
