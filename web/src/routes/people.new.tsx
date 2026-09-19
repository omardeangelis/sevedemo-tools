import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useBlocker, useNavigate } from '@tanstack/react-router';
import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { api, errorText, isApiError, queryKeys } from '../api/client';
import {
  PROSPECT_STATUSES,
  STATUS_LABELS,
  type CreatePersonInput,
  type Duplicates,
  type PersonRef,
  type ProspectList,
  type ProspectStatus,
} from '../api/types';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { CompanyPicker, LinkedCompanyChip, pickedOf, type PickedCompany } from '../components/CompanyPicker';
import { MeetingSummary, PersonRefLine } from '../components/DuplicatePanel';
import { ListPicker } from '../components/ListPicker';
import { NextActionFields, type NextActionValue } from '../components/NextActionFields';
import { searchParam } from '../components/ProspectTable';
import { invalidateProspectViews } from '../components/StatusSelect';
import { PageHeader } from '../components/ui';
import { toast } from '../components/ui/toaster';
import { fmtDayMonth, useToday } from '../lib/dates';

/*
 * Aggiungi persona (people-first-crm C1–C11, FLOW A): una pagina, non un dialog (tanti campi, URL con le
 * precompilazioni, ciclo "Salva e aggiungi un'altra", guard d'uscita). Quattro gruppi: Persona · Recapiti · Incontro
 * · Nel CRM. I doppioni si controllano all'uscita dal campo (gratis, locale) e il server resta la verità (corse):
 * LinkedIn già nel CRM blocca, email già usata chiede una scelta, stesso nome avvisa. "Aggiungi l'incontro a
 * <persona>" è una scelta nel form con gli stessi due bottoni di salvataggio.
 */

interface NewPersonSearch {
  /** Azienda già compilata e collegata (dalla scheda azienda). */
  company?: number;
  /** Nome già compilato (dalla ricerca globale), solo al primo caricamento. */
  name?: string;
}

export const Route = createFileRoute('/people/new')({
  validateSearch: (s: Record<string, unknown>): NewPersonSearch => ({ company: searchParam.id(s.company), name: searchParam.text(s.name) }),
  component: AddPersonPage,
});

interface FormState {
  fullName: string;
  title: string;
  companyText: string;
  company: PickedCompany | null;
  location: string;
  linkedinUrl: string;
  email: string;
  phone: string;
  context: string;
  metOn: string;
  listId: number | null;
  listName: string | null;
  status: ProspectStatus;
  nextAction: NextActionValue;
}

function emptyForm(today: string, name = ''): FormState {
  return {
    fullName: name,
    title: '',
    companyText: '',
    company: null,
    location: '',
    linkedinUrl: '',
    email: '',
    phone: '',
    context: '',
    metOn: today,
    listId: null,
    listName: null,
    status: 'nuovo',
    nextAction: { on: '', text: '' },
  };
}

/** Scelta sui doppioni: aggiungere l'incontro a una persona esistente, o creare comunque (C8). */
type Choice = { kind: 'meeting'; person: PersonRef } | { kind: 'create' } | null;

type FieldErrors = Partial<Record<'fullName' | 'contacts' | 'linkedinUrl' | 'email' | 'nextAction' | 'metOn' | 'list' | 'company' | 'choice' | 'linkedinChoice', string>>;

