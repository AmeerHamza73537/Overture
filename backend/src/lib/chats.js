// Persistence for full chat conversations (the app's message threads).
//
// Each chat row holds the complete serialized message list (user prompts,
// filter interpretations, lead results, errors) as jsonb, so reopening a chat
// restores exactly what the user saw. The app upserts the whole chat after
// every completed turn — writes are idempotent and there is no separate
// "create" step.
//
// Every operation is scoped to a user id: listing filters by owner, and
// get/upsert/delete refuse to touch another user's chat. (Pre-auth rows have
// user_id NULL — they belong to nobody and stop being visible.)
//
// Storage backend mirrors lib/gmailAccount.js: Supabase when configured, with
// a local-file fallback (backend/.data/chats.json) so development still works
// before the table exists. The fallback logs how to fix it.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';
import { getSupabase } from './supabase.js';

const TABLE = 'chats';
const FILE_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.data', 'chats.json');

// ---- Local file backend (dev fallback) --------------------------------------
function readFileStore() {
  if (!existsSync(FILE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(FILE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeFileStore(store) {
  mkdirSync(dirname(FILE_PATH), { recursive: true });
  writeFileSync(FILE_PATH, JSON.stringify(store));
}

// Pre-auth rows in the local file have no user_id; treat them as the shared
// 'default' user's so a Supabase-less dev setup keeps its existing chats.
const ownerOf = (chat) => chat.user_id ?? 'default';

const fileBackend = {
  async list(userId, limit) {
    return Object.values(readFileStore())
      .filter((c) => ownerOf(c) === userId)
      .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
      .slice(0, limit)
      .map(({ id, title, created_at, updated_at }) => ({ id, title, created_at, updated_at }));
  },
  async get(userId, id) {
    const chat = readFileStore()[id];
    return chat && ownerOf(chat) === userId ? chat : null;
  },
  async upsert(userId, { id, title, messages }) {
    const store = readFileStore();
    const existing = store[id];
    if (existing && ownerOf(existing) !== userId) return; // someone else's id — never overwrite
    const now = new Date().toISOString();
    store[id] = {
      id,
      user_id: userId,
      title,
      messages,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    writeFileStore(store);
  },
  async remove(userId, id) {
    const store = readFileStore();
    if (store[id] && ownerOf(store[id]) === userId) {
      delete store[id];
      writeFileStore(store);
    }
  },
};

// ---- Supabase backend --------------------------------------------------------
const supabaseBackend = {
  async list(userId, limit) {
    const { data, error } = await getSupabase()
      .from(TABLE)
      .select('id, title, created_at, updated_at') // no messages — keep the list light
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(limit);
    if (error) {
      degradeIfTableMissing(error);
      return activeBackend.list(userId, limit);
    }
    return data ?? [];
  },
  async get(userId, id) {
    const { data, error } = await getSupabase()
      .from(TABLE)
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      degradeIfTableMissing(error);
      return activeBackend.get(userId, id);
    }
    return data ?? null;
  },
  async upsert(userId, { id, title, messages }) {
    // The id is client-generated, so guard against writing over a chat that
    // happens to belong to someone else: update-if-mine, insert otherwise.
    const supabase = getSupabase();
    const row = { title, messages, updated_at: new Date().toISOString() };

    const { data: updated, error: updateError } = await supabase
      .from(TABLE)
      .update(row)
      .eq('id', id)
      .eq('user_id', userId)
      .select('id');
    if (updateError) {
      degradeIfTableMissing(updateError);
      return activeBackend.upsert(userId, { id, title, messages });
    }
    if (updated?.length) return;

    const { error: insertError } = await supabase
      .from(TABLE)
      .insert({ id, user_id: userId, ...row });
    if (insertError) {
      // 23505 = the id exists under another user; treat as a silent no-op
      // rather than leaking that the id is taken.
      if (insertError.code === '23505') return;
      degradeIfTableMissing(insertError);
      return activeBackend.upsert(userId, { id, title, messages });
    }
  },
  async remove(userId, id) {
    const { error } = await getSupabase().from(TABLE).delete().eq('id', id).eq('user_id', userId);
    if (error) degradeIfTableMissing(error);
  },
};

let activeBackend = env.supabase.enabled ? supabaseBackend : fileBackend;

function degradeIfTableMissing(error) {
  if (error?.code !== 'PGRST205' || activeBackend === fileBackend) {
    // Unexpected DB failure: surface it instead of silently losing chats.
    throw new Error(`Chat storage failed: ${error?.message ?? 'unknown error'}`);
  }
  activeBackend = fileBackend;
  console.warn(
    `[chats] Supabase table "${TABLE}" not found — storing chats in a local file instead. ` +
      'Run backend/supabase/add-chats.sql in the Supabase SQL editor for durable storage.',
  );
}

/** @returns {Promise<Array<{id,title,created_at,updated_at}>>} newest first */
export function listChats(userId, limit = 50) {
  return activeBackend.list(userId, limit);
}

/** @returns {Promise<object|null>} full chat including messages */
export function getChat(userId, id) {
  return activeBackend.get(userId, id);
}

export function upsertChat(userId, chat) {
  return activeBackend.upsert(userId, chat);
}

export function deleteChat(userId, id) {
  return activeBackend.remove(userId, id);
}
