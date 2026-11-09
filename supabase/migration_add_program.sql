--  MIGRATION: Add program table
--  Run this in Supabase SQL Editor (safe to run once)

create table if not exists public.program (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  payload    jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (user_id)
);

alter table public.program enable row level security;

drop policy if exists "program_select_own" on public.program;
create policy "program_select_own"
  on public.program for select
  using (auth.uid() = user_id);

drop policy if exists "program_insert_own" on public.program;
create policy "program_insert_own"
  on public.program for insert
  with check (auth.uid() = user_id);

drop policy if exists "program_update_own" on public.program;
create policy "program_update_own"
  on public.program for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Grant permissions
grant all on public.program to authenticated;

-- Auto-update timestamp
drop trigger if exists program_touch on public.program;
create trigger program_touch
  before update on public.program
  for each row execute function public.touch_updated_at();


--  MIGRATION: Multi-user cap support
--  Run this in Supabase SQL Editor

-- Add max_users column to app_state
alter table public.app_state
  add column if not exists max_users int not null default 5;

-- Set cap to 5 and unlock signup
update public.app_state
set signup_locked = false,
    max_users = 5
where id = 1;

-- Anonymous users may check whether signup is open, but must never SELECT raw
-- profile rows. Expose only a count through a pinned-search-path RPC.
revoke select on public.profiles from anon;

drop policy if exists "profiles_count_anon" on public.profiles;

create or replace function public.get_user_count()
returns int
language sql
security definer
stable
set search_path = public
as $$
  select count(*)::int from public.profiles;
$$;

grant execute on function public.get_user_count() to anon, authenticated;
