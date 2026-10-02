import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { api, errorText, isApiError, queryKeys } from '../../api/client';
import type { Profile, Service, ServiceInput } from '../../api/types';
import { useOpenSession } from '../../lib/hooks';
import { useDialogFocusReturn } from '../BulkBar';
import { Card } from '../ui';
import { toast, type ToastTone } from '../ui/toaster';
import { labelCls, Origin, td, textareaCls, th } from './parts';

/*
 * "I miei servizi" (own-profile-services T10, FLOW D): tabella ordinata dall'utente, aggiunta e modifica in un
 * dialog, riordino immediato con ↑ ↓, eliminazione con conferma (G7). Testo provvisorio (PLAN §10): la card vuota
 * non ha la CTA di generazione finché la generazione non esiste (T30).
 */

type Editing = { mode: 'create' } | { mode: 'edit'; service: Service };
type Dir = 'up' | 'down';
type FocusTarget = () => HTMLElement | null | undefined;

/** Aggiorna i servizi nella lettura unica del profilo (la pagina legge solo quella). */
function setServices(queryClient: ReturnType<typeof useQueryClient>, update: (services: Service[]) => Service[]) {
  queryClient.setQueryData<Profile>(queryKeys.profile, (profile) =>
    profile ? { ...profile, services: update(profile.services) } : profile,
  );
}

