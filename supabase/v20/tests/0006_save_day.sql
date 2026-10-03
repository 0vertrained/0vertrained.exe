-- save_day(p_date, p_payload, p_base): insert when new, update when the
-- client's base is current (or null), conflict without writing otherwise.
-- now() is frozen inside this transaction, so every stored updated_at equals
-- now() and bases are expressed relative to it.
create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;
select plan(25);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000301', 'sd-a@users.0vertrained.app', '{"username":"sd-a"}'),
  ('00000000-0000-4000-8000-000000000302', 'sd-b@users.0vertrained.app', '{"username":"sd-b"}');

-- ── as user A ───────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000301","role":"authenticated"}';

-- 1. no row yet → insert
select is(
  public.save_day(current_date, '{"v":2,"n":1}', null) ->> 'status',
  'ok', 'first save of a day inserts and returns ok');
select is(
  public.save_day(current_date - 1, '{"v":2,"n":1}', null) -> 'payload',
  '{"v":2,"n":1}'::jsonb, 'ok result carries the saved payload');
select is(
  (public.save_day(current_date - 2, '{"v":2,"n":1}', null) ->> 'updated_at')::timestamptz,
  now(), 'ok result carries the row''s updated_at');
select is((select count(*) from public.entries), 3::bigint, 'three days inserted');
select is(
  (select user_id from public.entries where entry_date = current_date),
  '00000000-0000-4000-8000-000000000301'::uuid, 'the row belongs to the caller');

-- 2. row exists, base is current → update
select is(
  public.save_day(current_date, '{"v":2,"n":2}', now()) ->> 'status',
  'ok', 'a save with the current base updates');
select is(
  (select payload from public.entries where entry_date = current_date),
  '{"v":2,"n":2}'::jsonb, '...and the payload changed');

-- 3. base within the 1 ms slack (JavaScript Date truncation) → update
select is(
  public.save_day(current_date, '{"v":2,"n":3}', now() - interval '0.5 millisecond') ->> 'status',
  'ok', 'a base 0.5 ms behind the row is still current');
select is(
  public.save_day(current_date, '{"v":2,"n":4}', now() + interval '1 hour') ->> 'status',
  'ok', 'a base ahead of the row (clock skew) is current');

-- 4. stale base → conflict, no write, server copy returned
select is(
  public.save_day(current_date, '{"v":2,"n":99}', now() - interval '1 second') ->> 'status',
  'conflict', 'a base 1 s behind the row is a conflict');
select is(
  public.save_day(current_date, '{"v":2,"n":99}', now() - interval '1 second') -> 'payload',
  '{"v":2,"n":4}'::jsonb, 'conflict result carries the server payload');
select is(
  (public.save_day(current_date, '{"v":2,"n":99}', now() - interval '1 second') ->> 'updated_at')::timestamptz,
  now(), 'conflict result carries the server updated_at');
select is(
  (select payload from public.entries where entry_date = current_date),
  '{"v":2,"n":4}'::jsonb, 'a conflict writes nothing');
select is(
  public.save_day(current_date, '{"v":2,"n":99}', now() - interval '2 millisecond') ->> 'status',
  'conflict', 'a base 2 ms behind the row is outside the slack');

-- 5. null base on an existing row → overwrite (import / deliberate replace)
select is(
  public.save_day(current_date, '{"v":2,"n":5}', null) ->> 'status',
  'ok', 'a null base overwrites an existing row');
select is(
  (select payload from public.entries where entry_date = current_date),
  '{"v":2,"n":5}'::jsonb, '...and the payload changed');

-- 6. argument validation
select throws_like($$select public.save_day(null, '{"v":2}', null)$$,          'BAD_DATE%',    'a null date is refused');
select throws_like($$select public.save_day(current_date, null, null)$$,       'BAD_PAYLOAD%', 'a null payload is refused');
select throws_like($$select public.save_day(current_date, '[1]', null)$$,      'BAD_PAYLOAD%', 'a non-object payload is refused');

-- 7. the table's guards fire through the function
select throws_like(
  $$select public.save_day(current_date + 2, '{"v":2}', null)$$,
  'ENTRY_DATE_OUT_OF_RANGE%', 'entries_guard rejects a date two days ahead');
select throws_ok(
  format($$select public.save_day(current_date - 3, '{"v":2,"pad":"%s"}', null)$$, repeat('x', 33000)),
  '23514', null, 'the 32 KiB payload CHECK rejects an oversized day');

-- ── as user B: A's days are invisible and B's writes are separate ───────────
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000302","role":"authenticated"}';
select is((select count(*) from public.entries), 0::bigint, 'B sees none of A''s days');
select is(
  public.save_day(current_date, '{"v":2,"owner":"b"}', null) ->> 'status',
  'ok', 'B can save the same date as its own row');

-- ── no session / anon ───────────────────────────────────────────────────────
set local request.jwt.claims = '{}';
select throws_like($$select public.save_day(current_date, '{"v":2}', null)$$, 'NO_SESSION%', 'refuses without a session');

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select public.save_day(current_date, '{"v":2}', null)$$, '42501', null, 'anon cannot execute save_day');

reset role;
select * from finish();
rollback;
