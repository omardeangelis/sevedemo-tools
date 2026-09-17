import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { api, queryKeys } from '../api/client';
import {
  CANDIDATE_STATUSES,
  SCORE_BUCKETS,
  type CandidateStatus,
  type IcpDetail,
  type LookalikeReference,
  type LookalikeRun,
} from '../api/types';
import { useJobPreview } from '../lib/jobs';
import { EnrichCompaniesDialog } from './EnrichCompaniesDialog';
import { LookalikeDialog, lookalikePreviewParams, rangeLabel, shortDay, type LookalikeDialogValues } from './LookalikeDialog';
import { Card, ErrorBox, Spinner } from './ui';

/*
 * Card "Aziende simili (Apollo)" della pagina ICP (apollo-lookalike T12a, FLOW A.1/A.1b, SPEC C1, D1,
 * D4, D14): stato delle referenze + "Arricchisci referenze", riga che anticipa il blocker noto della
 * ricerca, ultima ricerca con i conteggi delle candidate, "Ricerche precedenti" (chiuso) con la
 * distribuzione fascia × stato e "Riusa questi filtri", CTA "Trova aziende simili" sempre attiva.
 * T13: conteggi delle candidate cliccabili verso la sezione "Candidate" con il filtro (`?candidates=`), e
 * sull'ultima ricerca a zero (esito neutro, FLOW A.3) "Riprova con altri filtri" che riapre il dialog precompilato.
 * Dati: preview lookalike con i filtri derivati (stessa chiave del dialog), `lookalike/runs`, `candidates`.
 */

/** Id della sezione "Candidate" della pagina ICP (ancora dei conteggi cliccabili). */
export const CANDIDATES_SECTION_ID = 'candidate';

const nf = (value: number | undefined) => (value ?? 0).toLocaleString('it-IT');

const STATUS_PLURAL: Record<CandidateStatus, [string, string]> = {
  proposta: ['proposta', 'proposte'],
  accettata: ['accettata', 'accettate'],
  scartata: ['scartata', 'scartate'],
};

function count(n: number, one: string, many: string): string {
  return `${nf(n)} ${n === 1 ? one : many}`;
}

