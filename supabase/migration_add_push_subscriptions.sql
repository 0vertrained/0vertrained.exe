-- ============================================================
--  MIGRATION: V7 Push Subscriptions (Web Push)
--  Run this ONCE in: Supabase Dashboard → SQL Editor
--
--  Stores one row per Web Push subscription (a device/browser the
--  user enabled notifications on). Used by:
--    • netlify/functions/push-subscribe.js  (JWT-verified upsert/delete)
--    • netlify/functions/push-reminders.js  (scheduled sender + pruning)
--
--  SECURITY MODEL:
--    • ALL reads and writes go through the service role (the two
--      functions above). No client-side policies are granted at all —
--      RLS is enabled with no policies, so anon/authenticated roles
--      cannot touch this table directly.
--    • Rows contain only the push endpoint + encryption keys the
--      browser itself generated. No biometric or log data.
--
--  This migration is IDEMPOTENT and SAFE to re-run.
-- ============================================================

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  -- V12.1 · Reminder preferences (see migration_v28_usage_hardening.sql).
  -- tz_offset_minutes uses Date#getTimezoneOffset semantics; 360 = US Central.
  reminders_enabled boolean not null default true,
  tz_offset_minutes int not null default 360
    constraint push_subscriptions_tz_offset_range check (tz_offset_minutes between -840 and 840),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Idempotent upgrade path for tables created before V12.1 (the `create table
-- if not exists` above is a no-op on them, so add the columns explicitly).
alter table public.push_subscriptions
  add column if not exists reminders_enabled boolean not null default true;
alter table public.push_subscriptions
  add column if not exists tz_offset_minutes int not null default 360;

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- Intentionally NO policies: service-role only. (Enabling RLS with no
-- policies blocks anon/authenticated access entirely.)
