# 0VERTRAINED v18.5.0 — Coaching Systems

Released: 2026-07-20

This release combines the three post-progression systems into one closed coaching loop. It remains suggest-only: the app can explain, recommend, and record an athlete response, but it does not silently alter calories, cardio, training volume, or recovery targets.

## V18.3 — Weekly Coaching Review

- Adds a focused weekly review to Progress Overview.
- Compares current and prior seven-day weight averages.
- Supports weekly waist measurements and waist trend comparisons.
- Reconciles calorie, protein, steps, training, sleep, soreness, and wearable trends.
- Includes benchmark strength-retention evidence from Adaptive Progression.
- Chooses among continue, adherence, calories, activity, recovery, diet break, or collect-more-data outcomes.
- Requires adherence before restriction and repeated evidence before escalation.
- Supports approve, modify, and hold responses.
- Stores a baseline snapshot with each response for later outcome calibration.
- Observation mode remains active until enough personal evidence exists.

## V18.4 — Nutrition Autopilot

- Upgrades the Factor view into a live prepared-meal operating system.
- Reconciles logged Factor meals against actual tray inventory.
- Supports manual inventory corrections without changing the original meal plan.
- Selects the next unlogged meal and replaces unavailable scheduled trays.
- Shows live protein and calorie gaps.
- Adds late-day rescue mode with ranked, predictable fallback meals.
- Adds one-tap rescue macro logging.
- Adds grocery prompts based on inventory and remaining macro gaps.
- Preserves label-verification warnings for estimated or unknown meals.

## V18.5 — Coaching Calibration

- Combines daily decision responses and weekly recommendation outcomes.
- Adds observe, suggest, and calibrated authority levels.
- Makes recovery trend authority provider-neutral: Oura-only, Whoop-only, mixed, and manual-only paths remain valid at different confidence levels.
- Never averages conflicting wearable sources.
- Raises evidence requirements after repeated rejected recommendations.
- Exposes sample counts, follow-through, favorable outcomes, and false-positive guards in Progress.
- Keeps clinician-defined symptom and exercise restrictions above all coaching recommendations.

## UI placement

- Today remains unchanged and uncluttered.
- Weekly review lives in Progress Overview.
- Nutrition Autopilot lives in Fuel > Factor.
- Calibration evidence lives in the existing Coach Calibration disclosure.

## Data compatibility

- No database migration is required.
- Existing entries remain readable.
- New optional fields:
  - `body.waist`
  - `intelligence.weeklyCoachReviewResponse`
  - `nutrition.autopilot`

## Validation

- 151 test files / 1,639 tests passed in bounded batches.
- Focused V18.3–V18.5 suites: 15/15 tests passed.
- ESLint: 0 errors; 32 pre-existing warnings remain.
- Production build passed.
- Demo-mode build passed.
- Secret scan and deploy artifact validation passed.
