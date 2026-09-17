import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { XIcon } from 'lucide-react';
import type { Job } from '../api/types';
import {
  JOB_KIND_LABELS,
  describeJobError,
  formatDuration,
  jobOutcomeLink,
  jobOutcomeTone,
  useCurrentJob,
  useRetryJob,
  type JobOutcomeTone,
} from '../lib/jobs';
import { dismissToast, toast } from './ui/toaster';
import { Spinner } from './ui';
import { cn } from '@/lib/utils';

/*
 * Esiti "già visti" sopravvivono al reload (localStorage, con fallback in memoria se non
 * disponibile): `notified` = ultimo job di cui è stato mostrato il toast, `dismissed` = ultimo job
 * il cui esito è stato chiuso dal banner o dal toast. Gli id dei job crescono sempre.
 */
const NOTIFIED_KEY = 'crm.jobs.notified';
const DISMISSED_KEY = 'crm.jobs.dismissed';
const memory = new Map<string, number>();

function readId(key: string): number {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw !== null) return Number(raw) || 0;
  } catch {
    // storage non disponibile: vale il fallback in memoria
  }
  return memory.get(key) ?? 0;
}

function writeId(key: string, id: number): void {
  memory.set(key, id);
  try {
    window.localStorage.setItem(key, String(id));
  } catch {
    // ignorato: il fallback in memoria basta per questa sessione
  }
}

const toastId = (jobId: number) => `job-outcome-${jobId}`;

const TONE_STYLE: Record<JobOutcomeTone, { box: string; prefix: string }> = {
  running: { box: 'border-slate-700 bg-slate-900 text-slate-200', prefix: 'In corso' },
  success: { box: 'border-emerald-800 bg-emerald-950 text-emerald-100', prefix: 'Completato' },
  neutral: { box: 'border-slate-700 bg-slate-900 text-slate-200', prefix: 'Completato' },
  warning: { box: 'border-amber-700 bg-amber-950 text-amber-100', prefix: 'Attenzione' },
  error: { box: 'border-red-800 bg-red-950 text-red-100', prefix: 'Errore' },
};

/**
 * Banner del job nella sidebar (FLOW B.3–B.4, "Error paths"): mostra il job in corso (kind +
 * durata, polling 2,5 s) e l'esito non ancora letto; a fine job invalida tutto il cache e mostra
 * **un solo** toast persistente per esito (`result.summary` + avvisi; errore attribuito per i
 * `failed`), senza ripeterlo ai reload. I `failed` hanno **Riprova** (stessi `params`). Chiudere
 * l'esito dal banner o dal toast lo segna come letto. Nessuna prop: va montato una volta nel layout.
 */
