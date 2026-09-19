import { useEffect, useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { api, errorText, queryKeys } from '../api/client';
import type { ProspectRow } from '../api/types';
import { useDebouncedKey } from '../lib/hooks';
import { invalidateProspectViews } from './StatusSelect';
import { toast } from './ui/toaster';

/*
 * "Collega una persona esistente" dalla scheda azienda (people-first-crm D6, FLOW I.4): ricerca tra le persone del
 * CRM (stesso filtro testo di Persone), un risultato collegato altrove lo dice ("Ora collegata a Beta: collegandola
 * qui lascia Beta."), **Collega** collega la persona all'azienda come impostazione a mano (D7).
 */
export function LinkPersonDialog(props: { companyId: number; companyName: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const uid = useId();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<ProspectRow | null>(null);
  const [active, setActive] = useState(0);
  const [debounced] = useDebouncedKey(q.trim());
  useEffect(() => {
    if (props.open) {
      setQ('');
      setPicked(null);
    }
  }, [props.open]);
  const results = useQuery({
    queryKey: queryKeys.prospectsSearch({ q: debounced, pageSize: 8 }),
    queryFn: () => api.prospects.search({ q: debounced, pageSize: 8 }),
    enabled: props.open && debounced.length >= 2,
  });
  const items = results.data?.items ?? [];
  useEffect(() => setActive(0), [debounced]);
  const link = useMutation({
    mutationFn: (person: ProspectRow) => api.prospects.linkCompany(person.id, props.companyId),
    onSuccess: (_next, person) => {
      void invalidateProspectViews(queryClient);
      void queryClient.invalidateQueries({ queryKey: queryKeys.companies });
      toast({ title: `Persona collegata a ${props.companyName}: ${person.full_name ?? 'senza nome'}` });
      props.onOpenChange(false);
    },
  });

  return (
    <Dialog open={props.open} onOpenChange={(o) => !link.isPending && props.onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Collega una persona a {props.companyName}</DialogTitle>
          <DialogDescription>Cerca tra le persone del CRM per nome, azienda, email o evento.</DialogDescription>
        </DialogHeader>
        <Input
          role="combobox"
          aria-expanded={items.length > 0}
          aria-controls={`${uid}-list`}
          aria-activedescendant={items[active] ? `${uid}-opt-${active}` : undefined}
          aria-label="Cerca una persona"
          autoFocus
          value={q}
          placeholder="Scrivi almeno 2 caratteri"
          onChange={(e) => {
            setQ(e.target.value);
            setPicked(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(items.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter' && items[active]) {
              e.preventDefault();
              setPicked(items[active]);
            }
          }}
        />
        <ul id={`${uid}-list`} role="listbox" aria-label="Persone" className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
          {debounced.length >= 2 && results.isSuccess && items.length === 0 && (
            <li className="px-2 py-1.5 text-sm text-slate-500">Nessuna persona trovata per '{debounced}'.</li>
          )}
          {items.map((p, i) => {
            const elsewhere = p.company_id !== null && p.company_id !== props.companyId;
            const here = p.company_id === props.companyId;
            return (
              <li
                key={p.id}
                id={`${uid}-opt-${i}`}
                role="option"
                aria-selected={picked?.id === p.id}
                onClick={() => !here && setPicked(p)}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  'cursor-pointer rounded-md px-2 py-1.5 text-sm',
                  picked?.id === p.id ? 'bg-slate-900 text-white' : i === active ? 'bg-slate-100' : '',
                  here && 'cursor-default opacity-60',
                )}
              >
                <p className="font-medium">{p.full_name ?? 'Senza nome'}</p>
                <p className={cn('text-xs empty:hidden', picked?.id === p.id ? 'text-slate-300' : 'text-slate-500')}>
                  {[
                    p.title,
                    p.linked_company_name ?? p.company_name,
                    here && 'già collegata qui',
                    elsewhere && `Ora collegata a ${p.linked_company_name ?? "un'altra azienda"}: collegandola qui lascia ${p.linked_company_name ?? 'quella'}.`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </li>
            );
          })}
        </ul>
        {link.error && (
          <p role="alert" className="text-sm text-red-700">
            Collegamento non riuscito: {errorText(link.error)}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Annulla
            </Button>
          </DialogClose>
          <Button type="button" disabled={!picked || link.isPending} aria-busy={link.isPending} onClick={() => picked && link.mutate(picked)}>
            {link.isPending ? 'Collegamento…' : picked ? `Collega ${picked.full_name ?? 'la persona'}` : 'Collega'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
