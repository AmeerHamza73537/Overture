// Persistence for full chat conversations (the app's message threads).
//
// Each chat row holds the complete serialized message list (user prompts,
// filter interpretations, lead results, errors) as jsonb, so reopening a chat
// restores exactly what the user saw. The app upserts the whole chat after
// every completed turn — writes are idempotent and there is no separate
// "create" step.
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

const fileBackend = {
  async list(limit) {
    return Object.values(readFileStore())
      .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
      .slice(0, limit)
      .map(({ id, title, created_at, updated_at }) => ({ id, title, created_at, updated_at }));
  },
  async get(id) {
    return readFileStore()[id] ?? null;
  },
  async upsert({ id, title, messages }) {
    const store = readFileStore();
    const now = new Date().toISOString();
    store[id] = {
      id,
      title,
      messages,
      created_at: store[id]?.created_at ?? now,
      updated_at: now,
    };
    writeFileStore(store);
  },
  async remove(id) {
    const store = readFileStore();
    delete store[id];
    writeFileStore(store);
  },
};

// ---- Supabase backend --------------------------------------------------------
const supabaseBackend = {
  async list(limit) {
    const { data, error } = await getSupabase()
      .from(TABLE)
      .select('id, title, created_at, updated_at') // no messages — keep the list light
      .order('updated_at', { ascending: false })
      .limit(limit);
    if (error) {
      degradeIfTableMissing(error);
      return activeBackend.list(limit);
    }
    return data ?? [];
  },
  async get(id) {
    const { data, error } = await getSupabase().from(TABLE).select('*').eq('id', id).maybeSingle();
    if (error) {
      degradeIfTableMissing(error);
      return activeBackend.get(id);
    }
    return data ?? null;
  },
  async upsert({ id, title, messages }) {
    const { error } = await getSupabase()
      .from(TABLE)
      .upsert({ id, title, messages, updated_at: new Date().toISOString() });
    if (error) {
      degradeIfTableMissing(error);
      return activeBackend.upsert({ id, title, messages });
    }
  },
  async remove(id) {
    const { error } = await getSupabase().from(TABLE).delete().eq('id', id);
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
export function listChats(limit = 50) {
  return activeBackend.list(limit);
}

/** @returns {Promise<object|null>} full chat including messages */
export function getChat(id) {
  return activeBackend.get(id);
}

export function upsertChat(chat) {
  return activeBackend.upsert(chat);
}

export function deleteChat(id) {
  return activeBackend.remove(id);
}
