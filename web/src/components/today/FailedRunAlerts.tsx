import { Link } from '@tanstack/react-router';
import type { FailedRunAlert } from '../../api/types';
import { useToday } from '../../lib/dates';
import { describeJobError } from '../../lib/jobs';
import { runStartText, toolNames } from '../runs/parts';

/*
 * Avvisi di Oggi sui run falliti (people-first-crm H5, FLOW D.1 e G.1): per ogni strumento il cui run più
 * recente è fallito **per lui** (J4), una riga con il motivo e il link al dettaglio. Un run che conta per
 * due strumenti sta in una riga sola. Il motivo è quello di ogni strumento: per un run riuscito con una fonte
 * fallita è l'errore della fonte, non del run (own-profile-services P-26).
 */

/** Il motivo di ogni strumento dell'avviso, una volta sola se è lo stesso (un run fallito lo dà a tutti). */
function reasons({ tools, run }: FailedRunAlert): string {
  const texts = tools.flatMap((tool) => run.tool_errors[tool] || []);
  return [...new Set(texts)].map((e) => describeJobError(e).message).join(' · ');
}

export function FailedRunAlerts({ alerts }: { alerts: FailedRunAlert[] }) {
  const today = useToday();
  if (alerts.length === 0) return null;
  return (
    <section aria-label="Avvisi sugli strumenti" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
      <ul className="flex flex-col gap-1.5 text-sm">
        {alerts.map((alert) => {
          const { tools, run } = alert;
          const reason = reasons(alert);
          return (
            <li key={run.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-red-900">
                <span className="font-medium">Ultimo run fallito per {toolNames(tools)}:</span> {run.operation},{' '}
                {runStartText(run.started_at, today)}
                {reason && ` — ${reason}`}
              </span>
              <Link
                to="/settings/connections/runs/$runId"
                params={{ runId: String(run.id) }}
                className="font-medium text-red-900 underline underline-offset-2"
              >
                Vedi dettagli
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
