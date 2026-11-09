--  V13.5 — Signup hardening
--  Fixes two P0 findings from the V13.4.1 security review:
--
--  1. VULN · app_state was writable by every authenticated user. The
--     legacy "app_state_lock" UPDATE policy (schema.sql, pre-V13.5) was
--     `using (auth.role() = 'authenticated')`, and the base grants included
--     `grant all on public.app_state to authenticated`. Any signed-in beta
--     user could therefore set max_users to the CHECK ceiling (10000) or
--     flip signup_locked, opening signups to the world. The policy existed
--     for a long-dead "flip the lock after first signup" client behavior;
--     nothing in src/ writes app_state today (verified: only a SELECT in
--     src/auth.js). app_state becomes read-only for anon/authenticated;
--     the cap is managed via admin SQL or the service role.
--
--  2. VULN · the signup cap was enforced client-side only. src/auth.js
--     checked getSignupStatus() in the browser and then called
--     supabase.auth.signUp with the public anon key — anyone extracting
--     that key from the bundle could mint unlimited accounts, and two
--     legitimate concurrent signups could both pass the check. A BEFORE
--     INSERT trigger on public.profiles now enforces signup_locked and
--     max_users inside the database, serialized with an advisory
--     transaction lock so concurrent inserts cannot both slip under the
--     cap. A bypasser who calls GoTrue directly still creates an orphan
--     auth.users row, but without a profile the app is unusable, the
--     username stays unclaimed, and the orphan can be pruned by admin.
--
--  The trigger raises exceptions whose messages begin with stable tokens
--  (SIGNUP_LOCKED / SIGNUP_CAP_REACHED) that src/auth.js maps to friendly
--  copy. Idempotent and re-runnable, matching the v27/v28 style.


-- ── 1 · app_state becomes read-only for client roles ────────────────────────

drop policy if exists "app_state_lock" on public.app_state;

revoke insert, update, delete on public.app_state from anon, authenticated;
grant select on public.app_state to anon, authenticated;
grant all on public.app_state to service_role;


-- ── 2 · Server-side signup cap on public.profiles ───────────────────────────

create or replace function public.ovt_enforce_signup_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max int;
  v_locked boolean;
  v_count int;
begin
  -- Serialize cap checks: two concurrent signups otherwise both read
  -- count = max - 1 and both insert. The lock is transaction-scoped and
  -- keyed to this check only, so it cannot block unrelated writes.
  perform pg_advisory_xact_lock(hashtext('ovt_signup_cap'));

  select max_users, signup_locked
    into v_max, v_locked
    from public.app_state
   where id = 1;

  if coalesce(v_locked, false) then
    raise exception 'SIGNUP_LOCKED: signups are currently closed'
      using errcode = 'P0001';
  end if;

  select count(*) into v_count from public.profiles;

  if v_count >= coalesce(v_max, 5) then
    raise exception 'SIGNUP_CAP_REACHED: this app is at its user limit'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

-- Trigger functions execute in the trigger's security context regardless of
-- EXECUTE privilege, but revoke direct invocation for hygiene anyway.
revoke all on function public.ovt_enforce_signup_cap() from public, anon, authenticated;

drop trigger if exists ovt_signup_cap on public.profiles;
create trigger ovt_signup_cap
  before insert on public.profiles
  for each row execute function public.ovt_enforce_signup_cap();


-- ── Manual verification (run as an authenticated user via SQL editor
--    impersonation or the anon-key REST API) ─────────────────────────────────
--
--   update public.app_state set max_users = 9999 where id = 1;
--     → must fail with "permission denied for table app_state".
--
--   -- with count(profiles) >= max_users:
--   insert into public.profiles (id, username) values (auth.uid(), 'test');
--     → must fail with "SIGNUP_CAP_REACHED: …".
--
--   -- with signup_locked = true (set via service role):
--   insert into public.profiles (id, username) values (auth.uid(), 'test');
--     → must fail with "SIGNUP_LOCKED: …".
