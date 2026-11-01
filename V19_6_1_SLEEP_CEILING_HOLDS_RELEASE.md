# 0VERTRAINED v19.6.1 — The sleep-debt ceiling holds

Found while porting the Recovery verdict for the portfolio: adding a reason could make the day easier. A score of 85 or more with 2h of sleep debt or more resolves to TRAIN — CAPPED, which is the audit's P0 fixture. Add a rough check-in (slept poorly, very sore) and the same morning resolved to TRAIN. An overreaching load did the same. That breaks the resolver's own rule: limiters can only make the call more cautious, never less.

## Root cause (`src/recovery/verdictResolver.js`)

The sleep-debt ceiling only applied while the call was still `push`. Anything that stepped the day down first switched it off. The check-in moves a push day to `train`, and `getTrainingRecommendation` already holds an overreaching push day at Normal Load. Sleep debt then saw `train` and capped nothing.

Across 4,319,568 mornings, 18,048 got easier when a reason was added. The grid covered every score from 0 to 100, sleep debt from 0 to 8h in 15-minute steps, all four load zones, illness markers on and off, and all 81 check-ins with and without illness or injury.

## The fix

One line. The ceiling now applies when the score alone would push, as well as when the call still is `push`. A demotion never raises a call, so the only mornings that change are those with a score of 85 or more and sleep debt of 2h or more (or the sleep-limited alert) whose call something else had already lowered to TRAIN. Those now read TRAIN — CAPPED, like the same morning without the extra reason, with the capped day's sleep copy and prescription. Every other morning resolves as before. On the same 4,319,568 mornings, none gets easier when a reason is added.

## Validation

- **`verdictMonotone.test.js` (3):** the audit fixture plus a rough check-in stays TRAIN — CAPPED; so does the fixture plus an overreaching load; and on a grid of 77,760 mornings, run the way the dashboard runs them (recommendation, then resolver), taking away any one reason never makes the call more cautious. All three fail on v19.6.0.
- **`npm test`:** 171 files · 2,033 tests (v19.6.0: 170 · 2,030).
- **`npm run quality:gate`** is green: ESLint 0 errors · 31 warnings (unchanged), both builds, secret scan clean.
- No migrations, no env changes, no new settings keys.

## Files

Modified: `src/recovery/verdictResolver.js`, `package.json` (19.6.1), `public/sw.js` (`ovt-shell-v19.6.1`).
New: `src/__tests__/verdictMonotone.test.js`, this file.

`netlify.toml` and `package-lock.json` are untouched.
