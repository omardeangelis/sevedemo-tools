import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api, isApiError, queryKeys } from '../api/client';
import { STATUS_LABELS, type MergePreview, type PersonRef, type ProspectDetail, type ProspectPatch, type ProspectStatus } from '../api/types';
import { fmtDayMonth } from '../lib/dates';
import { invalidateProspectViews } from './StatusSelect';
import { ErrorBox, Loading } from './ui';
import { toast } from './ui/toaster';

/*
 * "Unisci <persona> in questa scheda" (people-first-crm E6–E8, FLOW F.3–F.4): anteprima di cosa confluisce, del
 * profilo LinkedIn che resta, dei campi che si aggiungono e dei valori in conflitto (resta quello della scheda,
 * compresi i valori che si stavano salvando). Irreversibile: focus iniziale su Annulla.
 */

export interface MergeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Persona della scheda: resta. */
  keep: ProspectDetail;
  /** Persona che confluisce e scompare. */
  other: PersonRef;
  /** Valori che si stavano salvando: contano come valori della persona tenuta (E6). */
  patch: ProspectPatch;
  onMerged?: (prospect: ProspectDetail) => void;
  /** L'altra persona non c'è più (unita da un job): alla chiusura il pannello che proponeva "Unisci" va tolto. */
  onOtherGone?: () => void;
}

const FIELD_LABELS: Record<string, string> = {
  full_name: 'Nome',
  headline: 'Headline',
  about: 'About',
  location: 'Località',
  email: 'Email',
  phone: 'Telefono',
  company_name: 'Azienda (testo)',
  title: 'Ruolo',
  company_id: 'Azienda collegata',
  status: 'Stato',
  next_action: 'Prossima azione',
};

const fieldLabel = (field: string) => FIELD_LABELS[field] ?? field;

