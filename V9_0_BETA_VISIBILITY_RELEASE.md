# 0VERTRAINED V9.0 — Error Visibility + Beta Prep

The "you can't run a beta blind" release. Two workstreams: a full client
error-visibility pipeline, and Coach hardening for multi-user cost safety.
No engine, scoring, or training-data changes anywhere.

## 1 · Error visibility

**Capture** (`src/errorReporting.js`, initialized in `main.jsx` before mount):
uncaught exceptions (`window.onerror`), unhandled promise rejections, and
every ErrorBoundary catch.

**Privacy stance, by construction:** a report contains the error
(message/stack/component-stack, hard-capped at 500/4000/2000 chars), the
route path, app version, and user agent. Never entries, settings, or
biometrics — a report is safe to read next to the privacy policy.

**Noise/abuse stance:** dedupe by message+source hash, hard cap of 8 reports
per session, and the endpoint **requires a JWT** (anonymous error sinks are
abuse magnets). Pre-login errors queue in memory and flush on SIGNED_IN. The
reporter itself can never throw — a crashing error reporter is the one
failure mode worse than none.

**Boundaries** (`src/ErrorBoundary.jsx`): whitepaper-styled fallback (ruled
block, ref code, "Try again"), wired at four levels — root (whole app),
per-tab (keyed on tab so one tab's crash never leaves another stuck on the
fallback), Profile overlay, and Form Check overlay. A Fuel crash leaves
Today, Recovery, Progress, the nav, and the FAB fully working.

**Server** (`netlify/functions/log-error.js`): JWT verified (coach.js
pattern), every field re-clamped server-side regardless of client claims,
service-role insert into `client_errors`.

**Reading errors during beta:** Supabase Dashboard → Table Editor →
`client_errors`, sorted by `created_at` (indexed). A dashboard UI is
deliberately deferred until the table has real traffic to design around.

## 2 · Coach hardening

The v2.7 `coach_access` table (per-user grants + monthly limits) already
existed. What was missing:

- **The legacy env-allowed user had NO limit of any kind.** Now everyone —
  legacy user included — gets a hard daily cap: `COACH_DAILY_LIMIT` env,
  default 60/day, enforced via the new `coach_usage_daily` table.
  Read-then-increment via service role; a slight racy overshoot under
  concurrency is acceptable for a cost cap, and a Supabase blip **fails
  open** (one uncounted message beats taking Coach down).
- **Kill switch:** set `COACH_ENABLED=false` in Netlify env to stop all
  coach traffic instantly (503) with no deploy.
- **Client visibility gate** (`isCoachEnabled` in Coach.jsx): default
  behavior unchanged (legacy env user only). Set `VITE_COACH_OPEN=true` and
  every logged-in user sees the "Ask Coach" quick action; accounts without a
  `coach_access` grant get the server's friendly 403 in the chat. The server
  remains the only real gate.

**Streaming responses: deferred.** It's UX polish, not a beta blocker, and
SSE through Netlify + a client stream reader deserves its own tested pass.

## One-time setup

1. Run `supabase/migration_add_beta_visibility.sql` (client_errors +
   coach_usage_daily; both RLS-on, zero policies = service-role only)
2. Env vars already required elsewhere cover log-error (SUPABASE_URL /
   ANON_KEY / SERVICE_ROLE_KEY)
3. Optional: `COACH_DAILY_LIMIT` (default 60), `COACH_ENABLED`,
   `VITE_COACH_OPEN` — all default to current behavior if unset

## Invite/onboarding flow — explicitly deferred

Supabase's built-in "disable public signups" + dashboard invites covers a
small beta with zero code. Build invite codes only when manual invites
actually hurt.

## Verification

73/73 test files, **1024/1024 tests** (+6: reporter normalize/caps/dedupe/
key stability, rendered boundary catch-report-recover, pass-through). Full
quality gate green. Netlify functions syntax-checked via `node --check`.

## Files

Added: src/errorReporting.js · src/ErrorBoundary.jsx ·
netlify/functions/log-error.js · supabase/migration_add_beta_visibility.sql ·
src/__tests__/errorVisibility.test.jsx
Modified: src/main.jsx (init) · src/App.jsx (boundary wiring) ·
netlify/functions/coach.js (kill switch + daily cap) · src/Coach.jsx
(VITE_COACH_OPEN gate) · netlify.toml (secrets omit)

## Device-review checklist

1. Normal use: nothing visible changed anywhere
2. After deploying + running the migration: check `client_errors` stays
   empty during a clean session, then confirm a real error lands (e.g.
   temporarily throw inside a tab in a preview deploy)
3. Coach: send a message, confirm `coach_usage_daily` incremented
4. Flip `COACH_ENABLED=false` in Netlify env → Coach returns the offline
   message without a deploy; flip back
