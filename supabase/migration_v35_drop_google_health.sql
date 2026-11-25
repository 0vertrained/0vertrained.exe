--  V19.9 — Retire Google Health/Fitbit
--  Run this in the Supabase SQL Editor with the 19.9.0 deploy.
--
--  The Google Health/Fitbit integration never left its feature flag, and
--  19.9.0 deletes its code. Its rows lived in the shared provider tables
--  next to Strava's, so this deletes only rows marked google_health: any
--  encrypted tokens and OAuth state from test connections, webhook events,
--  raw payloads, normalized summaries and activities (their activity streams
--  go with them by cascade), and sync events. Expect zero or a handful of
--  rows. The provider CHECK constraints still allow 'google_health'; they
--  are left alone so this file only ever deletes.
--
--  Each table is guarded: a database that never ran the provider-standard
--  migrations skips it instead of failing. Idempotent: re-running is safe.

do $$
begin
  if to_regclass('public.connected_accounts') is not null then
    delete from public.connected_accounts where provider = 'google_health';
  end if;
  if to_regclass('public.provider_oauth_state') is not null then
    delete from public.provider_oauth_state where provider = 'google_health';
  end if;
  if to_regclass('public.provider_webhook_events') is not null then
    delete from public.provider_webhook_events where provider = 'google_health';
  end if;
  if to_regclass('public.provider_raw_payloads') is not null then
    delete from public.provider_raw_payloads where provider = 'google_health';
  end if;
  if to_regclass('public.health_daily_summaries') is not null then
    delete from public.health_daily_summaries where source_provider = 'google_health';
  end if;
  if to_regclass('public.activities') is not null then
    delete from public.activities where source_provider = 'google_health';
  end if;
  if to_regclass('public.wearable_sync_events') is not null then
    delete from public.wearable_sync_events where source = 'google_health';
  end if;
end $$;
