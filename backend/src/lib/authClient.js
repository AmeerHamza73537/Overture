// Supabase client dedicated to AUTH operations (sign up, sign in, refresh,
// password reset). Kept separate from lib/supabase.js on purpose:
// signInWithPassword() stores the resulting session on the client instance,
// and supabase-js attaches that session's access token to subsequent
// PostgREST calls — sharing one client would silently downgrade the service
// role's DB queries to whichever user signed in last.
//
// This client is NEVER used for .from() queries, only .auth.* calls, and the
// session it returns is passed back to the caller rather than kept.

import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

let client = null;

export function getAuthClient() {
  if (!env.supabase.enabled) return null;
  if (!client) {
    client = createClient(
      env.supabase.url,
      // The publishable (anon) key is the correct key for user-facing auth
      // calls; GoTrue also accepts the secret key, so it works as a fallback.
      env.supabase.publishableKey || env.supabase.secretKey,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return client;
}
