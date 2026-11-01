# 0VERTRAINED v19.5.0 — Preset Lineup

More → Switch preset now lists five plans, one for each kind of athlete: Hybrid Athlete, Bodybuilding, Calisthenics, Runner, and The Double Edition as the aggressive two-a-day. Before this release it listed all ten presets in `constants.js`. Some of those had problems:
- **"Hybrid Athlete — PPL + Hyrox"** loaded `DEFAULT_PROGRAM`, an Upper/Lower plan with 2 runs. It had no PPL split and no Hyrox day.
- Three were personal or dated: Rami's cut, and the 50K build for a race on 8/28 that has passed.
- **Calisthenics — Absolute Beginner** couldn't be logged as written. 8 of its 15 exercises (Bodyweight Squat, Glute Bridges, Dead Bug…) asked for a weight before a set would bank.
- Program Builder plans made with "bodyweight" equipment have the same bug. Onboarding builds every new account's plan with the Builder, so it's fixed here too.

A separate reviewer read the change cold, twice. It found no blockers. What it raised and what happened is under "Review".

## The lineup

| Preset (id) | Week | Volume |
|---|---|---|
| **Hybrid Athlete** (`hybrid`) | Lower A (squat + power) · Upper A + easy run · Intervals · Lower B (hinge + single leg) · Upper B · Long run · Rest | 78 sets · 3 runs, 15.5 mi |
| **Bodybuilding** (`bodybuilding`) | Push · Pull · Legs · Rest · Upper · Lower · Rest | 109 sets; chest 16, back 18, quads 16, hamstrings 12 |
| **Calisthenics** (`calisthenics`) | Upper A · Lower A · Rest · Upper B (overhead + skill) · Lower B (hinge + power) · optional easy run or walk · Rest | 71 sets, bodyweight only |
| **Runner** (`running`) | Easy · Strength A + intervals · Easy + strides · Strength B + tempo · Rest · Long run · Rest | 5 runs, 24 mi · 30 sets |
| **The Double Edition** (`doubleEdition`) | AM heavy single-focus + PM pump six days; Sunday long run + long walk | 189 sets · 4 runs, 17.6 mi, plus 14.3 mi of walks |

- **Hybrid Athlete** is a new program. Its copy now describes what it loads.
  - The lower-body days sit away from the runs they would hurt. Monday's squats come after the rest day, the only hard run is 48h after them, and Thursday's hinge work is 48h before Saturday's long run.
  - The copy calls for a deload every 4th week: 30–40% fewer sets and every run easy. That matches the app's block planner.
- **Bodybuilding** trains every major muscle group on two days a week. Chest, back, quads and hamstrings get 12–18 hard sets each, counted the way the app's volume audit counts.
  - The main lifts use double progression: work up to the top of the range on every set, then add weight.
  - It has two supersets, cardio is daily steps, and every exercise has coaching notes.
  - It replaces a 1×/week bro split that had no notes.
- **Calisthenics** works for every level.
  - Each exercise carries a ladder from easiest to hardest, and every step logs the way its slot logs: no hold steps in rep slots and no rep moves in hold slots.
  - It needs a pull-up bar, with dip bars or two chairs as a help.
  - Holds are prescribed in seconds and log as holds. Every other movement logs as bodyweight reps, with optional added load for a vest or backpack.
  - It has three antagonist supersets: pull-up + dip, row + push-up, chin-up + archer push-up.
- **Runner** keeps most of its miles conversational, with intervals and tempo as its two quality runs.
  - Both strength sessions ride on those quality days, and the day before the long run is a rest day.
  - The strength work is heavy squats and RDLs, single-leg work, plyometrics, Nordics, calves and adductors.
  - If you add a race plan, it takes over every run and leaves both strength sessions in place.
- **Lifting days are named for their lifting** in all four rebuilt plans ("Strength A — Lower Body", "Upper A — Strength"). A race plan can move or drop a day's run but keeps a lifting day's name. Fuel and readiness advice read run words in that name as a run.
- **The Double Edition** keeps its program. The changes are:
  - its description, which now says it's the aggressive running + bodybuilding plan;
  - its tags, where "Running" replaces "Aesthetic";
  - two bodyweight moves that couldn't be logged without a weight (Hanging Knee Raise, Back Extension).

**Unlisted, not deleted:** Aggressive 2-a-Day Strength + Recomp, Rami · Aggressive Hybrid Cut, The Race Edition — 50K Build, Powerlifting and Beginner Full Body.
- A loaded preset is copied into the account's program, so anyone already on one keeps it.
- The old Hybrid program (`DEFAULT_PROGRAM`, Upper/Lower + 2 runs) is no longer in the picker either. It's still the plan for an account without one, the per-day fallback, and the demo's plan.
- Onboarding's legacy preset path still maps "strength" to Powerlifting.
- To list a preset again, add its id to `PRESET_LINEUP`.

