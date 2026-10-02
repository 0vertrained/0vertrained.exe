-- ============================================================
--  HYBRID ATHLETE TRACKER — DATABASE SCHEMA
--  Run this whole file once in: Supabase Dashboard → SQL Editor
-- ============================================================
--  SECURITY MODEL (read this):
--   • Each row of data is tagged with the owner's user_id.
--   • Row Level Security (RLS) is ENABLED on every table.
--   • Policies below ensure a logged-in user can ONLY read or
--     write rows where user_id = their own auth.uid().
--   • Even with the public anon key, nobody can read your data
--     without being logged in AS you. The database itself refuses.
-- ============================================================

-- ---------- 1. DAILY ENTRIES TABLE ----------
-- One row per day per user. The whole day's data is stored as JSONB
-- so the app's existing data shape carries over unchanged.
create table if not exists public.entries (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  entry_date   date not null,
  payload      jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now(),
  unique (user_id, entry_date)
);

-- Enable Row Level Security
alter table public.entries enable row level security;

-- Policies: a user may only touch their OWN rows.
drop policy if exists "entries_select_own" on public.entries;
create policy "entries_select_own"
  on public.entries for select
  using (auth.uid() = user_id);

drop policy if exists "entries_insert_own" on public.entries;
create policy "entries_insert_own"
  on public.entries for insert
  with check (auth.uid() = user_id);

drop policy if exists "entries_update_own" on public.entries;
create policy "entries_update_own"
  on public.entries for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "entries_delete_own" on public.entries;
create policy "entries_delete_own"
  on public.entries for delete
  using (auth.uid() = user_id);


-- ---------- 2. PROFILE / RECOVERY TABLE ----------
-- Stores the username and a HASHED recovery phrase (never plaintext).
-- The recovery phrase hash is used to authorize a password reset.
create table if not exists public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  username           text unique not null,
  recovery_hash      text,            -- PBKDF2/sha hash of recovery phrase, never plaintext
  recovery_kdf       text,            -- KDF version (migration_v30): null/'sha256'=legacy, 'pbkdf2-sha256-600k'=current
  created_at         timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);


-- ---------- 3. SIGNUP LOCK ----------
-- A single-row table that tracks whether signup is still open.
-- After the first account is created, the app flips this to locked.
create table if not exists public.app_state (
  id            int primary key default 1,
  signup_locked boolean not null default false,
  constraint single_row check (id = 1)
);

-- Seed the single row
insert into public.app_state (id, signup_locked)
values (1, false)
on conflict (id) do nothing;

alter table public.app_state enable row level security;

-- Anyone (even anon) may READ whether signup is locked — needed to show/hide
-- the signup form. This reveals only a single boolean, no user data.
drop policy if exists "app_state_read" on public.app_state;
create policy "app_state_read"
  on public.app_state for select
  using (true);

-- V13.5 (migration_v29): app_state is READ-ONLY for client roles. The old
-- "app_state_lock" UPDATE policy let any authenticated user rewrite
-- max_users / signup_locked; it served a long-removed client behavior and
-- was a privilege-escalation hole. The cap is managed via admin SQL or the
-- service role only. Keep the drop here so re-running the base schema after
-- v29 never resurrects the policy.
drop policy if exists "app_state_lock" on public.app_state;


-- ---------- 4. AUTO-UPDATE updated_at ----------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists entries_touch on public.entries;
create trigger entries_touch
  before update on public.entries
  for each row execute function public.touch_updated_at();

-- ============================================================
--  DONE. Your database now enforces per-user isolation at the
--  lowest level. The app code cannot override these rules.
-- ============================================================

-- ---------- 5. GRANTS (required for authenticated role to access tables) ----------
-- RLS controls which rows, but Postgres also needs explicit table-level grants.
grant usage on schema public to authenticated;
grant usage on schema public to anon;

grant all on public.entries   to authenticated;
grant all on public.profiles  to authenticated;
-- V13.5 (migration_v29): select-only — see the app_state policy note above.
grant select on public.app_state to authenticated;
grant all on public.program   to authenticated;

-- anon can only read app_state (to check signup lock)
grant select on public.app_state to anon;
