import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { api, queryKeys } from '../../api/client';
import type { RunLogLine } from '../../api/types';
import { fmtCount } from '../../lib/format';

/*
 * Log di un run (people-first-crm J8–J11, FLOW G.4 e G.6): un elenco ordinato di righe con l'ora. A run
 * in corso le righe nuove arrivano da sole (polling con `after` = ultimo `seq` visto, niente ricarica);
 * se una lettura fallisce le righe già viste restano e si ritenta. Oltre il tetto il log è troncato al
 * centro: l'avviso dice quante righe mancano e il salto si vede nell'elenco.
 */

const POLL_MS = 2_000;

const LEVEL_CLS: Record<RunLogLine['level'], string> = {
  info: 'text-slate-700',
  warn: 'text-amber-900',
  error: 'text-red-800',
};

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function RunLog({ runId, running, logged }: { runId: number; running: boolean; logged: boolean }) {
  const [lines, setLines] = useState<RunLogLine[]>([]);

  const log = useQuery({
    queryKey: queryKeys.runLog(runId),
    // Chiede solo le righe dopo l'ultima vista: a run fermo la risposta è vuota e non si ridisegna niente.
    queryFn: () => api.runs.log(runId, lines.at(-1)?.seq ?? 0),
    enabled: logged,
    refetchInterval: running ? POLL_MS : false,
    retry: false,
    gcTime: 0,
  });

  useEffect(() => {
    const fresh = log.data?.lines ?? [];
    if (fresh.length === 0) return;
    setLines((prev) => [...prev, ...fresh.filter((line) => line.seq > (prev.at(-1)?.seq ?? 0))]);
  }, [log.data]);

  if (!logged) return <p className="px-4 py-4 text-sm text-slate-500">Log non disponibile per questo run.</p>;
  if (log.isPending && lines.length === 0) return <p className="px-4 py-4 text-sm text-slate-500">Caricamento del log…</p>;

  const omitted = log.data?.omitted ?? 0;
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      {omitted > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Log troncato: superava le 5.000 righe. Vedi l'inizio e la fine; omesse {fmtCount(omitted)} righe centrali.
        </p>
      )}
      {running && <p className="text-sm text-slate-600">In corso: il log si aggiorna da solo.</p>}
      {log.error && (
        <p role="status" className="text-sm text-amber-900">
          Log non aggiornato: nuovo tentativo tra pochi secondi.
        </p>
      )}
      {lines.length === 0 ? (
        <p className="text-sm text-slate-500">Nessuna riga: il run non ha ancora scritto niente.</p>
      ) : (
        /* `aria-live="off"`: le righe che arrivano da sole non vanno lette mentre si legge il resto. */
        <ol aria-live="off" className="max-h-[32rem] overflow-y-auto font-mono text-xs leading-relaxed">
          {lines.map((line, i) => {
            const gap = i > 0 && line.seq > lines[i - 1]!.seq + 1 ? line.seq - lines[i - 1]!.seq - 1 : 0;
            return (
              <li key={line.seq}>
                {gap > 0 && <p className="my-1 text-amber-900">… {fmtCount(gap)} righe omesse …</p>}
                <span className="flex gap-2">
                  <time dateTime={line.at} className="shrink-0 text-slate-400">
                    {timeOf(line.at)}
                  </time>
                  <span className={cn('min-w-0 break-words whitespace-pre-wrap', LEVEL_CLS[line.level])}>{line.message}</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
