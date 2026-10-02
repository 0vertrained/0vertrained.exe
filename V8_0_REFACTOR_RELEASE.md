# 0VERTRAINED V8.0 — Engineering Debt Pass

Zero product-surface changes. Three structural improvements: the App.jsx
split, lazy-loading of on-demand chunks, and the repo's first rendered-UI
tests. Every extracted line is verbatim — behavior, props, state, and write
paths are unchanged.

## 1 · App.jsx split (4,501 → 768 lines)

The monolith is now five files, each extracted verbatim:

| File | Lines | Contents |
|---|---|---|
| App.jsx | 768 | Shell only: auth/session, data load + cache, save paths, theme, header, nav, overlays, modals, BaselineBanner |
| TodayTab.jsx | 967 | TodayTab + DailyCoachHero, TodayPlanCard, FirstWeekCard, PrimaryNextAction, CheckinCard, CardioNotes, ExerciseLogger, epley1RM (exported — ProgressTab uses it) |
| ProgressTab.jsx | 1,267 | ProgressTab + ProgressSubnav, HistoryModeToggle (both exported for tests), pace/chart helpers |
| FuelTab.jsx | 488 | FuelTab + FuelHero, QuickAddSection, FuelRecoveryInsight |
| MoreTab.jsx | 1,069 | MoreTab + ProgramTab, ProgramEditor, SocialTab, CirclesSection, PR boards, CoachPreferencesCard, hub primitives |

Import correctness was verified two ways: a mechanical scan of every
identifier from the original import header against each file's body (caught
4 real misses the build alone would not have — Vite doesn't flag undefined
free variables), plus the full test suite and rendered smoke tests.

Two stale orphaned section comments from historical code moves ("Program
Tab" / "Meal Plan Tab" headers sitting above FuelHero) were deleted while
passing through.

## 2 · Lazy loading

`React.lazy` + `Suspense` for the three components not needed at first paint:

| Chunk | Size (gzip) | Loads when |
|---|---|---|
| FormCheck | 80.1 kB (17.8) | Form Check overlay opens |
| DemoPage | 25.5 kB (7.6) | #demo route |
| SessionMode | 7.8 kB (3.1) | "Start session" tapped |

Main bundle: **826.5 kB → 743.8 kB** (gzip 232.8 → 217.0). Most of what
remains is @supabase/supabase-js plus the four always-needed tabs; further
splitting the tabs themselves would trade first-tap latency for first-paint,
which is the wrong trade for a 4-tab app.

## 3 · First rendered-UI tests (`uiSmoke.test.jsx`)

All 1,011 prior tests were pure logic; the shell itself had zero coverage.
Seven shallow smoke tests now protect it: BottomNav renders exactly the 4
tabs + FAB and fires its callbacks; QuickActionSheet reports tapped keys and
accepts the coach-extended list; ProgressSubnav maps History to both internal
views; HistoryModeToggle switches Events↔Entries; NotificationsCard renders
its unavailable state without crashing in a push-less environment.

Added dev-deps: @testing-library/react, @testing-library/user-event,
@testing-library/dom. Note for future component tests: this repo runs vitest
without globals, so RTL auto-cleanup never registers — `afterEach(cleanup)`
is required per file (it bit this one immediately).

## Verification

72/72 test files, **1018/1018 tests** (+1 file, +7 tests). Full quality
gate passes: production build, demo build, secret scan, deploy artifact.

## Files

Added: src/TodayTab.jsx · src/ProgressTab.jsx · src/FuelTab.jsx ·
src/MoreTab.jsx · src/__tests__/uiSmoke.test.jsx
Modified: src/App.jsx (shell only) · package.json (RTL dev-deps)

## Device-review checklist

Everything should look and behave identically — that's the point. Quick
pass: all 4 tabs render, FAB sheet opens, Form Check overlay opens (now with
a brief lazy-load), #demo route works, Session Mode opens from the Lifting
block, Profile overlay renders program/social/coach-prefs.
