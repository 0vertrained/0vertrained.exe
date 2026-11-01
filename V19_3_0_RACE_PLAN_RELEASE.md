# 0VERTRAINED v19.3.0 — The Race Plan (generator + paces)

## What changed

### Race-plan generator (`src/runPlanGenerator.js`)
- The general form of the hand-written 50K ladder. Inputs: race distance (5K / 10K / half), race date, start Monday, runs per week (3–5), long-run day, hard-run day, optional cross-training walk (incline or weighted vest), the longest run you can do comfortably today, an optional recent result, and a 5K test (start of build / a date / none).
- Output is the exact config shape `raceBuild.js` already resolves, so the Monday-anchored resolver, back-logging and the editor's raw-template rule are unchanged. Only the spec is stored (~400 bytes in `program.__raceBuild`); weeks are derived on read and cached.
- Phases: base → build → race-specific → race week. Lighter weeks every 4th week of base and build; the 5K test week drops the hard day to easy + strides with a rest day before the test; race week sharpens, rests the day before, and renders RACE DAY on the race's weekday.
- Every run is prescribed in **minutes** with estimated miles, so the load model, running volume, Box Score and the miles placeholder keep reading the `miles` field they always have. Runs also carry `steps` (warm-up / repeat / cool-down) for the session runner.
- Acceptance test: the hand-written 12-week 10K plan (start Mon 26 Oct, race Sat 16 Jan, 5K test on Thanksgiving, Wednesday vest walks) is reproduced exactly — every day's minutes, every session, every label. Weekly running minutes: 110 · 125 · 140 · 115 · 155 · 167 · 183 · 148 · 198 · 207 · 224 · 86.
- Plans of 6–20 weeks. Shorter than 8 weeks (10 for the half) is "compressed": it still generates, with a warning. Plans longer than 12 weeks add a by-feel fartlek from the second base cycle so nobody spends months on strides alone.
- Leg-day aware, suggest-only: the hard run is suggested on your heaviest leg day (hard days hard, easy days easy), never the day before or after the long run; heavy legs on or before the long-run day surface as warnings. **Lifting is never modified.**

### Pace engine (`src/runPaces.js`)
- Daniels & Gilbert VDOT equations, checked against the published tables (19:57 5K → VDOT 49.95 → 41:20 10K, table 41:21; threshold 6:51/mi, table 6:51).
- Easy 62–70% · threshold 88% · interval 98% · race paces from predicted race times. Seconds per mile throughout (the app logs miles).
- No result → no paces: runs carry effort cues (talk test, RPE) until the first 5K test. A wrong pace is worse than an honest effort cue.

### Resolver (`src/raceBuild.js`)
- `__raceBuild` may be a registry string (the 50K, unchanged) or a generated-plan object. `resolveRaceBuildConfig` handles both; generated configs are cached by content.
- Generated plans resolve to `pending` before their start Monday (the program is untouched) and to `complete` after race week.
- Plan patches — `{ run }`, `{ cross }`, `{ clearRuns }` — own running on all seven days while a plan is active: the program's own runs are replaced; walks, bike and lifting stay. AM/PM days: the plan's run takes the slot of the session that already ran (keeping its lifting and id), otherwise a RUN session is added first. Single-session days keep ONE cardio slot and are never split into sessions, so a logged plan run always lands in `workout.cardio` (see nuances).
- A day left with no lifting is named for its session ("Vest Walk", "Long Run") or becomes Rest.
- Idempotent and self-healing: plan-owned cardio (`planRole`) is stripped before every resolve, so a resolved program saved by accident re-resolves identically.
- `keepRacePlan` — switching presets or applying a Program Builder plan keeps an active race plan unless the incoming program brings a race build of its own.

