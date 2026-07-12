// Thin typed client for the Outreach backend. Every call goes through
// `request` so timeouts, authentication (Bearer token + invisible refresh)
// and the backend's { error: { code, message } } envelope are handled in one
// place.

import { getSession, setSession } from './authStore';
import { getApiBase } from './config';
import type {
  AuthPayload,
  AuthSession,
  AuthUser,
  Campaign,
  ChatMessage,
  ChatSummary,
  DraftEmail,
  GmailStatus,
  LeadFilters,
  ParseQueryResponse,
  PersonLead,
  SearchContext,
  SearchLeadsResponse,
  SendResponse,
  StoredChat,
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

// How close to expiry (seconds) a token gets refreshed BEFORE a request, so
// calls never leave with a token that dies in flight.
const REFRESH_MARGIN_S = 60;

async function request<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = TIMEOUT_MS,
  { isRetry = false } = {},
): Promise<T> {
  // Refresh proactively when the access token is about to expire. Auth
  // endpoints themselves skip this (they're how tokens are obtained).
  const authed = !path.startsWith('/api/auth/');
  let session = getSession();
  if (authed && session && session.expires_at - REFRESH_MARGIN_S < Date.now() / 1000) {
    await refreshSession();
    session = getSession();
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${getApiBase()}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(authed && session ? { Authorization: `Bearer ${session.access_token}` } : {}),
        ...(init.headers ?? {}),
      },
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

    // Expired/revoked token: refresh once and replay the request. If the
    // refresh fails the session is cleared, which routes the app to sign-in.
    if (res.status === 401 && authed && session && !isRetry) {
      if (await refreshSession()) {
        return request<T>(path, init, timeoutMs, { isRetry: true });
      }
      setSession(null);
      throw new ApiError(401, 'session_expired', 'Your session has expired. Please sign in again.');
    }

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

// ---- Authentication ----------------------------------------------------------

function toSession(payload: AuthPayload): AuthSession {
  return { ...payload.session, user: payload.user };
}

/** Sign up, store the returned session, and return the user. */
export async function signUp(email: string, password: string, fullName?: string): Promise<AuthUser> {
  const payload = await request<AuthPayload>('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password, ...(fullName ? { full_name: fullName } : {}) }),
  });
  setSession(toSession(payload));
  return payload.user;
}

/** Sign in, store the returned session, and return the user. */
export async function signIn(email: string, password: string): Promise<AuthUser> {
  const payload = await request<AuthPayload>('/api/auth/signin', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setSession(toSession(payload));
  return payload.user;
}

/** Revoke the session server-side (best-effort) and clear it locally. */
export async function signOut(): Promise<void> {
  const session = getSession();
  setSession(null); // sign out locally first — never leave the user stuck
  if (!session) return;
  try {
    await request('/api/auth/signout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
  } catch {
    // Server-side revocation is best-effort; the local session is already gone.
  }
}

/** Ask the backend to email a password-reset link that deep-links back here. */
export function forgotPassword(email: string, redirectTo: string): Promise<{ sent: boolean }> {
  return request('/api/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email, redirect_to: redirectTo }),
  });
}

/** Set a new password using the access token from the reset-email deep link. */
export function resetPassword(accessToken: string, password: string): Promise<{ reset: boolean }> {
  return request('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ access_token: accessToken, password }),
  });
}

// Single-flight token refresh: concurrent 401s share one refresh call.
let refreshInFlight: Promise<boolean> | null = null;

function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function doRefresh(): Promise<boolean> {
  const session = getSession();
  if (!session?.refresh_token) return false;
  try {
    const payload = await request<AuthPayload>('/api/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    setSession(toSession(payload));
    return true;
  } catch (err) {
    // A definitive rejection (revoked/expired refresh token) ends the session;
    // a network blip does not — the original request just fails normally.
    if (err instanceof ApiError && err.status === 401) setSession(null);
    return false;
  }
}

export function parseQuery(query: string, context?: SearchContext): Promise<ParseQueryResponse> {
  return request<ParseQueryResponse>('/api/parse-query', {
    method: 'POST',
    // `context` lets the parser tell a new search from a refinement or "more".
    body: JSON.stringify({ query, ...(context ? { context } : {}) }),
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

// ---- Chats (conversation history) --------------------------------------------

export async function listChats(limit = 50): Promise<ChatSummary[]> {
  const data = await request<{ chats: ChatSummary[] }>(`/api/chats?limit=${limit}`);
  return data.chats ?? [];
}

export function getChat(id: string): Promise<StoredChat> {
  return request<StoredChat>(`/api/chats/${id}`);
}

/** Upsert the whole chat — called after each completed turn. */
export function saveChat(id: string, title: string, messages: ChatMessage[]): Promise<{ saved: boolean }> {
  return request(`/api/chats/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ title, messages }),
  });
}

export function deleteChat(id: string): Promise<{ deleted: boolean }> {
  return request(`/api/chats/${id}`, { method: 'DELETE' });
}

// ---- Gmail + outreach -------------------------------------------------------

export function gmailStatus(): Promise<GmailStatus> {
  return request<GmailStatus>('/api/gmail/status');
}

/**
 * Google consent URL bound to the signed-in user (opened via Linking).
 * `state` also works at GET /api/gmail/connect?state=... — a short browser
 * URL for the dev "finish on the PC" flow.
 */
export function gmailConnectUrl(): Promise<{ url: string; state: string }> {
  return request<{ url: string; state: string }>('/api/gmail/connect-url');
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
