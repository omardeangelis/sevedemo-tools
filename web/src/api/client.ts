import type {
  Bucket,
  Contact,
  ContactFilters,
  ContactPatch,
  ContactsPage,
  EnrichmentStatus,
  EraseResult,
  PipelineStatus,
  RunExecution,
  Selection,
  SelectionSummary,
  Stats,
  StrategyReport,
} from './types';

/**
 * Error that preserves the HTTP status so callers can branch on it.
 *
 * Notably `POST /api/selections/:date/contacts` returns 409 for TWO opposite
 * meanings (server `app.ts`): "Contatto già presente nella selezione." (a SKIP)
 * vs "Selezione esportata: editing bloccato." (a fatal read-only stop). Branching
 * needs both the status AND the message — `request()` used to discard the status.
 *
 * Extends `Error`, so existing `error instanceof Error` callers keep working.
 */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, body?.error ?? `Errore ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export const api = {
  stats: () => request<Stats>('/api/stats'),

  pipelineStatus: () => request<PipelineStatus>('/api/pipeline/status'),
  startPipeline: () => request<PipelineStatus>('/api/pipeline/run', { method: 'POST' }),
  eraseData: () =>
    request<EraseResult>('/api/data/erase', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ confirm: 'ERASE' }),
    }),

  runs: () => request<RunExecution[]>('/api/runs'),
  report: () => request<StrategyReport[]>('/api/report'),

  selections: () => request<SelectionSummary[]>('/api/selections'),
  selection: (date: string) => request<Selection>(`/api/selections/${date}`),
  candidates: (date: string, bucket: Bucket, q: string, email?: 'with' | 'without') =>
    request<Contact[]>(`/api/selections/${date}/candidates${qs({ bucket, q, email })}`),
  addToSelection: (date: string, contactId: number, bucket: Bucket) =>
    request<Selection>(`/api/selections/${date}/contacts`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ contactId, bucket }),
    }),
  removeFromSelection: (date: string, contactId: number) =>
    request<Selection>(`/api/selections/${date}/contacts/${contactId}`, { method: 'DELETE' }),

  enrichSelection: (date: string, body: { bucket?: Bucket; contactId?: number }) =>
    request<EnrichmentStatus>(`/api/selections/${date}/enrich`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    }),
  enrichmentStatus: () => request<EnrichmentStatus>('/api/enrichment/status'),
  exportSelection: (date: string) =>
    request<Selection>(`/api/selections/${date}/export`, { method: 'POST' }),

  contacts: (f: ContactFilters) => request<ContactsPage>(`/api/contacts${qs({ ...f })}`),
  contact: (id: number) => request<Contact>(`/api/contacts/${id}`),
  updateContact: (id: number, patch: ContactPatch) =>
    request<Contact>(`/api/contacts/${id}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify(patch),
    }),
};

export function csvUrl(date: string, options?: { email?: 'with' | 'without' }): string {
  return `/api/selections/${date}/export.csv${qs({ email: options?.email })}`;
}

export function jsonUrl(date: string, options?: { email?: 'with' | 'without' }): string {
  return `/api/selections/${date}/export.json${qs({ email: options?.email })}`;
}

export function contactsCsvUrl(filters: ContactFilters): string {
  return `/api/contacts/export.csv${qs({ ...filters })}`;
}

export function contactsJsonUrl(filters: ContactFilters): string {
  return `/api/contacts/export.json${qs({ ...filters })}`;
}

export function isEmailReady(email: string | null): boolean {
  return email != null && email !== '';
}
