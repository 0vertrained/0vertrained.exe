-- Oura shares this single-use state store with Strava. Preserve existing rows,
-- including states from the retired Google Health integration on older installs.
begin;
alter table public.provider_oauth_state
  drop constraint if exists provider_oauth_state_provider_check,
  add constraint provider_oauth_state_provider_check
    check (provider in ('oura', 'google_health', 'strava'));
commit;
