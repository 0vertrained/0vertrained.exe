--  MIGRATION: Provider Integration Standard
--
--  Adds the provider-neutral foundation used by Oura/Whoop today and by
--  Google Health/Fitbit + Strava next:
--    • connected_accounts: encrypted OAuth account metadata, service-role only
--    • health_daily_summaries: normalized recovery/daily health rows
--    • activities: normalized workout/activity summaries
--    • activity_streams: optional/lazy detailed streams
--    • provider_raw_payloads: short-retention raw payload quarantine
--    • widened wearable_sync_events constraints for google_health + strava
--
--  Tokens remain service-role only. Browser clients must use provider API
--  endpoints for status/disconnect/sync.

-- Connected OAuth accounts
CREATE TABLE IF NOT EXISTS public.connected_accounts (
  id                       UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id                  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider                 TEXT NOT NULL CHECK (provider IN ('oura', 'whoop', 'google_health', 'strava')),
  provider_user_id          TEXT,
  access_token_ciphertext   TEXT,
  refresh_token_ciphertext  TEXT,
  scopes_granted            JSONB NOT NULL DEFAULT '[]'::jsonb,
  expires_at                TIMESTAMPTZ,
  status                    TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'revoked', 'error', 'needs_reauth')),
  ai_eligible               BOOLEAN NOT NULL DEFAULT false,
  ai_exclusion_reason       TEXT,
  connected_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_sync_at              TIMESTAMPTZ,
  revoked_at                TIMESTAMPTZ,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, provider)
);

ALTER TABLE public.connected_accounts ENABLE ROW LEVEL SECURITY;

-- OAuth tokens are service-role only. The user sees safe status via functions.
REVOKE ALL ON public.connected_accounts FROM anon, authenticated;
GRANT ALL ON public.connected_accounts TO service_role;

CREATE INDEX IF NOT EXISTS idx_connected_accounts_user_provider
  ON public.connected_accounts(user_id, provider);
CREATE INDEX IF NOT EXISTS idx_connected_accounts_status
  ON public.connected_accounts(status);

-- Normalized daily health/recovery summaries
CREATE TABLE IF NOT EXISTS public.health_daily_summaries (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id              UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date                 DATE NOT NULL,
  source_provider      TEXT NOT NULL CHECK (source_provider IN ('oura', 'whoop', 'google_health', 'manual', 'mixed')),
  sleep_minutes        INTEGER,
  sleep_score          NUMERIC,
  hrv_ms               NUMERIC,
  resting_hr           NUMERIC,
  spo2                 NUMERIC,
  respiratory_rate     NUMERIC,
  steps                INTEGER,
  active_minutes       INTEGER,
  active_zone_minutes  INTEGER,
  calories             NUMERIC,
  readiness_score      NUMERIC,
  readiness_inputs     JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_payload_hash  TEXT,
  ai_eligible          BOOLEAN NOT NULL DEFAULT true,
  ai_exclusion_reason  TEXT,
  synced_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, date, source_provider)
);

ALTER TABLE public.health_daily_summaries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "health_daily_summaries_select_own" ON public.health_daily_summaries;
CREATE POLICY "health_daily_summaries_select_own" ON public.health_daily_summaries
  FOR SELECT USING (auth.uid() = user_id);
REVOKE ALL ON public.health_daily_summaries FROM anon;
GRANT SELECT ON public.health_daily_summaries TO authenticated;
GRANT ALL ON public.health_daily_summaries TO service_role;

CREATE INDEX IF NOT EXISTS idx_health_daily_summaries_user_date
  ON public.health_daily_summaries(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_health_daily_summaries_ai
  ON public.health_daily_summaries(user_id, ai_eligible, date DESC);

-- Normalized activity summaries
CREATE TABLE IF NOT EXISTS public.activities (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id              UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_provider      TEXT NOT NULL CHECK (source_provider IN ('whoop', 'google_health', 'strava', 'manual', 'mixed')),
  provider_activity_id TEXT NOT NULL DEFAULT '',
  start_time           TIMESTAMPTZ NOT NULL,
  sport_type           TEXT,
  title                TEXT,
  duration_sec         INTEGER,
  distance_m           NUMERIC,
  elevation_m          NUMERIC,
  avg_hr               NUMERIC,
  max_hr               NUMERIC,
  avg_power            NUMERIC,
  calories             NUMERIC,
  perceived_effort     NUMERIC,
  source_payload_hash  TEXT,
  dedupe_key           TEXT,
  ai_eligible          BOOLEAN NOT NULL DEFAULT true,
  ai_exclusion_reason  TEXT,
  synced_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, source_provider, provider_activity_id)
);

ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "activities_select_own" ON public.activities;
CREATE POLICY "activities_select_own" ON public.activities
  FOR SELECT USING (auth.uid() = user_id);
