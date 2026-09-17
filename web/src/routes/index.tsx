import { useEffect, useId, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { CheckIcon } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { api, queryKeys } from '../api/client';
import type { IcpListItem, Readiness } from '../api/types';
import { SyncDialog, shortProfileUrl } from '../components/SyncDialog';
import { Card, ErrorBox, Loading, PageHeader } from '../components/ui';

export const Route = createFileRoute('/')({ component: Home });

type StepStatus = 'done' | 'active' | 'todo';

/**
 * Home = **Onboarding a 3 passi** (FLOW A.1): profilo e azienda → primo ICP → prime persone (sync
 * o azienda). Lo stato viene da `settings.readiness`; quando i tre passi sono fatti (profilo, ICP e
 * almeno un prospect) la home porta all'Inbox.
 */
function Home() {
  const navigate = useNavigate();
  const settings = useQuery({ queryKey: queryKeys.settings, queryFn: api.settings.get });
  const readiness = settings.data?.readiness;
  const icps = useQuery({ queryKey: queryKeys.icpsIndex, queryFn: api.icps.list, enabled: readiness?.icp === true });
  const complete = Boolean(readiness?.profile && readiness.icp && readiness.prospects);

  useEffect(() => {
    if (complete) void navigate({ to: '/inbox' as never, replace: true });
  }, [complete, navigate]);

  if (settings.isPending || complete) return <Loading />;
  if (settings.error) {
    return (
      <div className="flex flex-col items-start gap-3">
        <ErrorBox error={settings.error} />
        <Button type="button" variant="outline" onClick={() => void settings.refetch()}>
          Riprova
        </Button>
      </div>
    );
  }

  const r = settings.data.readiness;
  const done = [r.profile, r.icp, r.prospects];
  const firstOpen = done.indexOf(false);
  const status = (i: number): StepStatus => (done[i] ? 'done' : i === firstOpen ? 'active' : 'todo');

  return (
    <>
      <PageHeader
        title="Il tuo CRM di prospecting"
        subtitle="Tre passi per portare dentro le prime persone e iniziare a contattarle."
      />
      <Card>
        <ol aria-label="Passi per iniziare" className="divide-y divide-slate-100">
          <Step
            n={1}
            status={status(0)}
            title="Salva il tuo profilo LinkedIn e descrivi la tua azienda"
            summary={settings.data.own_profile_url ? shortProfileUrl(settings.data.own_profile_url) : null}
            note={
              r.profile && !r.company ? 'Descrizione azienda vuota: gli angoli AI saranno meno mirati.' : undefined
            }
            hint="Il profilo serve a leggere chi reagisce e commenta i tuoi post; la descrizione dell'azienda guida l'analisi AI."
          >
            <Link to={'/settings' as never} className={buttonVariants({ variant: status(0) === 'done' ? 'outline' : 'default' })}>
              Apri Impostazioni
            </Link>
          </Step>

          <Step
            n={2}
            status={status(1)}
            title="Crea il tuo primo ICP"
            summary={r.icp ? icpSummary(icps.data?.items) : null}
            hint="Il profilo cliente ideale: ruoli, settori e aziende di riferimento. Ogni lista appartiene a un ICP."
          >
            <Link to={'/icps' as never} className={buttonVariants({ variant: status(1) === 'done' ? 'outline' : 'default' })}>
              {r.icp ? 'Apri ICP' : 'Crea ICP'}
            </Link>
          </Step>

          <Step
            n={3}
            status={status(2)}
            title="Porta dentro le prime persone"
            hint="Due strade, entrambe valide: chi interagisce con i tuoi post oppure le persone di un'azienda target."
          >
            <ImportActions readiness={r} />
          </Step>
        </ol>
      </Card>
      <ConfigNotice readiness={r} />
    </>
  );
}

function icpSummary(items: IcpListItem[] | undefined): string | null {
  if (!items || items.length === 0) return null;
  if (items.length === 1) {
    const roles = items[0].target_roles.length;
    return `${items[0].name} · ${roles} ${roles === 1 ? 'ruolo' : 'ruoli'}`;
  }
  return `${items.length} ICP: ${items.map((i) => i.name).join(', ')}`;
}

function Step(props: {
  n: number;
  status: StepStatus;
  title: string;
  summary?: string | null;
  note?: string;
  hint?: string;
  children: ReactNode;
}) {
  const { status } = props;
  return (
    <li aria-current={status === 'active' ? 'step' : undefined} className="flex gap-4 px-5 py-5">
      <span
        aria-hidden="true"
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
          status === 'done' && 'bg-emerald-100 text-emerald-700',
          status === 'active' && 'bg-slate-900 text-white',
          status === 'todo' && 'border border-slate-300 text-slate-500',
        )}
      >
        {status === 'done' ? <CheckIcon className="size-4" /> : props.n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div>
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
            Passo {props.n} · {status === 'done' ? 'Fatto' : 'Da fare'}
          </p>
          <h2 className={cn('text-base font-semibold', status === 'todo' ? 'text-slate-600' : 'text-slate-900')}>
            {props.n}. {props.title}
          </h2>
          {status === 'done' && props.summary && <p className="text-sm text-slate-600">{props.summary}</p>}
          {status !== 'done' && props.hint && <p className="text-sm text-slate-500">{props.hint}</p>}
          {props.note && <p className="mt-1 text-sm text-amber-800">{props.note}</p>}
        </div>
        <div className="flex flex-wrap items-start gap-3">{props.children}</div>
      </div>
    </li>
  );
}

