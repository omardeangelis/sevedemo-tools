import { useEffect, useId, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { TodayAction } from '../../api/types';
import { fmtCount } from '../../lib/format';
import { fmtWeekday, nextActionDateText } from '../../lib/dates';
import { actionName, PostponeMenu, useCompleteNextAction, usePostponeNextAction, writeError } from '../NextActionActions';

/*
 * Da fare e In arrivo di Oggi (people-first-crm H2, H3, G3–G5, FLOW D.1–D.3): una riga per prossima azione con lo
 * stato in testo (*"Scaduta · lun 15 set"* / *"Oggi"*), cosa fare, la persona (link con origine Oggi, A7) e
 * l'azienda; in Da fare **Fatto** e **Rimanda ▾** senza aprire la scheda. Dopo Fatto/Rimanda (anche "cambiata
 * altrove") il focus va sul Fatto della riga che ha preso il posto di quella tolta, o sul titolo della sezione se è
 * vuota; un errore resta nella riga, col focus sul bottone.
 */

/** Origine della scheda aperta da Oggi (A7: "← Oggi"). */
const FROM_TODAY = { from: '/' };

function PersonLink({ row }: { row: TodayAction }) {
  return (
    <Link to="/people/$id" params={{ id: String(row.id) }} search={FROM_TODAY as never} className="font-medium text-slate-900 underline-offset-2 hover:underline">
      {row.full_name ?? 'Senza nome'}
    </Link>
  );
}

function CompanyText({ row }: { row: TodayAction }) {
  if (!row.company_name) return null;
  return row.company_id !== null ? (
    <Link to="/companies/$id" params={{ id: String(row.company_id) }} className="text-slate-600 underline-offset-2 hover:underline">
      {row.company_name}
    </Link>
  ) : (
    <span className="text-slate-600">{row.company_name}</span>
  );
}

export function DueSection({ rows, today, refetching }: { rows: TodayAction[]; today: string; refetching: boolean }) {
  const uid = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [refocus, setRefocus] = useState<number | null>(null);
  const rowIndex = (id: number) => rows.findIndex((r) => r.id === id);
  const complete = useCompleteNextAction({ onChanged: (t) => setRefocus(rowIndex(t.id)) });
  const postpone = usePostponeNextAction({ onChanged: (t) => setRefocus(rowIndex(t.id)) });

  // Righe aggiornate dopo Fatto/Rimanda: focus sul Fatto della riga successiva (ora allo stesso indice) o sul titolo.
  useEffect(() => {
    if (refocus === null || refetching) return;
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('[data-done]') ?? [];
    (buttons[refocus] ?? titleRef.current)?.focus();
    setRefocus(null);
  }, [rows, refetching, refocus]);

  const busy = complete.isPending || postpone.isPending;
  const completeError = writeError(complete.error, 'Fatto');
  const postponeError = writeError(postpone.error, 'Rimanda');
  return (
    <section aria-labelledby={`${uid}-title`} className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <h2 id={`${uid}-title`} ref={titleRef} tabIndex={-1} className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-700 outline-none">
        Da fare ({fmtCount(rows.length)})
      </h2>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-500">Niente da fare oggi. Qui compaiono le prossime azioni scadute e di oggi.</p>
      ) : (
        <ul ref={listRef} className="divide-y divide-slate-100">
          {rows.map((row, index) => {
            const error =
              (complete.variables?.id === row.id && completeError) || (postpone.variables?.target.id === row.id && postponeError) || null;
            return (
              <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 text-sm">
                <time
                  dateTime={row.next_action_on}
                  className={cn('w-36 shrink-0 font-semibold', row.next_action_state === 'scaduta' ? 'text-red-700' : 'text-amber-800')}
                >
                  {nextActionDateText(row.next_action_on, today)}
                </time>
                <span className="min-w-0 flex-1">
                  {row.next_action_text && <span className="text-slate-800">{row.next_action_text} · </span>}
                  <PersonLink row={row} />
                  {row.company_name && (
                    <>
                      {' · '}
                      <CompanyText row={row} />
                    </>
                  )}
                </span>
                <span className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    size="xs"
                    data-done
                    aria-disabled={busy}
                    aria-busy={complete.isPending && complete.variables?.id === row.id}
                    aria-label={`Fatto: ${actionName(row)}`}
                    onClick={() => {
                      if (busy) return;
                      postpone.reset();
                      complete.mutate(row, { onSuccess: () => setRefocus(index) });
                    }}
                  >
                    Fatto
                  </Button>
                  <PostponeMenu
                    target={row}
                    today={today}
                    busy={busy}
                    onPick={(on) => {
                      complete.reset();
                      postpone.mutate({ target: row, on }, { onSuccess: () => setRefocus(index) });
                    }}
                  />
                </span>
                {error && (
                  <p role="alert" className="w-full text-xs text-red-700">
                    {error}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function UpcomingSection({ rows }: { rows: TodayAction[] }) {
  const uid = useId();
  return (
    <section aria-labelledby={`${uid}-title`} className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <h2 id={`${uid}-title`} className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">
        In arrivo · prossimi 7 giorni ({fmtCount(rows.length)})
      </h2>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-500">Nessuna prossima azione nei prossimi 7 giorni.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-x-3 px-4 py-2.5 text-sm">
              <time dateTime={row.next_action_on} className="w-36 shrink-0 font-medium text-slate-700">
                {fmtWeekday(row.next_action_on)}
              </time>
              <span className="min-w-0 flex-1">
                <PersonLink row={row} />
                {row.company_name && (
                  <>
                    {' · '}
                    <CompanyText row={row} />
                  </>
                )}
                {row.next_action_text && <span className="text-slate-700"> · {row.next_action_text}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
