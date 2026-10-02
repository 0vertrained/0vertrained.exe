# 0VERTRAINED v18.1.1 — Today Command Center

## Purpose

This release simplifies the Today tab after the Physique OS launch. The daily support system remains intact, but the interface now prioritizes one decision and one primary action at a time.

## UI changes

- Merged the daily coaching prescription and Physique OS into a single **Today Command Center**.
- Added one context-aware primary action for check-in, AM/PM training, cardio, or day closeout.
- Replaced static target cards with a compact live progress strip for training, protein, steps, and calories.
- Reduced Factor content to the next scheduled meal with one-tap logging and a link to Fuel.
- Moved mode selection, morning check-in, decision details, and day closeout into focused bottom sheets.
- Collapsed the detailed legacy check-in into a quieter **Daily log** disclosure.
- Removed duplicated Fuel and telemetry panels from the desktop Today layout.
- Preserved Full, Minimum, and Rescue modes, recovery-based recommendations, AM/PM session support, safety flags, and closeout snapshots.

## Quality verification

- Production build completed successfully.
- ESLint completed with zero errors; existing repository warnings remain.
- All 147 test files passed in bounded batches.
- Oura-linked Today rendering and broadsheet layout regression tests were updated for the new command-center hierarchy.

## Version

- Application: `18.1.1`
- Service worker cache: `ovt-shell-v18.1.1`
