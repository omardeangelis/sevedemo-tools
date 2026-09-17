import { useEffect, useId, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArchiveIcon, ArchiveRestoreIcon, PlusIcon } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api, queryKeys } from '../api/client';
import { PROSPECT_STATUSES, STATUS_LABELS, type IcpListItem, type ProspectList } from '../api/types';
import { useDialogFocusReturn } from '../components/BulkBar';
import { searchParam } from '../components/ProspectTable';
import { Card, ErrorBox, Loading, PageHeader } from '../components/ui';
import { toast } from '../components/ui/toaster';

/*
 * Liste (crm-foundation T15, FLOW "Entry points" e "Edge cases"): card raggruppate per ICP con
 * conteggi per stato, "Nuova lista", archivia/ripristina (senza conferma: reversibile) e toggle
 * "Mostra archiviate" nell'URL.
 */

interface ListsSearch {
  archived?: boolean;
}

export const Route = createFileRoute('/lists/')({
  component: ListsPage,
  validateSearch: (s: Record<string, unknown>): ListsSearch => ({
    archived: searchParam.bool(s.archived) === true ? true : undefined,
  }),
});

function ListsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const includeArchived = search.archived === true;

  const icps = useQuery({ queryKey: queryKeys.icpsIndex, queryFn: api.icps.list });
  const lists = useQuery({
    queryKey: queryKeys.listsIndex(includeArchived),
    queryFn: () => api.lists.list({ includeArchived }),
  });
  const [createFor, setCreateFor] = useState<number | 'any' | null>(null);

  const archive = useMutation({
    mutationFn: ({ list, archived }: { list: ProspectList; archived: boolean }) => api.lists.update(list.id, { archived }),
    onSuccess: (list, { archived }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.lists });
      void queryClient.invalidateQueries({ queryKey: queryKeys.icps });
      toast({
        tone: 'success',
        title: archived ? `Lista '${list.name}' archiviata` : `Lista '${list.name}' ripristinata`,
        description: archived ? 'Nascosta da Liste, job disabilitati. La ritrovi con "Mostra archiviate".' : undefined,
      });
    },
    onError: (err) => toast({ tone: 'error', title: 'Operazione non riuscita', description: err instanceof Error ? err.message : undefined }),
  });

  const icpItems = icps.data?.items ?? [];
  const noIcp = icps.isSuccess && icpItems.length === 0;

  const header = (
    <PageHeader
      title="Liste"
      subtitle="Le liste raggruppano i prospect per ICP: da qui arricchisci, analizzi ed esporti."
      actions={
        <>
          <Button
            type="button"
            variant="outline"
            aria-pressed={includeArchived}
            onClick={() => void navigate({ search: includeArchived ? {} : { archived: true } })}
          >
            {includeArchived ? 'Nascondi archiviate' : 'Mostra archiviate'}
          </Button>
          <Button type="button" onClick={() => setCreateFor('any')} disabled={noIcp} aria-describedby={noIcp ? 'lists-no-icp' : undefined}>
            <PlusIcon aria-hidden="true" />
            Nuova lista
          </Button>
        </>
      }
    />
  );

  if (icps.isPending || lists.isPending) {
    return (
      <>
        {header}
        <Loading />
      </>
    );
  }
  if (icps.error || lists.error) {
    return (
      <>
        {header}
        <div className="flex flex-col items-start gap-3">
          <ErrorBox error={icps.error ?? lists.error} />
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void icps.refetch();
              void lists.refetch();
            }}
          >
            Riprova
          </Button>
        </div>
      </>
    );
  }

  if (noIcp) {
    return (
      <>
        {header}
        <Card>
          <div className="py-12 text-center">
            <p id="lists-no-icp" className="text-sm font-medium text-slate-700">
              Prima crea un ICP: ogni lista appartiene a un ICP.
            </p>
            <Link to={'/icps' as never} className={buttonVariants({ className: 'mt-4' })}>
              Crea ICP
            </Link>
          </div>
        </Card>
      </>
    );
  }

  const listItems = lists.data?.items ?? [];
  const groups = icpItems.map((icp) => ({ icp, lists: listItems.filter((l) => l.icp_id === icp.id) }));

  return (
    <>
      {header}
      <div className="flex flex-col gap-6">
        {groups.map(({ icp, lists: own }) => (
          <section key={icp.id} aria-labelledby={`icp-${icp.id}`}>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id={`icp-${icp.id}`} className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
                ICP:{' '}
                <Link to={`/icps/${icp.id}` as never} className="text-slate-800 hover:underline">
                  {icp.name}
                </Link>
              </h2>
              <Button type="button" variant="ghost" size="sm" onClick={() => setCreateFor(icp.id)}>
                <PlusIcon aria-hidden="true" />
                Nuova lista per {icp.name}
              </Button>
            </div>
            {own.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-5 text-sm text-slate-500">
                {includeArchived ? 'Nessuna lista per questo ICP.' : 'Nessuna lista attiva per questo ICP.'}
              </p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {own.map((list) => (
                  <li key={list.id}>
                    <ListCard
                      list={list}
                      busy={archive.isPending && archive.variables?.list.id === list.id}
                      onArchive={(archived) => archive.mutate({ list, archived })}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      <NewListDialog
        open={createFor !== null}
        onOpenChange={(open) => !open && setCreateFor(null)}
        icps={icpItems}
        defaultIcpId={typeof createFor === 'number' ? createFor : icpItems.length === 1 ? icpItems[0].id : undefined}
      />
    </>
  );
}

function ListCard({ list, busy, onArchive }: { list: ProspectList; busy: boolean; onArchive: (archived: boolean) => void }) {
  const archived = list.archived_at !== null;
  const counts = PROSPECT_STATUSES.filter((s) => list.counts_by_status[s] > 0);
  const total = list.members_count;
  return (
    <Card className={archived ? 'opacity-80' : undefined}>
      <div className="flex flex-col gap-2 px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link to="/lists/$id" params={{ id: String(list.id) }} className="font-semibold text-slate-900 hover:underline">
              {list.name}
            </Link>
            {archived && (
              <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">Archiviata</span>
            )}
            {list.description && <p className="line-clamp-2 text-sm text-slate-500">{list.description}</p>}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onArchive(!archived)}
            disabled={busy}
            aria-busy={busy}
            aria-label={archived ? `Ripristina la lista ${list.name}` : `Archivia la lista ${list.name}`}
          >
            {archived ? <ArchiveRestoreIcon aria-hidden="true" /> : <ArchiveIcon aria-hidden="true" />}
            {archived ? 'Ripristina' : 'Archivia'}
          </Button>
        </div>
        <p className="text-sm text-slate-700">
          <span className="font-medium tabular-nums">{total}</span> {total === 1 ? 'persona' : 'persone'}
          <span className="text-slate-500">
            {' '}
            · arricchiti {list.enriched_count}/{total} · analizzati {list.analyzed_count}/{total} · con email {list.with_email_count}/{total}
          </span>
        </p>
        {counts.length > 0 && (
          <ul aria-label="Conteggi per stato" className="flex flex-wrap gap-1.5">
            {counts.map((s) => (
              <li key={s}>
                <Link
                  to="/lists/$id"
                  params={{ id: String(list.id) }}
                  search={{ status: s }}
                  className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-200"
                >
                  {STATUS_LABELS[s]} {list.counts_by_status[s]}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function NewListDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; icps: IcpListItem[]; defaultIcpId?: number }) {
  const queryClient = useQueryClient();
  const focus = useDialogFocusReturn();
  const uid = useId();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icpId, setIcpId] = useState<number | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.lists.create({ icpId: icpId!, name: name.trim(), description: description.trim() || null }),
    onSuccess: (list) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.lists });
      void queryClient.invalidateQueries({ queryKey: queryKeys.icps });
      toast({
        tone: 'success',
        title: `Lista '${list.name}' creata`,
        action: (
          <Link to="/lists/$id" params={{ id: String(list.id) }} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            Apri lista
          </Link>
        ),
      });
      props.onOpenChange(false);
    },
  });

  useEffect(() => {
    if (props.open) {
      setName('');
      setDescription('');
      setIcpId(props.defaultIcpId ?? null);
      setNameError(null);
      create.reset();
    }
    // Si azzera solo all'apertura (`create.reset` è stabile).
  }, [props.open]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setNameError('Il nome è obbligatorio.');
      return;
    }
    if (icpId === null) return;
    create.mutate();
  };

  const serverError = create.error instanceof Error ? create.error.message : null;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton={false} {...focus}>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>Nuova lista</DialogTitle>
            <DialogDescription>Ogni lista appartiene a un ICP: il fit dell'analisi si calcola rispetto a quello.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${uid}-name`} className="text-sm font-medium text-slate-700">
              Nome
            </label>
            <Input
              id={`${uid}-name`}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameError(null);
              }}
              placeholder="es. CTO startup IT"
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? `${uid}-name-error` : undefined}
              autoFocus
            />
            {nameError && (
              <p id={`${uid}-name-error`} className="text-sm text-red-700">
                {nameError}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${uid}-icp`} className="text-sm font-medium text-slate-700">
              ICP
            </label>
            <select
              id={`${uid}-icp`}
              value={icpId ?? ''}
              onChange={(e) => setIcpId(e.target.value ? Number(e.target.value) : null)}
              className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
            >
              {icpId === null && <option value="">Scegli l'ICP…</option>}
              {props.icps.map((icp) => (
                <option key={icp.id} value={icp.id}>
                  {icp.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${uid}-description`} className="text-sm font-medium text-slate-700">
              Descrizione <span className="font-normal text-slate-500">(facoltativa)</span>
            </label>
            <textarea
              id={`${uid}-description`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm"
            />
          </div>
          {serverError && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {serverError}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Annulla
              </Button>
            </DialogClose>
            <Button type="submit" disabled={icpId === null || create.isPending} aria-busy={create.isPending}>
              {create.isPending ? 'Creazione…' : 'Crea lista'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
