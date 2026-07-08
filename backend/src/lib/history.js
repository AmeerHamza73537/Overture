// Best-effort search-history persistence. Writes to the Supabase
// `search_history` table when configured; otherwise is a no-op. Never throws —
// recording history must not affect the response the user gets.

import { getSupabase } from './supabase.js';

const TABLE = 'search_history';

/**
 * Record one completed search.
 * @param {object} entry
 * @param {string|null} [entry.userId]     Optional app user id (added later).
 * @param {string} entry.rawQuery          The natural-language query.
 * @param {object} entry.filters           The structured filters used.
 * @param {number} entry.resultCount       How many leads were returned.
 */
let warnedMissingTable = false;

export async function recordSearch({ userId = null, rawQuery, filters, resultCount }) {
  const supabase = getSupabase();
  if (!supabase) return; // history disabled without Supabase

  try {
    const { error } = await supabase.from(TABLE).insert({
      user_id: userId,
      raw_query: rawQuery,
      filters,
      result_count: resultCount,
    });
    if (error?.code === 'PGRST205' && !warnedMissingTable) {
      warnedMissingTable = true;
      console.warn(
        `[history] Supabase table "${TABLE}" not found — search history is disabled. ` +
          'Run backend/supabase/schema.sql in the Supabase SQL editor to enable it.',
      );
    }
  } catch {
    /* swallow — non-critical */
  }
}

/**
 * Fetch recent searches (most recent first). Returns [] when Supabase is off.
 * Wired here so the saved-searches screen can call it later.
 * @param {{ userId?: string|null, limit?: number }} [opts]
 */
export async function listSearches({ userId = null, limit = 50 } = {}) {
  const supabase = getSupabase();
  if (!supabase) return [];

  let query = supabase
    .from(TABLE)
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (userId) query = query.eq('user_id', userId);

  const { data, error } = await query;
  if (error) return [];
  return data ?? [];
}
