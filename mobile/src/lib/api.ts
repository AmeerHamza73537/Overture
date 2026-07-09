// Thin typed client for the Outreach backend. Every call goes through
// `request` so timeouts and the backend's { error: { code, message } }
// envelope are handled in one place.

import { getApiBase } from './config';
import type {
  Campaign,
  DraftEmail,
  GmailStatus,
  HistoryEntry,
  LeadFilters,
  ParseQueryResponse,
  PersonLead,
  SearchLeadsResponse,
  SendResponse,
} from './types';

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

// People searches fan out to several Hunter calls server-side, so give the
// backend more headroom than a typical request would need.
const TIMEOUT_MS = 60_000;

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${getApiBase()}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiError(0, 'timeout', 'The request took too long. Please try again.');
    }
    throw new ApiError(
      0,
      'network',
      'Could not reach the server. Check that the backend is running and your phone is on the same Wi-Fi.',
    );
  } finally {
    clearTimeout(timer);
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // fall through — handled below
  }

  if (!res.ok) {
    const error = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(
      res.status,
      error?.code ?? 'http_error',
      error?.message ?? `Server returned status ${res.status}.`,
    );
  }
  if (body === null) {
    throw new ApiError(res.status, 'bad_response', 'Server returned an unreadable response.');
  }
  return body as T;
}

export function parseQuery(query: string): Promise<ParseQueryResponse> {
  return request<ParseQueryResponse>('/api/parse-query', {
    method: 'POST',
    body: JSON.stringify({ query }),
  });
}

export function searchLeads(
  filters: LeadFilters,
  opts: { page?: number; perPage?: number; rawQuery?: string } = {},
): Promise<SearchLeadsResponse> {
  const { page = 1, perPage = 10, rawQuery } = opts;
  return request<SearchLeadsResponse>('/api/search-leads', {
    method: 'POST',
    body: JSON.stringify({
      filters,
      page,
      per_page: perPage,
      ...(rawQuery ? { raw_query: rawQuery } : {}),
    }),
  });
}

export async function listSearches(limit = 50): Promise<HistoryEntry[]> {
  const data = await request<{ searches: HistoryEntry[] }>(`/api/searches?limit=${limit}`);
  return data.searches ?? [];
}

// ---- Gmail + outreach -------------------------------------------------------

export function gmailStatus(): Promise<GmailStatus> {
  return request<GmailStatus>('/api/gmail/status');
}

/** Browser URL that starts the Google consent flow (opened via Linking). */
export function gmailConnectUrl(): string {
  return `${getApiBase()}/api/gmail/connect`;
}

export function disconnectGmail(): Promise<{ disconnected: boolean }> {
  return request<{ disconnected: boolean }>('/api/gmail/account', { method: 'DELETE' });
}

export function generateEmails(leads: PersonLead[], campaign: Campaign): Promise<DraftEmail[]> {
  return request<{ drafts: DraftEmail[] }>(
    '/api/outreach/generate',
    { method: 'POST', body: JSON.stringify({ leads, campaign }) },
    // One Groq call per lead server-side — scale the timeout with batch size.
    30_000 + leads.length * 8_000,
  ).then((d) => d.drafts);
}

export function reviseEmail(args: {
  lead: PersonLead;
  campaign: Campaign;
  subject: string;
  body: string;
  instruction: string;
}): Promise<{ subject: string; body: string }> {
  return request('/api/outreach/revise', { method: 'POST', body: JSON.stringify(args) });
}

export function sendEmails(
  emails: { lead_id: string | null; to: string; subject: string; body: string }[],
): Promise<SendResponse> {
  return request<SendResponse>(
    '/api/outreach/send',
    { method: 'POST', body: JSON.stringify({ emails }) },
    // The backend pauses ~7s between sends on purpose — wait it out.
    60_000 + emails.length * 12_000,
  );
}
