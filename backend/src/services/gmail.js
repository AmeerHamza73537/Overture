// Gmail send service: turns (to, subject, body) into real emails sent from
// the connected account, with invisible token refresh and batch pacing.

import { env } from '../config/env.js';
import { getGmailAccount } from '../lib/gmailAccount.js';
import { fetchWithTimeout, safeJson } from '../utils/http.js';
import { HttpError } from '../utils/httpError.js';
import { decryptToken } from '../utils/tokenCrypto.js';
import { refreshAccessToken } from './googleAuth.js';

const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

// ---- Access-token cache ------------------------------------------------------
// Access tokens live ~1 hour. We keep the current one in memory only (never
// persisted, never logged) and mint a new one from the encrypted refresh
// token when it's missing or about to expire. Single-account setup -> a single
// module-level slot; with per-user auth this becomes a Map keyed by user id.
let cached = null; // { accessToken, expiresAt }
const EXPIRY_MARGIN_MS = 60_000; // refresh 1 min early, never send with a dying token

/**
 * Return a usable access token, refreshing it if needed.
 * The refresh is completely invisible to the caller — it only ever sees a
 * valid token or a typed error (not connected / reconnect required).
 */
export async function getValidAccessToken({ forceRefresh = false } = {}) {
  if (!forceRefresh && cached && cached.expiresAt - EXPIRY_MARGIN_MS > Date.now()) {
    return cached.accessToken;
  }

  const account = await getGmailAccount();
  if (!account) {
    throw new HttpError(400, 'gmail_not_connected', 'No Gmail account is connected yet.');
  }

  // Decrypt only here, use immediately, keep nothing decrypted around.
  const refreshToken = decryptToken(account.refresh_token_encrypted);
  cached = await refreshAccessToken(refreshToken); // throws gmail_reconnect_required if revoked
  return cached.accessToken;
}

/** Called after connect/disconnect so a stale token is never reused. */
export function resetTokenCache() {
  cached = null;
}

// ---- Message construction ------------------------------------------------------
// The Gmail API does not take {to, subject, body} fields. It takes ONE field,
// `raw`: a complete RFC 2822 email message (the same text format mail servers
// exchange), base64url-encoded. So we assemble the message by hand:
//
//   To: lead@company.com          <- headers, one per line
//   Subject: Hello
//   MIME-Version: 1.0
//   Content-Type: text/plain; charset="UTF-8"
//                                  <- ONE blank line separates headers from body
//   Hi Jane, ...                   <- the body
//
// We deliberately omit the From header — Gmail fills it in with the
// authenticated account, which also means it can never be spoofed.

/** RFC 2047-encode a header value so emoji/accents in subjects survive. */
function encodeHeader(value) {
  // Plain ASCII needs no encoding; otherwise wrap as =?UTF-8?B?<base64>?=
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/** Build the base64url `raw` payload the Gmail API expects. */
export function buildRawMessage({ to, subject, body }) {
  const message = [
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    body,
  ].join('\r\n'); // RFC 2822 requires CRLF line endings

  return Buffer.from(message, 'utf8').toString('base64url');
}

// ---- Validation -----------------------------------------------------------------

/** Cheap sanity check to skip obviously broken addresses before sending. */
export function isLikelyValidEmail(email) {
  if (typeof email !== 'string') return false;
  // one @, something on both sides, a dot in the domain, no spaces
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

// ---- Sending -----------------------------------------------------------------------

/** Send one already-validated email. Retries once if the token just expired. */
async function sendOne(email, { retried = false } = {}) {
  const accessToken = await getValidAccessToken({ forceRefresh: retried });

  const res = await fetchWithTimeout(SEND_URL, {
    method: 'POST',
    label: 'gmail',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: buildRawMessage(email) }),
  });

  const payload = await safeJson(res);

  if (res.ok) return payload?.id ?? null; // Gmail's id for the sent message

  // 401 = the token died between our expiry check and Google's — mint a fresh
  // one and retry a single time. Any other failure is reported as-is.
  if (res.status === 401 && !retried) {
    return sendOne(email, { retried: true });
  }
  const message = payload?.error?.message ?? `Gmail returned status ${res.status}`;
  if (res.status === 429 || res.status === 403) {
    throw new HttpError(429, 'gmail_rate_limited', message);
  }
  throw new HttpError(502, 'gmail_send_failed', message);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Send a batch of emails: [{ lead_id, to, subject, body }].
 * - Invalid addresses are skipped up front (never attempted).
 * - One failure does NOT stop the batch; each email gets its own result.
 * - A pause with jitter between sends (SEND_DELAY_MS ± 30%) keeps the account
 *   under Gmail's radar — a burst of identical-looking sends is a spam signal.
 * - Exception: if Gmail access itself is gone (reconnect required), the rest
 *   of the batch is skipped since every remaining send would fail identically.
 *
 * @returns {Promise<{ results: Array<{lead_id, to, status, message_id?, error?}>, needs_reconnect: boolean }>}
 */
export async function sendBatch(emails) {
  const results = [];
  let needsReconnect = false;

  for (let i = 0; i < emails.length; i++) {
    const email = emails[i];
    const base = { lead_id: email.lead_id ?? null, to: email.to ?? null };

    if (needsReconnect) {
      results.push({ ...base, status: 'skipped', error: 'Gmail needs to be reconnected.' });
      continue;
    }
    if (!isLikelyValidEmail(email.to)) {
      results.push({ ...base, status: 'skipped', error: 'Invalid email address.' });
      continue;
    }
    if (!email.subject?.trim() || !email.body?.trim()) {
      results.push({ ...base, status: 'skipped', error: 'Empty subject or body.' });
      continue;
    }

    try {
      const messageId = await sendOne(email);
      results.push({ ...base, status: 'sent', message_id: messageId });
    } catch (err) {
      results.push({ ...base, status: 'failed', error: err.message });
      if (err instanceof HttpError && err.code === 'gmail_reconnect_required') {
        needsReconnect = true;
      }
    }

    // Pace the batch (skip the pointless wait after the last email).
    const remaining = emails.slice(i + 1).some((e) => isLikelyValidEmail(e.to));
    if (remaining && !needsReconnect) {
      const jitter = (Math.random() - 0.5) * 0.6 * env.outreach.sendDelayMs;
      await sleep(Math.max(1000, env.outreach.sendDelayMs + jitter));
    }
  }

  return { results, needs_reconnect: needsReconnect };
}
