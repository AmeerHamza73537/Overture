-- Migration: adds ONLY the chats table (conversation history for the app).
-- Run this if you already ran schema.sql before chat persistence existed.
-- (Fresh installs can just run schema.sql — it includes this table.)

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

alter table public.chats enable row level security;
-- No policies on purpose: only the service-role key (the backend) can access.
