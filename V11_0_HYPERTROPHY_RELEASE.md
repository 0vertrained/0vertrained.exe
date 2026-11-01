# 0VERTRAINED V11.0 — Hypertrophy Intelligence

Two bodybuilder-centered engines: a per-muscle weekly volume audit and an
adaptive (measured, not estimated) TDEE. Both are pure math over data already
logged — sets, calories, weigh-ins. Zero engine changes, zero new write
paths; the only persistence is the goal-rate preference in localStorage
(race-plan precedent). Targets are advisory: updating your actual macro
goals stays a deliberate act in Settings.

## 1 · Per-muscle volume audit (`muscleVolume.js`, `MuscleVolumeSection.jsx`)

Progress → Overview. The ACWR load model is correct for injury risk and
blind for hypertrophy — the unit of hypertrophy progress is weekly hard sets
per muscle, so:

- **Exercise → muscle mapping**, keyword-matched, first-match-wins across 12
  muscle groups. Primaries count 1.0, secondaries 0.5 (stated in the UI).
  Rule ordering handles the traps ("leg curl" → hamstrings, not biceps).
- **Weekly ledger** (Monday-start calendar weeks): each trained muscle gets
  a landmark bar — MEV tick, shaded MAV band, MRV tick — with the week's
  sets positioned on it, a delta vs last week, and a status word (below MEV
  / MEV–MAV / within MAV / MAV–MRV / above MRV). Headline surfaces flags:
  "Rear delts below MEV · Biceps above MRV."
- **Balance ratios** behind a disclosure: Push:Pull (≈1.0 or pull-heavy),
  Quad:Ham+Glute (≈1.0–1.5), Pressing:Rear-delt (≤3.0) — coaching
  heuristics, framed as such, flagged when out of band.
- **Honesty by construction:** landmark ranges are labeled as published
  population ranges (Israetel et al. / RP convention), not prescriptions;
  a hard set = a completed set (no RIR logging yet — stated); and unmapped
  exercises are counted and *surfaced* ("3 sets unmapped: Yoke Carry…"),
  never silently dropped. Needs a real lifting week (6+ completed sets)
  before it reports.

## 2 · Adaptive TDEE (`adaptiveTDEE.js`, `EnergyIntelligence.jsx`)

Fuel → Plan, above the meal plan. Closes the energy-balance loop the
smoothed weight trend (V10) opened:

- **Measured TDEE** = avg logged intake − (Δ smoothed-trend weight × 3500) /
  span days, over a 28-day window. Uses the trend line, never raw scale
  readings; days logged under 500 kcal are excluded as partial logs.
- **Readiness floors:** 5+ weigh-ins (trend), 14+ day span, 10+ fully
  logged calorie days — below any of them it says exactly what's missing
  instead of guessing. Confidence (high/medium/low) from logging density.
- **Goal rates** as chips (−1 / −0.5 / maintain / +0.25 / +0.5 lb/wk) →
  calorie target (TDEE + rate×3500/7, rounded to 10) + protein anchor
  (1 g/lb trend weight).
- **Drift check** with a ±0.25 lb/wk dead band: inside it, "hold the
  current intake"; outside it, a concrete ±kcal/day suggestion rounded to
  50. If your Settings calorie goal differs from the computed target by
  >100 kcal, it says so and points you at Settings — it never changes the
  goal itself.
- Verified against synthetic ground truth: flat trend at 3,000 kcal
  recovers TDEE 3,000 ± 60; a 1 lb/wk cut on 2,500 recovers ~3,000.

## Verification

75/75 test files, **1058/1058 tests** (+17: mapping correctness incl. the
leg-curl ordering trap, weekly counting with 0.5 secondaries, done-only
sets, unmapped surfacing, Monday week-splitting, landmark band boundaries,
ratio flagging, report deltas, TDEE ground-truth recovery on flat/cut
fixtures, readiness refusals, partial-day exclusion, target math, drift
dead-band both directions, goal persistence). Full quality gate green.
APP_VERSION bumped to V11.0 in error reports.

## Files

Added: src/muscleVolume.js · src/adaptiveTDEE.js ·
src/MuscleVolumeSection.jsx · src/EnergyIntelligence.jsx ·
src/__tests__/v11Hypertrophy.test.js
Modified: src/ProgressTab.jsx (audit placement) · src/FuelTab.jsx (energy
block + data prop) · src/App.jsx (data → FuelTab) · src/errorReporting.js
(version)

## Device-review checklist

1. Progress → Overview after a training week: does the ledger match your
   mental PPL+Arms count? Check the rear-delt and side-delt rows first —
   they're where real programs usually surprise people.
2. Any unmapped sets listed? Send me the names — the map is curated and
   grows by real examples.
3. Fuel → Plan: confirm Energy Intelligence shows readiness floors until
   your logging density crosses them, then sanity-check the measured TDEE
   against your own sense of maintenance.
4. Pick your current phase's goal rate and check the drift verdict against
   what your trend line has actually been doing.

## Known future work

RIR/RPE per set (turns "completed set" into a true hard-set count) ·
user-extensible exercise mapping · per-muscle volume trend charts across
blocks.
