# 0VERTRAINED

A private training ledger for hybrid athletes. Log or import training, recovery and nutrition, and get one
evidence-based verdict each morning on how hard to train today. It runs as a progressive web app at
[0vertrained.netlify.app](https://0vertrained.netlify.app); a seeded demo with no account is at
[/#/demo](https://0vertrained.netlify.app/#/demo).

## What it does

- **One verdict a day.** Readiness is computed from the athlete's own baselines, with each limiter (sleep debt,
  illness, overreaching load, a rough check-in) able to make the call more cautious and never less. The
  reasoning is shown, with each signal's source.
- **Wearables as evidence, not decoration.** Oura and Whoop are read per metric through a fallback ladder,
  baselined within each device (devices carry systematic offsets, so no cross-device averaging), with
  leave-one-out baselines and physiological floors so a quiet athlete's ordinary night doesn't read as a crash.
  Strava and Google Health/Fitbit supply training load.
- **Training that follows the verdict.** Program presets for strength, running and two-a-day athletes; a
  set-by-set workout runner with drop sets and rest-pause; RIR-aware e1RM trends with stall detection; a
  per-muscle weekly volume audit; a race-plan generator with paces.
- **Fuel.** Adaptive energy targets from the intake-versus-weight-trend ledger, a USDA food search and a
  meal-plan preview.
- **A coach that cites its evidence.** Server-routed model calls (Ollama Cloud) over an inspectable evidence
  packet, with deterministic safety rules the model cannot override, daily usage caps and telemetry that
  stores no prompts or responses.
- **Scheduled pushes** ("The Courier") that carry headlines, never numbers, timed to each device's local clock.

## How it's built

React 18 and Vite on the client; Supabase (Postgres, auth, row-level security) for data; Netlify Functions for
everything that needs a secret (OAuth with the wearable providers, token encryption, the coach, pushes, error
and event logging). The client never holds a provider token or a service key.

```
src/                  the app: tabs, the recovery engine (src/wearables, src/recovery), programs, fuel, coach
src/__tests__/        unit and mounted tests (vitest)
netlify/functions/    serverless endpoints and scheduled jobs; netlify/tests/ covers them
supabase/             schema.sql and the migrations, in the order the migration_* names suggest
public/               the PWA shell, service worker, icons and legal pages
scripts/              the quality gate, test runner, icon generation, version sync
docs/                 the provider integration standard, the coach deployment runbook and the human check's setup
CHANGELOG.md          one entry per release
```

### Security model

- Every table has row-level security; the client talks to Supabase with the anon key and a user session only.
- Functions verify the caller's Supabase JWT server-side and never trust a user id from the request body.
- Provider OAuth tokens are stored encrypted (AES-256-GCM) with the key held by Netlify; plaintext token
  tables were dropped once the cutover completed.
- Account recovery uses a PBKDF2-derived phrase hash with versioned KDF parameters and atomic rate-limit
  buckets by username and address.
- Scheduled functions are not publicly routable; the one external scheduler endpoint checks a shared secret.
- Sign-in and sign-up can require Cloudflare Turnstile's human check, which Supabase verifies before it looks at
  a password. It is off until both sides are switched on, and Cloudflare is contacted only once someone starts
  to sign in ([docs/human-check.md](docs/human-check.md)).
- The CSP allows only the app's own origin, the provider APIs it talks to, and the script and frame of that
  human check; the quality gate scans the production build for secrets before every deploy.

## Running it

Node 22 (`.nvmrc`).

```bash
npm ci
npm run dev            # Vite dev server
npm test               # the whole vitest suite
npm run quality:gate   # tests, lint, production and demo builds, secret scan: what CI runs
```

The client reads `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY` and
`VITE_USDA_API_KEY` at build time; `VITE_DEMO_MODE=true` builds the seeded demo, which needs none of them.
`VITE_TURNSTILE_SITE_KEY`, when set, turns on the human check in the sign-in form.
The functions read their configuration from the Netlify environment (Supabase service role, provider client
ids and secrets, VAPID keys, the token encryption key, the Ollama key, `OURA_SYNC_SECRET`); see the comment
at the top of each function for what it needs. Apply `supabase/schema.sql`, then the migrations, in the
Supabase SQL editor.

## Status

In active development toward a beta, by one person. Copyright © Rami. The source is published to be read;
it is not offered under an open-source license.
