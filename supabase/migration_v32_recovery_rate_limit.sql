-- ============================================================
--  V14.1 (v32) — Atomic recovery rate limiting (username + IP buckets)
-- ============================================================
--  Completes P1-4 from the V13.4.1 security review. The previous limiter in
--  netlify/functions/account-recovery.js had three gaps:
--
--   1. RACE · read-then-upsert: parallel requests could all observe
--      attempts = 4, all evaluate "allowed", and all write 5 — slipping past
--      the cap under concurrency.
--   2. SINGLE DIMENSION · keyed by username hash only, so an attacker could
--      spray one guess across many usernames, each getting a fresh bucket.
--   3. UNBOUNDED ROWS · every probed username minted a permanent row.
--
--  This migration replaces the table with a generic bucket store and a
--  single atomic RPC:
--
--   · `account_recovery_buckets` — one row per bucket key. Keys are prefixed
--     by dimension ("u:<sha256(username)>" and "ip:<sha256(ip)>"), so both
--     limits live in one table with one code path. Service-role only.
--   · `ovt_bump_recovery_attempt(p_key, p_window_ms, p_lock_ms, p_max)` —
--     SELECT ... FOR UPDATE serializes concurrent bumps on the same key
--     (fixes the race), evaluates the rolling window and lock in one
--     transaction, and opportunistically sweeps rows idle for a day
--     (fixes the unbounded growth). Returns jsonb:
--       { "allowed": bool, "retry_after_seconds": int, "attempts": int }
--
--  The old `account_recovery_attempts` table is dropped — it held only
--  ephemeral rate-limit state with a natural lifetime of minutes, so there
--  is nothing to migrate. The function code falls back to the legacy
--  read-then-upsert path if this migration has not been applied yet
--  (matching the v28 `ovt_bump_daily_usage` deploy-before-migrate pattern),
--  so deploy order is safe in either direction.
--
--  Idempotent and re-runnable, matching the v27–v31 style.
-- ============================================================

drop table if exists public.account_recovery_attempts;

create table if not exists public.account_recovery_buckets (
  bucket_key        text primary key,
  attempts          integer not null default 0 check (attempts >= 0),
  window_started_at timestamptz not null default now(),
  lock_until        timestamptz,
  updated_at        timestamptz not null default now()
);

alter table public.account_recovery_buckets enable row level security;
-- No anon/authenticated policies by design. Netlify's service role bypasses RLS.
revoke all on public.account_recovery_buckets from anon, authenticated;

create or replace function public.ovt_bump_recovery_attempt(
  p_key text,
  p_window_ms bigint default 600000,   -- 10 min rolling window
  p_lock_ms bigint default 900000,     -- 15 min lockout
  p_max_attempts int default 5
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
  v_now timestamptz := now();
  v_attempts int;
  v_lock timestamptz;
begin
  -- Opportunistic sweep: buckets idle for a day are dead weight. Scoped away
  -- from the current key so the sweep can never interfere with this bump.
  delete from public.account_recovery_buckets
   where updated_at < v_now - interval '1 day'
     and bucket_key <> p_key;

  select * into v
    from public.account_recovery_buckets
   where bucket_key = p_key
   for update;   -- serializes concurrent bumps on the same key

  if not found then
    insert into public.account_recovery_buckets (bucket_key, attempts, window_started_at, lock_until, updated_at)
    values (p_key, 1, v_now, null, v_now);
    return jsonb_build_object('allowed', true, 'retry_after_seconds', 0, 'attempts', 1);
  end if;

  -- Active lockout: report remaining time; do not touch updated_at so the
  -- retry-after countdown stays honest and the row eventually TTLs out.
  if v.lock_until is not null and v.lock_until > v_now then
    return jsonb_build_object(
      'allowed', false,
      'retry_after_seconds', greatest(1, ceil(extract(epoch from v.lock_until - v_now)))::int,
      'attempts', v.attempts
    );
  end if;

  if v_now - v.window_started_at < make_interval(secs => p_window_ms / 1000.0) then
    v_attempts := v.attempts + 1;
    if v_attempts > p_max_attempts then
      v_lock := v_now + make_interval(secs => p_lock_ms / 1000.0);
      update public.account_recovery_buckets
         set attempts = v_attempts, lock_until = v_lock, updated_at = v_now
       where bucket_key = p_key;
      return jsonb_build_object(
        'allowed', false,
        'retry_after_seconds', ceil(p_lock_ms / 1000.0)::int,
        'attempts', v_attempts
      );
    end if;
    update public.account_recovery_buckets
       set attempts = v_attempts, updated_at = v_now
     where bucket_key = p_key;
    return jsonb_build_object('allowed', true, 'retry_after_seconds', 0, 'attempts', v_attempts);
  end if;

  -- Window expired: reset.
  update public.account_recovery_buckets
     set attempts = 1, window_started_at = v_now, lock_until = null, updated_at = v_now
   where bucket_key = p_key;
  return jsonb_build_object('allowed', true, 'retry_after_seconds', 0, 'attempts', 1);
end;
$$;

revoke all on function public.ovt_bump_recovery_attempt(text, bigint, bigint, int) from public, anon, authenticated;
grant execute on function public.ovt_bump_recovery_attempt(text, bigint, bigint, int) to service_role;
