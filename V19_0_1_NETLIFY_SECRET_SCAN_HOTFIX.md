# 0VERTRAINED v19.0.1 — Netlify Secret Scan Hotfix

## Problem

The v19 routed-coach values are public configuration, but the corresponding Netlify variables were marked as secrets. Netlify therefore searched the repository and build output for values such as `routed` and the configured model names.

The project already defined `SECRETS_SCAN_OMIT_KEYS` in `netlify.toml`. Netlify file-based configuration overrides a dashboard variable with the same key, so changing only the dashboard value did not affect builds.

## Fix

The source-controlled `SECRETS_SCAN_OMIT_KEYS` list now includes:

- `COACH_ROUTING_MODE`
- `COACH_FAST_MODEL`
- `COACH_MAIN_MODEL`
- `COACH_DEEP_MODEL`
- `COACH_FALLBACK_MODEL`

Actual credentials remain scanned and are not safelisted.

## Deployment

Deploy this package normally. No dashboard changes or database migrations are required. A clear-cache deploy is optional because the fix is in `netlify.toml` and will apply on the next build.
