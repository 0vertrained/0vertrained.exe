--  MIGRATION: V2.7 Multi-User Readiness + Beta Hardening
--  Run this ONCE in: Supabase Dashboard → SQL Editor
--
--  This migration is IDEMPOTENT and SAFE to run on an existing
--  project. It only ADDS things (columns, indexes, one table, a
--  couple of security-definer functions) and never DROPS user
--  data or weakens existing Row Level Security.
--
--  WHAT IT DOES
--   1. Ensures app_state.max_users exists with a sane bounded check.
--   2. Preserves app_state.signup_locked compatibility.
--   3. Adds hot-path indexes (idempotent) for multi-user scale.
--   4. Adds a coach_access table (RLS on) so coach entitlement is
--      data-driven per user instead of a single hard-coded UUID.
--      Users may READ their own row only. They can NEVER grant
--      themselves access — only service_role / admin SQL writes.
--   5. Adds delete_my_account_data() — a SECURITY DEFINER RPC that
--      deletes ONLY the caller's own data (derived from auth.uid(),
--      never from an argument) across entries/program/oura_data/
--      oura_tokens/coach_access and clears profile settings.
--
--  ADMIN SQL EXAMPLES (run manually as project owner / service role):
--    -- raise the beta user cap:
--    update public.app_state set max_users = 25 where id = 1;
--
--    -- grant coach access to a specific user:
--    insert into public.coach_access (user_id, enabled, monthly_limit, tier)
--    values ('00000000-0000-0000-0000-000000000000', true, 50, 'beta')
--    on conflict (user_id)
--    do update set enabled = excluded.enabled,
--                  monthly_limit = excluded.monthly_limit,
--                  tier = excluded.tier,
--                  updated_at = now();
--
--    -- revoke coach access:
--    update public.coach_access set enabled = false
--    where user_id = '00000000-0000-0000-0000-000000000000';


-- 1. app_state.max_users (bounded)
-- Column may already exist from migration_add_program.sql (default 5).
-- Add it if missing, then attach a sane bounded constraint. The upper
-- bound is high-but-finite so a typo can't accidentally open unlimited
-- signups; raise it deliberately via admin SQL if you ever need to.
alter table public.app_state
  add column if not exists max_users int not null default 5;

-- signup_locked compatibility: ensure the legacy column still exists.
alter table public.app_state
  add column if not exists signup_locked boolean not null default false;

-- Bounded check: 1 <= max_users <= 10000. Added conditionally so re-runs
-- don't error on the duplicate constraint name.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'app_state_max_users_range'
      and conrelid = 'public.app_state'::regclass
  ) then
    alter table public.app_state
      add constraint app_state_max_users_range
      check (max_users >= 1 and max_users <= 10000);
  end if;
end $$;

-- Make sure the singleton row exists (no-op if already seeded).
insert into public.app_state (id, signup_locked)
values (1, false)
on conflict (id) do nothing;


-- Profiles compatibility: modern auth stores a salted recovery hash. Ensure
-- the salt column exists before the deletion RPC clears both pieces.
alter table public.profiles
  add column if not exists recovery_salt text;


-- 2. Hot-path indexes (idempotent)
-- These match the app's most common per-user reads. CREATE INDEX IF NOT
-- EXISTS is safe to re-run. (Not CONCURRENTLY: the SQL Editor runs inside
-- a transaction, and these tables are small at beta scale.)
create index if not exists idx_entries_user_date
  on public.entries (user_id, entry_date);

create index if not exists idx_program_user
  on public.program (user_id);

create index if not exists idx_profiles_id
  on public.profiles (id);

create index if not exists idx_oura_data_user_date_type_v27
  on public.oura_data (user_id, date, data_type);

create index if not exists idx_oura_tokens_user
  on public.oura_tokens (user_id);


-- 3. coach_access table
-- One row per user describing coach entitlement. This is the multi-user
-- replacement for the single COACH_ALLOWED_USER_ID env var. The Netlify
-- coach function reads this table with the SERVICE ROLE key (server-side
-- only) to decide access; the legacy env var remains a fallback.
create table if not exists public.coach_access (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  enabled          boolean not null default false,
  monthly_limit    int not null default 50 check (monthly_limit >= 0 and monthly_limit <= 100000),
  used_this_month  int not null default 0 check (used_this_month >= 0),
  tier             text not null default 'beta' check (tier in ('beta', 'standard', 'pro', 'admin')),
  updated_at       timestamptz not null default now()
);

