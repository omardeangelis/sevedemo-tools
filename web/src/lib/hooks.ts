import { useEffect, useState } from 'react';

/*
 * Hook piccoli condivisi dai dialog (preview con debounce, form che riparte a ogni apertura).
 */

const DEBOUNCE_MS = 300;

/** Valore "fermo" di una chiave serializzata: cambia dopo `DEBOUNCE_MS` senza modifiche. */
export function useDebouncedKey(key: string): [debounced: string, syncing: boolean] {
  const [debounced, setDebounced] = useState(key);
  useEffect(() => {
    if (key === debounced) return;
    const handle = setTimeout(() => setDebounced(key), DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [key, debounced]);
  return [debounced, key !== debounced];
}

/**
 * Nuova "sessione" a ogni apertura di un dialog: da usare come `key` del form, che si rimonta e rilegge i
 * valori iniziali (niente stato vecchio).
 *
 * @example
 * const session = useOpenSession(props.open);
 * return <MyForm key={session} {...props} />;
 */
export function useOpenSession(open: boolean): number {
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSession((s) => s + 1);
  }
  return session;
}
