# Provider Integration Standard

This repo has a provider-neutral foundation for Oura, Whoop, Strava, and future health/activity sources. Google Health/Fitbit was built on it but never enabled, and was removed in 19.9.0.

## Current runtime behavior

Oura and Whoop still use their legacy runtime tables (`oura_tokens`, `whoop_tokens`, `oura_data`, `whoop_data`) so existing users are not broken by the migration. On successful OAuth, both providers also best-effort mirror encrypted account metadata into `connected_accounts` when `supabase/migration_add_provider_standard.sql` has been applied and `TOKEN_ENCRYPTION_KEY` is configured.

## New standard tables

- `connected_accounts`: encrypted OAuth metadata; service-role only.
- `health_daily_summaries`: normalized daily recovery/health values.
- `activities`: normalized workout/activity summaries.
- `activity_streams`: optional/lazy detailed streams.
- `provider_raw_payloads`: short-retention raw payload quarantine.
- `wearable_sync_events`: widened to include `strava`, `manual`, and `mixed` (the constraints still allow the retired `google_health`).

## AI Coach eligibility

Provider AI policy is centralized in:

- frontend: `src/integrations/providerRegistry.js`
- server: `netlify/functions/_provider-standard.js`

Defaults:

| Provider | AI Coach default | Reason |
|---|---:|---|
| Oura | Eligible with user opt-in | Recovery source |
| Whoop | Eligible with user opt-in | Recovery/load source |
| Strava | Excluded | Strava API policy risk |
| Manual | Eligible | User-entered first-party data |

The Coach payload field is now `wearableSummary`. The server accepts legacy `ouraSummary` as a backward-compatible fallback.

## Environment variables

Required for provider-standard account mirroring:

```txt
TOKEN_ENCRYPTION_KEY=
```

Strava:

```txt
STRAVA_CLIENT_ID=
STRAVA_CLIENT_SECRET=
STRAVA_REDIRECT_URI=
STRAVA_WEBHOOK_VERIFY_TOKEN=
STRAVA_WEBHOOK_SECRET=
STRAVA_SUBSCRIPTION_ID=
```

Do not expose any of the above as `VITE_*` variables.

## Implementation notes

1. Apply `supabase/migration_add_provider_standard.sql` before enabling Strava.
2. Set `TOKEN_ENCRYPTION_KEY` before connecting new provider accounts if you want account mirroring enabled.
3. Backfill existing legacy Oura/Whoop tokens into `connected_accounts` with a one-time service-role script if/when you are ready to retire the legacy tables.
4. Store long-lived app data in normalized tables, not raw provider payloads.
5. Keep Strava-derived records `ai_eligible=false` unless Strava explicitly approves the AI use case.

## V13.1 implementation: Strava

Provider-standard OAuth and sync endpoints:

- `GET /api/strava/auth`
- `GET /api/strava/callback`
- `GET /api/strava/status`
- `POST /api/strava/sync?days=30`
- `GET /api/strava/counts`
- `GET /api/strava/events`
- `POST /api/strava/disconnect`
- `GET|POST /api/strava/webhook/<STRAVA_WEBHOOK_SECRET>`

### Current behavior

Strava sync stores normalized rows in:

- `activities` for athlete activity summaries.
- `provider_raw_payloads` for short-retention troubleshooting samples.

Strava records are created with `ai_eligible = false` and `ai_exclusion_reason = 'strava_api_terms'` by default.

### Webhook security

Strava doesn't sign its webhook events, so the handler treats each one as a hint:

- A deauthorization purges a user's Strava data only after Strava itself refuses the stored token. If Strava can't answer, the handler returns 503 so Strava retries the delivery.
- An activity delete removes the stored row only after Strava answers 404 for that activity.
- Events for athletes nobody connected are acknowledged and not stored, bodies over 4 KB are refused, and only the fields the handler uses are kept.
- With `STRAVA_WEBHOOK_SECRET` set, the callback is `/api/strava/webhook/<secret>` and every other webhook path answers 404. Use a long random value, and register that full URL as the subscription's `callback_url`. `STRAVA_SUBSCRIPTION_ID`, when set, refuses events from any other subscription.

### Required env vars

```txt
TOKEN_ENCRYPTION_KEY=
STRAVA_CLIENT_ID=
STRAVA_CLIENT_SECRET=
STRAVA_REDIRECT_URI=https://YOUR_DOMAIN/api/strava/callback
STRAVA_WEBHOOK_VERIFY_TOKEN=
STRAVA_WEBHOOK_SECRET=
STRAVA_SUBSCRIPTION_ID=
```

### Database migrations

Apply these migrations in order:

1. `supabase/migration_add_provider_standard.sql`
2. `supabase/migration_add_strava_google_health.sql`

The second migration adds `provider_oauth_state` and `provider_webhook_events`, then defensively widens provider constraints if needed. `supabase/migration_v35_drop_google_health.sql` deletes any rows the retired Google Health integration left behind.
