import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, errorText, queryKeys } from '../../api/client';
import type { Settings } from '../../api/types';
import { Card } from '../ui';
import { toast } from '../ui/toaster';
import { labelCls, textareaCls } from './parts';

/*
 * Profilo LinkedIn e la mia azienda (crm-foundation T14, FLOW A.2 e B): le due card della sezione
 * "Profilo e azienda" delle Impostazioni, con le ancore `#profilo` e `#azienda`.
 */

export function ProfileSection({ settings }: { settings: Settings }) {
  const queryClient = useQueryClient();
  const uid = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState(settings.own_profile_url ?? '');
  const [error, setError] = useState<string | null>(null);

  // Deep-link `/settings#profilo` (errore "profilo mancante" di un job): porta il focus sul campo.
  useEffect(() => {
    if (window.location.hash === '#profilo') inputRef.current?.focus();
  }, []);

  const save = useMutation({
    mutationFn: (value: string) => api.settings.update({ own_profile_url: value.trim() }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.settings, data);
      // Il profilo è un blocker della preview del sync.
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobPreviews });
      setUrl(data.own_profile_url ?? '');
      setError(null);
      toast({ title: data.own_profile_url ? 'Profilo salvato' : 'Profilo rimosso' });
    },
    onError: (err) => {
      setError(errorText(err));
      inputRef.current?.focus();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate(url);
  };

  return (
    <Card title="Profilo LinkedIn">
      <form id="profilo" onSubmit={submit} noValidate className="flex scroll-mt-6 flex-col gap-3 px-4 py-4">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-url`} className={labelCls}>
            URL pubblico del tuo profilo
          </label>
          <Input
            ref={inputRef}
            id={`${uid}-url`}
            type="url"
            inputMode="url"
            autoComplete="url"
            value={url}
            placeholder="https://www.linkedin.com/in/tuo-nome/"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${uid}-error` : `${uid}-hint`}
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
              Serve a leggere chi reagisce e commenta i tuoi post. Nessun login: solo l'URL pubblico.
            </p>
          )}
        </div>
        {settings.own_profile_url && (
          <p className="text-sm text-slate-600">
            Salvato come{' '}
            <a
              href={settings.own_profile_url}
              target="_blank"
              rel="noreferrer"
              className="font-medium break-all text-slate-900 underline"
            >
              {settings.own_profile_url}
            </a>
          </p>
        )}
        <div>
          <Button type="submit" disabled={save.isPending} aria-busy={save.isPending}>
            {save.isPending ? 'Salvataggio…' : 'Salva profilo'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// La mia azienda
// ---------------------------------------------------------------------------

type CompanyFields = Pick<Settings, 'company_name' | 'company_description' | 'company_offering'>;

export function CompanySection({ settings }: { settings: Settings }) {
  const queryClient = useQueryClient();
  const uid = useId();
  const [values, setValues] = useState(() => ({
    company_name: settings.company_name ?? '',
    company_description: settings.company_description ?? '',
    company_offering: settings.company_offering ?? '',
  }));
  const [error, setError] = useState<string | null>(null);

  // Deep-link `/settings#azienda` (promemoria "Da completare" dell'onboarding): focus sulla descrizione.
  useEffect(() => {
    if (window.location.hash === '#azienda') document.getElementById(`${uid}-company_description`)?.focus();
  }, [uid]);

  const save = useMutation({
    mutationFn: (body: CompanyFields) => api.settings.update(body),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.settings, data);
      // La descrizione vuota è un avviso nella preview dell'analisi.
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobPreviews });
      setValues({
        company_name: data.company_name ?? '',
        company_description: data.company_description ?? '',
        company_offering: data.company_offering ?? '',
      });
      setError(null);
      toast({ title: 'Azienda salvata' });
    },
    onError: (err) => setError(errorText(err)),
  });

  const field = (key: keyof typeof values) => ({
    id: `${uid}-${key}`,
    value: values[key],
    onChange: (e: { target: { value: string } }) => setValues((cur) => ({ ...cur, [key]: e.target.value })),
  });

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
        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-company_name`} className={labelCls}>
            Nome
          </label>
          <Input {...field('company_name')} placeholder="es. Officina Codice Srl" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-company_description`} className={labelCls}>
            Di cosa si occupa
          </label>
          <textarea
            {...field('company_description')}
            className={textareaCls}
            rows={3}
            placeholder="es. Sviluppiamo software gestionale su misura per PMI manifatturiere."
          />
          {!settings.readiness.company && (
            <p className="text-xs text-amber-800">Descrizione azienda vuota: gli angoli AI saranno meno mirati.</p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-company_offering`} className={labelCls}>
            Cosa offri
          </label>
          <textarea
            {...field('company_offering')}
            className={textareaCls}
            rows={3}
            placeholder="es. Assessment gratuito di 2 settimane, poi sviluppo a progetto."
          />
        </div>
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
