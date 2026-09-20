import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { SearchIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { api } from '../api/client';
import type { CompanyHit, PersonHit, SearchResult } from '../api/types';
import { countText } from '../lib/format';
import { originOf } from '../lib/origin';
import { companyLabel, shortCompanyUrl } from './SourceCompanyDialog';
import { Spinner } from './ui';

/*
 * Ricerca globale (people-first-crm I1–I5, FLOW B, T22): bottone **Cerca** in sidebar e ⌘K / Ctrl+K da ogni pagina.
 * Dialog modale con un combobox (`aria-activedescendant`) e un listbox a gruppi (Persone, Aziende, azioni); risultati
 * mentre si scrive da 2 caratteri, debounce di 80 ms con le richieste superate annullate (PLAN P-18); mentre arrivano
 * restano i precedenti con "Ricerca…". Ultima voce sempre **Aggiungi '<testo>' come persona** (I4). Invio apre la
 * voce attiva, Esc chiude e riporta il focus dove era (I5). La scheda persona aperta da qui torna alla pagina da cui
 * si è aperta la ricerca, se è Oggi, Persone, una lista o un'azienda (A7).
 */

const DEBOUNCE_MS = 80;
const MIN_CHARS = 2;

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
const SHORTCUT_LABEL = isMac ? '⌘K' : 'Ctrl K';

type Option =
  | { key: string; kind: 'person'; hit: PersonHit }
  | { key: string; kind: 'company'; hit: CompanyHit }
  | { key: string; kind: 'all_people' }
  | { key: string; kind: 'add' };

/** Seconda riga di una persona: ruolo e azienda (collegata o scritta), altrimenti la headline o l'email (omonimi). */
function personLine(p: PersonHit): string {
  return [p.title, p.linked_company_name ?? p.company_name].filter(Boolean).join(' · ') || p.headline || p.email || '';
}

/** Live region (FLOW Accessibilità): *"3 persone, 1 azienda"*. */
function resultsText(r: SearchResult): string {
  return `${countText(r.people_total, 'persona', 'persone')}, ${countText(r.companies_total, 'azienda', 'aziende')}`;
}

/** Un dialog modale (non il nostro) è già aperto: ⌘K lo lascia stare. */
function otherDialogOpen(ours: HTMLElement | null): boolean {
  return [...document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]')].some(
    // I dialog Radix sono `position: fixed` (niente `offsetParent`): conta che siano disegnati.
    (el) => el !== ours && el.getAttribute('data-state') !== 'closed' && el.getClientRects().length > 0,
  );
}

