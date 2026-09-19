import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import {
  Building2Icon,
  ExternalLinkIcon,
  ListIcon,
  MessageCircleIcon,
  OrbitIcon,
  PlusIcon,
  ThumbsUpIcon,
  UserPlusIcon,
  type LucideIcon,
} from 'lucide-react';
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
import { cn } from '@/lib/utils';
import { api, isApiError, queryKeys } from '../api/client';
import type {
  EnrichProvider,
  IcpListItem,
  MergeablePersonRef,
  PersonRef,
  ProspectDetail,
  ProspectList,
  ProspectPatch,
  Source,
  SourceKind,
} from '../api/types';
import { AnalysisCard } from '../components/AnalysisCard';
import { ApolloEnrichSummary, EnrichProviderField, RetryFailedField, useLastApifyUnitPrice } from '../components/BulkBar';
import { JobPreviewDialog } from '../components/JobPreviewDialog';
import { ListPicker } from '../components/ListPicker';
import { invalidateProspectViews, StatusSelect } from '../components/StatusSelect';
import { Timeline } from '../components/Timeline';
import { TouchpointForm } from '../components/TouchpointForm';
import { Card, ErrorBox, Loading } from '../components/ui';
import { toast } from '../components/ui/toaster';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { CompanyLinkControls } from '../components/CompanyLinkControls';
import { PersonRefLine } from '../components/DuplicatePanel';
import { MergeDialog } from '../components/MergeDialog';
import { NextActionCard } from '../components/NextActionCard';
import { fmtDayMonth, useToday } from '../lib/dates';
import { fmtDateTime } from '../lib/format';
import { parseOrigin } from '../lib/origin';
import { useJobPreview, useJobStart } from '../lib/jobs';

interface ProspectSearch {
  /** Lista di contesto: default del form touchpoint e dell'ICP dell'analisi. */
  list?: number;
  /** Vista di provenienza (path + query interni, people-first-crm A7, PLAN P-9). */
  from?: string;
}

export const Route = createFileRoute('/people/$id')({
  // `?list` o `?from` non validi → ignorati (invariante: filtri invalidi nell'URL tornano al default).
  validateSearch: (search: Record<string, unknown>): ProspectSearch => {
    const list = Number(search.list);
    const from = parseOrigin(search.from) ? (search.from as string) : undefined;
    return { ...(Number.isInteger(list) && list > 0 ? { list } : {}), ...(from ? { from } : {}) };
  },
  component: ProspectPage,
});

/**
 * Dettaglio del prospect (crm-foundation T16, FLOW F): header con stato unico e liste, a sinistra
 * anagrafica, fonti e profilo LinkedIn, a destra analisi AI, timeline e form touchpoint. Un id
 * inesistente (o unito a un altro prospect) mostra "Prospect non trovato" con i link per tornare.
 */
function ProspectPage() {
  const { id: rawId } = Route.useParams();
  const { list: listParam, from } = Route.useSearch();
  const id = Number(rawId);
  const validId = Number.isInteger(id) && id > 0;
  const prospect = useQuery({
    queryKey: queryKeys.prospect(id),
    queryFn: () => api.prospects.get(id),
    enabled: validId,
    retry: (count, err) => !(isApiError(err) && err.status === 404) && count < 1,
  });

  if (!validId || (isApiError(prospect.error) && prospect.error.status === 404)) return <ProspectNotFound />;
  if (prospect.data) return <ProspectView key={prospect.data.id} prospect={prospect.data} listParam={listParam} from={from} />;
  if (prospect.error) {
    return (
      <>
        <PersonCrumbs name="Scheda" from={from} />
        <div className="flex flex-col items-start gap-3">
          <ErrorBox error={prospect.error} />
          <Button type="button" variant="outline" onClick={() => void prospect.refetch()}>
            Riprova
          </Button>
        </div>
      </>
    );
  }
  return <Loading />;
}

function ProspectNotFound() {
  return (
    <Card className="mx-auto mt-10 max-w-lg">
      <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <h1 className="text-lg font-semibold text-slate-900">Persona non trovata</h1>
        <p className="text-sm text-slate-500">Il link potrebbe essere sbagliato, oppure la persona è stata unita a un'altra.</p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <Link to="/people" activeOptions={{ exact: true }} className={buttonVariants()}>
            Vai a Persone
          </Link>
        </div>
      </div>
    </Card>
  );
}

/**
 * Percorso "Persone › <nome>" e, da lista, azienda o Oggi, "← <origine>" (A6, A7). Da Persone (qualunque vista e
 * filtri) il segmento Persone riporta a quella vista; da un link diretto a `/people`.
 */
function PersonCrumbs({ name, from }: { name: string; from?: string }) {
  const origin = parseOrigin(from);
  const list = useQuery({
    queryKey: queryKeys.list(origin?.id ?? 0),
    queryFn: () => api.lists.get(origin!.id!),
    enabled: origin?.kind === 'list',
  });
  const company = useQuery({
    queryKey: queryKeys.company(origin?.id ?? 0),
    queryFn: () => api.companies.get(origin!.id!),
    enabled: origin?.kind === 'company',
  });
  const people = origin?.kind === 'people' ? origin : undefined;
  let back: { label: string; to: string; search: Record<string, unknown> } | undefined;
  if (origin?.kind === 'list') back = { label: list.data?.name ?? 'Lista', to: origin.path, search: origin.search };
  if (origin?.kind === 'company') back = { label: company.data?.name ?? company.data?.domain ?? 'Azienda', to: origin.path, search: origin.search };
  if (origin?.kind === 'today') back = { label: 'Oggi', to: '/', search: origin.search };
  return <Breadcrumbs back={back} items={[{ label: 'Persone', to: '/people', search: people?.search }, { label: name }]} />;
}

