# Strava Integration Plan — From Import to the Ledger

Plan date: 2026-07-10
Scope: design only (no code in this doc's release). Companion to `PROVIDER_INTEGRATION_STANDARD.md`.
Context: V13.2 · Strava OAuth + sync are live server-side; this plan makes the imported data do something.
Status: **Phases 1–2 and the Phase 3 webhook shipped in V13.3** (see `V13_3_STRAVA_LEDGER_RELEASE.md`). Remaining: Phase 3 streams (HR-TRIMP load upgrade, 80/20 polarization figure).

---

## 0 · Where it stands (verified against the codebase)

The server half is done. `netlify/functions/strava-auth.js` handles auth / callback / status / sync / disconnect / counts / events, pulls `athlete/activities`, quarantines raw payloads, logs `wearable_sync_events`, and upserts normalized rows into `public.activities` (columns: `source_provider`, `provider_activity_id`, `start_time`, `sport_type`, `title`, `duration_sec`, `distance_m`, `elevation_m`, `avg_hr`, `max_hr`, `avg_power`, `calories`, plus per-row `ai_eligible` / `ai_exclusion_reason`). RLS policy `activities_select_own` means the client can read its own rows directly — no new endpoint needed.

The client half is a dead end: **the only consumer of Strava data today is the Settings counts box.** Nothing reads the `activities` table in `src/`. A run imported from Strava currently changes nothing on Today, nothing in the load model, nothing in Progress. That's the gap this plan closes.

The policy half is already encoded and correct: `providerRegistry.js` marks Strava `role: "activity"`, `aiEligibleDefault: false` with reason `STRAVA_API_TERMS`, streams `optional_lazy`, webhooks supported.

## 1 · Constraints that shape the design (Strava API Agreement)

These are load-bearing, not fine print — the 2024 agreement update tightened all of them:

- **Athlete-only benefit.** Strava data may only be used for the authenticating athlete. Moot for a single-user ledger, but it rules out any future social/leaderboard surface using Strava rows.
- **No AI/ML.** Strava data must not be fed to AI models. The registry already excludes it from Coach; §3.4 defines exactly where the line sits once Strava starts influencing derived numbers.
- **Attribution.** Anywhere a Strava activity renders, it needs Strava attribution and a link back to the activity (`https://www.strava.com/activities/{provider_activity_id}`). Plan: the existing `sourceTag` primitive renders `STRAVA`, and any activity row gets a "View on Strava →" nav link. Surfaces that list Strava data (Settings, any activity list) carry the "Powered by Strava" mark.
- **Deauthorization must purge.** When an athlete revokes access (from Strava's side), the app must delete their Strava data. §5's webhook handles this; until then, disconnect-in-Settings already deletes, and the sync path surfaces token death as an `error`-severity state.
- **Rate limits.** Default app limits are on the order of ~100 requests / 15 min and ~1,000 / day. Consequence: no per-activity fetch loops, streams only on demand (§5), and webhooks preferred over polling once live.

## 2 · Design principle

Strava sits on the **strain side of the ledger only**. It carries no sleep, HRV, or recovery signal, so it never touches the recovery blend — it feeds *what you did*, not *how you absorbed it*. And the house rule from `wearableWorkoutLoad.js` extends unchanged: **manual is canonical.** Strava fills gaps and annotates provenance; it never overwrites a number the athlete typed.

Strava's unique value over Whoop/Oura on this side: ground-truth outdoor cardio — real distance, pace, and elevation per workout — where Whoop gives day-level strain and Oura gives day-level activity calories. For a Hyrox athlete, the runs are exactly the sessions most likely to happen outside the app.

## 3 · Phase 1 — Cardio ledger + load model (the payoff)

### 3.1 Client read path
New `src/strava/activities.js`: `loadStravaActivities({ sinceDays })` → supabase select on `activities` where `source_provider = 'strava'`, date-windowed, mapped to a light shape (`date`, `sport`, `miles`, `minutes`, `paceSecPerMile`, `elevationFt`, `avgHr`, `stravaId`). Cache alongside oura/whoop data in `appDataCache` with the same stale-while-revalidate contract. One query per app load — rate-limit-free (it hits Supabase, not Strava).

### 3.2 Day merge — auto-fill the cardio ledger
The daily entry shape is `workout.cardio = { miles, time, pace, notes }`. Merge rule per day:

| Condition | Behavior |
|---|---|
| Manual cardio non-empty | Untouched. Strava activity shown as context row only ("also on Strava: 5.1 mi · 41:32 · View on Strava →"), not double-counted. |
| Manual cardio empty, Strava run/ride exists | Cardio fields prefill from Strava (summed if multiple same-sport activities), rendered with `sourceTag STRAVA` and a provisional treatment (`ProvisionalTag`-style) until the athlete confirms or edits. Editing any field flips provenance to manual. |
| Plan completion | A Strava-prefilled session counts toward **load** immediately (the work happened) but counts toward **plan completion** only after a one-tap confirm — keeps "did I follow the plan" an athlete's statement, not an import's. |

### 3.3 Load model — `stravaLoadForDay` in `wearableWorkoutLoad.js`
Same conservative-bridge pattern as `whoopLoadForDay` / `ouraLoadForDay`, on the existing scale (Oura fill uses miles×45):

- Run/walk/hike: `miles × 45 + elevationFt × 0.045`, capped.
- Ride: `miles × 14 + elevationFt × 0.03`, capped.
- Other moving sports: `minutes × 5`.
- Confidence `medium` (real per-workout distance beats day-level fills); upgraded to HR-TRIMP in Phase 3 when streams exist.

Fill priority for a day with no manual workout becomes: **Strava → Whoop strain → Oura activity.** Same-workout dedupe versus Whoop: if a Whoop workout starts within ±20 min of a Strava activity, count once — Strava supplies the load magnitude (it has distance), Whoop corroborates in the notes. This keeps ACWR honest when both devices captured the same run.

### 3.4 The AI line (hard rule)
`ai_eligible = false` travels with every Strava row, and the registry already answers `shouldExcludeProviderFromCoach('strava') → true`. What Phase 1 must add is enforcement at the two payload builders, because neither currently knows Strava exists:

- `src/wearables/snapshot.js` and `src/coachContextBuilder.js` filter `source_provider === 'strava'` rows and any strava-attributed components (titles, distances, paces, per-activity fields) out of `wearableSummary`.
- Day-level **derived** numbers — the blended readiness index, ACWR — are app-computed "mixed" data and stay coach-eligible even when Strava gap-filled a load day. The line: *no Strava field ever appears in a coach payload; Strava may influence an app-derived aggregate.* This mirrors the registry's `MIXED` provider being `aiEligibleDefault: true`.
- Regression test: build a coach context from fixtures containing Strava rows → assert the serialized payload contains no strava provider tags, activity titles, or distances.

### 3.5 Phase 1 tests
Mapping math (each sport formula, caps), merge rules (manual-canonical, no-overwrite, provenance flip on edit, multi-activity summing), ±20 min Whoop dedupe window, plan-completion confirm gating, and the §3.4 coach-exclusion test.

## 4 · Phase 2 — Surfaces

- **Progress:** weekly mileage and pace-trend sparklines via the existing `Figure.jsx` / `TrendCharts` plumbing; long-run-per-week row. Every rendered activity row carries the Strava link (§1 attribution).
- **Race block (Hyrox):** running volume vs the block's plan, plus a pace-decay figure across the week as a compromised-running proxy. A pace-zone 80/20 easy-hard split is possible in this phase from summary pace alone (threshold-pace estimate); the HR-true version waits for streams.
- **Correlation explorer:** expose weekly mileage, run count, and average pace as N=1 variables. Athlete-facing analytics for the athlete's own benefit is squarely inside the agreement; these variables still never enter the coach payload.
- **Recovery dashboard:** one strain-side context row ("External cardio · 14.2 mi this week · STRAVA") — display only, never a recovery input.

## 5 · Phase 3 — Streams + webhooks

- **Streams (`activity_streams`, already migrated):** lazy fetch of `heartrate,time,velocity_smooth` only for activities ≥ 20 min and only on demand (opening the activity's figure), respecting the rate budget. Unlocks real HR-TRIMP load (replacing §3.3's distance proxy at `confidence: high`) and a true zone-distribution / polarization figure — the 80/20 adherence check.
- **Webhook (`netlify/functions/strava-webhook.js`):** subscription validation (`hub.challenge` echo), `activity` create/update events trigger a targeted one-call sync, and the **`deauthorize` event purges** tokens, `activities`, `activity_streams`, and raw-payload rows for that user, logging a `wearable_sync_events` entry. This is both the compliance requirement from §1 and the end of polling pressure.

## 6 · Field mapping

| Strava API | `activities` column | App usage |
|---|---|---|
| `sport_type` | `sport_type` | merge routing (run/ride/other), load formula |
| `start_date` | `start_time` | day bucketing, Whoop dedupe window |
| `moving_time` | `duration_sec` | cardio `time`, load minutes |
| `distance` | `distance_m` | cardio `miles`, load, mileage trends |
| `total_elevation_gain` | `elevation_m` | load bump, race-block context |
| `average_heartrate` / `max_heartrate` | `avg_hr` / `max_hr` | Phase 3 TRIMP, zone split |
| `id` | `provider_activity_id` | "View on Strava" link, dedupe key |
| `name` | `title` | display only — never in coach payload |

## 7 · Sequencing

Phase 1 is one focused release: `strava/activities.js`, the Today/cardio merge, `stravaLoadForDay` + priority/dedupe, the two payload-builder guards, and the test set — the same shape as the V12.2 wearable-snapshot slice. Phase 2 is a figures release riding existing chart plumbing. Phase 3 is a server release (webhook + streams) that also upgrades load confidence. Each phase ships independently behind the existing gate.

## 8 · Open calls (product decisions, defaults proposed)

1. Prefill-confirm UX (§3.2): proposed one-tap confirm before a Strava session counts as "plan followed." Alternative: auto-count and allow dismiss.
2. Non-run sports in the Hyrox race block: proposed load-only (rides/hikes feed ACWR but not run-volume figures).
3. Backfill depth on first connect: proposed 90 days (three ACWR chronic windows) — the sync endpoint already takes `days`.
