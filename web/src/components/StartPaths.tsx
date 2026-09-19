import { useId, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { Building2Icon, RefreshCwIcon, UserPlusIcon, type LucideIcon } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import type { Readiness } from '../api/types';

/*
 * Le tre strade per portare dentro le prime persone (people-first-crm H8, B10, C11; FLOW H.1): a mano (sempre
 * attiva), sync delle interazioni ai propri post (serve il profilo LinkedIn), persone di un'azienda (serve un ICP).
 * Stesse card nell'onboarding di `/` e in Persone a CRM vuoto. Una strada bloccata resta visibile, disabilitata,
 * col requisito scritto e il link per soddisfarlo.
 */

/** Id della pagina "Nuovo ICP" (`/icps/nuovo`). */
const NEW_ICP = 'nuovo';

export function StartPaths({ readiness, onSync }: { readiness: Pick<Readiness, 'profile' | 'icp'>; onSync: () => void }) {
  return (
    <ul aria-label="Da dove partire" className="grid gap-4 md:grid-cols-3">
      <PathCard
        icon={UserPlusIcon}
        title="Aggiungi una persona a mano"
        text="Chi hai conosciuto a un evento o di persona: bastano il nome e un recapito."
      >
        <Link to="/people/new" className={buttonVariants()}>
          Aggiungi persona
        </Link>
      </PathCard>
      <PathCard
        icon={RefreshCwIcon}
        title="Sincronizza le interazioni ai tuoi post"
        text="Chi ha reagito o ha commentato i tuoi ultimi post LinkedIn."
        blocked={
          readiness.profile
            ? undefined
            : {
                reason: 'Serve il tuo profilo LinkedIn.',
                fix: (
                  <Link to="/settings" hash="profilo" className="font-medium underline underline-offset-2">
                    Salva il profilo
                  </Link>
                ),
              }
        }
        action={(describedBy) => (
          <Button type="button" variant="outline" onClick={onSync} disabled={!readiness.profile} aria-describedby={describedBy}>
            Sincronizza
          </Button>
        )}
      />
      <PathCard
        icon={Building2Icon}
        title="Cerca le persone di un'azienda"
        text="Le persone con i ruoli del tuo ICP in un'azienda target."
        blocked={
          readiness.icp
            ? undefined
            : {
                reason: "Serve un ICP: le persone trovate entrano in una lista dell'ICP.",
                fix: (
                  <Link to="/icps/$id" params={{ id: NEW_ICP }} className="font-medium underline underline-offset-2">
                    Crea ICP
                  </Link>
                ),
              }
        }
        action={(describedBy) =>
          readiness.icp ? (
            <Link to="/companies" search={{ add: 1 } as never} className={buttonVariants({ variant: 'outline' })}>
              Aggiungi un'azienda
            </Link>
          ) : (
            <Button type="button" variant="outline" disabled aria-describedby={describedBy}>
              Aggiungi un'azienda
            </Button>
          )
        }
      />
    </ul>
  );
}

function PathCard(props: {
  icon: LucideIcon;
  title: string;
  text: string;
  blocked?: { reason: string; fix: ReactNode };
  /** Azione della card; riceve l'id del requisito mancante (per `aria-describedby`). */
  action?: (describedBy: string | undefined) => ReactNode;
  children?: ReactNode;
}) {
  const uid = useId();
  const Icon = props.icon;
  const reasonId = props.blocked ? `${uid}-reason` : undefined;
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 text-left shadow-xs">
      <Icon className="size-5 text-slate-500" aria-hidden="true" />
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-slate-900">{props.title}</h2>
        <p className="text-sm text-slate-600">{props.text}</p>
      </div>
      <div className="mt-auto flex flex-col items-start gap-1.5">
        {props.action ? props.action(reasonId) : props.children}
        {props.blocked && (
          <p id={reasonId} className="text-xs text-slate-500">
            {props.blocked.reason} {props.blocked.fix}
          </p>
        )}
      </div>
    </li>
  );
}