REVOKE ALL ON public.activities FROM anon;
GRANT SELECT ON public.activities TO authenticated;
GRANT ALL ON public.activities TO service_role;

CREATE INDEX IF NOT EXISTS idx_activities_user_start
  ON public.activities(user_id, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_activities_dedupe
  ON public.activities(user_id, dedupe_key);
CREATE INDEX IF NOT EXISTS idx_activities_ai
  ON public.activities(user_id, ai_eligible, start_time DESC);

-- Optional/lazy activity streams
CREATE TABLE IF NOT EXISTS public.activity_streams (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  activity_id    UUID NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
  stream_type    TEXT NOT NULL,
  resolution     TEXT,
  data           JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(activity_id, stream_type, resolution)
);

ALTER TABLE public.activity_streams ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "activity_streams_select_own" ON public.activity_streams;
CREATE POLICY "activity_streams_select_own" ON public.activity_streams
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.activities a
      WHERE a.id = activity_streams.activity_id
        AND a.user_id = auth.uid()
    )
  );
REVOKE ALL ON public.activity_streams FROM anon;
GRANT SELECT ON public.activity_streams TO authenticated;
GRANT ALL ON public.activity_streams TO service_role;

-- Raw provider payload quarantine
CREATE TABLE IF NOT EXISTS public.provider_raw_payloads (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id              UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider             TEXT NOT NULL CHECK (provider IN ('oura', 'whoop', 'google_health', 'strava')),
  payload_type          TEXT NOT NULL,
  payload_hash          TEXT,
  payload               JSONB NOT NULL DEFAULT '{}'::jsonb,
  retain_until          TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '14 days'),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.provider_raw_payloads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.provider_raw_payloads FROM anon, authenticated;
GRANT ALL ON public.provider_raw_payloads TO service_role;

CREATE INDEX IF NOT EXISTS idx_provider_raw_payloads_retention
  ON public.provider_raw_payloads(retain_until);
CREATE INDEX IF NOT EXISTS idx_provider_raw_payloads_user_provider
  ON public.provider_raw_payloads(user_id, provider, created_at DESC);

-- Widen sync event constraints for new providers/events
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'wearable_sync_events'
      AND constraint_name = 'wearable_sync_events_source_check'
  ) THEN
    ALTER TABLE public.wearable_sync_events
      DROP CONSTRAINT wearable_sync_events_source_check;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'wearable_sync_events' AND column_name = 'source') THEN
    ALTER TABLE public.wearable_sync_events
      ADD CONSTRAINT wearable_sync_events_source_check
      CHECK (source IN ('whoop', 'oura', 'google_health', 'strava', 'manual', 'mixed'));
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'wearable_sync_events'
      AND constraint_name = 'wearable_sync_events_event_type_check'
  ) THEN
    ALTER TABLE public.wearable_sync_events
      DROP CONSTRAINT wearable_sync_events_event_type_check;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'wearable_sync_events' AND column_name = 'event_type') THEN
    ALTER TABLE public.wearable_sync_events
      ADD CONSTRAINT wearable_sync_events_event_type_check
      CHECK (event_type IN ('sync', 'connect', 'disconnect', 'token_refresh', 'token_expired', 'oauth_connected', 'oauth_disconnected', 'sync_started', 'sync_succeeded', 'sync_failed', 'webhook_received', 'token_refreshed', 'token_revoked', 'rate_limited'));
  END IF;
END $$;

-- Account deletion patch for new provider-standard tables
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
      n_connected int := 0; n_health int := 0; n_activities int := 0; n_raw int := 0;
    begin
      if uid is null then
        raise exception 'not authenticated';
      end if;

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
