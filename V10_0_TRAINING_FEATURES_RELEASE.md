# 0VERTRAINED V10.0 — Training Features

All four training-track features. Same discipline as always: pure logic
modules with unit tests, display-only except where noted, no engine changes.
The single new write is the cardio runner's one-tap time log, which goes
through the existing `workout.cardio.time` path.

## 1 · Cardio session runner (`cardioSession.js`, `CardioSession.jsx`)

"Start cardio session →" in Today's cardio block opens the interval
counterpart to Session Mode:

- **Setup** — five presets (4×4min/3min · 8×1min · 30/30×10 · EMOM 10 ·
  Hyrox 8 stations) plus work/rest/rounds/warm-up steppers. **Pre-fills from
  the program's cardio notes** when they're unambiguous ("6x3min hard, 2min
  rest" → 6 rounds, 3:00/2:00). The parser is deliberately conservative:
  distance-based intervals ("6×800m") depend on pace it can't know, so it
  refuses rather than guesses — a wrong pre-fill is worse than none.
- **Running** — big serif countdown, WORK/REST state, round counter, a
  segment strip showing where you are in the whole session, pause/skip/end,
  and vibration cues on segment changes (progressive enhancement).
  Timestamp-based timing, so a backgrounded phone doesn't drift the clock.
- **Done** — elapsed total + "Log M:SS to today," writing through the
  existing cardio time field. Or close without logging.
- Lazy chunk (9.5 kB) like SessionMode — zero cost until opened. Final rest
  segment is dropped by design: sessions end on work, not on standing around.

## 2 · Warm-up ramp (in `sessionIntelligence.js` + Session Mode)

"▾ Warm-up ramp" disclosure in the Session Mode exercise hero: empty bar ×
10 → ~55% × 5 → ~70% × 3 → ~85% × 2 → work sets, every step rounded to 5 lb
with plate math per side. Steps that collapse together at light weights are
deduped; below 95 lb it doesn't render at all (bar work IS the warm-up).
Driven by the same working weight the plate-math line already uses.

## 3 · Exercise substitutions (`exerciseSubstitutions.js` + Session Mode)

"▾ Rack taken? Substitutions" disclosure: the exercise is keyword-matched to
one of 11 movement patterns (squat, hinge, horizontal/vertical press,
vertical pull, row, lunge, curl, triceps, lateral, calf) and returns 3-4
curated pattern-true swaps, each with a one-line stimulus note ("DB bench —
stability↑, expect ~20% less total load"). Deliberately conservative: same-
session equivalence only, never creative programming. Unknown movements
return nothing rather than a bad guess, and an exercise is never suggested
as its own substitute.

## 4 · Bodyweight trend (`weightTrend.js`, `WeightTrendFigure.jsx`)

Progress → Overview, below the correlation explorer. Classic exponentially
smoothed trend (Hacker's Diet convention, α = 0.1 per logged day) over your
Check-in weigh-ins: raw readings as faint dots, the trend as the line, with
current trend weight and **lb/week rate scaled by actual calendar days**
between trend points (logged days aren't always consecutive; pretending they
are inflates rates). Needs 5 weigh-ins before it claims anything. The
annotation says the quiet part out loud: daily swings are water and
glycogen; the line is you.

## Verification

74/74 test files, **1041/1041 tests** (+17 new: segment building, EMOM
zero-rest, plan clamping, notes-parser accepts/refusals, ramp
ordering/dedupe/threshold, substitution pattern-mapping/self-exclusion,
trend smoothing/rate-direction/minimums). Full quality gate green.
CardioSession confirmed as its own lazy chunk.

## Files

Added: src/cardioSession.js · src/CardioSession.jsx ·
src/exerciseSubstitutions.js · src/weightTrend.js ·
src/WeightTrendFigure.jsx · src/__tests__/v10TrainingFeatures.test.js
Modified: src/sessionIntelligence.js (+buildWarmupRamp) · src/SessionMode.jsx
(ramp + subs disclosures) · src/TodayTab.jsx (cardio runner wiring) ·
src/ProgressTab.jsx (trend figure placement)

## Device-review checklist

1. Thursday engine session: open the cardio runner, confirm the notes
   pre-fill (or preset pick), run a couple of segments — vibration on
   transitions, pause survives, segment strip advances
2. Log the elapsed time and confirm it lands in the cardio Time field
3. Session Mode: set a working weight ≥95, open the ramp — plate math per
   step should match your rack math
4. Substitutions on a couple of your PPL movements — do the notes read true?
5. Progress → Overview: with your weigh-in history, does the weekly rate
   match your sense of the current cut/bulk?
