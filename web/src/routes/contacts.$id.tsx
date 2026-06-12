import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Contact, ContactPatch } from '../api/types';
import { fmtDateTime } from '../lib/format';
import {
  btn,
  BucketBadge,
  Card,
  ErrorBox,
  FitScore,
  inputCls,
  Loading,
  PageHeader,
  StatusBadge,
} from '../components/ui';

export const Route = createFileRoute('/contacts/$id')({ component: ContactPage });

function ContactPage() {
  const { id } = Route.useParams();
  const contactId = Number(id);
  const contact = useQuery({ queryKey: ['contact', contactId], queryFn: () => api.contact(contactId) });

  if (contact.isPending) return <Loading />;
  if (contact.isError) return <ErrorBox error={contact.error} />;

  // key= forza il remount dei form quando cambiano i dati salvati.
  return <ContactDetail key={contact.data.last_evaluated_at ?? contact.data.id} contact={contact.data} />;
}

function useSaveContact(contactId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: ContactPatch) => api.updateContact(contactId, patch),
    onSuccess: (updated) => {
      queryClient.setQueryData(['contact', contactId], updated);
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['selection'] });
    },
  });
}

function SaveButton({ pending, saved }: { pending: boolean; saved: boolean }) {
  return (
    <button type="submit" className={btn.primary} disabled={pending}>
      {pending ? 'Salvataggio…' : saved ? 'Salvato ✓' : 'Salva'}
    </button>
  );
}

const fieldLabel = 'block text-xs font-medium text-slate-500 mb-1';

function ContactDetail({ contact }: { contact: Contact }) {
  return (
    <>
      <PageHeader
        title={contact.full_name ?? 'Contatto senza nome'}
        subtitle={contact.headline ?? undefined}
        actions={
          <>
            <a href={contact.linkedin_url} target="_blank" rel="noreferrer" className={btn.ghost}>
              Profilo LinkedIn ↗
            </a>
            <Link to="/contacts" className={btn.ghost}>
              ← Contatti
            </Link>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <BucketBadge bucket={contact.bucket} />
        <StatusBadge status={contact.status} />
        <FitScore value={contact.fit_score} />
        {contact.sector && <span className="text-slate-500">settore: {contact.sector}</span>}
        {contact.source_strategy && <span className="text-slate-400">via {contact.source_strategy}</span>}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <AnagraficaForm contact={contact} />
          <Card title="Valutazione di Claude">
            <div className="space-y-3 px-4 py-3 text-sm">
              <Field label="Descrizione breve" value={contact.short_description} />
              <Field label="Motivazione del punteggio" value={contact.score_reason} />
              <Field label="Segnali" value={prettySignals(contact.signals)} mono />
              <Field label="About" value={contact.about} />
              <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
                <p>Primo avvistamento: {fmtDateTime(contact.first_seen_at)}</p>
                <p>Ultima valutazione: {fmtDateTime(contact.last_evaluated_at)}</p>
              </div>
            </div>
          </Card>
        </div>
        <EmailForm contact={contact} />
      </div>
    </>
  );
}

function Field({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div>
      <p className={fieldLabel}>{label}</p>
      <p className={`whitespace-pre-wrap text-slate-700 ${mono ? 'font-mono text-xs' : ''}`}>{value || '—'}</p>
    </div>
  );
}

function prettySignals(signals: string | null): string | null {
  if (!signals) return null;
  try {
    return JSON.stringify(JSON.parse(signals), null, 2);
  } catch {
    return signals;
  }
}

function AnagraficaForm({ contact }: { contact: Contact }) {
  const save = useSaveContact(contact.id);
  const [form, setForm] = useState({
    full_name: contact.full_name ?? '',
    email: contact.email ?? '',
    phone: contact.phone ?? '',
    company: contact.company ?? '',
    role: contact.role ?? '',
    bucket: contact.bucket ?? '',
    sector: contact.sector ?? '',
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate({
      full_name: form.full_name || null,
      email: form.email || null,
      phone: form.phone || null,
      company: form.company || null,
      role: form.role || null,
      bucket: (form.bucket || null) as ContactPatch['bucket'],
      sector: (form.sector || null) as ContactPatch['sector'],
    });
  };

  return (
    <Card title="Anagrafica">
      <form onSubmit={onSubmit} className="space-y-3 px-4 py-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <span className={fieldLabel}>Nome completo</span>
            <input className={inputCls} value={form.full_name} onChange={set('full_name')} />
          </label>
          <label>
            <span className={fieldLabel}>Email</span>
            <input className={inputCls} type="email" value={form.email} onChange={set('email')} />
          </label>
          <label>
            <span className={fieldLabel}>Telefono</span>
            <input className={inputCls} value={form.phone} onChange={set('phone')} />
          </label>
          <label>
            <span className={fieldLabel}>Azienda</span>
            <input className={inputCls} value={form.company} onChange={set('company')} />
          </label>
          <label>
            <span className={fieldLabel}>Ruolo</span>
            <input className={inputCls} value={form.role} onChange={set('role')} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className={fieldLabel}>Bucket</span>
              <select className={inputCls} value={form.bucket} onChange={set('bucket')}>
                <option value="">—</option>
                <option value="freelance">freelance</option>
                <option value="azienda">azienda</option>
                <option value="scarta">scarta</option>
              </select>
            </label>
            <label>
              <span className={fieldLabel}>Settore</span>
              <select className={inputCls} value={form.sector} onChange={set('sector')}>
                <option value="">—</option>
                <option value="tech">tech</option>
                <option value="design">design</option>
                <option value="marketing">marketing</option>
                <option value="other">other</option>
              </select>
            </label>
          </div>
        </div>
        {save.isError && <ErrorBox error={save.error} />}
        <SaveButton pending={save.isPending} saved={save.isSuccess} />
      </form>
    </Card>
  );
}

function EmailForm({ contact }: { contact: Contact }) {
  const save = useSaveContact(contact.id);
  const [subject, setSubject] = useState(contact.email_subject ?? '');
  const [body, setBody] = useState(contact.email_body ?? '');

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate({ email_subject: subject || null, email_body: body || null });
  };

  return (
    <Card title="Bozza email">
      <form onSubmit={onSubmit} className="space-y-3 px-4 py-3">
        <label>
          <span className={fieldLabel}>Oggetto</span>
          <input className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <label>
          <span className={fieldLabel}>Corpo</span>
          <textarea
            className={`${inputCls} min-h-80 font-mono text-xs leading-5`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        {save.isError && <ErrorBox error={save.error} />}
        <div className="flex items-center gap-3">
          <SaveButton pending={save.isPending} saved={save.isSuccess} />
          {!contact.email && (
            <p className="text-xs text-amber-600">⚠ Questo contatto non ha un indirizzo email: la bozza non è inviabile.</p>
          )}
        </div>
      </form>
    </Card>
  );
}