export function ServicesCard({ services }: { services: Service[] }) {
  const queryClient = useQueryClient();
  const uid = useId();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<Service | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const [announcement, setAnnouncement] = useState('');
  const [orderError, setOrderError] = useState<string | null>(null);

  const tableRef = useRef<HTMLTableElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  /** Dove va il focus alla chiusura di un dialog; `null` = chi l'ha aperto. */
  const returnTo = useRef<FocusTarget | null>(null);
  /** Bottone ↑/↓ da rimettere a fuoco dopo il riordino: React sposta la riga nel DOM e il focus cadrebbe su `body`. */
  const refocus = useRef<string | null>(null);
  /** Solo la risposta dell'ultimo riordino scrive l'elenco: una precedente non fa lampeggiare un ordine vecchio. */
  const lastOrder = useRef(0);

  const rowOf = (id: number) => tableRef.current?.querySelector<HTMLElement>(`tr[data-service="${id}"]`);

  // Deep-link `/settings/profile#servizi` (FLOW, ancore della pagina): la card arriva dopo il caricamento, quando lo
  // scroll del browser all'ancora è già passato.
  useEffect(() => {
    if (window.location.hash === '#servizi') document.getElementById('servizi')?.scrollIntoView();
  }, []);

  useLayoutEffect(() => {
    if (refocus.current === null) return;
    tableRef.current?.querySelector<HTMLElement>(`button[data-order="${refocus.current}"]`)?.focus();
    refocus.current = null;
  }, [services]);

  const reorder = useMutation({
    // Stesso `scope`: le richieste partono una dopo l'altra, così il server applica l'ultimo clic per ultimo.
    scope: { id: 'services-order' },
    mutationFn: ({ ids }: { ids: number[]; seq: number }) => api.services.reorder(ids),
    onMutate: async ({ ids }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.profile });
      const previous = queryClient.getQueryData<Profile>(queryKeys.profile)?.services;
      const byId = new Map(services.map((s) => [s.id, s]));
      setServices(queryClient, () => ids.map((id) => byId.get(id)!));
      return { previous };
    },
    onSuccess: (data, { seq }) => {
      if (seq === lastOrder.current) setServices(queryClient, () => data.items);
    },
    onError: (err, { seq }, context) => {
      if (seq !== lastOrder.current) return;
      if (context?.previous) setServices(queryClient, () => context.previous!);
      setAnnouncement('');
      setOrderError(`Ordine non salvato: ${errorText(err)}`);
    },
  });

  const move = (service: Service, dir: Dir) => {
    const from = services.findIndex((s) => s.id === service.id);
    const to = from + (dir === 'up' ? -1 : 1);
    if (from < 0 || to < 0 || to >= services.length) return;
    const ids = services.map((s) => s.id);
    [ids[from], ids[to]] = [ids[to], ids[from]];
    refocus.current = `${service.id}:${dir}`;
    setOrderError(null);
    setAnnouncement(`«${service.name}» è ora ${to + 1} di ${services.length}.`);
    reorder.mutate({ ids, seq: ++lastOrder.current });
  };

  /** Scrittura riuscita dalla card: l'avviso di un riordino fallito non vale più. */
  const afterWrite = (focus: FocusTarget | null) => {
    returnTo.current = focus;
    setOrderError(null);
  };

  const openDialog = (next: Editing) => {
    returnTo.current = null;
    setEditing(next);
  };

  const toggle = (id: number) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Card id="servizi" title="I miei servizi" className="scroll-mt-6">
      <div className="flex flex-col gap-3 px-4 py-4">
        <p className="text-xs text-slate-500">
          Cosa vendi, un servizio per riga. L'ordine lo decidi tu: l'analisi e (in futuro) l'assistente ICP li leggono così.
        </p>
        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>
        {orderError && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200 ring-inset">
            {orderError}
          </p>
        )}

        {services.length === 0 ? (
          <div className="flex flex-col items-start gap-3 py-2">
            <p className="text-sm text-slate-600">Nessun servizio. Aggiungine uno a mano.</p>
            <Button ref={addRef} type="button" onClick={() => openDialog({ mode: 'create' })}>
              Aggiungi servizio
            </Button>
          </div>
        ) : (
          <>
            <div className="-mx-4 overflow-x-auto">
              <table ref={tableRef} className="w-full">
                <caption className="sr-only">I miei servizi, in ordine</caption>
                <thead className="border-y border-slate-100">
                  <tr>
                    {['Ordine', 'Nome', 'A chi serve', 'Problema', 'Provenienza'].map((label) => (
                      <th key={label} scope="col" className={th}>
                        {label}
                      </th>
                    ))}
                    <th scope="col" className={th}>
                      <span className="sr-only">Azioni</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {services.map((service, index) => (
                    <ServiceRow
                      key={service.id}
                      service={service}
                      position={index + 1}
                      count={services.length}
                      detailsId={`${uid}-details-${service.id}`}
                      open={expanded.has(service.id)}
                      onToggle={() => toggle(service.id)}
                      onMove={(dir) => move(service, dir)}
                      onEdit={() => openDialog({ mode: 'edit', service })}
                      onDelete={() => {
                        returnTo.current = null;
                        setDeleting(service);
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <Button ref={addRef} type="button" variant="outline" onClick={() => openDialog({ mode: 'create' })}>
                Aggiungi servizio
              </Button>
            </div>
          </>
        )}
      </div>

      <ServiceDialog
        editing={editing}
        onClose={() => setEditing(null)}
        onSaved={(service, created) => {
          // Dopo un'aggiunta il focus va alla riga nuova; dopo una modifica torna su "Modifica".
          afterWrite(created ? () => rowOf(service.id) : null);
          setEditing(null);
        }}
        returnFocusTo={() => returnTo.current?.()}
      />
      <DeleteServiceDialog
        service={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={(service) => {
          // Il focus va alla riga che prende il suo posto (o alla precedente), mai su `body`.
          const index = services.findIndex((s) => s.id === service.id);
          const next = services[index + 1] ?? services[index - 1];
          afterWrite(() => (next ? rowOf(next.id) : addRef.current));
          setDeleting(null);
        }}
        returnFocusTo={() => returnTo.current?.()}
      />
    </Card>
  );
}

function ServiceRow(props: {
  service: Service;
  position: number;
  count: number;
  detailsId: string;
  open: boolean;
  onToggle: () => void;
  onMove: (dir: Dir) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { service } = props;
  const hasDetails = Boolean(service.description || service.proof || service.notes);
  const open = hasDetails && props.open;
  const orderButton = (dir: Dir) => {
    const edge = dir === 'up' ? props.position === 1 : props.position === props.count;
    const Icon = dir === 'up' ? ArrowUpIcon : ArrowDownIcon;
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        data-order={`${service.id}:${dir}`}
        // `aria-disabled` e non `disabled`: il bottone premuto resta a fuoco anche arrivato in cima.
        aria-disabled={edge || undefined}
        aria-label={`Sposta «${service.name}» ${dir === 'up' ? 'su' : 'giù'}`}
        onClick={() => {
          if (!edge) props.onMove(dir);
        }}
      >
        <Icon />
      </Button>
    );
  };

  return (
    <Fragment>
      <tr
        data-service={service.id}
        tabIndex={-1}
        className="outline-none focus-visible:bg-slate-50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
      >
        <td className={cn(td, 'whitespace-nowrap')}>
          <span className="inline-flex items-center gap-1">
            <span className="w-5 text-right text-slate-500 tabular-nums">{props.position}</span>
            {orderButton('up')}
            {orderButton('down')}
          </span>
        </td>
        <td className={cn(td, 'font-medium text-slate-900')}>{service.name}</td>
        <td className={cn(td, 'max-w-56 text-slate-700')}>{service.audience ?? '—'}</td>
        <td className={cn(td, 'max-w-64 text-slate-700')}>{service.problem ?? '—'}</td>
        <td className={cn(td, 'whitespace-nowrap')}>
          <Origin origin={service.origin} at={service.origin_at} />
        </td>
        <td className={cn(td, 'whitespace-nowrap text-right')}>
          <span className="inline-flex gap-1">
            {hasDetails && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-expanded={open}
                aria-controls={open ? props.detailsId : undefined}
                aria-label={`Dettagli di «${service.name}»`}
                onClick={props.onToggle}
              >
                Dettagli
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" aria-label={`Modifica «${service.name}»`} onClick={props.onEdit}>
              Modifica
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              aria-label={`Elimina «${service.name}»`}
              onClick={props.onDelete}
            >
              Elimina
            </Button>
          </span>
        </td>
      </tr>
      {open && (
        <tr id={props.detailsId}>
          <td />
          <td colSpan={5} className={cn(td, 'pt-0')}>
            <dl className="grid gap-2 text-sm sm:grid-cols-3">
              {(
                [
                  ['Descrizione', service.description],
                  ['Prove e risultati', service.proof],
                  ['Note', service.notes],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt className={labelCls}>{label}</dt>
                  <dd className="whitespace-pre-line text-slate-700">{value ?? '—'}</dd>
                </div>
              ))}
            </dl>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

// ---------------------------------------------------------------------------
// Aggiungi / modifica
// ---------------------------------------------------------------------------

const FIELDS = [
  { key: 'audience', label: 'A chi serve', rows: 2 },
  { key: 'problem', label: 'Problema che risolve', rows: 2 },
  { key: 'description', label: 'Descrizione', rows: 3 },
  { key: 'proof', label: 'Prove e risultati', rows: 2 },
  { key: 'notes', label: 'Note', rows: 2 },
] as const;

type Values = Record<'name' | (typeof FIELDS)[number]['key'], string>;

const valuesOf = (service?: Service): Values =>
  Object.fromEntries(['name', ...FIELDS.map((f) => f.key)].map((k) => [k, service?.[k as keyof Values] ?? ''])) as Values;

interface ServiceDialogProps {
  editing: Editing | null;
  onClose: () => void;
  onSaved: (service: Service, created: boolean) => void;
  returnFocusTo: FocusTarget;
}

/** Ogni apertura rimonta il dialog: valori ed errori ripartono dal servizio (o vuoti). */
function ServiceDialog(props: ServiceDialogProps) {
  const session = useOpenSession(props.editing !== null);
  return <ServiceDialogSession key={session} {...props} />;
}

function ServiceDialogSession(props: ServiceDialogProps) {
  const queryClient = useQueryClient();
  const uid = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const focus = useDialogFocusReturn(props.returnFocusTo);
  // Quello aperto in questa sessione: resta durante l'animazione di chiusura, quando `editing` è già `null`.
  const [editing] = useState(props.editing);
  const edit = editing?.mode === 'edit' ? editing.service : undefined;
  // I testi di un tentativo fallito restano finché il dialog è aperto (FLOW: "dopo un errore i valori restano").
  const [values, setValues] = useState(() => valuesOf(edit));
  const [nameError, setNameError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: ServiceInput) => (edit ? api.services.update(edit.id, body) : api.services.create(body)),
    onSuccess: (service) => {
      setServices(queryClient, (list) => (edit ? list.map((s) => (s.id === service.id ? service : s)) : [...list, service]));
      toast({ title: edit ? `Servizio salvato: ${service.name}` : `Servizio aggiunto: ${service.name}` });
      props.onSaved(service, !edit);
    },
    onError: (err) => {
      if (isApiError(err, 'service_exists')) {
        setNameError(err.message);
        nameRef.current?.focus();
      } else if (isApiError(err) && err.status === 404) {
        // Eliminato da un'altra scheda: l'elenco si riallinea, il dialog dice cosa è successo.
        void queryClient.invalidateQueries({ queryKey: queryKeys.profile });
      }
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (values.name.trim() === '') {
      setNameError('Inserisci il nome del servizio.');
      nameRef.current?.focus();
      return;
    }
    save.mutate(values);
  };

  const otherError = save.error && !isApiError(save.error, 'service_exists') ? errorText(save.error) : null;
  // Il bottone era disabilitato durante il salvataggio: dopo un errore che non riguarda il nome il focus torna su
  // "Salva servizio", per riprovare (mai `body`).
  const submitRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (otherError) submitRef.current?.focus();
  }, [otherError]);

  return (
    <Dialog
      open={props.editing !== null}
      onOpenChange={(open) => {
        if (!open && !save.isPending) props.onClose();
      }}
    >
      <DialogContent
        className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg"
        onOpenAutoFocus={(event) => {
          focus.onOpenAutoFocus();
          event.preventDefault();
          nameRef.current?.focus();
        }}
        onCloseAutoFocus={focus.onCloseAutoFocus}
        aria-describedby={`${uid}-hint`}
      >
        <DialogHeader>
          <DialogTitle>{edit ? 'Modifica servizio' : 'Aggiungi servizio'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="flex flex-col gap-3">
          <p id={`${uid}-hint`} className="text-xs text-slate-500">
            Basta il nome: il resto è facoltativo.
          </p>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${uid}-name`} className={labelCls}>
              Nome <span className="font-normal text-slate-500">(obbligatorio)</span>
            </label>
            <Input
              ref={nameRef}
              id={`${uid}-name`}
              value={values.name}
              required
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? `${uid}-name-error` : undefined}
              placeholder="es. Fractional CTO"
              onChange={(e) => {
                setValues((cur) => ({ ...cur, name: e.target.value }));
                if (nameError) setNameError(null);
              }}
            />
            {nameError && (
              <p id={`${uid}-name-error`} role="alert" className="text-sm text-red-700">
                {nameError}
              </p>
            )}
          </div>
          {FIELDS.map(({ key, label, rows }) => (
            <div key={key} className="flex flex-col gap-1">
              <label htmlFor={`${uid}-${key}`} className={labelCls}>
                {label}
              </label>
              <textarea
                id={`${uid}-${key}`}
                className={textareaCls}
                rows={rows}
                value={values[key]}
                onChange={(e) => setValues((cur) => ({ ...cur, [key]: e.target.value }))}
              />
            </div>
          ))}
          {otherError && (
            <p role="alert" className="text-sm text-red-700">
              {otherError}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={save.isPending} onClick={props.onClose}>
              Annulla
            </Button>
            <Button ref={submitRef} type="submit" disabled={save.isPending} aria-busy={save.isPending}>
              {save.isPending ? 'Salvataggio…' : 'Salva servizio'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Elimina, con conferma (G7)
// ---------------------------------------------------------------------------

interface DeleteServiceDialogProps {
  service: Service | null;
  onClose: () => void;
  onDeleted: (service: Service) => void;
  returnFocusTo: FocusTarget;
}

function DeleteServiceDialog(props: DeleteServiceDialogProps) {
  const session = useOpenSession(props.service !== null);
  return <DeleteServiceSession key={session} {...props} />;
}

function DeleteServiceSession(props: DeleteServiceDialogProps) {
  const queryClient = useQueryClient();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const focus = useDialogFocusReturn(props.returnFocusTo);
  // Il nome resta durante l'animazione di chiusura, quando `service` è già `null`.
  const [target] = useState(props.service);

  const gone = (service: Service, title: string, tone?: ToastTone) => {
    setServices(queryClient, (list) => list.filter((s) => s.id !== service.id));
    toast({ title, tone });
    props.onDeleted(service);
  };

  const remove = useMutation({
    mutationFn: (service: Service) => api.services.remove(service.id),
    onSuccess: (_data, service) => gone(service, `Servizio eliminato: ${service.name}.`),
    onError: (err, service) => {
      // Già eliminato altrove: il risultato è quello voluto, l'elenco si riallinea.
      if (isApiError(err) && err.status === 404) gone(service, `Il servizio «${service.name}» era già stato eliminato.`, 'neutral');
    },
  });

  const failed = remove.error && !(isApiError(remove.error) && remove.error.status === 404);
  // Come nel dialog del servizio: dopo un errore il focus torna su "Elimina servizio", per riprovare.
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (failed) confirmRef.current?.focus();
  }, [failed]);

  return (
    <Dialog
      open={props.service !== null}
      onOpenChange={(open) => {
        if (!open && !remove.isPending) props.onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          focus.onOpenAutoFocus();
          event.preventDefault();
          cancelRef.current?.focus();
        }}
        onCloseAutoFocus={focus.onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>Eliminare il servizio «{target?.name}»?</DialogTitle>
          {/* FLOW D.4: la conseguenza sulle analisi prima del gesto (F5, F7). */}
          <DialogDescription>
            Le analisi che lo citano restano come sono e continueranno a mostrare questo nome. Nessuna analisi risulta da
            rifare: se ne vuoi una aggiornata la rifai tu.
          </DialogDescription>
        </DialogHeader>
        {failed && (
          <p role="alert" className="text-sm text-red-700">
            Servizio non eliminato: {errorText(remove.error)}
          </p>
        )}
        <DialogFooter>
          <Button ref={cancelRef} type="button" variant="outline" disabled={remove.isPending} onClick={props.onClose}>
            Annulla
          </Button>
          <Button
            ref={confirmRef}
            type="button"
            variant="destructive"
            disabled={remove.isPending}
            aria-busy={remove.isPending}
            onClick={() => target && remove.mutate(target)}
          >
            {remove.isPending ? 'Eliminazione…' : 'Elimina servizio'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
