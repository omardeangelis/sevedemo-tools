import { Fragment, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { XIcon } from 'lucide-react';
import type { SetupKey } from '../../api/types';
import { focusOrPageTitle } from '../../lib/focus';
import { SETUP_ITEMS } from '../SetupReminder';

/*
 * Promemoria compatto della configurazione in Oggi (people-first-crm H7, FLOW D.1, PLAN P-15): *"Da completare: …"*
 * con un link per voce e **Nascondi** accanto. Le voci nascoste restano nascoste finché l'insieme delle voci
 * mancanti non cambia (firma dell'insieme in `localStorage`, per browser). Non impedisce di usare il resto.
 */

const STORAGE_KEY = 'crm.today.hidden-setup';

interface Hidden {
  signature: string;
  keys: SetupKey[];
}

const signatureOf = (missing: SetupKey[]) => [...missing].sort().join(',');

function readHidden(signature: string): SetupKey[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Hidden) : null;
    return parsed && parsed.signature === signature && Array.isArray(parsed.keys) ? parsed.keys : [];
  } catch {
    return [];
  }
}

function writeHidden(value: Hidden): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // storage non disponibile: resta nascosta per questa visita
  }
}

export function SetupAlerts({ missing }: { missing: SetupKey[] }) {
  const signature = signatureOf(missing);
  const [hidden, setHidden] = useState<{ signature: string; keys: SetupKey[] }>(() => ({ signature, keys: readHidden(signature) }));
  // Insieme cambiato (es. chiave aggiunta al .env): tutte le voci tornano visibili.
  const keys = hidden.signature === signature ? hidden.keys : [];
  const visible = missing.filter((k) => !keys.includes(k));
  if (visible.length === 0) return null;

  const hide = (key: SetupKey) => {
    const next = { signature, keys: [...keys, key] };
    writeHidden(next);
    setHidden(next);
    // Focus sulla voce successiva, o sul titolo della pagina se era l'ultima (FLOW Accessibilità).
    const index = visible.indexOf(key);
    const following = visible[index + 1] ?? visible[index - 1];
    requestAnimationFrame(() => focusOrPageTitle(following ? document.querySelector<HTMLElement>(`[data-hide-setup="${following}"]`) : null));
  };

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <span className="font-medium">Da completare:</span>{' '}
      {visible.map((key, i) => {
        const item = SETUP_ITEMS[key];
        return (
          <Fragment key={key}>
            {i > 0 && ' · '}
            <span className="inline-flex items-center gap-0.5 whitespace-nowrap">
              <Link to={item.to as never} hash={item.hash} className="underline underline-offset-2 hover:text-amber-800">
                {item.label}
              </Link>
              <button
                type="button"
                data-hide-setup={key}
                onClick={() => hide(key)}
                title="Torna se cambia cosa manca."
                aria-label={`Nascondi il promemoria: ${item.label}`}
                className="inline-flex cursor-pointer items-center gap-0.5 rounded px-1 text-xs text-amber-800 hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-amber-700"
              >
                <XIcon className="size-3" aria-hidden="true" />
                Nascondi
              </button>
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}
