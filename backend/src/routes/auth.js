// Authentication routes, backed by Supabase Auth (GoTrue). The app never
// talks to Supabase directly — everything goes through these endpoints, so
// the mobile client only ever needs the backend URL.
//
//   POST /api/auth/signup           { email, password, full_name? } -> { user, session }
//   POST /api/auth/signin           { email, password }             -> { user, session }
//   POST /api/auth/refresh          { refresh_token }               -> { user, session }
//   POST /api/auth/signout          (Bearer)                        -> { signed_out }
//   GET  /api/auth/me               (Bearer)                        -> { user }
//   POST /api/auth/forgot-password  { email, redirect_to? }         -> { sent }
//   POST /api/auth/reset-password   { access_token, password }      -> { reset }
//
// Password reset flow:
//   1. forgot-password -> Supabase emails the user a verification link.
//   2. The user taps it; Supabase verifies and redirects the browser to the
//      app's deep link (overture://reset-password) with the recovery session's
//      tokens in the URL fragment.
//   3. The app's reset screen collects a new password and calls
//      reset-password with that access token; we verify it and update the
//      password with the admin API.
//
// Users live in Supabase's auth.users table (plus a public.profiles row —
// see backend/supabase/add-auth.sql), so "everything is stored in the DB".

import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth, verifyAccessToken } from '../middleware/requireAuth.js';
import { HttpError } from '../utils/httpError.js';
import { env } from '../config/env.js';
import { getAuthClient } from '../lib/authClient.js';
import { getSupabase } from '../lib/supabase.js';

export const authRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 72; // bcrypt truncates beyond 72 bytes — reject instead

function ensureAuthConfigured() {
  if (!env.supabase.enabled) {
    throw new HttpError(
      503,
      'auth_not_configured',
      'Authentication requires Supabase. Set SUPABASE_URL and SUPABASE_SECRET_KEY in backend/.env — see backend/README.md.',
    );
  }
}

function readEmail(raw) {
  const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email) || email.length > 254) {
    throw new HttpError(400, 'invalid_email', 'Enter a valid email address.');
  }
  return email;
}

function readPassword(raw) {
  if (typeof raw !== 'string' || raw.length < PASSWORD_MIN) {
    throw new HttpError(400, 'weak_password', `Password must be at least ${PASSWORD_MIN} characters.`);
  }
  if (raw.length > PASSWORD_MAX) {
    throw new HttpError(400, 'password_too_long', `Password can be at most ${PASSWORD_MAX} characters.`);
  }
  return raw;
}

/** The user shape the app sees — never the raw GoTrue object. */
function shapeUser(user) {
  return {
    id: user.id,
    email: user.email ?? null,
    full_name: user.user_metadata?.full_name ?? null,
    created_at: user.created_at ?? null,
  };
}

/** The session shape the app stores. expires_at is epoch SECONDS (GoTrue's unit). */
function shapeSession(session) {
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at ?? Math.floor(Date.now() / 1000) + (session.expires_in ?? 3600),
  };
}

/** Sign in and return the { user, session } payload the app expects. */
async function passwordSignIn(email, password) {
  const { data, error } = await getAuthClient().auth.signInWithPassword({ email, password });
  if (error || !data?.session) {
    throw new HttpError(401, 'invalid_credentials', 'Incorrect email or password.');
  }
  return { user: shapeUser(data.user), session: shapeSession(data.session) };
}

// ---- Sign up -----------------------------------------------------------------

authRouter.post(
  '/signup',
  asyncHandler(async (req, res) => {
    ensureAuthConfigured();
    const { email: rawEmail, password: rawPassword, full_name } = req.body ?? {};
    const email = readEmail(rawEmail);
    const password = readPassword(rawPassword);
    const fullName = typeof full_name === 'string' ? full_name.trim().slice(0, 120) : '';

    // Created via the admin API with email_confirm so the account is usable
    // immediately — no "confirm your email" dead end during signup. Password
    // reset still proves mailbox ownership. To require verified signups
    // instead, switch this to getAuthClient().auth.signUp(...) and enable
    // "Confirm email" in the Supabase dashboard.
    const { error } = await getSupabase().auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: fullName ? { full_name: fullName } : {},
    });

    if (error) {
      if (error.code === 'email_exists' || /already.*(registered|exists)/i.test(error.message ?? '')) {
        throw new HttpError(409, 'email_in_use', 'An account with this email already exists. Sign in instead.');
      }
      if (error.code === 'weak_password') {
        throw new HttpError(400, 'weak_password', error.message);
      }
      throw new HttpError(502, 'signup_failed', error.message ?? 'Could not create the account.');
    }

    // Return a ready-to-use session so the app goes straight to the chat.
    res.status(201).json(await passwordSignIn(email, password));
  }),
);

