# 0VERTRAINED V4.5 Beta Activation + Intelligence Sprint

## What changed

V4.5 combines four bounded product slices without doing a broad visual redesign:

1. Beta onboarding / first-run polish
2. Wearable readiness QA
3. Invite-only Social Circles foundation
4. Coach Memory preferences foundation

The goal is to make the product clearer for sparse-data beta users while keeping privacy and recovery-scoring boundaries intact.

## 1. Beta Activation / first-run polish

- Extended first-week checklist and sparse-data guidance.
- Added clearer baseline-week copy across tabs.
- Improved beta feedback copy surface in More.
- Feedback export remains privacy-safe and contains only app/setup metadata plus optional user note.

Never included in beta feedback:

- raw entries
- workouts/meals
- biometric payloads
- video/form payloads
- tokens/secrets
- username/user id/email

## 2. Wearable Readiness QA

Added `src/recovery/wearableReadinessQA.js` and Recovery UI wiring.

The new Recovery card explains:

- manual-only mode is valid and first-class
- wearable connected but no sync yet
- connected but awaiting first full sleep/recovery
- failed/partial sync
- stale data warning
- mixed Oura/Whoop signal reminder

Display-only. It does not change recovery scores, source resolution, blending, or training recommendations.

## 3. Social Circles foundation

Added `supabase/migration_add_social_circles.sql`.

Includes:

- `social_circles`
- `social_circle_members`
- private invite-code create/join/list RPCs
- member-only aggregate summary RPC
- RLS enabled
- `security definer` RPCs with pinned `search_path = public`
- current user derived through `auth.uid()`
- no `user_id` RPC arguments

Circle summaries expose aggregate-only stats for circle members who also have social sharing enabled:

- username
- total miles
- workouts done
- protein days
- total volume

Never exposed:

- raw entries
- payloads
- biometrics
- notes
- Coach chat
- tokens
- feeds/comments/DMs

Frontend Social Hub now includes a compact Circles section that gracefully explains when the V4.5 SQL migration has not been applied.

## 4. Coach Memory foundation

Added `src/coachMemory.js` and More → Coach Memory preferences.

The user can opt in to suggest-only coach preferences:

- tone
- focus
- intensity preference
- rest bias
- short user-approved preference note

The coach memory context is suggest-only and cannot edit programs or scores. It is normalized from settings and disabled by default for pre-V4.5 users.

## Deploy order

1. Deploy the frontend normally to Netlify.
2. Apply SQL migrations in Supabase SQL Editor if not already applied:
   - `supabase/migration_add_social_signals.sql`
   - `supabase/migration_add_social_circles.sql`
3. No new environment variables required.

The app remains usable before the Social Circles migration is applied; the Circles card shows a migration-needed notice.

## Verification

Focused tests passed:

- `betaActivation.test.js`
- `wearableReadinessQA.test.js`
- `socialCircles.test.js`
- `coachMemory.test.js`
- `privacyHardening.test.js`

Production build passed.

Full quality gate should be run before deploy package handoff:

```bash
npm test
npm audit --omit=dev
npm run quality:gate
```

## UI note

This sprint intentionally does not redesign the app. Only targeted clarity/stability polish was included. A separate UI simplification/compression sprint should follow because the app is starting to feel visually and cognitively muddied.
