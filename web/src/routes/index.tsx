import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { UserPlusIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, queryKeys } from '../api/client';
import type { SetupKey } from '../api/types';
import { StartPaths } from '../components/StartPaths';
import { SyncDialog } from '../components/SyncDialog';
import { DueSection, UpcomingSection } from '../components/today/ActionSections';
import { RecentSection, ToTriageSection } from '../components/today/PeopleSections';
import { FailedRunAlerts } from '../components/today/FailedRunAlerts';
import { SetupAlerts } from '../components/today/SetupAlerts';
import { ErrorBox, Loading, PageHeader } from '../components/ui';
import { fmtLongDay, useToday } from '../lib/dates';

export const Route = createFileRoute('/')({ component: Home });

/**
 * Home (people-first-crm H1, H8; chiude TD-38): con almeno una persona (anche scartata) **Oggi**, senza redirect; a
 * CRM vuoto l'onboarding con le tre strade per portare dentro le prime persone e il promemoria di cosa manca.
 * "Oggi" è quello del computer dell'utente e si ricalcola quando la pagina torna visibile (`useToday`).
 */
function Home() {
  const today = useToday();
  const data = useQuery({ queryKey: queryKeys.today(today), queryFn: () => api.today(today) });

  if (data.isPending) return <Loading />;
  if (data.error) {
    return (
      <div className="flex flex-col items-start gap-3">
        <ErrorBox error={data.error} />
        <Button type="button" variant="outline" onClick={() => void data.refetch()}>
          Riprova
        </Button>
      </div>
    );
  }
  if (data.data.empty) return <Onboarding missing={data.data.setup_missing} />;

  const t = data.data;
  return (
    <>
      <PageHeader
        title="Oggi"
        subtitle={fmtLongDay(today)}
        actions={
          <Button asChild>
            <Link to="/people/new">
              <UserPlusIcon aria-hidden="true" />
              Aggiungi persona
            </Link>
          </Button>
        }
      />
      <div className="flex flex-col gap-6">
        <FailedRunAlerts alerts={t.failed_runs} />
        {t.setup_missing.length > 0 && <SetupAlerts missing={t.setup_missing} />}
        <DueSection rows={t.due} today={today} refetching={data.isFetching} />
        <UpcomingSection rows={t.upcoming} />
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <ToTriageSection count={t.to_triage} />
          <RecentSection people={t.recent} today={today} />
        </div>
      </div>
    </>
  );
}

/** Onboarding a CRM vuoto (H8, FLOW H.1): tre strade, la manuale sempre attiva, e cosa manca alla configurazione. */
function Onboarding({ missing }: { missing: SetupKey[] }) {
  const [syncOpen, setSyncOpen] = useState(false);
  const settings = useQuery({ queryKey: queryKeys.settings, queryFn: api.settings.get });
  if (settings.isPending) return <Loading />;
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
  const readiness = settings.data.readiness;
  return (
    <>
      <PageHeader title="Porta dentro le prime persone" subtitle="Il CRM è vuoto. Scegli da dove partire: puoi usare tutte e tre le strade." />
      <div className="flex flex-col gap-4">
        <StartPaths readiness={readiness} onSync={() => setSyncOpen(true)} />
        {/* Lo stesso promemoria di Oggi, con "Nascondi" (FLOW H.1). */}
        <SetupAlerts missing={missing} />
      </div>
      <SyncDialog open={syncOpen} onOpenChange={setSyncOpen} />
    </>
  );
}
