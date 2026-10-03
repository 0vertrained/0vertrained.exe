-- Recovery phrase: set_recovery_phrase (signed-in user), username_taken
-- (anon) and bump_recovery_attempt (service role rate limit: 5 tries per
-- window, then a lock; an expired lock or window starts fresh).
-- now() is frozen in this transaction, so expiry is simulated by moving the
-- stored timestamps into the past.
create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;
select plan(41);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000601', 'rc-a@users.0vertrained.app', '{"username":"rc-a"}'),
  ('00000000-0000-4000-8000-000000000602', 'rc-b@users.0vertrained.app', '{"username":"rc-b"}');

-- ── set_recovery_phrase as user A ───────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000601","role":"authenticated"}';

select lives_ok(
  $$select public.set_recovery_phrase(repeat('ab', 32), repeat('cd', 16), 'pbkdf2-sha256-600k')$$,
  'the signed-in user can store a hash, salt and kdf');
select is((select recovery_hash from public.profiles where id = '00000000-0000-4000-8000-000000000601'), repeat('ab', 32), 'hash stored');
select is((select recovery_salt from public.profiles where id = '00000000-0000-4000-8000-000000000601'), repeat('cd', 16), 'salt stored');
select is((select recovery_kdf  from public.profiles where id = '00000000-0000-4000-8000-000000000601'), 'pbkdf2-sha256-600k', 'kdf stored');

select throws_like($$select public.set_recovery_phrase(repeat('ab', 32), null, 'pbkdf2-sha256-600k')$$, 'BAD_RECOVERY%', 'a missing salt is refused');
select throws_like($$select public.set_recovery_phrase(repeat('ab', 32), repeat('cd', 16), '')$$,            'BAD_RECOVERY%', 'an empty kdf is refused');
select throws_ok(  $$select public.set_recovery_phrase('short', repeat('cd', 16), 'pbkdf2-sha256-600k')$$, '23514', null,    'a too-short hash is refused by the column CHECK');
select is((select recovery_hash from public.profiles where id = '00000000-0000-4000-8000-000000000601'), repeat('ab', 32), 'refused calls leave the stored hash alone');

select lives_ok($$select public.set_recovery_phrase(null, null, null)$$, 'all-null clears the phrase');
select is((select recovery_hash from public.profiles where id = '00000000-0000-4000-8000-000000000601'), null, 'hash cleared');
select is((select recovery_kdf  from public.profiles where id = '00000000-0000-4000-8000-000000000601'), null, 'kdf cleared');

select lives_ok(
  $$select public.set_recovery_phrase(repeat('ef', 32), repeat('01', 16), 'pbkdf2-sha256-600k')$$,
  'a new phrase can be set again');
select is((select recovery_hash from public.profiles where id = '00000000-0000-4000-8000-000000000602'), null, 'B''s row was not touched');

-- ── set_recovery_phrase without a session / as anon ─────────────────────────
set local request.jwt.claims = '{}';
select throws_like($$select public.set_recovery_phrase(repeat('ab', 32), repeat('cd', 16), 'x')$$, 'NO_SESSION%', 'refuses without a session');

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select public.set_recovery_phrase(repeat('ab', 32), repeat('cd', 16), 'x')$$, '42501', null, 'anon cannot execute set_recovery_phrase');

-- ── username_taken as anon (the sign-up form) ───────────────────────────────
select is(public.username_taken('rc-a'),    true,  'anon: existing username is taken');
select is(public.username_taken('RC-A'),    true,  'anon: case-insensitive');
select is(public.username_taken('  rc-a '), true,  'anon: whitespace-insensitive');
select is(public.username_taken('nobody'),  false, 'anon: unknown username is free');
select is(public.username_taken(null),      false, 'anon: null is free');
select throws_ok($$select username from public.profiles$$, '42501', null, 'anon still cannot read profiles');

-- ── bump_recovery_attempt: anon and authenticated are refused ───────────────
select throws_ok($$select public.bump_recovery_attempt('rc-a')$$, '42501', null, 'anon cannot execute bump_recovery_attempt');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000601","role":"authenticated"}';
select throws_ok($$select public.bump_recovery_attempt('rc-a')$$, '42501', null, 'authenticated cannot execute bump_recovery_attempt');

-- ── bump_recovery_attempt as the service role ───────────────────────────────
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

select is(public.bump_recovery_attempt('rc-a'), '{"allowed":true,"retry_after_seconds":0,"attempts":1}'::jsonb, 'attempt 1 allowed');
select is(public.bump_recovery_attempt('RC-A') ->> 'attempts', '2', 'attempt 2 allowed (username is case-insensitive)');
select is(public.bump_recovery_attempt('rc-a') ->> 'attempts', '3', 'attempt 3 allowed');
select is(public.bump_recovery_attempt('rc-a') ->> 'attempts', '4', 'attempt 4 allowed');
select is(public.bump_recovery_attempt('rc-a'), '{"allowed":true,"retry_after_seconds":0,"attempts":5}'::jsonb, 'attempt 5 allowed');
select is(public.bump_recovery_attempt('rc-a'), '{"allowed":false,"retry_after_seconds":900,"attempts":6}'::jsonb, 'attempt 6 locks for 15 min');
select is(public.bump_recovery_attempt('rc-a'), '{"allowed":false,"retry_after_seconds":900,"attempts":6}'::jsonb, 'while locked, nothing is counted and the wait is reported');

reset role;
select is((select recovery_attempts from public.profiles where username = 'rc-a'), 6, 'the counter lives on the profiles row');
select is((select recovery_locked_until from public.profiles where username = 'rc-a'), now() + interval '15 minutes', 'the lock is stored on the profiles row');

-- the lock expires → fresh window
update public.profiles set recovery_locked_until = now() - interval '1 second' where username = 'rc-a';
set local role service_role;
select is(public.bump_recovery_attempt('rc-a'), '{"allowed":true,"retry_after_seconds":0,"attempts":1}'::jsonb, 'after the lock expires the next attempt is allowed and the window restarts');
reset role;
select is((select recovery_locked_until from public.profiles where username = 'rc-a'), null, 'the expired lock is cleared');
select is((select recovery_window_started_at from public.profiles where username = 'rc-a'), now(), 'the window restarted now');

-- the window expires → counter resets
update public.profiles set recovery_attempts = 5, recovery_window_started_at = now() - interval '11 minutes' where username = 'rc-a';
set local role service_role;
select is(public.bump_recovery_attempt('rc-a') ->> 'attempts', '1', 'an attempt after the window expired counts as 1');

-- custom limits (B): 2 attempts, 60 s lock
select is(public.bump_recovery_attempt('rc-b', 600000, 60000, 2) ->> 'allowed', 'true',  'B attempt 1 allowed with max 2');
select is(public.bump_recovery_attempt('rc-b', 600000, 60000, 2) ->> 'allowed', 'true',  'B attempt 2 allowed with max 2');
select is(public.bump_recovery_attempt('rc-b', 600000, 60000, 2), '{"allowed":false,"retry_after_seconds":60,"attempts":3}'::jsonb, 'B attempt 3 locks for 60 s');

-- unknown usernames have no row to count on
select is(public.bump_recovery_attempt('nobody'), '{"allowed":true,"retry_after_seconds":0,"attempts":0}'::jsonb, 'an unknown username reports allowed with 0 attempts');

reset role;
select is((select recovery_attempts from public.profiles where username = 'rc-b'), 3, 'B''s counter is independent of A''s');

select * from finish();
rollback;
