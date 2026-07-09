// Persistence for the connected Gmail account (single-account setup).
//
// Only two things are stored: the account's email address (for display) and
// the ENCRYPTED refresh token. Access tokens are never persisted — they live
// in memory inside services/gmail.js and expire within the hour anyway.
//
// The row uses id='default' so that when app auth lands later, the id column
// becomes the user id and this module only needs a parameter added.
//
// Storage backend mirrors lib/cache.js: Supabase when configured, with a
// local-file fallback (backend/.data/) so development works without it.

import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';
import { getSupabase } from './supabase.js';

const TABLE = 'gmail_accounts';
const ACCOUNT_ID = 'default';

// ---- Local file backend (dev fallback) -------------------------------------
const FILE_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.data', 'gmail-account.json');

const fileBackend = {
  async get() {
    if (!existsSync(FILE_PATH)) return null;
    try {
      return JSON.parse(readFileSync(FILE_PATH, 'utf8'));
    } catch {
      return null;
    }
  },
  async save(record) {
    mkdirSync(dirname(FILE_PATH), { recursive: true });
    writeFileSync(FILE_PATH, JSON.stringify(record, null, 2));
  },
  async remove() {
    rmSync(FILE_PATH, { force: true });
  },
};

// ---- Supabase backend -------------------------------------------------------
const supabaseBackend = {
  async get() {
    const { data, error } = await getSupabase()
      .from(TABLE)
      .select('email, refresh_token_encrypted')
      .eq('id', ACCOUNT_ID)
      .maybeSingle();
    if (error) {
      degradeIfTableMissing(error);
      return activeBackend === fileBackend ? fileBackend.get() : null;
    }
    return data ?? null;
  },
  async save(record) {
    const { error } = await getSupabase()
      .from(TABLE)
      .upsert({ id: ACCOUNT_ID, ...record, updated_at: new Date().toISOString() });
    if (error) {
      degradeIfTableMissing(error);
      if (activeBackend === fileBackend) return fileBackend.save(record);
      throw new Error(`Could not store the Gmail account: ${error.message}`);
    }
  },
  async remove() {
    await getSupabase().from(TABLE).delete().eq('id', ACCOUNT_ID);
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
export function getGmailAccount() {
  return activeBackend.get();
}

/** @param {{ email: string|null, refresh_token_encrypted: string }} record */
export function saveGmailAccount(record) {
  return activeBackend.save(record);
}

export function deleteGmailAccount() {
  return activeBackend.remove();
}
