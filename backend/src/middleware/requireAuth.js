// Authentication middleware. Reads the `Authorization: Bearer <jwt>` header,
// verifies the token with Supabase Auth and attaches `req.user = { id, email }`.
//
// Verification calls Supabase's /auth/v1/user endpoint (a network round-trip),
// so results are memoised for a short window — one verification serves all
// the requests a screen fires in a burst, while a revoked token still dies
// within a minute.
//
// Graceful degradation: when Supabase is not configured at all, the API keeps
// working exactly as it did before auth existed — every request runs as the
// shared 'default' user and a warning is logged once. This keeps local dev
// (no Supabase) alive; a deployed instance should always have Supabase set.

import { env } from '../config/env.js';
import { getSupabase } from '../lib/supabase.js';
import { HttpError } from '../utils/httpError.js';

// token -> { user, expiresAt } — verified tokens, cached briefly.
const verified = new Map();
const VERIFY_TTL_MS = 60_000;
const MAX_CACHE = 5000; // hard cap so a token-spraying client can't grow this unbounded

const DEV_USER = Object.freeze({ id: 'default', email: null });
let warnedNoSupabase = false;

function readBearer(req) {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

/** Verify a Supabase access token. Returns { id, email } or throws HttpError 401. */
export async function verifyAccessToken(token) {
  const hit = verified.get(token);
  if (hit && hit.expiresAt > Date.now()) return hit.user;

  const { data, error } = await getSupabase().auth.getUser(token);
  if (error || !data?.user) {
    verified.delete(token);
    throw new HttpError(401, 'invalid_token', 'Your session is invalid or has expired. Please sign in again.');
  }

  const user = { id: data.user.id, email: data.user.email ?? null };
  if (verified.size >= MAX_CACHE) verified.clear();
  verified.set(token, { user, expiresAt: Date.now() + VERIFY_TTL_MS });
  return user;
}

export async function requireAuth(req, res, next) {
  try {
    if (!env.supabase.enabled) {
      if (!warnedNoSupabase) {
        warnedNoSupabase = true;
        console.warn(
          '[auth] Supabase is not configured — API authentication is DISABLED and all ' +
            "requests run as the shared 'default' user. Set SUPABASE_URL and " +
            'SUPABASE_SECRET_KEY to enable sign-in.',
        );
      }
      req.user = DEV_USER;
      return next();
    }

    const token = readBearer(req);
    if (!token) {
      throw new HttpError(401, 'auth_required', 'Sign in to use this endpoint.');
    }
    req.user = await verifyAccessToken(token);
    return next();
  } catch (err) {
    return next(err);
  }
}
