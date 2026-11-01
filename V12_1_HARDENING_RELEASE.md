# 0VERTRAINED V12.1 — Hardening

No new training features. This release implements every finding from the
V12.0 full audit: one functional bug, two latent runtime crashes the new
linter caught, performance (bundle split, self-hosted fonts), security
(CSP, error-detail leaks, atomic counters), accessibility, and per-timezone
push reminders.

## Fixed — functional

- **Monthly coach limit never reset.** `coach_access.used_this_month` had no
  reset mechanism anywhere; a table-gated user who hit their limit was locked
  out permanently. `coach_access` gains `period_start` and the new
  `ovt_coach_access_current` RPC lazily zeroes the counter on first use of a
  new calendar month. No cron needed. (migration_v28)
- **Two latent ReferenceErrors in MoreTab**, caught by ESLint's first run:
  `copyToClipboard` was called on the coach-memory and beta-note copy paths
  with no import (it was private to TodayTab — now shared in src/clipboard.js),
  and `FormCheck` was rendered on the legacy `subView === "form"` path with no
  import (now lazy-imported there).
- **Conditional hooks in ReadinessSection.** `useCountUp`/`useState` sat below
  an early `return null`, so a recommendation flipping between null and set
  changed the hook order — a React crash. Hooks now run unconditionally.
- **Racy usage counters.** Daily and monthly coach counters were
  read-then-write over PostgREST; both are single atomic statements via RPCs
  now (`ovt_bump_daily_usage`, `ovt_increment_coach_usage`). coach.js falls
  back to the legacy path until migration_v28 is applied, so deploy order
  doesn't matter.

## Security

- **CSP tightened**: `script-src` drops `'unsafe-inline'` (Vite emits no
  inline scripts — verified against the built output); `connect-src` drops the
  `https://*.run.app` wildcard (it whitelisted every Cloud Run service on the
  internet — the specific formcheck host stays); Google font domains removed
  (fonts now self-hosted).
- **Upstream error details stay server-side.** coach.js returned Ollama error
  text to the client and push-subscribe returned PostgREST error text; both
  now log server-side and return generic messages.
- **All three new RPCs** are SECURITY DEFINER, revoked from anon/authenticated,
  service-role-execute only — same posture as the tables they touch.

## Performance

- **Entry chunk 775 KB → 320 KB (227 → 103 KB gzip), −59%.** TodayTab stays
  eager (it is first paint); ProgressTab, FuelTab, RecoveryDashboard, MoreTab,
  SettingsScreen, Tutorial, and Coach are now lazy chunks. `isCoachEnabled`
  moved to src/coachEnabled.js so the shell can gate the Coach entry point
  without pulling the Coach chunk; accounts that can't use Coach never fetch it.
- **Fonts self-hosted** via @fontsource (src/fonts.js) — same families and
  weights the Google Fonts request carried, served from /assets with immutable
  caching. Kills the render-blocking third-party request. Newsreader loses
  the variable optical axis (static cuts); visually check the serif numerals.

## Tooling

- **ESLint added and wired into the quality gate** (flat config, recommended +
  react-hooks). Rule errors fail the gate; the React-Compiler-era strictness
  rules (`set-state-in-effect`, `purity`, `refs`) and `exhaustive-deps` are
  warnings — all flagged sites predate the config, work, and are test-covered,
  so blanket refactoring them here was more regression risk than the patterns.
  First run found 110 errors: the three real bugs above plus ~100 dead
  imports/locals/functions, all removed.
- **Vite 5 → 8** (with @vitejs/plugin-react 6). Clears the dev-server
  advisories (esbuild GHSA-67mh-4wv8-2f99 and the vite high) — `npm audit`
  is now clean including devDependencies.
- **package.json version synced** to 12.1.0 (was stuck at 1.0.0 while
  APP_VERSION advanced — two version sources will eventually disagree
  somewhere visible).

## UX / a11y / privacy

- **Pinch-zoom restored**: `user-scalable=no, maximum-scale=1.0` removed from
  the viewport meta (WCAG 1.4.4; modern iOS ignores it anyway, so it only ever
  blocked Android).
- **Push reminders are timezone-aware.** The cron now runs hourly; each run
  sends only to subscriptions whose local time is in the 19:00–19:59 window,
  using a `tz_offset_minutes` captured at subscribe time. Pre-migration rows
  default to Central — exactly the old behavior. `reminders_enabled` opts a
  subscription out of the nudge without touching its push registration.
  (migration_v28, push.js, push-subscribe.js, push-reminders.js)
- **Privacy policy** now discloses device-local storage (entry/program/settings
  cache, coach history, exercise notes / superset / race-plan prefs), that
  it's cleared on logout, and the shared-device caveat.

## Deferred (unchanged from the audit)

Splitting ProgressTab/MoreTab/TodayTab into sections continues incrementally —
blanket extraction in a hardening release is the wrong risk profile. The
react-hooks strictness warnings (31) are the standing worklist for that effort.

## Verification

77/77 test files, **1076/1076 tests** (+6: isDue window math incl. half-hour
zones, legacy-offset fallback — which caught a real `+null === 0` coercion bug
during development — and the one-window-per-day invariant). Full quality gate
green with the new lint step: tests → lint → prod build → demo build → secret
scan → artifact validation. APP_VERSION → V12.1.

## Files

Added: src/coachEnabled.js · src/clipboard.js · src/fonts.js ·
eslint.config.js · supabase/migration_v28_usage_hardening.sql ·
src/__tests__/pushReminderSchedule.test.js
Modified: src/App.jsx (lazy tabs/overlays) · src/Coach.jsx · src/TodayTab.jsx ·
src/MoreTab.jsx · src/sections/IntelligenceSections.jsx · src/push.js ·
src/errorReporting.js (version) · netlify/functions/coach.js ·
netlify/functions/push-subscribe.js · netlify/functions/push-reminders.js ·
netlify.toml (CSP) · index.html · public/legal/privacy-policy.html ·
scripts/quality-gate.mjs · package.json · ~35 files for lint cleanup
(dead imports/locals/functions removed; no behavior change)

## Deploy notes

1. Run supabase/migration_v28_usage_hardening.sql (coach.js and
   push-reminders.js both work before AND after — RPC 404s and unknown-column
   selects fall back to legacy paths). The push-preference section is guarded:
   on databases where push was never installed (no push_subscriptions table)
   it skips with a notice instead of aborting. If you enable push later, run
   migration_add_push_subscriptions.sql — it now creates the preference
   columns itself.
2. No new env vars.
3. Netlify picks up the new hourly reminder schedule from the function's
   `config.schedule` on deploy.

## Device-review checklist

1. Cold-load the app on cellular — first paint should be noticeably faster;
   confirm tab switches to Progress/Fuel/Recovery don't visibly flash.
2. Typography pass: Newsreader serif numerals on Recovery readiness and the
   e1RM figures (static cuts replaced the variable optical axis).
3. Pinch-zoom now works on Android.
4. Open Coach, send a message — confirms the lazy chunk + CSP changes didn't
   break the sheet.
5. Profile → coach memory "copy" and beta-note "copy" — these were the two
   paths that previously crashed with a ReferenceError.
