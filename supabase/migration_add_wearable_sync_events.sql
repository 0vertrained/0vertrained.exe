--  MIGRATION: V3.4 Wearable Sync Events + Debug Timeline
--  Run this ONCE in: Supabase Dashboard → SQL Editor
--
--  Adds a privacy-safe sync event log so the app can explain:
--    • last sync status (success / partial / failed)
--    • which data types arrived and how many
--    • token expired / no scored recovery yet
--    • why cards may be empty
--
--  SECURITY MODEL:
--    • wearable_sync_events is owner-readable (SELECT) so the client
--      can render its own debug timeline. All writes go through the
--      service role (server-side sync functions only).
--    • No raw biometric payloads are ever stored here — only event
--      metadata: source, event_type, status, counts, message, timestamp.
--    • No tokens, no Authorization headers, no Whoop/Oura JSON bodies.
--
--  This migration is IDEMPOTENT and SAFE to re-run.


-- wearable_sync_events table
-- A compact, metadata-only log of wearable sync attempts per user. One row per
-- sync event (manual or automatic). The client reads the most recent N events
-- to build a debug timeline in Settings → Integrations.
CREATE TABLE IF NOT EXISTS public.wearable_sync_events (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source      TEXT NOT NULL CHECK (source IN ('whoop', 'oura')),
  event_type  TEXT NOT NULL CHECK (event_type IN ('sync', 'connect', 'disconnect', 'token_refresh', 'token_expired')),
  status      TEXT NOT NULL CHECK (status IN ('success', 'partial', 'failed', 'info')),
  -- Aggregate counts only — e.g. { "cycle": 7, "sleep": 0, "recovery": 0, "workout": 1 }
  -- Never raw payloads, never biometric values, never tokens.
  counts      JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Short human-readable message (safe for display). No secrets.
  message     TEXT NOT NULL DEFAULT '',
  days        INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.wearable_sync_events ENABLE ROW LEVEL SECURITY;

-- Owner may SELECT their own events only. All writes are server-side via the
-- service role; there is no self INSERT/UPDATE/DELETE policy.
DROP POLICY IF EXISTS "wearable_sync_events_select_own" ON public.wearable_sync_events;
CREATE POLICY "wearable_sync_events_select_own" ON public.wearable_sync_events
  FOR SELECT USING (auth.uid() = user_id);

REVOKE ALL ON public.wearable_sync_events FROM anon;
GRANT SELECT ON public.wearable_sync_events TO authenticated;
GRANT ALL ON public.wearable_sync_events TO service_role;


-- Indexes
CREATE INDEX IF NOT EXISTS idx_wearable_sync_events_user_created
  ON public.wearable_sync_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wearable_sync_events_source
  ON public.wearable_sync_events(source);


-- Patch delete_my_account_data() to also purge sync events
-- Only patch if the function already exists. This redefinition is a strict
-- superset and is safe/idempotent.
DO $$
DECLARE
  fn_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'delete_my_account_data'
  ) INTO fn_exists;

  IF fn_exists THEN
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
      n_sync_events  int := 0;
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

      delete from public.wearable_sync_events where user_id = uid;
      get diagnostics n_sync_events = row_count;

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
          'wearable_sync_events', n_sync_events,
          'coach_access', n_coach
        )
      );
    end;
    $fn$;

    REVOKE ALL ON FUNCTION public.delete_my_account_data() FROM public, anon;
    GRANT EXECUTE ON FUNCTION public.delete_my_account_data() TO authenticated;
  END IF;
END $$;


--  DONE. V3.4 Wearable Sync Events applied.
--
--  Privacy guarantees:
--    • No raw biometric payloads, no tokens, no auth headers stored.
--    • Only event metadata: source, type, status, aggregate counts, message.
--    • Owner-readable (SELECT) for the debug timeline; service-role writes only.