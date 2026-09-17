import { useId, useRef, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { isApiError } from '../api/client';
import type { Icp, IcpInput } from '../api/types';
import { addChips, ChipsInput } from './ChipsInput';

/*
 * Form ICP (crm-foundation T14, FLOW A.3), estratto da `routes/icps.$id.tsx` senza cambi di
 * comportamento (apollo-lookalike T12a): nome, descrizione, ruoli/settori/località come chip,
 * dimensione, pains, note. Usato in creazione (`/icps/nuovo`) e nel dettaglio.
 */

/** Body del salvataggio: nome obbligatorio, il resto come `IcpInput`. */
export type IcpBody = IcpInput & { name: string };

type ChipKey = 'target_roles' | 'target_industries' | 'target_locations';
type TextKey = 'name' | 'description' | 'company_size' | 'pains' | 'notes';

const labelCls = 'text-xs font-medium text-slate-600';
const textareaCls =
  'min-h-16 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

const CHIP_FIELDS: ReadonlyArray<{ key: ChipKey; label: string; item: string; placeholder: string; hint: string }> = [
  {
    key: 'target_roles',
    label: 'Ruoli target',
    item: 'ruolo',
    placeholder: 'es. CTO',
    hint: "Invio (o virgola) aggiunge il ruolo, non salva il form. Filtrano la ricerca di persone nelle aziende.",
  },
  {
    key: 'target_industries',
    label: 'Settori',
    item: 'settore',
    placeholder: 'es. Manifattura',
    hint: 'Invio (o virgola) aggiunge il settore, non salva il form.',
  },
  {
    key: 'target_locations',
    label: 'Località',
    item: 'località',
    placeholder: 'es. Lombardia',
    hint: 'Invio (o virgola) aggiunge la località, non salva il form.',
  },
];

const NO_DRAFTS: Record<ChipKey, string> = { target_roles: '', target_industries: '', target_locations: '' };

const orNull = (value: string) => (value.trim() === '' ? null : value.trim());

/** Messaggio leggibile di un errore di scrittura (messaggi zod se presenti). */
function errorText(err: unknown): string {
  if (isApiError(err) && err.body?.issues?.length) return err.body.issues.map((i) => i.message).join(' ');
  return err instanceof Error ? err.message : 'Operazione non riuscita.';
}

export function IcpForm({
  initial,
  submitLabel,
  onSave,
}: {
  initial: Icp | null;
  submitLabel: string;
  /** Salva (crea o aggiorna); un errore lanciato diventa inline. */
  onSave: (body: IcpBody) => Promise<unknown>;
}) {
  const uid = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState<Record<TextKey, string>>(() => ({
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    company_size: initial?.company_size ?? '',
    pains: initial?.pains ?? '',
    notes: initial?.notes ?? '',
  }));
  const [chips, setChips] = useState<Record<ChipKey, string[]>>(() => ({
    target_roles: initial?.target_roles ?? [],
    target_industries: initial?.target_industries ?? [],
    target_locations: initial?.target_locations ?? [],
  }));
  const [drafts, setDrafts] = useState(NO_DRAFTS);
  const [errors, setErrors] = useState<{ name?: string; form?: string }>({});
  const save = useMutation({ mutationFn: onSave });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const name = text.name.trim();
    if (!name) {
      setErrors({ name: 'Il nome è obbligatorio.' });
      nameRef.current?.focus();
      return;
    }
    // Il testo scritto in un campo a chip e non ancora confermato con Invio vale come chip.
    const committed = {
      target_roles: addChips(chips.target_roles, drafts.target_roles),
      target_industries: addChips(chips.target_industries, drafts.target_industries),
      target_locations: addChips(chips.target_locations, drafts.target_locations),
    };
    setChips(committed);
    setDrafts(NO_DRAFTS);
    setErrors({});
    save.mutate(
      {
        name,
        description: orNull(text.description),
        ...committed,
        company_size: orNull(text.company_size),
        pains: orNull(text.pains),
        notes: orNull(text.notes),
      },
      {
        onError: (err) => {
          const nameIssue = isApiError(err) ? err.body?.issues?.find((i) => i.path === 'name') : undefined;
          if (nameIssue) {
            setErrors({ name: nameIssue.message });
            nameRef.current?.focus();
          } else {
            setErrors({ form: errorText(err) });
          }
        },
      },
    );
  };

  const textProps = (key: TextKey) => ({
    id: `${uid}-${key}`,
    value: text[key],
    onChange: (e: { target: { value: string } }) => setText((cur) => ({ ...cur, [key]: e.target.value })),
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4 px-4 py-4">
      <div className="flex flex-col gap-1">
        <label htmlFor={`${uid}-name`} className={labelCls}>
          Nome<span aria-hidden="true"> *</span>
        </label>
        <Input
          ref={nameRef}
          {...textProps('name')}
          autoFocus={initial === null}
          placeholder="es. CTO di PMI manifatturiere"
          aria-required="true"
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? `${uid}-name-error` : undefined}
          onChange={(e) => {
            setText((cur) => ({ ...cur, name: e.target.value }));
            if (errors.name) setErrors((cur) => ({ ...cur, name: undefined }));
          }}
        />
        {errors.name && (
          <p id={`${uid}-name-error`} role="alert" className="text-sm text-red-700">
            {errors.name}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${uid}-description`} className={labelCls}>
          Descrizione
        </label>
        <textarea
          {...textProps('description')}
          rows={2}
          className={textareaCls}
          placeholder="Chi è, che problema ha, perché ti cerca."
        />
      </div>

      {CHIP_FIELDS.map((field) => (
        <ChipsInput
          key={field.key}
          id={`${uid}-${field.key}`}
          label={field.label}
          item={field.item}
          placeholder={field.placeholder}
          hint={field.hint}
          values={chips[field.key]}
          onValuesChange={(values) => setChips((cur) => ({ ...cur, [field.key]: values }))}
          draft={drafts[field.key]}
          onDraftChange={(draft) => setDrafts((cur) => ({ ...cur, [field.key]: draft }))}
        />
      ))}

      <div className="flex flex-col gap-1">
        <label htmlFor={`${uid}-company_size`} className={labelCls}>
          Dimensione azienda
        </label>
        <Input {...textProps('company_size')} placeholder="es. 50–250 dipendenti" />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${uid}-pains`} className={labelCls}>
          Pains
        </label>
        <textarea
          {...textProps('pains')}
          rows={3}
          className={textareaCls}
          placeholder="es. Sistemi legacy, integrazioni fragili, poco tempo del team IT."
        />
        <p className="text-xs text-slate-500">Senza pains né descrizione il fit dell'analisi AI è poco affidabile.</p>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${uid}-notes`} className={labelCls}>
          Note
        </label>
        <textarea {...textProps('notes')} rows={2} className={textareaCls} />
      </div>

      {errors.form && (
        <p role="alert" className="text-sm text-red-700">
          {errors.form}
        </p>
      )}
      <div>
        <Button type="submit" disabled={save.isPending} aria-busy={save.isPending}>
          {save.isPending ? 'Salvataggio…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}
