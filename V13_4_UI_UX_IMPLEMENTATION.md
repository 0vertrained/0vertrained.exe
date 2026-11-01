# 0VERTRAINED V13.4 — UI/UX Beta Audit Implementation

This build implements the pre-invite work from the July 10, 2026 UI/UX beta audit while preserving the Whitepaper visual system, manual-first behavior, and existing provider/compliance guards.

## Implemented

### Trust and account recovery
- Added a complete Forgot Password flow to the login card.
- Added a Netlify account-recovery function that verifies the salted recovery hash server-side, updates the Supabase Auth password with the service role, returns non-disclosive mismatch errors, persists per-username rate limits, and writes recovery audit events.
- Added recovery-phrase confirmation during signup.
- Added `supabase/migration_add_account_recovery.sql` for the rate-limit and audit tables.
- Centralized version and support contact metadata and connected it to beta-full login copy, Settings → About, the landing colophon, and ErrorBoundary reporting.

### Gym-use improvements
- Raised auth, macro, body, cardio, and notes inputs to a 16px minimum to prevent iOS focus zoom.
- Added screen Wake Lock handling to lifting and cardio sessions, including visibility-change reacquisition.
- Added rest-complete haptic and visual cues, an opt-in audio chirp, and a set-complete haptic tick.
- Added persistent Training settings for haptics and rest audio.

### Information architecture and daily flow
- Reworked Progress so the verdict, next-week action, and top limiter are visible first; trend evidence, wearable context, and planning/report detail now live behind disclosures.
- Removed the duplicated Fuel hero/Quick Add action and relabeled the remaining choices as Alternatives.
- Added a 48-hour Strava fallback so an unlogged previous-day activity appears on Today with an explicit day label and writes to the correct ledger date.
- Added per-tab scroll restoration, with new tabs starting at the top.

### PWA and failure-path polish
- Updated manifest/splash/status-bar colors to the Whitepaper paper tone.
- Added a separately padded maskable icon and manifest description.
- Added a minimal versioned last-good shell cache: navigation is network-first with a timeout and offline fallback; hashed assets are cached; old caches are removed.
- Added an in-app “Updated — reload” notice when a new service worker takes control.
- Fixed long-toast wrapping, delayed `#signin` scrolling, number-input wheel mutation, and focus return for dialogs and Quick Log.
- Raised remaining sub-floor inline type sizes and added a PR hold-the-line checklist for responsive, accessibility, support, and offline behavior.

## Deployment requirements

1. Apply `supabase/migration_add_account_recovery.sql` to the production Supabase project.
2. Confirm the Netlify function environment contains `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
3. Deploy through Netlify so `/api/account-recovery` resolves to the new function.
4. Perform the audit's physical-device matrix before beta invitations: iPhone standalone, Android installed PWA, iPad, and desktop; specifically verify wake lock, focus zoom, rest cues, maskable icon cropping, and airplane-mode cold open.

## Validation

- Full Vitest suite: run with `npm test` (batched to keep jsdom memory stable).
- Lint: `npm run lint`.
- Production and demo builds: `npm run build` and `VITE_DEMO_MODE=true npm run build`.
- Complete release gate: `npm run quality:gate`.
