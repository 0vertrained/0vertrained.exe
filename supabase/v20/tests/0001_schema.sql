-- Tables, columns, constraints, indexes, triggers, RLS state, functions and
-- the privilege surface of migration 0001. Pure introspection: no data.
create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;
select plan(112);

-- ── tables ──────────────────────────────────────────────────────────────────
select has_table('public', 'profiles',      'profiles exists');
select has_table('public', 'program',       'program exists');
select has_table('public', 'entries',       'entries exists');
select has_table('public', 'client_errors', 'client_errors exists');

-- ── profiles columns ────────────────────────────────────────────────────────
select has_column('public', 'profiles', 'id',                         'profiles.id');
select has_column('public', 'profiles', 'username',                   'profiles.username');
select has_column('public', 'profiles', 'settings',                   'profiles.settings');
select has_column('public', 'profiles', 'recovery_hash',              'profiles.recovery_hash');
select has_column('public', 'profiles', 'recovery_salt',              'profiles.recovery_salt');
select has_column('public', 'profiles', 'recovery_kdf',               'profiles.recovery_kdf');
select has_column('public', 'profiles', 'recovery_attempts',          'profiles.recovery_attempts');
select has_column('public', 'profiles', 'recovery_window_started_at', 'profiles.recovery_window_started_at');
select has_column('public', 'profiles', 'recovery_locked_until',      'profiles.recovery_locked_until');
select has_column('public', 'profiles', 'created_at',                 'profiles.created_at');
select has_column('public', 'profiles', 'updated_at',                 'profiles.updated_at');

select col_is_pk('public', 'profiles', 'id', 'profiles.id is the primary key');
select col_type_is('public', 'profiles', 'settings', 'jsonb', 'profiles.settings is jsonb');
select col_not_null('public', 'profiles', 'username', 'profiles.username is not null');
select col_not_null('public', 'profiles', 'settings', 'profiles.settings is not null');
select col_default_is('public', 'profiles', 'settings', '{}'::jsonb, 'profiles.settings defaults to {}');
select col_default_is('public', 'profiles', 'recovery_attempts', 0, 'profiles.recovery_attempts defaults to 0');
select col_is_unique('public', 'profiles', 'username', 'profiles.username is unique');
select fk_ok('public', 'profiles', 'id', 'auth', 'users', 'id', 'profiles.id references auth.users');
select has_check('public', 'profiles', 'profiles has check constraints');

-- ── program columns ─────────────────────────────────────────────────────────
select has_column('public', 'program', 'user_id',    'program.user_id');
select has_column('public', 'program', 'payload',    'program.payload');
select has_column('public', 'program', 'updated_at', 'program.updated_at');
select col_is_pk('public', 'program', 'user_id', 'program.user_id is the primary key');
select col_not_null('public', 'program', 'payload', 'program.payload is not null');
select fk_ok('public', 'program', 'user_id', 'auth', 'users', 'id', 'program.user_id references auth.users');
select has_check('public', 'program', 'program has check constraints');

-- ── entries columns ─────────────────────────────────────────────────────────
select has_column('public', 'entries', 'user_id',    'entries.user_id');
select has_column('public', 'entries', 'entry_date', 'entries.entry_date');
select has_column('public', 'entries', 'payload',    'entries.payload');
select has_column('public', 'entries', 'updated_at', 'entries.updated_at');
select col_is_pk('public', 'entries', array['user_id', 'entry_date'], 'entries pk is (user_id, entry_date)');
select col_type_is('public', 'entries', 'entry_date', 'date', 'entries.entry_date is date');
select col_type_is('public', 'entries', 'updated_at', 'timestamp with time zone', 'entries.updated_at is timestamptz');
select col_not_null('public', 'entries', 'payload', 'entries.payload is not null');
select col_not_null('public', 'entries', 'updated_at', 'entries.updated_at is not null');
select fk_ok('public', 'entries', 'user_id', 'auth', 'users', 'id', 'entries.user_id references auth.users');
select has_check('public', 'entries', 'entries has check constraints');
select has_index('public', 'entries', 'entries_user_date_desc_idx', 'entries (user_id, entry_date desc) index exists');

