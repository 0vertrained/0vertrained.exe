# 0vertrained UI/UX Improvement Plan

Audit date: 2026-07-09
Scope: Full application — Today, Recovery, Fuel, Progress, Profile/Settings, and shared shell

---

## Audit Summary

The application has strong bones: a coherent whitepaper/ledger visual identity, good progressive disclosure patterns, solid error boundaries, and a working theme system. The main UX debt is in three areas: **visual consistency** (1,482 inline style objects with no design-token enforcement), **information architecture** (some tabs are very long scrolls with no shortcuts), and **interaction polish** (browser-native confirm dialogs, no responsive breakpoints, inconsistent loading states).

---

## Phase 1: Visual Consistency & Design System (HIGH impact, MEDIUM effort)

### 1.1 — Adopt the existing primitives more aggressively

**Problem:** `src/ui/primitives.jsx` defines `SectionHeader`, `HeroCard`, `MetricStrip`, `LoadingShell`, `FigureSection`, `RuledRow`, and `Eyebrow` — but most surfaces still build their own versions with raw inline styles. This creates subtle spacing/typography drift between tabs.

**Evidence:** 1,482 `style={{}}` occurrences across the codebase. `ProgressTab.jsx` alone has 295. `MoreTab.jsx` has 197. `FuelTab.jsx` has 126. `FormCheck.jsx` has 128.

**Fix:**
- Audit each major surface and replace ad-hoc card/header/metric patterns with the existing primitives
- Add 2-3 missing primitives if needed (e.g., `ActionCard`, `StatusBadge`)
- This is a refactor, not a redesign — visual output should be nearly identical, just consistent

**Priority surfaces:** ProgressTab (295 inline styles), MoreTab (197), FuelTab (126), FormCheck (128)

### 1.2 — Spacing and typography tokens

**Problem:** The theme's `S` object has shared style fragments (`S.block`, `S.blockHead`, `S.blockTitle`, `S.blockStat`) but they're inconsistently used. Many components hardcode padding/margin/fontSize values that drift from the intended rhythm.

**Fix:**
- Add spacing scale tokens to the theme (e.g., `S.gap = 8`, `S.gapLg = 16`, `S.gapXl = 24`)
- Add type scale tokens (`S.textXs`, `S.textSm`, `S.textBody`, `S.textLg`, `S.textXl`, `S.textDisplay`)
- Sweep the 3-4 highest-style-count files and replace hardcoded values with tokens

### 1.3 — Consistent card/block rhythm

**Problem:** Some sections use `borderTop` hairline rules, some use `borderBottom`, some use both, some use neither. The visual rhythm between sections varies by tab.

**Fix:**
- Standardize: every major section gets a `borderTop: 1px solid C.line` hairline
- Section spacing: `paddingTop: 16, paddingBottom: 15` (the existing `S.block` convention)
- Remove double-rules (both top and bottom borders on adjacent sections)

---

## Phase 2: Information Architecture & Navigation (HIGH impact, LOW-MEDIUM effort)

### 2.1 — Today tab is too long

**Problem:** The Today tab scrolls through: date picker → coach controls → workout plan (3 exercises × 3 sets each with individual spinbuttons) → cardio section → session notes → readiness button → check-in. On mobile this is a very long scroll. The coach detail and after-session controls are collapsed by default (good), but the workout plan itself is verbose.

**Fix:**
- Add a sticky mini-nav or jump links at the top: "Workout ↓ · Cardio ↓ · Check-in ↓"
- Consider collapsing completed exercises (0/3 sets done = expanded, 3/3 = collapsed with summary)
- Move the readiness button and check-in into a collapsible "Pre-session context" section

### 2.2 — Progress tab sub-navigation is hidden in a button row

**Problem:** The OVERVIEW / FORM / PROGRAM / HISTORY sub-tabs are rendered as a row of small buttons. They work but don't feel like navigation — they feel like filters. Users may not realize they're looking at a sub-section of Progress.

**Fix:**
- Style sub-tabs as a proper segmented control or underline indicator
- Add a subtle "sticky" behavior so the sub-nav stays visible while scrolling
- Show a badge or indicator on FORM when there are new/unreviewed checks

### 2.3 — Profile page is a link farm

**Problem:** The Profile/More tab is a long list of navigation buttons: Generate Plan, Edit Weekly Program, Switch Preset, Analyze Movement, Settings, Export JSON, Export CSV, Import File, Import Text, Copy Beta Note, Theme & Preferences, Social Sharing, Demo Page. It's functional but feels like a settings dump.

