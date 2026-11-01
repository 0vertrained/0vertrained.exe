# 0VERTRAINED V7.0 — Feature Release

Six of the seven planned features ship in this release, fully implemented and
verified. The seventh (Strava import) is deferred with reasons and a concrete
plan below. Engine discipline holds throughout: nothing here changes scoring,
recommendations, blending, or the load model. The only new write paths are
(a) Session Mode, which reuses the exact `workout.exercises.<name>` path the
grid logger already uses, and (b) the push-subscription store, which is a new
service-role-only table that never touches training data.

---

## 1 · Session Mode (`SessionMode.jsx`, `sessionIntelligence.js`)

"Start session →" button in the Lifting block opens a focused full-screen
runner: one exercise at a time with —

- **Last time** line ("185×8/8/8 · 06-30") from your logged history
- **Progression hint** — conservative double progression: hit every
  programmed rep last time → suggest +5 lb upper / +10 lb lower; fell short →
  repeat the weight and chase reps. Hints only; never suggests deloads
  (that's the decision engine's job).
- **Plate math** for the working weight ("190 lb → 45 + 25 + 2.5 / side")
- **Rest timer** — auto-starts when a set is checked (180s heavy compounds,
  120s compounds, 90s accessories), counts overtime past zero, skippable
- **Auto-advance** to the next exercise when the last set completes
- Set edits flow through the same `updateToday` path as the grid — the two
  views can never disagree. PR detection fires identically.

## 2 · Coach calibration report (`coachCalibration.js`, `ProgressInsights.jsx`)

Progress → Overview, after Coach Review. Pairs every day you responded to
the daily call (Followed / Modified / Ignored / Skipped — already persisted)
with the **next day's** manual check-in scored by the app's existing
`calcRecoveryScore`. Reports follow rate, next-day averages for followed vs
not-followed, per-call breakdowns, and refuses to claim anything under n=3
("Building history — 1/3…"). Every number carries the caveat: association,
not proof.

## 3 · Per-exercise progression hints

Part of `sessionIntelligence.js` (see #1) — surfaced in Session Mode's
exercise hero and as the weight-input placeholder.

## 4 · N=1 correlation explorer (`correlationExplorer.js`, `ProgressInsights.jsx`)

Progress → Overview, collapsed by default. Pick any two logged metrics
(sleep, energy, soreness, protein, calories, water, run miles, lift volume),
same-day or 1-day lag (sleep → *next-day* energy), and get a scatter +
Pearson r over your last 90 logged days. Degenerate inputs (n<3, zero
variance) return "not enough overlapping days" instead of a fake r. Footer
on everything: "Association, not causation — your own logged days, nothing
pooled or modeled."

## 5 · Race block (`raceBlock.js`, `RaceBlockSection.jsx`)

Progress → Program, under the Block card. Set a race name + date and get:

- Countdown ("9w 3d out") with phase guidance — base window (8w+),
  sharpening window, **taper flag in the final 10 days** ("Deload beats one
  more quality session from here"), race day, and post-race debrief prompt
- **Hyrox station benchmark ledger** — SkiErg, sled push/pull, burpee broad
  jumps, row, farmers, lunges, wall balls, 1k pace — editable mm:ss fields
- localStorage persistence (`ovt_race_plan_v1`), same precedent as
  periodization settings. Guidance copy only — the program is never rewritten.

## 6 · Push notifications (`sw.js`, `push.js`, `NotificationsCard.jsx`, 2 functions, 1 migration)

Full Web Push pipeline:

- `public/sw.js` — notification-only service worker (deliberately **no**
  offline caching; a stale-cache SW is the classic way to break a PWA)
- `src/push.js` — support detection, subscribe/unsubscribe. On an iPhone
  Safari tab it tells you the truth: *"notifications require adding the app
  to your Home Screen first."*
- **Profile → App → Notifications** toggle
- `netlify/functions/push-subscribe.js` — JWT-verified (same auth pattern as
  coach.js), stores subscriptions via service role
- `netlify/functions/push-reminders.js` — **scheduled** evening check-in
  reminder (cron `30 0 * * *` UTC ≈ 7:30pm Dallas; edit in the file), prunes
  dead endpoints automatically
- `supabase/migration_add_push_subscriptions.sql` — RLS enabled with zero
  policies = service-role only
- netlify.toml: `sw.js` served no-cache; VAPID public key added to the
  secrets-scan omit list; `web-push` added to dependencies

### ⚠ One-time setup required before push works

1. `npx web-push generate-vapid-keys`
2. Netlify env vars: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
   `VAPID_SUBJECT` (mailto:you@…), `VITE_VAPID_PUBLIC_KEY` (same value as
   public), and `SUPABASE_SERVICE_ROLE_KEY` if not already set
3. Run `migration_add_push_subscriptions.sql` in the Supabase SQL editor
4. On iPhone: **Share → Add to Home Screen**, open from the icon, then
   Profile → App → Notifications → Enable (iOS 16.4+)

## 7 · Strava/Garmin import — DEFERRED, deliberately

Not shipped in this release, for an honest reason: OAuth code that can't be
exercised end-to-end is a liability, and Strava requires an API application
(client ID/secret, approved redirect URI) that only you can register. Half-
tested auth code doesn't meet the bar the rest of this repo holds.

Concrete plan when you're ready (≈1 session of work):
1. Register the app at strava.com/settings/api → env `STRAVA_CLIENT_ID`,
   `STRAVA_CLIENT_SECRET`
2. `netlify/functions/strava-auth.js` — clone of the whoop-auth.js pattern
   (authorize redirect → token exchange → tokens in a service-role table)
3. `migration_add_strava.sql` — tokens table mirroring `migration_add_whoop.sql`
4. `src/strava.js` + a display-only "Imported runs" section in Progress →
   History (Events) — same "display-only, never writes into entries"
   contract Oura/Whoop follow

---

## Verification

- 71/71 test files, **1011/1011 tests** pass (+2 new test files, +22 tests
  covering last-performance lookup, progression hints, plate math, rest
  defaults, calibration sampling/reporting, Pearson/lag pairing, race plan
  normalization/countdown phases)
- Full quality gate: production build, demo build, secret scan, deploy
  artifact — all pass

## Files added

src/sessionIntelligence.js · src/SessionMode.jsx · src/coachCalibration.js ·
src/correlationExplorer.js · src/ProgressInsights.jsx · src/raceBlock.js ·
src/RaceBlockSection.jsx · src/push.js · src/NotificationsCard.jsx ·
public/sw.js · netlify/functions/push-subscribe.js ·
netlify/functions/push-reminders.js ·
supabase/migration_add_push_subscriptions.sql ·
src/__tests__/sessionIntelligence.test.js · src/__tests__/v7Features.test.js

## Files modified

src/App.jsx (session mode wiring, ProgressInsights + RaceBlockSection +
NotificationsCard placement) · netlify.toml (sw.js headers, secrets omit) ·
package.json (+web-push)

## Device-review checklist

1. Today → Lifting → Start session: rest timer starts on set check,
   auto-advance on exercise completion, plate math matches the bar
2. Session Mode and the grid show the same sets after switching between them
3. Progress → Overview: calibration shows "building history" until you have
   3 responded days with next-morning check-ins
4. Correlation explorer: sleep → energy (next day) with your real data
5. Progress → Program: set your fall race date; check the countdown phase
6. Push (after env setup): enable from the Home-Screen app, then trigger
   `push-reminders` manually from the Netlify functions console to test
