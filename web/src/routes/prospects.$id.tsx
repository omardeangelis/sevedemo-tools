import { createFileRoute, redirect } from '@tanstack/react-router';

/** Vecchio indirizzo della scheda (people-first-crm A5): redirect `replace` a `/people/$id` con gli stessi parametri. */
export const Route = createFileRoute('/prospects/$id')({
  beforeLoad: ({ params, search }) => {
    throw redirect({ to: '/people/$id', params, search: search as never, replace: true });
  },
});
