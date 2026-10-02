# 0VERTRAINED v18.1.0 — Physique OS

## Release intent

Physique OS is the first closed-loop support layer for the user's physique goal. It does not replace the existing recovery engine, AM/PM program model, Set Flow logger, Fuel screen, or Factor plan. It coordinates those systems into one executable day and records what actually happened without prescribing punishment or compensation the following day.

## What shipped

### Daily Command Center

The Today screen now includes a `Physique OS` operating panel directly beneath the existing decision hero and metrics.

It provides:

- A single daily mode: **Full**, **Minimum**, or **Rescue**.
- A conservative recommended mode derived from the existing readiness and decision engines.
- Explicit user override with a timestamped selection.
- A training prescription grounded in the day's programmed work, including nested AM/PM sessions.
- Daily calorie, protein, step, and sleep targets.

### Morning check-in

The panel reuses the existing Morning Edition check-in fields so there is one source of truth for sleep quality, soreness, stress, and energy.

It also exposes an illness/injury/limitation flag. That flag forces the recommended day mode to Rescue. The app remains a logging and decision-support tool; it does not diagnose symptoms or replace clinician guidance.

### Factor quick logging

During the active Factor block, the panel surfaces the scheduled lunch and dinner for the current day.

Each tray can be logged or removed in one tap. Known calories and protein are added to the existing Fuel totals, while the full Fuel screen remains available for detailed logging.

### Close the Loop

The evening closeout evaluates five behaviors:

- Morning check-in
- Training or recovery-day completion
- Protein target
- Calorie range
- Step target

A day can be closed as complete, partial, or rescue. Partial days are recorded honestly; the system does not automatically add missed work to tomorrow.

### Wearable-aware steps

Manual steps remain authoritative when entered. Otherwise the closeout can use the current wearable step total supplied by the Today screen.

## Day mode behavior

### Full

- Complete programmed work
- Use configured full-day step target, default 9,000
- Full protein target
- 8-hour sleep target

### Minimum

- Priority work only or an abbreviated session
- 6,000-step ceiling for the reduced target
- Approximately 90% of the configured protein goal, with a 170 g floor
- 8.5-hour sleep target

### Rescue

- Recovery replaces hard training
- 3,000-step reduced target
- Approximately 80% of the configured protein goal, with a 160 g floor
- 9-hour sleep target

These are adherence modes, not medical clearance states.

## Persistence

No database migration is required. Data is stored inside the existing daily entry shape:

- `activity.steps`
- `intelligence.physiqueOS.mode`
- `intelligence.physiqueOS.modeSelectedAt`
- `intelligence.physiqueOS.closeout`

Closeouts are versioned snapshots so later releases can evolve the scoring model without rewriting prior days.

## Main implementation files

- `src/PhysiqueOSPanel.jsx`
- `src/physiqueOS.js`
- `src/TodayTab.jsx`
- `src/constants.js`
- `src/__tests__/physiqueOS.test.js`

## Validation

- Production build passes.
- ESLint passes with zero errors; the repository's existing warnings remain.
- All 147 test files were executed in bounded batches and passed.
- The new Physique OS suite contains 13 passing tests, including AM/PM session handling, day-mode selection, Factor planning, wearable steps, closeout scoring, and snapshot versioning.

## Next release target

v18.2 should add the adaptive progression layer:

- Exercise-level next-session targets
- Muscle-group volume accounting
- Strength-retention alerts during the cut
- Missed-session redistribution
- Deload recommendation workflow
