import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import {
  ArrowLeftIcon,
  Building2Icon,
  ExternalLinkIcon,
  ListIcon,
  MessageCircleIcon,
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
import type { IcpListItem, Membership, ProspectDetail, ProspectList, ProspectPatch, Source, SourceKind } from '../api/types';
import { AnalysisCard } from '../components/AnalysisCard';
import { JobPreviewDialog } from '../components/JobPreviewDialog';
import { ListPicker } from '../components/ListPicker';
import { invalidateProspectViews, StatusSelect } from '../components/StatusSelect';
import { Timeline } from '../components/Timeline';
import { TouchpointForm } from '../components/TouchpointForm';
import { Card, ErrorBox, Loading } from '../components/ui';
import { toast } from '../components/ui/toaster';
import { fmtDateTime } from '../lib/format';
import { useJobPreview, useJobStart } from '../lib/jobs';

interface ProspectSearch {
  /** Lista di contesto: default del form touchpoint e dell'ICP dell'analisi. */
  list?: number;
}

export const Route = createFileRoute('/prospects/$id')({
  // `?list` non valido → ignorato (invariante: filtri invalidi nell'URL tornano al default).
  validateSearch: (search: Record<string, unknown>): ProspectSearch => {
    const list = Number(search.list);
    return Number.isInteger(list) && list > 0 ? { list } : {};
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
  const { list: listParam } = Route.useSearch();
  const id = Number(rawId);
  const validId = Number.isInteger(id) && id > 0;
  const prospect = useQuery({
    queryKey: queryKeys.prospect(id),
    queryFn: () => api.prospects.get(id),
    enabled: validId,
    retry: (count, err) => !(isApiError(err) && err.status === 404) && count < 1,
  });

  if (!validId || (isApiError(prospect.error) && prospect.error.status === 404)) return <ProspectNotFound />;
  if (prospect.data) return <ProspectView key={prospect.data.id} prospect={prospect.data} listParam={listParam} />;
  if (prospect.error) {
    return (
      <div className="flex flex-col items-start gap-3">
        <ErrorBox error={prospect.error} />
        <Button type="button" variant="outline" onClick={() => void prospect.refetch()}>
          Riprova
        </Button>
      </div>
    );
  }
  return <Loading />;
}

function ProspectNotFound() {
  return (
    <Card className="mx-auto mt-10 max-w-lg">
      <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <h1 className="text-lg font-semibold text-slate-900">Prospect non trovato</h1>
        <p className="text-sm text-slate-500">
          Il link potrebbe essere sbagliato, oppure la persona è stata unita a un altro prospect con lo stesso profilo
          LinkedIn.
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <Link to={'/inbox' as never} className={buttonVariants()}>
            Vai all'Inbox
          </Link>
          <Link to={'/lists' as never} className={buttonVariants({ variant: 'outline' })}>
            Apri le liste
          </Link>
        </div>
      </div>
    </Card>
  );
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

function ProspectView({ prospect: p, listParam }: { prospect: ProspectDetail; listParam?: number }) {
  const icps = useQuery({ queryKey: queryKeys.icpsIndex, queryFn: api.icps.list });
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
      <ProspectHeader prospect={p} contextList={paramList} contextListId={contextListId} />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card title="Anagrafica">
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
                <AnalysisCard prospectId={p.id} icpId={icpId} icpOptions={icpOptions} onIcpChange={setIcpChoice} />
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

function ProspectHeader(props: { prospect: ProspectDetail; contextList: Membership | null; contextListId: number | null }) {
  const { prospect: p, contextList } = props;
  const [adding, setAdding] = useState(false);
  const role = [p.title, p.company_name].filter(Boolean).join(' · ');

  return (
    <header className="mb-6 flex flex-col gap-4">
      <nav aria-label="Percorso" className="text-sm">
        {contextList ? (
          <Link to={`/lists/${contextList.list_id}` as never} className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-900">
            <ArrowLeftIcon className="size-3.5" aria-hidden="true" />
            {contextList.list_name}
          </Link>
        ) : (
          <Link
            to={(p.memberships.length === 0 ? '/inbox' : '/lists') as never}
            className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-900"
          >
            <ArrowLeftIcon className="size-3.5" aria-hidden="true" />
            {p.memberships.length === 0 ? 'Inbox' : 'Liste'}
          </Link>
        )}
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{p.full_name ?? 'Nome non disponibile'}</h1>
          {p.headline && <p className="mt-1 text-sm text-slate-700">{p.headline}</p>}
          {(role || p.location) && (
            <p className="mt-0.5 text-sm text-slate-500">
              {p.company_id && p.company_name ? (
                <>
                  {p.title && `${p.title} · `}
                  <Link to={`/companies/${p.company_id}` as never} className="underline underline-offset-2 hover:text-slate-900">
                    {p.company_name}
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
        <a href={p.linkedin_url} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'outline' })}>
          Apri su LinkedIn
          <ExternalLinkIcon aria-hidden="true" />
          <span className="sr-only">(si apre in una nuova scheda)</span>
        </a>
      </div>

      <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
        <StatusSelect prospectId={p.id} status={p.status} listId={props.contextListId} />

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium tracking-wide text-slate-500 uppercase" id={`lists-${p.id}`}>
            Liste
          </span>
          <ul aria-labelledby={`lists-${p.id}`} className="flex flex-wrap items-center gap-1.5">
            {p.memberships.length === 0 ? (
              <li>
                <span className="inline-flex items-center rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-800 ring-1 ring-sky-200 ring-inset">
                  In Inbox
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
            {p.full_name ?? 'Il prospect'} resta un'unica persona: stato e timeline valgono in tutte le sue liste.
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
  { key: 'company_name', label: 'Azienda' },
  { key: 'location', label: 'Località' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'phone', label: 'Telefono', type: 'tel' },
] as const;

type ProfileFieldKey = (typeof PROFILE_FIELDS)[number]['key'];

/** Cambia solo quando cambiano i campi dell'anagrafica (non con lo stato): il form si riallinea senza perdere modifiche. */
function fieldsKey(p: ProspectDetail): string {
  return JSON.stringify(PROFILE_FIELDS.map((f) => p[f.key]));
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

function ProfileFieldsForm({ prospect: p }: { prospect: ProspectDetail }) {
  const uid = useId();
  const initial = Object.fromEntries(PROFILE_FIELDS.map((f) => [f.key, p[f.key] ?? ''])) as Record<ProfileFieldKey, string>;
  const [values, setValues] = useState(initial);
  const patch = usePatchProspect(p.id);
  const changed = PROFILE_FIELDS.filter((f) => values[f.key].trim() !== initial[f.key]);
  const issues = issuesByField(patch.error);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (changed.length === 0) return;
    const body: ProspectPatch = Object.fromEntries(changed.map((f) => [f.key, values[f.key].trim() || null]));
    patch.mutate(body, { onSuccess: () => toast({ title: 'Anagrafica salvata' }) });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 p-4" noValidate aria-label="Anagrafica">
      <div className="grid gap-3 sm:grid-cols-2">
        {PROFILE_FIELDS.map((f) => (
          <div key={f.key} className={cn('flex flex-col gap-1', f.key === 'headline' && 'sm:col-span-2')}>
            <label htmlFor={`${uid}-${f.key}`} className="text-xs font-medium text-slate-600">
              {f.label}
            </label>
            <Input
              id={`${uid}-${f.key}`}
              type={'type' in f ? f.type : 'text'}
              value={values[f.key]}
              maxLength={500}
              onChange={(e) => setValues((cur) => ({ ...cur, [f.key]: e.target.value }))}
              aria-invalid={issues?.[f.key] ? true : undefined}
              aria-describedby={issues?.[f.key] ? `${uid}-${f.key}-error` : undefined}
              className="bg-white"
            />
            {issues?.[f.key] && (
              <p id={`${uid}-${f.key}-error`} className="text-xs text-red-700">
                {issues[f.key]}
              </p>
            )}
          </div>
        ))}
      </div>
      {patch.error && !issues && (
        <div role="alert">
          <ErrorBox error={patch.error} />
        </div>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={changed.length === 0 || patch.isPending} aria-busy={patch.isPending}>
          {patch.isPending ? 'Salvataggio…' : 'Salva'}
        </Button>
        {changed.length > 0 && !patch.isPending && (
          <Button type="button" size="sm" variant="ghost" onClick={() => setValues(initial)}>
            Annulla modifiche
          </Button>
        )}
        <p className="text-xs text-slate-500" aria-live="polite">
          {changed.length > 0 ? `${changed.length} ${changed.length === 1 ? 'campo modificato' : 'campi modificati'}` : ''}
        </p>
      </div>
    </form>
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
              <span className="text-slate-400"> · </span>
              <time dateTime={s.captured_at} className="text-slate-500">
                {shortDate(s.captured_at)}
              </time>
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
    default:
      return <span className="font-medium text-slate-900">Inserito a mano</span>;
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
        {!p.enriched_at && (
          <Button type="button" size="sm" variant="outline" onClick={() => setEnrichOpen(true)}>
            {p.enrichment_attempted_at ? 'Riprova arricchimento' : 'Arricchisci'}
          </Button>
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

/** Arricchimento del singolo prospect: stesso job e stessa anteprima dei bulk (esito nel JobBanner). */
function EnrichDialog(props: { prospect: ProspectDetail; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { prospect: p } = props;
  // Chiesto esplicitamente dal dettaglio: un tentativo recente senza dati non va saltato.
  const retryFailed = p.enrichment_attempted_at !== null;
  const preview = useJobPreview('enrich', { prospectIds: [p.id], retryFailed }, { enabled: props.open });
  const start = useJobStart(() => api.enrich.startProspect(p.id, { retryFailed }), {
    onStarted: () => props.onOpenChange(false),
  });

  return (
    <JobPreviewDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Arricchisci il profilo"
      description={`${p.full_name ?? 'Il prospect'}: legge About, esperienze ed email pubblica da LinkedIn. L'esito arriva nel banner laterale.`}
      preview={preview}
      countLabels={{
        targets: 'Da arricchire',
        skipped_enriched: 'Già arricchito (saltato)',
        skipped_fresh: 'Tentato di recente senza risultato (saltato)',
        not_found: 'Non trovato',
      }}
      startLabel="Avvia arricchimento"
      onStart={() => start.mutate()}
      starting={start.isPending}
    />
  );
}
