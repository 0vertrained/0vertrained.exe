# 0VERTRAINED v18.0.0 — Set Flow

Workout logging is now built around the set being performed, not a spreadsheet row.

## Current Set composer
- Replaced the primary mobile logging interaction with a large one-thumb current-set workspace.
- Added step controls for load, reps, assistance, duration, and distance with direct numeric editing preserved.
- Added fast RIR chips, repeat-previous-set, progression-suggestion fill, ghost fill, set-type cycling, and an interactive set ledger.
- Narrow layouts stack the two entry controls so three-digit loads remain fully readable down to 320 px.

## Exercise-aware logging
- Added shared tracking modes for loaded reps, bodyweight reps, assisted reps, timed holds, and carries.
- Completion validation now matches the movement: loaded work requires load and reps, timed work requires duration, carries require load and distance, and bodyweight work does not invent external load.
- Existing history remains compatible; new fields are optional.

## Resume and completion correctness
- Session Mode resumes the first incomplete exercise and set instead of returning to exercise one.
- Skipped exercises count as handled consistently across Today and Session Mode.
- AM/PM sessions receive their own active/complete state and timestamps.
- Empty or malformed sets can no longer complete a workout.
- Shared helpers now own reconciliation, validation, completion, and next-incomplete behavior to reduce drift between logging surfaces.

## Live-session UX
- Added a persistent rest dock with next-set context and ±30-second controls.
- Added in-session save confidence for local, syncing, pending, and offline states.
- Warm-up ramps are now tappable and do not count as working volume.
- Exercise substitutions record the planned and performed movement instead of acting as display-only suggestions.
- Today is now the launchpad for Start/Resume Session; the dense grid remains available as Quick Edit.
- Desktop Session Mode uses a three-column queue / set workspace / intelligence layout.

## Verification
- All 146 repository test files passed in bounded batches.
- 1,593 tests passed.
- ESLint completed with zero errors.
- Production and demo builds passed.
- 320 px and 390 px mobile Set Flow previews had no horizontal overflow; the 1600 px broadsheet layout was also visually reviewed.
- No database migration is required.
