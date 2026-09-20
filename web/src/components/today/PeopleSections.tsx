import { useId } from 'react';
import { Link } from '@tanstack/react-router';
import type { PersonRef } from '../../api/types';
import { countText } from '../../lib/format';
import { relativeDay } from '../../lib/dates';

/*
 * Da smistare e Ultime persone aggiunte di Oggi (people-first-crm H4, FLOW D.1): il numero delle persone da smistare
 * con il link alla vista, e le ultime 10 persone per data di aggiunta con fonte e data (*"Luca Bassi · Nuvola ·
 * Aggiunta a mano · ieri"*).
 */

export function ToTriageSection({ count }: { count: number }) {
  const uid = useId();
  return (
    <section aria-labelledby={`${uid}-title`} className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <h2 id={`${uid}-title`} className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">
        Da smistare
      </h2>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
        {count === 0 ? (
          <p className="text-slate-500">Niente da smistare.</p>
        ) : (
          <>
            <p className="text-slate-800">
              {countText(count, 'persona da smistare', 'persone da smistare')}
            </p>
            <Link to="/people" search={{ view: 'da_smistare' } as never} className="font-medium text-slate-900 underline underline-offset-2">
              Apri Da smistare
            </Link>
          </>
        )}
      </div>
    </section>
  );
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function RecentSection({ people, today }: { people: Array<PersonRef & { created_at: string }>; today: string }) {
  const uid = useId();
  return (
    <section aria-labelledby={`${uid}-title`} className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h2 id={`${uid}-title`} className="text-sm font-semibold text-slate-700">
          Ultime persone aggiunte
        </h2>
        <Link to="/people" search={{ sort: 'added' } as never} className="text-sm font-medium text-slate-900 underline underline-offset-2">
          Vedi tutte in Persone
        </Link>
      </header>
      {people.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-500">Qui compaiono le ultime persone entrate nel CRM.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {people.map((p) => (
            <li key={p.id} className="px-4 py-2 text-sm text-slate-600">
              <Link to="/people/$id" params={{ id: String(p.id) }} search={{ from: '/' } as never} className="font-medium text-slate-900 underline-offset-2 hover:underline">
                {p.full_name ?? 'Senza nome'}
              </Link>
              {[p.company_name, p.first_source && capitalize(p.first_source.label), relativeDay(p.created_at, today)]
                .filter(Boolean)
                .map((part) => ` · ${part}`)
                .join('')}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
