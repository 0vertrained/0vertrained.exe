-- delete_my_account(): removes the caller's auth.users row and, through the
-- foreign keys, every row of theirs in profiles / program / entries /
-- client_errors, and nothing of anyone else's.
create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;
select plan(16);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000701', 'del-a@users.0vertrained.app', '{"username":"del-a"}'),
  ('00000000-0000-4000-8000-000000000702', 'del-b@users.0vertrained.app', '{"username":"del-b"}');

insert into public.program (user_id, payload) values
  ('00000000-0000-4000-8000-000000000701', '{"v":2}'),
  ('00000000-0000-4000-8000-000000000702', '{"v":2}');

insert into public.entries (user_id, entry_date, payload)
select u, current_date - s, '{"v":2}'
  from (values ('00000000-0000-4000-8000-000000000701'::uuid), ('00000000-0000-4000-8000-000000000702'::uuid)) as t(u),
       generate_series(0, 2) as s;

insert into public.client_errors (user_id, message) values
  ('00000000-0000-4000-8000-000000000701', 'a1'),
  ('00000000-0000-4000-8000-000000000701', 'a2'),
  ('00000000-0000-4000-8000-000000000702', 'b1'),
  (null, 'anonymous');

select is((select count(*) from public.entries where user_id = '00000000-0000-4000-8000-000000000701'), 3::bigint, 'fixture: A has 3 days');
select is((select count(*) from public.client_errors where user_id = '00000000-0000-4000-8000-000000000701'), 2::bigint, 'fixture: A has 2 error reports');

-- ── as user A ───────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000701","role":"authenticated"}';
select lives_ok($$select public.delete_my_account()$$, 'A can delete its own account');

reset role;
select is((select count(*) from auth.users      where id      = '00000000-0000-4000-8000-000000000701'), 0::bigint, 'A''s auth.users row is gone');
select is((select count(*) from public.profiles where id      = '00000000-0000-4000-8000-000000000701'), 0::bigint, 'A''s profile is gone');
select is((select count(*) from public.program  where user_id = '00000000-0000-4000-8000-000000000701'), 0::bigint, 'A''s program is gone');
select is((select count(*) from public.entries  where user_id = '00000000-0000-4000-8000-000000000701'), 0::bigint, 'A''s days are gone');
select is((select count(*) from public.client_errors where user_id = '00000000-0000-4000-8000-000000000701'), 0::bigint, 'A''s error reports are gone');

select is((select count(*) from auth.users      where id      = '00000000-0000-4000-8000-000000000702'), 1::bigint, 'B''s auth.users row remains');
select is((select count(*) from public.profiles where id      = '00000000-0000-4000-8000-000000000702'), 1::bigint, 'B''s profile remains');
select is((select count(*) from public.program  where user_id = '00000000-0000-4000-8000-000000000702'), 1::bigint, 'B''s program remains');
select is((select count(*) from public.entries  where user_id = '00000000-0000-4000-8000-000000000702'), 3::bigint, 'B''s days remain');
select is((select count(*) from public.client_errors where user_id = '00000000-0000-4000-8000-000000000702'), 1::bigint, 'B''s error report remains');
select is((select count(*) from public.client_errors where user_id is null), 1::bigint, 'the anonymous error report remains');

-- ── no session / anon ───────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{}';
select throws_like($$select public.delete_my_account()$$, 'NO_SESSION%', 'refuses without a session');

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select public.delete_my_account()$$, '42501', null, 'anon cannot execute delete_my_account');

reset role;
select * from finish();
rollback;
