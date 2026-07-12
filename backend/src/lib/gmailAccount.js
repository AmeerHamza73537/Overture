// Persistence for connected Gmail accounts (one per app user).
//
// Only two things are stored per user: the account's email address (for
// display) and the ENCRYPTED refresh token. Access tokens are never persisted
// — they live in memory inside services/gmail.js and expire within the hour
// anyway.
//
// The row id is the app user's id (Supabase auth user id). When Supabase is
// not configured the API runs as the shared 'default' user, which maps to the
// same id='default' row this module used before per-user auth existed.
//
// Storage backend mirrors lib/cache.js: Supabase when configured, with a
// local-file fallback (backend/.data/) so development works without it.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';
import { getSupabase } from './supabase.js';

const TABLE = 'gmail_accounts';

// ---- Local file backend (dev fallback) -------------------------------------
// One JSON file keyed by user id (migrates the old single-account shape).
const FILE_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.data', 'gmail-account.json');

function readFileStore() {
  if (!existsSync(FILE_PATH)) return {};
  try {
    const parsed = JSON.parse(readFileSync(FILE_PATH, 'utf8'));
    // Pre-auth versions stored ONE account object; wrap it under 'default'.
    if (parsed && typeof parsed === 'object' && 'refresh_token_encrypted' in parsed) {
      return { default: parsed };
    }
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeFileStore(store) {
  mkdirSync(dirname(FILE_PATH), { recursive: true });
  writeFileSync(FILE_PATH, JSON.stringify(store, null, 2));
}

const fileBackend = {
  async get(userId) {
    return readFileStore()[userId] ?? null;
  },
  async save(userId, record) {
    const store = readFileStore();
    store[userId] = record;
    writeFileStore(store);
  },
  async remove(userId) {
    const store = readFileStore();
    delete store[userId];
    writeFileStore(store);
  },
};

// ---- Supabase backend -------------------------------------------------------
const supabaseBackend = {
  async get(userId) {
    const { data, error } = await getSupabase()
      .from(TABLE)
      .select('email, refresh_token_encrypted')
      .eq('id', userId)
      .maybeSingle();
    if (error) {
      degradeIfTableMissing(error);
      return activeBackend === fileBackend ? fileBackend.get(userId) : null;
    }
    return data ?? null;
  },
  async save(userId, record) {
    const { error } = await getSupabase()
      .from(TABLE)
      .upsert({ id: userId, ...record, updated_at: new Date().toISOString() });
    if (error) {
      degradeIfTableMissing(error);
      if (activeBackend === fileBackend) return fileBackend.save(userId, record);
      throw new Error(`Could not store the Gmail account: ${error.message}`);
    }
  },
  async remove(userId) {
    await getSupabase().from(TABLE).delete().eq('id', userId);
  },
};

let activeBackend = env.supabase.enabled ? supabaseBackend : fileBackend;

function degradeIfTableMissing(error) {
  if (error?.code !== 'PGRST205' || activeBackend === fileBackend) return;
  activeBackend = fileBackend;
  console.warn(
    `[gmail] Supabase table "${TABLE}" not found — storing the encrypted token in a local file ` +
      'instead. Run backend/supabase/schema.sql in the Supabase SQL editor for durable storage.',
  );
}

/** @returns {Promise<{ email: string|null, refresh_token_encrypted: string }|null>} */
export function getGmailAccount(userId) {
  return activeBackend.get(userId);
}

/** @param {string} userId @param {{ email: string|null, refresh_token_encrypted: string }} record */
export function saveGmailAccount(userId, record) {
  return activeBackend.save(userId, record);
}

export function deleteGmailAccount(userId) {
  return activeBackend.remove(userId);
}
