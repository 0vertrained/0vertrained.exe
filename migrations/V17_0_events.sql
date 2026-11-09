-- migrations/V17_0_events.sql
-- First-party funnel events (optional — the app and the log-event
-- function run fine without this table; the sink no-ops until it exists).
-- Run once in the Supabase SQL editor when you want queryable funnel numbers
-- for the beta go/no-go call.

create table if not exists public.events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) <= 64),
  client_at text,
  created_at timestamptz not null default now()
);

create index if not exists events_user_created_idx on public.events (user_id, created_at desc);
create index if not exists events_name_created_idx on public.events (name, created_at desc);

-- Writes go through the service role only (the JWT-verified log-event
-- function). No client-side access at all.
alter table public.events enable row level security;
-- No policies on purpose: with RLS enabled and zero policies, anon/authenticated
-- roles can neither read nor write; the service role bypasses RLS.

-- The funnel in one query:
--   select name, count(distinct user_id) as users
--   from events
--   where created_at > now() - interval '28 days'
--   group by name order by users desc;
