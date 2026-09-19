import { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2Icon, PlusIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { api, companyExistsOf, errorText, queryKeys } from '../api/client';
import type { CompanyWithRefs } from '../api/types';
import { useDebouncedKey } from '../lib/hooks';
import { toast } from './ui/toaster';

/*
 * Un solo picker d'azienda (people-first-crm FLOW Decisioni UX): campo Azienda del form, "Collega" e "Cambia
 * azienda" della scheda. Combobox sulle aziende del CRM per nome, dominio o pagina LinkedIn (D2); in fondo al menu
 * "Crea l'azienda '…'…" con un pannello inline alle regole di identità delle aziende (D3: almeno sito o pagina
 * LinkedIn; se la chiave è già di un'azienda del CRM si propone quella, "Collega quella").
 */

export interface PickedCompany {
  id: number;
  name: string;
  domain: string | null;
}

export function pickedOf(c: Pick<CompanyWithRefs, 'id' | 'name' | 'domain' | 'linkedin_url'>): PickedCompany {
  return { id: c.id, name: c.name ?? c.domain ?? c.linkedin_url ?? `Azienda #${c.id}`, domain: c.domain };
}

export interface CompanyPickerProps {
  /** Testo digitato (nel form: il nome dell'azienda "solo testo" se non se ne collega una). */
  text: string;
  onTextChange: (text: string) => void;
  /** Scelta di un'azienda esistente o appena creata (`created`: da "Crea e collega"). */
  onPick: (company: PickedCompany, created?: boolean) => void;
  /** Id del campo (label esterna con `htmlFor`). */
  inputId: string;
  /** Nome accessibile se non c'è una label esterna. */
  ariaLabel?: string;
  placeholder?: string;
  describedBy?: string;
  invalid?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Etichetta del form ("Crea l'azienda '…'…") e voce "Crea" anche prima dei risultati; altrimenti "Crea '…' come nuova azienda". */
  createAlways?: boolean;
}

const MAX_RESULTS = 8;

export function CompanyPicker(props: CompanyPickerProps) {
  const uid = useId();
  const listboxId = `${uid}-listbox`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const q = props.text.trim();
  const [debounced] = useDebouncedKey(q);
  const results = useQuery({
    queryKey: queryKeys.companiesIndex(debounced),
    queryFn: () => api.companies.list({ q: debounced }),
    enabled: open && debounced.length >= 1,
  });
  const items = (results.data?.items ?? []).slice(0, MAX_RESULTS);
  // "Crea …" sempre in fondo (un solo picker, D3): anche con risultati parziali ("Beta" con "Beta Payroll Srl").
  const showCreate = q !== '' && (props.createAlways || results.isSuccess);
  const options = [...items.map((c) => ({ kind: 'company' as const, company: c })), ...(showCreate ? [{ kind: 'create' as const }] : [])];

  // Prima azienda preselezionata; senza risultati nessuna voce attiva: Invio non apre "Crea …" (nel form invia).
  useEffect(() => setActive(items.length > 0 ? 0 : -1), [debounced, items.length]);

  const pick = (c: CompanyWithRefs) => {
    props.onPick(pickedOf(c));
    setOpen(false);
  };
  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    if (option.kind === 'company') pick(option.company);
    else {
      setOpen(false);
      setCreating(true);
    }
  };

  return (
    <div className="relative flex flex-col gap-1">
      <Input
        ref={inputRef}
        id={props.inputId}
        role="combobox"
        aria-expanded={open && q !== ''}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={open && options[active] ? `${uid}-opt-${active}` : undefined}
        aria-label={props.ariaLabel}
        aria-describedby={props.describedBy}
        aria-invalid={props.invalid ? true : undefined}
        autoComplete="off"
        autoFocus={props.autoFocus}
        disabled={props.disabled}
        placeholder={props.placeholder ?? 'Cerca per nome, sito o pagina LinkedIn'}
        value={props.text}
        onChange={(e) => {
          props.onTextChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => q !== '' && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(options.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter' && open && active >= 0 && active < options.length) {
            e.preventDefault();
            choose(active);
          } else if (e.key === 'Escape' && open) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }
        }}
        className="bg-white"
      />
      {open && q !== '' && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Aziende del CRM"
          className="absolute top-full z-40 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          {results.isFetching && items.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">Ricerca…</li>}
          {results.isSuccess && items.length === 0 && !results.isFetching && (
            <li className="px-3 py-2 text-sm text-slate-500">Nessuna azienda trovata per '{q}'.</li>
          )}
          {options.map((option, i) => (
            <li
              key={option.kind === 'company' ? option.company.id : 'create'}
              id={`${uid}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(i)}
              onMouseEnter={() => setActive(i)}
              className={cn('flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm', i === active && 'bg-slate-100')}
            >
              {option.kind === 'company' ? (
                <>
                  <Building2Icon className="size-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                  <span className="font-medium text-slate-900">{pickedOf(option.company).name}</span>
                  {option.company.domain && <span className="text-slate-500">· {option.company.domain}</span>}
                </>
              ) : (
                <>
                  <PlusIcon className="size-3.5 shrink-0 text-slate-500" aria-hidden="true" />
                  <span>{props.createAlways ? `Crea l'azienda '${q}'…` : `Crea '${q}' come nuova azienda`}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {creating && (
        <CreateCompanyPanel
          initialName={q}
          onCancel={() => {
            setCreating(false);
            inputRef.current?.focus();
          }}
          onPick={(c, created) => {
            setCreating(false);
            props.onPick(c, created);
          }}
        />
      )}
    </div>
  );
}

/** Testo cercato → campo giusto del pannello: una pagina LinkedIn o un sito incollati non finiscono nel Nome. */
function initialFields(text: string): { name: string; website: string; linkedin: string } {
  if (/linkedin\.com\/company\//i.test(text)) return { name: '', website: '', linkedin: text };
  if (!/\s/.test(text) && /^(https?:\/\/)?[^/\s]+\.[a-z]{2,}(\/|$)/i.test(text)) return { name: '', website: text, linkedin: '' };
  return { name: text, website: '', linkedin: '' };
}

/** Pannello inline "Crea l'azienda" (D3): Nome · Sito web · Pagina LinkedIn, almeno uno tra sito e pagina. */
function CreateCompanyPanel(props: { initialName: string; onCancel: () => void; onPick: (c: PickedCompany, created: boolean) => void }) {
  const { onCancel, onPick } = props;
  const uid = useId();
  const queryClient = useQueryClient();
  const [initial] = useState(() => initialFields(props.initialName));
  const [name, setName] = useState(initial.name);
  const [website, setWebsite] = useState(initial.website);
  const [linkedin, setLinkedin] = useState(initial.linkedin);
  const [keysError, setKeysError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => api.companies.create({ name: name.trim() || null, website: website.trim() || null, linkedin_url: linkedin.trim() || null }),
    onSuccess: (company) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.companies });
      toast({ title: `Azienda creata: ${pickedOf(company).name}` });
      onPick(pickedOf(company), true);
    },
  });
  const exists = companyExistsOf(create.error);
  /** Ogni modifica chiude l'esito del tentativo precedente (es. "acme.it è già di …"). */
  const edit = (setter: (v: string) => void, value: string) => {
    setter(value);
    if (create.isError) create.reset();
  };
  const submit = () => {
    if (!website.trim() && !linkedin.trim()) {
      setKeysError('Serve almeno il sito o la pagina LinkedIn.');
      return;
    }
    setKeysError(null);
    create.mutate();
  };

  return (
    <div role="group" aria-labelledby={`${uid}-title`} className="mt-1 flex flex-col gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3">
      <p id={`${uid}-title`} className="text-sm font-medium text-slate-900">
        Crea l'azienda
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Nome
          <Input value={name} onChange={(e) => edit(setName, e.target.value)} className="bg-white" autoFocus />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Sito web
          <Input value={website} onChange={(e) => edit(setWebsite, e.target.value)} placeholder="es. acme.it" className="bg-white" aria-describedby={`${uid}-hint`} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Pagina LinkedIn
          <Input
            value={linkedin}
            onChange={(e) => edit(setLinkedin, e.target.value)}
            placeholder="linkedin.com/company/…"
            className="bg-white"
            aria-describedby={`${uid}-hint`}
          />
        </label>
      </div>
      <p id={`${uid}-hint`} className={cn('text-xs', keysError ? 'text-red-700' : 'text-slate-500')} role={keysError ? 'alert' : undefined}>
        {keysError ?? 'Serve almeno il sito o la pagina LinkedIn.'}
      </p>
      {exists ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-red-800">
          <span>{exists.error}</span>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => onPick({ id: exists.company_id, name: exists.company_name, domain: null }, false)}
          >
            Collega quella
          </Button>
        </div>
      ) : (
        create.error && (
          <p role="alert" className="text-sm text-red-700">
            {errorText(create.error)}
          </p>
        )
      )}
      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={submit} disabled={create.isPending} aria-busy={create.isPending}>
          {create.isPending ? 'Creazione…' : 'Crea e collega'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Annulla
        </Button>
      </div>
    </div>
  );
}

/**
 * Chip "Collegata: Nuvola Srl" con × per togliere il collegamento (resta il testo). `autoFocus` quando compare al
 * posto del campo appena usato (scelta dal picker): il focus non cade sulla pagina.
 */
export function LinkedCompanyChip(props: { company: PickedCompany; onClear: () => void; disabled?: boolean; autoFocus?: boolean }) {
  const { company, onClear, disabled } = props;
  return (
    <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-emerald-50 py-1 pr-1 pl-2.5 text-sm text-emerald-900 ring-1 ring-emerald-200 ring-inset">
      <Building2Icon className="size-3.5" aria-hidden="true" />
      Collegata: <span className="font-medium">{company.name}</span>
      <button
        type="button"
        disabled={disabled}
        autoFocus={props.autoFocus}
        onClick={onClear}
        aria-label={`Togli il collegamento a ${company.name}`}
        className="inline-flex size-5 cursor-pointer items-center justify-center rounded-full hover:bg-emerald-100"
      >
        <XIcon className="size-3.5" aria-hidden="true" />
      </button>
    </span>
  );
}
