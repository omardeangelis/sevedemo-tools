import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/api/client';
import type { Bucket, Contact, Selection } from '@/api/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FilterBar } from '@/components/filters/FilterBar';
import { EMAIL_FILTER_OPTIONS, type EmailFilterValue } from '@/components/filters/emailOptions';
import { ErrorBox, FitScore, Loading, pushToast, StatusBadge } from '@/components/ui';

/** Server caps the candidate pool at 30, ordered by fit. */
const POOL_CAP = 30;

const BUCKET_LABEL: Record<Bucket, string> = {
  freelance: 'Freelance',
  azienda: 'Azienda',
};

/**
 * Per-item outcome of an add attempt. Bulk (T6) reuses this tagged result to
 * build its "X aggiunti · Y saltati · Z errori" summary and the "riprova i
 * falliti" set, so it must carry enough context (contact identity + message).
 */
export type AddOutcomeKind = 'aggiunto' | 'saltato' | 'exported' | 'errore';

export interface AddOutcome {
  kind: AddOutcomeKind;
  /** Human-readable message for the 'errore'/'exported' branches. */
  message?: string;
}

/**
 * Pure classifier for the result of a single `api.addToSelection` attempt.
 *
 * The server returns 409 for TWO opposite meanings, so status alone is not
 * enough — we must also read the message:
 * - resolved promise                                  → 'aggiunto'
 * - ApiError 409 + /esportat/i message                → 'exported' (FATAL: the
 *   whole selection is read-only → close the dialog)
 * - ApiError 409 (the "già presente" case)            → 'saltato'
 * - anything else                                      → 'errore'
 *
 * Pass the resolved value as `ok`/no error; pass the thrown value as `err`.
 */
export function classifyAddResult(err: unknown): AddOutcome {
  if (err === undefined || err === null) return { kind: 'aggiunto' };
  if (err instanceof ApiError && err.status === 409) {
    if (/esportat/i.test(err.message)) return { kind: 'exported', message: err.message };
    return { kind: 'saltato', message: err.message };
  }
  const message = err instanceof Error ? err.message : "Errore nell'aggiunta.";
  return { kind: 'errore', message };
}

interface AddSummary {
  aggiunti: number;
  saltati: number;
  errori: number;
  /** Names of contacts that errored, for the "(con quali)" detail. */
  erroredNames: string[];
}

const EMPTY_SUMMARY: AddSummary = { aggiunti: 0, saltati: 0, errori: 0, erroredNames: [] };

const contactLabel = (c: Contact): string => c.full_name ?? c.linkedin_url;

export interface AddContactsDialogProps {
  date: string;
  bucket: Bucket;
  /** When the selection is exported the trigger is disabled (read-only). */
  disabled?: boolean;
  /** Push the updated selection into the cache after a successful add. */
  onAdded: (selection: Selection) => void;
}

/**
 * Guided "Aggiungi a {Freelance|Azienda}" dialog. Per-id multi-select + bulk
 * fan-out (N client-side POST) + "riprova i falliti", built on T5's per-item
 * outcome model and `classifyAddResult`.
 *
 * Owns its own trigger ("+ Aggiungi") so the BucketPanel just renders it.
 */
export function AddContactsDialog({ date, bucket, disabled, onAdded }: AddContactsDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/*
        DialogTrigger gives Radix native restore-focus: closing the dialog (via
        Escape, overlay, the X, or programmatically setting open=false) returns
        focus to this "+ Aggiungi" button.
      */}
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="default" disabled={disabled}>
          + Aggiungi
        </Button>
      </DialogTrigger>
      {open && (
        <AddContactsDialogBody
          date={date}
          bucket={bucket}
          onAdded={onAdded}
          onClose={() => setOpen(false)}
        />
      )}
    </Dialog>
  );
}

