-- ============================================================
--  0VERTRAINED v20 — plain-Postgres stub of what Supabase provides
-- ============================================================
--  The v20 migration and its pgTAP tests reference three things that a
--  hosted (or `supabase start`) project ships with and a bare Postgres
--  does not:
--
--    · the `auth` schema with `auth.users` and `auth.uid()`
--    · the API roles `anon`, `authenticated` and `service_role`
--    · the `extensions` schema (where pgTAP is installed)
--
--  This file creates just enough of each so `migrations/0001_init.sql` and
--  `tests/*.sql` run on a throwaway Postgres 15/16/17 with no Docker and no
--  Supabase CLI (see tests/run-local.sh). It is NOT a test.
--
--  Two guards keep it harmless anywhere else:
--    1. The first statement prints a TAP "skip all" plan, so when the
--       Supabase CLI's `supabase test db` sweeps every .sql in this folder
--       through pg_prove, this file reports as skipped instead of failing
--       with "no plan".
--    2. The DO block returns immediately when `auth.uid()` already exists:
--       on a real Supabase database nothing below runs, so the platform's
--       own auth.uid() is never replaced.
-- ============================================================

select '1..0 # SKIP _local_stub.sql stubs the Supabase auth schema for plain Postgres; it is not a test';

do $stub$
begin
  if to_regprocedure('auth.uid()') is not null then
    raise notice '_local_stub: auth.uid() already exists (Supabase), nothing to do';
    return;
  end if;

  -- ── API roles ──────────────────────────────────────────────────────────
  -- Mirrors supabase/postgres: nologin, noinherit; service_role bypasses RLS.
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;

  -- ── Schemas ────────────────────────────────────────────────────────────
  create schema if not exists auth;
  create schema if not exists extensions;
  grant usage on schema auth to anon, authenticated, service_role;
  grant usage on schema extensions to anon, authenticated, service_role;

  -- ── auth.users ─────────────────────────────────────────────────────────
  -- Only the columns the migration and tests touch. The real table has many
  -- more (encrypted_password, confirmed_at, ...) but all of them are nullable
  -- or defaulted, so a test insert of (id, email, raw_user_meta_data) is valid
  -- against the real table too.
  create table if not exists auth.users (
    id                 uuid primary key,
    email              text unique,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    created_at         timestamptz not null default now()
  );

  -- ── auth.uid() ─────────────────────────────────────────────────────────
  -- Same contract as Supabase's: the `sub` claim of the request JWT, which
  -- PostgREST exposes as the `request.jwt.claims` setting (older builds also
  -- set `request.jwt.claim.sub`). Tests impersonate a user with
  --   set local role authenticated;
  --   set local request.jwt.claims = '{"sub":"<uuid>"}';
  create or replace function auth.uid()
  returns uuid
  language sql
  stable
  as $fn$
    select nullif(
      coalesce(
        current_setting('request.jwt.claim.sub', true),
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
      ),
      ''
    )::uuid
  $fn$;

  -- ── auth.role() ────────────────────────────────────────────────────────
  -- Not used by the migration; provided so ad-hoc queries that copy the
  -- Supabase examples do not error on plain Postgres.
  create or replace function auth.role()
  returns text
  language sql
  stable
  as $fn$
    select nullif(
      coalesce(
        current_setting('request.jwt.claim.role', true),
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
      ),
      ''
    )::text
  $fn$;

  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant execute on function auth.role() to anon, authenticated, service_role;

  raise notice '_local_stub: created auth schema, auth.users, auth.uid()/role(), API roles and the extensions schema';
end
$stub$;
