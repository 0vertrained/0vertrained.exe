# 0VERTRAINED V17.5.0 — The Box Score & Ghost Taps

The workout-tracking pass: the highest-frequency interaction drops from typing to one tap, and the peak-emotion moment finally tells a story.

## Ghost taps
A single tappable chip — `⌁ 185 × 8 · tap to fill · last time · Jul 13` — sits under the **first empty set only** (fill it and the chip moves on; never a column of repeated suggestions), on both TodayTab and Session Mode. Fill priority mirrors how lifters think: **carry** (your previous set today, "from set 2") → **last time, same set slot** (set 3 vs set 3 — where fatigue history lives) → last time's final set. Explicit tap only — tapping ✓ on an empty row still logs nothing, so a phantom weight is impossible. The chip names its source; a suggestion you can't audit is a suggestion you can't trust. New pure module `setGhosts.js` (getLastPerformance aggregates; ghosts needed the raw per-slot sets).

## The rest glance
The rest bar now answers the only question a resting lifter has: `Next · set 3 of 4 · last time 185×7` — set-granular, or the next exercise name at exercise end, or "Last set banked." Nobody navigates away mid-rest.

## Skip-with-reason
"skip this exercise…" → equipment / fatigue / time → recorded on the entry, auto-advance, undoable from the Today card's tag. **Skipped exercises count as handled in the completion detector** — the Box Score fires on honest sessions, not only perfect ones.

## The Box Score (SessionComplete rewritten)
Headline by strict priority (**PR → strength arrow → tonnage jump ≥10% → first-on-record → "Session banked."**), then: tonnage vs the last **same-weekday** session with the delta · PRs judged against ALL history with **straight sets only on both sides** (a drop-set "PR" is not a PR — pinned) · e1RM direction arrows · sets banked per muscle with the weekly landmark position ("Chest · 6 sets · 14 this week · 8–22 range") · skips named · the MethodLine stating the comparison basis. Honest degradation: a first same-day session gets no fake deltas — "First Push day on record — the baseline is set." Interaction: backdrop or Close dismisses; **the card never does** (no accidental dismissal mid-read).

## The finisher handoff
When the day's prescribed cardio is unlogged, the Box Score offers one tap: "Log the finisher — Incline Walk · 1.2 mi" — writing the prescribed distance to the **active session's** cardio slot (AM/PM-aware via `activeCardioSession`), with the honest caption "add your time on the day card whenever."

## A real bug the tests caught
**"Incline DB Press" — The Double Edition's Monday chest anchor — matched no rule in the muscle map** and banked zero chest volume in the audit. The chest rule now includes `incline press / incline db / incline dumbbell`, ordered so "Seated DB Shoulder Press" keeps its own rule. If you ran the preset before this release, this week's chest count self-corrects on next open.

## Verification
12-test suite `boxScoreGhosts`: the ghost priority matrix, one-chip placement, the glance's three states, the headline priority ladder, same-weekday basis, the drop-set-PR exclusion, secondaries-at-half banking with the unmapped guard, first-record honesty, mounted chip/score/finisher with propagation semantics, and the wiring guards. Two gate catches fixed en route: the Box Score card now honors the `--ovt-content-width` shell contract, and the superseded `prCount` state was removed (lint warning baseline actually dropped 36 → 34). **144 test files passing, lint 0 errors, both builds green, dist secret scan clean.** No migrations.