function AddContactsDialogBody({
  date,
  bucket,
  onAdded,
  onClose,
}: {
  date: string;
  bucket: Bucket;
  onAdded: (selection: Selection) => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [email, setEmail] = useState<EmailFilterValue>('');
  const [summary, setSummary] = useState<AddSummary>(EMPTY_SUMMARY);
  // Per-id multi-select: a Set of contact ids INDEPENDENT of the current pool
  // view. Changing search/email filter must NOT drop already-checked ids.
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  // Identity cache so we can label errored items and re-run the fan-out on ids
  // even after they leave the current (filtered) pool view.
  const [knownContacts, setKnownContacts] = useState<Map<number, Contact>>(() => new Map());
  // Ids that errored on the last run; "Riprova i falliti" re-runs ONLY these.
  const [failedIds, setFailedIds] = useState<number[]>([]);
  const [running, setRunning] = useState(false);
  const titleId = `add-contacts-${bucket}`;

  const candidates = useQuery({
    queryKey: ['candidates', date, bucket, q, email],
    queryFn: () => api.candidates(date, bucket, q, email || undefined),
  });

  const pool = candidates.data ?? [];
  const poolReady = candidates.isSuccess;
  const overCap = pool.length >= POOL_CAP;

  const add = useMutation({
    mutationFn: (contactId: number) => api.addToSelection(date, contactId, bucket),
  });

  const selectedCount = selectedIds.size;
  // Visible-set helpers for "seleziona tutti i visibili": act ONLY on the rows
  // currently rendered (≤30), never on a non-visible set.
  const visibleIds = useMemo(() => pool.map((c) => c.id), [pool]);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));

  const rememberContact = (c: Contact) =>
    setKnownContacts((m) => {
      if (m.has(c.id)) return m;
      const next = new Map(m);
      next.set(c.id, c);
      return next;
    });

  const toggleOne = (c: Contact, checked: boolean) => {
    rememberContact(c);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(c.id);
      else next.delete(c.id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    // Cache identities so a later filter change can't lose the labels.
    pool.forEach(rememberContact);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds) next.add(id);
      }
      return next;
    });
  };

  /**
   * Best-effort sequential fan-out over `ids`, isolating each item: one
   * failure never rolls back the rest. Aborts the whole run on the first
   * `exported` outcome (the selection became read-only for everyone) and
   * closes the dialog. Updates the summary, the selection cache, and the
   * selected/failed sets so the UI reflects exactly what happened.
   */
  const runBatch = async (ids: number[]) => {
    if (ids.length === 0 || running) return;
    setRunning(true);

    let aggiunti = 0;
    let saltati = 0;
    const erroredIds: number[] = [];
    const erroredNames: string[] = [];
    const settledIds: number[] = []; // aggiunto + saltato → leave the selection
    let lastUpdated: Selection | undefined;
    let aborted = false;

    for (const id of ids) {
      let outcome: AddOutcome;
      let updated: Selection | undefined;
      try {
        updated = await add.mutateAsync(id);
        outcome = classifyAddResult(undefined);
      } catch (err) {
        outcome = classifyAddResult(err);
      }

      if (outcome.kind === 'exported') {
        // Fatal: the whole selection is read-only. Stop the batch immediately
        // (don't keep firing), surface it, and close. NOT counted as saltato.
        aborted = true;
        break;
      }

      if (outcome.kind === 'aggiunto') {
        aggiunti += 1;
        settledIds.push(id);
        if (updated) lastUpdated = updated;
      } else if (outcome.kind === 'saltato') {
        // Already present = success-by-skip: settled, never retried.
        saltati += 1;
        settledIds.push(id);
      } else {
        erroredIds.push(id);
        const c = knownContacts.get(id);
        erroredNames.push(c ? contactLabel(c) : `#${id}`);
      }
    }

    if (aborted) {
      pushToast({
        kind: 'error',
        title: 'Selezione esportata, sola lettura',
        description: 'La selezione è stata esportata: non è più modificabile.',
      });
      setRunning(false);
      onClose();
      // Reflect the read-only state in the page.
      queryClient.invalidateQueries({ queryKey: ['selection', date] });
      queryClient.invalidateQueries({ queryKey: ['selections'] });
      return;
    }

    // Accumulate into the running summary (so retries add to the totals).
    setSummary((s) => ({
      aggiunti: s.aggiunti + aggiunti,
      saltati: s.saltati + saltati,
      // Errors are RE-derived per run, not accumulated: a retry should not
      // double-count the same failing item, and the "(con quali)" list must
      // reflect only what is still failing.
      errori: erroredIds.length,
      erroredNames,
    }));

    // Settled (aggiunto + saltato) ids leave the selection; errored ids stay
    // checked so "Riprova i falliti" keeps the user's selection.
    if (settledIds.length > 0) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of settledIds) next.delete(id);
        return next;
      });
    }
    setFailedIds(erroredIds);

    // Post-batch refresh: push the latest selection into the cache and make the
    // added contacts disappear from the pool (bucket counts/segments recompute).
    if (aggiunti > 0) {
      if (lastUpdated) onAdded(lastUpdated);
      else queryClient.invalidateQueries({ queryKey: ['selection', date] });
      queryClient.invalidateQueries({ queryKey: ['candidates', date] });
    } else if (saltati > 0) {
      // The "saltati" were already in the selection but may still be in this
      // stale pool view — refresh so they drop out.
      queryClient.invalidateQueries({ queryKey: ['candidates', date] });
    }

    setRunning(false);
  };

  const handleAddSelected = () => runBatch([...selectedIds]);
  const handleRetryFailed = () => runBatch(failedIds);

  const hasSummary = summary.aggiunti + summary.saltati + summary.errori > 0;
  const canAct = poolReady && !running;

  return (
    <DialogContent
      className="sm:max-w-lg"
      aria-labelledby={titleId}
      onOpenAutoFocus={(e) => {
        // Land initial focus on the search input (FilterBar renders its own
        // Input, so target it by its accessible name) rather than the close X.
        const content = e.currentTarget as HTMLElement;
        const search = content.querySelector<HTMLInputElement>('input[aria-label="Cerca nel pool"]');
        if (search) {
          e.preventDefault();
          search.focus();
        }
      }}
    >
      <DialogHeader>
        <DialogTitle id={titleId}>Aggiungi a {BUCKET_LABEL[bucket]}</DialogTitle>
        <DialogDescription>
          Contatti <code className="rounded bg-muted px-1">scored</code> di questo bucket non ancora
          presenti in alcuna Selezione, ordinati per fit.
        </DialogDescription>
      </DialogHeader>

      <FilterBar
        search={{
          value: q,
          onChange: setQ,
          placeholder: 'Cerca per nome, headline o azienda…',
          label: 'Cerca nel pool',
        }}
        selects={[
          {
            key: 'email',
            label: 'Email',
            value: email,
            onChange: (v) => setEmail(v as EmailFilterValue),
            options: EMAIL_FILTER_OPTIONS,
          },
        ]}
      />

      {/* Select-all-visible + live "N selezionati" counter (announced on change). */}
      <div className="flex items-center justify-between gap-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
          <Checkbox
            checked={allVisibleSelected}
            onCheckedChange={toggleAllVisible}
            disabled={!poolReady || pool.length === 0 || running}
            aria-label="Seleziona tutti i visibili"
          />
          Seleziona tutti i visibili
        </label>
        <p aria-live="polite" className="text-sm font-medium text-muted-foreground">
          {selectedCount} selezionati
        </p>
      </div>

      {overCap && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Mostrati i 30 candidati a fit più alto; affina la ricerca per vederne altri.
        </p>
      )}

      <div className="max-h-72 overflow-y-auto">
        {candidates.isPending ? (
          <Loading label="Cerco candidati…" />
        ) : candidates.isError ? (
          <div className="flex flex-col items-start gap-2">
            <ErrorBox error={candidates.error} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => candidates.refetch()}
              disabled={candidates.isFetching}
            >
              Riprova
            </Button>
          </div>
        ) : pool.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nessun candidato disponibile nel pool.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {pool.map((c) => {
              const checked = selectedIds.has(c.id);
              return (
                <li key={c.id} className="flex items-center gap-3 py-2.5">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(v) => toggleOne(c, v === true)}
                    disabled={!poolReady || running}
                    aria-label={`Seleziona ${contactLabel(c)}`}
                  />
                  <FitScore value={c.fit_score} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-sm font-medium">
                      {c.full_name ?? c.linkedin_url}
                      <StatusBadge status={c.status} />
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{c.headline ?? '—'}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {hasSummary && (
        <p aria-live="polite" className="border-t border-border pt-2 text-sm text-foreground">
          {summary.aggiunti} aggiunti ·{' '}
          {summary.saltati > 0 ? (
            <span title="Già presenti nella selezione">{summary.saltati} saltati (già presente)</span>
          ) : (
            <>{summary.saltati} saltati</>
          )}{' '}
          · {summary.errori} errori
          {summary.errori > 0 && (
            <span className="text-muted-foreground"> ({summary.erroredNames.join(', ')})</span>
          )}
        </p>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
        {failedIds.length > 0 && (
          <Button
            type="button"
            variant="outline"
            size="default"
            onClick={handleRetryFailed}
            disabled={!canAct}
          >
            Riprova i falliti ({failedIds.length})
          </Button>
        )}
        <Button
          type="button"
          variant="default"
          size="default"
          onClick={handleAddSelected}
          disabled={!canAct || selectedCount === 0}
        >
          {running ? 'Aggiungo…' : `Aggiungi ${selectedCount} contatt${selectedCount === 1 ? 'o' : 'i'}`}
        </Button>
      </div>
    </DialogContent>
  );
}
