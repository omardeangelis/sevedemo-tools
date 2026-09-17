import { useId, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { api, isApiError, queryKeys } from '../api/client';
import {
  CANDIDATE_STATUSES,
  REFERENCE_OUTCOMES,
  REFERENCE_OUTCOME_LABELS,
  type CandidatesResponse,
  type CandidateStatus,
  type IcpDetail,
  type ReferenceCompany,
  type ReferenceOutcome,
} from '../api/types';
import { CandidatesSection, type CandidatesSearchPatch } from '../components/CandidatesTable';
import { IcpForm, type IcpBody } from '../components/IcpForm';
import { CANDIDATES_SECTION_ID, LookalikeCard } from '../components/LookalikeCard';
import { Card, ErrorBox, Loading, PageHeader } from '../components/ui';
import { toast } from '../components/ui/toaster';
import { invalidateCandidateQueries } from '../lib/jobs';

/** Filtri della sezione "Candidate" nell'URL (FLOW B.1, P-17): stato (default `proposta`) e pagina (default 1). */
export interface IcpSearch {
  candidates?: CandidateStatus;
  cpage?: number;
}

export const Route = createFileRoute('/icps/$id')({
  component: IcpRoute,
  // Valori non validi → default (FLOW Error paths: deep-link `?candidates=` non valido → `proposta`).
  validateSearch: (s: Record<string, unknown>): IcpSearch => {
    const status = typeof s.candidates === 'string' && (CANDIDATE_STATUSES as readonly string[]).includes(s.candidates);
    const page = typeof s.cpage === 'string' ? Number(s.cpage) : s.cpage;
    return {
      candidates: status ? (s.candidates as CandidateStatus) : undefined,
      cpage: typeof page === 'number' && Number.isInteger(page) && page > 1 ? page : undefined,
    };
  },
});

/*
 * Dettaglio ICP (crm-foundation T14, FLOW A.3): form (`IcpForm`), aziende di riferimento (aggiungi da
 * URL con esito e nota, cambia esito, rimuovi), card "Aziende simili (Apollo)" (apollo-lookalike T12a,
 * FLOW A.1), liste dell'ICP ed eliminazione; sotto, a tutta larghezza, la sezione "Candidate" con triage e
 * "Trova contatti" (T13, FLOW B/C, filtri `?candidates=&cpage=` nell'URL). `/icps/nuovo` è lo stesso form in
 * creazione: al salvataggio porta al dettaglio del nuovo ICP.
 */

/** Segmento della modalità creazione (link "Nuovo ICP" in `icps.index.tsx`). */
const NEW_ICP = 'nuovo';

const labelCls = 'text-xs font-medium text-slate-600';
const selectCls =
  'h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50';

function IcpRoute() {
  const { id } = Route.useParams();
  if (id === NEW_ICP) return <NewIcpPage />;
  const icpId = Number(id);
  return Number.isInteger(icpId) && icpId > 0 ? <IcpDetailPage key={icpId} icpId={icpId} /> : <IcpNotFound />;
}

function IcpNotFound() {
  return (
    <div className="py-20 text-center text-sm text-slate-500">
      <h1 className="text-lg font-semibold text-slate-900">ICP non trovato</h1>
      <p className="mt-1">L'ICP non esiste o è stato eliminato.</p>
      <Link to="/icps" className="mt-3 inline-block font-medium text-slate-900 underline">
        Torna agli ICP
      </Link>
    </div>
  );
}

/** Messaggio leggibile di un errore di scrittura (messaggi zod se presenti). */
function errorText(err: unknown): string {
  if (isApiError(err) && err.body?.issues?.length) return err.body.issues.map((i) => i.message).join(' ');
  return err instanceof Error ? err.message : 'Operazione non riuscita.';
}

const orNull = (value: string) => (value.trim() === '' ? null : value.trim());

// ---------------------------------------------------------------------------
// Creazione e dettaglio
// ---------------------------------------------------------------------------

function NewIcpPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const create = async (body: IcpBody) => {
    const icp = await api.icps.create(body);
    queryClient.setQueryData(queryKeys.icp(icp.id), icp);
    void queryClient.invalidateQueries({ queryKey: queryKeys.icpsIndex });
    // `readiness.icp` (onboarding) e i gruppi del ListPicker.
    void queryClient.invalidateQueries({ queryKey: queryKeys.settings });
    toast({ title: `ICP "${icp.name}" creato`, description: 'Ora puoi aggiungere le aziende di riferimento.' });
    await navigate({ to: '/icps/$id', params: { id: String(icp.id) }, replace: true });
  };

  return (
    <>
      <PageHeader
        title="Nuovo ICP"
        subtitle="Descrivi il cliente ideale: ruoli, settori, località e problemi. Dopo il salvataggio aggiungi le aziende di riferimento."
        actions={
          <Link to="/icps" className={buttonVariants({ variant: 'outline' })}>
            Annulla
          </Link>
        }
      />
      <div className="max-w-3xl">
        <Card title="Profilo cliente ideale">
          <IcpForm initial={null} submitLabel="Crea ICP" onSave={create} />
        </Card>
      </div>
    </>
  );
}

