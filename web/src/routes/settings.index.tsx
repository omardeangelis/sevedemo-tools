import { createFileRoute, redirect } from '@tanstack/react-router';

/**
 * `/settings` non è una pagina: porta alla prima sezione conservando l'ancora (people-first-crm A5, P-24),
 * così i link scritti prima di T31 (`/settings#profilo`, `/settings#azienda`) continuano a funzionare.
 */
export const Route = createFileRoute('/settings/')({
  beforeLoad: ({ location }) => {
    throw redirect({ to: '/settings/profile', hash: location.hash || undefined, replace: true });
  },
});
