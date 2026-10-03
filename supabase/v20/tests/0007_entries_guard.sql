-- entries_guard: entry_date must be within [today - 20 years, today + 1]
-- and an account may hold at most 4000 days.
create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;
select plan(24);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000401', 'eg-a@users.0vertrained.app', '{"username":"eg-a"}'),
  ('00000000-0000-4000-8000-000000000402', 'eg-b@users.0vertrained.app', '{"username":"eg-b"}');

-- ── date window ─────────────────────────────────────────────────────────────
select lives_ok(
  $$insert into public.entries (user_id, entry_date, payload) values ('00000000-0000-4000-8000-000000000401', current_date, '{"v":2}')$$,
  'today is accepted');
select lives_ok(
  $$insert into public.entries (user_id, entry_date, payload) values ('00000000-0000-4000-8000-000000000401', current_date + 1, '{"v":2}')$$,
  'tomorrow is accepted (clients ahead of UTC)');
select throws_like(
  $$insert into public.entries (user_id, entry_date, payload) values ('00000000-0000-4000-8000-000000000401', current_date + 2, '{"v":2}')$$,
  'ENTRY_DATE_OUT_OF_RANGE%', 'two days ahead is rejected');
select lives_ok(
  $$insert into public.entries (user_id, entry_date, payload) values ('00000000-0000-4000-8000-000000000401', (current_date - interval '20 years')::date, '{"v":2}')$$,
  'exactly 20 years ago is accepted');
select throws_like(
  $$insert into public.entries (user_id, entry_date, payload) values ('00000000-0000-4000-8000-000000000401', (current_date - interval '20 years')::date - 1, '{"v":2}')$$,
  'ENTRY_DATE_OUT_OF_RANGE%', '20 years and a day ago is rejected');
select throws_like(
  $$insert into public.entries (user_id, entry_date, payload) values ('00000000-0000-4000-8000-000000000401', '1999-12-31', '{"v":2}')$$,
  'ENTRY_DATE_OUT_OF_RANGE%', 'a far-past date is rejected');
select throws_like(
  $$insert into public.entries (user_id, entry_date, payload) values ('00000000-0000-4000-8000-000000000401', '2099-01-01', '{"v":2}')$$,
  'ENTRY_DATE_OUT_OF_RANGE%', 'a far-future date is rejected');

-- moving an existing row out of the window is rejected too
select throws_like(
  $$update public.entries set entry_date = current_date + 30 where user_id = '00000000-0000-4000-8000-000000000401' and entry_date = current_date$$,
  'ENTRY_DATE_OUT_OF_RANGE%', 'updating entry_date out of the window is rejected');
select lives_ok(
  $$update public.entries set payload = '{"v":2,"edited":true}' where user_id = '00000000-0000-4000-8000-000000000401' and entry_date = current_date$$,
  'updating the payload of a day is unaffected');

-- ── per-account cap ─────────────────────────────────────────────────────────
-- 4000 days for user B in one statement: the guard counts rows the same
-- statement already inserted, so a single bulk insert cannot skip the cap.
select lives_ok(
  $$insert into public.entries (user_id, entry_date, payload)
    select '00000000-0000-4000-8000-000000000402', current_date - s, '{"v":2}'
      from generate_series(0, 3999) as s$$,
  '4000 days can be inserted');
select is((select count(*) from public.entries where user_id = '00000000-0000-4000-8000-000000000402'), 4000::bigint, 'B holds 4000 days');
select throws_like(
  $$insert into public.entries (user_id, entry_date, payload) values ('00000000-0000-4000-8000-000000000402', current_date + 1, '{"v":2}')$$,
  'ENTRY_CAP_REACHED%', 'the 4001st day is rejected');
select lives_ok(
  $$update public.entries set payload = '{"v":2,"edited":true}' where user_id = '00000000-0000-4000-8000-000000000402' and entry_date = current_date$$,
  'editing a day at the cap still works');
select lives_ok(
  $$delete from public.entries where user_id = '00000000-0000-4000-8000-000000000402' and entry_date = current_date - 3999$$,
  'deleting a day at the cap works');
select lives_ok(
  $$insert into public.entries (user_id, entry_date, payload) values ('00000000-0000-4000-8000-000000000402', current_date + 1, '{"v":2}')$$,
  'after a delete there is room for one more');

-- the cap is per account: A is not affected by B's 4000
select lives_ok(
  $$insert into public.entries (user_id, entry_date, payload) values ('00000000-0000-4000-8000-000000000401', current_date - 1, '{"v":2}')$$,
  'another account can still insert');

-- ── upserts at the cap (PostgREST upsert / the client's replaceAll) ─────────
-- B is back at 4000 after the insert above. An upsert that only updates
-- existing days adds nothing and must pass; one that adds a day must not.
select is((select count(*) from public.entries where user_id = '00000000-0000-4000-8000-000000000402'), 4000::bigint, 'B is at the cap again');
select lives_ok(
  $$insert into public.entries (user_id, entry_date, payload)
    values ('00000000-0000-4000-8000-000000000402', current_date, '{"v":2,"upserted":true}')
    on conflict (user_id, entry_date) do update set payload = excluded.payload$$,
  'upserting an existing day at the cap works');
select is(
  (select payload ->> 'upserted' from public.entries where user_id = '00000000-0000-4000-8000-000000000402' and entry_date = current_date),
  'true', '...and updated the payload');
select lives_ok(
  $$insert into public.entries (user_id, entry_date, payload)
    select '00000000-0000-4000-8000-000000000402', entry_date, '{"v":2,"reimport":true}'
      from public.entries where user_id = '00000000-0000-4000-8000-000000000402'
    on conflict (user_id, entry_date) do update set payload = excluded.payload$$,
  're-importing all 4000 existing days at the cap works');
select is((select count(*) from public.entries where user_id = '00000000-0000-4000-8000-000000000402' and payload ->> 'reimport' = 'true'), 4000::bigint,
  '...and every day was updated');
select throws_like(
  $$insert into public.entries (user_id, entry_date, payload)
    values ('00000000-0000-4000-8000-000000000402', current_date - 4000, '{"v":2}')
    on conflict (user_id, entry_date) do update set payload = excluded.payload$$,
  'ENTRY_CAP_REACHED%', 'upserting a new day at the cap is rejected');
select throws_like(
  $$insert into public.entries (user_id, entry_date, payload)
    values ('00000000-0000-4000-8000-000000000401', current_date + 5, '{"v":2}')
    on conflict (user_id, entry_date) do update set payload = excluded.payload$$,
  'ENTRY_DATE_OUT_OF_RANGE%', 'upserting a new out-of-window day is rejected');
-- a plain duplicate insert (no ON CONFLICT) still fails on the primary key
select throws_ok(
  $$insert into public.entries (user_id, entry_date, payload) values ('00000000-0000-4000-8000-000000000402', current_date, '{"v":2}')$$,
  '23505', null, 'a duplicate day without ON CONFLICT fails on the primary key');

select * from finish();
rollback;