// ---------------------------------------------------------------------------
// Pagina
// ---------------------------------------------------------------------------

/** ICP dell'analisi di default: lista di contesto → ICP delle liste (preferendo uno già analizzato) → ultima analisi → primo ICP. */
function defaultIcpId(p: ProspectDetail, icps: IcpListItem[], contextListId: number | null): number | null {
  const context = p.memberships.find((m) => m.list_id === contextListId);
  if (context) return context.icp_id;
  const memberIcps = [...new Set(p.memberships.map((m) => m.icp_id))];
  const analyzed = new Set(p.latest_analyses.map((a) => a.icp_id));
  const fromLists = memberIcps.find((icpId) => analyzed.has(icpId)) ?? memberIcps[0];
  return fromLists ?? p.latest_analysis?.icp_id ?? icps[0]?.id ?? null;
}

/** Arricchimento e analisi non possibili senza LinkedIn (E11): stesso testo del server (409 `no_linkedin`). */
export const NO_LINKEDIN_REASON = 'Serve il profilo LinkedIn: aggiungilo per arricchire o analizzare questa persona.';

function ProspectView({ prospect: p, listParam, from }: { prospect: ProspectDetail; listParam?: number; from?: string }) {
  const icps = useQuery({ queryKey: queryKeys.icpsIndex, queryFn: api.icps.list });
  const today = useToday();
  const [icpChoice, setIcpChoice] = useState<number | null>(null);

  const memberships = p.memberships;
  const paramList = memberships.find((m) => m.list_id === listParam) ?? null;
  const contextListId = paramList?.list_id ?? (memberships.length === 1 ? memberships[0].list_id : null);

  const icpItems = icps.data?.items ?? [];
  const analyzedIcps = new Set(p.latest_analyses.map((a) => a.icp_id));
  const icpOptions = icpItems.map((icp) => ({ id: icp.id, name: icp.name, analyzed: analyzedIcps.has(icp.id) }));
  const icpId = icpChoice !== null && icpItems.some((i) => i.id === icpChoice) ? icpChoice : defaultIcpId(p, icpItems, contextListId);

  return (
    <>
      <PersonCrumbs name={p.full_name ?? 'Senza nome'} from={from} />
      <ProspectHeader prospect={p} contextListId={contextListId} />
      <div className="mb-6">
        <NextActionCard key={`${p.next_action_on}-${p.next_action_text}`} prospect={p} today={today} />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card title="Anagrafica">
            <div className="border-b border-slate-100 px-4 pt-4 pb-3">
              <CompanyLinkControls prospect={p} linkedName={p.linked_company_name} />
            </div>
            <ProfileFieldsForm key={fieldsKey(p)} prospect={p} />
          </Card>
          <Card title={`Fonti (${p.sources.length})`}>
            <SourcesList sources={p.sources} />
          </Card>
          <Card title="Profilo LinkedIn">
            <ProfileDetails prospect={p} />
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Card title="Analisi AI">
            <div className="p-4">
              {icps.isPending && memberships.length === 0 ? (
                <p className="text-sm text-slate-500">Caricamento ICP…</p>
              ) : icps.error && icpId === null ? (
                <ErrorBox error={icps.error} />
              ) : (
                <AnalysisCard
                  prospectId={p.id}
                  icpId={icpId}
                  icpOptions={icpOptions}
                  onIcpChange={setIcpChoice}
                  disabledReason={p.linkedin_url === null ? NO_LINKEDIN_REASON : null}
                />
              )}
            </div>
          </Card>
          <Card title="Timeline">
            <div className="flex flex-col gap-6 p-4">
              <Timeline activities={p.timeline} />
              <div className="border-t border-slate-100 pt-4">
                <TouchpointForm prospectId={p.id} status={p.status} memberships={memberships} defaultListId={contextListId} />
              </div>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Header: nome, LinkedIn, stato, liste
// ---------------------------------------------------------------------------

function ProspectHeader(props: { prospect: ProspectDetail; contextListId: number | null }) {
  const { prospect: p } = props;
  const [adding, setAdding] = useState(false);
  const role = [p.title, p.linked_company_name ?? p.company_name].filter(Boolean).join(' · ');

  return (
    <header className="mb-6 flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{p.full_name ?? 'Nome non disponibile'}</h1>
          {p.headline && <p className="mt-1 text-sm text-slate-700">{p.headline}</p>}
          {(role || p.location) && (
            <p className="mt-0.5 text-sm text-slate-500">
              {p.company_id && (p.linked_company_name ?? p.company_name) ? (
                <>
                  {p.title && `${p.title} · `}
                  <Link to="/companies/$id" params={{ id: String(p.company_id) }} className="underline underline-offset-2 hover:text-slate-900">
                    {p.linked_company_name ?? p.company_name}
                  </Link>
                </>
              ) : (
                role
              )}
              {role && p.location && ' · '}
              {p.location}
            </p>
          )}
        </div>
        {p.linkedin_url ? (
          <a href={p.linkedin_url} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'outline' })}>
            Apri su LinkedIn
            <ExternalLinkIcon aria-hidden="true" />
            <span className="sr-only">(si apre in una nuova scheda)</span>
          </a>
        ) : (
          <Button type="button" variant="outline" onClick={() => focusField(linkedinFieldId(p.id))}>
            <PlusIcon aria-hidden="true" />
            Aggiungi profilo LinkedIn
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
        <StatusSelect prospectId={p.id} status={p.status} listId={props.contextListId} nextActionOn={p.next_action_on} />

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium tracking-wide text-slate-500 uppercase" id={`lists-${p.id}`}>
            Liste
          </span>
          <ul aria-labelledby={`lists-${p.id}`} className="flex flex-wrap items-center gap-1.5">
            {p.memberships.length === 0 ? (
              <li>
                <span className="inline-flex items-center rounded-full bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200 ring-inset">
                  Nessuna lista
                </span>
              </li>
            ) : (
              p.memberships.map((m) => (
                <li key={m.list_id}>
                  <Link
                    to={`/lists/${m.list_id}` as never}
                    title={`ICP: ${m.icp_name}`}
                    className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200 ring-inset hover:bg-slate-200"
                  >
                    <ListIcon className="size-3" aria-hidden="true" />
                    {m.list_name}
                    {m.archived_at && <span className="font-normal text-slate-500">(archiviata)</span>}
                  </Link>
                </li>
              ))
            )}
          </ul>
          <Button type="button" variant="outline" size="xs" onClick={() => setAdding(true)}>
            <PlusIcon aria-hidden="true" />
            Aggiungi a lista
          </Button>
        </div>
      </div>

      {p.memberships.length >= 2 && (
        <p className="text-sm text-slate-600">
          Lo stato è unico per persona: cambiarlo qui vale in tutte le liste ({p.memberships.map((m) => m.list_name).join(', ')}).
        </p>
      )}

      <AddToListDialog prospect={p} open={adding} onOpenChange={setAdding} />
    </header>
  );
}

/** Porta il focus su un campo della scheda (e lo mostra). */
function focusField(id: string) {
  const el = document.getElementById(id);
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el?.focus({ preventScroll: true });
}

function AddToListDialog(props: { prospect: ProspectDetail; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { prospect: p } = props;
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<ProspectList | null>(null);
  const add = useMutation({
    mutationFn: (list: ProspectList) => api.lists.addMembers(list.id, [p.id]),
    onSuccess: (result, list) => {
      toast({
        tone: result.added > 0 ? 'success' : 'neutral',
        title: result.added > 0 ? `Aggiunto a '${list.name}'` : `Già presente in '${list.name}'`,
      });
      void invalidateProspectViews(queryClient);
      close();
    },
  });
  const close = () => {
    props.onOpenChange(false);
    setTarget(null);
    add.reset();
  };

  return (
    <Dialog open={props.open} onOpenChange={(open) => (open ? props.onOpenChange(true) : close())}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Aggiungi a lista</DialogTitle>
          <DialogDescription>
            {p.full_name ?? 'La persona'} resta un'unica persona: stato e timeline valgono in tutte le sue liste.
          </DialogDescription>
        </DialogHeader>
        <ListPicker
          value={target?.id ?? null}
          onChange={(_, list) => setTarget(list)}
          preferredIcpId={p.latest_analysis?.icp_id}
          disabled={add.isPending}
        />
        {add.error && (
          <div role="alert">
            <ErrorBox error={add.error} />
          </div>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Annulla
            </Button>
          </DialogClose>
          <Button
            type="button"
            disabled={!target || add.isPending}
            aria-busy={add.isPending}
            onClick={() => target && add.mutate(target)}
          >
            {add.isPending ? 'Aggiunta…' : 'Aggiungi'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Anagrafica editabile
// ---------------------------------------------------------------------------

const PROFILE_FIELDS = [
  { key: 'full_name', label: 'Nome' },
  { key: 'headline', label: 'Headline' },
  { key: 'title', label: 'Ruolo' },
  { key: 'company_name', label: 'Azienda (testo)' },
  { key: 'location', label: 'Località' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'phone', label: 'Telefono', type: 'tel' },
] as const;

/** Marcatore dei dati impostati a mano (D8, D9): rende visibile perché un arricchimento non li cambia. */
function ManualMark({ empty }: { empty: boolean }) {
  return (
    <span
      className="ml-1.5 rounded bg-violet-50 px-1 py-px text-[11px] font-medium text-violet-800 ring-1 ring-violet-200 ring-inset"
      title="Scritto da te: i job non lo sovrascrivono."
    >
      <span aria-hidden="true">{empty ? 'vuota · svuotata a mano' : 'a mano'}</span>
      <span className="sr-only">, {empty ? 'svuotato a mano' : 'scritto a mano'}: i job non lo sovrascrivono</span>
    </span>
  );
}

type ProfileFieldKey = (typeof PROFILE_FIELDS)[number]['key'];
type FormKey = ProfileFieldKey | 'linkedin_url';

/** Id del campo LinkedIn dell'Anagrafica: "Aggiungi profilo LinkedIn" dell'header ci porta il focus (E12). */
const linkedinFieldId = (prospectId: number) => `person-${prospectId}-linkedin`;

/** E3: il LinkedIn si corregge finché la persona ha solo la fonte "Aggiunta a mano". */
const LINKEDIN_LOCKED_REASON = 'Il profilo LinkedIn arriva da una fonte dei tuoi strumenti: non si modifica.';

const linkedinLocked = (p: ProspectDetail) => p.linkedin_url !== null && p.sources.some((s) => s.kind !== 'manual');

/** Cambia solo quando cambiano i campi dell'anagrafica (non con lo stato): il form si riallinea senza perdere modifiche. */
function fieldsKey(p: ProspectDetail): string {
  return JSON.stringify([p.linkedin_url, ...PROFILE_FIELDS.map((f) => p[f.key])]);
}

function usePatchProspect(prospectId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ProspectPatch) => api.prospects.update(prospectId, body),
    onSuccess: (prospect) => {
      queryClient.setQueryData(queryKeys.prospect(prospectId), prospect);
      void invalidateProspectViews(queryClient);
    },
  });
}

/** Errori 400 `issues` per campo; `null` se l'errore non è di validazione. */
function issuesByField(err: unknown): Record<string, string> | null {
  if (!isApiError(err) || !err.body?.issues?.length) return null;
  return Object.fromEntries(err.body.issues.map((i) => [i.path.split('.')[0], i.message]));
}

/** Esiti del PATCH legati a un campo (E3, E4, C3): il messaggio va sotto quel campo. */
const CODE_FIELDS: Record<string, FormKey | 'contacts'> = {
  invalid_linkedin: 'linkedin_url',
  linkedin_required: 'linkedin_url',
  linkedin_locked: 'linkedin_url',
  invalid_email: 'email',
  contact_required: 'contacts',
};

/** Errore del salvataggio per campo: `issues` zod o un codice di `CODE_FIELDS`. */
function fieldErrors(err: unknown): Partial<Record<FormKey | 'contacts', string>> | null {
  const issues = issuesByField(err);
  if (issues) return issues;
  const field = isApiError(err) && err.code ? CODE_FIELDS[err.code] : undefined;
  return field && err instanceof Error ? { [field]: err.message } : null;
}

/** Conflitti d'identità del PATCH (E5): LinkedIn di un'altra persona o email di altre persone. */
function conflictOf(err: unknown) {
  if (isApiError(err, 'linkedin_taken') && err.body?.prospect) {
    const b = err.body as unknown as { prospect: PersonRef; mergeable: boolean; reason: string | null };
    return { kind: 'linkedin' as const, owners: [{ ...b.prospect, mergeable: b.mergeable, reason: b.reason }] };
  }
  if (isApiError(err, 'email_taken') && Array.isArray(err.body?.prospects)) {
    return { kind: 'email' as const, owners: err.body.prospects as MergeablePersonRef[] };
  }
  return null;
}

function ProfileFieldsForm({ prospect: p }: { prospect: ProspectDetail }) {
  const uid = useId();
  const initial = {
    linkedin_url: p.linkedin_url ?? '',
    ...Object.fromEntries(PROFILE_FIELDS.map((f) => [f.key, p[f.key] ?? ''])),
  } as Record<FormKey, string>;
  const [values, setValues] = useState(initial);
  const [mergeWith, setMergeWith] = useState<MergeablePersonRef | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const openMerge = (other: MergeablePersonRef) => {
    setMergeWith(other);
    setMergeOpen(true);
  };
  const patch = usePatchProspect(p.id);
  const locked = linkedinLocked(p);
  const keys: FormKey[] = [...(locked ? [] : (['linkedin_url'] as const)), ...PROFILE_FIELDS.map((f) => f.key)];
  const changed = keys.filter((k) => values[k].trim() !== initial[k]);
  const errors = fieldErrors(patch.error);
  const conflict = conflictOf(patch.error);
  const lastBody = patch.variables ?? {};

  const save = (body: ProspectPatch) =>
    patch.mutate(body, {
      onSuccess: () =>
        toast({ title: body.linkedin_url !== undefined && initial.linkedin_url === '' ? 'Profilo LinkedIn aggiunto' : 'Anagrafica salvata' }),
    });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (changed.length === 0) return;
    save(Object.fromEntries(changed.map((k) => [k, values[k].trim() || null])));
  };
  /** Ogni modifica chiude l'esito del salvataggio precedente: pannelli e "Unisci" valgono per ciò che si era salvato. */
  const setValue = (key: FormKey, value: string) => {
    setValues((cur) => ({ ...cur, [key]: value }));
    if (patch.isError) patch.reset();
  };
  const restore = (...fields: FormKey[]) => {
    setValues((cur) => ({ ...cur, ...Object.fromEntries(fields.map((k) => [k, initial[k]])) }));
    patch.reset();
  };
  const describedBy = (key: FormKey, extra?: string | false) =>
    [errors?.[key] && `${uid}-${key}-error`, extra].filter(Boolean).join(' ') || undefined;

  const linkedinPanelId = `${uid}-linkedin-conflict`;
  const emailPanelId = `${uid}-email-conflict`;

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 p-4" noValidate aria-label="Anagrafica">
      <div className="flex flex-col gap-1">
        <label htmlFor={linkedinFieldId(p.id)} className="text-xs font-medium text-slate-600">
          Profilo LinkedIn
        </label>
        {locked ? (
          <>
            <Input
              id={linkedinFieldId(p.id)}
              value={p.linkedin_url ?? ''}
              readOnly
              aria-describedby={`${uid}-linkedin-locked`}
              className="bg-slate-50 text-slate-600"
            />
            <p id={`${uid}-linkedin-locked`} className="text-xs text-slate-500">
              {LINKEDIN_LOCKED_REASON}
            </p>
          </>
        ) : (
          <Input
            id={linkedinFieldId(p.id)}
            type="url"
            inputMode="url"
            value={values.linkedin_url}
            maxLength={500}
            placeholder="https://www.linkedin.com/in/nome-cognome/"
            onChange={(e) => setValue('linkedin_url', e.target.value)}
            aria-invalid={errors?.linkedin_url || conflict?.kind === 'linkedin' ? true : undefined}
            aria-describedby={describedBy('linkedin_url', conflict?.kind === 'linkedin' && linkedinPanelId)}
            className="bg-white"
          />
        )}
        {errors?.linkedin_url && (
          <p id={`${uid}-linkedin_url-error`} className="text-xs text-red-700">
            {errors.linkedin_url}
          </p>
        )}
        {conflict?.kind === 'linkedin' && (
          <LinkedinTakenPanel
            id={linkedinPanelId}
            owner={conflict.owners[0]}
            onMerge={openMerge}
            onUndo={() => restore('linkedin_url')}
          />
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {PROFILE_FIELDS.filter((f) => f.key !== 'company_name' || p.company_id === null).map((f) => (
          <div key={f.key} className={cn('flex flex-col gap-1', f.key === 'headline' && 'sm:col-span-2')}>
            <label htmlFor={`${uid}-${f.key}`} className="text-xs font-medium text-slate-600">
              {f.label}
              {p.manual_fields[f.key] && <ManualMark empty={!p[f.key]} />}
            </label>
            <Input
              id={`${uid}-${f.key}`}
              type={'type' in f ? f.type : 'text'}
              value={values[f.key]}
              maxLength={500}
              onChange={(e) => setValue(f.key, e.target.value)}
              aria-invalid={errors?.[f.key] || (f.key === 'email' && conflict?.kind === 'email') ? true : undefined}
              aria-describedby={describedBy(f.key, f.key === 'email' && conflict?.kind === 'email' && emailPanelId)}
              className="bg-white"
            />
            {errors?.[f.key] && (
              <p id={`${uid}-${f.key}-error`} className="text-xs text-red-700">
                {errors[f.key]}
              </p>
            )}
          </div>
        ))}
      </div>

      {conflict?.kind === 'email' && (
        <EmailTakenPanel
          id={emailPanelId}
          owners={conflict.owners}
          saving={patch.isPending}
          onMerge={openMerge}
          onSaveAnyway={() => save({ ...lastBody, confirm_email_duplicate: true })}
        />
      )}
      {errors?.contacts && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-red-700">
          <span>{errors.contacts}</span>
          <Button type="button" size="xs" variant="outline" onClick={() => restore('email', 'phone')}>
            Ripristina
          </Button>
        </div>
      )}
      {patch.error && !errors && !conflict && (
        <div role="alert">
          <ErrorBox error={patch.error} />
        </div>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={changed.length === 0 || patch.isPending} aria-busy={patch.isPending}>
          {patch.isPending ? 'Salvataggio…' : 'Salva'}
        </Button>
        {changed.length > 0 && !patch.isPending && (
          <Button type="button" size="sm" variant="ghost" onClick={() => restore(...keys)}>
            Annulla modifiche
          </Button>
        )}
        <p className="text-xs text-slate-500" aria-live="polite">
          {changed.length > 0 ? `${changed.length} ${changed.length === 1 ? 'campo modificato' : 'campi modificati'}` : ''}
        </p>
      </div>

      {mergeWith && (
        <MergeDialog
          open={mergeOpen}
          onOpenChange={setMergeOpen}
          keep={p}
          other={mergeWith}
          patch={lastBody}
          onOtherGone={() => {
            // Il conflitto non vale più: nulla da unire; al prossimo Salva il server ricalcola.
            const field = conflict?.kind === 'email' ? `${uid}-email` : linkedinFieldId(p.id);
            patch.reset();
            setTimeout(() => document.getElementById(field)?.focus(), 50);
          }}
          onMerged={() => {
            patch.reset();
            // Il form si rimonta con i valori uniti (e il pannello sparisce): il focus va sul profilo LinkedIn.
            setTimeout(() => document.getElementById(linkedinFieldId(p.id))?.focus(), 50);
          }}
        />
      )}
    </form>
  );
}

/** E5/E7, FLOW F.2: il LinkedIn incollato è già di un'altra persona; nulla salvato. */
function LinkedinTakenPanel(props: { id: string; owner: MergeablePersonRef; onMerge: (p: MergeablePersonRef) => void; onUndo: () => void }) {
  const { owner } = props;
  const name = owner.full_name ?? 'Senza nome';
  return (
    <div id={props.id} role="alert" className="mt-1 flex flex-col gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950 ring-1 ring-amber-200 ring-inset">
      <p>
        Questo profilo LinkedIn è già di <PersonRefLine person={owner} />. Non salvato.
      </p>
      {!owner.mergeable && owner.reason && <p>{owner.reason}</p>}
      <div className="flex flex-wrap gap-2">
        {owner.mergeable && (
          <Button type="button" size="sm" onClick={() => props.onMerge(owner)}>
            Unisci {name} in questa persona…
          </Button>
        )}
        <Button type="button" size="sm" variant="outline" onClick={props.onUndo}>
          Annulla la modifica
        </Button>
      </div>
    </div>
  );
}

/** E5/E7, FLOW F.5: l'email è anche di altre persone; "Unisci" o "Salva comunque". */
function EmailTakenPanel(props: {
  id: string;
  owners: MergeablePersonRef[];
  saving: boolean;
  onMerge: (p: MergeablePersonRef) => void;
  onSaveAnyway: () => void;
}) {
  return (
    <div id={props.id} role="alert" className="flex flex-col gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950 ring-1 ring-amber-200 ring-inset">
      <p>Questa email è anche di:</p>
      <ul className="flex flex-col gap-1.5">
        {props.owners.map((owner) => (
          <li key={owner.id} className="flex flex-col gap-1">
            <PersonRefLine person={owner} />
            {owner.mergeable ? (
              <Button type="button" size="xs" variant="outline" className="self-start" onClick={() => props.onMerge(owner)}>
                Unisci {owner.full_name ?? 'Senza nome'} in questa persona…
              </Button>
            ) : (
              owner.reason && <p className="text-xs text-amber-900">{owner.reason}</p>
            )}
          </li>
        ))}
      </ul>
      <Button type="button" size="sm" className="self-start" disabled={props.saving} aria-busy={props.saving} onClick={props.onSaveAnyway}>
        {props.saving ? 'Salvataggio…' : 'Salva comunque'}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fonti
// ---------------------------------------------------------------------------

const SOURCE_ICONS: Record<SourceKind, LucideIcon> = {
  post_reaction: ThumbsUpIcon,
  post_comment: MessageCircleIcon,
  company_employees: Building2Icon,
  manual: UserPlusIcon,
  // "Trova contatti" via Apollo (apollo-lookalike F11): stessa icona della tabella prospect.
  apollo_people: OrbitIcon,
};

/** Reazioni LinkedIn con la label italiana dell'interfaccia (emoji solo decorativa). */
const REACTIONS: Record<string, { emoji: string; label: string }> = {
  LIKE: { emoji: '👍', label: 'Consiglia' },
  PRAISE: { emoji: '👏', label: 'Festeggia' },
  APPRECIATION: { emoji: '🤝', label: 'Sostieni' },
  EMPATHY: { emoji: '❤️', label: 'Adoro' },
  INTEREST: { emoji: '💡', label: 'Perspicace' },
  ENTERTAINMENT: { emoji: '😂', label: 'Divertente' },
};

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text);

function SourcesList({ sources }: { sources: Source[] }) {
  if (sources.length === 0) return <p className="p-4 text-sm text-slate-500">Nessuna fonte registrata.</p>;
  return (
    <ul className="divide-y divide-slate-100">
      {sources.map((s) => {
        const Icon = SOURCE_ICONS[s.kind];
        return (
          <li key={s.id} className="flex gap-3 px-4 py-3">
            <Icon className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden="true" />
            <div className="min-w-0 text-sm text-slate-700">
              <SourceText source={s} />
              {!(s.kind === 'manual' && s.met_on) && (
                <>
                  <span className="text-slate-400"> · </span>
                  <time dateTime={s.captured_at} className="text-slate-500">
                    {shortDate(s.captured_at)}
                  </time>
                </>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function PostRef({ source: s }: { source: Source }) {
  const excerpt = s.post_excerpt ? `“${clip(s.post_excerpt.replace(/\s+/g, ' '), 90)}”` : 'un tuo post';
  if (!s.post_url) return <>{excerpt}</>;
  return (
    <a href={s.post_url} target="_blank" rel="noreferrer" title={s.post_excerpt ?? undefined} className="underline underline-offset-2 hover:text-slate-900">
      {excerpt}
      <span className="sr-only"> (post su LinkedIn, si apre in una nuova scheda)</span>
    </a>
  );
}

function SourceText({ source: s }: { source: Source }): ReactNode {
  switch (s.kind) {
    case 'post_reaction': {
      const reaction = s.reaction_type ? REACTIONS[s.reaction_type.toUpperCase()] : undefined;
      return (
        <>
          <span className="font-medium text-slate-900">Reazione</span>{' '}
          {reaction ? (
            <>
              <span aria-hidden="true">{reaction.emoji}</span> {reaction.label}
            </>
          ) : (
            s.reaction_type?.toLowerCase()
          )}{' '}
          a <PostRef source={s} />
        </>
      );
    }
    case 'post_comment':
      return (
        <>
          <span className="font-medium text-slate-900">Commento</span> su <PostRef source={s} />
          {s.comment_text && <q className="mt-1 block text-slate-800 italic">{s.comment_text}</q>}
        </>
      );
    case 'company_employees':
      return (
        <>
          <span className="font-medium text-slate-900">Dipendente</span> di{' '}
          {s.company_id ? (
            <Link to={`/companies/${s.company_id}` as never} className="underline underline-offset-2 hover:text-slate-900">
              {s.company_name ?? 'azienda'}
            </Link>
          ) : (
            (s.company_name ?? "un'azienda")
          )}{' '}
          (ricerca del {shortDate(s.captured_at)})
        </>
      );
    case 'apollo_people':
      return (
        <>
          <span className="font-medium text-slate-900">Apollo</span> ·{' '}
          {s.company_id ? (
            <Link to={`/companies/${s.company_id}` as never} className="underline underline-offset-2 hover:text-slate-900">
              {s.company_name ?? 'azienda'}
            </Link>
          ) : (
            (s.company_name ?? "un'azienda")
          )}{' '}
          (ricerca del {shortDate(s.captured_at)})
        </>
      );
    default:
      return (
        <>
          <span className="font-medium text-slate-900">Aggiunta a mano</span>
          {s.met_on && <> · incontro del {fmtDayMonth(s.met_on)}</>}
        </>
      );
  }
}

// ---------------------------------------------------------------------------
// Profilo LinkedIn (About ed esperienze da `raw_json`) e arricchimento
// ---------------------------------------------------------------------------

/** Primo valore non vuoto tra le chiavi (lettura tollerante: il `raw` può essere busta o item del provider). */
function pick(obj: unknown, ...keys: string[]): unknown {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return undefined;
  for (const key of keys) {
    const value = (obj as Record<string, unknown>)[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function str(value: unknown): string | null {
  if (typeof value === 'number') return String(value);
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** Data tollerante: stringa, `{text}` o `{month, year}`. */
function dateText(value: unknown): string | null {
  const direct = str(value);
  if (direct) return direct;
  const text = str(pick(value, 'text'));
  if (text) return text;
  const parts = [pick(value, 'month'), pick(value, 'year')].map(str).filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}

/** Array nella busta `{source, experience, …}` o direttamente nell'item del provider. */
function listIn(raw: unknown, ...keys: string[]): unknown[] {
  const value = pick(raw, ...keys) ?? pick(pick(raw, 'source'), ...keys);
  return Array.isArray(value) ? value : [];
}

interface ExperienceView {
  role: string | null;
  company: string | null;
  period: string | null;
  location: string | null;
  description: string | null;
}

function readExperiences(raw: unknown): ExperienceView[] {
  return listIn(raw, 'experience', 'experiences')
    .map((e) => {
      const start = dateText(pick(e, 'start_date', 'startDate', 'start'));
      const current = pick(e, 'is_current', 'isCurrent') === true;
      const end = dateText(pick(e, 'end_date', 'endDate', 'end')) ?? (current ? 'oggi' : null);
      return {
        role: str(pick(e, 'title', 'position')),
        company: str(pick(e, 'company', 'companyName', 'company_name')),
        period: start ? [start, end].filter(Boolean).join(' – ') : (str(pick(e, 'duration')) ?? end),
        location: str(pick(e, 'location')),
        description: str(pick(e, 'description')),
      };
    })
    .filter((e) => e.role || e.company || e.description);
}

function readEducation(raw: unknown): string[] {
  return listIn(raw, 'education')
    .map((e) =>
      [
        str(pick(e, 'school', 'schoolName', 'school_name')),
        str(pick(e, 'degree', 'degreeName', 'degree_name')),
        str(pick(e, 'field_of_study', 'fieldOfStudy')),
      ]
        .filter(Boolean)
        .join(' · '),
    )
    .filter(Boolean);
}

function readNamed(raw: unknown, ...keys: string[]): string[] {
  return listIn(raw, ...keys)
    .map((item) => {
      const name = str(item) ?? str(pick(item, 'name', 'title'));
      const issuer = str(pick(item, 'issuer', 'authority', 'organization'));
      return name ? (issuer ? `${name} (${issuer})` : name) : '';
    })
    .filter(Boolean);
}

function ProfileDetails({ prospect: p }: { prospect: ProspectDetail }) {
  const [enrichOpen, setEnrichOpen] = useState(false);
  const experiences = readExperiences(p.raw);
  const education = readEducation(p.raw);
  const certifications = readNamed(p.raw, 'certifications');
  const skills = readNamed(p.raw, 'skills', 'topSkills');

  return (
    <div className="flex flex-col gap-5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
        {p.enriched_at ? (
          <p className="text-slate-600">Arricchito il {fmtDateTime(p.enriched_at)}</p>
        ) : p.enrichment_attempted_at ? (
          <p className="text-slate-700">
            <span className="font-medium">Non arricchibile:</span> tentativo del {fmtDateTime(p.enrichment_attempted_at)} senza dati
            (profilo privato o non leggibile).
          </p>
        ) : (
          <p className="font-medium text-slate-700">Profilo non arricchito</p>
        )}
        {p.linkedin_url === null ? (
          <div className="flex flex-col items-end gap-1">
            <Button type="button" size="sm" variant="outline" disabled aria-describedby={`nolinkedin-${p.id}`}>
              Arricchisci
            </Button>
            <p id={`nolinkedin-${p.id}`} className="text-xs text-slate-500">
              {NO_LINKEDIN_REASON}
            </p>
          </div>
        ) : !p.enriched_at ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setEnrichOpen(true)}>
            {p.enrichment_attempted_at ? 'Riprova arricchimento' : 'Arricchisci'}
          </Button>
        ) : (
          !p.has_email && (
            <Button type="button" size="sm" variant="outline" onClick={() => setEnrichOpen(true)}>
              Cerca email di lavoro
            </Button>
          )
        )}
        {p.apollo_matched_at && !p.has_email && (
          <p className="w-full text-slate-600">
            <span className="font-medium">Email non disponibile</span> su Apollo (cercata il {fmtDateTime(p.apollo_matched_at)}).
          </p>
        )}
      </div>

      <AboutSection key={p.about ?? ''} prospect={p} />

      {experiences.length > 0 && (
        <section aria-labelledby={`exp-${p.id}`} className="flex flex-col gap-2">
          <h3 id={`exp-${p.id}`} className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Esperienze
          </h3>
          <ul className="flex flex-col gap-3">
            {experiences.map((e, i) => (
              <li key={i} className="text-sm">
                <p className="font-medium text-slate-900">{[e.role, e.company].filter(Boolean).join(' · ') || 'Esperienza'}</p>
                {(e.period || e.location) && (
                  <p className="text-xs text-slate-500">{[e.period, e.location].filter(Boolean).join(' · ')}</p>
                )}
                {e.description && <p className="mt-0.5 text-slate-700">{e.description}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {education.length > 0 && <SimpleList id={`edu-${p.id}`} title="Formazione" items={education} />}
      {certifications.length > 0 && <SimpleList id={`cert-${p.id}`} title="Certificazioni" items={certifications} />}
      {skills.length > 0 && <SimpleList id={`skills-${p.id}`} title="Competenze" items={skills} />}

      <EnrichDialog prospect={p} open={enrichOpen} onOpenChange={setEnrichOpen} />
    </div>
  );
}

function SimpleList({ id, title, items }: { id: string; title: string; items: string[] }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1">
      <h3 id={id} className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
        {title}
      </h3>
      <ul className="list-disc pl-5 text-sm text-slate-700">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

/** About in lettura (espandibile) e modificabile a mano: è anche il recupero "compila About e riprova" dell'analisi. */
function AboutSection({ prospect: p }: { prospect: ProspectDetail }) {
  const uid = useId();
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [value, setValue] = useState(p.about ?? '');
  const patch = usePatchProspect(p.id);
  const long = (p.about?.length ?? 0) > 400;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    patch.mutate(
      { about: value.trim() || null },
      {
        onSuccess: () => {
          toast({
            title: 'About salvato',
            description: p.latest_analysis ? "Le analisi fatte prima di questa modifica risultano da aggiornare." : undefined,
          });
        },
      },
    );
  };

  return (
    <section aria-labelledby={`${uid}-title`} className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <h3 id={`${uid}-title`} className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
          About
        </h3>
        {!editing && (
          <Button type="button" size="xs" variant="ghost" onClick={() => setEditing(true)}>
            {p.about ? 'Modifica About' : 'Scrivi About'}
          </Button>
        )}
      </div>
      {editing ? (
        <form onSubmit={submit} className="flex flex-col gap-2">
          <label htmlFor={`${uid}-about`} className="sr-only">
            About
          </label>
          <textarea
            id={`${uid}-about`}
            autoFocus
            rows={6}
            maxLength={20000}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setEditing(false);
                setValue(p.about ?? '');
              }
            }}
            className="w-full rounded-lg border border-input bg-white px-2.5 py-1.5 text-sm text-slate-900"
          />
          {patch.error && (
            <div role="alert">
              <ErrorBox error={patch.error} />
            </div>
          )}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={patch.isPending || value.trim() === (p.about ?? '')} aria-busy={patch.isPending}>
              {patch.isPending ? 'Salvataggio…' : 'Salva About'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={patch.isPending}
              onClick={() => {
                setEditing(false);
                setValue(p.about ?? '');
              }}
            >
              Annulla
            </Button>
          </div>
        </form>
      ) : p.about ? (
        <div>
          <p className={cn('text-sm whitespace-pre-wrap text-slate-700', long && !expanded && 'line-clamp-6')}>{p.about}</p>
          {long && (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
              className="mt-0.5 cursor-pointer text-xs font-medium text-slate-600 underline underline-offset-2 hover:text-slate-900"
            >
              {expanded ? 'Mostra meno' : 'Mostra tutto'}
            </button>
          )}
        </div>
      ) : (
        <p className="text-sm text-slate-500">Nessun About.</p>
      )}
    </section>
  );
}

/**
 * Arricchimento del singolo prospect: stesso job e stessa anteprima dei bulk (esito nel JobBanner), con il radio
 * Provider (FLOW D.1). Default Apify, salvo profilo già letto e senza email: lì Apify non farebbe nulla e si
 * parte da Apollo. Apify: il tentativo recente senza dati si riprova sempre (richiesta esplicita); Apollo: la
 * spunta "Riprova anche quelli senza risultato" resta esplicita perché costa un credito.
 */
function EnrichDialog(props: { prospect: ProspectDetail; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { prospect: p, open } = props;
  const defaultProvider: EnrichProvider = p.enriched_at !== null && !p.has_email ? 'apollo' : 'apify';
  const [provider, setProvider] = useState<EnrichProvider>(defaultProvider);
  const [apolloRetry, setApolloRetry] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setProvider(defaultProvider);
      setApolloRetry(false);
    }
  }
  const apollo = provider === 'apollo';
  // Chiesto esplicitamente dal dettaglio: un tentativo Apify recente senza dati non va saltato.
  const apifyRetry = p.enrichment_attempted_at !== null;
  const scope = { prospectIds: [p.id] };
  const apifyPreview = useJobPreview('enrich', { ...scope, retryFailed: apifyRetry }, { enabled: open && !apollo });
  const apolloPreview = useJobPreview('enrich', { ...scope, provider: 'apollo', retryFailed: apolloRetry }, { enabled: open && apollo });
  const apifyUnitPrice = useLastApifyUnitPrice(apifyPreview.data, apolloPreview.data);
  const start = useJobStart(
    () => api.enrich.startProspect(p.id, apollo ? { provider: 'apollo', retryFailed: apolloRetry } : { retryFailed: apifyRetry }),
    { onStarted: () => props.onOpenChange(false) },
  );
  const name = p.full_name ?? 'La persona';

  return (
    <JobPreviewDialog
      open={open}
      onOpenChange={props.onOpenChange}
      title="Arricchisci il profilo"
      description={
        apollo
          ? `${name}: cerca l'email di lavoro su Apollo. L'esito arriva nel banner laterale.`
          : `${name}: legge About, esperienze ed email pubblica da LinkedIn. L'esito arriva nel banner laterale.`
      }
      preview={apollo ? apolloPreview : apifyPreview}
      summary={apollo ? (data) => <ApolloEnrichSummary data={data} /> : undefined}
      countLabels={{
        targets: 'Da arricchire',
        skipped_enriched: 'Già arricchito (saltato)',
        skipped_fresh: 'Tentato di recente senza risultato (saltato)',
        not_found: 'Non trovato',
      }}
      startLabel="Avvia arricchimento"
      onStart={() => start.mutate()}
      starting={start.isPending}
    >
      <EnrichProviderField
        value={provider}
        onChange={(next) => {
          setProvider(next);
          setApolloRetry(false);
        }}
        apifyUnitPrice={apifyUnitPrice}
        disabled={start.isPending}
      />
      {apollo && <RetryFailedField provider="apollo" checked={apolloRetry} onCheckedChange={setApolloRetry} />}
    </JobPreviewDialog>
  );
}
