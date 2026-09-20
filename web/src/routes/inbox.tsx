import { createFileRoute, redirect } from '@tanstack/react-router';

/**
 * Vecchio indirizzo dell'Inbox (people-first-crm A4): redirect `replace` a Persone nella vista Da smistare con gli
 * stessi parametri (testo, fonte, post, ICP, fit, stato, ordinamento, pagina); con `status` che contiene `scartato`
 * apre la vista Scartate, senza il parametro `status`.
 */
export const Route = createFileRoute('/inbox')({
  beforeLoad: ({ search }) => {
    const { status, view: _view, ...rest } = search as Record<string, unknown>;
    const discarded = typeof status === 'string' && status.split(',').includes('scartato');
    const next = discarded
      ? { ...rest, view: 'scartate' }
      : { ...rest, view: 'da_smistare', ...(status !== undefined ? { status } : {}) };
    throw redirect({ to: '/people', search: next as never, replace: true });
  },
});
