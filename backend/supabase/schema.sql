-- ---------------------------------------------------------------------------
-- Supabase schema for the Outreach backend.
-- Run this in the Supabase SQL editor (Dashboard -> SQL -> New query).
--
-- Two tables:
--   query_cache    -> caches parse/search results with a TTL (expires_at)
--   search_history -> stores each completed search for the saved-searches screen
--
-- The backend uses the SERVICE ROLE key and bypasses RLS. RLS is enabled below
-- with no permissive policies, so the anon/public key cannot read these tables.
-- ---------------------------------------------------------------------------

-- Needed for gen_random_uuid()
create extension if not exists pgcrypto;

-- --- Cache -----------------------------------------------------------------
create table if not exists public.query_cache (
  key         text primary key,
  value       jsonb       not null,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

-- Lets a scheduled job / manual cleanup purge expired rows efficiently.
create index if not exists query_cache_expires_at_idx
  on public.query_cache (expires_at);

-- --- Search history --------------------------------------------------------
create table if not exists public.search_history (
  id            uuid primary key default gen_random_uuid(),
  user_id       text,                       -- null until app auth is added
  raw_query     text        not null,
  filters       jsonb       not null,
  result_count  integer     not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists search_history_created_at_idx
  on public.search_history (created_at desc);

create index if not exists search_history_user_id_idx
  on public.search_history (user_id);

-- --- Chats ---------------------------------------------------------------------
-- Full conversation history for the app. Each row is one chat; `messages` is
-- the serialized message list (prompts, filter bubbles, lead results) so the
-- app can reopen a chat exactly as it was and continue it.
create table if not exists public.chats (
  id          uuid primary key,
  user_id     text,                                   -- null until app auth exists
  title       text        not null default 'Untitled chat',
  messages    jsonb       not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists chats_updated_at_idx
  on public.chats (updated_at desc);

-- --- Gmail connection --------------------------------------------------------
-- One row per connected Gmail account. id='default' until app auth exists,
-- after which id becomes the user id. The refresh token is stored ENCRYPTED
-- (AES-256-GCM, key in the backend's TOKEN_ENCRYPTION_KEY env var) — this
-- table never sees the plaintext token.
create table if not exists public.gmail_accounts (
  id                       text primary key,
  email                    text,
  refresh_token_encrypted  text        not null,
  connected_at             timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- --- Lock down with RLS (service role bypasses this) -----------------------
alter table public.query_cache    enable row level security;
alter table public.search_history enable row level security;
alter table public.gmail_accounts enable row level security;
alter table public.chats          enable row level security;

-- No policies added on purpose: only the service role key (server) can access.

-- --- Optional: auto-purge expired cache rows -------------------------------
-- If you enable the pg_cron extension you can schedule cleanup, e.g.:
--   select cron.schedule('purge-query-cache', '0 * * * *',
--     $$ delete from public.query_cache where expires_at < now() $$);
