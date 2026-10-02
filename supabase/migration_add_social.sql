-- ============================================================
--  MIGRATION: Social features (Leaderboard + PR Board)
--  Run this in Supabase SQL Editor
-- ============================================================
--  DESIGN / PRIVACY:
--   Other users' raw daily entries stay private (RLS unchanged).
--   We expose ONLY opt-in users' derived leaderboard stats and PR records through
--   security-definer functions that compute aggregates server-side
--   and return usernames + numbers — never the underlying entries.
-- ============================================================

-- ---------- LEADERBOARD FUNCTION ----------
-- Returns per-user aggregate stats for a given time window.
-- period_days: 7 = this week, 30 = this month, 0 = all time
create or replace function public.get_leaderboard(period_days int default 7)
returns table (
  username      text,
  total_miles   numeric,
  workouts_done int,
  protein_days  int,
  total_volume  numeric,
  water_days    int
)
language sql
security definer
stable
set search_path = public
as $$
  with cutoff as (
    select case when period_days <= 0
                then '1900-01-01'::date
                else (current_date - (period_days - 1))
           end as start_date
  )
  select
    p.username,
    coalesce(sum( (e.payload->'workout'->'cardio'->>'miles')::numeric ), 0) as total_miles,
    coalesce(count(*) filter (where (e.payload->'workout'->>'completed')::boolean is true), 0)::int as workouts_done,
    coalesce(count(*) filter (where (e.payload->'nutrition'->>'protein')::numeric >= 200), 0)::int as protein_days,
    coalesce(sum(
      ( select coalesce(sum(
            (s->>'weight')::numeric * (s->>'reps')::numeric
          ), 0)
        from jsonb_path_query_array(e.payload, '$.workout.exercises.*.sets[*]') as arr,
             jsonb_array_elements(arr) as s
        where (s->>'weight') ~ '^[0-9.]+$' and (s->>'reps') ~ '^[0-9.]+$'
      )
    ), 0) as total_volume,
    coalesce(count(*) filter (where (e.payload->'nutrition'->>'water')::numeric >= 128), 0)::int as water_days
  from public.profiles p
  left join public.entries e
    on e.user_id = p.id
   and e.entry_date >= (select start_date from cutoff)
  where coalesce((p.settings->>'socialOptIn')::boolean, false) is true
  group by p.username;
$$;

grant execute on function public.get_leaderboard(int) to authenticated;

-- ---------- PR BOARD FUNCTION ----------
-- Returns the best (heaviest) logged set per exercise per user.
create or replace function public.get_lifting_prs()
returns table (
  username     text,
  exercise     text,
  best_weight  numeric
)
language sql
security definer
stable
set search_path = public
as $$
  select
    p.username,
    ex.key as exercise,
    max( (s->>'weight')::numeric ) as best_weight
  from public.profiles p
  join public.entries e on e.user_id = p.id
  cross join lateral jsonb_each(e.payload->'workout'->'exercises') as ex(key, val)
  cross join lateral jsonb_array_elements(ex.val->'sets') as s
  where (s->>'weight') ~ '^[0-9.]+$'
    and (s->>'weight')::numeric > 0
    and coalesce((p.settings->>'socialOptIn')::boolean, false) is true
  group by p.username, ex.key;
$$;

grant execute on function public.get_lifting_prs() to authenticated;

-- ---------- RUNNING PR FUNCTION ----------
-- Best (fastest) pace and longest run per user.
create or replace function public.get_running_prs()
returns table (
  username      text,
  longest_run   numeric,
  best_pace_str text
)
language sql
security definer
stable
set search_path = public
as $$
  select
    p.username,
    coalesce(max( (e.payload->'workout'->'cardio'->>'miles')::numeric ), 0) as longest_run,
    (
      select c.payload->'workout'->'cardio'->>'pace'
      from public.entries c
      where c.user_id = p.id
        and (c.payload->'workout'->'cardio'->>'pace') is not null
        and (c.payload->'workout'->'cardio'->>'pace') <> ''
      order by c.entry_date desc
      limit 1
    ) as best_pace_str
  from public.profiles p
  join public.entries e on e.user_id = p.id
  where coalesce((p.settings->>'socialOptIn')::boolean, false) is true
  group by p.username, p.id;
$$;

grant execute on function public.get_running_prs() to authenticated;

-- ============================================================
--  DONE. Leaderboard + PR data is now available via RPC.
--  Raw entries remain private to each user via RLS.
-- ============================================================
