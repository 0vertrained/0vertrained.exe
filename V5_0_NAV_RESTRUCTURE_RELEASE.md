# 0VERTRAINED V5.0 Nav Restructure

## Scope

Navigation shell only: bottom nav, header, and where "More" lives.

No backend, SQL, storage schema, scoring, recommendation, or decision-engine
changes. No changes to any tab's internal content — Today, Fuel, Recovery,
Progress, and the former More/hub screens all render exactly what they did
before, just reached differently.

This is phase 1 of the redesign discussed and mocked up before implementation
(see `whitepaper-redesign-concept.html` for the reviewed concept). Phase 2
(Recovery compression, Fuel Log/Plan split, Progress cleanup) is follow-up
work, scoped separately below.

## Why

Audit of the existing IA found two structural problems:

1. Form Check — the app's most differentiated feature (server-side movement
   analysis) — was three taps deep: More → Form Check → Analyze.
2. "More" had become a catch-all for Program, Form Check, Social, Coach
   Memory, and Account/Data, all nested behind one hub/subview pattern.

## What changed

- **Bottom nav is now 4 tabs, not 5**: Today · Recovery · Fuel · Progress.
  `TABS_ORDER` in `src/AppBottomNav.jsx` dropped `"More"`.
- **A center FAB replaces the 5th tab slot.** Tapping it opens a quick-action
  sheet: Log Workout, Form Check, Log Meal, Check In. Each just routes to an
  existing tab or overlay — no new write paths.
- **"More" becomes a "Profile" overlay**, opened from a new header button
  (`AppHeader.jsx`) instead of consuming nav real estate. It's the same
  `MoreTab` component with the same internal Program/Form Check/Social
  sub-views, unchanged — only the entry point moved.
- **Form Check gets a direct overlay entry point** from the FAB, in addition
  to its existing path inside Profile → Form Check. Both point at the same
  `<FormCheck />` component.
- Overlays fully replace tab content and hide the bottom nav while open (a
  "pushed screen," not a 5th destination) — avoids an ambiguous "which tab is
  active" state.
- `src/theme.jsx` gained centralized style tokens for the FAB, the quick-
  action sheet, the header's Profile button, and the overlay back-bar
  (`navFab`, `sheet*`, `profileBtn`, `overlayBack*`) — same token-in-theme
  convention as the existing `nav*` styles, nothing new invented per-component.
- `firstWeekJourney.js` checklist items that still target `"More"` are caught
  by a `navigateTo()` wrapper in `AppInner` and routed to the Profile overlay
  instead of a tab value that no longer exists.

## Also fixed while auditing

- `index.html` was missing an IBM Plex Sans font request even though
  `theme.jsx` names it as the primary UI face — body text was silently
  falling back to Inter. Now loaded.
- Removed `LogTab` in `App.jsx` (~155 lines) — fully defined but not mounted
  anywhere, leftover from an earlier IA.
- `MoreTab`'s beta-feedback metadata labelled its screen `"More"`; updated to
  `"Profile"` to match where it's actually reached from now.

## Verification

```bash
npm test
npm run build
npm run quality:gate
```

Results:

- 69 test files passed, 989 tests passed (no test touches `App.jsx` directly;
  the project's own convention is visual inspection for shell-level UI, which
  this note stands in for pending your review)
- Production build passed
- Demo build passed
- Secret scan clean

No test file needed changes — nothing under test asserts on tab count, nav
structure, or the `"More"` tab string in a way this touched.

## Known follow-up

Matches the phasing laid out in the redesign plan:

1. ~~Nav restructure~~ — this release
2. Recovery compression (hero + collapsed detail, same pattern Today already
   got in V4.6A)
3. Fuel Log/Plan split
4. Progress sub-tab label cleanup (Summary → Overview, etc.) and a Form Check
   teaser card in Overview
5. Shared `SourceBadge` convention across Recovery/Fuel/Progress so wearable
   provenance reads consistently everywhere

Do not start phase 2 until this nav restructure has been visually reviewed
and approved on a real device — same discipline the V4.6A release note asked
for before its own follow-up.

---

## V5.1 follow-up — Today tab fixes from device screenshot

Feedback from a real-device screenshot (dark theme) surfaced three issues on
Today, none of them cosmetic-only:

1. **The `{weekday} · Command center` band was pure redundancy**, not just
   visual noise. The header's H1 already shows the weekday ("Thursday"), and
   the `LIFT + CARDIO` stat next to it is shown again in the "Today's Plan"
   card a few rows down. Removed from `DailyCoachHero` entirely — zero
   information lost. (Also dropped the hero's own top border, which would
   have doubled up with `TodayDecisionCard`'s own top rule now that it's the
   first child.)
2. **The "Logging for [date]" bar was also redundant** — the header already
   shows the date top-right (`07.02.26`). It now only shows full, bordered,
   and labeled when it's load-bearing: when you're actually viewing a past
   day and need that to be unmistakable. On a normal today-view, it's a
   small unlabeled date control, quiet enough not to read as its own
   section.
3. **The `LOG →` button was a real bug, not a design issue.** `logRef` and
   `checkinRef` were declared with `useRef(null)` but never attached to any
   DOM node, so `goToAction`'s `scrollIntoView` call always resolved to
   `null` and silently did nothing. Both refs are now attached to their
   actual sections (the workout logger block, and the check-in card), with
   `scrollMarginTop` added so the scroll target doesn't land under the
   sticky header.

Verified: 69/69 test files, 989/989 tests, production build — all pass, no
test file needed changes (nothing was asserting on this markup or on the
broken scroll behavior).

---

## V5.2 follow-up — Coach moved off a floating button

`Coach` (the AI chat, currently gated to a single user via
`VITE_COACH_USER_ID`) rendered its own `position: fixed` launcher button
top-right of the viewport, independent of the header's own layout. On a real
device it visibly overlapped the header's Profile/Logout row rather than
sitting in flow with it.

Rather than squeeze a 5th item into an already-tight header row (Streak ·
Synced · Profile · Logout), Coach now uses the same "quick action from
anywhere" pattern Form Check got in the nav restructure:

- `Coach` is now a **controlled component** — `open`/`onClose` come from
  `AppInner`, not internal state. The floating launcher button is deleted
  entirely; only the slide-up chat sheet remains, and it renders wherever
  its `open` prop says to.
- `isCoachEnabled(userId)` is exported from `Coach.jsx` so the gate logic
  lives in one place instead of being duplicated at each call site.
- **"Ask Coach" is appended to the FAB's quick-action sheet**, but only when
  `isCoachEnabled(user?.id)` is true — everyone else sees the same 4 actions
  as before. `AppBottomNav.jsx`'s `QUICK_ACTIONS` is now exported so
  `App.jsx` can extend it rather than duplicate it.

This gives Coach a real, non-overlapping, permanent home now, and the same
entry point scales cleanly if it's rolled out beyond one user later — no
further plumbing needed, just drop the `VITE_COACH_USER_ID` gate.

Verified: 69/69 test files, 989/989 tests, production build all pass.


