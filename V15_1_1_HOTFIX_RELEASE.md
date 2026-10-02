# 0VERTRAINED V15.1.1 — Hotfix: masthead streak crash (desktop)

One-line production bug, one structural lesson.

## The bug

React error #31 at the broadsheet tier: the V15.0 context strip rendered `{calcStreak(allData)}` directly as a child — but `calcStreak` returns `{ count, active }`, not a number (ProgressTab has always read `streak.count`). Rendering the object crashed the header on every desktop load ≥1440px. Mobile was never affected — the strip only mounts at the tier.

**Fix:** the strip renders `calcStreak(allData || {}).count`. Nothing else changed.

## Why it shipped, and what changed about that

Every broadsheet guard to date was a **static source check** — assert the string exists, assert the grid recipe, assert the fallback. Static checks can't catch a type error in a render expression; worse, the V15.0 guard had pinned the buggy string *verbatim*, so it asserted the bug. Nothing in the suite ever actually mounted the header at the tier.

`src/__tests__/broadsheetHeader.test.jsx` is the first test that does: it stubs `matchMedia` to force the broadsheet query, renders the full `Header` inside `ThemeProvider`, and asserts the strip's real output — `Streak N days` as text, `Logging: Today`, the program day plan, `+ Log` — plus a mobile-mode case asserting the strip is absent. Two incidental findings from writing it: RTL auto-cleanup doesn't register in this project (vitest runs without globals), so the file carries an explicit `afterEach(cleanup)`; and the static guard's assertion was updated to pin the corrected `.count` form with a comment explaining why.

The V15.2+ slices will get mounted smoke tests for each new broadsheet surface as they land, not just source guards.

## Validation

Full gate: 118 test files (1 new — the mounted header suite), lint 0 errors, both builds, secret scan — green. No migrations, no env changes. Deploy replaces V15.1.0 directly.