export function CommandSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState<string | undefined>();
  const contentRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  const show = () => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOrigin(originOf(router.state.location));
    setOpen(true);
  };

  // ⌘K / Ctrl+K ovunque: il browser non la riceve (Firefox e Safari la usano per la barra di ricerca).
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== 'k') return;
      e.preventDefault();
      if (openRef.current) setOpen(false);
      else if (!otherDialogOpen(contentRef.current)) show();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // `show` legge solo ref e setter stabili.
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={show}
        aria-keyshortcuts="Meta+K Control+K"
        className="flex w-full items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-sm text-slate-400 hover:border-slate-700 hover:text-white focus-visible:outline-2 focus-visible:outline-white"
      >
        <SearchIcon className="size-4 shrink-0" aria-hidden="true" />
        <span className="flex-1 text-left">Cerca…</span>
        <kbd className="rounded border border-slate-700 px-1.5 font-sans text-[11px] text-slate-500">{SHORTCUT_LABEL}</kbd>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          ref={contentRef}
          showCloseButton={false}
          className="top-[15%] translate-y-0 gap-0 p-0 sm:max-w-xl"
          onCloseAutoFocus={(event) => {
            // Aperta da tastiera non c'è un trigger: si torna dov'era il focus (I5), se esiste ancora.
            const target = returnFocus.current;
            if (target?.isConnected && target !== document.body) {
              event.preventDefault();
              target.focus();
            }
          }}
        >
          <DialogTitle className="sr-only">Cerca persone e aziende</DialogTitle>
          <DialogDescription className="sr-only">
            Scrivi almeno 2 caratteri; frecce per scegliere, Invio per aprire, Esc per chiudere.
          </DialogDescription>
          {open && (
            <SearchPanel
              origin={origin}
              onDone={() => {
                returnFocus.current = null;
                setOpen(false);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function SearchPanel({ origin, onDone }: { origin: string | undefined; onDone: () => void }) {
  const uid = useId();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [result, setResult] = useState<{ q: string; data: SearchResult } | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  // Nessuna voce attiva finché non si usano le frecce (FLOW B.3: "↓ Invio"); Invio senza voce attiva apre la prima.
  const [active, setActive] = useState(-1);
  const [attempt, setAttempt] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const q = text.trim();
  const enough = q.length >= MIN_CHARS;

  useEffect(() => {
    if (!enough) {
      setLoading(false);
      setFailed(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(() => {
      api
        .search(q, controller.signal)
        .then((data) => {
          setResult({ q, data });
          setFailed(false);
          setActive(-1);
        })
        .catch(() => {
          if (!controller.signal.aborted) setFailed(true);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [q, enough, attempt]);

  // Risultati mostrati: quelli dell'ultima risposta (anche mentre ne arriva una nuova), solo con testo sufficiente.
  const shown = enough && result ? result.data : null;
  const options: Option[] = [];
  if (shown) {
    for (const hit of shown.people) options.push({ key: `p${hit.id}`, kind: 'person', hit });
    for (const hit of shown.companies) options.push({ key: `c${hit.id}`, kind: 'company', hit });
    if (shown.people_total > 0) options.push({ key: 'all', kind: 'all_people' });
  }
  if (enough) options.push({ key: 'add', kind: 'add' });
  const current = active < options.length ? active : -1;
  const optionId = (key: string) => `${uid}-opt-${key}`;

  const choose = (option: Option) => {
    onDone();
    switch (option.kind) {
      case 'person':
        void navigate({ to: '/people/$id', params: { id: String(option.hit.id) }, search: (origin ? { from: origin } : {}) as never });
        break;
      case 'company':
        void navigate({ to: '/companies/$id', params: { id: String(option.hit.id) } });
        break;
      case 'all_people':
        void navigate({ to: '/people', search: { q } as never });
        break;
      case 'add':
        void navigate({ to: '/people/new', search: { name: q } as never });
        break;
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (options.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((current + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(current <= 0 ? options.length - 1 : current - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(options[current >= 0 ? current : 0]);
    }
  };

  // Voce attiva sempre visibile quando ci si muove con le frecce.
  const activeKey = current >= 0 ? options[current].key : null;
  useEffect(() => {
    if (activeKey) document.getElementById(optionId(activeKey))?.scrollIntoView({ block: 'nearest' });
    // `optionId` dipende solo da `uid`, stabile.
  }, [activeKey]);

  const status = !q
    ? ''
    : !enough
      ? 'Scrivi almeno 2 caratteri.'
      : failed
        ? 'Ricerca non riuscita.'
        : shown
          ? shown.people_total + shown.companies_total === 0
            ? `Nessun risultato per '${q}'.`
            : resultsText(shown)
          : '';

  const renderOption = (option: Option, content: ReactNode) => {
    const index = options.indexOf(option);
    const selected = index === current;
    return (
      <li
        key={option.key}
        id={optionId(option.key)}
        role="option"
        aria-selected={selected}
        onMouseMove={() => setActive(index)}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => choose(option)}
        className={cn('cursor-pointer rounded-lg px-3 py-2', selected ? 'bg-slate-100' : 'hover:bg-slate-50')}
      >
        {content}
      </li>
    );
  };

  const people = options.filter((o): o is Extract<Option, { kind: 'person' }> => o.kind === 'person');
  const companies = options.filter((o): o is Extract<Option, { kind: 'company' }> => o.kind === 'company');
  const actions = options.filter((o) => o.kind === 'all_people' || o.kind === 'add');

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4">
        <SearchIcon className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
        <input
          ref={inputRef}
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-label="Cerca persone e aziende"
          aria-expanded={options.length > 0}
          aria-controls={`${uid}-listbox`}
          aria-activedescendant={current >= 0 ? optionId(options[current].key) : undefined}
          aria-autocomplete="list"
          placeholder="Cerca persone e aziende…"
          className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
        />
        {loading && (
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <Spinner className="size-3.5 border-slate-300 border-t-slate-600" />
            Ricerca…
          </span>
        )}
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {loading ? '' : status}
      </p>

      <div className="max-h-[60vh] overflow-y-auto p-2">
        {q && !enough && <p className="px-3 py-2 text-sm text-slate-500">Scrivi almeno 2 caratteri.</p>}
        {failed && (
          <div role="alert" className="flex items-center justify-between gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            Ricerca non riuscita.
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setAttempt((n) => n + 1);
                inputRef.current?.focus();
              }}
            >
              Riprova
            </Button>
          </div>
        )}
        {shown && shown.people_total + shown.companies_total === 0 && (
          <p className="px-3 py-2 text-sm text-slate-500">Nessun risultato per '{result!.q}'.</p>
        )}
        <ul id={`${uid}-listbox`} role="listbox" aria-label="Risultati" className="flex flex-col gap-2">
          {people.length > 0 && (
            <li role="presentation">
              <ul role="group" aria-labelledby={`${uid}-people`}>
                <li role="presentation" id={`${uid}-people`} className="px-3 pt-1 pb-1 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
                  Persone
                </li>
                {people.map((o) =>
                  renderOption(
                    o,
                    <>
                      <span className="flex items-center gap-2 text-sm font-medium text-slate-900">
                        {o.hit.full_name ?? 'Senza nome'}
                        {o.hit.status === 'scartato' && (
                          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200 ring-inset">
                            Scartata
                          </span>
                        )}
                      </span>
                      {personLine(o.hit) && <span className="block text-xs text-slate-500">{personLine(o.hit)}</span>}
                    </>,
                  ),
                )}
              </ul>
            </li>
          )}
          {companies.length > 0 && (
            <li role="presentation">
              <ul role="group" aria-labelledby={`${uid}-companies`}>
                <li role="presentation" id={`${uid}-companies`} className="px-3 pt-1 pb-1 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
                  Aziende
                </li>
                {companies.map((o) =>
                  renderOption(
                    o,
                    <>
                      <span className="block text-sm font-medium text-slate-900">{companyLabel(o.hit)}</span>
                      <span className="block text-xs text-slate-500">{o.hit.domain ?? shortCompanyUrl(o.hit.linkedin_url)}</span>
                    </>,
                  ),
                )}
              </ul>
            </li>
          )}
          {actions.length > 0 && (
            <li role="presentation">
              <ul role="group" aria-label="Azioni" className="border-t border-slate-100 pt-2">
                {actions.map((o) =>
                  renderOption(
                    o,
                    <span className="text-sm text-slate-800">
                      {o.kind === 'all_people' ? `Vedi tutte le persone per '${q}'` : `Aggiungi '${q}' come persona`}
                    </span>,
                  ),
                )}
              </ul>
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
