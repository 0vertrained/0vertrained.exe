# App review — 2026-10-22 (v19.2.0 baseline)

**Bottom line:** fix the front door and reconnect the instruments before building more. A brand-new account can't reach a single logger, and the endpoints that would tell you so (analytics, crash reports) are almost certainly not wired. Every P0 below is small.

Method: a read-only pass over the v19.2.0 tree by a separate reviewer, then each item below was re-checked in the code before being listed. "Verified" means confirmed in code; runtime behavior that needs a live check says so. Line numbers are v19.2.0. Most audit items in `BAD_UX_AUDIT.md` and `UI_UX_AUDIT_POST_SLICES_2026-07-09.md` are fixed in the code (single Recovery verdict, 16px inputs, styled confirms, collapsed Progress sections). One exception is #8 below.

## P0 — before inviting anyone else

**1. New accounts can't reach a logger** · S · verified
- Today renders `DayZeroSpecimen` instead of `TodayTab` until a workout exists (`App.jsx:940-942`, `dayZero.js:85`). The workout loggers only live inside `TodayTab`, so the condition can never clear. The sample's one button opens Profile, and the quick-log sheet's "Log workout" routes back to Today (`App.jsx:121-122`).
- Fuel's zero check reads `settings.macroTargets` (`dayZero.js:64`). Nothing writes that key; real targets live in `settings.goals`. Fuel stays a sample until a meal is logged, and meal logging lives in `FuelTab`. `sundayEdition.js:191-192` reads the same dead key, so protein adherence never shows.
- Recovery is a sample forever without Oura or Whoop (`dayZero.js:86`), even though setup tells manual users to check in under Recovery.
- Fix: render the sample as a card above the live tab, not in place of it. Read `goals`. Give manual users RecoveryDashboard's manual path. Add one app-level test: empty account → first logged set within two taps.

**2. Analytics, crash reports and push subscriptions go nowhere** · S · verified in code, confirm with one curl
- `log-event.js`, `log-error.js` and `push-subscribe.js` are v2 functions with no `export const config = { path }`, and `netlify.toml` only redirects `/api/account-recovery`. The client posts to `/api/log-event` (`funnel.js:33`), `/api/log-error` (`errorReporting.js:74`) and `/api/push-subscribe` (`push.js:77, 88, 103`). Those requests fall through to `/* → /index.html 200`.
- Effect: the `events`, `client_errors` and `push_subscriptions` tables stay empty. That means no funnel, no crash reports (the error screen says the error was "reported automatically"), and no subscribers for The Courier or the 7 pm reminder.
- Check: `curl -i -X POST https://0vertrained.netlify.app/api/log-event` should return the function's JSON 401, not HTML.
- Fix: add the three `config.path` entries. Add a test that every `fetch("/api/…")` in `src/` maps to a declared path.

**3. The privacy policy names the wrong AI processor** · S · verified
- `public/legal/privacy-policy.html:186` names Anthropic. `coach.js:44` sends coach context to Ollama Cloud (`https://ollama.com/api/chat`; gemma / qwen / deepseek / gpt-oss models).
- The Coach is only visible to your account today (`coachEnabled.js`), so fix this before `VITE_COACH_OPEN` goes on.

## P1 — the daily loop and data integrity

**4. AM/PM cardio is invisible to most of the app** · M · verified
- Only `loadModel.js` and `runningVolume.js` use `getLoggedCardioBlocks`. About 20 other modules read `workout.cardio` directly, including Progress summary (`progressSummary.js:308, 312`), the header streak (`AppHeader.jsx:19`), Coach evidence (`coachEvidence.js:121`), the weekly review and CSV export.
- Runs logged on Double Edition, Hybrid Cut or 2-a-day days disappear from all of them. This now matters more because race-plan runs on AM/PM days log there too.
- Fix: route every reader through `getLoggedCardioBlocks`.