**Fix:**
- Group into visual clusters with clearer hierarchy: "Training Plan" (3 items), "Form Check" (1 item), "Data" (4 items), "App" (4 items)
- Add brief status summaries to each group (e.g., "5 lifting · 2 cardio · 1 rest" already exists under Training Plan — good)
- Consider a 2-column grid on wider screens instead of a single scrolling list

---

## Phase 3: Interaction Polish (MEDIUM impact, LOW effort)

### 3.1 — Replace `window.confirm` with styled dialogs

**Problem:** Four destructive actions use `window.confirm()`: disconnect Whoop, disconnect Oura, switch program preset, save program changes. The browser-native dialog is unstyled, can't be themed, and breaks the app's visual cohesion.

**Fix:**
- Build a simple `ConfirmDialog` component (or use the existing modal pattern if one exists)
- Replace all 4 `window.confirm` calls
- The dialog should use the whitepaper theme (hairline border, mono label, serif message, two buttons)

### 3.2 — Toast consistency

**Problem:** `showToast` is prop-drilled through multiple component layers. Some surfaces use it, some don't. The toast implementation itself may be basic.

**Fix:**
- Move toast to a React context so any component can trigger it without prop drilling
- Add toast variants: success (green), info (neutral), warning (amber), error (red)
- Ensure all user actions that mutate data show a toast confirmation

### 3.3 — Loading state consistency

**Problem:** `LoadingShell` exists in `ui/primitives.jsx` and RecoveryDashboard uses skeleton placeholders, but not all tabs use them. Some tabs may show blank or partial content during data fetch.

**Fix:**
- Audit each tab's initial load state
- Ensure every tab shows either a `LoadingShell` or skeleton placeholders during data fetch
- The Today tab already has a "stable loading shell" comment — verify it's actually used

---

## Phase 4: Responsive & Mobile (MEDIUM impact, MEDIUM effort)

### 4.1 — No responsive breakpoints exist

**Problem:** Zero `@media` queries found in the codebase. The app is mobile-first by default (which is correct for a PWA), but on wider screens (tablet, desktop) the layout doesn't take advantage of available space. On very small screens, some dense sections may feel cramped.

**Fix:**
- Add 2-3 breakpoints: `≥768px` (tablet), `≥1024px` (desktop)
- On tablet+: switch to 2-column layouts for Today (workout left, context right), Fuel (log left, plan right), Progress (overview left, details right)
- On desktop: max-width the content area (~800px) and center it — don't let lines stretch edge-to-edge on ultrawide
- Keep mobile as the primary/fallback layout

### 4.2 — Touch targets

**Problem:** Some interactive elements (small buttons, spinbuttons, the "+" quick-add) may have touch targets below the recommended 44px minimum.

**Fix:**
- Audit all interactive elements for minimum 44×44px touch targets
- Increase padding on small buttons (the "Sync now" / "Sync last 30 days" buttons in Settings are `fontSize: 10` — very small)
- Ensure spinbutton increment/decrement areas are large enough for thumbs

---

## Phase 5: Accessibility & Polish (LOWER impact, LOW effort)

### 5.1 — Focus indicators

**Problem:** The app uses custom-styled buttons and inputs. Focus states may not be visible for keyboard navigation.

**Fix:**
- Add visible focus rings to all interactive elements (`outline: 2px solid C.accent` or similar)
- Ensure tab order follows visual order
- Test keyboard navigation through all tabs

### 5.2 — Color contrast

**Problem:** The whitepaper theme uses subtle grays (`C.textFaint`, `C.textDim`) on dark backgrounds. Some combinations may not meet WCAG AA contrast ratios.

**Fix:**
- Audit the theme color tokens for contrast ratios
- Adjust `C.textFaint` and `C.textDim` if needed to meet 4.5:1 minimum
- The dark theme is likely fine; the light theme (if it exists) needs checking

### 5.3 — Motion and transitions

**Problem:** No transitions or animations observed. Tab switches and section expands/collapses are instant. This feels abrupt.

**Fix:**
- Add subtle 150-200ms fade transitions on tab switches
- Add smooth expand/collapse animations on progressive disclosure sections
- Keep motion minimal and respect `prefers-reduced-motion`

---

## Phase 6: Feature-Specific UX Improvements (varied impact, varied effort)

### 6.1 — Workout logging friction

**Problem:** Each exercise has individual spinbuttons for weight, reps, and RIR per set. For a 3-exercise, 3-set workout, that's 27 individual spinbutton interactions. This is precise but high-friction.

**Fix:**
- Add a "Fill all sets" quick-action: set weight/reps once and apply to all sets
- Add a "Copy from last session" button per exercise
- Consider a "Log all as written" one-tap button when the user did exactly the planned workout

