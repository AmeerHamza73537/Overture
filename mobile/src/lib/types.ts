// Shapes returned by the Outreach backend (see backend/README.md).

export type SearchType = 'people' | 'organizations';

export interface LeadFilters {
  search_type: SearchType;
  job_titles: string[];
  departments: string[];
  seniorities: string[];
  person_locations: string[];
  organization_locations: string[];
  industries: string[];
  employee_ranges: string[];
  keywords: string;
  needs_clarification: boolean;
  assumptions: string[];
}

export interface PersonLead {
  id: string | null;
  type: 'person';
  name: string | null;
  title: string | null;
  department: string | null;
  seniority: string | null;
  company: string | null;
  company_website: string | null;
  location: string | null;
  email: string | null;
  email_locked: boolean;
  email_confidence: number | null;
  email_verification: string | null;
  linkedin_url: string | null;
}

export interface OrganizationLead {
  id: string | null;
  type: 'organization';
  name: string | null;
  industry: string | null;
  employee_count: string | number | null;
  location: string | null;
  website: string | null;
  emails_available: number | null;
  linkedin_url: string | null;
}

export type Lead = PersonLead | OrganizationLead;

export interface Pagination {
  page: number;
  per_page: number;
  total_entries: number;
  total_pages: number;
  total_matches: number;
}

export interface ParseQueryResponse {
  filters: LeadFilters;
  needs_clarification: boolean;
  assumptions: string[];
  cached: boolean;
}

export interface SearchLeadsResponse {
  provider: string;
  leads: Lead[];
  pagination: Pagination;
  cached: boolean;
}

export interface HistoryEntry {
  id: string | number;
  raw_query: string;
  filters: LeadFilters;
  result_count: number;
  created_at: string;
}

// ---- Gmail + outreach -------------------------------------------------------

export interface GmailStatus {
  configured: boolean;
  connected: boolean;
  email: string | null;
}

/** Filled once per batch — the context the AI writes every email from. */
export interface Campaign {
  purpose: string;
  sender_name: string;
  sender_company: string;
  details: string;
  tone: string;
}

export interface DraftEmail {
  lead_id: string | null;
  to: string | null;
  subject: string;
  body: string;
  status: 'ok' | 'failed';
  error?: string;
}

export interface SendResult {
  lead_id: string | null;
  to: string | null;
  status: 'sent' | 'failed' | 'skipped';
  message_id?: string | null;
  error?: string;
}

export interface SendResponse {
  results: SendResult[];
  needs_reconnect: boolean;
  summary: { sent: number; failed: number; skipped: number };
}
