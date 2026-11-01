# 0VERTRAINED v19.6.0 — Less on every screen

Tier 1 of `APP_SIMPLIFICATION_PLAN_2026-10-27.md` plus the Recovery consolidation from Tier 2, and everything Hyrox-branded removed (the app is for strength training and running races now). No logger, write path, scoring model or race plan changed. Every row of Recovery is still there; most of it just waits under Technical details.

## What changed on screen

| Screen | Before | After |
|---|---|---|
| **Recovery** | 2.7 screens, 45 section labels, four readings of the same morning | **1.1 screens, 20 labels, one verdict** |
| Fuel | Log · Factor · Recipes | Log · Recipes |
| Progress → Program | Block · old Race block (Hyrox ledger, second race) · Week | Block · Race (the plan's countdown) · Week |
| Profile hub | 2.4 screens, 19 buttons + 6 inputs | 1.9 screens, 15 buttons, 0 inputs |
| Settings → Integrations | Fitbit "Coming soon" card, "next sprint" copy | Strava · Oura · Whoop · Social |
| Settings → About | Load diagnostics (developer instrumentation) | Beta feedback note · demo link |

### Recovery: one verdict (`src/RecoveryDashboard.jsx`)
On the phone the tab read the morning four times on the way down: the verdict ("Fresh 97 · Green light"), Signals ("READY"), Coach interpretation ("Biometrics look stable") and the Readiness score block ("97 · Push" with method and trend), with "Mixed signal day · CAUTION" between them.

Now, top to bottom: a reconnect banner if Oura needs it → check-in and verdict → What changed today (when flags surfaced) → Data trust → Technical details. Behind the fold, in this order: Signals, Mixed signal day, Wearable readiness check, Readiness score (with the method note and the 7-day trend), Coach interpretation, then the ledgers and load it already held. The fold's label reads "signals · score · interpretation · ledger · load".

- The verdict already carried the most severe limiter (the V13 resolver reads the alerts and the sleep debt), so moving the Signals list changes what's visible, not what's weighed.
- The reconnect banner is an action, so it stays at the top as its own block.
- The desktop broadsheet keeps its three columns; only the reconnect banner moved into the verdict column.
- The manual-only view (no wearable) is unchanged.

### Hyrox removed
- **Progress → Program → Race block** was the V7 version: a second race in localStorage with a Hyrox station ledger and its own "Set race target" form. `src/raceBlock.js` is deleted. `RaceBlockSection` now reads the v19.3 race plan only: countdown, phase stamp (BUILD / TAPER in the last 10 days / RACE DAY), the plan week, and where to edit it. With no plan it says where to add one. This also ends the two-week-counters confusion (review #11): the only race on screen is the plan's.
- **Cardio timer:** the "Hyrox 8 stations" preset is gone (`src/cardioSession.js`).
- **Block goal presets:** "Hyrox prep" is now "Race prep — sharpen race pace and taper into a running race" (`src/periodizationSettings.js`). A block saved with the old id normalizes to the default preset and keeps its own goal text.
- **Demo page:** the Hyrox bullet is now the race plan.
- Lowercase `hyrox` stays in four text classifiers (`loadModel`, `adaptiveTraining`, `nutritionCoach`, `periodizationPlanner`). They read a user's own day names, and a user who writes "Hyrox" on a day should still get it counted as hard.
- A test scans every source file: no capitalised Hyrox copy anywhere outside comments.

### Fuel (`src/FuelTab.jsx`)
The Factor tab was a personal 12-day prepared-meal block from July (`factorCutPlan.js`). The tab and its view are gone. The module stays for now because `physiqueOS.js` and `nutritionAutopilot.js` still import it; it's inert past its dates and is the next thing to delete.

### Settings (`src/SettingsScreen.jsx`)
- The Fitbit / Google Health card renders only when `GOOGLE_HEALTH_INTEGRATION_ENABLED` is true. The code stays, as its comment asks; the "Coming soon" card doesn't ship.
- Whoop: "algorithm blending arrives next sprint" is now "the recovery score is still computed by the app".
- Theme: "More themes coming soon" is gone.
- About: the load-diagnostics panel (`perf.js` instrumentation with a Clear button) is replaced by the beta feedback note (moved from the Profile hub, now stamped with the real app version, the current tab and the logged-day count) and the demo-page link. `perf.js` still records; nothing reads it on a user screen.
- `SettingsScreen` takes two new optional props, `loggedDays` and `currentTab`, which `App.jsx` passes.

### Profile hub (`src/MoreTab.jsx`)
- Gone: the "Theme & preferences → Managed in Settings" row (Settings is two rows up), the inline beta-feedback form, and the "View / share demo page" footer.
- Coach memory is collapsed by default. Its header shows on/off; tap to edit.
- "Social sharing" is now "Social boards — leaderboard, PR board and circles · sharing is opt-in under Settings", so it no longer reads as a duplicate of the opt-in toggle in Settings → Integrations.

## Not in this release (still in the plan)
- Tier 2: Progress → Coach down to three panels, one weekly review, Progress → Program moving under Profile → Training plan, the Fuel hero, the two Today rows, History paging.
- Tier 3: Settings 8 → 6 sections, the hub regroup.
- The HRV calculation toggle stays in Integrations (it only shows with Oura connected). Moving it into Recovery needs a settings write from the dashboard.
- `netlify/functions/google-health-auth.js` still deploys. Removing it is a deploy change, not a UI one.

## Data / AI line
- No migrations, no schema changes, no new settings keys. `ovt_race_plan_v1` in localStorage is simply no longer read; nothing deletes it.
- Nothing touches what the Coach sees. Strava data stays out of AI Coach payloads.

## Validation
- **`simplificationV19_6.test.jsx` (12):** Recovery's mobile order and what sits behind the fold (source guards, as the dashboard's connected mount is a fixture project); Fuel mounts with Log and Recipes only; Settings → Integrations has no "coming soon" or "next sprint", Theme promises nothing, About carries the beta note (copied text checked: version, tab, logged days, the user's note) and the demo link and no diagnostics; the hub lost its three items and Coach memory opens on tap; no capitalised Hyrox copy in `src/`; timer and block presets; the old race block deleted.
- **`racePlanUi.test.jsx`:** the race block counts down from the plan, stamps BUILD / TAPER / RACE DAY, points edits at the plan, and offers no second race.
- Updated: `v7Features` (race block tests removed with the module), `periodizationSettings` (race_prep), `whoopFoundation` (copy).
- **The tests fail on what they pin:** 12 reverts each caught (Signals and Coach interpretation back above the fold, a Factor tab, the Fitbit card, the sprint copy, the demo link, the Theme row, Coach memory open, Hyrox copy and preset, the taper window, the countdown).
- **`npm test`:** 170 files · 2,030 tests (v19.5: 169 · 2,020).
- **`npm run quality:gate` is green.** ESLint 0 errors · 31 warnings (unchanged). Entry chunk 421.11 kB / 133.55 kB gzip (v19.5: 458.06 / 145.49): the Factor view and the old race block left the bundle.
- **Demo build at 390px:** every tab measured again. Recovery 969 px (was 2,313), Profile 1,588 px (was 2,061), Fuel two tabs, Program with the plan-driven Race block; no page or console errors.

## Files
Modified: `src/RecoveryDashboard.jsx`, `src/RaceBlockSection.jsx`, `src/FuelTab.jsx`, `src/SettingsScreen.jsx`, `src/MoreTab.jsx`, `src/App.jsx`, `src/cardioSession.js`, `src/periodizationSettings.js`, `src/DemoPage.jsx`, `package.json` (19.6.0), `public/sw.js` (`ovt-shell-v19.6.0`), tests `v7Features`, `racePlanUi`, `periodizationSettings`, `whoopFoundation`.
Deleted: `src/raceBlock.js`.
New: `src/__tests__/simplificationV19_6.test.jsx`, `APP_SIMPLIFICATION_PLAN_2026-10-27.md`, this file.

`netlify.toml` and `package-lock.json` are untouched.
