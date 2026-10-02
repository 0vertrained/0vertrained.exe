-- ============================================================
--  V12.1 (v28) — Coach usage hardening + push reminder prefs
-- ============================================================
--  Fixes three findings from the V12 audit:
--
--  1. BUG · used_this_month never reset. The daily cap resets naturally
--     (keyed by date); the monthly counter had no reset mechanism anywhere,
--     so a table-gated user who hit their monthly limit was locked out
--     permanently. coach_access gains period_start; the read RPC rolls the
--     period (and zeroes the counter) whenever the calendar month changes.
--     No cron needed — the reset is lazy, on first use of the new month.
--
--  2. RACE · read-then-write counters. bumpDailyUsage and
--     incrementCoachUsage in coach.js were read-modify-write over PostgREST.
--     Both become single atomic statements here.
--
--  3. Push reminders were one-size-fits-all (7:30pm Central for everyone).
--     push_subscriptions gains reminders_enabled + tz_offset_minutes so the
--     hourly scheduler can send at each subscriber's local evening.
--
--  All three RPCs are SECURITY DEFINER, revoked from anon/authenticated, and
--  executable only by service_role — exactly like the tables they touch.
--  coach.js calls them via /rest/v1/rpc/* with the service key and falls back
--  to the legacy read-then-write path if this migration hasn't run yet, so
--  deploy order doesn't matter.
-- ============================================================

-- ── 1 · Monthly period tracking on coach_access ─────────────────────────────

alter table public.coach_access
  add column if not exists period_start date not null default date_trunc('month', now())::date;

-- Reads the caller's access row, lazily rolling the monthly period first.
-- Returns zero rows when the user has no coach_access row (same contract the
-- old PostgREST select had).
create or replace function public.ovt_coach_access_current(p_user_id uuid)
returns table (enabled boolean, monthly_limit int, used_this_month int, tier text)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Roll the period if the stored one predates the current calendar month.
  update public.coach_access ca
     set used_this_month = 0,
         period_start    = date_trunc('month', now())::date,
         updated_at      = now()
   where ca.user_id = p_user_id
     and ca.period_start < date_trunc('month', now())::date;

  return query
  select ca.enabled, ca.monthly_limit, ca.used_this_month, ca.tier
    from public.coach_access ca
   where ca.user_id = p_user_id;
end;
$$;

-- Atomic monthly increment. No-op if the row doesn't exist (legacy env-allowed
-- users have no coach_access row and are capped by the daily limit instead).
create or replace function public.ovt_increment_coach_usage(p_user_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.coach_access
     set used_this_month = used_this_month + 1,
         updated_at      = now()
   where user_id = p_user_id;
$$;

-- ── 2 · Atomic daily counter ────────────────────────────────────────────────

-- Upsert-increment today's row and return the count AFTER increment, in one
-- statement — no read-then-write window.
create or replace function public.ovt_bump_daily_usage(p_user_id uuid)
returns int
language sql
security definer
set search_path = public
as $$
  insert into public.coach_usage_daily (user_id, day, count, updated_at)
  values (p_user_id, (now() at time zone 'utc')::date, 1, now())
  on conflict (user_id, day)
  do update set count = coach_usage_daily.count + 1, updated_at = now()
  returning count;
$$;

-- ── Lock the RPCs to the service role ───────────────────────────────────────

revoke all on function public.ovt_coach_access_current(uuid)  from public, anon, authenticated;
revoke all on function public.ovt_increment_coach_usage(uuid) from public, anon, authenticated;
revoke all on function public.ovt_bump_daily_usage(uuid)      from public, anon, authenticated;

grant execute on function public.ovt_coach_access_current(uuid)  to service_role;
grant execute on function public.ovt_increment_coach_usage(uuid) to service_role;
grant execute on function public.ovt_bump_daily_usage(uuid)      to service_role;

-- ── 3 · Per-subscription reminder preferences ───────────────────────────────

-- tz_offset_minutes matches JS Date#getTimezoneOffset() semantics: minutes to
-- ADD to local time to reach UTC (UTC-6 Central → 360, UTC+2 → -120). Default
-- 360 preserves the old behavior (7:30pm Central) for rows that predate this
-- migration. reminders_enabled lets a subscriber keep push (PRs, social)
-- while opting out of the nightly check-in nudge.
--
-- GUARDED: push is an optional feature — push_subscriptions only exists if
-- migration_add_push_subscriptions.sql (V7) was run. On databases without it
-- this section skips with a notice instead of aborting the whole transaction
-- (the coach fixes above matter regardless of push). If you enable push
-- later, the V7 migration now creates these columns itself, so nothing more
-- to do — but re-running this file is also safe (everything is idempotent).
do $$
begin
  if to_regclass('public.push_subscriptions') is null then
    raise notice 'push_subscriptions does not exist (push feature not installed) — skipping reminder-preference columns';
  else
    alter table public.push_subscriptions
      add column if not exists reminders_enabled boolean not null default true;
    alter table public.push_subscriptions
      add column if not exists tz_offset_minutes int not null default 360;
    -- Constraint added separately so re-runs don't error on duplicates.
    if not exists (
      select 1 from pg_constraint
      where conname = 'push_subscriptions_tz_offset_range'
        and conrelid = 'public.push_subscriptions'::regclass
    ) then
      alter table public.push_subscriptions
        add constraint push_subscriptions_tz_offset_range
        check (tz_offset_minutes between -840 and 840);
    end if;
  end if;
end
$$;