## What changed in code
- **`src/constants.js`:**
  - the four rebuilt programs and The Double Edition's copy;
  - `PRESET_LINEUP`, the picker's list and order;
  - `presetProgram(id)`, which returns a preset's own program, or `DEFAULT_PROGRAM` for an unknown id.
  - The interval and tempo sessions carry `steps` in the V19.3 race-plan format. The cardio timer reads those before the notes, so it pre-fills the real warm-up (15 min) and main set. Strides are written out in words ("four 20-second strides") so an easy run doesn't pre-fill as an interval session.
  - Three bodyweight moves declare their tracking mode so they bank without a weight: The Double Edition's Hanging Knee Raise and Back Extension, and `DEFAULT_PROGRAM`'s Dead Bug. This is the only change to `DEFAULT_PROGRAM`.
- **`src/MoreTab.jsx`:**
  - The picker lists `PRESET_LINEUP`. Switch and preview use `presetProgram`, so the old "hybrid → `DEFAULT_PROGRAM`" special case is gone.
  - The session block shows a hold's target as seconds and a carry's as yards ("3×30s", "2×40 yd"), in the preview and the weekly program view.
  - In the program editor, rewriting a cardio block's type or notes drops its `steps`, so the timer reads the new notes. Changing miles or effort keeps them.
