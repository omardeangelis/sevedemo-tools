import { Fragment } from 'react';
import { Link } from '@tanstack/react-router';
import type { Readiness } from '../api/types';

/*
 * Promemoria "Da completare: …" (people-first-crm H7, FLOW H.1 e D.1): cosa manca alla configurazione, una voce per
 * requisito, ognuna un link a dove si completa. Fino a M3 i link vanno a `/settings#…` (PLAN P-24). In Oggi (M2) si
 * aggiunge "Nascondi" (P-15).
 */

export interface SetupItem {
  key: 'profile' | 'company' | 'icp' | 'apify' | 'anthropic' | 'apollo';
  label: string;
  to: string;
  hash?: string;
}

/** Voci mancanti, nell'ordine in cui conviene completarle. */
export function missingSetup(r: Readiness): SetupItem[] {
  const items: Array<SetupItem | false> = [
    !r.profile && { key: 'profile', label: 'profilo LinkedIn', to: '/settings', hash: 'profilo' },
    !r.company && { key: 'company', label: 'descrizione della tua azienda', to: '/settings', hash: 'azienda' },
    !r.icp && { key: 'icp', label: 'un ICP', to: '/icps' },
    !r.apify && { key: 'apify', label: 'APIFY_TOKEN nel .env', to: '/settings' },
    !r.anthropic && { key: 'anthropic', label: 'ANTHROPIC_API_KEY nel .env', to: '/settings' },
    !r.apollo && { key: 'apollo', label: 'APOLLO_API_KEY nel .env', to: '/settings' },
  ];
  return items.filter((i): i is SetupItem => i !== false);
}

export function SetupReminder({ readiness }: { readiness: Readiness }) {
  const items = missingSetup(readiness);
  if (items.length === 0) return null;
  return (
    <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <span className="font-medium">Da completare:</span>{' '}
      {items.map((item, i) => (
        <Fragment key={item.key}>
          {i > 0 && ' · '}
          <Link to={item.to as never} hash={item.hash} className="underline underline-offset-2 hover:text-amber-800">
            {item.label}
          </Link>
        </Fragment>
      ))}
    </p>
  );
}