const NO_DUPS: Duplicates = { linkedin: null, email: [], name: [] };
const LINKEDIN_PROFILE_RE = /linkedin\.com\/in\/[^/?#\s]+/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COMPANY_GONE = "Azienda non trovata: forse è stata unita a un'altra. Cercala di nuovo.";

const orNull = (v: string) => (v.trim() === '' ? null : v.trim());

function AddPersonPage() {
  const search = Route.useSearch();
  const today = useToday();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const uid = useId();
  const id = (f: string) => `${uid}-${f}`;

  const [form, setForm] = useState<FormState>(() => emptyForm(today, search.name ?? ''));
  const [base, setBase] = useState<FormState>(() => emptyForm(today, search.name ?? ''));
  /** Scelta o rimozione dell'azienda fatta dall'utente: il controllo che prende il posto dell'altro riceve il focus. */
  const [companyTouched, setCompanyTouched] = useState(false);
  const [dups, setDups] = useState<Duplicates>(NO_DUPS);
  const [choice, setChoice] = useState<Choice>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [added, setAdded] = useState<Array<{ id: number; name: string; meeting: boolean }>>([]);
  const [kept, setKept] = useState(false);
  const [live, setLive] = useState('');
  const leaving = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  // `?company=`: azienda già compilata e collegata (resta anche dopo "Salva e aggiungi un'altra", C4).
  const presetCompany = useQuery({
    queryKey: queryKeys.company(search.company ?? 0),
    queryFn: () => api.companies.get(search.company!),
    enabled: search.company !== undefined,
    retry: false,
  });
  const presetApplied = useRef(false);
  useEffect(() => {
    if (presetApplied.current) return;
    if (presetCompany.data) {
      presetApplied.current = true;
      const c = pickedOf(presetCompany.data);
      setForm((f) => ({ ...f, company: c }));
      setBase((b) => ({ ...b, company: c }));
    } else if (presetCompany.error) {
      presetApplied.current = true;
      setErrors((e) => ({ ...e, company: "Azienda non trovata: forse è stata unita a un'altra." }));
    }
  }, [presetCompany.data, presetCompany.error]);

  const dirty = JSON.stringify(form) !== JSON.stringify(base);
  const blocker = useBlocker({
    shouldBlockFn: () => dirty && !leaving.current,
    enableBeforeUnload: () => dirty && !leaving.current,
    withResolver: true,
  });

  // --- Doppioni all'uscita dai campi (C7, C8, C10) ---
  const checkDuplicates = async (next: FormState = form) => {
    const query = { linkedinUrl: orNull(next.linkedinUrl) ?? undefined, email: orNull(next.email) ?? undefined, name: orNull(next.fullName) ?? undefined };
    if (!query.linkedinUrl && !query.email && !query.name) {
      setDups(NO_DUPS);
      setChoice(null);
      return NO_DUPS;
    }
    try {
      const found = await api.prospects.duplicates(query);
      setDups(found);
      setChoice((c) => {
        if (c?.kind !== 'meeting') return c && found.email.length > 0 ? c : null;
        const all = [found.linkedin, ...found.email, ...found.name].filter(Boolean) as PersonRef[];
        return all.some((p) => p.id === c.person.id) ? c : null;
      });
      return found;
    } catch {
      return dups; // il controllo è un aiuto: il server resta la verità al salvataggio
    }
  };

  // --- Validazione di C3 (i messaggi sono quelli del server) ---
  const validate = (): FieldErrors => {
    const e: FieldErrors = {};
    if (!form.fullName.trim()) e.fullName = 'Inserisci il nome.';
    if (!form.linkedinUrl.trim() && !form.email.trim() && !form.phone.trim()) e.contacts = 'Serve almeno un recapito: profilo LinkedIn, email o telefono.';
    if (form.linkedinUrl.trim() && !LINKEDIN_PROFILE_RE.test(form.linkedinUrl)) {
      e.linkedinUrl = 'Non è il profilo di una persona: usa un URL del tipo https://www.linkedin.com/in/nome-cognome/';
    }
    if (form.email.trim() && !EMAIL_RE.test(form.email.trim())) e.email = 'Email non valida (es. nome@azienda.it).';
    if (!form.nextAction.on && form.nextAction.text.trim()) e.nextAction = 'Scegli la data della prossima azione.';
    return e;
  };

  const FOCUS_ORDER: Array<[keyof FieldErrors, string]> = [
    ['fullName', 'fullName'],
    ['company', 'company'],
    ['contacts', 'linkedinUrl'],
    ['linkedinUrl', 'linkedinUrl'],
    ['email', 'email'],
    ['linkedinChoice', 'linkedinChoice'],
    ['choice', 'choice'],
    ['metOn', 'metOn'],
    ['list', 'list'],
    ['nextAction', 'nextActionDate'],
  ];
  const focusFirst = (e: FieldErrors) => {
    const target = FOCUS_ORDER.find(([key]) => e[key]);
    if (target) document.getElementById(id(target[1]))?.focus();
  };

  const meetingBody = () => ({
    context: orNull(form.context),
    metOn: form.metOn || null,
    listId: form.listId,
    nextAction: form.nextAction.on ? { on: form.nextAction.on, text: orNull(form.nextAction.text) } : null,
  });

  const afterSave = (result: { id: number; name: string; meeting: boolean }, mode: 'open' | 'another') => {
    void invalidateProspectViews(queryClient);
    const title = result.meeting ? `Incontro aggiunto a ${result.name}` : `Persona aggiunta: ${result.name}`;
    if (mode === 'open') {
      leaving.current = true;
      toast({ title });
      void navigate({ to: '/people/$id', params: { id: String(result.id) } });
      return;
    }
    toast({
      title,
      action: (
        <Link to="/people/$id" params={{ id: String(result.id) }} className="font-semibold underline">
          Apri scheda
        </Link>
      ),
    });
    // C4: restano contesto, data, lista, stato iniziale (e l'azienda se il form viene da una scheda azienda).
    const next: FormState = {
      ...emptyForm(today),
      context: form.context,
      metOn: form.metOn,
      listId: form.listId,
      listName: form.listName,
      status: form.status,
      company: search.company !== undefined ? form.company : null,
    };
    setForm(next);
    setBase(next);
    setKept(true);
    setDups(NO_DUPS);
    setChoice(null);
    setErrors({});
    setAdded((a) => [...a, result]);
    setLive(`${title}. Il form è pronto per la prossima.`);
    setCompanyTouched(false);
    nameRef.current?.focus();
  };

  const save = useMutation({
    mutationFn: async (mode: 'open' | 'another') => {
      if (choice?.kind === 'meeting') {
        const res = await api.prospects.addMeeting(choice.person.id, meetingBody());
        return { mode, result: { id: res.prospect.id, name: res.prospect.full_name ?? 'la persona', meeting: true } };
      }
      const body: CreatePersonInput = {
        fullName: form.fullName.trim(),
        title: orNull(form.title),
        ...(form.company ? { companyId: form.company.id } : { companyName: orNull(form.companyText) }),
        linkedinUrl: orNull(form.linkedinUrl),
        email: orNull(form.email),
        phone: orNull(form.phone),
        location: orNull(form.location),
        meeting: { context: orNull(form.context), metOn: form.metOn || null },
        listId: form.listId,
        status: form.status,
        nextAction: form.nextAction.on ? { on: form.nextAction.on, text: orNull(form.nextAction.text) } : null,
        createAnyway: choice?.kind === 'create',
      };
      const created = await api.prospects.create(body);
      return { mode, result: { id: created.id, name: created.full_name ?? body.fullName, meeting: false } };
    },
    onSuccess: ({ mode, result }) => afterSave(result, mode),
    onError: async (err) => {
      const e: FieldErrors = {};
      if (isApiError(err, 'linkedin_taken') && err.body?.prospect) {
        // Corsa: il profilo è arrivato nel CRM dopo il controllo all'uscita dal campo.
        setDups((d) => ({ ...d, linkedin: err.body!.prospect as PersonRef }));
        setChoice(null);
        e.linkedinChoice = 'Questo profilo LinkedIn è già nel CRM: aggiungi l\'incontro a questa persona o cambia URL.';
      } else if (isApiError(err, 'email_taken') && Array.isArray(err.body?.prospects)) {
        setDups((d) => ({ ...d, email: err.body!.prospects as PersonRef[] }));
        e.choice = 'Scegli se aggiungere l\'incontro a una persona esistente o crearne una nuova.';
      } else if (isApiError(err, 'prospect_not_found') && choice?.kind === 'meeting') {
        // La persona scelta è stata unita a un'altra nel frattempo: si ricalcolano i doppioni.
        setChoice(null);
        setSaveError(`${choice.person.full_name ?? 'La persona'} non è più nel CRM (forse unita a un'altra persona): ricontrollo i doppioni.`);
        await checkDuplicates();
        return;
      } else if (isApiError(err, 'list_archived') || isApiError(err, 'list_not_found')) {
        e.list = err.message;
      } else if (isApiError(err, 'company_not_found')) {
        setForm((f) => ({ ...f, company: null }));
        e.company = COMPANY_GONE;
      } else if (isApiError(err) && err.status === 400 && err.body?.issues?.length) {
        for (const issue of err.body.issues) {
          const key = issue.path === 'nextAction.on' ? 'nextAction' : issue.path === 'meeting.metOn' ? 'metOn' : (issue.path as keyof FieldErrors);
          e[key] = issue.message;
        }
      } else {
        setSaveError(`Salvataggio non riuscito: ${errorText(err).replace(/[.\s]+$/, '')}. I dati inseriti sono ancora qui.`);
        return;
      }
      setErrors(e);
      focusFirst(e);
    },
  });

  const submit = (mode: 'open' | 'another') => {
    setSaveError(null);
    const e = validate();
    if (choice?.kind !== 'meeting') {
      if (dups.linkedin) e.linkedinChoice = `Questo profilo LinkedIn è già nel CRM: scegli "Aggiungi l'incontro a ${dups.linkedin.full_name ?? 'questa persona'}" o cambia URL.`;
      else if (dups.email.length > 0 && choice?.kind !== 'create') e.choice = "Scegli se aggiungere l'incontro a una persona esistente o crearne una nuova.";
    } else {
      // Aggiungere l'incontro a una persona esistente: contano solo i campi dell'incontro (C9).
      delete e.fullName;
      delete e.contacts;
      delete e.linkedinUrl;
      delete e.email;
    }
    setErrors(e);
    if (Object.keys(e).length > 0) {
      focusFirst(e);
      return;
    }
    save.mutate(mode);
  };

  const onSubmit = (ev: FormEvent) => {
    ev.preventDefault();
    submit('open');
  };

  const clearAll = () => {
    const next = emptyForm(today);
    setForm(next);
    setBase(next);
    setKept(false);
    setDups(NO_DUPS);
    setChoice(null);
    setErrors({});
    setCompanyTouched(false);
    nameRef.current?.focus();
  };

  const summaryInput = {
    metOn: form.metOn || today,
    hasContext: form.context.trim() !== '',
    listName: form.listName,
    nextAction: form.nextAction.on ? { on: form.nextAction.on, text: form.nextAction.text } : null,
  };
  const isChosen = (p: PersonRef) => choice?.kind === 'meeting' && choice.person.id === p.id;
  // Una scelta dell'utente sui doppioni risolve l'errore che la chiedeva.
  const choose = (next: Choice) => {
    setChoice(next);
    setErrors((e) => ({ ...e, choice: undefined, linkedinChoice: undefined }));
  };
  const toggleMeeting = (p: PersonRef) => choose(isChosen(p) ? null : { kind: 'meeting', person: p });
  const pending = save.isPending;
  const keptParts = [
    form.context.trim() && `'${form.context.trim().slice(0, 40)}${form.context.trim().length > 40 ? '…' : ''}'`,
    form.metOn && fmtDayMonth(form.metOn),
    form.listName && `lista '${form.listName}'`,
    `stato ${STATUS_LABELS[form.status]}`,
    search.company !== undefined && form.company && `azienda ${form.company.name}`,
  ].filter(Boolean);

  return (
    <>
      <Breadcrumbs items={[{ label: 'Persone', to: '/people' }, { label: 'Aggiungi persona' }]} />
      <PageHeader title="Aggiungi persona" subtitle="Bastano il nome e un recapito. Non avvia job e non costa nulla." />

      {kept && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
          <span>Restano per la prossima persona: {keptParts.join(' · ')}.</span>
          <Button type="button" size="xs" variant="outline" onClick={clearAll}>
            Svuota tutto
          </Button>
        </div>
      )}

      <form onSubmit={onSubmit} noValidate className="flex max-w-3xl flex-col gap-5" aria-label="Aggiungi persona">
        <Group legend="Persona">
          <Field id={id('fullName')} label="Nome" required error={errors.fullName}>
            <Input
              ref={nameRef}
              id={id('fullName')}
              autoFocus
              value={form.fullName}
              maxLength={300}
              onChange={(e) => set('fullName', e.target.value)}
              onBlur={() => void checkDuplicates()}
              aria-invalid={errors.fullName ? true : undefined}
              aria-describedby={errors.fullName ? `${id('fullName')}-error` : undefined}
              className="bg-white"
            />
          </Field>
          <Field id={id('title')} label="Ruolo">
            <Input id={id('title')} value={form.title} maxLength={300} onChange={(e) => set('title', e.target.value)} className="bg-white" />
          </Field>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label htmlFor={id('company')} className="text-xs font-medium text-slate-600">
              Azienda
            </label>
            {form.company ? (
              <LinkedCompanyChip
                company={form.company}
                disabled={pending}
                autoFocus={companyTouched}
                onClear={() => {
                  setCompanyTouched(true);
                  setForm((f) => ({ ...f, company: null, companyText: f.company?.name ?? '' }));
                }}
              />
            ) : (
              <CompanyPicker
                inputId={id('company')}
                text={form.companyText}
                onTextChange={(t) => {
                  set('companyText', t);
                  if (errors.company) setErrors((e) => ({ ...e, company: undefined }));
                }}
                onPick={(c) => {
                  setCompanyTouched(true);
                  setForm((f) => ({ ...f, company: c, companyText: '' }));
                }}
                autoFocus={companyTouched}
                createAlways
                invalid={Boolean(errors.company)}
                describedBy={errors.company ? `${id('company')}-error` : form.companyText.trim() ? `${id('company')}-hint` : undefined}
                disabled={pending}
              />
            )}
            {errors.company ? (
              <p id={`${id('company')}-error`} role="alert" className="text-xs text-red-700">
                {errors.company}
              </p>
            ) : (
              !form.company &&
              form.companyText.trim() && (
                <p id={`${id('company')}-hint`} className="text-xs text-slate-500">
                  Non collegata: potrai collegarla dalla scheda.
                </p>
              )
            )}
          </div>
          <Field id={id('location')} label="Località">
            <Input id={id('location')} value={form.location} maxLength={300} onChange={(e) => set('location', e.target.value)} className="bg-white" />
          </Field>
        </Group>

        <Group legend="Recapiti (almeno uno)" error={errors.contacts} errorId={`${uid}-contacts-error`}>
          <Field id={id('linkedinUrl')} label="Profilo LinkedIn" error={errors.linkedinUrl} className="sm:col-span-2">
            <Input
              id={id('linkedinUrl')}
              value={form.linkedinUrl}
              maxLength={500}
              placeholder="https://www.linkedin.com/in/nome-cognome/"
              onChange={(e) => set('linkedinUrl', e.target.value)}
              onBlur={() => void checkDuplicates()}
              aria-invalid={errors.linkedinUrl ? true : undefined}
              aria-describedby={[errors.linkedinUrl && `${id('linkedinUrl')}-error`, errors.contacts && `${uid}-contacts-error`].filter(Boolean).join(' ') || undefined}
              className="bg-white"
            />
          </Field>
          {dups.linkedin && (
            <DupPanel id={id('linkedinPanel')} error={errors.linkedinChoice} errorId={`${id('linkedinChoice')}-error`}>
              <p>
                Questo profilo LinkedIn è già nel CRM: <PersonRefLine person={dups.linkedin} />. Non si crea un doppione.
              </p>
              <label className="mt-2 flex items-start gap-2 font-medium text-slate-900">
                <input
                  id={id('linkedinChoice')}
                  type="checkbox"
                  className="mt-0.5 size-4 accent-slate-900"
                  checked={isChosen(dups.linkedin)}
                  onChange={() => toggleMeeting(dups.linkedin!)}
                  aria-describedby={errors.linkedinChoice ? `${id('linkedinChoice')}-error` : undefined}
                />
                Aggiungi l'incontro a {dups.linkedin.full_name ?? 'questa persona'}
              </label>
              {isChosen(dups.linkedin) && <MeetingSummary person={dups.linkedin} input={summaryInput} />}
            </DupPanel>
          )}
          <Field id={id('email')} label="Email" error={errors.email}>
            <Input
              id={id('email')}
              type="email"
              value={form.email}
              maxLength={300}
              onChange={(e) => set('email', e.target.value)}
              onBlur={() => void checkDuplicates()}
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={[errors.email && `${id('email')}-error`, errors.contacts && `${uid}-contacts-error`].filter(Boolean).join(' ') || undefined}
              className="bg-white"
            />
          </Field>
          <Field id={id('phone')} label="Telefono">
            <Input
              id={id('phone')}
              type="tel"
              value={form.phone}
              maxLength={100}
              onChange={(e) => set('phone', e.target.value)}
              aria-describedby={errors.contacts ? `${uid}-contacts-error` : undefined}
              className="bg-white"
            />
          </Field>
          {dups.email.length > 0 && (
            <DupPanel id={id('emailPanel')} error={errors.choice} errorId={`${id('choice')}-error`} className="sm:col-span-2">
              <fieldset id={id('choice')} tabIndex={-1} aria-describedby={errors.choice ? `${id('choice')}-error` : undefined}>
                <legend className="mb-1">
                  Questa email è già di:{' '}
                  {dups.email.map((p, i) => (
                    <span key={p.id}>
                      {i > 0 && '; '}
                      <PersonRefLine person={p} />
                    </span>
                  ))}
                  . Scegli come procedere.
                </legend>
                <div className="flex flex-col gap-1">
                  {dups.email.map((p) => (
                    <label key={p.id} className="flex items-start gap-2 font-medium text-slate-900">
                      <input type="radio" name={`${uid}-email-choice`} className="mt-0.5 size-4 accent-slate-900" checked={isChosen(p)} onChange={() => choose({ kind: 'meeting', person: p })} />
                      Aggiungi l'incontro a {p.full_name ?? 'questa persona'}
                      <PersonHint person={p} />
                    </label>
                  ))}
                  <label className="flex items-start gap-2 font-medium text-slate-900">
                    <input type="radio" name={`${uid}-email-choice`} className="mt-0.5 size-4 accent-slate-900" checked={choice?.kind === 'create'} onChange={() => choose({ kind: 'create' })} />
                    Crea comunque una nuova persona
                  </label>
                </div>
                {choice?.kind === 'meeting' && dups.email.some(isChosen) && <MeetingSummary person={choice.person} input={summaryInput} />}
              </fieldset>
            </DupPanel>
          )}
          {dups.name.length > 0 && (
            <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-slate-700 sm:col-span-2">
              {dups.name.map((p) => (
                <div key={p.id} className="flex flex-col">
                  <p>
                    Esiste già una persona con questo nome: <PersonRefLine person={p} />.
                  </p>
                  <label className="mt-1 flex items-start gap-2 font-medium text-slate-900">
                    <input type="checkbox" className="mt-0.5 size-4 accent-slate-900" checked={isChosen(p)} onChange={() => toggleMeeting(p)} />
                    Aggiungi l'incontro a {p.full_name ?? 'questa persona'}
                    <PersonHint person={p} />
                  </label>
                  {isChosen(p) && (
                    <MeetingSummary
                      person={p}
                      input={summaryInput}
                      extra={<p>L'email e il telefono del form non si copiano: aggiungili dalla sua scheda.</p>}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </Group>

        <Group legend="Incontro">
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label htmlFor={id('context')} className="text-xs font-medium text-slate-600">
              Come vi siete conosciuti
            </label>
            <textarea
              id={id('context')}
              rows={3}
              maxLength={5000}
              value={form.context}
              placeholder="es. DevFest Milano: talk sulla migrazione a Kubernetes, vuole una call a ottobre"
              onChange={(e) => set('context', e.target.value)}
              className="w-full rounded-lg border border-input bg-white px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-400"
            />
          </div>
          <Field id={id('metOn')} label="Data dell'incontro" error={errors.metOn}>
            <Input id={id('metOn')} type="date" value={form.metOn} onChange={(e) => set('metOn', e.target.value)} className="w-auto bg-white" />
          </Field>
        </Group>

        <Group legend="Nel CRM">
          <div className="flex flex-col gap-1 sm:col-span-2" id={id('list')} tabIndex={-1}>
            <span className="text-xs font-medium text-slate-600">Lista</span>
            <ListPicker
              value={form.listId}
              label="Lista"
              onChange={(listId: number, list: ProspectList) => {
                setForm((f) => ({ ...f, listId, listName: list.name }));
                setErrors((e) => ({ ...e, list: undefined }));
              }}
              noneOption={{ label: 'Nessuna lista', onSelect: () => setForm((f) => ({ ...f, listId: null, listName: null })) }}
              disabled={pending}
            />
            {errors.list && (
              <p role="alert" className="text-xs text-red-700">
                {errors.list}
              </p>
            )}
          </div>
          <Field id={id('status')} label="Stato iniziale">
            <select
              id={id('status')}
              value={form.status}
              onChange={(e) => set('status', e.target.value as ProspectStatus)}
              className="h-8 w-auto rounded-lg border border-input bg-white px-2 text-sm"
            >
              {PROSPECT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-xs font-medium text-slate-600">Prossima azione</span>
            <NextActionFields
              value={form.nextAction}
              onChange={(v) => set('nextAction', v)}
              today={today}
              dateError={errors.nextAction}
              dateId={id('nextActionDate')}
              disabled={pending}
            />
          </div>
        </Group>

        {saveError && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {saveError}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={pending} aria-busy={pending && save.variables === 'open'}>
            {pending && save.variables === 'open' ? 'Salvataggio…' : 'Salva'}
          </Button>
          <Button type="button" variant="outline" disabled={pending} aria-busy={pending && save.variables === 'another'} onClick={() => submit('another')}>
            Salva e aggiungi un'altra
          </Button>
          <Link to="/people" activeOptions={{ exact: true }} className={buttonVariants({ variant: 'ghost' })}>
            Annulla
          </Link>
        </div>
        {added.length > 0 && (
          <p className="text-sm text-slate-600">
            Aggiunte ora ({added.length}):{' '}
            {added.map((a, i) => (
              <span key={`${a.id}-${i}`}>
                {i > 0 && ', '}
                <Link to="/people/$id" params={{ id: String(a.id) }} className="underline underline-offset-2">
                  {a.name}
                  {a.meeting ? ' (incontro)' : ''}
                </Link>
              </span>
            ))}
          </p>
        )}
        <p className="sr-only" aria-live="polite">
          {live}
        </p>
      </form>

      <Dialog open={blocker.status === 'blocked'} onOpenChange={(open) => !open && blocker.status === 'blocked' && blocker.reset()}>
        <DialogContent className="sm:max-w-md" onOpenAutoFocus={(e) => {
          e.preventDefault();
          document.getElementById(id('stay'))?.focus();
        }}>
          <DialogHeader>
            <DialogTitle>Uscire senza salvare?</DialogTitle>
            <DialogDescription>I dati inseriti andranno persi.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button id={id('stay')} type="button" onClick={() => blocker.status === 'blocked' && blocker.reset()}>
              Resta
            </Button>
            <Button type="button" variant="outline" onClick={() => blocker.status === 'blocked' && blocker.proceed()}>
              Esci senza salvare
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Group({ legend, children, error, errorId }: { legend: string; children: ReactNode; error?: string; errorId?: string }) {
  return (
    <fieldset
      className={cn('rounded-xl border bg-white px-4 pt-2 pb-4 shadow-sm', error ? 'border-red-300' : 'border-slate-200')}
      aria-describedby={error ? errorId : undefined}
    >
      <legend className="px-1 text-sm font-semibold text-slate-700">{legend}</legend>
      {error && (
        <p id={errorId} className="mb-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function Field(props: { id: string; label: string; required?: boolean; error?: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn('flex flex-col gap-1', props.className)}>
      <label htmlFor={props.id} className="text-xs font-medium text-slate-600">
        {props.label}
        {props.required && <span className="font-normal text-slate-500"> (obbligatorio)</span>}
      </label>
      {props.children}
      {props.error && (
        <p id={`${props.id}-error`} className="text-xs text-red-700">
          {props.error}
        </p>
      )}
    </div>
  );
}

function DupPanel(props: { id: string; error?: string; errorId: string; className?: string; children: ReactNode }) {
  return (
    <div
      id={props.id}
      role="status"
      className={cn('rounded-lg border px-3 py-2 text-sm text-slate-700 sm:col-span-2', props.error ? 'border-red-300 bg-red-50' : 'border-sky-200 bg-sky-50', props.className)}
    >
      {props.children}
      {props.error && (
        <p id={props.errorId} className="mt-1 font-medium text-red-700">
          {props.error}
        </p>
      )}
    </div>
  );
}

/** Nome accessibile distinto per due persone con lo stesso nome (C10): ruolo · azienda, altrimenti l'id. */
function PersonHint({ person: p }: { person: PersonRef }) {
  const role = [p.title ?? p.headline, p.company_name].filter(Boolean).join(' · ');
  return <span className="sr-only"> ({role || `#${p.id}`})</span>;
}