export function JobBanner() {
  const queryClient = useQueryClient();
  const current = useCurrentJob();
  const job = current.data?.job ?? null;
  const [dismissed, setDismissed] = useState(() => readId(DISMISSED_KEY));

  /** Segna come letto l'esito del job `jobId` (banner nascosto, toast chiuso). */
  const acknowledge = (jobId: number) => {
    writeId(DISMISSED_KEY, Math.max(readId(DISMISSED_KEY), jobId));
    setDismissed(readId(DISMISSED_KEY));
    dismissToast(toastId(jobId));
  };
  // "Riprova" legge l'esito fallito: il nuovo job in corso prende il suo posto nel banner.
  const retry = useRetryJob({ onStarted: (_job, failedJobId) => acknowledge(failedJobId) });

  // Fine di un job visto in corso: i dati di tutte le pagine sono cambiati → invalida il cache.
  const previous = useRef<Job | null>(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = job;
    if (before?.state === 'running' && job && job.state !== 'running') {
      void queryClient.invalidateQueries({ predicate: (q) => !(q.queryKey[0] === 'jobs' && q.queryKey[1] === 'current') });
    }
  }, [job, queryClient]);

  // Un toast per esito, una volta sola anche tra i reload (non per gli esiti già chiusi).
  useEffect(() => {
    if (!job || job.state === 'running' || job.id <= readId(NOTIFIED_KEY)) return;
    writeId(NOTIFIED_KEY, job.id);
    if (job.id > readId(DISMISSED_KEY)) notifyOutcome(job, () => acknowledge(job.id));
    // `acknowledge` usa solo storage e setter stabili: non serve tra le dipendenze.
  }, [job]);

  const [now, setNow] = useState(() => Date.now());
  const running = job?.state === 'running';
  useEffect(() => {
    if (!running) return;
    const handle = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(handle);
  }, [running]);

  const visible = job !== null && (running || job.id > dismissed);
  const tone = job ? jobOutcomeTone(job) : 'neutral';
  const style = TONE_STYLE[tone];

  return (
    <div role="status" aria-live="polite" className="px-3">
      {visible && job && (
        <div className={cn('rounded-lg border p-3 text-xs', style.box)} data-job-id={job.id} data-job-state={job.state}>
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold">
              {running && <Spinner className="mr-1.5 inline-block size-3 border-slate-500 border-t-white align-[-2px]" />}
              {style.prefix}: {JOB_KIND_LABELS[job.kind]}
            </p>
            {!running && (
              <button
                type="button"
                onClick={() => acknowledge(job.id)}
                aria-label="Chiudi esito del job"
                className="-mt-0.5 cursor-pointer rounded p-0.5 opacity-70 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
              >
                <XIcon className="size-3.5" />
              </button>
            )}
          </div>
          <p className="mt-0.5 tabular-nums opacity-80">
            {running
              ? `in corso · ${formatDuration(job.started_at, null, now)}`
              : `durata ${formatDuration(job.started_at, job.finished_at)}`}
          </p>
          {!running && <OutcomeBody job={job} />}
          {job.state === 'failed' && (
            <button
              type="button"
              onClick={() => retry.mutate(job.id)}
              disabled={retry.isPending}
              aria-busy={retry.isPending}
              className="mt-2 inline-flex cursor-pointer items-center rounded-md bg-white px-2 py-1 text-xs font-semibold text-red-900 hover:bg-red-50 disabled:opacity-60"
            >
              {retry.isPending ? 'Avvio…' : 'Riprova'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function OutcomeBody({ job }: { job: Job }) {
  const [expanded, setExpanded] = useState(false);
  if (job.state === 'failed') {
    const err = describeJobError(job.error);
    return (
      <p className="mt-1 break-words">
        {err.label && <span className="font-semibold">{err.label}: </span>}
        {err.message}
      </p>
    );
  }
  const summary = job.result?.summary ?? 'Job completato.';
  const warnings = job.result?.warnings ?? [];
  const link = jobOutcomeLink(job);
  const long = summary.length > 140;
  return (
    <div className="mt-1">
      <p className={cn('break-words', long && !expanded && 'line-clamp-4')}>{summary}</p>
      {long && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="mt-0.5 cursor-pointer underline opacity-80 hover:opacity-100"
        >
          {expanded ? 'Mostra meno' : 'Mostra tutto'}
        </button>
      )}
      {warnings.length > 0 && (
        <p className="mt-1 font-medium">
          {warnings.length === 1 ? '1 avviso' : `${warnings.length} avvisi`} (vedi notifica)
        </p>
      )}
      {link && (
        <Link to={link.to as never} className="mt-1.5 inline-block font-semibold underline">
          {link.label}
        </Link>
      )}
    </div>
  );
}

/** Toast persistente dell'esito: rosso per `failed` (con Riprova nel banner), ambra con avvisi, neutro a zero. */
function notifyOutcome(job: Job, onDismiss: () => void): void {
  const label = JOB_KIND_LABELS[job.kind];
  const tone = jobOutcomeTone(job);
  if (job.state === 'failed') {
    const err = describeJobError(job.error);
    toast({
      id: toastId(job.id),
      tone: 'error',
      title: `${label} non riuscito`,
      description: `${err.label ? `${err.label}: ` : ''}${err.message} Usa "Riprova" nel banner a sinistra.`,
      persistent: true,
      onDismiss,
    });
    return;
  }
  const warnings = job.result?.warnings ?? [];
  const link = jobOutcomeLink(job);
  toast({
    id: toastId(job.id),
    tone: tone === 'running' ? 'neutral' : tone,
    title: `${label} completato`,
    description: (
      <>
        <p>{job.result?.summary ?? 'Job completato.'}</p>
        {warnings.length > 0 && (
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
      </>
    ),
    action: link ? (
      <Link to={link.to as never} onClick={onDismiss} className="text-sm font-semibold underline">
        {link.label}
      </Link>
    ) : undefined,
    persistent: true,
    onDismiss,
  });
}
