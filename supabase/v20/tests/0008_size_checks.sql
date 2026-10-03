-- Size and format CHECK constraints: settings 16 KiB, program 64 KiB,
-- entries 32 KiB, username format, client_errors field caps, recovery
-- column caps. octet_length(jsonb::text) of {"pad": "xxx"} is len(pad) + 11.
create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;
select plan(21);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000501', 'sz-a@users.0vertrained.app', '{"username":"sz-a"}');

-- sanity: the arithmetic the boundary tests rely on
select is(octet_length(jsonb_build_object('pad', repeat('x', 100))::text), 111, 'octet_length of {"pad": <100 x>} is 111');

-- ── profiles.settings ≤ 16384 ───────────────────────────────────────────────
select lives_ok(
  format($$update public.profiles set settings = jsonb_build_object('pad', repeat('x', %s)) where id = '00000000-0000-4000-8000-000000000501'$$, 16384 - 11),
  'settings of exactly 16384 bytes is accepted');
select throws_ok(
  format($$update public.profiles set settings = jsonb_build_object('pad', repeat('x', %s)) where id = '00000000-0000-4000-8000-000000000501'$$, 16384 - 10),
  '23514', null, 'settings of 16385 bytes is rejected');

-- ── program.payload ≤ 65536 ─────────────────────────────────────────────────
select lives_ok(
  format($$insert into public.program (user_id, payload) values ('00000000-0000-4000-8000-000000000501', jsonb_build_object('pad', repeat('x', %s)))$$, 65536 - 11),
  'program of exactly 65536 bytes is accepted');
select throws_ok(
  format($$update public.program set payload = jsonb_build_object('pad', repeat('x', %s)) where user_id = '00000000-0000-4000-8000-000000000501'$$, 65536 - 10),
  '23514', null, 'program of 65537 bytes is rejected');
select throws_ok(
  $$insert into public.program (user_id, payload) values ('00000000-0000-4000-8000-000000000501', null)$$,
  '23502', null, 'program payload cannot be null');

-- ── entries.payload ≤ 32768 ─────────────────────────────────────────────────
select lives_ok(
  format($$insert into public.entries (user_id, entry_date, payload) values ('00000000-0000-4000-8000-000000000501', current_date, jsonb_build_object('pad', repeat('x', %s)))$$, 32768 - 11),
  'entry of exactly 32768 bytes is accepted');
select throws_ok(
  format($$update public.entries set payload = jsonb_build_object('pad', repeat('x', %s)) where user_id = '00000000-0000-4000-8000-000000000501'$$, 32768 - 10),
  '23514', null, 'entry of 32769 bytes is rejected');
select throws_ok(
  $$insert into public.entries (user_id, entry_date, payload) values ('00000000-0000-4000-8000-000000000501', current_date - 1, null)$$,
  '23502', null, 'entry payload cannot be null');

-- ── username format ─────────────────────────────────────────────────────────
select throws_ok($$update public.profiles set username = 'ab'  where id = '00000000-0000-4000-8000-000000000501'$$, '23514', null, 'username shorter than 3 is rejected');
select throws_ok($$update public.profiles set username = 'Abc' where id = '00000000-0000-4000-8000-000000000501'$$, '23514', null, 'upper-case username is rejected');
select throws_ok($$update public.profiles set username = 'a b' where id = '00000000-0000-4000-8000-000000000501'$$, '23514', null, 'username with a space is rejected');
select throws_ok($$update public.profiles set username = 'a@b' where id = '00000000-0000-4000-8000-000000000501'$$, '23514', null, 'username with @ is rejected');
select throws_ok(format($$update public.profiles set username = '%s' where id = '00000000-0000-4000-8000-000000000501'$$, repeat('a', 33)), '23514', null, '33-character username is rejected');
select lives_ok($$update public.profiles set username = 'a.b_c-d9' where id = '00000000-0000-4000-8000-000000000501'$$, 'dots, underscores, dashes and digits are accepted');

-- ── recovery column caps ────────────────────────────────────────────────────
select throws_ok(format($$update public.profiles set recovery_hash = '%s' where id = '00000000-0000-4000-8000-000000000501'$$, repeat('a', 257)), '23514', null, 'recovery_hash over 256 chars is rejected');
select throws_ok($$update public.profiles set recovery_salt = 'short' where id = '00000000-0000-4000-8000-000000000501'$$, '23514', null, 'recovery_salt under 16 chars is rejected');
select throws_ok($$update public.profiles set recovery_attempts = -1 where id = '00000000-0000-4000-8000-000000000501'$$, '23514', null, 'negative recovery_attempts is rejected');

-- ── client_errors field caps ────────────────────────────────────────────────
select lives_ok(
  format($$insert into public.client_errors (user_id, message, stack) values ('00000000-0000-4000-8000-000000000501', '%s', '%s')$$, repeat('m', 2000), repeat('s', 8000)),
  'client_errors message of 2000 and stack of 8000 chars are accepted');
select throws_ok(
  format($$insert into public.client_errors (message) values ('%s')$$, repeat('m', 2001)),
  '23514', null, 'client_errors message over 2000 chars is rejected');
select throws_ok(
  format($$insert into public.client_errors (message, user_agent) values ('x', '%s')$$, repeat('u', 513)),
  '23514', null, 'client_errors user_agent over 512 chars is rejected');

select * from finish();
rollback;
