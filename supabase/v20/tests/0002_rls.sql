-- Row Level Security: user A can only see and touch user A's rows on
-- profiles / program / entries; anon sees nothing; client_errors is closed
-- to both. Impersonation is what PostgREST does for a request:
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid>"}';
create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;
select plan(37);

-- ── fixtures (as the migration owner, which bypasses RLS) ───────────────────
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'rls-a@users.0vertrained.app', '{"username":"rls-a"}'),
  ('00000000-0000-4000-8000-00000000000b', 'rls-b@users.0vertrained.app', '{"username":"rls-b"}');

insert into public.program (user_id, payload) values
  ('00000000-0000-4000-8000-00000000000a', '{"v":2,"owner":"a"}'),
  ('00000000-0000-4000-8000-00000000000b', '{"v":2,"owner":"b"}');

insert into public.entries (user_id, entry_date, payload) values
  ('00000000-0000-4000-8000-00000000000a', current_date, '{"v":2,"owner":"a"}'),
  ('00000000-0000-4000-8000-00000000000b', current_date, '{"v":2,"owner":"b"}');

insert into public.client_errors (user_id, message) values
  ('00000000-0000-4000-8000-00000000000a', 'boom');

-- Runs a statement as whoever is the current role (RLS applies) and returns
-- how many rows it touched: the honest way to show "update B's row → 0 rows"
-- rather than "it errored".
create function pg_temp.affected(sql text) returns bigint
language plpgsql as $$
declare n bigint;
begin
  execute sql;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ── as user A ───────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}';

select is(auth.uid(), '00000000-0000-4000-8000-00000000000a'::uuid, 'impersonation: auth.uid() is A');

-- profiles
select is((select count(*) from public.profiles), 1::bigint, 'A sees exactly one profile');
select is((select id from public.profiles), '00000000-0000-4000-8000-00000000000a'::uuid, '...and it is A''s');
select throws_ok(
  $$insert into public.profiles (id, username) values ('00000000-0000-4000-8000-00000000000b', 'intruder')$$,
  '42501', null, 'A cannot insert a profiles row for B');
select is(
  pg_temp.affected($$update public.profiles set username = 'hacked' where id = '00000000-0000-4000-8000-00000000000b'$$),
  0::bigint, 'A''s update of B''s profile touches zero rows');
select is(
  pg_temp.affected($$delete from public.profiles where id = '00000000-0000-4000-8000-00000000000b'$$),
  0::bigint, 'A''s delete of B''s profile touches zero rows');
select is(
  pg_temp.affected($$update public.profiles set settings = '{"units":"imperial"}' where id = '00000000-0000-4000-8000-00000000000a'$$),
  1::bigint, 'A can update A''s own profile');
select throws_ok(
  $$update public.profiles set id = '00000000-0000-4000-8000-00000000000b' where id = '00000000-0000-4000-8000-00000000000a'$$,
  '42501', null, 'A cannot re-key its profile to B (with check)');

-- program
select is((select count(*) from public.program), 1::bigint, 'A sees exactly one program row');
select is((select payload ->> 'owner' from public.program), 'a', '...and it is A''s');
select throws_ok(
  $$insert into public.program (user_id, payload) values ('00000000-0000-4000-8000-00000000000b', '{"v":2}')$$,
  '42501', null, 'A cannot insert a program row for B');
select is(
  pg_temp.affected($$update public.program set payload = '{"v":2,"owner":"hacked"}' where user_id = '00000000-0000-4000-8000-00000000000b'$$),
  0::bigint, 'A''s update of B''s program touches zero rows');
select is(
  pg_temp.affected($$delete from public.program where user_id = '00000000-0000-4000-8000-00000000000b'$$),
  0::bigint, 'A''s delete of B''s program touches zero rows');
select is(
  pg_temp.affected($$update public.program set payload = '{"v":2,"owner":"a2"}' where user_id = '00000000-0000-4000-8000-00000000000a'$$),
  1::bigint, 'A can update A''s own program');

-- entries
select is((select count(*) from public.entries), 1::bigint, 'A sees exactly one entry');
select is((select payload ->> 'owner' from public.entries), 'a', '...and it is A''s');
select throws_ok(
  $$insert into public.entries (user_id, entry_date, payload) values ('00000000-0000-4000-8000-00000000000b', current_date - 1, '{"v":2}')$$,
  '42501', null, 'A cannot insert an entry for B');
select is(
  pg_temp.affected($$update public.entries set payload = '{"v":2,"owner":"hacked"}' where user_id = '00000000-0000-4000-8000-00000000000b'$$),
  0::bigint, 'A''s update of B''s entry touches zero rows');
select is(
  pg_temp.affected($$delete from public.entries where user_id = '00000000-0000-4000-8000-00000000000b'$$),
  0::bigint, 'A''s delete of B''s entry touches zero rows');
select lives_ok(
  $$insert into public.entries (user_id, entry_date, payload) values ('00000000-0000-4000-8000-00000000000a', current_date - 1, '{"v":2}')$$,
  'A can insert A''s own entry');
select is((select count(*) from public.entries), 2::bigint, 'A now sees two entries');
select throws_ok(
  $$update public.entries set user_id = '00000000-0000-4000-8000-00000000000b' where user_id = '00000000-0000-4000-8000-00000000000a'$$,
  '42501', null, 'A cannot hand its entries to B (with check)');

-- client_errors: no grant at all for authenticated
select throws_ok($$select * from public.client_errors$$, '42501', null, 'authenticated cannot read client_errors');
select throws_ok($$insert into public.client_errors (message) values ('x')$$, '42501', null, 'authenticated cannot write client_errors');

-- ── as user B: A's new entry is invisible ───────────────────────────────────
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}';
select is((select count(*) from public.entries), 1::bigint, 'B sees only B''s one entry');
select is((select username from public.profiles), 'rls-b', 'B sees only B''s profile');

-- ── as a session with no user (claims without sub) ──────────────────────────
set local request.jwt.claims = '{}';
select is(auth.uid(), null, 'no sub claim: auth.uid() is null');
select is((select count(*) from public.profiles), 0::bigint, 'no user: sees no profiles');
select is((select count(*) from public.entries),  0::bigint, 'no user: sees no entries');

-- ── as anon ─────────────────────────────────────────────────────────────────
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select * from public.profiles$$,      '42501', null, 'anon cannot read profiles');
select throws_ok($$select * from public.program$$,       '42501', null, 'anon cannot read program');
select throws_ok($$select * from public.entries$$,       '42501', null, 'anon cannot read entries');
select throws_ok($$select * from public.client_errors$$, '42501', null, 'anon cannot read client_errors');
select throws_ok($$insert into public.entries (user_id, entry_date, payload) values ('00000000-0000-4000-8000-00000000000a', current_date, '{}')$$,
  '42501', null, 'anon cannot write entries');

-- ── back as the owner: B's rows are untouched ───────────────────────────────
reset role;
select is((select username from public.profiles where id = '00000000-0000-4000-8000-00000000000b'), 'rls-b', 'B''s username unchanged');
select is((select payload ->> 'owner' from public.program where user_id = '00000000-0000-4000-8000-00000000000b'), 'b', 'B''s program unchanged');
select is((select payload ->> 'owner' from public.entries where user_id = '00000000-0000-4000-8000-00000000000b'), 'b', 'B''s entry unchanged');

select * from finish();
rollback;
