-- ============================================================
--  MIGRATION: V9 Beta Visibility — client_errors + coach daily usage
--  Run this ONCE in: Supabase Dashboard → SQL Editor
--
--  1. client_errors — one row per reported client-side error
--     (uncaught exceptions, unhandled rejections, ErrorBoundary
--     catches). Written only by netlify/functions/log-error.js
--     after JWT verification; fields are clamped server-side.
--     Contains NO entries, settings, or biometric data — only the
--     error itself, route path, app version, and user agent.
--
--  2. coach_usage_daily — per-user per-day coach message counter,
--     enforced by netlify/functions/coach.js as a hard daily cap
--     that applies to EVERY account (including the legacy env-
--     allowed user, who previously had no limit at all).
--
--  SECURITY MODEL: both tables are service-role only. RLS is
--  enabled with zero policies, so anon/authenticated roles cannot
--  read or write them directly.
--
--  This migration is IDEMPOTENT and SAFE to re-run.
-- ============================================================

create table if not exists public.client_errors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  message text not null,
  stack text,
  component_stack text,
  source text,
  path text,
  app_version text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists client_errors_created_idx
  on public.client_errors (created_at desc);
create index if not exists client_errors_user_idx
  on public.client_errors (user_id);

alter table public.client_errors enable row level security;
-- Intentionally NO policies: service-role only.

create table if not exists public.coach_usage_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.coach_usage_daily enable row level security;
-- Intentionally NO policies: service-role only.