-- ── client_errors columns ───────────────────────────────────────────────────
select has_column('public', 'client_errors', 'id',              'client_errors.id');
select has_column('public', 'client_errors', 'user_id',         'client_errors.user_id');
select has_column('public', 'client_errors', 'ip_hash',         'client_errors.ip_hash');
select has_column('public', 'client_errors', 'created_at',      'client_errors.created_at');
select has_column('public', 'client_errors', 'message',         'client_errors.message');
select has_column('public', 'client_errors', 'stack',           'client_errors.stack');
select has_column('public', 'client_errors', 'component_stack', 'client_errors.component_stack');
select has_column('public', 'client_errors', 'url',             'client_errors.url');
select has_column('public', 'client_errors', 'version',         'client_errors.version');
select has_column('public', 'client_errors', 'ref',             'client_errors.ref');
select has_column('public', 'client_errors', 'user_agent',      'client_errors.user_agent');
select col_is_pk('public', 'client_errors', 'id', 'client_errors.id is the primary key');
select col_is_null('public', 'client_errors', 'user_id', 'client_errors.user_id is nullable (pre-sign-in errors)');
select fk_ok('public', 'client_errors', 'user_id', 'auth', 'users', 'id', 'client_errors.user_id references auth.users');
select has_index('public', 'client_errors', 'client_errors_user_created_idx', 'client_errors (user_id, created_at) index exists');
select has_index('public', 'client_errors', 'client_errors_ip_created_idx',   'client_errors (ip_hash, created_at) index exists');

-- ── triggers ────────────────────────────────────────────────────────────────
select has_trigger('public', 'profiles', 'profiles_set_updated_at', 'profiles has the updated_at trigger');
select has_trigger('public', 'program',  'program_set_updated_at',  'program has the updated_at trigger');
select has_trigger('public', 'entries',  'entries_set_updated_at',  'entries has the updated_at trigger');
select has_trigger('public', 'entries',  'entries_guard',           'entries has the guard trigger');
select has_trigger('auth',   'users',    'on_auth_user_created',    'auth.users has the new-user trigger');

-- ── RLS enabled ─────────────────────────────────────────────────────────────
select is((select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),      true, 'RLS on profiles');
select is((select relrowsecurity from pg_class where oid = 'public.program'::regclass),       true, 'RLS on program');
select is((select relrowsecurity from pg_class where oid = 'public.entries'::regclass),       true, 'RLS on entries');
select is((select relrowsecurity from pg_class where oid = 'public.client_errors'::regclass), true, 'RLS on client_errors');

select policies_are('public', 'profiles',
  array['profiles_select_own', 'profiles_insert_own', 'profiles_update_own', 'profiles_delete_own'],
  'profiles has exactly the four own-row policies');
select policies_are('public', 'program',
  array['program_select_own', 'program_insert_own', 'program_update_own', 'program_delete_own'],
  'program has exactly the four own-row policies');
select policies_are('public', 'entries',
  array['entries_select_own', 'entries_insert_own', 'entries_update_own', 'entries_delete_own'],
  'entries has exactly the four own-row policies');
select policies_are('public', 'client_errors', '{}'::name[], 'client_errors has zero policies');

-- ── functions ───────────────────────────────────────────────────────────────
select has_function('public', 'set_updated_at',        '{}'::name[],                                              'set_updated_at() exists');
select has_function('public', 'entries_guard',         '{}'::name[],                                              'entries_guard() exists');
select has_function('public', 'handle_new_user',       '{}'::name[],                                              'handle_new_user() exists');
select has_function('public', 'jsonb_deep_merge',      array['jsonb', 'jsonb'],                                    'jsonb_deep_merge(jsonb, jsonb) exists');
select has_function('public', 'patch_settings',        array['jsonb'],                                             'patch_settings(jsonb) exists');
select has_function('public', 'save_day',              array['date', 'jsonb', 'timestamp with time zone'],         'save_day(date, jsonb, timestamptz) exists');
select has_function('public', 'delete_my_account',     '{}'::name[],                                              'delete_my_account() exists');
select has_function('public', 'set_recovery_phrase',   array['text', 'text', 'text'],                              'set_recovery_phrase(text, text, text) exists');
select has_function('public', 'bump_recovery_attempt', array['text', 'bigint', 'bigint', 'integer'],               'bump_recovery_attempt(text, bigint, bigint, int) exists');
select has_function('public', 'username_taken',        array['text'],                                              'username_taken(text) exists');

