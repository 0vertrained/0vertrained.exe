-- supabase/v20/migrations/0002_tighten_grants.sql
--
-- Trims the authenticated role's table privileges to exactly what the app
-- uses. Supabase's default privileges (ALTER DEFAULT PRIVILEGES IN SCHEMA
-- public GRANT ALL ON TABLES TO anon, authenticated, service_role) hand every
-- new table ALL to authenticated, and 0001 only revoked from public and anon
-- before granting, so REFERENCES, TRIGGER and TRUNCATE were left behind on a
-- hosted project. None of them is reachable through PostgREST, and TRUNCATE
-- ignores row-level security, so they go. The pgTAP suite asserts the exact
-- set (tests/0001_schema.sql), which is how this surfaced: the plain-Postgres
-- runner has no default privileges to leave anything behind.
--
-- Idempotent: revoke-then-grant lands on the same state however often it runs.
-- Apply after 0001 (Dashboard → SQL Editor → paste → Run, or `supabase db push`).

revoke all on public.profiles, public.program, public.entries from authenticated;
grant select, insert, update, delete on public.profiles, public.program, public.entries to authenticated;
