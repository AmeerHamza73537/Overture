// Gmail connection routes.
//
//   GET    /api/gmail/status    -> { configured, connected, email }
//   GET    /api/gmail/connect   -> 302 redirect to Google's consent screen
//   GET    /api/gmail/callback  -> Google redirects here; we store the tokens
//   DELETE /api/gmail/account   -> revoke + forget the connection
//
// /connect and /callback are BROWSER pages (redirects/HTML), not JSON — the
// app opens /connect in the phone/PC browser and the user finishes there.

import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { deleteGmailAccount, getGmailAccount, saveGmailAccount } from '../lib/gmailAccount.js';
import { decryptToken, encryptToken } from '../utils/tokenCrypto.js';
import {
  buildAuthUrl,
  consumeState,
  ensureGoogleConfigured,
  exchangeCode,
  issueState,
  revokeToken,
} from '../services/googleAuth.js';
import { resetTokenCache } from '../services/gmail.js';
import { env } from '../config/env.js';

export const gmailRouter = Router();

gmailRouter.get(
  '/gmail/status',
  asyncHandler(async (req, res) => {
    const account = await getGmailAccount();
    res.json({
      configured: env.google.configured,
      connected: Boolean(account),
      email: account?.email ?? null,
    });
  }),
);

gmailRouter.get(
  '/gmail/connect',
  asyncHandler(async (req, res) => {
    ensureGoogleConfigured();
    // Redirect the browser to Google with a fresh CSRF state value.
    res.redirect(buildAuthUrl(issueState()));
  }),
);

gmailRouter.get(
  '/gmail/callback',
  asyncHandler(async (req, res) => {
    const { code, state, error } = req.query;

    // User clicked "Cancel" on the consent screen, or Google reported an error.
    if (error || typeof code !== 'string') {
      return res.status(400).send(page('Connection cancelled', String(error ?? 'No code returned.'), false));
    }
    if (typeof state !== 'string' || !consumeState(state)) {
      return res.status(400).send(page('Connection rejected', 'Invalid or expired state. Start again from the app.', false));
    }

    const { refreshToken, email } = await exchangeCode(code);

    // The refresh token is encrypted BEFORE it is stored anywhere; the
    // plaintext exists only inside this request.
    await saveGmailAccount({ email, refresh_token_encrypted: encryptToken(refreshToken) });
    resetTokenCache();

    res.send(page('Gmail connected', `Connected as ${email ?? 'your account'}. You can close this tab and return to the app.`, true));
  }),
);

gmailRouter.delete(
  '/gmail/account',
  asyncHandler(async (req, res) => {
    const account = await getGmailAccount();
    if (account) {
      // Best-effort: tell Google to invalidate the grant too, so the token is
      // dead even if a backup of the database exists somewhere.
      try {
        await revokeToken(decryptToken(account.refresh_token_encrypted));
      } catch {
        /* still disconnect locally */
      }
      await deleteGmailAccount();
      resetTokenCache();
    }
    res.json({ disconnected: true });
  }),
);

/** Minimal self-contained HTML page for the browser steps of the flow. */
function page(title, message, ok) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { font-family: system-ui, sans-serif; background: #F4F6FB; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  .card { background: #fff; border-radius: 16px; padding: 32px 40px; text-align: center; max-width: 380px; box-shadow: 0 4px 24px rgba(15,23,42,.08); }
  .icon { font-size: 40px; }
  h1 { font-size: 20px; color: #0F172A; margin: 12px 0 8px; }
  p { color: #64748B; font-size: 14px; line-height: 1.5; margin: 0; }
</style></head>
<body><div class="card"><div class="icon">${ok ? '✅' : '⚠️'}</div><h1>${title}</h1><p>${message}</p></div></body></html>`;
}