function IcpDetailPage({ icpId }: { icpId: number }) {
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const icp = useQuery({
    queryKey: queryKeys.icp(icpId),
    queryFn: () => api.icps.get(icpId),
    retry: (count, err) => !(isApiError(err) && err.status === 404) && count < 2,
  });

  if (icp.isPending) return <Loading />;
  if (icp.error) {
    if (isApiError(icp.error) && icp.error.status === 404) return <IcpNotFound />;
    return (
      <div className="flex flex-col items-start gap-3">
        <ErrorBox error={icp.error} />
        <Button type="button" variant="outline" onClick={() => void icp.refetch()}>
          Riprova
        </Button>
      </div>
    );
  }

  const data = icp.data;
  const update = async (body: IcpBody) => {
    const updated = await api.icps.update(icpId, body);
    queryClient.setQueryData(queryKeys.icp(icpId), updated);
    void queryClient.invalidateQueries({ queryKey: queryKeys.icpsIndex });
    // Nome e ruoli dell'ICP compaiono in liste, aziende e preview del sourcing.
    void queryClient.invalidateQueries({ queryKey: queryKeys.lists });
    void queryClient.invalidateQueries({ queryKey: queryKeys.companies });
    // Settori, dimensione e località dell'ICP entrano nei filtri derivati della ricerca aziende simili.
    void queryClient.invalidateQueries({ queryKey: queryKeys.jobPreviews });
    toast({ title: 'ICP salvato' });
  };

  return (
    <>
      <PageHeader
        title={data.name}
        subtitle={[
          plural(data.target_roles.length, 'ruolo target', 'ruoli target'),
          plural(data.lists.length, 'lista', 'liste'),
          plural(data.reference_companies.length, 'azienda di riferimento', 'aziende di riferimento'),
        ].join(' · ')}
        actions={
          <Link to="/icps" className={buttonVariants({ variant: 'outline' })}>
            Tutti gli ICP
          </Link>
        }
      />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card title="Profilo cliente ideale">
          {/* Rimontato quando cambia il salvato: il form riparte dai valori normalizzati dal server. */}
          <IcpForm key={data.updated_at} initial={data} submitLabel="Salva ICP" onSave={update} />
        </Card>
        <div className="flex flex-col gap-6">
          <ReferenceCompanies icp={data} />
          <LookalikeCard icp={data} />
          <IcpLists icp={data} />
          <DeleteIcp icp={data} />
        </div>
      </div>
      <div id={CANDIDATES_SECTION_ID} className="mt-6 scroll-mt-4">
        <CandidatesSection
          icp={data}
          status={search.candidates ?? 'proposta'}
          page={search.cpage ?? 1}
          onSearchChange={(patch: CandidatesSearchPatch, opts) =>
            void navigate({
              search: (prev) => ({ ...prev, ...patch }),
              resetScroll: false,
              // Cambio pagina: si torna all'inizio della sezione (la tabella è lunga).
              hash: opts?.scrollToSection ? CANDIDATES_SECTION_ID : undefined,
            })
          }
        />
      </div>
    </>
  );
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ---------------------------------------------------------------------------
// Aziende di riferimento
// ---------------------------------------------------------------------------

/**
 * Dopo ogni scrittura sui riferimenti: dettaglio, conteggi dell'elenco ICP, `reference_of` delle aziende,
 * le preview Apollo (referenze e filtri derivati della card "Aziende simili") e le candidate (una candidata
 * promossa a riferimento esce dalle candidate, SPEC E4).
 */
function useInvalidateReferences(icpId: number) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.icp(icpId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.icpsIndex }),
      queryClient.invalidateQueries({ queryKey: queryKeys.companies }),
      queryClient.invalidateQueries({ queryKey: queryKeys.jobPreviews }),
      invalidateCandidateQueries(queryClient, icpId),
    ]);
}