export function LookalikeCard({ icp }: { icp: IcpDetail }) {
  const uid = useId();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInitial, setSearchInitial] = useState<LookalikeDialogValues | undefined>(undefined);
  const [enrichOpen, setEnrichOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Stessa chiave del dialog aperto con i default: la preview si condivide (e si aggiorna a inizio/fine job).
  const preview = useJobPreview('lookalike_companies', lookalikePreviewParams(icp.id, {}));
  const runs = useQuery({ queryKey: queryKeys.lookalikeRuns(icp.id), queryFn: () => api.lookalike.runs(icp.id) });
  const candidates = useQuery({
    queryKey: queryKeys.candidates(icp.id, 'proposta'),
    queryFn: () => api.candidates.list(icp.id, 'proposta'),
  });

  const openSearch = (initial?: LookalikeDialogValues) => {
    setSearchInitial(initial);
    setSearchOpen(true);
  };

  const data = preview.data;
  const items = runs.data?.items ?? [];
  const lastRun = items[0];

  return (
    <Card
      title="Aziende simili (Apollo)"
      actions={
        <Button type="button" size="sm" onClick={() => openSearch()}>
          Trova aziende simili
        </Button>
      }
    >
      <div className="flex flex-col gap-3 px-4 py-3 text-sm" data-testid="lookalike-card">
        {preview.isPending ? (
          <p className="flex items-center gap-2 text-slate-500">
            <Spinner className="size-3.5 border-slate-300 border-t-slate-600" />
            Caricamento dello stato Apollo…
          </p>
        ) : preview.error ? (
          <div className="flex flex-col items-start gap-2">
            <ErrorBox error={preview.error} />
            <Button type="button" size="sm" variant="outline" onClick={() => void preview.refetch()}>
              Riprova
            </Button>
          </div>
        ) : (
          data && (
            <>
              <ReferencesLine references={data.references} onEnrich={() => setEnrichOpen(true)} />
              <StatusLine
                icpId={icp.id}
                references={data.references}
                blockers={data.blockers}
                lastRun={lastRun}
                runsLoading={runs.isPending}
                counts={candidates.data?.counts}
                onRetry={(run) => openSearch({ filters: run.filters, perPage: run.per_page, pages: run.pages })}
              />
            </>
          )
        )}

        {runs.error != null && (
          <p className="text-red-800">
            Ricerche precedenti non disponibili: {runs.error instanceof Error ? runs.error.message : 'errore inatteso.'}
          </p>
        )}

        {items.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-slate-100 pt-2">
            <button
              type="button"
              aria-expanded={historyOpen}
              aria-controls={`${uid}-history`}
              onClick={() => setHistoryOpen((v) => !v)}
              className="cursor-pointer self-start text-sm font-medium text-slate-700 underline-offset-2 hover:underline"
            >
              {historyOpen ? '▾' : '▸'} Ricerche precedenti ({items.length})
            </button>
            {historyOpen && (
              <ul id={`${uid}-history`} className="flex flex-col divide-y divide-slate-100" aria-label="Ricerche precedenti">
                {items.map((run) => (
                  <RunRow
                    key={run.id}
                    run={run}
                    zero={(run.counts.read ?? 0) === 0}
                    onReuse={() => openSearch({ filters: run.filters, perPage: run.per_page, pages: run.pages })}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <EnrichCompaniesDialog open={enrichOpen} onOpenChange={setEnrichOpen} icpId={icp.id} />
      <LookalikeDialog open={searchOpen} onOpenChange={setSearchOpen} icp={icp} initial={searchInitial} />
    </Card>
  );
}

/** "3 referenze · 2 con sito (1 arricchita, 1 da arricchire) · 1 senza sito" + "Arricchisci referenze" (FLOW A.1b). */
function ReferencesLine({ references, onEnrich }: { references: LookalikeReference[]; onEnrich: () => void }) {
  const by = (status: LookalikeReference['status']) => references.filter((r) => r.status === status);
  const withSite = references.filter((r) => r.status !== 'no_domain').length;
  const noSite = by('no_domain').length;
  const detail = [
    count(by('enriched').length, 'arricchita', 'arricchite'),
    `${nf(by('to_enrich').length)} da arricchire`,
    by('not_found').length > 0 && count(by('not_found').length, 'non trovata', 'non trovate'),
    by('key_conflict').length > 0 && `${nf(by('key_conflict').length)} con chiavi in conflitto`,
  ].filter((part): part is string => typeof part === 'string');
  const attempts = references.filter((r) => r.status === 'not_found' || r.status === 'key_conflict');

  return (
    <section aria-label="Referenze per Apollo" className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-slate-700" data-testid="references-line">
          {references.length === 0 ? (
            'Nessuna referenza: aggiungine una con il sito per derivare i filtri dalle aziende con cui hai lavorato.'
          ) : (
            <>
              {count(references.length, 'referenza', 'referenze')} · {nf(withSite)} con sito ({detail.join(', ')})
              {noSite > 0 && ` · ${nf(noSite)} senza sito`}
            </>
          )}
        </p>
        <Button type="button" size="sm" variant="outline" onClick={onEnrich}>
          Arricchisci referenze
        </Button>
      </div>
      {attempts.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs text-amber-900">
          {attempts.map((r) => (
            <li key={r.company_id}>
              {r.name ?? r.domain ?? `Azienda #${r.company_id}`}:{' '}
              {r.status === 'not_found' ? 'non trovata' : 'chiavi in conflitto'} il {shortDay(r.attempted_at)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Stato della ricerca: blocker anticipato (SPEC D4), "Mai eseguita…" o "Ultima ricerca…" con i conteggi (D1). */
function StatusLine(props: {
  icpId: number;
  references: LookalikeReference[];
  blockers: string[];
  lastRun: LookalikeRun | undefined;
  runsLoading: boolean;
  counts: Record<CandidateStatus, number> | undefined;
  onRetry: (run: LookalikeRun) => void;
}) {
  const { references, blockers, lastRun, counts } = props;
  const withSite = references.filter((r) => r.status !== 'no_domain').length;
  const anyCandidate = counts ? CANDIDATE_STATUSES.some((s) => counts[s] > 0) : false;
  return (
    <div className="flex flex-col gap-1" data-testid="lookalike-status">
      {blockers.length > 0 && (
        <p className="text-red-800">
          <span className="font-medium">Ricerca bloccata:</span> {blockers.join(' ')}
        </p>
      )}
      {!props.runsLoading && lastRun && (lastRun.counts.read ?? 0) === 0 && (
        <div className="flex flex-col items-start gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2" data-testid="lookalike-zero">
          <p className="text-slate-700">
            Nessuna azienda trovata con: {filtersText(lastRun)}. Allarga le fasce o togli la località.
          </p>
          <Button type="button" size="sm" variant="outline" onClick={() => props.onRetry(lastRun)}>
            Riprova con altri filtri
          </Button>
        </div>
      )}
      {props.runsLoading ? null : lastRun ? (
        <p className="text-slate-700">
          Ultima ricerca: {shortDay(lastRun.at)} · {nf(lastRun.counts.read)} lette ·{' '}
          {count(lastRun.counts.new_candidates ?? 0, 'nuova candidata', 'nuove candidate')}
          {counts && (
            <span className="block text-slate-600" data-testid="candidate-counts">
              {CANDIDATE_STATUSES.map((s, i) => (
                <span key={s}>
                  {i > 0 && ' · '}
                  {anyCandidate ? (
                    <Link
                      to="/icps/$id"
                      params={{ id: String(props.icpId) }}
                      search={{ candidates: s === 'proposta' ? undefined : s }}
                      hash={CANDIDATES_SECTION_ID}
                      resetScroll={false}
                      onClick={goToCandidates}
                      className="font-medium text-slate-800 underline underline-offset-2 hover:text-slate-950"
                      aria-label={`${STATUS_PLURAL[s][1]} ${nf(counts[s])}: apri le candidate ${STATUS_PLURAL[s][1]}`}
                    >
                      {STATUS_PLURAL[s][1]} {nf(counts[s])}
                    </Link>
                  ) : (
                    `${STATUS_PLURAL[s][1]} ${nf(counts[s])}`
                  )}
                </span>
              ))}
            </span>
          )}
        </p>
      ) : withSite === 0 ? (
        <p className="text-slate-700">Mai eseguita. Nessuna referenza con sito: i filtri derivano solo dall'ICP.</p>
      ) : (
        <p className="text-slate-700">
          Mai eseguita. Usa le referenze con sito ({nf(withSite)} di {nf(references.length)}) per cercare aziende simili su
          Apollo.
        </p>
      )}
    </div>
  );
}

/** Porta la sezione "Candidate" in vista e le dà il focus (titolo) dopo il cambio di filtro nell'URL. */
function goToCandidates() {
  setTimeout(() => {
    const section = document.getElementById(CANDIDATES_SECTION_ID);
    section?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    section?.querySelector<HTMLElement>('h2 [tabindex="-1"]')?.focus({ preventScroll: true });
  }, 50);
}

/** Filtri di una ricerca in una riga: "hr tech, saas · 1–10, 11–20 · Milano". */
function filtersText(run: LookalikeRun): string {
  const parts = [
    run.filters.keywords.join(', '),
    run.filters.ranges.map(rangeLabel).join(', ') && `${run.filters.ranges.map(rangeLabel).join(', ')} dipendenti`,
    run.filters.locations.join(', '),
  ].filter((p) => p !== '');
  return parts.length > 0 ? parts.join(' · ') : 'nessun filtro';
}

/** "40 proposte · basso 30 (30 scartate) · medio 7 (7 scartate) · alto 3 (2 accettate, 1 proposta) · 2 senza località". */
function distributionText(run: LookalikeRun): string {
  const { stats } = run;
  const buckets = SCORE_BUCKETS.map((bucket) => {
    const byStatus = stats.buckets[bucket];
    const total = CANDIDATE_STATUSES.reduce((sum, s) => sum + (byStatus?.[s] ?? 0), 0);
    const detail = CANDIDATE_STATUSES.filter((s) => (byStatus?.[s] ?? 0) > 0).map((s) =>
      count(byStatus[s], STATUS_PLURAL[s][0], STATUS_PLURAL[s][1]),
    );
    return `${bucket} ${nf(total)}${detail.length > 0 ? ` (${detail.join(', ')})` : ''}`;
  });
  return [
    count(stats.proposed, 'proposta', 'proposte'),
    ...buckets,
    stats.without_location > 0 && `${nf(stats.without_location)} senza località`,
  ]
    .filter((p): p is string => typeof p === 'string')
    .join(' · ');
}

function RunRow({ run, zero, onReuse }: { run: LookalikeRun; zero: boolean; onReuse: () => void }) {
  const pagesRead = run.counts.pages_read ?? 0;
  return (
    <li className="flex flex-col gap-1 py-2" data-run-id={run.id}>
      <p className="text-slate-800">
        <span className="font-medium">{shortDay(run.at)}</span> · {filtersText(run)}
      </p>
      <p className="text-xs text-slate-600">
        {nf(run.counts.read)} lette · {count(run.counts.new_candidates ?? 0, 'nuova candidata', 'nuove candidate')} ·{' '}
        {count(pagesRead, 'pagina letta', 'pagine lette')} da {run.per_page}
      </p>
      <p className="text-xs text-slate-600">{distributionText(run)}</p>
      <div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onReuse}
          aria-label={`${zero ? 'Riprova con altri filtri' : 'Riusa questi filtri'} (ricerca del ${shortDay(run.at)})`}
        >
          {zero ? 'Riprova con altri filtri' : 'Riusa questi filtri'}
        </Button>
      </div>
    </li>
  );
}
