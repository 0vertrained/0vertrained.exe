--  Google Health/Fitbit + Strava integration support

CREATE TABLE IF NOT EXISTS public.provider_oauth_state (
  state       TEXT PRIMARY KEY,
  provider    TEXT NOT NULL CHECK (provider IN ('google_health', 'strava')),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.provider_oauth_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.provider_oauth_state FROM anon, authenticated;
GRANT ALL ON public.provider_oauth_state TO service_role;

CREATE INDEX IF NOT EXISTS idx_provider_oauth_state_provider_state
  ON public.provider_oauth_state(provider, state);
CREATE INDEX IF NOT EXISTS idx_provider_oauth_state_expires
  ON public.provider_oauth_state(expires_at);

-- The provider-standard migration creates these tables. This patch is defensive
-- for older beta databases where that migration may have been applied before
-- Google Health/Strava were fully wired.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'connected_accounts'
      AND constraint_name = 'connected_accounts_provider_check'
  ) THEN
    ALTER TABLE public.connected_accounts DROP CONSTRAINT connected_accounts_provider_check;
    ALTER TABLE public.connected_accounts
      ADD CONSTRAINT connected_accounts_provider_check
      CHECK (provider IN ('oura', 'whoop', 'google_health', 'strava'));
  END IF;
END $$;

-- Optional webhook audit trail. It is service-role only because webhook payloads
-- can contain provider identifiers and object IDs.
CREATE TABLE IF NOT EXISTS public.provider_webhook_events (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  provider        TEXT NOT NULL CHECK (provider IN ('google_health', 'strava')),
  provider_user_id TEXT,
  object_id       TEXT,
  event_type      TEXT,
  aspect_type     TEXT,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.provider_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.provider_webhook_events FROM anon, authenticated;
GRANT ALL ON public.provider_webhook_events TO service_role;

CREATE INDEX IF NOT EXISTS idx_provider_webhook_events_provider_user
  ON public.provider_webhook_events(provider, provider_user_id, created_at DESC);

-- Include provider OAuth state rows in self-service account deletion where the
-- delete function already exists. Webhook audit rows do not directly carry a
-- user_id, but OAuth state does and is deleted here defensively.
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
      n_entries int := 0; n_program int := 0; n_oura_data int := 0; n_oura_tokens int := 0;
      n_whoop_data int := 0; n_whoop_tokens int := 0; n_whoop_state int := 0;
      n_snapshots int := 0; n_sync_events int := 0; n_coach int := 0;
      n_connected int := 0; n_health int := 0; n_activities int := 0; n_raw int := 0; n_provider_state int := 0;
    begin
      if uid is null then
        raise exception 'not authenticated';
      end if;

      delete from public.provider_oauth_state where user_id = uid;
      get diagnostics n_provider_state = row_count;

      delete from public.provider_raw_payloads where user_id = uid;
      get diagnostics n_raw = row_count;

      delete from public.activity_streams s
      using public.activities a
      where s.activity_id = a.id and a.user_id = uid;

      delete from public.activities where user_id = uid;
      get diagnostics n_activities = row_count;

      delete from public.health_daily_summaries where user_id = uid;
      get diagnostics n_health = row_count;

      delete from public.connected_accounts where user_id = uid;
      get diagnostics n_connected = row_count;

      delete from public.entries where user_id = uid;
      get diagnostics n_entries = row_count;

      delete from public.program where user_id = uid;
      get diagnostics n_program = row_count;

      delete from public.oura_data where user_id = uid;
      get diagnostics n_oura_data = row_count;

      delete from public.oura_tokens where user_id = uid;
      get diagnostics n_oura_tokens = row_count;

      delete from public.whoop_data where user_id = uid;
      get diagnostics n_whoop_data = row_count;

      delete from public.whoop_tokens where user_id = uid;
      get diagnostics n_whoop_tokens = row_count;

      delete from public.whoop_oauth_state where user_id = uid;
      get diagnostics n_whoop_state = row_count;

      delete from public.wearable_snapshots where user_id = uid;
      get diagnostics n_snapshots = row_count;

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
          'provider_oauth_state', n_provider_state,
          'wearable_snapshots', n_snapshots,
          'wearable_sync_events', n_sync_events,
          'coach_access', n_coach,
          'connected_accounts', n_connected,
          'health_daily_summaries', n_health,
          'activities', n_activities,
          'provider_raw_payloads', n_raw
        )
      );
    end;
    $fn$;

    REVOKE ALL ON FUNCTION public.delete_my_account_data() FROM public, anon;
    GRANT EXECUTE ON FUNCTION public.delete_my_account_data() TO authenticated;
  END IF;
END $$;
