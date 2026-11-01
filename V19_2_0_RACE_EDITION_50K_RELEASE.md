# 0VERTRAINED v19.2.0 — The Race Edition (50K) + Race-Build Resolver

## What changed

### The Race Edition — 50K Build (supersedes the unreleased v19.1 25K preset)
- Rewritten for the corrected race distance: a five-week emergency build to a 50K on 2026-08-28 from a minimal running base.
- Survival architecture: 3/2 run-walk from the first interval, back-to-back weekend sessions (Saturday long + Sunday B2B walk), time caps over distance targets, and fueling treated as a trained skill (30–60g carbs/hr from week 1, sodium protocol from week 3).
- Lifting reduced to two upper maintenance days (Pull Wed, Push+Arms Fri, ≤15 sets) with calves folded into Pull day. All axially loaded leg work removed — enforced by test — because a 0→50k ramp cannot afford the recovery cost or injury surface.
- Monday is the hard rest day after the weekend double; Thursday Z2 stays readiness-gated by wearable trend.

### Race-build resolver (`src/raceBuild.js`)
- New pure module: `RACE_BUILD_50K` ladder config, `resolveBuildWeek` (Monday-anchored date → week index, clamped before the ladder, "complete" after race week), `applyRaceBuild` (overlay), and `describeBuildWeek` (label + countdown for future UI/coach surfaces).
- A program opts in via a `__raceBuild: "<configId>"` string key — JSON-safe, verified harmless through every whole-program iteration site (periodizationPlanner, coachEvidence, liftLogPrefs are all defensively guarded).
- Weekly ladder: 10k → 16k → 21k → 28–30k/4h peak → 12k taper → race week. Tuesday and Sunday advance alongside Saturday.
- Race week renders itself through full-day overrides: Wednesday rest, Thursday shakeout, **Friday becomes RACE DAY — 50K**, Saturday post-race rest, Sunday recovery walk.
- The ladder owns Tue/Sat/Sun cardio while a build is active; overlay is idempotent and self-healing if resolved values ever get baked into a save.

### App wiring
- `App.jsx` derives `liveProgram = useMemo(() => applyRaceBuild(program, todayKey))` — resolved against `logDate || today`, so back-logging a past day shows that week's prescription.
- All consuming surfaces (Header, TodayTab, BaselineBanners, ProgressTab, Coach) receive the resolved program; **MoreTab keeps the raw template** so edits and previews target the source of truth. Editor drafts deep-clone the whole object, so the `__raceBuild` marker survives edit → save round-trips; `saveProgram` upserts the payload untouched.
- Known nuance: ProgressTab views of past weeks render against the current week's overlay (cosmetic; logged entries carry their own data).

## Validation
- New `raceBuild.test.js`: 18 passed — Monday anchoring, the full week map across the real calendar (incl. race day and the Sunday after), clamping, completion, per-week overlay swaps, race-week overrides, idempotency, no-op reference equality, template immutability, countdown descriptor.
- New `raceEdition50k.test.js`: 9 passed — shape, day counts, registered marker, no-axial-leg-work invariant, set caps, long-day detectability, fueling notes.
- Full suite via `npm test`: 157 test files passed.
- ESLint: 0 errors; 7 pre-existing warnings in untouched App.jsx effects; new files clean.
- `sync:version` stamped `public/sw.js` → `ovt-shell-v19.2.0`; `versionSync` gate green.
