import { useEffect, useId, useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { api } from '../api/client';
import type { EnrichCompaniesPreview, EnrichCompanyState, Job } from '../api/types';
import { useJobPreview, useJobStart } from '../lib/jobs';
import { JobPreviewDialog } from './JobPreviewDialog';

/*
 * "Arricchisci le referenze con Apollo" (apollo-lookalike T12a, FLOW A.1b, SPEC C1/C2/C5): elenco delle
 * referenze con lo stato Apollo, riga dei crediti sempre visibile (anche a 0), costo o "stima non
 * disponibile", spunta "Ritenta anche le non trovate", warning e blocker del server. Avvio →
 * `POST /api/icps/:id/enrich-companies`; l'esito lo notifica il `JobBanner`.
 * Con `companyId` (T15, SPEC C4) è "Arricchisci con Apollo" della singola azienda dal dettaglio: stessa
 * preview (1 credito) su `GET/POST /api/companies/:id/enrich-apollo`, blocker "Già arricchita il <data>" /
 * "Serve il sito web" dal server.
 */

const STATE_STYLE: Record<EnrichCompanyState, string> = {
  da_arricchire: 'bg-sky-100 text-sky-800',
  arricchita: 'bg-emerald-100 text-emerald-800',
  non_trovata: 'bg-amber-100 text-amber-900',
  in_conflitto: 'bg-amber-100 text-amber-900',
  senza_sito: 'bg-slate-100 text-slate-600',
};

const n = (value: number | undefined) => (value ?? 0).toLocaleString('it-IT');

interface EnrichCompaniesDialogBaseProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Dopo l'avvio (202): il dialog si chiude da solo. */
  onStarted?: (job: Job) => void;
}

export type EnrichCompaniesDialogProps = EnrichCompaniesDialogBaseProps &
  (
    | {
        /** Referenze dell'ICP (card "Aziende simili"). */
        icpId: number;
        companyId?: undefined;
        companyName?: undefined;
      }
    | {
        /** Singola azienda dal dettaglio ("Arricchisci con Apollo", SPEC C4). */
        companyId: number;
        /** Nome mostrato nel titolo. */
        companyName: string;
        icpId?: undefined;
      }
  );

export function EnrichCompaniesDialog(props: EnrichCompaniesDialogProps) {
  const { open, onOpenChange, onStarted } = props;
  const uid = useId();
  const [retryNotFound, setRetryNotFound] = useState(false);
  useEffect(() => {
    if (open) setRetryNotFound(false);
  }, [open]);

  const single = props.companyId !== undefined;
  const preview = useJobPreview(
    'enrich_companies',
    props.companyId !== undefined ? { companyId: props.companyId, retryNotFound } : { icpId: props.icpId, retryNotFound },
    { enabled: open },
  );
  const start = useJobStart(
    () =>
      props.companyId !== undefined
        ? api.companies.enrichApollo.start(props.companyId, { retryNotFound })
        : api.enrichCompanies.start(props.icpId, { retryNotFound }),
    {
      onStarted: (job) => {
        onOpenChange(false);
        onStarted?.(job);
      },
    },
  );

  return (
    <JobPreviewDialog
      open={open}
      onOpenChange={onOpenChange}
      title={single ? `Arricchisci ${props.companyName} con Apollo` : 'Arricchisci le referenze con Apollo'}
      description={
        single
          ? "Apollo aggiunge settore, parole chiave, dipendenti e sede all'azienda (1 credito se la trova): riempie solo i campi vuoti dell'anagrafica."
          : 'Apollo aggiunge settore, parole chiave, dipendenti e sede alle referenze con sito: sono i dati da cui derivano i filtri della ricerca di aziende simili.'
      }
      preview={{
        data: preview.data,
        // Mai i dati di un'apertura precedente (es. blocker "job in corso" ormai finito).
        isPending: preview.isPending || !preview.isFetchedAfterMount,
        isFetching: preview.isFetching,
        error: preview.error,
        refetch: preview.refetch,
      }}
      summary={(data) => <EnrichSummary data={data as EnrichCompaniesPreview} single={single} />}
      startLabel="Avvia arricchimento"
      starting={start.isPending}
      onStart={() => start.mutate()}
    >
      <label className="flex items-start gap-2 text-sm">
        <Checkbox
          checked={retryNotFound}
          onCheckedChange={(v) => setRetryNotFound(v === true)}
          disabled={start.isPending}
          aria-describedby={`${uid}-retry-hint`}
          className="mt-0.5"
        />
        <span>
          <span className="font-medium text-slate-900">Ritenta anche le non trovate (o in conflitto) di recente</span>
          <span id={`${uid}-retry-hint`} className="block text-slate-500">
            {single
              ? "Vale se l'azienda è già stata tentata senza esito negli ultimi giorni: se Apollo la trova, costa 1 credito."
              : 'Include le referenze già tentate senza esito negli ultimi giorni: se Apollo le trova, costano di nuovo.'}
          </span>
        </span>
      </label>
    </JobPreviewDialog>
  );
}

function EnrichSummary({ data, single = false }: { data: EnrichCompaniesPreview; single?: boolean }) {
  const c = data.counts;
  const credits = c.est_credits ?? 0;
  const toEnrich = c.to_enrich ?? 0;
  const items = data.items ?? [];
  const [one, many] = single ? ['azienda da arricchire', 'aziende da arricchire'] : ['referenza da arricchire', 'referenze da arricchire'];
  return (
    <div className="flex flex-col gap-2">
      {items.length > 0 && (
        <ul aria-label={single ? 'Azienda' : "Referenze dell'ICP"} className="flex flex-col gap-1 rounded-lg bg-slate-50 px-3 py-2 text-sm">
          {items.map((item) => (
            <li key={item.company_id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="min-w-0 text-slate-800">
                <span className="font-medium">{item.name ?? item.domain ?? `Azienda #${item.company_id}`}</span>
                {item.domain && item.name && <span className="text-slate-500"> ({item.domain})</span>}
              </span>
              <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', STATE_STYLE[item.state])}>
                {item.label}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-slate-700" data-testid="credits-line">
        <span className="font-medium">Crediti stimati:</span> {n(credits)} = {n(toEnrich)} {toEnrich === 1 ? one : many} (1 credito{' '}
        {single ? 'se Apollo la trova' : 'per referenza trovata su Apollo'})
        {(c.skipped_fresh ?? 0) > 0 &&
          ` · ${n(c.skipped_fresh)} ${c.skipped_fresh === 1 ? 'tentata di recente senza esito (saltata)' : 'tentate di recente senza esito (saltate)'}`}
        {(c.enriched ?? 0) > 0 &&
          ` · ${n(c.enriched)} ${c.enriched === 1 ? 'già arricchita (non si ripaga)' : 'già arricchite (non si ripagano)'}`}
      </p>
      {data.est_cost_usd === null && (
        <p className="text-xs text-slate-500">
          Imposta APOLLO_CREDIT_USD nel .env per vedere il costo; i crediti restano {n(credits)}.
        </p>
      )}
    </div>
  );
}
