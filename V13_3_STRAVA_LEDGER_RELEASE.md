# V13.3 — Strava Ledger (Import → Load → Surfaces Release)

**Date:** 2026-07-10 · **Scope:** Strava data flows into the cardio ledger, training load, Progress, and Recovery; webhook gains the deauthorization purge and targeted sync. Executes Phases 1–2 (+ the Phase 3 webhook) of `STRAVA_INTEGRATION_PLAN.md`.
**Gate:** 1,267 tests passing (22 new) · lint clean (0 errors) · production + demo builds green · secret scan clean · entry chunk +7.7 kB raw / ~+2.5 kB gzip (data loader + the Today suggestion row; the Progress figure and Recovery row ride their existing lazy chunks).

Before this release the `activities` table had zero client readers — a Strava
run changed nothing but a count in Settings. Now it fills the ledger, moves
ACWR, and shows up where trends live, without ever outranking a manual log or
touching an AI Coach payload.

---

## 1 · Today — the suggestion row (`src/sections/StravaCardioRow.jsx`)

When the displayed day has Strava activity and **no manually logged cardio**
(the "ran outside the app" case — including rest days and past-day logging),
one quiet ruled row appears on the front page, above the Workout fold so it's
visible without expanding anything:

- `STRAVA` source tag + dotted **"Not counted yet"** provisional tag, a serif
  summary line (`5.1 mi · 41:30 · 8:08 /mi`), and the activity name.
- **One tap ("Use for today")** fills miles + time through the existing
  `updateToday` write path; pace derives from the existing autofill effect.
  No new persistence, no new save paths. Editing afterwards is just editing
  manual fields — provenance flips naturally.
- **Load vs plan-completion split:** the session counts toward training load
  immediately (the work happened) but toward plan-completion only after the
  confirm — "did I follow the plan" stays the athlete's statement.
- **Dismiss** is per-day, remembered locally, never nags again; the row also
  disappears on its own the instant manual cardio exists. Multi-activity days
  sum (runs first).
- **"View on Strava →"** deep link on the row — the attribution the API
  Agreement requires. Actions are ghost-weight: Today's single filled CTA
  remains the hero's (V6 interaction-verb system).

## 2 · Load model (`src/strava/dataLoading.js` + `wearableWorkoutLoad.js`)

- New client read path mirroring oura/whoop `dataLoading`: one Supabase query
  against the athlete's own `activities` rows (RLS `activities_select_own`),
  zero Strava API calls client-side, demo-safe, degrades to `[]`.
- `stravaLoadForDay` joins the conservative fill bridge on the existing
  scale: runs `miles × 45 + elevation` bump, rides `miles × 14 + elevation`,
  other sports `minutes × 5`, day-capped at 900. **Fill priority is now
  Strava → Whoop → Oura** — exactly one source is chosen per day, so a run
  both devices captured can never double-count in ACWR; the runner-up is kept
  as corroborating context with a "counted once" note. Manual stays canonical
  and untouched. TodayTab loads 28 days so fills reach the full acute:chronic
  window; readiness and the daily verdict now see outside cardio.
- Load-row notes carry **counts only, never activity titles** — nothing
  Strava-identifying survives serialization.

## 3 · Surfaces

- **Progress → Fig · Running volume** (`RunningVolumeFigure` +
  `runningVolume.js`): this training week's miles, an 8-week Monday-anchored
  sparkline, and honest provenance ("manual + Strava · each day counted
  once"). Dedupe reuses `getLoggedCardioBlocks` — the load model's own
  definition of "logged" — so manual-vs-import can never drift. Renders
  nothing for a runner-less log (a lifter's Progress page stays quiet), works
  manual-only when Strava isn't connected, and carries the **"Powered by
  Strava"** mark when Strava rows contribute.
- **Recovery → Training Load figure** gains one display-only ruled row:
  `External cardio · 7d — 14.2 mi · 186 min · STRAVA`. Strain-side context
  only; the dashboard's own load math is unchanged.
- **Settings → Strava** copy now says what the integration actually does
  ("one tap on Today logs a Strava session as that day's cardio"), keeps the
  AI-exclusion statement in plain words, and adds the Powered by Strava mark.

## 4 · The AI line, enforced (`stravaCardioRow.test.jsx`)

Architecture already kept Strava out of coach payloads (the coach slice
computes manual-only loads; `buildCoachContext` takes only oura/whoop/manual).
This release locks it: `buildSlice` is exported and a compliance suite asserts
the serialized coach slice and wearable summary contain **no strava strings
and no activity titles**, and that strava load-row notes never carry titles.
A confirmed suggestion writes plain numbers into manual fields — deliberately
no "Strava" marker in entry data — so confirmed sessions are ordinary manual
data everywhere, including the N=1 correlation explorer's existing "Run
miles" metric, which now benefits with zero plumbing.

## 5 · Webhook (`netlify/functions/strava-auth.js` → `/api/strava/webhook`)

- **Deauthorization purge:** an athlete-update event with
  `authorized:"false"` now calls `deleteProviderData` (tokens, activities,
  streams, raw payloads, connected account) and logs `deauthorized_purged` —
  the API Agreement's revocation requirement, previously unhandled.
- **Targeted sync:** activity create/update events fetch that one activity
  (single API call, rate-budget friendly) and upsert; delete events drop the
  single normalized row. All best-effort — the next full sync reconciles.
- `stravaWebhook.test.js` covers the challenge echo, bad-token rejection, the
  end-to-end purge (asserting the actual DELETEs), and the targeted delete.
- Ops note: creating the webhook subscription with Strava (using
  `STRAVA_WEBHOOK_VERIFY_TOKEN`) remains a one-time manual step at deploy.

## 6 · Deferred (unchanged from the plan)

Phase 3 streams (lazy HR series → true TRIMP load + the 80/20 polarization
figure) and race-block-specific figures. Confirmed Strava sessions already
reach the race block and correlation explorer through entries; the
streams-quality upgrade waits for real connected-athlete data to validate
against.
