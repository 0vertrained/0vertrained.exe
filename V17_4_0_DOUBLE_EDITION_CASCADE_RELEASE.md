# 0VERTRAINED V17.4.0 — The Double Edition & The Cascade

The two-a-day program lands in the app, and intensity techniques become structure instead of notes.

## The Double Edition (program preset)

The full two-a-day plan as a selectable preset — six single-focus heavy mornings (Chest / Back / Quads / Shoulders / Arms / Hams-Glutes) with incline-walk finishers, six evening pump editions for a different muscle (~2×/week frequency by construction) with the day's run or walk, and Sunday as the engine day (long zone-2 run AM, long walk PM). Every session carries its cardio prescription; top sets are called out in the notes for the e1RM trends; the four PM supersets (Mon–Thu) are declared in the program itself.

**Naming rule, on the record:** the plan's working title referenced a public figure's training style. The in-app preset is named **The Double Edition** — the house's own newspaper vocabulary — because the product has no affiliation with, or endorsement from, any individual, and a personal name in the preset list would imply one. The training methodology (proximity to failure, single-muscle immersion, daily cardio) is generic exercise science; the name stays ours.

**Preset-declared supersets.** Program exercises may now carry `pairNext: true`. On preset apply, `seedSupersetPrefsFromProgram()` writes the sticky V12 pairing prefs for those weekday+exercise pairs — so Session Mode's A-side→B-side superset flow works on day one with zero taps. Seeding is additive only: it never unpairs anything the user set themselves.

## The Cascade (drop sets & rest-pause as structure)

**The discovery that shaped it:** Session Mode already had a set-*type* cycler since V12 (straight → drop → myo → r-p → partials, excluded from e1RM by `isStraightSet`). What was missing was anywhere to put the drops themselves. The Cascade is that layer: a set may now carry `segments: [{weight, reps}]` — the continuation work after the top effort — rendered as a hairline-connected figure under the set row (`100×12 ▸ 75×8 ▸ 57.5×10`).

**One capability, one entry point per surface.** In Session Mode the existing type-cycler *is* the entry point — set the type to DROP or R-P and the figure appears; cycling away strips stale segments. In TodayTab (which has no type UI) a quiet `+ drop · + rp` offer appears only on a completed, weighted set — zero clutter on the 95% case. Drop segments prefill at ~75% of the previous load rounded to 2.5; rest-pause prefills the same load.

**Safe by construction, not by patching:** the top effort stays in the set's own weight/reps fields, so e1RM exclusion (V12 law, re-pinned through the real series builder), hard-set counting (a drop set is ONE set taken past failure), and tonnage (top segment only — the honest comparable) all hold with zero changes to their modules. The model aligns to V12's type vocabulary (`"rp"`, not a new synonym).

## Verification

13-test suite `doubleEditionCascade`: preset integrity (seven AM/PM days, cardio in every session, Sunday lifts nothing, numeric sets/reps), the **no-personal-name source sweep** across all of `src/`, pairNext adjacency + the one-superset-per-PM sprinkle rule + seed count (4) + additive prefs, the cascade model (V12 vocabulary, 75%-rounding, segment lifecycle, summary figure, clear-restores-plain), e1RM exclusion through `buildE1RMSeries` with a real drop set, and the mounted figure in both modes with segment-edit flow. **142 test files passing, lint 0 errors (36-warning baseline held), both builds green, dist secret scan clean.** Static deploy, no migrations.

## Companion document

The full written program — weekly ledger (~16 chest / ~20 back / ~17 side-delt sets etc.), the governance mapping (Fresh → push · Accumulating → trim the PM · Deload advised → half-volume AMs and walks), progression rules, and the five-line evidence summary — was delivered separately as the training plan document. The preset is its in-app form.

## Flagged

- Myo-reps could reuse the segments structure (the cycler already offers the type); deferred until wanted.
- A per-segment micro rest-timer (10–15s) in Session Mode would be a nice touch for drops; deferred — the figure logs post-hoc cleanly today.
