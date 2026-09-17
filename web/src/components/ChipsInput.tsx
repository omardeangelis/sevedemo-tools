import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/*
 * Campo a chip condiviso (estratto da `routes/icps.$id.tsx`, apollo-lookalike T12a): form ICP e filtri
 * del dialog "Trova aziende simili".
 */

/** Aggiunge i valori scritti (separati da virgola) senza doppioni, ignorando maiuscole/minuscole. */
export function addChips(values: string[], raw: string): string[] {
  const next = [...values];
  for (const part of raw.split(',')) {
    const value = part.trim();
    if (value && !next.some((v) => v.toLowerCase() === value.toLowerCase())) next.push(value);
  }
  return next;
}

export interface ChipsInputProps {
  id: string;
  label: string;
  item: string;
  placeholder: string;
  hint: ReactNode;
  values: string[];
  onValuesChange: (values: string[]) => void;
  draft: string;
  onDraftChange: (draft: string) => void;
  disabled?: boolean;
  /**
   * Origine di un chip (es. "dall'ICP · da Acme"): tooltip del chip e testo per i lettori di schermo nel
   * bottone di rimozione. `undefined` = nessuna origine mostrata.
   */
  chipOrigin?: (value: string) => string | undefined;
  /** Azione accanto all'etichetta (es. "Ripristina i filtri derivati"). */
  labelAction?: ReactNode;
}

/**
 * Campo a chip: Invio o virgola aggiungono il testo scritto come chip (senza inviare il form), la ×
 * rimuove. Il testo non confermato lo aggiunge chi usa il campo al salvataggio/avvio.
 */
export function ChipsInput(props: ChipsInputProps) {
  const { id, values, draft, disabled } = props;
  const inputRef = useRef<HTMLInputElement>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' && event.key !== ',') return;
    event.preventDefault();
    if (draft.trim() === '') return;
    props.onValuesChange(addChips(values, draft));
    props.onDraftChange('');
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium text-slate-600">
          {props.label}
        </label>
        {props.labelAction}
      </div>
      <div
        className={cn(
          'flex flex-wrap items-center gap-1.5 rounded-lg border border-input px-2 py-1 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50',
          disabled && 'opacity-60',
        )}
      >
        {values.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label={`${props.label} (${values.length})`}>
            {values.map((value) => {
              const origin = props.chipOrigin?.(value);
              return (
                <li
                  key={value}
                  title={origin}
                  className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 py-0.5 pr-0.5 pl-2.5 text-xs font-medium text-slate-800"
                >
                  {value}
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      props.onValuesChange(values.filter((v) => v !== value));
                      inputRef.current?.focus();
                    }}
                    aria-label={`Rimuovi ${props.item} ${value}${origin ? ` (${origin})` : ''}`}
                    title={origin}
                    className="cursor-pointer rounded-full p-0.5 text-slate-500 hover:bg-slate-200 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:outline-none disabled:cursor-not-allowed"
                  >
                    <XIcon className="size-3" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <input
          ref={inputRef}
          id={id}
          value={draft}
          disabled={disabled}
          onChange={(e) => props.onDraftChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={values.length === 0 ? props.placeholder : `Aggiungi ${props.item}…`}
          aria-describedby={`${id}-hint`}
          className="h-6 min-w-40 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        />
      </div>
      <p id={`${id}-hint`} className="text-xs text-slate-500">
        {props.hint}
      </p>
    </div>
  );
}
