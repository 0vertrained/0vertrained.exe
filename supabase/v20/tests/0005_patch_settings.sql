-- patch_settings(patch): merges into the caller's own settings and returns
-- the new document; refuses without a session; never touches other users.
create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;
select plan(13);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000201', 'ps-a@users.0vertrained.app', '{"username":"ps-a"}'),
  ('00000000-0000-4000-8000-000000000202', 'ps-b@users.0vertrained.app', '{"username":"ps-b"}'),
  ('00000000-0000-4000-8000-000000000203', 'ps-c@users.0vertrained.app', '{"username":"ps-c"}');

update public.profiles
   set settings = '{"v":2,"units":"metric","onboarded":false,"profile":{"name":"Old"},"session":{"restSeconds":90,"sound":true,"haptics":true,"cues":true},"game":{}}'
 where id in ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000202');

-- user C has an auth row but no profile (simulates a broken sign-up)
delete from public.profiles where id = '00000000-0000-4000-8000-000000000203';

-- ── as user A ───────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000201","role":"authenticated"}';

select is(
  public.patch_settings('{"units":"imperial","session":{"restSeconds":120},"profile":{"name":null,"featuredTitle":"Iron"}}'),
  '{"v":2,"units":"imperial","onboarded":false,"profile":{"featuredTitle":"Iron"},"session":{"restSeconds":120,"sound":true,"haptics":true,"cues":true},"game":{}}'::jsonb,
  'returns the merged document (nested merge, null delete)');

select is(
  (select settings from public.profiles where id = '00000000-0000-4000-8000-000000000201'),
  '{"v":2,"units":"imperial","onboarded":false,"profile":{"featuredTitle":"Iron"},"session":{"restSeconds":120,"sound":true,"haptics":true,"cues":true},"game":{}}'::jsonb,
  '...and stores it');

select is(
  public.patch_settings('{"game":{"pauses":[{"from":"2026-02-01","to":"2026-02-02","reason":"travel"}]}}') -> 'game',
  '{"pauses":[{"from":"2026-02-01","to":"2026-02-02","reason":"travel"}]}'::jsonb,
  'arrays are set whole');

select is(
  public.patch_settings('{"game":{"pauses":[]}}') -> 'game' -> 'pauses',
  '[]'::jsonb,
  'arrays are replaced whole, not merged');

select is(
  public.patch_settings('{}'),
  (select settings from public.profiles where id = '00000000-0000-4000-8000-000000000201'),
  'an empty patch returns the current document unchanged');

select throws_like($$select public.patch_settings('[1,2]')$$, 'BAD_PATCH%', 'a non-object patch is refused');
select throws_like($$select public.patch_settings(null)$$,    'BAD_PATCH%', 'a null patch is refused');

-- the 16 KiB column CHECK fires through the function
select throws_ok(
  format($$select public.patch_settings('{"pad":"%s"}')$$, repeat('x', 17000)),
  '23514', null, 'a patch that grows settings past 16 KiB is refused by the CHECK');

-- ── user C: signed in but no profile row ────────────────────────────────────
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000203","role":"authenticated"}';
select throws_like($$select public.patch_settings('{"units":"imperial"}')$$, 'NO_PROFILE%', 'a user without a profile gets NO_PROFILE');

-- ── no session ──────────────────────────────────────────────────────────────
set local request.jwt.claims = '{}';
select throws_like($$select public.patch_settings('{"units":"imperial"}')$$, 'NO_SESSION%', 'refuses without a session');

-- ── anon has no execute right at all ────────────────────────────────────────
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select public.patch_settings('{"units":"imperial"}')$$, '42501', null, 'anon cannot execute patch_settings');

-- ── other users untouched ───────────────────────────────────────────────────
reset role;
select is(
  (select settings -> 'profile' ->> 'name' from public.profiles where id = '00000000-0000-4000-8000-000000000202'),
  'Old', 'B''s settings were not touched');
select is(
  (select settings ->> 'units' from public.profiles where id = '00000000-0000-4000-8000-000000000202'),
  'metric', 'B''s units were not touched');

select * from finish();
rollback;
