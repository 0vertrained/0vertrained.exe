-- ============================================================
--  MIGRATION: V2.9 Whoop Foundation
--  Run this ONCE in: Supabase Dashboard → SQL Editor
--
--  Adds Whoop OAuth scaffolding mirroring the Oura pattern:
--    • whoop_oauth_state — short-lived 8-char CSRF state → user mapping
--    • whoop_tokens      — server-held OAuth tokens (never browser-readable)
--    • whoop_data        — owner-readable normalized daily records
--
--  SECURITY MODEL (mirrors oura_tokens / oura_data):
--    • whoop_tokens + whoop_oauth_state are SERVICE-ROLE ONLY. The browser
--      never reads them; it uses /api/whoop/status + /api/whoop/disconnect.
--    • whoop_data is owner-readable (SELECT) so the client can render its
--      own normalized records; all writes go through the service role.
--
--  This migration is IDEMPOTENT and SAFE to re-run. It only ADDS objects and
--  patches delete_my_account_data() (V2.7) if present without weakening RLS.
-- ============================================================


-- ─── whoop_oauth_state table ─────────────────────────────────────────────────
-- Maps a self-generated 8-char state string to the initiating user for the
-- OAuth callback. The callback derives user ownership ONLY from this table,
-- never from query params. Rows are short-lived (10 min TTL) and best-effort
-- deleted on consumption / expiry.
CREATE TABLE IF NOT EXISTS public.whoop_oauth_state (
  state       CHAR(8) PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.whoop_oauth_state ENABLE ROW LEVEL SECURITY;

-- No policies for anon/authenticated: state is a server-only CSRF artifact.
REVOKE ALL ON public.whoop_oauth_state FROM anon, authenticated;
GRANT ALL ON public.whoop_oauth_state TO service_role;


-- ─── whoop_tokens table ──────────────────────────────────────────────────────
-- OAuth access/refresh tokens per user. One row per user. Whoop rotates the
-- refresh token on every refresh, so the server persists the rotated token
-- immediately and avoids concurrent refreshes.
CREATE TABLE IF NOT EXISTS public.whoop_tokens (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token  TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  scope         TEXT,
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE public.whoop_tokens ENABLE ROW LEVEL SECURITY;

-- Tokens are server-held only. Browser clients must use /api/whoop/status and
-- /api/whoop/disconnect rather than selecting refresh/access tokens directly.
REVOKE ALL ON public.whoop_tokens FROM anon, authenticated;
GRANT ALL ON public.whoop_tokens TO service_role;


-- ─── whoop_data table ────────────────────────────────────────────────────────
-- Normalized Whoop records: recovery, sleep, cycle, workout, body_measurement.
-- One row per user+date+data_type+external_id combination. external_id defaults
-- to '' so single-per-day types still have a stable conflict key, while multiple
-- workouts per day stay distinct via their record ids.
CREATE TABLE IF NOT EXISTS public.whoop_data (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date         DATE NOT NULL,
  data_type    TEXT NOT NULL CHECK (data_type IN ('recovery', 'sleep', 'cycle', 'workout', 'body_measurement')),
  external_id  TEXT NOT NULL DEFAULT '',
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, date, data_type, external_id)
);

ALTER TABLE public.whoop_data ENABLE ROW LEVEL SECURITY;

-- Owner may SELECT their own records only. All writes are server-side via the
-- service role; there is no self INSERT/UPDATE/DELETE policy.
DROP POLICY IF EXISTS "whoop_data_select_own" ON public.whoop_data;
CREATE POLICY "whoop_data_select_own" ON public.whoop_data
  FOR SELECT USING (auth.uid() = user_id);

REVOKE ALL ON public.whoop_data FROM anon;
GRANT SELECT ON public.whoop_data TO authenticated;
GRANT ALL ON public.whoop_data TO service_role;


-- ─── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_whoop_tokens_user_id
  ON public.whoop_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_whoop_oauth_state_expires_at
  ON public.whoop_oauth_state(expires_at);
CREATE INDEX IF NOT EXISTS idx_whoop_data_user_date_type
  ON public.whoop_data(user_id, date DESC, data_type);


-- ─── Patch delete_my_account_data() (V2.7) to also purge Whoop ───────────────
-- Only patch if the function already exists (V2.7 has been run). If it does not
-- exist yet, this is a no-op — V2.7's own definition already deletes Whoop rows
-- once this file's tables exist... but to keep V2.7 forward-compatible without
-- editing it, we redefine the function here to include the Whoop deletes. This
-- redefinition is a strict superset of the V2.7 body and is safe/idempotent.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'delete_my_account_data'
  ) THEN
    CREATE OR REPLACE FUNCTION public.delete_my_account_data()
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $fn$
    declare
      uid uuid := auth.uid();
      n_entries      int := 0;
      n_program      int := 0;
      n_oura_data    int := 0;
      n_oura_tokens  int := 0;
      n_whoop_data   int := 0;
      n_whoop_tokens int := 0;
      n_whoop_state  int := 0;
      n_coach        int := 0;
    begin
      if uid is null then
        raise exception 'not authenticated';
      end if;

      delete from public.entries      where user_id = uid;
      get diagnostics n_entries = row_count;

      delete from public.program      where user_id = uid;
      get diagnostics n_program = row_count;

      delete from public.oura_data    where user_id = uid;
      get diagnostics n_oura_data = row_count;

      delete from public.oura_tokens  where user_id = uid;
      get diagnostics n_oura_tokens = row_count;

      delete from public.whoop_data       where user_id = uid;
      get diagnostics n_whoop_data = row_count;

      delete from public.whoop_tokens     where user_id = uid;
      get diagnostics n_whoop_tokens = row_count;

      delete from public.whoop_oauth_state where user_id = uid;
      get diagnostics n_whoop_state = row_count;

      delete from public.coach_access where user_id = uid;
      get diagnostics n_coach = row_count;

      update public.profiles
      set settings = '{}'::jsonb,
          recovery_hash = null,
          recovery_salt = null
      where id = uid;

      return jsonb_build_object(
        'ok', true,
        'user_id', uid,
        'deleted', jsonb_build_object(
          'entries', n_entries,
          'program', n_program,
          'oura_data', n_oura_data,
          'oura_tokens', n_oura_tokens,
          'whoop_data', n_whoop_data,
          'whoop_tokens', n_whoop_tokens,
          'whoop_oauth_state', n_whoop_state,
          'coach_access', n_coach
        )
      );
    end;
    $fn$;

    REVOKE ALL ON FUNCTION public.delete_my_account_data() FROM public, anon;
    GRANT EXECUTE ON FUNCTION public.delete_my_account_data() TO authenticated;
  END IF;
END $$;


-- ============================================================
--  DONE. V2.9 Whoop Foundation applied.
--
--  Non-goals (NOT part of this migration or sprint):
--    • No recovery-algorithm blending from Whoop.
--    • No automatic workout completion from Whoop workouts.
--    • No webhooks / background cron.
-- ============================================================