/** L'azienda è tra le candidate dell'ICP già caricate (per il toast "rimossa dalle candidate"). */
function isLoadedCandidate(queryClient: ReturnType<typeof useQueryClient>, icpId: number, companyId: number): boolean {
  return queryClient
    .getQueriesData<CandidatesResponse>({ queryKey: queryKeys.candidatesOfIcp(icpId) })
    .some(([, data]) => data?.items.some((c) => c.company_id === companyId) ?? false);
}

const shortCompanyUrl = (url: string | null) => (url ?? '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

function ReferenceCompanies({ icp }: { icp: IcpDetail }) {
  const [adding, setAdding] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const formId = useId();
  const refs = icp.reference_companies;

  const close = () => {
    setAdding(false);
    toggleRef.current?.focus();
  };

  return (
    <Card
      title={`Aziende di riferimento${refs.length > 0 ? ` (${refs.length})` : ''}`}
      actions={
        <Button
          ref={toggleRef}
          type="button"
          size="sm"
          variant="outline"
          aria-expanded={adding}
          aria-controls={adding ? formId : undefined}
          onClick={() => (adding ? close() : setAdding(true))}
        >
          Aggiungi da URL
        </Button>
      }
    >
      {adding && <AddReferenceForm id={formId} icp={icp} onClose={close} />}
      {refs.length === 0 ? (
        <p className="px-4 py-4 text-sm text-slate-500">
          Nessuna azienda di riferimento. Aggiungi le aziende con cui hai trattato bene: aiutano l'analisi AI a capire chi
          è davvero un buon fit.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100" aria-label="Aziende di riferimento">
          {refs.map((reference) => (
            <ReferenceRow key={reference.company_id} icpId={icp.id} reference={reference} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function AddReferenceForm({ id, icp, onClose }: { id: string; icp: IcpDetail; onClose: () => void }) {
  const uid = useId();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateReferences(icp.id);
  const urlRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const [outcome, setOutcome] = useState<ReferenceOutcome>('vinta');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: async () => {
      // Crea l'azienda (o ritrova l'esistente) e la rende riferimento con l'esito; la nota a parte.
      const company = await api.companies.fromUrl({ url: url.trim(), icpId: icp.id, outcome });
      const wasCandidate = isLoadedCandidate(queryClient, icp.id, company.id);
      let noteError: string | null = null;
      if (notes.trim()) {
        try {
          await api.icps.setReference(icp.id, company.id, { notes: notes.trim() });
        } catch (err) {
          noteError = errorText(err);
        }
      }
      return { company, noteError, wasCandidate };
    },
    onSuccess: async ({ company, noteError, wasCandidate }) => {
      const already = icp.reference_companies.some((r) => r.company_id === company.id);
      const name = company.name ?? shortCompanyUrl(company.linkedin_url ?? company.domain);
      toast({
        title: already ? `Riferimento aggiornato: ${name}` : `${name} aggiunta alle aziende di riferimento`,
        description: `Esito: ${REFERENCE_OUTCOME_LABELS[outcome]} · ${company.created ? 'nuova azienda in Aziende' : 'azienda già presente in Aziende'}${wasCandidate ? ' · rimossa dalle candidate' : ''}`,
      });
      if (noteError) toast({ tone: 'error', title: 'Nota non salvata', description: noteError });
      await invalidate();
      onClose();
    },
    onError: (err) => {
      setError(errorText(err));
      urlRef.current?.focus();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (url.trim() === '') {
      setError("Inserisci l'URL della pagina LinkedIn dell'azienda o il suo sito web, es. https://www.linkedin.com/company/acme/ o acme.it");
      urlRef.current?.focus();
      return;
    }
    setError(null);
    add.mutate();
  };

  return (
    <form
      id={id}
      onSubmit={submit}
      noValidate
      aria-label="Aggiungi azienda di riferimento"
      className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50 px-4 py-4"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={`${uid}-url`} className={labelCls}>
          URL LinkedIn o sito web dell'azienda
        </label>
        <Input
          ref={urlRef}
          id={`${uid}-url`}
          type="text"
          inputMode="url"
          autoFocus
          value={url}
          placeholder="https://www.linkedin.com/company/acme/ o acme.it"
          className="bg-white"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${uid}-error` : undefined}
          onChange={(e) => {
            setUrl(e.target.value);
            if (error) setError(null);
          }}
        />
        {error && (
          <p id={`${uid}-error`} role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)]">
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
        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-notes`} className={labelCls}>
            Nota (facoltativa)
          </label>
          <Input
            id={`${uid}-notes`}
            value={notes}
            className="bg-white"
            placeholder="es. Progetto MES chiuso a marzo"
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={add.isPending} aria-busy={add.isPending}>
          {add.isPending ? 'Aggiunta…' : 'Aggiungi riferimento'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          Annulla
        </Button>
      </div>
    </form>
  );
}

function ReferenceRow({ icpId, reference }: { icpId: number; reference: ReferenceCompany }) {
  const uid = useId();
  const invalidate = useInvalidateReferences(icpId);
  const company = reference.company;
  const name = company.name ?? shortCompanyUrl(company.linkedin_url ?? company.domain);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState(reference.notes ?? '');

  const update = useMutation({
    mutationFn: (body: { outcome?: ReferenceOutcome; notes?: string | null }) =>
      api.icps.setReference(icpId, company.id, body),
    onSuccess: async (_saved, body) => {
      // Resta "in corso" finché il dettaglio non è ricaricato: il select non torna indietro.
      await invalidate();
      if (body.outcome) toast({ title: `Esito aggiornato: ${name}`, description: REFERENCE_OUTCOME_LABELS[body.outcome] });
      else {
        setEditingNotes(false);
        toast({ title: body.notes ? `Nota salvata: ${name}` : `Nota rimossa: ${name}` });
      }
    },
    onError: (err) => toast({ tone: 'error', title: 'Riferimento non aggiornato', description: errorText(err) }),
  });

  const remove = useMutation({
    mutationFn: () => api.icps.removeReference(icpId, company.id),
    onSuccess: async () => {
      toast({ title: `${name} rimossa dai riferimenti`, description: "L'azienda resta in Aziende." });
      await invalidate();
    },
    onError: (err) => toast({ tone: 'error', title: 'Rimozione non riuscita', description: errorText(err) }),
  });

  const outcomeValue = update.isPending && update.variables?.outcome ? update.variables.outcome : reference.outcome;

  return (
    <li className="flex flex-col gap-2 px-4 py-3" data-company-id={company.id}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link to={`/companies/${company.id}` as never} className="font-medium text-slate-900 hover:underline">
            {name}
          </Link>
          {company.linkedin_url && (
            <a
              href={company.linkedin_url}
              target="_blank"
              rel="noreferrer"
              className="block truncate text-xs text-slate-500 hover:underline"
            >
              {shortCompanyUrl(company.linkedin_url)}
            </a>
          )}
        </div>
        <div className="flex items-center gap-1">
          <label htmlFor={`${uid}-outcome`} className="sr-only">
            Esito con {name}
          </label>
          <select
            id={`${uid}-outcome`}
            value={outcomeValue}
            disabled={update.isPending || remove.isPending}
            onChange={(e) => update.mutate({ outcome: e.target.value as ReferenceOutcome })}
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
            aria-label={`Rimuovi ${name} dai riferimenti`}
          >
            Rimuovi
          </Button>
        </div>
      </div>

      {editingNotes ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate({ notes: orNull(notes) });
          }}
        >
          <label htmlFor={`${uid}-notes`} className="sr-only">
            Nota su {name}
          </label>
          <Input
            id={`${uid}-notes`}
            value={notes}
            autoFocus
            className="h-7 min-w-48 flex-1"
            onChange={(e) => setNotes(e.target.value)}
          />
          <Button type="submit" size="sm" disabled={update.isPending} aria-busy={update.isPending}>
            Salva nota
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setNotes(reference.notes ?? '');
              setEditingNotes(false);
            }}
          >
            Annulla
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap items-baseline gap-2 text-sm">
          {reference.notes && <p className="text-slate-600">{reference.notes}</p>}
          <button
            type="button"
            onClick={() => {
              setNotes(reference.notes ?? '');
              setEditingNotes(true);
            }}
            className="cursor-pointer text-xs font-medium text-slate-500 underline hover:text-slate-900"
            aria-label={`${reference.notes ? 'Modifica la nota' : 'Aggiungi una nota'} su ${name}`}
          >
            {reference.notes ? 'Modifica nota' : 'Aggiungi nota'}
          </button>
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Liste ed eliminazione
// ---------------------------------------------------------------------------

function IcpLists({ icp }: { icp: IcpDetail }) {
  return (
    <Card title={`Liste${icp.lists.length > 0 ? ` (${icp.lists.length})` : ''}`}>
      {icp.lists.length === 0 ? (
        <p className="px-4 py-4 text-sm text-slate-500">
          Nessuna lista per questo ICP. Creala da{' '}
          <Link to={'/lists' as never} className="font-medium text-slate-900 underline">
            Liste
          </Link>{' '}
          oppure con "Crea nuova lista" quando aggiungi persone dall'Inbox.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {icp.lists.map((list) => (
            <li key={list.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
              <Link to={`/lists/${list.id}` as never} className="font-medium text-slate-900 hover:underline">
                {list.name}
              </Link>
              {list.archived_at && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Archiviata</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DeleteIcp({ icp }: { icp: IcpDetail }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const uid = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  const listsCount = icp.lists.length;

  const remove = useMutation({
    mutationFn: () => api.icps.remove(icp.id),
    onSuccess: async () => {
      toast({ title: `ICP "${icp.name}" eliminato` });
      await navigate({ to: '/icps' });
      queryClient.removeQueries({ queryKey: queryKeys.icp(icp.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.icpsIndex });
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings });
      void queryClient.invalidateQueries({ queryKey: queryKeys.companies });
    },
    onError: (err) => {
      setConfirming(false);
      if (isApiError(err, 'icp_has_lists')) {
        // Race: una lista creata nel frattempo. Il dettaglio ricaricato disabilita il bottone.
        toast({ tone: 'warning', title: 'ICP non eliminato', description: err.message });
        void queryClient.invalidateQueries({ queryKey: queryKeys.icp(icp.id) });
      } else {
        toast({ tone: 'error', title: 'Eliminazione non riuscita', description: errorText(err) });
      }
    },
  });

  const cancel = () => {
    setConfirming(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  return (
    <Card title="Elimina ICP">
      <div className="flex flex-col gap-2 px-4 py-4 text-sm">
        {confirming ? (
          <div role="group" aria-labelledby={`${uid}-confirm`} className="flex flex-col gap-3">
            <p id={`${uid}-confirm`} className="text-slate-700">
              Eliminare "{icp.name}"? Si cancellano anche i suoi riferimenti, le candidate e le analisi fatte per questo
              ICP; le aziende e i prospect restano. Non si può annullare.
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="destructive"
                autoFocus
                onClick={() => remove.mutate()}
                disabled={remove.isPending}
                aria-busy={remove.isPending}
              >
                {remove.isPending ? 'Eliminazione…' : 'Elimina definitivamente'}
              </Button>
              <Button type="button" variant="outline" onClick={cancel}>
                Annulla
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div>
              <Button
                ref={triggerRef}
                type="button"
                variant="destructive"
                onClick={() => setConfirming(true)}
                disabled={listsCount > 0}
                aria-describedby={listsCount > 0 ? `${uid}-hint` : undefined}
              >
                Elimina ICP
              </Button>
            </div>
            {listsCount > 0 && (
              <p id={`${uid}-hint`} className="text-xs text-slate-500">
                Impossibile eliminare l'ICP: ha {plural(listsCount, 'lista', 'liste')} (contano anche le archiviate).
              </p>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