**5. Connecting a wearable dead-ends** · S · verified
- The OAuth callbacks return to `/settings?oura_error=…` (`oura-auth.js:722, 750`) and `/?whoop=connected#/settings` (`whoop-auth.js:325`). The app reads none of these parameters.
- "Open Settings" and "Reconnect Oura" are `href="/settings"` links (`RecoveryDashboard.jsx:778, 1066`). They reload the app and land on Today.
- Fix: on boot, read the provider parameters, open Integrations with a status line, then `replaceState`. Replace the links with an in-app action.

**6. Edits can misfile or drop** · M · dotted paths verified; the other two per reviewer
- Save paths are split on "." (`App.jsx:555`), but exercise and supplement names go into those paths. A name like "Vit. D3" or "Row (3 sec. pause)" can't be saved. Pass paths as arrays.
- Today's date key is fixed per render, with no refresh on resume or at midnight. A PWA resumed after midnight files its first edit under yesterday.
- An older save that succeeds late can clear a newer failed save from the retry queue. Only clear the queue when the saved copy matches what's queued.

**7. Code-split screens can crash after a deploy or offline** · S · precache logic verified
- `sw.js` precaches only the assets referenced in `index.html` (line 23), and it deletes old caches on activate (line 37). SessionMode, CardioSession and most tabs are lazy chunks.
- Fix: precache every file in `dist/assets`, reload once on `vite:preloadError`, and add Reload to the error screen.

**8. Today and Recovery can give different calls** · M · partly verified
- Recovery's verdict uses sleep debt, alerts, the check-in and the trend state (`RecoveryDashboard.jsx`). Today's call (`decisionEngine.js`, `todayDecision.js`) uses none of them.
- Fix: one shared resolver for both tabs.

## P2 — measurement and speed

**9. Week-2 retention can't be measured** · S, after #2 · verified
- Exactly four event names exist: `first_verdict_rendered`, `oura_connected`, `dayzero_seen_*`, `dayzero_action_*`. Nothing records an app open or a day with something logged.
- Fix: add an `entries` trigger that writes `user_activity(user_id, activity_date)` (deduplicated), an `app_open` event once per local day, and a committed `retention.sql` (D1, D7, week 2, by `profiles.created_at`).

**10. Every edit gets slower as history grows** · M · timings unverified
- Each edit writes the full history to localStorage inside a state updater (`App.jsx:559-561`).
- Recovery refetches on every edit and every 60 s (`RecoveryDashboard.jsx:584-590`).
- Comments assume the React Compiler is memoizing renders, but it isn't configured (`vite.config.js`).

**11. Two week counters on Progress → Program** · S · seen in the v19.3 visual check
- The periodization Block runs its own 4-week cycle above the race block, so it can say "W4 deload" while the plan says "week 6 of 12 · Build". While a race plan is active, the Block should follow the plan's phases.

## Quick wins (under an hour each)
- Fix the two date-window tests (`coachingCalibrationV18_5.test.js`, `ouraIsolation.test.js`) by passing a clock or using relative dates. Right now `npm test` stops at batch 5, so 15 of the 20 batches never run in the gate.
- "Export Full Backup" serializes in-memory `data` (`App.jsx:787`). That can be just the 180-day window if the history load failed; use `loadAllEntries()`.
- Setup completion ignores the results of `saveProgram` and `saveSettings` (`App.jsx:676-681`), so a failed save brings the wizard back.
- Delete unused modules: `appShellStyle.js`, `useSwipe.js` and `formCheck/barPathTracker.js` (only its test imports it).

## Stop or cut (judgment calls)
- **Google Health** is hidden in the UI, but its function and public webhook still deploy (`google-health-auth.js:455`). Stop deploying it until it's back.
- **Coach V19 model routing and evals:** pause them until beta users can see the Coach.
- **Broadsheet:** don't add more desktop-only branches until the mobile loop above is solid.

## Suggested order
1. **Front door:** #1, #2, #3 and the quick wins. Every item is small.
2. **Ledger integrity:** #4, #6, #7.
3. **Instruments:** #9. Then watch two weeks of real data before building more.
4. **Running Phase 2/3:** structured runner, adaptation, Block ↔ plan alignment (#11).
