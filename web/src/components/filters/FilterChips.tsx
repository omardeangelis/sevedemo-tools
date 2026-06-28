import { XIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type ActiveFilterChip = {
  /** Stable key (React key). */
  key: string;
  /** Human label, e.g. "Bucket: Freelance". */
  label: string;
  /** Clears just this filter. */
  onClear: () => void;
};

export type FilterChipsProps = {
  /** Only the currently-active filters; empty = nothing rendered. */
  chips: ReadonlyArray<ActiveFilterChip>;
  /** Clears all filters at once. Required when ≥1 chip is shown. */
  onClearAll: () => void;
  className?: string;
};

/**
 * Renders a row of active-filter chips, each with a keyboard-activatable ✕, plus
 * a "Pulisci" button shown only when ≥1 filter is active. Zero active filters →
 * renders nothing (no vertical footprint). The chip list is intentionally a flat
 * array so future tasks (e.g. T3's "Export: solo email-ready") can extend it.
 */
export function FilterChips({ chips, onClearAll, className }: FilterChipsProps) {
  if (chips.length === 0) return null;

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {chips.map((chip) => (
        <Badge key={chip.key} variant="secondary" className="gap-1 pr-1">
          <span>{chip.label}</span>
          <button
            type="button"
            aria-label={`Rimuovi filtro ${chip.label}`}
            onClick={chip.onClear}
            className="inline-flex size-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <XIcon className="size-3" />
          </button>
        </Badge>
      ))}
      <Button type="button" variant="ghost" size="xs" onClick={onClearAll}>
        Pulisci
      </Button>
    </div>
  );
}