alter table public.coach_access enable row level security;

-- Users may READ their own row only (so the UI can show "coach enabled"
-- and remaining usage). No self INSERT/UPDATE/DELETE policies exist, so
-- authenticated users CANNOT grant or modify their own entitlement — the
-- default-deny of RLS blocks every write from the authenticated role.
drop policy if exists "coach_access_select_own" on public.coach_access;
create policy "coach_access_select_own"
  on public.coach_access for select
  using (auth.uid() = user_id);

-- Explicitly ensure the authenticated/anon roles cannot write. Only the
-- service_role (used exclusively server-side) manages entitlement rows.
revoke all on public.coach_access from anon, authenticated;
grant select on public.coach_access to authenticated;
grant all on public.coach_access to service_role;

-- Optional: keep updated_at fresh on service-role updates.
drop trigger if exists coach_access_touch on public.coach_access;
create trigger coach_access_touch
  before update on public.coach_access
  for each row execute function public.touch_updated_at();


-- 4. Safe coach-access read RPC (optional convenience)
-- Returns ONLY the caller's own entitlement, derived from auth.uid().
-- It never accepts a user_id argument, so it cannot be used to probe
-- whether other user IDs exist or have access. The UI can call this
-- instead of selecting the table directly.
create or replace function public.my_coach_access()
returns table (
  enabled          boolean,
  monthly_limit    int,
  used_this_month  int,
  tier             text
)
language sql
security definer
stable
set search_path = public
as $$
  select ca.enabled, ca.monthly_limit, ca.used_this_month, ca.tier
  from public.coach_access ca
  where ca.user_id = auth.uid();
$$;

revoke all on function public.my_coach_access() from public, anon;
grant execute on function public.my_coach_access() to authenticated;


-- 5. delete_my_account_data() RPC
-- Beta privacy / GDPR-style data deletion. SECURITY DEFINER so it can
-- delete across the caller's rows regardless of table grants, but it
-- derives the target STRICTLY from auth.uid() and takes NO arguments,
-- so a caller can only ever delete their OWN data. It returns a JSON
-- summary of deleted row counts.
--
-- NOTE: This intentionally does NOT delete the auth.users row itself.
-- Removing the login account requires the Supabase Admin API / service
-- role (auth.admin.deleteUser) or the dashboard, which is an admin
-- action documented in BETA_HARDENING_V2_7.md. Deleting the auth user
-- later will also cascade-remove anything left, because every data
-- table references auth.users(id) ON DELETE CASCADE.
create or replace function public.delete_my_account_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  n_entries      int := 0;
  n_program      int := 0;
  n_oura_data    int := 0;
  n_oura_tokens  int := 0;
  n_coach        int := 0;
begin
  -- Refuse to run for an unauthenticated / unresolved caller.
  if uid is null then
    raise exception 'not authenticated';
  end if;

  delete from public.entries      where user_id = uid;
  get diagnostics n_entries = row_count;

  delete from public.program      where user_id = uid;
  get diagnostics n_program = row_count;

  delete from public.oura_data    where user_id = uid;
  get diagnostics n_oura_data = row_count;

  delete from public.oura_tokens  where user_id = uid;
  get diagnostics n_oura_tokens = row_count;

  delete from public.coach_access where user_id = uid;
  get diagnostics n_coach = row_count;

  -- Clear derived settings on the profile but keep the profile row so the
  -- username stays reserved until the auth user is removed by an admin.
  update public.profiles
  set settings = '{}'::jsonb,
      recovery_hash = null,
      recovery_salt = null
  where id = uid;

  return jsonb_build_object(
    'ok', true,
    'user_id', uid,
    'deleted', jsonb_build_object(
      'entries', n_entries,
      'program', n_program,
      'oura_data', n_oura_data,
      'oura_tokens', n_oura_tokens,
      'coach_access', n_coach
    )
  );
end;
$$;

-- Only logged-in users may call it, and only ever for themselves.
revoke all on function public.delete_my_account_data() from public, anon;
grant execute on function public.delete_my_account_data() to authenticated;


--  DONE. V2.7 beta hardening applied.
--
--  Reminder: coach entitlement is written ONLY by admin/service role.
--  Users can read their own coach_access row but cannot grant it.
--  delete_my_account_data() removes the caller's own data only.
