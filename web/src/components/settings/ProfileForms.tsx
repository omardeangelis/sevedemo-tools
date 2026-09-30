import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, errorText, queryKeys } from '../../api/client';
import type { Profile, ProfileFieldKey, ProfileValue, SettingsPatch, SettingsSaved } from '../../api/types';
import { Card } from '../ui';
import { toast } from '../ui/toaster';
import { labelCls, Origin, textareaCls } from './parts';

/*
 * I tuoi indirizzi pubblici e la mia azienda (crm-foundation T14, FLOW A.2 e B; own-profile-services T11): le card
 * della sezione "Profilo e azienda" delle Impostazioni, con le ancore `#profilo` e `#azienda`. Leggono il profilo
 * dalla lettura unica (`GET /api/profile`, B7) e sotto ogni campo dicono chi l'ha scritto (B6).
 */

/** Dopo un salvataggio: impostazioni aggiornate per le altre pagine, profilo (provenienza) riletto. */
function useSaveSettings(onSaved: (data: SettingsSaved) => void, onError: (err: unknown) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SettingsPatch) => api.settings.update(body),
    onSuccess: (data) => {
      const { warnings: _warnings, ...settings } = data;
      queryClient.setQueryData(queryKeys.settings, settings);
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile });
      // Profilo e descrizione dell'azienda alimentano blocchi e avvisi delle preview.
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobPreviews });
      onSaved(data);
    },
    onError,
  });
}

export function ProfileSection({ profile }: { profile: Profile }) {
  const { own_profile_url: linkedin, website_url: site } = profile.inputs;
  return (
    <Card title="I tuoi indirizzi pubblici">
      <AddressForm
        field="own_profile_url"
        saved={linkedin}
        // Deep-link `/settings#profilo` (errore "profilo mancante" di un job): porta il focus sul campo.
        formId="profilo"
        label="URL pubblico del tuo profilo"
        placeholder="https://www.linkedin.com/in/tuo-nome/"
        hint="Serve a leggere chi reagisce e commenta i tuoi post. Nessun login: solo l'URL pubblico."
        toasts={['Profilo salvato', 'Profilo rimosso']}
        submit="Salva profilo"
      >
        {linkedin.value && (
          <p className="text-sm text-slate-600">
            Salvato come{' '}
            <a href={linkedin.value} target="_blank" rel="noreferrer" className="font-medium break-all text-slate-900 underline">
              {linkedin.value}
            </a>
          </p>
        )}
      </AddressForm>
      {/* Sito: input della generazione, mai proposto (E2); hint neutro finché nessuna tappa lo legge (PLAN §10). */}
      <AddressForm
        field="website_url"
        saved={site}
        label="Sito web"
        placeholder="https://www.officinacodice.it"
        hint="Il sito della tua azienda."
        // C11: si salva anche senza dominio ricavabile; l'avviso resta finché l'indirizzo salvato è quello.
        warning={site.warning}
        toasts={['Sito salvato', 'Sito rimosso']}
        submit="Salva sito"
        secondary
      />
    </Card>
  );
}

