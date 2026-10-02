# 0VERTRAINED V14.2 — Load-Path Performance (P0 slice)

Executes the P0 tier of the performance plan. Zero schema changes; every fix is a deletion, a reorder, or a dedupe. Ships with instrumentation so the wins are measured on real devices, not asserted.

## The baseline this replaces

A traced cold boot with all providers connected was firing **four wearable-status function invocations** (App's Oura chain + TodayTab's Oura/Whoop/Strava probes — each ≈ 3–5 backend round trips including possible token self-heal) and fetching the **14-day Oura dataset twice, raw heartrate time-series included both times** (~150–500 KB apiece, estimated). Opening Recovery then re-ran the whole thing with the same `/api/oura/status` endpoint invoked twice back-to-back and a sequential depth of ~5.

## What changed

### Instrumentation first (`src/perf.js`, Settings → About → "Fig. D · Load diagnostics")
`performance.mark`-based run tracking for the three hot paths (boot / today / recovery), each mark recording elapsed ms, fetch/XHR round-trip count, and transfer KB where the browser exposes it (cross-origin responses without Timing-Allow-Origin read 0 — round-trip count is the reliable column, and the UI says so). Last 12 runs persisted; Clear button included. Baseline runs from your current v14.1 install will still be visible after upgrading if you check Diagnostics before the new code's first runs displace them — capture a screenshot first if you want the before/after side by side.

### Dedupe layer (`src/asyncMemo.js`)
Two primitives: `singleFlight` (concurrent callers share one in-flight promise; zero staleness change) and `memoizeAsync` (single-flight + short TTL; rejections never cached; `.invalidate()` escape hatch).
- `isOuraConnected` / `isWhoopConnected` / `isStravaConnected` are now memoized at 60s — App, TodayTab, and Recovery share one probe instead of firing four. Disconnect flows invalidate immediately.
- `loadOuraData` / `loadWhoopData` gained **keyed** single-flight (per `days` window, since callers use 7/14/30) — identical concurrent fetches collapse; sequential ones still refetch.

### Boot reads the snapshot, not the pipeline (`App.jsx`)
The Today-header recovery score now comes from the persisted wearable snapshot when it's from today — which holds the *bit-identical* number, since `calcOuraRecovery` is `calcRecoveryScore` aliased — at **zero network cost**. Otherwise: one trimmed direct `oura_data` query (an empty result means "not connected", so the status invocation is gone from boot entirely).

### Raw heartrate stays on the server (`src/oura/dataLoading.js`)
The client select now filters to `sleep, readiness, activity, spo2`. Raw heartrate payloads' only consumer was an `array.length` debug count ("HR samples") — the quality score never used it. The row is removed from the Recovery quality panel; the return field stays (always 0) for shape stability. The server-side snapshot path already excluded these payloads for size; the client now matches.

### Recovery waterfall collapsed (`RecoveryDashboard.jsx`)
- Oura: the duplicate `isOuraConnected()` pre-check is gone; `getOuraTokenStatus()` and `loadOuraData(14)` fire **in parallel** (the data query needs no status — a disconnected user gets an empty result from one cheap indexed select). Sequential depth on the Oura leg: 3 → 1.
- Whoop: same shape — one `Promise.all` of status + data + events replaces the status-gated chain.

## Expected movement (verify in Diagnostics)
Boot round trips on the wearable path: ~6+ invocations/queries → 1–2 (0–1 on snapshot-fresh days). Recovery-open sequential depth: ~5 → 2. Oura transfer per fetch: minus the entire heartrate series. Real numbers land in Fig. D after a few sessions — that's the point of shipping P0-4 first.

## Not in this release (by design)
Windowed entries loading and the v33 index migration are V14.3 (the plan's P1 tier) — kept separate so this release stays schema-free and the entries change gets its own regression pass.

## Deployment
Standard deploy, no migrations, no new environment variables. Nothing here changes provider auth or token handling.

## Validation
Full quality gate: 115 test files (11 new: asyncMemo single-flight/memo/rejection semantics, perf mark/persist/trim/corruption handling), lint 0 errors, production + demo builds, secret scan, deploy artifact — all green.
