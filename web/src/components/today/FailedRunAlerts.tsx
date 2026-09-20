import { Link } from '@tanstack/react-router';
import type { FailedRunAlert } from '../../api/types';
import { useToday } from '../../lib/dates';
import { describeJobError } from '../../lib/jobs';
import { runStartText, toolNames } from '../runs/parts';

/*
 * Avvisi di Oggi sui run falliti (people-first-crm H5, FLOW D.1 e G.1): per ogni strumento il cui run più
 * recente è fallito **per lui** (J4), una riga con il motivo e il link al dettaglio. Un run che conta per
 * due strumenti sta in una riga sola.
 */

export function FailedRunAlerts({ alerts }: { alerts: FailedRunAlert[] }) {
  const today = useToday();
  if (alerts.length === 0) return null;
  return (
    <section aria-label="Avvisi sugli strumenti" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
      <ul className="flex flex-col gap-1.5 text-sm">
        {alerts.map(({ tools, run }) => (
          <li key={run.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-red-900">
              <span className="font-medium">Ultimo run fallito per {toolNames(tools)}:</span> {run.operation},{' '}
              {runStartText(run.started_at, today)}
              {run.error ? ` — ${describeJobError(run.error).message}` : ''}
            </span>
            <Link
              to="/settings/connections/runs/$runId"
              params={{ runId: String(run.id) }}
              className="font-medium text-red-900 underline underline-offset-2"
            >
              Vedi dettagli
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