- **`src/App.jsx`:** the legacy onboarding preset path uses `presetProgram` too.
- **`src/onboardingSetup.js`:** a comment that described hybrid as the default program.
- **`src/programBuilder.js`:**
  - Library exercises tagged bodyweight that the logger can't recognize by name declare `trackingMode: "bodyweight_reps"`. That covers Bodyweight Squat, Inverted Row, Glute Bridge, Reverse Lunge, Sissy Squat and Dead Bug.
  - Holds keep the library's seconds; a plan's Plank was 12 s (the goal's rep band) and is 45 s now.
- **`src/progressionEngine.js`** (bodyweight only; loaded lifts are unchanged):
  - A bodyweight movement steps back to bodyweight, never below it. With nothing added, a pain flag or a stall used to prescribe "+5 lb" while saying "reduce load" or "step back". It now says to use an easier variation.
  - Hitting the target at bodyweight offers added load or a harder variation.
  - Moving up a calisthenics ladder step drops reps sharply at the same bodyweight. That no longer counts toward a stall; only a flat run of three exposures does.
  - Targets read "Bodyweight · 6 / 6 / 6", and session labels "BW×10/9/8", instead of "0 lb".
- **`src/coachEvidence.js`:** the Coach's exercise history passes the program's own exercise to `getExerciseSessions`, so a bodyweight set logged without a weight isn't dropped as a loaded set missing its weight. AM/PM days are read through `flattenProgramLifting`.
- **`src/muscleVolume.js`:** the volume audit places names that contain a chest keyword but train something else, checked before the chest rule:
  - Reverse Pec Deck and Rear Delt Cable Fly → rear delts;
  - Incline DB Curl → biceps;
  - Pike Push-Up and handstand work → front delts.

  Cable Y-Raise (side delts) and Hollow Body Hold, L-Sit and Dead Bug (abs) are now placed too. Before, Reverse Pec Deck and Incline DB Curl counted as chest in every program that has them, The Double Edition and Rami's cut included. The reviewer compared all 179 exercise names in the app: 11 moved, all correctly.

### Why some exercises declare a tracking mode
`resolveTrackingMode` reads holds, carries and bodyweight movements from the exercise name: plank, hold, wall sit or dead hang; push-up, pull-up, chin-up, dip or hanging leg raise. Anything else is a loaded lift, and a loaded set won't bank without a weight. The presets prefer names the logger already reads. Where none fits (Inverted Row, Pistol Squat, Nordic Hamstring Curl, Box Jump, Dead Bug, Back Extension…), the exercise declares its mode, which the logger reads first. A test pins every mode a preset uses to a real `TRACKING_MODES` value, since a misspelled mode would read as a loaded lift.

## Review
A reviewer read the diff cold, with the app's consumers listed but none of my conclusions, then re-checked the fixes. Neither pass found a blocker.

**First pass.** It raised eight should-fix items:
1. **Swapping into a planned movement carried one slot's loads into another's targets.** The pull-up notes suggested a lat pulldown, and Friday had a planned Lat Pulldown at 3×10.
   - Friday's is now "Neutral-Grip Lat Pulldown", and the Hack Squat note suggests a Smith squat rather than the leg press.
   - A test checks that a swap the notes suggest isn't a planned name.
   - The underlying behaviour is pre-existing; see Known nuances.
2. **A race plan left run names on lifting days**, so fuel and readiness advice read an easy or empty day as hard. Lifting days are now named for their lifting (the first fix still said "Run + Strength", which the second pass caught). A test runs every race-plan shape (3–5 runs, quality Monday to Thursday, all 12 weeks) through the real fuel and readiness advice.
3. **Rep ranges vs the engine.** `reps` stays numeric (the editor's field is a number input). The notes now describe what the engine does ("work up to 8, then add 5 lb"), Back Extension and Cable Crunch moved to 10–12, and a test pins each leading range's top to `reps`.
4. **Calisthenics ladders vs the engine.** Every ladder step now logs the way its slot logs. The engine changes above cover the bodyweight floor, the wording, and a ladder step-up no longer reading as a stall (also from the second pass).
5. **`DEFAULT_PROGRAM` can't be chosen any more.** Deliberate; noted above.
6. **The cardio timer misread easy runs** (strides as the workout) and gave intervals a 5-minute warm-up. Fixed with words for strides and `steps` for quality sessions.
7. **Coach evidence dropped bodyweight sets.** Fixed in `coachEvidence.js`.
8. **The Bodybuilding copy overclaimed** ("every muscle at 12–18 sets"), and the volume audit misplaced two of its exercises. The copy now says what's true, the audit is fixed, and the test counts with the audit's own mapping.

**Second pass.** It confirmed 1, 3, 6, 7 and 8. It checked the engine change against every caller (only Session Mode and its set composer read prescriptions; nothing else reads `kind`, `targetWeight` or `rationale`). It also confirmed that only the cardio timer reads `steps`. It raised:
- the editor keeping stale `steps` after the notes were rewritten;
- the ladder step-up read as a stall;
- "Run + Strength" names surviving a race plan that moves the run;
- The Double Edition's Hanging Knee Raise needing a weight (plus `DEFAULT_PROGRAM`'s older Dead Bug);
- the Coach's "0×" label;
- "Wall-Sit" mapping to abs.

All of these are fixed and tested.

- **Nits:**
  - Fixed: the deload copy, Builder planks, and "Per leg" notes, which now say "Per side" so Session Mode labels the field "Reps / side".
  - Kept and listed below: a declared mode surviving a rename in the editor, superset carry-over, the same name in two modes, and no backfill.

## Data / AI line
- No migrations, no schema changes and no new settings keys. Programs save in the existing shape: `trackingMode` and `pairNext` were already part of it, and the cardio `steps` use the race plan's existing run format.
- The Coach now sees bodyweight sets it used to drop for program exercises, labelled "BW×…". Nothing else about what the Coach sees changes, and Strava data stays out of AI Coach payloads.

## Validation
- **`presetLineupV19_5.test.js` (86).** Lineup and order; every listed preset has its own program; the unlisted ones stay defined. For all five plans:
  - seven days;
  - numeric sets and reps;
  - known tracking modes;
  - supersets with a partner and no chains;
  - exercise names unique within a day (a day's logs are keyed by name);
  - well-formed cardio;
  - a race plan replacing every run in all 12 weeks;
  - every bodyweight move banking with no weight (`DEFAULT_PROGRAM` too).

  For the four rebuilt plans:
  - coaching notes everywhere;
  - suggested swaps that aren't planned names;
  - rep ranges that top out at `reps`;
  - holds prescribed in seconds;
  - lifting days named without run words;
  - fuel and readiness advice that read the quality and long runs as hard and nothing else (through the real `buildNutritionRecommendation` and `suggestWorkoutAdjustments`);
  - under 12 race-plan shapes × 12 weeks, no hard or run advice on a day the plan didn't give it;
  - timer pre-fill that matches the notes, with nothing pre-filled for easy runs.

  Then each plan's promises:
  - **Hybrid:** 4/3/1 days, one quality run, no lower-body lifting the day before the quality or long run.
  - **Bodybuilding:** every exercise placed by the audit, every major group on 2+ days, 12–18 sets for the big four, sessions ≤ 24 sets.
  - **Calisthenics:** every set banks with no weight, added load still logs, no gym equipment, a ladder in every note with steps that fit the slot.
  - **Runner:** 5/2/2 days, strength only on quality days, rest before the long run, and both strength days kept exactly under a race plan.
  - **Double Edition:** ≥150 sets and ≥15 run miles with a quality run and an 8-mile long run.
  - **Builder:** every bodyweight plan (6 goals × 2 day counts × 2 levels) banks with no weight; in full-gym plans only library bodyweight movements carry a mode; holds keep their seconds.
- **`bodyweightSupportV19_5.test.js` (13):**
  - the engine at bodyweight: pain, stall, a ladder step-up, target hit, short of target, and stepping down from +5 lb;
  - loaded lifts keeping their floor;
  - Coach evidence with and without the program's mode, including AM/PM days and the "BW×" label;
  - the audit's new placements, and the rules around them unchanged.
- **`presetPickerV19_5.test.jsx` (8) mounts the real More tab.** It checks that:
  - the picker lists exactly the five in order;
  - the Calisthenics preview shows "3×30s";
  - the Hybrid preview shows its own week, not the default;
  - switching to Hybrid saves the Hybrid program;
  - switching with an active race plan keeps it and says so;
  - a plan's supersets are seeded on switch;
  - in the program editor, rewriting the notes drops the timer steps and changing the miles keeps them.
- **The tests fail on what they pin.** 33 reverts were each caught: every fix in this release and every fix from both review passes.
- **`npm test`:** 169 files · 2,020 tests passing (v19.4: 166 · 1,913).
- **`npm run quality:gate` is green.**
  - ESLint: 0 errors · 31 warnings (unchanged).
  - Production and demo builds, the dist secret scan and the deploy artifact all pass.
  - Entry chunk: 458.06 kB / 145.49 kB gzip (v19.4: 457.95 / 145.42).
  - The `constants` chunk grows to 61.22 kB / 16.42 kB gzip (was 47.54 / 12.57) with the fuller presets.
  - `sync:version` stamped `public/sw.js` → `ovt-shell-v19.5.0`.
- **Demo build in headless Chromium at 390px.** It showed:
  - the five-plan list and every preview, with no horizontal scroll and no page or console errors;
  - a switch to Calisthenics.
  - On Monday's Today, an Inverted Row set (reps only), a Hollow Body Hold set (seconds only) and a Pull-Up set (reps only) each banked with no weight entered.

## Known nuances
- **Progression follows the performed name, not the slot.** It is pre-existing and affects every program; the reviewer counted 29 such collisions in The Double Edition. There are two cases:
  - Swapping into a movement planned on another day (the substitution sheet offers "Leg press" for any squat) shares that movement's history.
  - The engine prescribes from the last exposure whatever its rep target, so a heavy low-rep exposure sets a high-rep slot's load. Making targets rep-aware (scaling by e1RM) is the real fix and is engine work.
- **Calisthenics ladders share one name per slot.**
  - After a step up, the target stays the slot's top rep count, so the engine asks you to work back up to it. That matches the ladder.
  - A flat run of three sessions at bodyweight suggests an easier variation.
- **Logs follow the exercise name across plans.** "Bulgarian Split Squat" is bodyweight in Calisthenics and loaded (DBs) in Hybrid and Runner. A bodyweight set logged without a weight doesn't count toward the loaded version, and loaded history shows as "+ lb" on the bodyweight one.
- **A declared tracking mode stays with the exercise if you rename it in the editor.** Dropping it would make a renamed bodyweight move demand a weight, which is the worse failure. So Box Jump renamed to Power Clean banks without a weight until you delete and re-add it.
- **Supersets carry over between presets.** Seeding only adds pairs, so a pair seeded by one preset stays when you switch, if the next preset has the same exercise on that day.
- **Readiness advice reads any cardio as a run day.** A race plan's vest walk gets "Protect the run load" at a high load ratio. That's pre-existing in `adaptiveTraining.js`.
- **The strength-retention alert** compares e1RM, so it only sees bodyweight work done with added load. That's unchanged.
- **AM/PM cardio** (The Double Edition) logs to `workout.cardioSessions`. Progress summary, streak, Coach evidence, weekly review and CSV don't read it yet (known since v19.3). The four single-session plans don't have this gap.
- **Today's set header** still shows "3×30" for a hold; its column is labelled "sec". The program views add the unit.
- **No backfill.** Programs saved before v19.5 keep their exercises as they were. Anyone on the old Calisthenics preset should switch to the new one, and a bodyweight Builder plan needs a regenerate (More → Generate plan).
- **The legacy onboarding path** isn't reachable from the current wizard, which always sends Builder preferences. It's covered through `presetProgram`'s tests, not a UI test, and it doesn't seed supersets.
- **Have a coach read the plans before you promote them.** They follow mainstream programming: 2×/week muscle frequency, polarized running and heavy strength work for runners. They were still written by an AI.

## Files
Modified:
- `src/constants.js`, `src/MoreTab.jsx`, `src/App.jsx`, `src/onboardingSetup.js`
- `src/programBuilder.js`, `src/progressionEngine.js`, `src/coachEvidence.js`, `src/muscleVolume.js`
- `package.json` (19.5.0), `public/sw.js` (`ovt-shell-v19.5.0`)

New:
- `src/__tests__/presetLineupV19_5.test.js`, `src/__tests__/bodyweightSupportV19_5.test.js`, `src/__tests__/presetPickerV19_5.test.jsx`
- `V19_5_0_PRESET_LINEUP_RELEASE.md`

`netlify.toml` and `package-lock.json` are untouched.
