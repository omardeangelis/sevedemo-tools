import type { SetupKey } from '../api/types';

/*
 * Voci del promemoria "Da completare: …" (people-first-crm H7, FLOW H.1 e D.1): cosa manca alla configurazione, una
 * voce per requisito, ognuna con dove si completa. Quali mancano (e in che ordine) lo dice il server (`setup_missing` di
 * `/api/today`). Dopo T31–T32 i link sono quelli definitivi: profilo e azienda nella loro sezione, le chiavi in
 * Connessioni (P-24). Il promemoria (onboarding e Oggi, con "Nascondi") è `today/SetupAlerts`.
 */

export interface SetupItem {
  key: SetupKey;
  label: string;
  to: string;
  hash?: string;
}

/** Voce di configurazione per chiave (etichetta e dove si completa). */
export const SETUP_ITEMS: Record<SetupKey, SetupItem> = {
  profile: { key: 'profile', label: 'profilo LinkedIn', to: '/settings/profile', hash: 'profilo' },
  company: { key: 'company', label: 'descrizione della tua azienda', to: '/settings/profile', hash: 'azienda' },
  // own-profile-services G6: porta al bottone della generazione, non apre il dialog che spende.
  generate: { key: 'generate', label: 'genera profilo e servizi', to: '/settings/profile', hash: 'genera' },
  icp: { key: 'icp', label: 'un ICP', to: '/icps' },
  apify: { key: 'apify', label: 'APIFY_TOKEN nel .env', to: '/settings/connections' },
  anthropic: { key: 'anthropic', label: 'ANTHROPIC_API_KEY nel .env', to: '/settings/connections' },
  apollo: { key: 'apollo', label: 'APOLLO_API_KEY nel .env', to: '/settings/connections' },
};
