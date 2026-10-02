-- ============================================================
--  V4.5 Social Circles — private, invite-code group aggregates
--  Run this in the Supabase SQL Editor.
-- ============================================================
--  DESIGN / PRIVACY:
--    • Circles are PRIVATE and invite-only. Joining a circle is the opt-in.
--    • Circles expose ONLY derived aggregates (usernames + counts/sums) for
--      members, computed server-side. NEVER raw entries, payloads, biometrics,
--      notes, coach chat, or tokens.
--    • No feed, no comments, no DMs — aggregate leaderboard only.
--    • Every RPC resolves the caller from auth.uid(); none accept a user_id arg.
--    • security definer + set search_path = public on every function.
--    • Writes go through RPCs only; tables have no direct write policies, so a
--      malicious client cannot insert itself into a circle or tamper with rows.
-- ============================================================

-- ---------- TABLES ----------
create table if not exists public.social_circles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  invite_code text not null unique,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table if not exists public.social_circle_members (
  circle_id uuid not null references public.social_circles(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  role      text not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (circle_id, user_id)
);

create index if not exists social_circle_members_user_idx
  on public.social_circle_members(user_id);
create index if not exists social_circles_invite_code_idx
  on public.social_circles(invite_code);

-- ---------- MEMBERSHIP HELPER (avoids recursive RLS) ----------
-- security definer so it can read membership without tripping the members RLS
-- policy that itself calls this function.
create or replace function public.is_circle_member(p_circle uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.social_circle_members m
    where m.circle_id = p_circle and m.user_id = auth.uid()
  );
$$;

grant execute on function public.is_circle_member(uuid) to authenticated;

-- ---------- ROW LEVEL SECURITY ----------
alter table public.social_circles enable row level security;
alter table public.social_circle_members enable row level security;

-- Members (and the owner) may read circles they belong to. No insert/update/
-- delete policies exist, so all writes must go through the security-definer RPCs.
drop policy if exists social_circles_select on public.social_circles;
create policy social_circles_select on public.social_circles
  for select to authenticated
  using (public.is_circle_member(id) or owner_id = auth.uid());

-- A member may read the membership rows of circles they belong to (to see who
-- else is in the circle). Everything else is denied by default.
drop policy if exists social_circle_members_select on public.social_circle_members;
create policy social_circle_members_select on public.social_circle_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_circle_member(circle_id));

-- ---------- CREATE CIRCLE ----------
-- Creates a circle owned by the caller and adds them as the owner-member.
-- Returns { ok, circle_id, name, invite_code }.
create or replace function public.create_circle(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_name  text := nullif(btrim(coalesce(p_name, '')), '');
  v_code  text;
  v_id    uuid;
  v_tries int := 0;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  if v_name is null then
    return jsonb_build_object('ok', false, 'error', 'name_required');
  end if;
  v_name := left(v_name, 40);

  -- Cap circles owned per user to keep the feature small and abuse-resistant.
  if (select count(*) from public.social_circles where owner_id = v_uid) >= 20 then
    return jsonb_build_object('ok', false, 'error', 'too_many_circles');
  end if;

  -- Generate a short, unique, human-typable invite code (no user data in it).
  loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 7));
    exit when not exists (select 1 from public.social_circles where invite_code = v_code);
    v_tries := v_tries + 1;
    if v_tries > 8 then
      return jsonb_build_object('ok', false, 'error', 'code_generation_failed');
    end if;
  end loop;

  insert into public.social_circles (name, invite_code, owner_id)
  values (v_name, v_code, v_uid)
  returning id into v_id;

  insert into public.social_circle_members (circle_id, user_id, role)
  values (v_id, v_uid, 'owner')
  on conflict (circle_id, user_id) do nothing;

  return jsonb_build_object('ok', true, 'circle_id', v_id, 'name', v_name, 'invite_code', v_code);
end;
$$;

grant execute on function public.create_circle(text) to authenticated;