/** Un indirizzo (URL) con il suo form: errore sotto il campo e focus sul campo, provenienza sotto (B6). */
function AddressForm(props: {
  field: 'own_profile_url' | 'website_url';
  saved: ProfileValue;
  formId?: string;
  label: string;
  placeholder: string;
  hint: string;
  warning?: string | null;
  toasts: [saved: string, removed: string];
  submit: string;
  secondary?: boolean;
  children?: ReactNode;
}) {
  const { field, saved, formId } = props;
  const uid = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState(saved.value ?? '');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (formId && window.location.hash === `#${formId}`) inputRef.current?.focus();
  }, [formId]);

  const save = useSaveSettings(
    (data) => {
      setUrl(data[field] ?? '');
      setError(null);
      toast({ title: data[field] ? props.toasts[0] : props.toasts[1] });
    },
    (err) => {
      setError(errorText(err));
      inputRef.current?.focus();
    },
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate({ [field]: url.trim() });
  };

  const warning = props.warning && url.trim() === saved.value ? props.warning : null;
  const describedBy = [error ? `${uid}-error` : `${uid}-hint`, warning && `${uid}-warning`].filter(Boolean).join(' ');

  return (
    <form
      id={formId}
      onSubmit={submit}
      noValidate
      className={props.secondary ? 'flex flex-col gap-3 border-t border-slate-100 px-4 py-4' : 'flex scroll-mt-6 flex-col gap-3 px-4 py-4'}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={`${uid}-url`} className={labelCls}>
          {props.label}
        </label>
        <Input
          ref={inputRef}
          id={`${uid}-url`}
          type="url"
          inputMode="url"
          autoComplete="url"
          value={url}
          placeholder={props.placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(e) => {
            setUrl(e.target.value);
            if (error) setError(null);
          }}
        />
        {error ? (
          <p id={`${uid}-error`} role="alert" className="text-sm text-red-700">
            {error}
          </p>
        ) : (
          <p id={`${uid}-hint`} className="text-xs text-slate-500">
            {props.hint}
          </p>
        )}
        {warning && (
          <p id={`${uid}-warning`} className="text-xs text-amber-800">
            {warning}
          </p>
        )}
        <Origin origin={saved.origin} at={saved.origin_at} />
      </div>
      {props.children}
      <div>
        <Button type="submit" variant={props.secondary ? 'outline' : 'default'} disabled={save.isPending} aria-busy={save.isPending}>
          {save.isPending ? 'Salvataggio…' : props.submit}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// La mia azienda
// ---------------------------------------------------------------------------

type CompanyField = { key: ProfileFieldKey; label: string; rows?: number; placeholder: string };

/** I tre campi di prima (descritti dall'hint della card)… */
const CURRENT_FIELDS: readonly CompanyField[] = [
  { key: 'company_name', label: 'Nome', placeholder: 'es. Officina Codice Srl' },
  {
    key: 'company_description',
    label: 'Di cosa si occupa',
    rows: 3,
    placeholder: 'es. Sviluppiamo software gestionale su misura per PMI manifatturiere.',
  },
  {
    key: 'company_offering',
    label: 'Cosa offri',
    rows: 3,
    placeholder: 'es. Assessment gratuito di 2 settimane, poi sviluppo a progetto.',
  },
];
/** …e i tre nuovi (B1), che l'analisi non legge ancora: hint proprio, provvisorio fino a T16 (PLAN §10). */
const NEW_FIELDS: readonly CompanyField[] = [
  {
    key: 'positioning',
    label: 'Posizionamento',
    rows: 3,
    placeholder: 'es. Il CTO a tempo per le PMI che non possono assumerne uno.',
  },
  {
    key: 'proof_points',
    label: 'Prove e risultati',
    rows: 3,
    placeholder: 'es. 12 migrazioni al cloud senza fermare la produzione.',
  },
  { key: 'tone_of_voice', label: 'Tono di voce', rows: 2, placeholder: 'es. Diretto, concreto, niente gergo.' },
];

type CompanyValues = Record<ProfileFieldKey, string>;

const companyValuesOf = (read: (key: ProfileFieldKey) => string | null): CompanyValues =>
  Object.fromEntries([...CURRENT_FIELDS, ...NEW_FIELDS].map(({ key }) => [key, read(key) ?? ''])) as CompanyValues;

export function CompanySection({ profile }: { profile: Profile }) {
  const uid = useId();
  const [values, setValues] = useState(() => companyValuesOf((key) => profile.fields[key].value));
  const [error, setError] = useState<string | null>(null);

  // Deep-link `/settings#azienda` (promemoria "Da completare" dell'onboarding): focus sulla descrizione.
  useEffect(() => {
    if (window.location.hash === '#azienda') document.getElementById(`${uid}-company_description`)?.focus();
  }, [uid]);

  const save = useSaveSettings(
    (data) => {
      setValues(companyValuesOf((key) => data[key]));
      setError(null);
      toast({ title: 'Azienda salvata' });
    },
    (err) => setError(errorText(err)),
  );

  const field = ({ key, label, rows, placeholder }: CompanyField) => {
    const id = `${uid}-${key}`;
    const control = {
      id,
      value: values[key],
      placeholder,
      onChange: (e: { target: { value: string } }) => setValues((cur) => ({ ...cur, [key]: e.target.value })),
    };
    return (
      <div key={key} className="flex flex-col gap-1">
        <label htmlFor={id} className={labelCls}>
          {label}
        </label>
        {rows ? <textarea {...control} className={textareaCls} rows={rows} /> : <Input {...control} />}
        {key === 'company_description' && !profile.readiness.company && (
          <p className="text-xs text-amber-800">Descrizione azienda vuota: gli angoli AI saranno meno mirati.</p>
        )}
        <Origin origin={profile.fields[key].origin} at={profile.fields[key].origin_at} />
      </div>
    );
  };

  return (
    <Card title="La mia azienda">
      <form
        id="azienda"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(values);
        }}
        className="flex scroll-mt-6 flex-col gap-3 px-4 py-4"
        aria-describedby={`${uid}-hint`}
      >
        <p id={`${uid}-hint`} className="text-xs text-slate-500">
          Usati dall'analisi AI per proporre angoli coerenti con ciò che vendi. Tutti facoltativi.
        </p>
        {CURRENT_FIELDS.map(field)}
        <p className="border-t border-slate-100 pt-3 text-xs text-slate-500">Tutti facoltativi.</p>
        {NEW_FIELDS.map(field)}
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <div>
          <Button type="submit" disabled={save.isPending} aria-busy={save.isPending}>
            {save.isPending ? 'Salvataggio…' : 'Salva azienda'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
