# 0VERTRAINED V12.0 — Lifting Fidelity + Intelligence

Two bundles: logging fidelity (RIR, set types, supersets, sticky notes) and
the intelligence built on top (RIR-effective e1RM trends with stall
detection, muscle recovery map). The set data shape gains OPTIONAL fields
only — every absent field means exactly the pre-V12 behavior, so historical
data and every existing consumer are untouched.

## Data shape (backward compatible by construction)

`workout.exercises[name].sets[]` gains two optional fields:
- `rir` — reps in reserve, "0"–"9", blank = not logged
- `type` — "straight" (default when absent) | "drop" | "myo" | "rp" | "partial"

Sticky notes and superset pairing are conveniences, not training data — they
live in localStorage (`ovt_exercise_notes_v1`, `ovt_superset_pairs_v1`, same
precedent as the race plan), device-local, losing them costs annoyance not
history.

## Logging fidelity

- **RIR everywhere sets are logged**: a new optional column in the grid
  logger (col headers now `lbs · reps · rir`) and in Session Mode rows.
- **Set types in Session Mode**: tap the set-number cell to cycle straight →
  DROP → MYO → R-P → PART. Non-straight sets render a bordered tag instead
  of the number.
- **Supersets in Session Mode**: "⇅ Superset with <next exercise>" on the
  A-side. While paired: finishing an A set jumps straight to B with **no
  rest**; finishing a B set starts the rest timer and hops back to A until
  A is done. The B-side shows a banner explaining the flow. Pairing is
  remembered per day-name (Tuesday's curls+pushdowns pairing survives to
  next Tuesday).
- **Sticky notes per exercise**: "▾ Note" in the Session Mode hero — seat
  positions, pin heights, cues. Persists across sessions; collapsed preview
  shows the first ~36 chars.

## Intelligence

- **RIR-effective e1RM** (`effectiveE1RM`): 8 @ RIR 2 was really a 10RM in
  the tank, so effective reps = reps + RIR (capped at 4 — beyond that
  self-report is noise). Falls back to plain Epley when unlogged. `epley1RM`
  moved to sessionIntelligence.js as its canonical home (TodayTab
  re-exports; ProgressTab's import path unchanged).
- **Lift intelligence** (Progress → Overview): your top lifts by session
  count, each with an e1RM sparkline, current estimate, 30-day delta, and a
  verdict — ↑ progressing / → stalled / ↓ regressing — comparing the best of
  the last 4 sessions against the prior 4 (±1%/−2% thresholds). Stalls get a
  concrete suggestion (deload ~10% or rotate to a variation); regressions
  point at recovery/sleep/cut depth before the program. Technique sets
  (drop/myo/rp/partial) are **excluded** from e1RM — they intentionally
  distort the load-rep relationship. Under 6 sessions it says "building,"
  not a fake verdict.
- **Recovery map** (Progress → Overview): days since each muscle was last
  trained (primary or secondary involvement, 21-day window) — 0-1d just hit,
  2-3d ready, 4d+ fresh. Answers "what's actually fresh today?" Reuses the
  V11 exercise→muscle map.
- **RIR-aware progression hints** (Session Mode): hit all reps with 3+ in
  reserve on every set → double jump; hit all reps but any set at RIR 0 →
  "repeat the weight and bank cleaner reps first"; unlogged RIR → exact
  pre-V12 behavior.
- **RIR-aware hard sets** (volume audit): completed sets logged at RIR 5+
  no longer count toward MEV/MAV/MRV volume — warm-ups by the athlete's own
  report. Unlogged RIR still counts.
- Grid logger's per-exercise ~1RM readout is now RIR-effective too.

## Deferred (stated in the plan, still true)

The **mesocycle volume progression planner** comes after RIR data has
actually accrued — planning weekly set ramps against completed-set counts
instead of true hard sets would bake the lower-fidelity signal in.

## Verification

76/76 test files, **1070/1070 tests** (+12: RIR-effective e1RM incl. the
cap, RIR-aware hint upgrades/holds/fallback, best-straight-set selection
with technique-set exclusion, building/progressing/stalled/regressing
classification, lift ranking, RIR 5+ volume exclusion, recency
primary/secondary distinction, notes trim/cap/clear, day-scoped superset
memory). Full quality gate green. APP_VERSION → V12.0.

## Files

Added: src/e1rmTrend.js · src/liftLogPrefs.js ·
src/LiftIntelligenceSection.jsx · src/__tests__/v12LiftingFidelity.test.js
Modified: src/sessionIntelligence.js (epley1RM canonical + effectiveE1RM +
RIR-aware hints + rirs in last-performance) · src/TodayTab.jsx (RIR column,
re-export, RIR-effective readout, todayName → SessionMode) ·
src/SessionMode.jsx (RIR, set types, supersets, sticky notes) ·
src/muscleVolume.js (hard-set rule + recency) · src/ProgressTab.jsx
(two new sections) · src/theme.jsx (setLine/colTag grids) ·
src/errorReporting.js (version)

## Device-review checklist

1. Grid logger: RIR column fits on your phone width without input squeeze —
   this is the one layout change to an everyday surface
2. Session Mode on arm day: pair curls with pushdowns, confirm the
   A→B-no-rest→B-rest→A flow feels like training, and that the pairing is
   remembered next week
3. Tap a set number through the type cycle; log a drop set and confirm it
   doesn't pollute the lift's e1RM row
4. Log RIR honestly for a session and check the next progression hint
   changes accordingly
5. Progress → Overview: do the stall verdicts match your gut on which lifts
   are actually moving?