-- ---------- JOIN CIRCLE ----------
-- Joins the caller to a circle by invite code. Returns { ok, circle_id, name }.
create or replace function public.join_circle(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_code text := upper(nullif(btrim(coalesce(p_code, '')), ''));
  v_id   uuid;
  v_name text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  if v_code is null then
    return jsonb_build_object('ok', false, 'error', 'code_required');
  end if;

  -- Cap total memberships per user.
  if (select count(*) from public.social_circle_members where user_id = v_uid) >= 30 then
    return jsonb_build_object('ok', false, 'error', 'too_many_circles');
  end if;

  select id, name into v_id, v_name
  from public.social_circles
  where invite_code = v_code
  limit 1;

  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_code');
  end if;

  insert into public.social_circle_members (circle_id, user_id, role)
  values (v_id, v_uid, 'member')
  on conflict (circle_id, user_id) do nothing;

  return jsonb_build_object('ok', true, 'circle_id', v_id, 'name', v_name);
end;
$$;

grant execute on function public.join_circle(text) to authenticated;

-- ---------- LIST MY CIRCLES ----------
-- Returns { ok, circles: [{ circle_id, name, role, is_owner, member_count }] }
-- for the caller only. Invite code is included solely for circles the caller
-- owns, so they can re-share it.
create or replace function public.list_my_circles()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_out jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select jsonb_build_object(
    'ok', true,
    'circles', coalesce(jsonb_agg(jsonb_build_object(
      'circle_id',    c.id,
      'name',         c.name,
      'role',         m.role,
      'is_owner',     (c.owner_id = v_uid),
      'invite_code',  case when c.owner_id = v_uid then c.invite_code else null end,
      'member_count', (select count(*) from public.social_circle_members mm where mm.circle_id = c.id)
    ) order by c.created_at desc), '[]'::jsonb)
  ) into v_out
  from public.social_circle_members m
  join public.social_circles c on c.id = m.circle_id
  where m.user_id = v_uid;

  return coalesce(v_out, jsonb_build_object('ok', true, 'circles', '[]'::jsonb));
end;
$$;

grant execute on function public.list_my_circles() to authenticated;

-- ---------- CIRCLE AGGREGATE SUMMARY ----------
-- Members-only. Returns per-member DERIVED aggregates for the period — usernames
-- plus counts/sums. Numeric JSON fields are regex-guarded before casting. Never
-- returns raw entries, payloads, biometrics, notes, coach chat, or tokens.
create or replace function public.get_circle_summary(p_circle uuid, period_days int default 7)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_start_date date;
  v_name       text;
  v_result     jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  -- Membership is the access gate: non-members get nothing.
  if not public.is_circle_member(p_circle) then
    return jsonb_build_object('ok', false, 'error', 'not_a_member');
  end if;

  if period_days <= 0 then
    v_start_date := '1900-01-01'::date;
  else
    v_start_date := current_date - (period_days - 1);
  end if;

  select name into v_name from public.social_circles where id = p_circle;

  with members as (
    select m.user_id, pr.username
    from public.social_circle_members m
    join public.profiles pr on pr.id = m.user_id
    where m.circle_id = p_circle
      -- Joining a circle grants access to the circle, but aggregate stats still
      -- require the same explicit social-sharing opt-in as the public boards.
      and lower(pr.settings->>'socialOptIn') in ('true', 't', '1')
  ),
  agg as (
    select
      mb.username,
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
        and (e.payload->'nutrition'->>'protein')::numeric >= 150
      ), 0)::int as protein_days,
      coalesce(sum((
        select coalesce(sum(
          nullif(s->>'weight', '')::numeric * nullif(s->>'reps', '')::numeric
        ), 0)
        from jsonb_path_query_array(e.payload, '$.workout.exercises.*.sets[*]') arr,
             jsonb_array_elements(arr) s
        where (s->>'weight') ~ '^[0-9]+([.][0-9]+)?$' and (s->>'reps') ~ '^[0-9]+([.][0-9]+)?$'
      )), 0) as total_volume
    from members mb
    left join public.entries e
      on e.user_id = mb.user_id
      and e.entry_date >= v_start_date
    group by mb.username
  )
  select jsonb_build_object(
    'ok', true,
    'circle_id', p_circle,
    'name', v_name,
    'period_days', period_days,
    'member_count', (select count(*) from members),
    'members', coalesce(
      (select jsonb_agg(jsonb_build_object(
        'username',      a.username,
        'total_miles',   a.total_miles,
        'workouts_done', a.workouts_done,
        'protein_days',  a.protein_days,
        'total_volume',  a.total_volume
      ) order by a.workouts_done desc, a.username asc)
      from agg a),
      '[]'::jsonb
    )
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.get_circle_summary(uuid, int) to authenticated;

-- ============================================================
--  DONE. Private invite-only circles with aggregate summaries.
--  Raw entries remain private; only derived counts/sums are exposed.
-- ============================================================
