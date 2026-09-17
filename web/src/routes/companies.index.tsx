import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { api, isApiError, queryKeys } from '../api/client';
import { REFERENCE_OUTCOME_LABELS, type CompanyWithRefs } from '../api/types';
import { formatDay, searchParam, useSearchDraft } from '../components/ProspectTable';
import { CompanyExistsNotice, companyLabel, shortCompanyUrl } from '../components/SourceCompanyDialog';
import { Card, ErrorBox, Loading, PageHeader } from '../components/ui';
import { toast } from '../components/ui/toaster';

/*
 * Aziende (crm-foundation T19, FLOW D.1): elenco (nome, settore, riferimento di quali ICP, n. prospect)
 * e "Aggiungi da URL" (`POST /api/companies/from-url`), che porta al dettaglio dove si estraggono le
 * persone. `?add=1` (onboarding) e `?listId=` (dalla Lista) aprono subito il form; `listId` segue
 * l'utente fino al dettaglio e preseleziona la lista nel dialog di sourcing.
 */

interface CompaniesSearch {
  /** Apre subito "Aggiungi da URL" (`?add=1` dall'onboarding: il router lo legge come numero). */
  add?: boolean;
  /** Lista in cui aggiungere persone (ingresso "Aggiungi persone da un'azienda" della Lista). */
  listId?: number;
  q?: string;
}

export const Route = createFileRoute('/companies/')({
  component: CompaniesPage,
  validateSearch: (s: Record<string, unknown>): CompaniesSearch => ({
    add: s.add === 1 || s.add === '1' || searchParam.bool(s.add) === true ? true : undefined,
    listId: searchParam.id(s.listId),
    q: searchParam.text(s.q),
  }),
});

const th = 'px-4 py-2 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase';
const td = 'px-4 py-3 align-top text-sm';

/** Messaggio leggibile di un errore di scrittura (messaggi zod se presenti). */
function errorText(err: unknown): string {
  if (isApiError(err) && err.body?.issues?.length) return err.body.issues.map((i) => i.message).join(' ');
  return err instanceof Error ? err.message : 'Operazione non riuscita.';
}

function CompaniesPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const [adding, setAdding] = useState(Boolean(search.add || search.listId));
  useEffect(() => {
    if (search.add || search.listId) setAdding(true);
  }, [search.add, search.listId]);

  const companies = useQuery({
    queryKey: queryKeys.companiesIndex(search.q ?? ''),
    queryFn: () => api.companies.list({ q: search.q }),
    placeholderData: keepPreviousData,
  });
  const [qDraft, setQDraft] = useSearchDraft(search.q, (q) => void navigate({ search: (prev) => ({ ...prev, q }), replace: true }));

  const closeAdd = () => {
    setAdding(false);
    if (search.add) void navigate({ search: (prev) => ({ ...prev, add: undefined }), replace: true });
    requestAnimationFrame(() => addButtonRef.current?.focus());
  };

  const items = companies.data?.items ?? [];
  const empty = companies.isSuccess && items.length === 0 && !search.q;

  return (
    <>
      <PageHeader
        title="Aziende"
        subtitle="Aziende target e di riferimento: da un'azienda estrai le persone con i ruoli dell'ICP e le metti in una lista."
        actions={
          <Button
            ref={addButtonRef}
            type="button"
            onClick={() => (adding ? closeAdd() : setAdding(true))}
            aria-expanded={adding}
          >
            <PlusIcon aria-hidden="true" />
            Aggiungi da URL
          </Button>
        }
      />

      {search.listId !== undefined && <ListContext listId={search.listId} />}

      {adding && (
        <Card title="Aggiungi azienda da URL" className="mb-6">
          <AddCompanyForm listId={search.listId} onCancel={closeAdd} />
        </Card>
      )}

      {companies.isPending ? (
        <Loading />
      ) : companies.error ? (
        <div className="flex flex-col items-start gap-3">
          <ErrorBox error={companies.error} />
          <Button type="button" variant="outline" onClick={() => void companies.refetch()}>
            Riprova
          </Button>
        </div>
      ) : empty ? (
        <Card>
          <div className="flex flex-col items-center gap-3 px-4 py-14 text-center">
            <p className="text-sm font-medium text-slate-700">Nessuna azienda: aggiungi la prima da un URL LinkedIn.</p>
            <p className="max-w-md text-sm text-slate-500">
              Dalla pagina dell'azienda estrai le persone con i ruoli del tuo ICP; le aziende di riferimento degli ICP compaiono
              qui.
            </p>
            {!adding && (
              <Button type="button" onClick={() => setAdding(true)}>
                <PlusIcon aria-hidden="true" />
                Aggiungi da URL
              </Button>
            )}
          </div>
        </Card>
      ) : (
        <Card>
          <div className="border-b border-slate-100 px-4 py-3">
            <Input
              type="search"
              value={qDraft}
              onChange={(e) => setQDraft(e.target.value)}
              placeholder="Cerca per nome o URL…"
              aria-label="Cerca aziende"
              className="h-8 max-w-72"
            />
          </div>
          {items.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm font-medium text-slate-600">Nessuna azienda corrisponde alla ricerca.</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => void navigate({ search: (prev) => ({ ...prev, q: undefined }) })}
              >
                Pulisci
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className={cn('w-full', companies.isPlaceholderData && 'opacity-70')} aria-busy={companies.isFetching || undefined}>
                <caption className="sr-only">Aziende</caption>
                <thead className="border-b border-slate-100">
                  <tr>
                    <th scope="col" className={th}>
                      Azienda
                    </th>
                    <th scope="col" className={th}>
                      Settore
                    </th>
                    <th scope="col" className={th}>
                      Riferimento per
                    </th>
                    <th scope="col" className={cn(th, 'text-right')}>
                      Prospect
                    </th>
                    <th scope="col" className={th}>
                      Aggiunta
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((company) => (
                    <CompanyRow key={company.id} company={company} listId={search.listId} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  );
}

/** Contesto "sto aggiungendo persone alla lista X" (FLOW D.1, ingresso dalla Lista). */
function ListContext({ listId }: { listId: number }) {
  const list = useQuery({ queryKey: queryKeys.list(listId), queryFn: () => api.lists.get(listId), retry: false });
  if (list.isPending) return null;
  if (list.error) {
    return (
      <p role="status" className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        La lista indicata non esiste più: potrai sceglierne un'altra quando cerchi le persone.
      </p>
    );
  }
  const data = list.data;
  return (
    <div role="status" className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950">
      <p>
        Aggiungi persone alla lista{' '}
        <Link to="/lists/$id" params={{ id: String(data.id) }} className="font-semibold underline">
          {data.name}
        </Link>{' '}
        (ICP {data.icp.name}): incolla l'URL LinkedIn dell'azienda, oppure apri un'azienda già presente e usa "Estrai persone".
      </p>
      {data.archived_at && (
        <p className="mt-1 font-medium text-amber-900">
          La lista è archiviata: la ricerca resterà bloccata finché non la ripristini.
        </p>
      )}
    </div>
  );
}

function AddCompanyForm({ listId, onCancel }: { listId?: number; onCancel: () => void }) {
  const uid = useId();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const urlRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [existingId, setExistingId] = useState<number | null>(null);

  const add = useMutation({
    mutationFn: (value: string) => api.companies.fromUrl({ url: value }),
    onSuccess: async (company) => {
      const { created, ...detail } = company;
      queryClient.setQueryData(queryKeys.company(company.id), detail);
      if (!created) {
        // Nessuna riga creata: si segnala l'esistente (FLOW "Azienda duplicata").
        setExistingId(company.id);
        urlRef.current?.focus();
        return;
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.companies });
      toast({
        title: `Azienda aggiunta: ${companyLabel(company)}`,
        description: listId ? 'Scegli ruoli e modalità e avvia la ricerca di persone.' : "Completa l'anagrafica o estrai subito le persone.",
      });
      await navigate({ to: '/companies/$id', params: { id: String(company.id) }, search: listId ? { listId } : {} });
    },
    onError: (err) => {
      setError(errorText(err));
      urlRef.current?.focus();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setExistingId(null);
    if (url.trim() === '') {
      setError('Inserisci un URL del tipo linkedin.com/company/<nome>');
      urlRef.current?.focus();
      return;
    }
    setError(null);
    add.mutate(url.trim());
  };

  const describedBy = [error && `${uid}-error`, existingId !== null && `${uid}-exists`, `${uid}-hint`].filter(Boolean).join(' ');

  return (
    <form onSubmit={submit} noValidate aria-label="Aggiungi azienda da URL" className="flex flex-col gap-2 px-4 py-4">
      <label htmlFor={`${uid}-url`} className="text-xs font-medium text-slate-600">
        URL LinkedIn dell'azienda
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          ref={urlRef}
          id={`${uid}-url`}
          type="url"
          inputMode="url"
          autoFocus
          value={url}
          placeholder="https://www.linkedin.com/company/acme/"
          className="max-w-md"
          aria-invalid={error || existingId !== null ? true : undefined}
          aria-describedby={describedBy}
          onChange={(e) => {
            setUrl(e.target.value);
            setError(null);
            setExistingId(null);
          }}
        />
        <Button type="submit" disabled={add.isPending} aria-busy={add.isPending}>
          {add.isPending ? 'Aggiunta…' : listId ? 'Aggiungi e cerca persone' : 'Aggiungi'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Annulla
        </Button>
      </div>
      {error && (
        <p id={`${uid}-error`} role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {existingId !== null && <CompanyExistsNotice id={`${uid}-exists`} companyId={existingId} listId={listId} />}
      <p id={`${uid}-hint`} className="text-xs text-slate-500">
        L'URL della pagina aziendale LinkedIn. Nome, settore e sede li completi dopo nel dettaglio.
      </p>
    </form>
  );
}

function CompanyRow({ company, listId }: { company: CompanyWithRefs; listId?: number }) {
  return (
    <tr data-company-id={company.id}>
      <td className={cn(td, 'max-w-sm')}>
        <Link
          to="/companies/$id"
          params={{ id: String(company.id) }}
          search={listId ? { listId } : {}}
          className="font-medium text-slate-900 hover:underline"
        >
          {companyLabel(company)}
        </Link>
        <a
          href={company.linkedin_url}
          target="_blank"
          rel="noreferrer"
          className="block truncate text-xs text-slate-500 hover:underline"
        >
          {shortCompanyUrl(company.linkedin_url)}
        </a>
        {company.location && <p className="text-xs text-slate-500">{company.location}</p>}
      </td>
      <td className={cn(td, 'text-slate-700')}>{company.industry ?? <span className="text-slate-400">—</span>}</td>
      <td className={td}>
        {company.reference_of.length === 0 ? (
          <span className="text-slate-400">—</span>
        ) : (
          <ul className="flex flex-wrap gap-1" aria-label={`ICP di cui ${companyLabel(company)} è riferimento`}>
            {company.reference_of.map((ref) => (
              <li key={ref.icp_id}>
                <Link
                  to="/icps/$id"
                  params={{ id: String(ref.icp_id) }}
                  className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-800 hover:bg-slate-200"
                >
                  {ref.icp_name} · {REFERENCE_OUTCOME_LABELS[ref.outcome]}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </td>
      <td className={cn(td, 'text-right tabular-nums')}>{company.prospects_count}</td>
      <td className={cn(td, 'whitespace-nowrap text-slate-600')}>
        <time dateTime={company.created_at}>{formatDay(company.created_at)}</time>
      </td>
    </tr>
  );
}
