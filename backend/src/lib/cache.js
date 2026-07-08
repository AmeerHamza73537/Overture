// A tiny cache abstraction with two interchangeable backends:
//   1. Supabase table `query_cache` (persistent, shared across instances)
//   2. In-memory Map (fallback when Supabase isn't configured)
//
// Everything else in the app calls `cache.get()` / `cache.set()` and never
// needs to know which backend is active. Swapping in Redis later means editing
// only this file.

import { env } from '../config/env.js';
import { getSupabase } from './supabase.js';

const TABLE = 'query_cache';

// ---- In-memory backend ----------------------------------------------------
// Map<key, { value, expiresAt }>. Fine for a single Railway/Render instance.
const memory = new Map();

const memoryBackend = {
  async get(key) {
    const entry = memory.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      memory.delete(key);
      return null;
    }
    return entry.value;
  },
  async set(key, value, ttlSeconds) {
    memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  },
};

// ---- Supabase backend -----------------------------------------------------
const supabaseBackend = {
  async get(key) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from(TABLE)
      .select('value, expires_at')
      .eq('key', key)
      .maybeSingle();

    // Never let a cache failure break the request — just treat it as a miss.
    if (error) {
      degradeIfTableMissing(error);
      return null;
    }
    if (!data) return null;
    if (new Date(data.expires_at).getTime() <= Date.now()) return null;
    return data.value;
  },
  async set(key, value, ttlSeconds) {
    const supabase = getSupabase();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    // upsert so repeated writes for the same key refresh the TTL.
    const { error } = await supabase.from(TABLE).upsert(
      { key, value, expires_at: expiresAt },
      { onConflict: 'key' },
    );
    if (error) degradeIfTableMissing(error);
  },
};

// Start on Supabase when configured, but if its tables don't exist (schema.sql
// was never run) permanently fall back to memory so caching still works —
// silently-failing cache writes would burn Hunter credits on every repeat.
let activeBackend = env.supabase.enabled ? supabaseBackend : memoryBackend;
let activeName = env.supabase.enabled ? 'supabase' : 'memory';

function degradeIfTableMissing(error) {
  // PostgREST code for "table not found in schema cache".
  if (error?.code !== 'PGRST205') return;
  if (activeBackend === memoryBackend) return;
  activeBackend = memoryBackend;
  activeName = 'memory (supabase tables missing)';
  console.warn(
    `[cache] Supabase table "${TABLE}" not found — falling back to in-memory cache. ` +
      'Run backend/supabase/schema.sql in the Supabase SQL editor to enable persistent caching.',
  );
}

export const cache = {
  /** Backend name, handy for /health. */
  get backend() {
    return activeName;
  },

  /**
   * Get a cached value or null. Failures are swallowed and treated as a miss.
   * @param {string} key
   */
  async get(key) {
    try {
      return await activeBackend.get(key);
    } catch {
      return null;
    }
  },

  /**
   * Store a value with a TTL (seconds). Failures are swallowed — caching is
   * best-effort and must never break the main request.
   * @param {string} key
   * @param {unknown} value
   * @param {number} [ttlSeconds]
   */
  async set(key, value, ttlSeconds = env.cacheTtlSeconds) {
    try {
      await activeBackend.set(key, value, ttlSeconds);
    } catch {
      /* ignore */
    }
  },
};
