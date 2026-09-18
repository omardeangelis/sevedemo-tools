import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ContactRoundIcon, ExternalLinkIcon, GlobeIcon, SparklesIcon, UsersIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { api, companyExistsOf, errorText, isApiError, queryKeys } from '../api/client';
import {
  CANDIDATE_ACTIONS,
  CANDIDATE_STATUS_LABELS,
  CANDIDATE_STATUS_VERBS,
  REFERENCE_OUTCOMES,
  REFERENCE_OUTCOME_LABELS,
  type CandidateOf,
  type CandidateStatus,
  type CompanyExistsErrorBody,
  type CompanyInput,
  type CompanyReferenceOf,
  type CompanyWithRefs,
  type Job,
  type ProspectQuery,
  type ReferenceOutcome,
} from '../api/types';
import { AddToListDialog } from '../components/AddToListDialog';
import { BulkBar, useDialogFocusReturn } from '../components/BulkBar';
import { ContactsDialog } from '../components/ContactsDialog';
import { EnrichCompaniesDialog } from '../components/EnrichCompaniesDialog';
import { shortDay } from '../components/LookalikeDialog';
import { ProspectTable, formatDay, searchParam } from '../components/ProspectTable';
import {
  NoLinkedinBadge,
  SourceCompanyDialog,
  companyLabel,
  shortCompanyUrl,
  sourceValuesFromJob,
  type SourceDialogValues,
} from '../components/SourceCompanyDialog';
import { Card, ErrorBox, Loading } from '../components/ui';
import { toast } from '../components/ui/toaster';
import { countText } from '../lib/format';
import { describeJobError, invalidateCandidateQueries, isZeroOutcome, jobOutcomeTone, useCurrentJob } from '../lib/jobs';

/*
 * Dettaglio azienda (crm-foundation T19, FLOW D; apollo-lookalike T15, FLOW F e C.1, SPEC B4/B5/B11/B12/B14,
 * C4, E4/E5, F12): anagrafica modificabile con le due chiavi (URL LinkedIn e Sito web → "Dominio: …"; mai
 * entrambe vuote; 409 inline con "Unisci in <azienda>" e conferma di cosa si perde), badge "Senza pagina
 * LinkedIn", azioni "Estrai persone" (riga blocker senza URL LinkedIn), "Arricchisci con Apollo" (1 credito) e
 * "Trova contatti" (solo con dominio, "contatti cercati il <data>"), card "Candidata per ICP" con il triage, ICP
 * di cui è riferimento (con esito; la promozione toglie la candidatura), ricerche di persone già fatte ("Riprova
 * con altri filtri" sugli esiti a zero) e prospect collegati (`ProspectTable` con `companyId`, selezione e
 * "Aggiungi a lista"). `?listId=` (dalla Lista, via `/companies`) apre subito "Estrai persone" con quella lista.
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

/** Testo del blocker del sourcing senza URL LinkedIn (specchio di `NO_LINKEDIN_BLOCKER` in `src/jobs/source-company.ts`). */
const NO_LINKEDIN_BLOCKER = 'Azienda senza pagina LinkedIn: recuperala prima (Anagrafica → URL LinkedIn).';

function CompanyRoute() {
  const { id } = Route.useParams();
  const companyId = searchParam.id(id);
  return companyId === undefined ? <CompanyNotFound /> : <CompanyDetail key={companyId} companyId={companyId} />;
}

