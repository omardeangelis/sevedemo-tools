import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

/**
 * Radix Select forbids an empty-string item value, so the "all" option is mapped
 * to a sentinel internally and mapped back to '' at the component boundary.
 */
const ALL_SENTINEL = '__all';

export type FilterSelectOption = { value: string; label: string };

export type FilterSelectConfig = {
  /** Stable key (used for React keys and aria labelling). */
  key: string;
  /** Accessible label for the select (e.g. "Bucket"). */
  label: string;
  /** Controlled value. The empty string means "no filter / all". */
  value: string;
  /** Called with the new value ('' when the "all" option is chosen). */
  onChange: (value: string) => void;
  /** Options; include the "all" option (value '') as the first entry. */
  options: ReadonlyArray<FilterSelectOption>;
};

export type FilterBarSearchConfig = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Accessible label for the search input. */
  label?: string;
};

export type FilterBarProps = {
  /** Search input config. Omit to render only selects. */
  search?: FilterBarSearchConfig;
  /** Ordered list of compact selects. */
  selects?: ReadonlyArray<FilterSelectConfig>;
  className?: string;
};

/**
 * Compact, state-source-agnostic filter bar: a search input + a configurable set
 * of compact selects, laid out on a single wrapping row (intrinsic width, NOT
 * full-width stacked). Controlled via `value`/`onChange` — no coupling to URL,
 * TanStack, or any store. The Contatti page wires it to the URL; the Selezioni
 * pool wires it to local `useState`.
 */
export function FilterBar({ search, selects = [], className }: FilterBarProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {search && (
        <Input
          className="h-8 w-auto max-w-72 grow sm:grow-0"
          placeholder={search.placeholder}
          aria-label={search.label ?? search.placeholder ?? 'Cerca'}
          value={search.value}
          onChange={(e) => search.onChange(e.target.value)}
        />
      )}
      {selects.map((s) => (
        <Select
          key={s.key}
          value={s.value === '' ? ALL_SENTINEL : s.value}
          onValueChange={(v) => s.onChange(v === ALL_SENTINEL ? '' : v)}
        >
          <SelectTrigger size="default" className="w-auto" aria-label={s.label}>
            <SelectValue placeholder={s.label} />
          </SelectTrigger>
          <SelectContent>
            {s.options.map((o) => (
              <SelectItem key={o.value === '' ? ALL_SENTINEL : o.value} value={o.value === '' ? ALL_SENTINEL : o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}
    </div>
  );
}
