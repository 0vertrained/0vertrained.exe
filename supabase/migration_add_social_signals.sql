-- ============================================================
--  V4.4 Social Signals: get_social_summary RPC
--  Returns a single JSONB object with aggregate social data.
--
--  Security model:
--    • security definer + set search_path = public: no schema injection
--    • auth.uid(): current user resolved server-side; no user_id arg
--    • Only opted-in users: lower(p.settings->>'socialOptIn') in ('true', 't', '1')
--    • Returns only derived aggregates (usernames, counts, sums, ranks, gaps, deltas)
--    • Never returns raw entries, payloads, biometrics, notes, coach chat, or tokens
--    • Numeric JSON fields guarded by regex before casting
-- ============================================================

create or replace function public.get_social_summary(period_days int default 7)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_username   text;
  v_start_date date;
  v_prior_start date;
  v_result     jsonb;
begin
  -- Date windows; period_days <= 0 means all-time (no meaningful prior period)
  if period_days <= 0 then
    v_start_date  := '1900-01-01'::date;
    v_prior_start := '1900-01-01'::date;
  else
    v_start_date  := current_date - (period_days - 1);
    v_prior_start := current_date - (period_days * 2 - 1);
  end if;

  -- Resolve caller's username; null if unauthenticated or no profile
  select username into v_username
  from public.profiles
  where id = v_uid
  limit 1;

  with
  -- Only opted-in users appear on shared boards
  opted_in as (
    select p.id, p.username
    from public.profiles p
    where lower(p.settings->>'socialOptIn') in ('true', 't', '1')
  ),

  -- Current-period aggregates per opted-in user
  -- Numeric JSON values guarded by regex before casting to prevent exceptions
  cur as (
    select
      o.username,
      coalesce(sum(
        case when (e.payload->'workout'->'cardio'->>'miles') ~ '^[0-9]+([.][0-9]+)?$'
             then (e.payload->'workout'->'cardio'->>'miles')::numeric
             else 0 end
      ), 0) as total_miles,
      coalesce(count(*) filter (where
        (e.payload->'workout'->>'completed') = 'true'
      ), 0)::int as workouts_done,
      coalesce(count(*) filter (where
        (e.payload->'nutrition'->>'protein') ~ '^[0-9]+([.][0-9]+)?$'
        and (e.payload->'nutrition'->>'protein')::numeric >= 200
      ), 0)::int as protein_days,
      coalesce(sum((
        select coalesce(sum(
          nullif(s->>'weight', '')::numeric * nullif(s->>'reps', '')::numeric
        ), 0)
        from jsonb_path_query_array(e.payload, '$.workout.exercises.*.sets[*]') arr,
             jsonb_array_elements(arr) s
        where (s->>'weight') ~ '^[0-9]+([.][0-9]+)?$' and (s->>'reps') ~ '^[0-9]+([.][0-9]+)?$'
      )), 0) as total_volume,
      coalesce(count(*) filter (where
        (e.payload->'nutrition'->>'water') ~ '^[0-9]+([.][0-9]+)?$'
        and (e.payload->'nutrition'->>'water')::numeric >= 128
      ), 0)::int as water_days
    from opted_in o
    left join public.entries e
      on e.user_id = o.id
      and e.entry_date >= v_start_date
    group by o.username
  ),

  -- Rank current period by workouts_done; lag() gives the value of the person one rank above
  ranked_cur as (
    select
      *,
      rank() over (order by workouts_done desc) as workouts_rank,
      lag(workouts_done) over (order by workouts_done desc) as workouts_above
    from cur
  ),

  -- Prior-period workouts per opted-in user (for rank-delta; null when all-time)
  prior_cur as (
    select
      o.username,
      coalesce(count(*) filter (where
        e.entry_date >= v_prior_start
        and e.entry_date < v_start_date
        and (e.payload->'workout'->>'completed') = 'true'
      ), 0)::int as workouts_done
    from opted_in o
    left join public.entries e on e.user_id = o.id
    group by o.username
  ),

  ranked_prior as (
    select
      username,
      rank() over (order by workouts_done desc) as workouts_rank
    from prior_cur
  )

  select jsonb_build_object(
    -- Shared board rows: username + aggregate category values only
    'leaderboard', coalesce(
      (select jsonb_agg(jsonb_build_object(
        'username',      r.username,
        'total_miles',   r.total_miles,
        'workouts_done', r.workouts_done,
        'protein_days',  r.protein_days,
        'total_volume',  r.total_volume,
        'water_days',    r.water_days
      ) order by r.workouts_done desc)
      from ranked_cur r),
      '[]'::jsonb
    ),

    -- Per-category board averages
    'board_averages', coalesce(
      (select jsonb_build_object(
        'total_miles',   round(avg(total_miles)::numeric, 2),
        'workouts_done', round(avg(workouts_done::numeric), 2),
        'protein_days',  round(avg(protein_days::numeric), 2),
        'total_volume',  round(avg(total_volume)::numeric, 2),
        'water_days',    round(avg(water_days::numeric), 2)
      ) from cur),
      '{}'::jsonb
    ),

    -- Category leaders: {category, username, value} — no raw payload exposure
    'highlights', coalesce(
      (select jsonb_agg(jsonb_build_object(
        'category', sq.cat,
        'username',  sq.uname,
        'value',     sq.val
      ))
      from (
        (select 'total_miles'::text   as cat, username as uname, total_miles::numeric   as val from cur where total_miles   > 0 order by total_miles   desc limit 1)
        union all
        (select 'workouts_done'::text,        username,          workouts_done::numeric          from cur where workouts_done > 0 order by workouts_done desc limit 1)
        union all
        (select 'protein_days'::text,         username,          protein_days::numeric           from cur where protein_days  > 0 order by protein_days  desc limit 1)
        union all
        (select 'total_volume'::text,         username,          total_volume::numeric           from cur where total_volume  > 0 order by total_volume  desc limit 1)
        union all
        (select 'water_days'::text,           username,          water_days::numeric             from cur where water_days    > 0 order by water_days    desc limit 1)
      ) sq
      where sq.uname is not null),
      '[]'::jsonb
    ),

    -- Current-user rank context: rank, gap to next person up, period-over-period delta
    -- null when caller is unauthenticated or not on the board
    'current_user', (
      select jsonb_build_object(
        'username',       v_username,
        'workouts_rank',  rc.workouts_rank,
        'total_users',    (select count(*)::int from cur),
        -- gap_to_next: null when user is #1 (lag returns null for leader row)
        'gap_to_next',    rc.workouts_above - rc.workouts_done,
        -- rank_delta: prior_rank - current_rank; positive = moved up; null for all-time
        'rank_delta',     case when period_days <= 0 then null
                          else coalesce(rp.workouts_rank::int, rc.workouts_rank::int)
                               - rc.workouts_rank::int
                          end,
        'prior_rank',     case when period_days <= 0 then null
                          else rp.workouts_rank::int
                          end
      )
      from ranked_cur rc
      left join ranked_prior rp on rp.username = v_username
      where rc.username = v_username
    )
  ) into v_result;

  return coalesce(v_result, jsonb_build_object(
    'leaderboard',   '[]'::jsonb,
    'board_averages', '{}'::jsonb,
    'highlights',    '[]'::jsonb,
    'current_user',  null
  ));
end;
$$;

grant execute on function public.get_social_summary(int) to authenticated;