/** Valore leggibile di un conflitto: stato con la sua etichetta, prossima azione con la data breve. */
function conflictValue(field: string, value: string): string {
  if (field === 'status') return STATUS_LABELS[value as ProspectStatus] ?? value;
  if (field === 'next_action') {
    const [on, ...text] = value.split(' · ');
    return [fmtDayMonth(on), ...text].join(' · ');
  }
  return value;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const shortUrl = (url: string) => url.replace(/^https:\/\/www\./, '');

/** Campi della patch accettati da "Unisci" (niente conferme del PATCH). */
function mergePatchOf(patch: ProspectPatch): ProspectPatch {
  const { confirm_email_duplicate: _confirm, ...rest } = patch;
  return rest;
}

export function MergeDialog(props: MergeDialogProps) {
  const { keep, other } = props;
  const queryClient = useQueryClient();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const mergeRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const patch = mergePatchOf(props.patch);
  const otherName = other.full_name ?? 'Senza nome';
  const keepName = keep.full_name ?? 'questa persona';

  const preview = useQuery({
    queryKey: queryKeys.mergePreview(keep.id, other.id, patch),
    queryFn: () => api.prospects.mergePreview(keep.id, other.id, patch),
    enabled: props.open,
    retry: (count, err) => !(isApiError(err) && err.status < 500) && count < 1,
    staleTime: 0,
  });
  const merge = useMutation({
    mutationFn: () => api.prospects.merge(keep.id, other.id, patch),
    onSuccess: (prospect) => {
      queryClient.setQueryData(queryKeys.prospect(keep.id), prospect);
      queryClient.removeQueries({ queryKey: queryKeys.prospect(other.id) });
      void invalidateProspectViews(queryClient);
      toast({ title: `Persone unite: resta ${prospect.full_name ?? keepName}` });
      props.onMerged?.(prospect);
      props.onOpenChange(false);
    },
  });

  // Il bottone era disabilitato durante l'unione: dopo un errore il focus torna su Unisci (per riprovare) o, se
  // l'unione non è più possibile, su Chiudi.
  useEffect(() => {
    if (merge.isError) (mergeRef.current ?? cancelRef.current)?.focus();
  }, [merge.isError]);

  const gone = isApiError(preview.error, 'other_not_found') || isApiError(merge.error, 'other_not_found');
  const data = preview.data;
  const canMerge = Boolean(data?.mergeable) && !gone && !merge.isPending;

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (merge.isPending) return;
        if (!open && gone) props.onOtherGone?.();
        if (!open) merge.reset();
        props.onOpenChange(open);
      }}
    >
      <DialogContent
        className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg"
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          event.preventDefault();
          cancelRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          // Niente DialogTrigger: il focus torna a chi ha aperto il dialog ("Unisci … in questa persona…").
          const target = returnFocus.current;
          if (target?.isConnected && target !== document.body) {
            event.preventDefault();
            target.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            Unisci {otherName} (#{other.id}) in questa scheda
          </DialogTitle>
          <DialogDescription>
            Resta questa persona. {otherName} #{other.id} scompare: i suoi link risponderanno 'Persona non trovata'.
          </DialogDescription>
        </DialogHeader>

        {gone ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200 ring-inset">
            {otherName} #{other.id} non è più nel CRM (forse unita da un job). Nessuna modifica.
          </p>
        ) : preview.error ? (
          <div role="alert" className="flex flex-col items-start gap-2">
            <ErrorBox error={preview.error} />
            <Button type="button" size="sm" variant="outline" onClick={() => void preview.refetch()}>
              Riprova
            </Button>
          </div>
        ) : !data ? (
          <Loading />
        ) : !data.mergeable ? (
          <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200 ring-inset">
            {data.reason}
          </p>
        ) : (
          <MergeSummary preview={data} other={other} />
        )}

        {merge.error && !gone && (
          <div role="alert">
            {isApiError(merge.error, 'not_mergeable') ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200 ring-inset">{merge.error.message}</p>
            ) : (
              <ErrorBox error={merge.error} />
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            ref={cancelRef}
            type="button"
            variant="outline"
            disabled={merge.isPending}
            onClick={() => {
              if (gone) props.onOtherGone?.();
              merge.reset();
              props.onOpenChange(false);
            }}
          >
            {gone || (data && !data.mergeable) ? 'Chiudi' : 'Annulla'}
          </Button>
          {!gone && data?.mergeable && (
            <Button ref={mergeRef} type="button" variant="destructive" disabled={!canMerge} aria-busy={merge.isPending} onClick={() => merge.mutate()}>
              {merge.isPending ? 'Unione…' : 'Unisci'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MergeSummary({ preview: m, other }: { preview: MergePreview; other: PersonRef }) {
  const detail = (labels: string[]) => (labels.length > 0 ? ` (${labels.join('; ')})` : '');
  const moving = [
    plural(m.moving.sources, 'fonte', 'fonti') + detail(m.moving_labels.sources),
    plural(m.moving.lists, 'lista', 'liste'),
    plural(m.moving.activities, 'attività', 'attività'),
    plural(m.moving.analyses, 'analisi', 'analisi') + detail(m.moving_labels.analyses),
  ].join(' · ');
  const owner = (from: MergePreview['linkedin']['from']) =>
    from === 'patch' ? 'quello che stai salvando' : from === 'keep' ? 'quello di questa scheda' : `quello di #${other.id}`;
  const urnOwner = m.linkedin.member_urn_from === 'other' ? `#${other.id}` : 'questa scheda';

  return (
    <div className="flex flex-col gap-4 text-sm">
      <dl className="flex flex-col gap-3">
        <div>
          <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Confluiscono</dt>
          <dd className="mt-0.5 text-slate-800">{moving}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Profilo LinkedIn</dt>
          <dd className="mt-0.5 text-slate-800">
            {m.linkedin.url ? (
              <>
                <span className="font-medium">{shortUrl(m.linkedin.url)}</span> ({owner(m.linkedin.from)})
                {m.linkedin.member_urn && m.linkedin.member_urn_from !== 'patch' && m.linkedin.from !== m.linkedin.member_urn_from && (
                  <>, con l'id membro di {urnOwner}</>
                )}
              </>
            ) : (
              'Nessun profilo LinkedIn'
            )}
          </dd>
        </div>
        {m.filled.length > 0 && (
          <div>
            <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Si aggiungono da #{other.id}</dt>
            <dd className="mt-0.5 text-slate-800">{m.filled.map((f) => fieldLabel(f).toLowerCase()).join(', ')}</dd>
          </div>
        )}
      </dl>

      {m.conflicts.length > 0 ? (
        <table className="w-full border-collapse text-left text-sm">
          <caption className="mb-1 text-left text-xs font-medium tracking-wide text-slate-500 uppercase">Valori in conflitto</caption>
          <thead>
            <tr className="border-b border-slate-200 text-xs text-slate-500">
              <th scope="col" className="py-1.5 pr-3 font-medium">
                Campo
              </th>
              <th scope="col" className="py-1.5 pr-3 font-medium">
                Resta
              </th>
              <th scope="col" className="py-1.5 font-medium">
                Si perde
              </th>
            </tr>
          </thead>
          <tbody>
            {m.conflicts.map((c) => (
              <tr key={c.field} className="border-b border-slate-100 align-top">
                <th scope="row" className="py-1.5 pr-3 font-medium text-slate-700">
                  {fieldLabel(c.field)}
                </th>
                <td className="py-1.5 pr-3 break-words text-slate-900">{conflictValue(c.field, c.keep)}</td>
                <td className="py-1.5 break-words text-slate-500 line-through decoration-slate-300">{conflictValue(c.field, c.lose)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-slate-600">Nessun valore in conflitto.</p>
      )}

      <p className="font-medium text-slate-900">L'unione non si può annullare.</p>
    </div>
  );
}