select is_definer('public', 'handle_new_user',       '{}'::name[],                                'handle_new_user is security definer');
select is_definer('public', 'delete_my_account',     '{}'::name[],                                'delete_my_account is security definer');
select is_definer('public', 'bump_recovery_attempt', array['text', 'bigint', 'bigint', 'integer'], 'bump_recovery_attempt is security definer');
select is_definer('public', 'username_taken',        array['text'],                               'username_taken is security definer');
select isnt_definer('public', 'patch_settings',      array['jsonb'],                              'patch_settings is security invoker');
select isnt_definer('public', 'save_day',            array['date', 'jsonb', 'timestamp with time zone'], 'save_day is security invoker');
select isnt_definer('public', 'set_recovery_phrase', array['text', 'text', 'text'],               'set_recovery_phrase is security invoker');

select volatility_is('public', 'jsonb_deep_merge', array['jsonb', 'jsonb'], 'immutable', 'jsonb_deep_merge is immutable');
select volatility_is('public', 'username_taken',   array['text'],           'stable',    'username_taken is stable');

-- security definer functions pin their search_path
select matches(
  (select array_to_string(proconfig, ',') from pg_proc where oid = 'public.handle_new_user()'::regprocedure),
  'search_path=public', 'handle_new_user pins search_path');
select matches(
  (select array_to_string(proconfig, ',') from pg_proc where oid = 'public.delete_my_account()'::regprocedure),
  'search_path=public', 'delete_my_account pins search_path');
select matches(
  (select array_to_string(proconfig, ',') from pg_proc where oid = 'public.bump_recovery_attempt(text, bigint, bigint, int)'::regprocedure),
  'search_path=public', 'bump_recovery_attempt pins search_path');
select matches(
  (select array_to_string(proconfig, ',') from pg_proc where oid = 'public.username_taken(text)'::regprocedure),
  'search_path=public', 'username_taken pins search_path');

-- ── privilege surface ───────────────────────────────────────────────────────
select table_privs_are('public', 'client_errors', 'anon',          '{}'::text[], 'anon has no rights on client_errors');
select table_privs_are('public', 'client_errors', 'authenticated', '{}'::text[], 'authenticated has no rights on client_errors');
select table_privs_are('public', 'profiles',      'anon',          '{}'::text[], 'anon has no rights on profiles');
select table_privs_are('public', 'program',       'anon',          '{}'::text[], 'anon has no rights on program');
select table_privs_are('public', 'entries',       'anon',          '{}'::text[], 'anon has no rights on entries');
select table_privs_are('public', 'profiles', 'authenticated', array['SELECT', 'INSERT', 'UPDATE', 'DELETE'], 'authenticated may read/write profiles (rows limited by RLS)');
select table_privs_are('public', 'entries',  'authenticated', array['SELECT', 'INSERT', 'UPDATE', 'DELETE'], 'authenticated may read/write entries (rows limited by RLS)');
select table_privs_are('public', 'program',  'authenticated', array['SELECT', 'INSERT', 'UPDATE', 'DELETE'], 'authenticated may read/write program (rows limited by RLS)');

select function_privs_are('public', 'bump_recovery_attempt', array['text', 'bigint', 'bigint', 'integer'], 'anon',          '{}'::text[], 'anon cannot execute bump_recovery_attempt');
select function_privs_are('public', 'bump_recovery_attempt', array['text', 'bigint', 'bigint', 'integer'], 'authenticated', '{}'::text[], 'authenticated cannot execute bump_recovery_attempt');
select function_privs_are('public', 'bump_recovery_attempt', array['text', 'bigint', 'bigint', 'integer'], 'service_role',  array['EXECUTE'], 'service_role can execute bump_recovery_attempt');
select function_privs_are('public', 'delete_my_account', '{}'::name[], 'anon',          '{}'::text[],     'anon cannot execute delete_my_account');
select function_privs_are('public', 'delete_my_account', '{}'::name[], 'authenticated', array['EXECUTE'], 'authenticated can execute delete_my_account');
select function_privs_are('public', 'username_taken', array['text'], 'anon',          array['EXECUTE'], 'anon can execute username_taken');
select function_privs_are('public', 'patch_settings', array['jsonb'], 'anon',         '{}'::text[],     'anon cannot execute patch_settings');
select function_privs_are('public', 'save_day', array['date', 'jsonb', 'timestamp with time zone'], 'anon', '{}'::text[], 'anon cannot execute save_day');
select function_privs_are('public', 'handle_new_user', '{}'::name[], 'authenticated', '{}'::text[], 'authenticated cannot execute handle_new_user directly');

select * from finish();
rollback;