/** Passo 3: sync (richiede il profilo) oppure azienda (richiede un ICP). Disabilitati con il motivo scritto. */
function ImportActions({ readiness }: { readiness: Readiness }) {
  const [syncOpen, setSyncOpen] = useState(false);
  const syncHint = useId();
  const companyHint = useId();
  return (
    <>
      <div className="flex flex-col gap-1">
        <Button
          type="button"
          onClick={() => setSyncOpen(true)}
          disabled={!readiness.profile}
          aria-describedby={readiness.profile ? undefined : syncHint}
        >
          Sincronizza le interazioni ai miei post
        </Button>
        {!readiness.profile && (
          <p id={syncHint} className="text-xs text-slate-500">
            Salva prima il tuo profilo LinkedIn.
          </p>
        )}
      </div>
      <span className="self-center text-sm text-slate-400">oppure</span>
      <div className="flex flex-col gap-1">
        {readiness.icp ? (
          <Link to={'/companies' as never} search={{ add: 1 } as never} className={buttonVariants({ variant: 'outline' })}>
            Aggiungi un'azienda e cerca le persone
          </Link>
        ) : (
          <>
            <Button type="button" variant="outline" disabled aria-describedby={companyHint}>
              Aggiungi un'azienda e cerca le persone
            </Button>
            <p id={companyHint} className="text-xs text-slate-500">
              Crea prima un ICP: le persone finiscono in una lista dell'ICP.
            </p>
          </>
        )}
      </div>
      <SyncDialog open={syncOpen} onOpenChange={setSyncOpen} />
    </>
  );
}

/** Token mancanti: non bloccano l'onboarding, ma i job resteranno bloccati in anteprima. */
function ConfigNotice({ readiness }: { readiness: Readiness }) {
  const missing = [
    !readiness.apify && 'APIFY_TOKEN mancante nel .env: sync, sourcing e arricchimento resteranno bloccati.',
    !readiness.anthropic && 'ANTHROPIC_API_KEY mancante nel .env: l\'analisi AI resterà bloccata.',
    !readiness.apollo &&
      'APOLLO_API_KEY mancante nel .env: aziende simili, contatti ed email via Apollo resteranno bloccati.',
  ].filter((m): m is string => typeof m === 'string');
  if (missing.length === 0) return null;
  return (
    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <p className="font-medium">Configurazione</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {missing.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
      <p className="mt-1 text-amber-800">Aggiungi le chiavi al file .env e riavvia il server.</p>
    </div>
  );
}
