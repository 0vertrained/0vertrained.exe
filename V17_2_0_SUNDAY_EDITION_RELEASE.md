# 0VERTRAINED V17.2.0 — The Sunday Edition

Third release of the V17 arc. The retention ritual: reflect → plan → return. Every Sunday at 5pm (through Monday night), a line appears above the Recovery verdict — **"The Sunday Edition is out · read it →"** — and opens the weekly broadsheet. No new nav items; the populated layouts are untouched.

## The anatomy (strict order, enforced by test)

1. **Masthead** — "The Sunday Edition · № 14 · Jul 6 – Jul 12," numbered in weeks since your first logged day.
2. **The week in recovery** — seven columns (day, score, state name), the week's score line with its rolling overlay, transitions narrated in one sentence ("Mostly steady; Steady → Accumulating fatigue on Fri, back on Sun"), and the reconciled sleep-debt row. MethodLine: *"each morning scored and classified exactly as it was that day — nothing re-graded in hindsight."*
3. **Load ledger** — seven bars in the V16.7 effort-minutes currency, week total vs prior week, the zone stamp.
4. **Volume digest — exceptions only.** Muscles inside their productive range collapse to one line ("9 of 11 in range"); only genuine exceptions itemize, in plain words ("past the ~22-set recovery ceiling; extra sets are subtracting now").
5. **Fuel week** — days logged, protein average vs target with adherence, measured burn with its ledger method.
6. **Divergence diary** — the days your check-in disagreed with your metrics, each with its verdict a day later: *"Your body was right — the score followed it down,"* or *"The metrics held — the rough morning passed."* This is where the subjective row earns its keep.
7. **THE ONE CHANGE** — the single full-ink plate on the page. One prescription, resolved in strict priority (recovery state > sleep debt > volume exception > protein > run it back), with its reason and its method printed under it. One, never a list — pinned by test.
8. **Footer** — "Next edition Sunday."

## The model (`src/sundayEdition.js`)

Pure and deterministic: composes the Morning Edition state machine (per day, as-of that morning — no hindsight re-grading), `buildDailyLoads(asOf)`, the volume landmarks, the adaptive TDEE ledger, V16.9's reconciled sleep-debt inputs, and the check-in divergence notes. The publish window (`editionWindow`) is pure of the clock via injected `now` and pinned boundary-by-boundary: Sat 23:59 no, Sun 16:59 no, **Sun 17:00 yes, Mon 23:59 yes**, Tue 00:01 no — always covering the Mon–Sun week that ends that Sunday.

**Honest degradation throughout:** thin weeks open with *"Thin week on the record — 3 of 7 days logged, 5 wearable mornings. Read the calls above with that in mind,"* and empty sections say so in one line rather than faking completeness.

## Two rules calibrated against the real export

**The intent rule.** `classifyVolume` marks 0-set muscles below-MEV — right for the Progress *audit* (show everything), wrong for a weekly exceptions feed: an untouched muscle is a program-design choice, not a weekly slip, and "Forearms: 0 sets" every Sunday is noise wearing an exception's clothes. The edition's below-MEV rung now requires the muscle to have been touched (≥1 set); above-MRV always qualifies.

**The ends-strained rule.** First build of the real week (Jul 6–12) prescribed a half-volume open because Fri+Sat classified Accumulating — but Sunday recovered to Steady at 88. Fatigue that clears by Sunday is an absorbed weekend, not a mandate. The recovery rung now fires only when the week *ends* strained (last morning in a fatigue state, or deload twice in the final three). Recalibrated, the same real week resolves **run-it-back** — the correct call.

## Verification

Real-export build for Jul 6–12: timeline `Mon 88 · Tue 82 · Wed 88 · Thu 94 · Fri 87 Accumulating · Sat 75 Accumulating · Sun 88 Steady`, five transitions narrated, sleep 3.5h Mild against the 7.6h baseline, ONE CHANGE = run-it-back, and the caveat correctly flagging zero logged entries against seven wearable mornings. 22-test suite `sundayEdition`: six window boundaries, golden determinism, edition numbering, the full priority matrix (each rung beating everything below it), exactly-one-change, the intent rule, thin-week honesty, the model-wide no-z-score guard, anatomy-order and masthead-wiring source guards. **139 test files passing, lint 0 errors, both builds green, dist secret scan clean.** Static deploy, no migrations.

## Next in the arc

V17.3 — The Courier: scheduled pushes carrying headlines ("Morning edition: Absorbing load. Green for Pull."), state-transition alerts, and the Sunday edition announcement. Requires the `push_subscriptions`/`push_state` tables per the plan's decision #4.
