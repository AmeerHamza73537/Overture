-- Migration: adds ONLY the gmail_accounts table.
-- Run this if you already ran schema.sql before the Gmail feature existed.
-- (Fresh installs can just run schema.sql — it includes this table.)

create table if not exists public.gmail_accounts (
  id                       text primary key,
  email                    text,
  refresh_token_encrypted  text        not null,
  connected_at             timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

alter table public.gmail_accounts enable row level security;
-- No policies on purpose: only the service-role key (the backend) can access.
