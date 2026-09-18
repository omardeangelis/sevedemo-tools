import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, queryKeys } from '../api/client';
import type { ProspectList } from '../api/types';
import { cn } from '@/lib/utils';

export interface ListPickerProps {
  /** Id della lista selezionata (`null` = nessuna). */
  value: number | null;
  /** Selezione di una lista esistente o appena creata inline. */
  onChange: (listId: number, list: ProspectList) => void;
  /** Chiamata dopo la creazione inline (oltre a `onChange`), es. per il testo "· lista creata". */
  onCreated?: (list: ProspectList) => void;
  /**
   * ICP "suggerito" (FLOW H.3): il suo gruppo va in cima ed è evidenziato; se ha una sola lista
   * viene preselezionata (solo con `value === null`); è l'ICP di default del form "Crea nuova lista".
   */
  preferredIcpId?: number;
  /** Etichetta accessibile del gruppo (default "Lista di destinazione"). */
  label?: string;
  disabled?: boolean;
}

/**
 * Scelta della lista (radio) raggruppata per ICP, con **"Crea nuova lista"** inline (nome + ICP)
 * così il primo triage non è un vicolo cieco (FLOW A.5, C.3, D.2). Mostra solo le liste non
 * archiviate (le archiviate hanno i job disabilitati). Nessun `<form>` annidato: si può usare
 * dentro il form di un dialog (Invio nel nome crea la lista senza inviare il form esterno).
 *
 * @example
 * const [listId, setListId] = useState<number | null>(null);
 * <ListPicker value={listId} onChange={(id) => setListId(id)} preferredIcpId={icpId} />
 */