function CompanyNotFound() {
  return (
    <div className="py-20 text-center text-sm text-slate-500">
      <h1 className="text-lg font-semibold text-slate-900">Azienda non trovata</h1>
      <p className="mt-1">L'azienda non esiste (o è stata unita a un'altra).</p>
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
  const [enrichOpen, setEnrichOpen] = useState(false);
  const [contactsOpen, setContactsOpen] = useState(false);

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
  const subtitle = [data.domain, data.industry, data.size, data.location].filter(Boolean).join(' · ') || shortCompanyUrl(data.linkedin_url);
  const site = data.domain ? (data.website ?? `https://${data.domain}`) : null;
  const linkCls =
    'inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium hover:bg-muted';

  return (
    <>
      <nav aria-label="Percorso" className="mb-2 text-sm text-slate-500">
        <Link to="/companies" className="hover:underline">
          Aziende
        </Link>{' '}
        / <span className="text-slate-700">{label}</span>
      </nav>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{label}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
            {subtitle && <span>{subtitle}</span>}
            {!data.linkedin_url && <NoLinkedinBadge />}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {site && (
            <a href={site} target="_blank" rel="noopener noreferrer" aria-label={`Apri il sito di ${label} (nuova scheda)`} className={linkCls}>
              <GlobeIcon className="size-4" aria-hidden="true" />
              Apri il sito
            </a>
          )}
          {data.linkedin_url && (
            <a
              href={data.linkedin_url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Apri ${label} su LinkedIn (nuova scheda)`}
              className={linkCls}
            >
              <ExternalLinkIcon className="size-4" aria-hidden="true" />
              Apri su LinkedIn
            </a>
          )}
        </div>
      </div>

      <CompanyActions
        company={data}
        onSource={() => openSourcing()}
        onEnrich={() => setEnrichOpen(true)}
        onContacts={() => setContactsOpen(true)}
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card title="Anagrafica">
          {/* Rimontato quando cambia il salvato: il form riparte dai valori normalizzati dal server. */}
          <CompanyForm key={data.updated_at} company={data} />
        </Card>
        <div className="flex flex-col gap-6">
          <CandidateOfCard company={data} />
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
      <EnrichCompaniesDialog open={enrichOpen} onOpenChange={setEnrichOpen} companyId={data.id} companyName={label} />
      <ContactsDialog
        mode="company"
        open={contactsOpen}
        onOpenChange={setContactsOpen}
        companies={[{ company_id: data.id, name: data.name, domain: data.domain }]}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Azioni: Estrai persone (Apify) · Arricchisci con Apollo · Trova contatti (Apollo)
// ---------------------------------------------------------------------------

/**
 * Le tre azioni a pagamento con la riga che anticipa il blocker o lo stato (FLOW Decisioni UX: CTA sempre
 * attive, il motivo in una riga accanto), tranne "Trova contatti" che senza dominio è disabilitata con il
 * motivo visibile (SPEC F12).
 */
function CompanyActions(props: { company: CompanyWithRefs; onSource: () => void; onEnrich: () => void; onContacts: () => void }) {
  const { company } = props;
  const uid = useId();
  const contactsAt = useQuery({
    queryKey: queryKeys.companyContactsAt(company.id),
    queryFn: () => api.companies.contactsAt(company.id),
  });
  const lastContacts = contactsAt.data?.last_contacts_at ?? null;

  let apolloText: string;
  if (!company.domain) apolloText = "Serve il sito web: Apollo riconosce l'azienda dal dominio.";
  else if (company.apollo_org_id && company.apollo_enriched_at) apolloText = `Arricchita con Apollo il ${shortDay(company.apollo_enriched_at)}.`;
  else if (company.apollo_enriched_at) {
    apolloText = `Tentata su Apollo il ${shortDay(company.apollo_enriched_at)} senza esito (non trovata o chiavi in conflitto).`;
  } else apolloText = 'Settore, parole chiave, dipendenti e sede: 1 credito se Apollo la trova.';

  const box = 'flex flex-col items-start gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm';
  const hint = 'text-xs text-slate-600';
  return (
    <section aria-label="Azioni sull'azienda" className="mb-6 grid gap-3 md:grid-cols-3">
      <div className={box}>
        <Button type="button" onClick={props.onSource} aria-describedby={`${uid}-source`}>
          <UsersIcon aria-hidden="true" />
          Estrai persone
        </Button>
        {company.linkedin_url ? (
          <p id={`${uid}-source`} className={hint}>
            Persone dalla pagina LinkedIn (Apify) con i ruoli dell'ICP, in una lista.
          </p>
        ) : (
          <p id={`${uid}-source`} className="text-xs font-medium text-amber-900" data-testid="source-blocker-line">
            {NO_LINKEDIN_BLOCKER}
          </p>
        )}
      </div>
      <div className={box}>
        <Button type="button" variant="outline" onClick={props.onEnrich} aria-describedby={`${uid}-enrich`}>
          <SparklesIcon aria-hidden="true" />
          Arricchisci con Apollo
        </Button>
        <p id={`${uid}-enrich`} className={hint}>
          {apolloText}
        </p>
      </div>
      <div className={box}>
        <Button
          type="button"
          variant="outline"
          onClick={props.onContacts}
          disabled={!company.domain}
          aria-describedby={`${uid}-contacts`}
        >
          <ContactRoundIcon aria-hidden="true" />
          Trova contatti
        </Button>
        <p id={`${uid}-contacts`} className={hint} data-testid="contacts-line">
          {!company.domain ? (
            <span className="font-medium text-slate-800">Serve il sito web: Apollo cerca le persone per dominio.</span>
          ) : (
            'Persone ed email di lavoro da Apollo (1 credito a persona trovata), in una lista.'
          )}
        </p>
        {lastContacts && (
          <p
            className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-sky-900 ring-1 ring-sky-200 ring-inset"
            data-testid="contacts-at"
          >
            contatti cercati il {shortDay(lastContacts)}
          </p>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Anagrafica
// ---------------------------------------------------------------------------

type FieldKey = 'name' | 'linkedin_url' | 'website' | 'industry' | 'size' | 'location' | 'notes';

const FIELDS: ReadonlyArray<{ key: Exclude<FieldKey, 'notes'>; label: string; placeholder?: string; wide?: boolean }> = [
  { key: 'name', label: 'Nome', placeholder: 'es. Acme Robotica Srl', wide: true },
  { key: 'linkedin_url', label: 'URL LinkedIn', placeholder: 'https://www.linkedin.com/company/acme/', wide: true },
  { key: 'website', label: 'Sito web', placeholder: 'https://acme.it', wide: true },
  { key: 'industry', label: 'Settore', placeholder: 'es. Manifattura' },
  { key: 'size', label: 'Dimensione', placeholder: 'es. 51–200 dipendenti' },
  { key: 'location', label: 'Sede', placeholder: 'es. Bergamo' },
];

/** Errore di "almeno una chiave" (SPEC B11). */
const KEYS_MISSING = "Serve almeno l'URL LinkedIn o il sito web";

/** Host di piattaforme condivise che non identificano un'azienda (specchio di `SHARED_HOSTS` in `src/util/fields.ts`). */
const SHARED_HOSTS = ['linkedin.com', 'facebook.com', 'instagram.com', 'google.com', 'sites.google.com', 'wixsite.com'];

/**
 * Dominio che il server ricaverà dal sito, solo come anteprima della riga "Dominio: …" (la regola vera è
 * `normalizeDomain` in `src/util/fields.ts`: al salvataggio vale quella). `null` = nessun dominio proprio.
 */
function previewDomain(website: string): string | null {
  let s = website.trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  if (!/^https?:\/\//i.test(s)) return null;
  let host: string;
  try {
    host = new URL(s).hostname.toLowerCase();
  } catch {
    return null;
  }
  host = host.replace(/\.$/, '').replace(/^www\./, '');
  const labels = host.split('.');
  if (labels.length < 2 || !/^[a-z]{2,63}$|^xn--/.test(labels.at(-1)!)) return null;
  if (SHARED_HOSTS.some((shared) => host === shared || host.endsWith(`.${shared}`))) return null;
  return host;
}

/** Campo del form a cui appartiene la chiave contesa da un 409. */
const conflictField = (conflict: CompanyExistsErrorBody): 'linkedin_url' | 'website' =>
  conflict.key === 'linkedin_url' ? 'linkedin_url' : 'website';

function CompanyForm({ company }: { company: CompanyWithRefs }) {
  const uid = useId();
  const queryClient = useQueryClient();
  const urlRef = useRef<HTMLInputElement>(null);
  const websiteRef = useRef<HTMLInputElement>(null);
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
  const [websiteError, setWebsiteError] = useState<string | null>(null);
  const [keysError, setKeysError] = useState(false);
  const [conflict, setConflict] = useState<CompanyExistsErrorBody | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);

  const focusField = (field: 'linkedin_url' | 'website') => (field === 'linkedin_url' ? urlRef : websiteRef).current?.focus();

  const save = useMutation({
    mutationFn: (body: CompanyInput) => api.companies.update(company.id, body),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.company(company.id), updated);
      // Chiavi e nome: elenco aziende, card candidate/contatti, fonti dei prospect, riferimenti degli ICP e
      // le preview (blocker "senza pagina LinkedIn" del sourcing, "Serve il sito web" di Apollo).
      void queryClient.invalidateQueries({ queryKey: queryKeys.companies, predicate: (q) => q.queryKey[1] !== 'detail' });
      void queryClient.invalidateQueries({ queryKey: queryKeys.prospects });
      void queryClient.invalidateQueries({ queryKey: queryKeys.icps });
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobPreviews });
      toast({ title: 'Anagrafica salvata', description: companyLabel(updated) });
    },
    onError: (err) => {
      const exists = companyExistsOf(err);
      if (exists) {
        setConflict(exists);
        focusField(conflictField(exists));
      } else if (isApiError(err, 'invalid_company_url')) {
        setUrlError(err.message);
        urlRef.current?.focus();
      } else if (isApiError(err, 'company_keys_missing')) {
        setWebsiteError(err.message);
        websiteRef.current?.focus();
      } else {
        setFormError(errorText(err));
      }
    },
  });

  const changedFields = (Object.keys(values) as FieldKey[]).filter((key) => values[key].trim() !== (company[key] ?? ''));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setUrlError(null);
    setWebsiteError(null);
    setKeysError(false);
    setConflict(null);
    setFormError(null);
    const body: CompanyInput = {};
    for (const key of changedFields) {
      const next = values[key].trim();
      body[key] = next === '' ? null : next;
    }
    if (changedFields.length === 0) {
      toast({ tone: 'neutral', title: 'Nessuna modifica da salvare' });
      return;
    }
    // Mai entrambe le chiavi vuote (SPEC B11): il dominio resta finché il sito non cambia.
    const noUrl = values.linkedin_url.trim() === '';
    const noDomain = values.website.trim() === '' && (changedFields.includes('website') || company.domain === null);
    if (noUrl && noDomain) {
      setKeysError(true);
      urlRef.current?.focus();
      return;
    }
    save.mutate(body);
  };

  const set = (key: FieldKey, value: string) => {
    setValues((cur) => ({ ...cur, [key]: value }));
    if (key === 'linkedin_url' || key === 'website') {
      setKeysError(false);
      setConflict(null);
      if (key === 'linkedin_url') setUrlError(null);
      else setWebsiteError(null);
    }
  };

  const websiteChanged = values.website.trim() !== (company.website ?? '');
  const domainText = websiteChanged
    ? values.website.trim() === ''
      ? 'Dominio: — (senza sito web)'
      : previewDomain(values.website)
        ? `Dominio: ${previewDomain(values.website)} (al salvataggio)`
        : 'Dominio: — (il sito indicato non ha un dominio proprio)'
    : `Dominio: ${company.domain ?? '—'}`;

  const errorsOf = (key: FieldKey): Array<{ id: string; node: ReactNode }> => {
    const out: Array<{ id: string; node: ReactNode }> = [];
    if (key === 'linkedin_url' && urlError) out.push({ id: `${uid}-url-error`, node: <FieldError text={urlError} /> });
    if (key === 'website' && websiteError) out.push({ id: `${uid}-website-error`, node: <FieldError text={websiteError} /> });
    if (key === 'website' && keysError) out.push({ id: `${uid}-keys-error`, node: <FieldError text={KEYS_MISSING} /> });
    if (conflict && (key === 'linkedin_url' || key === 'website') && conflictField(conflict) === key) {
      out.push({
        id: `${uid}-conflict`,
        node: <KeyConflictNotice conflict={conflict} onMerge={() => setMerging(true)} />,
      });
    }
    return out;
  };

  return (
    <>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4 px-4 py-4">
        {!company.name && (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
            Aggiungi il nome: lo vedi negli esiti delle ricerche, nelle fonti dei prospect e tra i riferimenti degli ICP.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {FIELDS.map((field) => {
            const isKey = field.key === 'linkedin_url' || field.key === 'website';
            const errors = errorsOf(field.key);
            // L'errore "almeno una chiave" vale per entrambi i campi, il testo sta sotto il sito.
            const invalid = errors.length > 0 || (keysError && field.key === 'linkedin_url');
            const describedBy = [
              ...errors.map((e) => e.id),
              keysError && field.key === 'linkedin_url' ? `${uid}-keys-error` : null,
              field.key === 'website' ? `${uid}-domain` : null,
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <div key={field.key} className={cn('flex flex-col gap-1', field.wide && 'sm:col-span-2')}>
                <label htmlFor={`${uid}-${field.key}`} className={labelCls}>
                  {field.label}
                </label>
                <Input
                  ref={field.key === 'linkedin_url' ? urlRef : field.key === 'website' ? websiteRef : undefined}
                  id={`${uid}-${field.key}`}
                  type="text"
                  inputMode={isKey ? 'url' : undefined}
                  spellCheck={isKey ? false : undefined}
                  value={values[field.key]}
                  placeholder={field.placeholder}
                  aria-invalid={invalid || undefined}
                  aria-describedby={describedBy || undefined}
                  onChange={(e) => set(field.key, e.target.value)}
                />
                {field.key === 'website' && (
                  <p id={`${uid}-domain`} className="text-xs text-slate-500" data-testid="domain-hint">
                    {domainText}
                    <span className="text-slate-400"> · è la chiave dell'azienda per Apollo: cambia con il sito</span>
                  </p>
                )}
                {errors.map((e) => (
                  <div key={e.id} id={e.id}>
                    {e.node}
                  </div>
                ))}
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
      {/* Fuori dal form: gli eventi del dialog (portale) non devono risalire al form. */}
      {conflict && (
        <MergeDialog
          open={merging}
          onOpenChange={setMerging}
          drop={company}
          conflict={conflict}
          unsaved={changedFields.some((key) => key !== conflictField(conflict))}
        />
      )}
    </>
  );
}

function FieldError({ text }: { text: string }) {
  return (
    <p role="alert" className="text-sm text-red-700">
      {text}
    </p>
  );
}

/**
 * 409 `company_exists` in modifica (SPEC B4/B5, FLOW F.4): "Questo URL LinkedIn è già di 'Acme Robotica' (apri)"
 * e l'azione "Unisci in Acme Robotica", che apre la conferma. Nessuna modifica salvata.
 */
function KeyConflictNotice({ conflict, onMerge }: { conflict: CompanyExistsErrorBody; onMerge: () => void }) {
  const text = conflict.error.replace(/\.\s*$/, '');
  return (
    <div role="alert" className="flex flex-col items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      <p>
        {text} (
        <Link to="/companies/$id" params={{ id: String(conflict.company_id) }} className="font-medium text-red-900 underline">
          apri<span className="sr-only"> {conflict.company_name}</span>
        </Link>
        ). Nessuna modifica salvata.
      </p>
      <Button type="button" size="sm" variant="outline" onClick={onMerge}>
        Unisci in {conflict.company_name}
      </Button>
    </div>
  );
}

/**
 * Conferma dell'unione esplicita (SPEC B5, FLOW F.4): elenca cosa si perde (chiave scartata, note accodate,
 * modifiche non salvate) e le righe assorbite da `GET /api/companies/:id/merge/preview?into=`; "Unisci in" →
 * `POST …/merge` → redirect alla superstite con toast "Aziende unite in '<azienda>'". Irreversibile.
 */
function MergeDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  drop: CompanyWithRefs;
  conflict: CompanyExistsErrorBody;
  unsaved: boolean;
}) {
  const { open, onOpenChange, drop, conflict } = props;
  const into = conflict.company_id;
  const keep = conflict.company_name;
  const dropLabel = companyLabel(drop);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const focus = useDialogFocusReturn();

  const preview = useQuery({
    queryKey: queryKeys.companyMergePreview(drop.id, into),
    queryFn: () => api.companies.mergePreview(drop.id, into),
    enabled: open,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

  const merge = useMutation({
    mutationFn: () => api.companies.merge(drop.id, into),
    onSuccess: async ({ company }) => {
      queryClient.setQueryData(queryKeys.company(company.id), company);
      onOpenChange(false);
      toast({
        title: `Aziende unite in '${companyLabel(company)}'`,
        description: `${dropLabel} non esiste più: riferimenti, candidature, prospect e fonti sono ora qui.`,
      });
      await navigate({ to: '/companies/$id', params: { id: String(company.id) }, search: {} });
      for (const key of [queryKeys.company(drop.id), queryKeys.companyCandidateOf(drop.id), queryKeys.companyContactsAt(drop.id)]) {
        queryClient.removeQueries({ queryKey: key });
      }
      // Riferimenti e candidature (prefisso `icps`), prospect e fonti, liste, Inbox, elenco aziende e preview.
      void queryClient.invalidateQueries({ queryKey: queryKeys.companies, predicate: (q) => q.queryKey[1] !== 'detail' || q.queryKey[2] === company.id });
      void queryClient.invalidateQueries({ queryKey: queryKeys.icps });
      void queryClient.invalidateQueries({ queryKey: queryKeys.prospects });
      void queryClient.invalidateQueries({ queryKey: queryKeys.lists });
      void queryClient.invalidateQueries({ queryKey: queryKeys.inbox });
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobPreviews });
    },
  });

  useEffect(() => {
    if (open) merge.reset();
    // Si azzera solo all'apertura (`merge.reset` è stabile).
  }, [open]);

  const data = preview.data;
  const losses: string[] = [];
  if (data) {
    if (data.loses.domain) losses.push(`Il dominio ${data.loses.domain} di ${dropLabel}: ${keep} ne ha già un altro.`);
    if (data.loses.linkedin_url) {
      losses.push(`L'URL LinkedIn ${shortCompanyUrl(data.loses.linkedin_url)} di ${dropLabel}: ${keep} ne ha già un altro.`);
    }
    if (props.unsaved) losses.push(`Le modifiche non salvate all'anagrafica di ${dropLabel}.`);
  }
  const a = data?.absorbed;

  return (
    <Dialog open={open} onOpenChange={(next) => !merge.isPending && onOpenChange(next)}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg" showCloseButton={false} {...focus}>
        <DialogHeader>
          <DialogTitle>
            Unire {dropLabel} in {keep}?
          </DialogTitle>
          <DialogDescription>
            {dropLabel} verrà assorbita e non esisterà più; resta {keep}, con i dati di entrambe. Operazione irreversibile.
          </DialogDescription>
        </DialogHeader>

        {preview.isPending ? (
          <p className="text-sm text-slate-500" role="status">
            Calcolo di cosa comporta l'unione…
          </p>
        ) : preview.error ? (
          <div className="flex flex-col items-start gap-2">
            <ErrorBox error={preview.error} />
            <Button type="button" size="sm" variant="outline" onClick={() => void preview.refetch()}>
              Riprova
            </Button>
          </div>
        ) : data && a ? (
          <div className="flex flex-col gap-3 text-sm" data-testid="merge-preview">
            <section aria-labelledby="merge-loses" className="flex flex-col gap-1">
              <h3 id="merge-loses" className="font-medium text-slate-900">
                Cosa si perde
              </h3>
              {losses.length === 0 ? (
                <p className="text-slate-700">
                  Nessuna chiave scartata: {keep} riceve il dominio o l'URL LinkedIn che le mancano.
                </p>
              ) : (
                <ul className="list-disc pl-5 text-slate-700">
                  {losses.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              )}
            </section>
            <section aria-labelledby="merge-absorbed" className="flex flex-col gap-1">
              <h3 id="merge-absorbed" className="font-medium text-slate-900">
                Cosa assorbe {keep}
              </h3>
              <ul className="list-disc pl-5 text-slate-700">
                <li>
                  {[
                    countText(a.references, 'riferimento ICP', 'riferimenti ICP'),
                    countText(a.candidates, 'candidatura', 'candidature'),
                    countText(a.prospects, 'prospect collegato', 'prospect collegati'),
                    countText(a.sources, 'fonte', 'fonti'),
                  ].join(' · ')}
                </li>
                {data.loses.notes && <li>Le note di {dropLabel}, accodate a quelle di {keep}.</li>}
                <li>I campi vuoti di {keep} (settore, sede, sito…) si completano con quelli di {dropLabel}.</li>
              </ul>
            </section>
          </div>
        ) : null}

        {merge.error && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            Unione non riuscita: {errorText(merge.error)}
            {isApiError(merge.error) && merge.error.status === 404 ? " Una delle due aziende non esiste più: ricarica la pagina." : ''}
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={merge.isPending}>
              Annulla
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={!data || merge.isPending}
            aria-busy={merge.isPending}
            onClick={() => merge.mutate()}
          >
            {merge.isPending ? 'Unione…' : `Unisci in ${keep}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Candidata per ICP (SPEC E5)
// ---------------------------------------------------------------------------

const CANDIDATE_STYLE: Record<CandidateStatus, string> = {
  proposta: 'bg-sky-50 text-sky-900 ring-sky-200',
  accettata: 'bg-emerald-50 text-emerald-900 ring-emerald-200',
  scartata: 'bg-slate-100 text-slate-700 ring-slate-200',
};

/**
 * Card "Candidata per ICP": "HR tech Milano · accettata il 16 set · somiglianza 82 %" con Accetta / Scarta /
 * Riproponi senza conferme (reversibili) e "già cercata il <data>"; nascosta se l'azienda non è candidata.
 */
function CandidateOfCard({ company }: { company: CompanyWithRefs }) {
  const queryClient = useQueryClient();
  const label = companyLabel(company);
  const listRef = useRef<HTMLUListElement>(null);
  const candidateOf = useQuery({
    queryKey: queryKeys.companyCandidateOf(company.id),
    queryFn: () => api.companies.candidateOf(company.id),
  });
  const contactsAt = useQuery({
    queryKey: queryKeys.companyContactsAt(company.id),
    queryFn: () => api.companies.contactsAt(company.id),
  });
  const lastContacts = contactsAt.data?.last_contacts_at ?? null;
  const [pending, setPending] = useState<Set<number>>(new Set());

  const change = useMutation({
    mutationFn: (vars: { item: CandidateOf; to: CandidateStatus }) => api.candidates.update(vars.item.icp_id, company.id, vars.to),
    onMutate: (vars) => setPending((cur) => new Set(cur).add(vars.item.icp_id)),
    onSettled: (_d, _e, vars) =>
      setPending((cur) => {
        const next = new Set(cur);
        next.delete(vars.item.icp_id);
        return next;
      }),
    onSuccess: (updated, vars) => {
      // Stato nuovo subito nella card (le azioni cambiano): il focus resta sulla riga, mai su `body`.
      queryClient.setQueryData<{ items: CandidateOf[] }>(queryKeys.companyCandidateOf(company.id), (cur) =>
        cur
          ? {
              items: cur.items.map((i) =>
                i.icp_id === vars.item.icp_id ? { ...i, status: updated.status, decided_at: updated.decided_at } : i,
              ),
            }
          : cur,
      );
      requestAnimationFrame(() => {
        listRef.current?.querySelector<HTMLButtonElement>(`[data-icp-id="${vars.item.icp_id}"] button`)?.focus();
      });
      toast({ title: `${label}: candidata ${CANDIDATE_STATUS_VERBS[vars.to][0]} per ${vars.item.icp_name}` });
      void invalidateCandidateQueries(queryClient, vars.item.icp_id, [company.id]);
    },
    onError: (err, vars) => {
      const gone = isApiError(err) && err.status === 404;
      toast({
        tone: 'error',
        title: `Stato non aggiornato: ${errorText(err)}`,
        description: gone
          ? `${label} non è più tra le candidate di ${vars.item.icp_name}: la card si aggiorna.`
          : `La candidatura per ${vars.item.icp_name} resta com'era.`,
      });
      if (gone) void invalidateCandidateQueries(queryClient, vars.item.icp_id, [company.id]);
    },
  });

  const items = candidateOf.data?.items ?? [];
  if (candidateOf.error) {
    return (
      <Card title="Candidata per ICP">
        <div className="flex flex-col items-start gap-2 p-4">
          <ErrorBox error={candidateOf.error} />
          <Button type="button" size="sm" variant="outline" onClick={() => void candidateOf.refetch()}>
            Riprova
          </Button>
        </div>
      </Card>
    );
  }
  if (items.length === 0) return null;

  return (
    <Card title={`Candidata per ICP (${items.length})`}>
      <ul ref={listRef} className="divide-y divide-slate-100" aria-label="ICP di cui è candidata" data-testid="candidate-of">
        {items.map((item) => {
          const busy = pending.has(item.icp_id);
          const status = CANDIDATE_STATUS_LABELS[item.status].toLowerCase();
          return (
            <li key={item.icp_id} data-icp-id={item.icp_id} className="flex flex-col gap-2 px-4 py-3 text-sm" aria-busy={busy || undefined}>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-slate-700">
                <Link
                  to="/icps/$id"
                  params={{ id: String(item.icp_id) }}
                  search={{ candidates: item.status }}
                  className="font-medium text-slate-900 hover:underline"
                >
                  {item.icp_name}
                </Link>
                <span aria-hidden="true">·</span>
                <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', CANDIDATE_STYLE[item.status])}>
                  {item.decided_at && item.status !== 'proposta' ? `${status} il ${shortDay(item.decided_at)}` : status}
                </span>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">somiglianza {Math.round(item.score * 100)} %</span>
                {lastContacts && (
                  <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-sky-900 ring-1 ring-sky-200 ring-inset">
                    già cercata il {shortDay(lastContacts)}
                  </span>
                )}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {CANDIDATE_ACTIONS[item.status].map((action) => (
                  <Button
                    key={action.to}
                    type="button"
                    size="sm"
                    variant={action.to === 'proposta' ? 'ghost' : 'outline'}
                    // Niente `disabled` durante l'attesa: il bottone perderebbe il focus.
                    aria-disabled={busy || undefined}
                    className={busy ? 'opacity-50' : undefined}
                    aria-label={`${action.label} ${label} per ${item.icp_name}`}
                    onClick={() => !busy && change.mutate({ item, to: action.to })}
                  >
                    {action.label}
                  </Button>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
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
    onSuccess: async (saved, target) => {
      // Promozione di una candidata (SPEC E4): la candidatura per quell'ICP sparisce. `invalidate` copre già card
      // "Candidata per ICP" (prefisso `companies`) e sezione Candidate con le ricerche (prefisso `icps`).
      await invalidate();
      setIcpId('');
      toast({
        title: `${companyLabel(company)} è riferimento di ${target.icpName}`,
        description: `Esito: ${REFERENCE_OUTCOME_LABELS[outcome]}${saved.candidate_removed ? ` · uscita dalle candidate di ${target.icpName}` : ''}`,
      });
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
