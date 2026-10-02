# Provider Integration Standard

This repo now has a provider-neutral foundation for Oura, Whoop, Google Health/Fitbit, Strava, and future health/activity sources.

## Current runtime behavior

Oura and Whoop still use their legacy runtime tables (`oura_tokens`, `whoop_tokens`, `oura_data`, `whoop_data`) so existing users are not broken by the migration. On successful OAuth, both providers also best-effort mirror encrypted account metadata into `connected_accounts` when `supabase/migration_add_provider_standard.sql` has been applied and `TOKEN_ENCRYPTION_KEY` is configured.

## New standard tables

- `connected_accounts`: encrypted OAuth metadata; service-role only.
- `health_daily_summaries`: normalized daily recovery/health values.
- `activities`: normalized workout/activity summaries.
- `activity_streams`: optional/lazy detailed streams.
- `provider_raw_payloads`: short-retention raw payload quarantine.
- `wearable_sync_events`: widened to include `google_health`, `strava`, `manual`, and `mixed`.

## AI Coach eligibility

Provider AI policy is centralized in:

- frontend: `src/integrations/providerRegistry.js`
- server: `netlify/functions/_provider-standard.js`

Defaults:

| Provider | AI Coach default | Reason |
|---|---:|---|
| Oura | Eligible with user opt-in | Recovery source |
| Whoop | Eligible with user opt-in | Recovery/load source |
| Google Health/Fitbit | Eligible with user opt-in | Recovery/activity source |
| Strava | Excluded | Strava API policy risk |
| Manual | Eligible | User-entered first-party data |

The Coach payload field is now `wearableSummary`. The server accepts legacy `ouraSummary` as a backward-compatible fallback.

## Environment variables

Required for provider-standard account mirroring:

```txt
TOKEN_ENCRYPTION_KEY=
```

Future Google Health/Fitbit:

```txt
GOOGLE_HEALTH_CLIENT_ID=
GOOGLE_HEALTH_CLIENT_SECRET=
GOOGLE_HEALTH_REDIRECT_URI=
GOOGLE_HEALTH_WEBHOOK_SECRET=
```

Future Strava:

```txt
STRAVA_CLIENT_ID=
STRAVA_CLIENT_SECRET=
STRAVA_REDIRECT_URI=
STRAVA_WEBHOOK_VERIFY_TOKEN=
STRAVA_WEBHOOK_SECRET=
```

Do not expose any of the above as `VITE_*` variables.

## Implementation notes

1. Apply `supabase/migration_add_provider_standard.sql` before enabling Google Health/Fitbit or Strava.
2. Set `TOKEN_ENCRYPTION_KEY` before connecting new provider accounts if you want account mirroring enabled.
3. Backfill existing legacy Oura/Whoop tokens into `connected_accounts` with a one-time service-role script if/when you are ready to retire the legacy tables.
4. Store long-lived app data in normalized tables, not raw provider payloads.
5. Keep Strava-derived records `ai_eligible=false` unless Strava explicitly approves the AI use case.

## V13.1 implementation: Google Health/Fitbit + Strava

This repo now includes first-pass provider-standard OAuth and sync endpoints for:

- `GET /api/google-health/auth`
- `GET /api/google-health/callback`
- `GET /api/google-health/status`
- `POST /api/google-health/sync?days=30`
- `GET /api/google-health/counts`
- `GET /api/google-health/events`
- `POST /api/google-health/disconnect`
- `POST /api/google-health/webhook`
- `GET /api/strava/auth`
- `GET /api/strava/callback`
- `GET /api/strava/status`
- `POST /api/strava/sync?days=30`
- `GET /api/strava/counts`
- `GET /api/strava/events`
- `POST /api/strava/disconnect`
- `GET|POST /api/strava/webhook`

### Current behavior

Google Health/Fitbit sync stores normalized rows in:

- `health_daily_summaries` for sleep, HRV, resting HR, SpO₂, respiratory rate, steps, active minutes, active zone minutes, and calories when available.
- `activities` for exercise summaries.
- `provider_raw_payloads` for short-retention troubleshooting samples.

Strava sync stores normalized rows in:

- `activities` for athlete activity summaries.
- `provider_raw_payloads` for short-retention troubleshooting samples.

Strava records are created with `ai_eligible = false` and `ai_exclusion_reason = 'strava_api_terms'` by default. Google Health/Fitbit records inherit the provider-standard AI eligibility policy and should still be gated by explicit user consent before inclusion in AI Coach context.

### Required env vars

```txt
TOKEN_ENCRYPTION_KEY=
GOOGLE_HEALTH_CLIENT_ID=
GOOGLE_HEALTH_CLIENT_SECRET=
GOOGLE_HEALTH_REDIRECT_URI=https://YOUR_DOMAIN/api/google-health/callback
GOOGLE_HEALTH_WEBHOOK_SECRET=
STRAVA_CLIENT_ID=
STRAVA_CLIENT_SECRET=
STRAVA_REDIRECT_URI=https://YOUR_DOMAIN/api/strava/callback
STRAVA_WEBHOOK_VERIFY_TOKEN=
```

### Database migrations

Apply these migrations in order:

1. `supabase/migration_add_provider_standard.sql`
2. `supabase/migration_add_strava_google_health.sql`

The second migration adds `provider_oauth_state` and `provider_webhook_events`, then defensively widens provider constraints if needed.
