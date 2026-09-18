import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api, queryKeys } from '../api/client';
import type { AddMembersResult, ProspectList } from '../api/types';
import { joinParts, useDialogFocusReturn } from './BulkBar';
import { ListPicker } from './ListPicker';
import { toast } from './ui/toaster';

export interface AddToListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prospect da aggiungere (la selezione della pagina). */
  prospectIds: number[];
  /** ICP suggerito (FLOW H.3): il `ListPicker` ne evidenzia il gruppo e preseleziona la sua unica lista. */
  preferredIcpId?: number;
  /** Dopo l'aggiunta (tipicamente azzera la selezione: le righe escono dall'Inbox). */
  onAdded?: (result: AddMembersResult, list: ProspectList) => void;
}

/**
 * "Aggiungi a lista" (FLOW A.5, C.3): `ListPicker` con "Crea nuova lista" inline, conferma →
 * `POST /api/lists/:id/members` (idempotente) → toast "12 aggiunti a 'X' · 0 già presenti · lista
 * creata" con "Apri lista". Errore → messaggio nel dialog, la selezione resta.
 */
export function AddToListDialog({ open, onOpenChange, prospectIds, preferredIcpId, onAdded }: AddToListDialogProps) {
  const queryClient = useQueryClient();
  const focus = useDialogFocusReturn();
  const [list, setList] = useState<ProspectList | null>(null);
  const [createdId, setCreatedId] = useState<number | null>(null);

  const add = useMutation({
    mutationFn: (target: ProspectList) => api.lists.addMembers(target.id, prospectIds),
    onSuccess: (result, target) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.inbox });
      void queryClient.invalidateQueries({ queryKey: queryKeys.lists });
      void queryClient.invalidateQueries({ queryKey: queryKeys.prospects });
      toast({
        tone: 'success',
        title: joinParts([
          `${result.added} ${result.added === 1 ? 'aggiunto' : 'aggiunti'} a '${target.name}'`,
          `${result.skipped} già presenti`,
          result.not_found > 0 && `${result.not_found} non più presenti`,
          createdId === target.id && 'lista creata',
        ]),
        action: (
          <Link to="/lists/$id" params={{ id: String(target.id) }} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            Apri lista
          </Link>
        ),
      });
      onOpenChange(false);
      onAdded?.(result, target);
    },
  });

  useEffect(() => {
    if (open) {
      setList(null);
      setCreatedId(null);
      add.reset();
    }
    // Si azzera solo all'apertura (`add.reset` è stabile).
  }, [open]);

  const count = prospectIds.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg" showCloseButton={false} {...focus}>
        <DialogHeader>
          <DialogTitle>Aggiungi a lista</DialogTitle>
          <DialogDescription>
            {count} {count === 1 ? 'prospect selezionato' : 'prospect selezionati'}: scegli la lista o creane una nuova.
          </DialogDescription>
        </DialogHeader>

        <ListPicker
          value={list?.id ?? null}
          onChange={(_id, l) => setList(l)}
          onCreated={(l) => setCreatedId(l.id)}
          preferredIcpId={preferredIcpId}
          disabled={add.isPending}
        />

        {add.error && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            Aggiunta non riuscita: {add.error instanceof Error ? add.error.message : 'errore inatteso.'} La selezione è
            rimasta: puoi riprovare.
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Annulla
            </Button>
          </DialogClose>
          <Button
            type="button"
            disabled={!list || count === 0 || add.isPending}
            aria-busy={add.isPending}
            onClick={() => list && add.mutate(list)}
          >
            {add.isPending ? 'Aggiunta…' : list ? `Aggiungi ${count} a '${list.name}'` : 'Aggiungi'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