### Surfaces
- **More → Training Plan:** a **Race plan** card on the hub (and `[ RACE PLAN ]` on the program overview) opens the race-plan panel (`src/RacePlanPanel.jsx`) — inputs, paces from a result, a live preview of exactly what Save stores, warnings. With a plan active, a Race plan block sits above the weekly program with `[ EDIT ]` / End plan. Save and End go through the normal program save path.
- **Today:** a race line at the top of the session ledger (`src/RaceWeekLine.jsx`) — "Race plan · week 3 of 12 / Base · 140 min of running this week / 66 days" (or "starts Mon, Oct 26" before the plan begins). Cardio headers show planned minutes and the pace target when there is one.
- **Progress → Race block:** with a plan, the countdown uses the plan's race (synced with the program, not localStorage) and its week replaces the generic phase note; edits go to the plan. The Hyrox station ledger is unchanged.
- **Cardio session runner:** reads the interval block from a run's `steps` (`suggestPlanFromSteps`) before falling back to the notes parser — which would read a plan's "10 min easy" warm-up as the rest interval.

### Data / AI line
- No migrations: the program payload is already JSON.
- Paces come only from results the athlete enters. Nothing in a plan is derived from Strava, so the Strava API Agreement's AI exclusion is untouched; the Coach sees today's resolved day exactly as before.

## Validation
- New tests: `runPaces.test.js` (15), `runPlanGenerator.test.js` (89 — the 12-week acceptance plan day by day + an 18-plan invariant grid: caps, nothing hard before the long run, lighter weeks lighter, safe week-to-week growth, determinism, JSON round trip), `raceBuildPlans.test.js` (37 — pending, legacy and AM/PM overlays, idempotency, race week, back-logging, immutability, the three whole-program iteration sites), `racePlanUi.test.jsx` (21 — Today line, panel draft → spec, preview, explicit save/end, Progress block, runner steps, minutes-first day labels, `keepRacePlan`).
- Visual check: the demo build driven in headless Chromium at 390px through More → Race plan → Start → Today → Progress (clock set to Tue 1 Dec, week 6). That pass added the hub's **Race plan** card (the program overview wasn't reachable from the hub without going through Switch → Back) and made plan runs read in minutes in Today's headline ("Lower A — Squat Pattern + Threshold Run · 42 min" instead of an estimated "4.1mi · Threshold"; `programSummary.js`, minutes-first only for cardio that carries `minutes`, so every older label is unchanged).
- Existing `raceBuild.test.js` and `raceEdition50k.test.js` pass unchanged.
- Full suite, every batch run (not stopping at the first failure): 161 files · 1,849 tests passing (v19.2.0: 157 files · 1,687). The only failures are the 3 pre-existing date-window tests in 2 files listed below, identical before and after.
- ESLint: 0 errors · 32 warnings — the same 32 as v19.2.0; none in new files.
- Production + demo builds green; entry chunk 450.65 kB / 143.19 kB gzip (v19.2.0: 434.99 / 137.50); dist secret scan clean; deploy artifact present. `sync:version` stamped `public/sw.js` → `ovt-shell-v19.3.0`.

## Known nuances
- **Pre-existing test failures (not touched here):** `coachingCalibrationV18_5.test.js` builds fixtures in May 2026 against a 90-day window measured from the real clock, and `ouraIsolation.test.js` writes July 2026 alert history that the pruner drops by age. Both started failing as the calendar moved on. `npm test` stops at the first failing batch, so batches 6–20 never run until these are fixed (pass a clock / use relative dates).
- **AM/PM programs:** plan runs on session days log to `workout.cardioSessions.*`, which the load model and running volume read but most other readers (Progress summary, streak, Coach evidence, weekly review, CSV) do not — a pre-existing gap for every AM/PM preset. Single-session programs are unaffected. Next release: route every reader through `getLoggedCardioBlocks`.
- The runner ends on the last rep; the cool-down is run as written (Phase 2 plays every step with targets on screen).
- A plan regenerates from its spec: editing inputs mid-plan reshapes all weeks, including past ones (logged entries keep their own data).
- More → Program's weekly list shows the base template by design; plan runs appear on Today.
- Progress → Program still shows the periodization Block (its own 4-week cycle) above the race block, so two week counters can disagree ("W4 deload" vs "week 6 of 12 · Build"). Next: while a race plan is active, the Block follows the plan's phases.
- Entry chunk grows +15.5 kB raw / +5.7 kB gzip: the generator and pace engine resolve on the eager App path (any program with a plan needs them on first render). Lazy-loading them would mean an App.jsx change and a flash of the template before the plan resolves.

## Deploy
Static deploy. No migrations, no env vars, no function changes.