export function ListPicker({ value, onChange, onCreated, preferredIcpId, label = 'Lista di destinazione', disabled }: ListPickerProps) {
  const queryClient = useQueryClient();
  const uid = useId();
  const lists = useQuery({ queryKey: queryKeys.listsIndex(), queryFn: () => api.lists.list() });
  const icps = useQuery({ queryKey: queryKeys.icpsIndex, queryFn: api.icps.list });

  const icpItems = icps.data?.items ?? [];
  const listItems = lists.data?.items ?? [];

  const groups = useMemo(() => {
    const byIcp = new Map<number, { icpId: number; icpName: string; lists: ProspectList[] }>();
    for (const list of listItems) {
      const group = byIcp.get(list.icp_id) ?? { icpId: list.icp_id, icpName: list.icp.name, lists: [] };
      group.lists.push(list);
      byIcp.set(list.icp_id, group);
    }
    return [...byIcp.values()].sort((a, b) => {
      if (a.icpId === preferredIcpId) return -1;
      if (b.icpId === preferredIcpId) return 1;
      return a.icpName.localeCompare(b.icpName, 'it');
    });
  }, [listItems, preferredIcpId]);

  // Preselezione della lista dell'ICP suggerito, solo se è l'unica e nulla è già scelto (una volta).
  const preselected = useRef(false);
  useEffect(() => {
    if (preselected.current || value !== null || preferredIcpId === undefined || !lists.data) return;
    preselected.current = true;
    const own = listItems.filter((l) => l.icp_id === preferredIcpId);
    if (own.length === 1) onChange(own[0].id, own[0]);
  }, [lists.data, listItems, onChange, preferredIcpId, value]);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [icpId, setIcpId] = useState<number | null>(null);
  const noLists = lists.isSuccess && listItems.length === 0;
  const showForm = creating || noLists;
  const defaultIcpId = preferredIcpId ?? (icpItems.length === 1 ? icpItems[0].id : null);
  const chosenIcpId = icpId ?? defaultIcpId;

  const create = useMutation({
    mutationFn: () => api.lists.create({ icpId: chosenIcpId!, name: name.trim() }),
    onSuccess: (list) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.lists });
      void queryClient.invalidateQueries({ queryKey: queryKeys.icps });
      queryClient.setQueryData<{ items: ProspectList[] }>(queryKeys.listsIndex(), (cur) =>
        cur ? { items: [...cur.items, list] } : { items: [list] },
      );
      setCreating(false);
      setName('');
      setIcpId(null);
      onChange(list.id, list);
      onCreated?.(list);
    },
  });

  const nameError = create.error instanceof Error ? create.error.message : null;
  const canCreate = name.trim() !== '' && chosenIcpId !== null && !create.isPending && !disabled;
  const submitCreate = () => {
    if (canCreate) create.mutate();
  };

  if (lists.isPending || icps.isPending) {
    return <p className="text-sm text-slate-500">Caricamento liste…</p>;
  }
  if (lists.error || icps.error) {
    return (
      <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
        Impossibile caricare le liste: {((lists.error ?? icps.error) as Error).message}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-2"
          onClick={() => {
            void lists.refetch();
            void icps.refetch();
          }}
        >
          Riprova
        </Button>
      </div>
    );
  }
  if (icpItems.length === 0) {
    return (
      <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
        Prima crea un ICP: ogni lista appartiene a un ICP.{' '}
        <Link to={'/icps' as never} className="font-medium text-slate-900 underline">
          Crea ICP
        </Link>
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3" role="group" aria-label={label}>
      {groups.map((group) => (
        <fieldset
          key={group.icpId}
          disabled={disabled}
          className={cn(
            'rounded-lg border px-3 py-2',
            group.icpId === preferredIcpId ? 'border-slate-400 bg-slate-50' : 'border-slate-200',
          )}
        >
          <legend className="px-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">
            ICP: {group.icpName}
            {group.icpId === preferredIcpId && <span className="ml-1 font-normal normal-case">(suggerito)</span>}
          </legend>
          <div className="flex flex-col gap-1">
            {group.lists.map((list) => (
              <label key={list.id} className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-slate-100">
                <input
                  type="radio"
                  name={`${uid}-list`}
                  value={list.id}
                  checked={value === list.id}
                  onChange={() => onChange(list.id, list)}
                  className="size-4 accent-slate-900"
                />
                <span className="font-medium text-slate-900">{list.name}</span>
                <span className="text-xs text-slate-500">
                  {list.members_count} {list.members_count === 1 ? 'persona' : 'persone'}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}

      {showForm ? (
        <div className="flex flex-col gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-3">
          <p className="text-sm font-medium text-slate-900">{noLists ? 'Nessuna lista: creane una' : 'Crea nuova lista'}</p>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${uid}-name`} className="text-xs font-medium text-slate-600">
              Nome della lista
            </label>
            <Input
              id={`${uid}-name`}
              value={name}
              disabled={disabled}
              placeholder="es. CTO startup IT"
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? `${uid}-error` : undefined}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submitCreate();
                }
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${uid}-icp`} className="text-xs font-medium text-slate-600">
              ICP
            </label>
            <select
              id={`${uid}-icp`}
              value={chosenIcpId ?? ''}
              disabled={disabled}
              onChange={(e) => setIcpId(e.target.value ? Number(e.target.value) : null)}
              className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
            >
              {chosenIcpId === null && <option value="">Scegli l'ICP…</option>}
              {icpItems.map((icp) => (
                <option key={icp.id} value={icp.id}>
                  {icp.name}
                </option>
              ))}
            </select>
          </div>
          {nameError && (
            <p id={`${uid}-error`} role="alert" className="text-sm text-red-700">
              {nameError}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={submitCreate} disabled={!canCreate} aria-busy={create.isPending}>
              {create.isPending ? 'Creazione…' : 'Crea lista'}
            </Button>
            {!noLists && (
              <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(false)}>
                Annulla
              </Button>
            )}
          </div>
        </div>
      ) : (
        <Button type="button" variant="outline" size="sm" className="self-start" disabled={disabled} onClick={() => setCreating(true)}>
          + Crea nuova lista
        </Button>
      )}
    </div>
  );
}
