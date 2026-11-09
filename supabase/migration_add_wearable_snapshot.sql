--  MIGRATION: V12.2 Wearable Display Snapshot (DB-first hydrate)
--  Run this ONCE in: Supabase Dashboard → SQL Editor
--
--  Adds a token-free, display-safe "latest recovery snapshot" per user so the
--  Recovery tab can hydrate from the server/DB before a live provider refresh,
--  then keep refreshing quietly in the background.
--
--  SECURITY MODEL (mirrors oura_data / wearable_sync_events):
--    • wearable_snapshots is OWNER-READABLE (SELECT) so the browser can read
--      its own last-known snapshot through RLS. There is NO self INSERT/UPDATE/
--      DELETE policy — every write goes through the service role (the
--      /api/wearable/* function, which derives ownership from a verified
--      Supabase Bearer JWT, never a query/body user_id).
--    • The snapshot column holds ONLY display-safe, already-rendered values
--      (recovery ledger, per-metric scores, raw metric strings, source/freshness
--      labels). It NEVER holds OAuth tokens, refresh tokens, service keys, raw
--      provider auth responses, or raw biometric payloads. The writer strips
--      token-like fields defensively before storage.
--
--  This migration is IDEMPOTENT and SAFE to re-run. It only ADDS objects and
--  patches delete_my_account_data() if present without weakening RLS.


-- wearable_snapshots table
-- Exactly one latest display-safe snapshot per user (user_id is the primary
-- key, so the writer upserts on conflict). No biometric payloads, no tokens.
CREATE TABLE IF NOT EXISTS public.wearable_snapshots (
  user_id     UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Which provider the snapshot leans on for display ('oura' | 'whoop' |
  -- 'manual' | 'mixed' | 'none'). Advisory label only — never averaged.
  source      TEXT,
  -- Freshness marker the server derives from updated_at at write/read time.
  status      TEXT NOT NULL DEFAULT 'fresh' CHECK (status IN ('fresh', 'stale', 'empty')),
  -- Display-safe, already-rendered dashboard values. NEVER tokens, NEVER raw
  -- provider payloads. Kept small; the writer strips secret-bearing keys.
  snapshot    JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.wearable_snapshots ENABLE ROW LEVEL SECURITY;

-- Owner may SELECT their own snapshot only. All writes are server-side via the
-- service role; there is deliberately no self INSERT/UPDATE/DELETE policy.
DROP POLICY IF EXISTS "wearable_snapshots_select_own" ON public.wearable_snapshots;
CREATE POLICY "wearable_snapshots_select_own" ON public.wearable_snapshots
  FOR SELECT USING (auth.uid() = user_id);

REVOKE ALL ON public.wearable_snapshots FROM anon;
GRANT SELECT ON public.wearable_snapshots TO authenticated;
GRANT ALL ON public.wearable_snapshots TO service_role;


-- Index
-- user_id is already the PK; add a freshness index for any future admin sweep.
CREATE INDEX IF NOT EXISTS idx_wearable_snapshots_updated
  ON public.wearable_snapshots(updated_at DESC);


-- Patch delete_my_account_data() to also purge snapshots
-- Only patch if the function already exists. This redefinition is a strict
-- superset of migration_add_wearable_sync_events.sql and is safe/idempotent.
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
      n_entries        int := 0;
      n_program        int := 0;
      n_oura_data      int := 0;
      n_oura_tokens    int := 0;
      n_whoop_data     int := 0;
      n_whoop_tokens   int := 0;
      n_whoop_state    int := 0;
      n_sync_events    int := 0;
      n_snapshots      int := 0;
      n_coach          int := 0;
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

      delete from public.wearable_snapshots where user_id = uid;
      get diagnostics n_snapshots = row_count;

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
          'wearable_snapshots', n_snapshots,
          'coach_access', n_coach
        )
      );
    end;
    $fn$;

    REVOKE ALL ON FUNCTION public.delete_my_account_data() FROM public, anon;
    GRANT EXECUTE ON FUNCTION public.delete_my_account_data() TO authenticated;
  END IF;
END $$;


--  DONE. V12.2 Wearable Display Snapshot applied.
--
--  Privacy guarantees:
--    • No tokens, no auth headers, no raw provider payloads, no raw biometric
--      values stored — only already-rendered display-safe dashboard values.
--    • Owner-readable (SELECT) for DB-first hydrate; service-role writes only.
