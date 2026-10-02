# 0VERTRAINED V13.5 — Signup, Form Check & Offline Hardening

Implements the P0 slice of the V13.4.1 security review: two privilege holes around signup, an unauthenticated paid-API proxy, a data-loss bug in the offline save path, and version drift across four files.

## Security

### Signup cap is now enforced by the database (`migration_v29_signup_hardening.sql`)
- **Removed the `app_state_lock` UPDATE policy.** Any authenticated user could previously rewrite `max_users` (up to the CHECK ceiling of 10000) or flip `signup_locked`, opening signups to the world. `app_state` is now read-only for anon/authenticated; the cap is managed via admin SQL or the service role. `schema.sql` was patched so re-running the base schema can never resurrect the policy.
- **Added a `BEFORE INSERT` trigger on `public.profiles`** (`ovt_enforce_signup_cap`, SECURITY DEFINER, advisory-xact-lock serialized) enforcing `signup_locked` and `max_users` inside the database. The client-side `getSignupStatus()` check remains as advisory UX, but the anon key can no longer be used to mint accounts past the cap, and two concurrent signups can no longer both slip under it.
- `src/auth.js` maps the trigger's stable message tokens (`SIGNUP_CAP_REACHED`, `SIGNUP_LOCKED`) to friendly copy.

### Form Check proxy requires authentication (`netlify/functions/form-check.js`)
- Previously the only user-facing function with no auth gate: it attached `FORM_CHECK_API_KEY` to any request from anywhere, and URL normalization let `/api/form-check/../admin` reach arbitrary POST routes on the upstream host. Anyone on the internet could burn engine compute for free.
- Every request now requires a valid Supabase JWT, verified server-side exactly like coach.js. The upstream path is exact-match allowlisted (`/analyze` only), and oversized bodies are rejected up front via content-length (100 MB ceiling, `FORM_CHECK_MAX_BYTES` override).
- `src/formCheck/serverPoseClient.js` attaches the caller's session token — only when talking to the same-origin proxy, never to an explicit `apiBase` origin.
- Tests: `netlify/tests/form-check.test.js` (allowlist, traversal rejection, 401 paths, authorized forwarding with the engine key).

## Fixed

### Offline gym workouts survive an app close (`src/pendingSavesStore.js`)
- The pending-save queue lived only in React state, and `appDataCache` was written only on save success. Logging sets on dead gym wifi and closing the PWA before signal returned silently lost the workout — it was gone from the server, the cache, and the next cold open.
- The queue is now durable: write-through to localStorage on every change (namespaced per user, versioned key, 400 KB ceiling that drops oldest days first), overlaid onto both the cache paint and the fresh server load on boot (a queued day is canonical over server state by definition), and flushed once per loaded user.
- Save failures now also write the entry into `appDataCache` optimistically, so a reload mid-outage keeps the entry visible even before the overlay path runs.
- The reconnect toast only fires when something is actually queued, and says how much ("Back online — retrying 2 saves").
- Deliberate asymmetry: the queue is NOT cleared on logout. Other per-user caches are re-downloadable copies of server truth; a pending save is the only copy of that workout. Keys are per-user, so another account never inherits them.
- Tests: `src/__tests__/pendingSavesStore.test.js`.

### Version is single-sourced from `package.json`
- Four independent version strings had already drifted (package.json 13.4.0, appMeta "V13.4", sw.js cache `v13.4.0`, release zip 13.4.1). A stale `CACHE_NAME` is the dangerous one — the service worker only busts its shell cache when that string changes, so installed PWAs could keep an old shell after a real release.
- `package.json` is now the only source: `appMeta.js` consumes it via a Vite/Vitest `__APP_VERSION__` define; `scripts/sync-version.mjs` stamps `public/sw.js` (wired into `prebuild`, also runnable via `npm run sync:version`); `src/__tests__/versionSync.test.js` fails the gate on any drift.

### Build hygiene
- `AuthScreen.jsx` no longer dynamically imports `./auth` while also statically importing it — the `[INEFFECTIVE_DYNAMIC_IMPORT]` build warning is gone.

## Deployment requirements

1. Apply `supabase/migration_v29_signup_hardening.sql` to the production Supabase project (idempotent; run the manual verification block in its footer).
2. Confirm the form-check function environment has `SUPABASE_URL` and `SUPABASE_ANON_KEY` (already required by the other functions).
3. Deploy normally through Netlify. Form Check requires a signed-in session after this deploy — expected for a feature that only exists inside the authed app.

## Validation

- Full quality gate: `npm run quality:gate` — 110 test files (20 new tests across 3 files), lint 0 errors, production + demo builds, secret scan, deploy artifact check. All green.
