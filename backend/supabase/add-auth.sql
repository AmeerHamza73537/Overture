-- ---------------------------------------------------------------------------
-- App authentication: profiles table + per-user data scoping.
-- Run this in the Supabase SQL editor (Dashboard -> SQL -> New query) AFTER
-- schema.sql / add-chats.sql / add-gmail-accounts.sql.
--
-- Accounts themselves live in Supabase Auth's own `auth.users` table (email,
-- hashed password, timestamps — managed by Supabase). This migration adds:
--   1. public.profiles — one row per user with app-facing fields, kept in
--      sync automatically by a trigger on auth.users.
--   2. Indexes for the per-user lookups the backend now performs on chats.
--
-- The user_id columns on chats / search_history and the id column on
-- gmail_accounts already exist (created as text in the earlier migrations
-- precisely for this moment) — the backend now writes the Supabase auth user
-- id (a UUID string) into them.
-- ---------------------------------------------------------------------------

-- --- Profiles ----------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Keep profiles in sync with auth.users: created on signup, updated on email
-- change, removed by the ON DELETE CASCADE above.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', null)
  )
  on conflict (id) do update
    set email      = excluded.email,
        full_name  = coalesce(excluded.full_name, public.profiles.full_name),
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update of email on auth.users
  for each row execute function public.handle_new_user();

-- --- Per-user lookups ----------------------------------------------------------
-- The backend now filters chats by owner on every list/get/delete.
create index if not exists chats_user_id_updated_at_idx
  on public.chats (user_id, updated_at desc);

-- --- Lock down with RLS (service role bypasses this) ---------------------------
alter table public.profiles enable row level security;

-- No policies added on purpose: only the service role key (server) can access.
