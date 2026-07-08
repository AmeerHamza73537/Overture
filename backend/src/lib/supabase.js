// Lazily-created Supabase client. Returns null when Supabase is not configured
// so the rest of the app can degrade gracefully (in-memory cache, no history).

import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

let client = null;

export function getSupabase() {
  if (!env.supabase.enabled) return null;
  if (!client) {
    client = createClient(env.supabase.url, env.supabase.secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
