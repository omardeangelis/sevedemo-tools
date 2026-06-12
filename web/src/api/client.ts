import type {
  Bucket,
  Contact,
  ContactFilters,
  ContactPatch,
  ContactsPage,
  EraseResult,
  PipelineStatus,
  RunRow,
  Selection,
  SelectionSummary,
  Stats,
  StrategyReport,
} from './types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Errore ${res.status}`);
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

  runs: () => request<RunRow[]>('/api/runs'),
  report: () => request<StrategyReport[]>('/api/report'),

  selections: () => request<SelectionSummary[]>('/api/selections'),
  selection: (date: string) => request<Selection>(`/api/selections/${date}`),
  candidates: (date: string, bucket: Bucket, q: string) =>
    request<Contact[]>(`/api/selections/${date}/candidates${qs({ bucket, q })}`),
  addToSelection: (date: string, contactId: number, bucket: Bucket) =>
    request<Selection>(`/api/selections/${date}/contacts`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ contactId, bucket }),
    }),
  removeFromSelection: (date: string, contactId: number) =>
    request<Selection>(`/api/selections/${date}/contacts/${contactId}`, { method: 'DELETE' }),

  contacts: (f: ContactFilters) => request<ContactsPage>(`/api/contacts${qs({ ...f })}`),
  contact: (id: number) => request<Contact>(`/api/contacts/${id}`),
  updateContact: (id: number, patch: ContactPatch) =>
    request<Contact>(`/api/contacts/${id}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify(patch),
    }),
};

export function csvUrl(date: string): string {
  return `/api/selections/${date}/export.csv`;
}

export function jsonUrl(date: string): string {
  return `/api/selections/${date}/export.json`;
}
