-- supabase/migration_add_courier.sql
-- The Courier. Run once in the Supabase SQL editor before enabling
-- the edition-courier scheduled function. Until this runs, the courier
-- degrades safely: the pref columns fall back to "enabled" via the legacy
-- select, and a missing push_log means claims fail closed — nothing sends
-- blind, nothing double-sends.

-- Yesterday's truth for the transition check. One row per user, upserted on
-- every morning run that computes a state (even when nothing is sent).
create table if not exists public.push_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  state_key text not null check (char_length(state_key) <= 24),
  state_date text not null check (state_date ~ '^\d{4}-\d{2}-\d{2}$'),
  updated_at timestamptz not null default now()
);

-- Idempotency ledger: one send per user per local date per type, claimed with
-- resolution=ignore-duplicates before any notification goes out.
create table if not exists public.push_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  date text not null check (date ~ '^\d{4}-\d{2}-\d{2}$'),
  type text not null check (type in ('edition', 'transition', 'sunday')),
  state_key text,
  created_at timestamptz not null default now(),
  unique (user_id, date, type)
);

create index if not exists push_log_user_date_idx on public.push_log (user_id, date desc);

-- Per-type preferences on the existing subscriptions table. Default true —
-- enabling notifications opts into the editions; the card offers the
-- fine-grained switches.
alter table public.push_subscriptions
  add column if not exists edition_enabled boolean not null default true,
  add column if not exists transitions_enabled boolean not null default true;

-- Service-role only (the scheduled function). RLS enabled with zero policies:
-- anon/authenticated can neither read nor write; the service role bypasses.
alter table public.push_state enable row level security;
alter table public.push_log enable row level security;
