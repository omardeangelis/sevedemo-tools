import { Fragment } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowLeftIcon } from 'lucide-react';

/*
 * Percorso in testa a ogni dettaglio (people-first-crm A6): "Persone › Mario Rossi", segmenti link tranne l'ultimo
 * (`aria-current="page"`). `back` = "← <origine>" davanti al percorso (A7: da lista, azienda o Oggi), letto
 * "Torna a <origine>".
 */

export interface Crumb {
  label: string;
  /** Path interno; assente = segmento corrente. */
  to?: string;
  search?: Record<string, unknown>;
}

export function Breadcrumbs({ items, back }: { items: Crumb[]; back?: Crumb & { to: string } }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      {back && (
        <Link
          to={back.to as never}
          search={back.search as never}
          activeOptions={{ exact: true, includeSearch: true }}
          aria-label={`Torna a ${back.label}`}
          className="inline-flex items-center gap-1 font-medium text-slate-600 hover:text-slate-900"
        >
          <ArrowLeftIcon className="size-3.5" aria-hidden="true" />
          {back.label}
        </Link>
      )}
      <nav aria-label="Percorso">
        <ol className="flex flex-wrap items-center gap-1.5 text-slate-500">
          {items.map((item, i) => (
            <Fragment key={i}>
              {i > 0 && (
                <li aria-hidden="true" className="text-slate-400">
                  ›
                </li>
              )}
              <li>
                {item.to && i < items.length - 1 ? (
                  <Link
                    to={item.to as never}
                    search={item.search as never}
                    activeOptions={{ exact: true, includeSearch: true }}
                    className="hover:text-slate-900 hover:underline"
                  >
                    {item.label}
                  </Link>
                ) : (
                  <span aria-current="page" className="text-slate-700">
                    {item.label}
                  </span>
                )}
              </li>
            </Fragment>
          ))}
        </ol>
      </nav>
    </div>
  );
}
