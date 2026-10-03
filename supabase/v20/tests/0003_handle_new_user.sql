-- handle_new_user(): an auth.users insert produces the profiles row with the
-- lower-cased username from the sign-up metadata (or the email's local
-- part), and refuses duplicates and invalid names with stable messages.
create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;
select plan(17);

-- username from metadata, lower-cased
insert into auth.users (id, email, raw_user_meta_data)
values ('00000000-0000-4000-8000-000000000101', 'Alice@users.0vertrained.app', '{"username":"Alice"}');
select is((select username from public.profiles where id = '00000000-0000-4000-8000-000000000101'), 'alice',
  'metadata username is stored lower-cased');
select is((select settings from public.profiles where id = '00000000-0000-4000-8000-000000000101'), '{}'::jsonb,
  'new profile has empty settings');
select is((select recovery_hash from public.profiles where id = '00000000-0000-4000-8000-000000000101'), null,
  'new profile has no recovery phrase');
select is((select recovery_attempts from public.profiles where id = '00000000-0000-4000-8000-000000000101'), 0,
  'new profile has zero recovery attempts');

-- whitespace is trimmed
insert into auth.users (id, email, raw_user_meta_data)
values ('00000000-0000-4000-8000-000000000102', 'carol@users.0vertrained.app', '{"username":"  Carol  "}');
select is((select username from public.profiles where id = '00000000-0000-4000-8000-000000000102'), 'carol',
  'metadata username is trimmed');

-- fallback: email local part, lower-cased
insert into auth.users (id, email, raw_user_meta_data)
values ('00000000-0000-4000-8000-000000000103', 'Bob.Smith@users.0vertrained.app', '{}');
select is((select username from public.profiles where id = '00000000-0000-4000-8000-000000000103'), 'bob.smith',
  'without metadata the email local part is used, lower-cased');

-- metadata wins over the email
insert into auth.users (id, email, raw_user_meta_data)
values ('00000000-0000-4000-8000-000000000104', 'zzz@users.0vertrained.app', '{"username":"frank"}');
select is((select username from public.profiles where id = '00000000-0000-4000-8000-000000000104'), 'frank',
  'metadata username beats the email local part');

-- an empty metadata username falls back to the email
insert into auth.users (id, email, raw_user_meta_data)
values ('00000000-0000-4000-8000-000000000105', 'grace@users.0vertrained.app', '{"username":""}');
select is((select username from public.profiles where id = '00000000-0000-4000-8000-000000000105'), 'grace',
  'empty metadata username falls back to the email');

-- duplicates (case-insensitively) are refused and the auth row is not kept
select throws_like(
  $$insert into auth.users (id, email, raw_user_meta_data)
    values ('00000000-0000-4000-8000-000000000106', 'other@users.0vertrained.app', '{"username":"ALICE"}')$$,
  'USERNAME_TAKEN%', 'a taken username (any case) is refused');
select is((select count(*) from auth.users where id = '00000000-0000-4000-8000-000000000106'), 0::bigint,
  '...and the auth.users row does not survive');
select throws_like(
  $$insert into auth.users (id, email, raw_user_meta_data)
    values ('00000000-0000-4000-8000-000000000107', 'alice@users.0vertrained.app', '{}')$$,
  'USERNAME_TAKEN%', 'a taken username via the email fallback is refused');

-- invalid names
select throws_like(
  $$insert into auth.users (id, email, raw_user_meta_data)
    values ('00000000-0000-4000-8000-000000000108', 'ab@users.0vertrained.app', '{"username":"ab"}')$$,
  'USERNAME_INVALID%', 'a 2-character username is refused');
select throws_like(
  $$insert into auth.users (id, email, raw_user_meta_data)
    values ('00000000-0000-4000-8000-000000000109', 'x@users.0vertrained.app', '{"username":"bad name!"}')$$,
  'USERNAME_INVALID%', 'spaces and punctuation are refused');
select throws_like(
  format($$insert into auth.users (id, email, raw_user_meta_data)
    values ('00000000-0000-4000-8000-00000000010a', 'y@users.0vertrained.app', '{"username":"%s"}')$$, repeat('a', 33)),
  'USERNAME_INVALID%', 'a 33-character username is refused');
select lives_ok(
  format($$insert into auth.users (id, email, raw_user_meta_data)
    values ('00000000-0000-4000-8000-00000000010b', 'z@users.0vertrained.app', '{"username":"%s"}')$$, repeat('a', 32)),
  'a 32-character username is accepted');

-- nothing to derive a username from
select throws_like(
  $$insert into auth.users (id, email, raw_user_meta_data)
    values ('00000000-0000-4000-8000-00000000010c', null, '{}')$$,
  'USERNAME_REQUIRED%', 'no metadata and no email is refused');

-- the trigger is the only writer: exactly one profile per accepted user
select is((select count(*) from public.profiles where id in (
  '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000104',
  '00000000-0000-4000-8000-000000000105', '00000000-0000-4000-8000-00000000010b')), 6::bigint,
  'one profile per accepted sign-up');

select * from finish();
rollback;