// ---- Sign in / refresh / sign out ---------------------------------------------

authRouter.post(
  '/signin',
  asyncHandler(async (req, res) => {
    ensureAuthConfigured();
    const email = readEmail(req.body?.email);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!password) throw new HttpError(400, 'invalid_password', 'Enter your password.');

    res.json(await passwordSignIn(email, password));
  }),
);

authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    ensureAuthConfigured();
    const refreshToken = req.body?.refresh_token;
    if (typeof refreshToken !== 'string' || !refreshToken) {
      throw new HttpError(400, 'invalid_refresh_token', 'Body must include "refresh_token".');
    }

    const { data, error } = await getAuthClient().auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data?.session) {
      throw new HttpError(401, 'refresh_failed', 'Your session has expired. Please sign in again.');
    }
    res.json({ user: shapeUser(data.user), session: shapeSession(data.session) });
  }),
);

authRouter.post(
  '/signout',
  requireAuth,
  asyncHandler(async (req, res) => {
    ensureAuthConfigured();
    // Best-effort: revoke the user's refresh tokens server-side. Even if this
    // fails, the app clears its stored session, so the user is signed out.
    const token = (req.headers.authorization ?? '').split(' ')[1];
    try {
      await getSupabase().auth.admin.signOut(token);
    } catch {
      /* token already dead — that's the goal anyway */
    }
    res.json({ signed_out: true });
  }),
);

// ---- Current user ---------------------------------------------------------------

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    ensureAuthConfigured();
    const { data, error } = await getSupabase().auth.admin.getUserById(req.user.id);
    if (error || !data?.user) {
      throw new HttpError(401, 'invalid_token', 'Your session is invalid. Please sign in again.');
    }
    res.json({ user: shapeUser(data.user) });
  }),
);

// ---- Password reset --------------------------------------------------------------

authRouter.post(
  '/forgot-password',
  asyncHandler(async (req, res) => {
    ensureAuthConfigured();
    const email = readEmail(req.body?.email);

    // The app sends its own deep-link URL (it differs between Expo Go and a
    // standalone build). Supabase only redirects to URLs on its allowlist
    // (Auth -> URL Configuration), so a hostile redirect_to is harmless — it
    // falls back to the project's Site URL.
    const redirectTo =
      typeof req.body?.redirect_to === 'string' && req.body.redirect_to.length <= 500
        ? req.body.redirect_to
        : env.auth.resetRedirectUrl;

    const { error } = await getAuthClient().auth.resetPasswordForEmail(email, { redirectTo });

    if (error) {
      // Surface rate limiting (it's actionable and not an enumeration leak)…
      if (error.status === 429 || /rate limit/i.test(error.message ?? '')) {
        throw new HttpError(429, 'reset_rate_limited', 'Too many reset emails requested. Try again in a little while.');
      }
      // …but swallow everything else (e.g. unknown email) so responses don't
      // reveal which addresses have accounts.
      console.warn('[auth] resetPasswordForEmail failed:', error.message);
    }

    res.json({ sent: true, message: 'If an account exists for that email, a reset link is on its way.' });
  }),
);

authRouter.post(
  '/reset-password',
  asyncHandler(async (req, res) => {
    ensureAuthConfigured();
    const password = readPassword(req.body?.password);
    const accessToken = req.body?.access_token;
    if (typeof accessToken !== 'string' || !accessToken) {
      throw new HttpError(
        400,
        'invalid_reset_token',
        'Missing reset token. Open the link from the reset email again.',
      );
    }

    // The access token came from the recovery link the user clicked — proving
    // it verifies mailbox ownership, which authorises the password change.
    const user = await verifyAccessToken(accessToken);

    const { error } = await getSupabase().auth.admin.updateUserById(user.id, { password });
    if (error) {
      if (error.code === 'weak_password') throw new HttpError(400, 'weak_password', error.message);
      throw new HttpError(502, 'reset_failed', error.message ?? 'Could not update the password.');
    }

    // Kill the recovery session (and any other live sessions on the account) —
    // a password reset should leave exactly zero old credentials working.
    try {
      await getSupabase().auth.admin.signOut(accessToken);
    } catch {
      /* best-effort */
    }

    res.json({ reset: true, message: 'Password updated. Sign in with your new password.' });
  }),
);
