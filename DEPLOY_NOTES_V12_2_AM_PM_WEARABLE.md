# 0VERTRAINED V12.2 AM/PM + Wearable Load Deploy Notes

Source of truth: `/opt/data/projects/0vertrained-source-of-truth-v12_1-hardening`

## What changed

- Added same-origin Form Check proxy at `/api/form-check/*`.
- Removed browser default use of `VITE_FORM_CHECK_API_BASE` and `VITE_FORM_CHECK_API_KEY`.
- Removed Form Check Cloud Run URL from browser CSP.
- Added session-aware program adapter (`src/programSessions.js`).
- Added `Aggressive 2-a-Day Strength + Recomp` preset with AM/PM sessions.
- Updated program preview and weekly program display to show AM/PM blocks.
- Updated the Program Editor for AM/PM session creation/editing.
- Updated Today logging to show AM/PM session blocks and log per-session cardio into `workout.cardioSessions`.
- Updated load model to sum AM/PM cardio sessions.
- Added wearable workout-load bridge (`src/wearableWorkoutLoad.js`) so wearable workouts can fill missing training-load days without double-counting manual logs.
- Added hourly scheduled `wearable-prefetch` Netlify function.

## Required Netlify env vars

Existing:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OURA_SYNC_SECRET`
- Oura/Whoop OAuth vars already used by the app

New / renamed for Form Check server-side proxy:

- `FORM_CHECK_API_BASE` — upstream hosted Form Check API base URL
- `FORM_CHECK_API_KEY` — optional upstream key, if the engine requires it

Do **not** configure Form Check as `VITE_FORM_CHECK_API_BASE` anymore. Vite env vars are public browser bundle values.

## Known limitation

`netlify/functions/wearable-prefetch.js` performs scheduled Oura prefetch through the existing server-side Oura sync path. For Whoop, this codebase's sync path is currently user-JWT endpoint based, so the scheduled function records connected Whoop users as metadata-only info events until the Whoop service-role sync helper is extracted. Manual Whoop sync remains unchanged.

## Verification performed

```bash
npm test
npm run lint
npm run build
npm run quality:gate
```

Result:

- 80/80 test files passed
- 1089/1089 tests passed
- lint passed with existing warnings only
- production build passed
- demo build passed
- quality gate passed
- secret scan clean
- deploy artifact ready

Additional bundle checks:

```bash
grep -R "VITE_FORM_CHECK_API_BASE\|VITE_FORM_CHECK_API_KEY\|ovt-formcheck-api" dist
# clean

grep -R "SUPABASE_SERVICE_ROLE_KEY\|OURA_CLIENT_SECRET\|WHOOP_CLIENT_SECRET" dist
# clean
```

Browser smoke:

- Served production build with `npm run preview -- --host 0.0.0.0 --port 4173`.
- Opened `http://127.0.0.1:4173/#/demo` successfully.
