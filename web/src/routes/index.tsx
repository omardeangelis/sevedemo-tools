import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { api, queryKeys } from '../api/client';
import { SetupReminder } from '../components/SetupReminder';
import { StartPaths } from '../components/StartPaths';
import { SyncDialog } from '../components/SyncDialog';
import { ErrorBox, Loading, PageHeader } from '../components/ui';

export const Route = createFileRoute('/')({ component: Home });

/**
 * Home di M1 (people-first-crm P-16, FLOW H.1): a CRM vuoto l'onboarding con le tre strade per portare dentro le
 * prime persone e il promemoria di cosa manca alla configurazione; con almeno una persona porta a Persone. In M2 la
 * home diventa Oggi.
 */
function Home() {
  const navigate = useNavigate();
  const [syncOpen, setSyncOpen] = useState(false);
  const settings = useQuery({ queryKey: queryKeys.settings, queryFn: api.settings.get });
  const hasPeople = settings.data?.readiness.prospects === true;

  useEffect(() => {
    if (hasPeople) void navigate({ to: '/people', replace: true });
  }, [hasPeople, navigate]);

  if (settings.isPending || hasPeople) return <Loading />;
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
      <PageHeader
        title="Porta dentro le prime persone"
        subtitle="Il CRM è vuoto. Scegli da dove partire: puoi usare tutte e tre le strade."
      />
      <div className="flex flex-col gap-4">
        <StartPaths readiness={readiness} onSync={() => setSyncOpen(true)} />
        <SetupReminder readiness={readiness} />
      </div>
      <SyncDialog open={syncOpen} onOpenChange={setSyncOpen} />
    </>
  );
}
