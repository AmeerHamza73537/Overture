// Google OAuth 2.0 for the Gmail connection.
//
// The flow (classic "authorization code" flow, all server-side):
//   1. /api/gmail/connect  -> we redirect the browser to Google's consent page
//   2. user approves       -> Google redirects back to /api/gmail/callback?code=...
//   3. we POST that one-time code to Google's token endpoint and receive:
//        - access_token   (short-lived, ~1h — what actually calls the Gmail API)
//        - refresh_token  (long-lived — lets us mint new access tokens forever)
//        - id_token       (a signed JWT identifying the account, e.g. its email)
//
// SCOPES — least privilege:
//   gmail.send  = may ONLY send email. Cannot read the inbox, cannot list or
//                 delete messages, cannot touch drafts. This is the entire
//                 mailbox permission we request.
//   openid+email = identity only; lets us show "Connected as you@gmail.com".
//                  They grant no mailbox access at all. Remove them from
//                  SCOPES if you'd rather not request identity.

import { randomBytes } from 'node:crypto';
import { env } from '../config/env.js';
import { fetchWithTimeout, safeJson } from '../utils/http.js';
import { HttpError } from '../utils/httpError.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

const SCOPES = ['https://www.googleapis.com/auth/gmail.send', 'openid', 'email'];

/** Throw a clear error when the Google OAuth client isn't set up yet. */
export function ensureGoogleConfigured() {
  if (!env.google.configured) {
    throw new HttpError(
      503,
      'gmail_not_configured',
      'Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in backend/.env — see the "Gmail setup" section of backend/README.md.',
    );
  }
}

// ---- CSRF state ------------------------------------------------------------
// The `state` value ties the callback to a /connect we initiated: we send a
// random string to Google, Google echoes it back, and we reject callbacks
// whose state we never issued (blocks forged callback links). It also carries
// WHO started the flow — the callback arrives from the browser without our
// Authorization header, so the user id rides along inside the server-side
// state entry. Kept in memory with a short TTL — a consent screen is
// completed within minutes.
const pendingStates = new Map(); // state -> { expiry, userId }
const STATE_TTL_MS = 10 * 60 * 1000;

export function issueState(userId) {
  const state = randomBytes(16).toString('hex');
  pendingStates.set(state, { expiry: Date.now() + STATE_TTL_MS, userId });
  return state;
}

/** @returns {string|null} the user id bound to the state, or null if invalid/expired. */
export function consumeState(state) {
  const entry = pendingStates.get(state);
  pendingStates.delete(state);
  return entry && entry.expiry > Date.now() ? entry.userId : null;
}

/** Like consumeState but non-destructive — used by the browser entry page. */
export function peekState(state) {
  const entry = pendingStates.get(state);
  return Boolean(entry && entry.expiry > Date.now());
}

// ---- Flow steps ------------------------------------------------------------

/** Build the Google consent-screen URL the browser is redirected to. */
export function buildAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: env.google.clientId,
    redirect_uri: env.google.redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    // access_type=offline asks for a refresh token (not just an access token).
    access_type: 'offline',
    // prompt=consent forces the consent screen even on re-connects — Google
    // only issues a refresh token on runs where consent was shown.
    prompt: 'consent',
    state,
  });
  return `${AUTH_URL}?${params}`;
}

/**
 * Exchange the one-time authorization code for tokens.
 * @returns {Promise<{ accessToken: string, expiresAt: number, refreshToken: string, email: string|null }>}
 */
export async function exchangeCode(code) {
  const payload = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    client_id: env.google.clientId,
    client_secret: env.google.clientSecret,
    redirect_uri: env.google.redirectUri,
  });

  if (!payload.refresh_token) {
    // Happens if a previous grant already exists and prompt=consent was
    // bypassed; the user can fix it by removing the app at
    // myaccount.google.com/permissions and connecting again.
    throw new HttpError(
      502,
      'gmail_no_refresh_token',
      'Google did not return a refresh token. Remove this app under myaccount.google.com/permissions and connect again.',
    );
  }

  return {
    accessToken: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
    refreshToken: payload.refresh_token,
    email: emailFromIdToken(payload.id_token),
  };
}

/**
 * Mint a fresh access token from the (decrypted) refresh token.
 * Throws HttpError 401 `gmail_reconnect_required` when Google reports the
 * grant is gone (user revoked access in their Google account settings).
 * @returns {Promise<{ accessToken: string, expiresAt: number }>}
 */
export async function refreshAccessToken(refreshToken) {
  const payload = await tokenRequest(
    {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: env.google.clientId,
      client_secret: env.google.clientSecret,
    },
    // invalid_grant here means the refresh token itself is dead — revoked by
    // the user, or the grant expired. The only fix is reconnecting Gmail.
    (error) => {
      if (error === 'invalid_grant') {
        throw new HttpError(
          401,
          'gmail_reconnect_required',
          'Gmail access was revoked or expired. Please reconnect your Gmail account.',
        );
      }
    },
  );

  return {
    accessToken: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
  };
}

/** Tell Google to invalidate the grant (used on disconnect). Best-effort. */
export async function revokeToken(refreshToken) {
  try {
    await fetchWithTimeout(`${REVOKE_URL}?token=${encodeURIComponent(refreshToken)}`, {
      method: 'POST',
      label: 'google',
    });
  } catch {
    // Disconnecting locally still proceeds even if the revoke call fails.
  }
}

// ---- Internals ---------------------------------------------------------------

/** POST x-www-form-urlencoded to the token endpoint and map errors. */
async function tokenRequest(params, onOAuthError) {
  const res = await fetchWithTimeout(TOKEN_URL, {
    method: 'POST',
    label: 'google',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });

  const payload = await safeJson(res);

  if (!res.ok) {
    onOAuthError?.(payload?.error);
    throw new HttpError(
      502,
      'google_oauth_error',
      payload?.error_description ?? payload?.error ?? `Google returned status ${res.status}`,
    );
  }
  return payload;
}

/**
 * Read the email address out of an id_token. The id_token is a JWT; its
 * middle segment is base64url JSON. We skip signature verification because
 * this token came to us directly from Google's token endpoint over TLS in the
 * same response — there is no untrusted party in between.
 */
function emailFromIdToken(idToken) {
  try {
    const claims = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'));
    return claims.email ?? null;
  } catch {
    return null;
  }
}
