export type Bucket = 'freelance' | 'azienda';
export type ContactStatus = 'new' | 'enriched' | 'scored' | 'selected' | 'exported';

export interface Contact {
  id: number;
  linkedin_url: string;
  full_name: string | null;
  headline: string | null;
  about: string | null;
  location: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  role: string | null;
  bucket: Bucket | 'scarta' | null;
  sector: 'tech' | 'design' | 'marketing' | 'other' | null;
  fit_score: number | null;
  short_description: string | null;
  score_reason: string | null;
  signals: string | null;
  source_strategy: string | null;
  source_post_url: string | null;
  email_subject: string | null;
  email_body: string | null;
  status: ContactStatus;
  raw_json?: string | null;
  first_seen_at: string;
  last_evaluated_at: string | null;
}

export interface SelectionItem extends Contact {
  sel_bucket: Bucket;
  rank: number;
}

export interface Selection {
  date: string;
  items: SelectionItem[];
}

export interface SelectionSummary {
  date: string;
  freelance: number;
  azienda: number;
}

export interface RunRow {
  id: number;
  run_date: string;
  strategy: string;
  actor_run_id: string | null;
  items_in: number;
  items_new: number;
  cost_estimate: number;
  created_at: string;
}

export interface StrategyReport {
  strategy: string;
  extracted: number;
  selected: number;
  sent: number;
  opened: number;
  replied: number;
  positive: number;
  converted: number;
  reply_rate: number;
  positive_rate: number;
  selected_rate: number;
}

export interface Stats {
  total: number;
  withEmail: number;
  byStatus: Record<string, number>;
  byBucket: Record<string, number>;
  lastRunDate: string | null;
  selectionsCount: number;
  strategies: string[];
}

export type PipelineState = 'idle' | 'running' | 'succeeded' | 'failed';

export interface PipelineStatus {
  state: PipelineState;
  started_at?: string;
  finished_at?: string;
  pid?: number;
  run_date?: string;
  error?: string;
}

export interface EraseResult {
  contacts: number;
  runs: number;
  selections: number;
  outcomes: number;
  kv: number;
  exportFiles: number;
}

export interface ContactsPage {
  items: Contact[];
  total: number;
}

export interface ContactFilters {
  q?: string;
  bucket?: string;
  status?: string;
  strategy?: string;
  page?: number;
  pageSize?: number;
}

export type ContactPatch = Partial<
  Pick<
    Contact,
    | 'full_name'
    | 'headline'
    | 'email'
    | 'phone'
    | 'company'
    | 'role'
    | 'bucket'
    | 'sector'
    | 'fit_score'
    | 'short_description'
    | 'email_subject'
    | 'email_body'
    | 'status'
  >
>;