### 6.2 — Fuel quick-add could be smarter

**Problem:** The Fuel tab shows 3 quick-add meal buttons. These appear to be static suggestions rather than personalized.

**Fix:**
- Rank quick-add suggestions by: recently logged, time of day, remaining macro gaps
- Add a "Log this meal again" section showing recent meals
- The "NEXT FUEL ACTION" recommendation already exists — ensure it updates after each log

### 6.3 — Recovery tab could surface the most important signal first

**Problem:** The Recovery tab leads with "SIGNALS" and "1 ALERT" then "READY" status. The hierarchy is: signals → data trust → coach interpretation → readiness score → what changed → technical details. This is thorough but buries the actionable insight (coach interpretation) below the data audit.

**Fix:**
- Consider reordering: Readiness score → Coach interpretation → Signals → Data Trust → What Changed → Technical Details
- Or add a sticky summary bar at the top: "84 · Ready · Sleep-limited · Proceed with planned work"
- The current order is defensible for data-trust-first users; make it a preference if there's disagreement

---

## Priority Matrix

| Phase | Impact | Effort | Risk | Recommendation |
|-------|--------|--------|------|----------------|
| 1.1 — Adopt primitives | HIGH | MEDIUM | LOW | **Do first** — biggest visual consistency win |
| 1.2 — Spacing/type tokens | HIGH | LOW | LOW | **Pair with 1.1** |
| 2.1 — Today tab too long | HIGH | LOW | LOW | **Quick win** |
| 3.1 — Replace window.confirm | MEDIUM | LOW | LOW | **Quick win** |
| 3.3 — Loading consistency | MEDIUM | LOW | LOW | **Quick win** |
| 2.2 — Progress sub-nav | MEDIUM | LOW | LOW | **Quick win** |
| 1.3 — Card rhythm | MEDIUM | LOW | LOW | **Pair with 1.1** |
| 3.2 — Toast consistency | MEDIUM | MEDIUM | LOW | Good but not urgent |
| 4.1 — Responsive breakpoints | MEDIUM | MEDIUM | MEDIUM | Test carefully |
| 2.3 — Profile link farm | LOW | LOW | LOW | Nice to have |
| 4.2 — Touch targets | MEDIUM | LOW | LOW | Important for mobile |
| 5.1 — Focus indicators | LOW | LOW | LOW | Accessibility baseline |
| 5.2 — Color contrast | LOW | LOW | LOW | Accessibility baseline |
| 5.3 — Motion | LOW | LOW | LOW | Polish |
| 6.1 — Workout logging friction | HIGH | MEDIUM | MEDIUM | Behavior change, test carefully |
| 6.2 — Fuel quick-add smarts | MEDIUM | MEDIUM | LOW | Nice enhancement |
| 6.3 — Recovery reorder | LOW | LOW | LOW | Preference-sensitive |

---

## Recommended Execution Order

### Slice 1: Quick Wins (1 session)
- 3.1 Replace `window.confirm` with styled dialog
- 3.3 Loading state consistency audit
- 2.1 Today tab jump links
- 2.2 Progress sub-nav styling

### Slice 2: Design System Foundation (1-2 sessions)
- 1.2 Spacing and typography tokens
- 1.3 Card/block rhythm standardization
- 1.1 Begin adopting primitives (start with FuelTab and SettingsScreen)

### Slice 3: Primitives Rollout (1-2 sessions)
- 1.1 Continue: ProgressTab, TodayTab, FormCheck
- 4.2 Touch target audit

### Slice 4: Responsive & Polish (1 session)
- 4.1 Responsive breakpoints
- 5.1 Focus indicators
- 5.3 Motion/transitions

### Slice 5: Feature UX (1-2 sessions)
- 6.1 Workout logging friction
- 6.2 Fuel quick-add smarts
- 3.2 Toast context

---

## What NOT to Change

- **The whitepaper/ledger visual identity** — hairline rules, mono labels, serif display scores. This is distinctive and works.
- **The bottom tab bar** — TODAY, RECOVERY, +, FUEL, PROGRESS. The "+" quick-log pattern is good.
- **Progressive disclosure** — collapsed coach detail, collapsed technical details, collapsed check-in. Keep these.
- **Data Trust panel** — source labels, raw values, sync freshness. This is excellent and should be preserved exactly.
- **Error boundaries** — already well-implemented. Don't touch.
- **Demo mode banner** — clear and honest. Keep.
- **Privacy copy** — "Raw videos are not stored", "Suggest-only", etc. These are important trust signals.
