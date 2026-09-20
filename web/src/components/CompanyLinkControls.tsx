import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Building2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api, errorText, isApiError, queryKeys } from '../api/client';
import type { ProspectDetail } from '../api/types';
import { CompanyPicker, LinkedCompanyChip, type PickedCompany } from './CompanyPicker';
import { invalidateProspectViews } from './StatusSelect';
import { toast } from './ui/toaster';

/*
 * Riga Azienda della scheda persona (people-first-crm D1–D5, D7; FLOW I.1–I.3): collegata → link alla scheda
 * azienda + Cambia azienda · Scollega (e "Collegata da te" se impostata a mano); solo testo → "<nome> · non
 * collegata" + Collega a un'azienda; vuota → "Nessuna azienda" + Collega a un'azienda.
 */

const COMPANY_GONE = "Azienda non trovata: forse è stata unita a un'altra. Cercala di nuovo.";

export function CompanyLinkControls({ prospect: p, linkedName }: { prospect: ProspectDetail; linkedName: string | null }) {
  const uid = useId();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const onDone = (next: ProspectDetail) => {
    queryClient.setQueryData(queryKeys.prospect(p.id), next);
    void invalidateProspectViews(queryClient);
    void queryClient.invalidateQueries({ queryKey: queryKeys.companies });
  };
  const unlink = useMutation({
    mutationFn: () => api.prospects.unlinkCompany(p.id),
    onSuccess: (next) => {
      onDone(next);
      toast({ title: `Azienda scollegata: resta '${next.company_name ?? linkedName ?? 'il nome'}' come testo.` });
    },
  });
  const manual = Boolean(p.manual_fields.company_id);

  return (
    <div className="flex flex-col gap-1" role="group" aria-labelledby={`${uid}-label`}>
      <span id={`${uid}-label`} className="text-xs font-medium text-slate-600">
        Azienda
      </span>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {p.company_id ? (
          <>
            <Link to="/companies/$id" params={{ id: String(p.company_id) }} className="inline-flex items-center gap-1.5 font-medium text-slate-900 underline underline-offset-2">
              <Building2Icon className="size-3.5 text-slate-400" aria-hidden="true" />
              {linkedName ?? p.company_name ?? `Azienda #${p.company_id}`}
            </Link>
            <Button type="button" size="xs" variant="outline" onClick={() => setOpen(true)}>
              Cambia azienda
            </Button>
            <Button type="button" size="xs" variant="ghost" onClick={() => unlink.mutate()} disabled={unlink.isPending} aria-busy={unlink.isPending}>
              Scollega
            </Button>
          </>
        ) : (
          <>
            {p.company_name ? (
              <span>
                {p.company_name} <span className="text-slate-500">· non collegata</span>
              </span>
            ) : (
              <span className="text-slate-500">Nessuna azienda</span>
            )}
            <Button type="button" size="xs" variant="outline" onClick={() => setOpen(true)}>
              Collega a un'azienda
            </Button>
          </>
        )}
      </div>
      {manual && p.company_id && <p className="text-xs text-slate-500">Collegata da te: i job non cambiano questo collegamento.</p>}
      {manual && !p.company_id && <p className="text-xs text-slate-500">Scollegata da te: i job non la ricollegano.</p>}
      {unlink.error && (
        <p role="alert" className="text-xs text-red-700">
          Scollega non riuscito: {errorText(unlink.error)}
        </p>
      )}
      <LinkCompanyDialog prospect={p} open={open} onOpenChange={setOpen} onLinked={onDone} />
    </div>
  );
}

function LinkCompanyDialog(props: {
  prospect: ProspectDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLinked: (next: ProspectDetail) => void;
}) {
  const { prospect: p } = props;
  const uid = useId();
  // D2: la ricerca parte dal nome dell'azienda scritto sulla persona.
  const [text, setText] = useState(p.company_name ?? '');
  const [picked, setPicked] = useState<PickedCompany | null>(null);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) {
      setText(p.company_name ?? '');
      setPicked(null);
    }
  }
  const link = useMutation({
    mutationFn: (company: PickedCompany) => api.prospects.linkCompany(p.id, company.id),
    onSuccess: (next, company) => {
      props.onLinked(next);
      toast({ title: `Azienda collegata: ${company.name}` });
      props.onOpenChange(false);
    },
    onError: (err) => {
      if (isApiError(err, 'company_not_found')) setPicked(null);
    },
  });
  const name = p.full_name ?? 'la persona';

  return (
    <Dialog open={props.open} onOpenChange={(o) => !link.isPending && props.onOpenChange(o)}>
      <DialogContent className="overflow-visible sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{p.company_id ? `Cambia l'azienda di ${name}` : `Collega ${name} a un'azienda`}</DialogTitle>
          <DialogDescription>Cerca tra le aziende del CRM o creane una nuova. I job non cambieranno questo collegamento.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {picked ? (
            <LinkedCompanyChip company={picked} onClear={() => setPicked(null)} disabled={link.isPending} autoFocus />
          ) : (
            <CompanyPicker
              inputId={`${uid}-company`}
              ariaLabel="Cerca per nome, sito o pagina LinkedIn"
              text={text}
              onTextChange={setText}
              onPick={(company, created) => {
                setPicked(company);
                // "Crea e collega": l'azienda nuova si collega subito, senza un secondo "Collega".
                if (created) link.mutate(company);
              }}
              autoFocus
            />
          )}
          {link.error && (
            <p role="alert" className="text-sm text-red-700">
              {isApiError(link.error, 'company_not_found') ? COMPANY_GONE : `Collegamento non riuscito: ${errorText(link.error)}`}
            </p>
          )}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Annulla
            </Button>
          </DialogClose>
          <Button type="button" disabled={!picked || link.isPending} aria-busy={link.isPending} onClick={() => picked && link.mutate(picked)}>
            {link.isPending ? 'Collegamento…' : 'Collega'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
