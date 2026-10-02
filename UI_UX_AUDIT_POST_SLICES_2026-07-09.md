# 0VERTRAINED UI/UX Audit — Post-Slices Review

**Date:** 2026-07-09  
**Scope:** Current production build in demo mode; desktop-width shell (1280px viewport); Today, Recovery, Fuel, Progress, Profile, Settings route, shared navigation, and source review.  
**Purpose:** Find regressions or visual drift introduced by the previous UI/UX slices and define a safer, updated improvement plan.

---

## Executive summary

The prior slices improved several real problems: confirmations are now in-app, keyboard focus has a visible treatment, touch targets are larger, and mobile remains coherent. However, **Slice 4 widened a mobile-first shell without making the rest of the layout system desktop-aware**. At a 1280px viewport, the app computes to a 960px shell. Dense ledger rows, workout inputs, and management screens expand horizontally, while several fixed sheets, overlays, and action bars remain capped at 480px.

That creates the visual mismatch likely being described as “weird”: a desktop-wide app frame with mobile-width modal/action geometry inside it. The result is not a redesign failure; it is an incomplete responsive treatment. The correct fix is **not** to bolt generic two-column CSS onto every tab. First establish one responsive container contract for shell, dock, sheets, overlays, and fixed bars; then selectively compose only genuinely independent desktop panels.

There is also one independent high-priority trust problem: the Recovery screen can tell the athlete both that it is a strong day for high-intensity/PR attempts and that sleep debt should cap intensity. A coaching surface must produce one clear action recommendation, with the caveat incorporated into the verdict rather than competing with it lower on the page.

---

## Audit evidence

### Browser walkthrough

- **Today:** Desktop screenshot showed the 960px workout ledger stretching set rows across a wide surface. The fixed mobile dock remains dominant while working through a long training screen. The actual Quick Log sheet was verified as off-screen and `aria-hidden` when closed; full-page screenshots include that off-viewport fixed element, so it is **not** recorded as a persistent-overlay bug.
- **Recovery:** Top signals said: “Ready for high-intensity training. Good day for PR attempts if warm-ups move well.” A lower Coach Interpretation said meaningful sleep debt should cap intensity. The recommendations conflict.
- **Fuel:** The “Next fuel action” recommends Chicken + rice bowl, and the first Quick Add button repeats exactly the same meal. The width is readable, but the duplicated action asks the user to parse two routes to the same outcome.
- **Progress:** At 960px, summary text and ledger rows become broad and scan poorly. The sticky Progress sub-navigation plus persistent mobile dock create competing navigation layers. The default Overview still exposes a long report: limiting factors, trend evidence, wearable context, block guidance, form trends, and a detailed ledger control.
- **Profile:** Plan, form analysis, settings, backup/import, beta feedback, notifications, coach preferences, and social sharing remain a long flat management page. Important actions and utilities compete at near-equal prominence.
- **Settings:** The route was verified through the actual DOM handler. It opens successfully. Earlier coordinate-based browser clicks were intercepted by the fixed desktop dock; this is a tooling/geometry warning, not a claim that Settings is broken.

### Source review

- `src/index.css` widens `.ovt-app-shell` and `.ovt-bottom-nav` to **720px at >=768px** and **960px at >=1024px** using `!important`.
- At least **12** other inline layout definitions still hard-code `maxWidth: 480`, including the Quick Log sheet, Coach dialog, Settings screen, tutorials, session completion, and profile/program action bars.
- The codebase has **1,677** inline `style={{}}` objects. Highest concentration: `ProgressTab.jsx` 295, `MoreTab.jsx` 197, `FormCheck.jsx` 128, `FuelTab.jsx` 123, `TodayTab.jsx` 112.
- The fixed stack is substantial: header, Today jump nav, Progress subnav, bottom dock, Quick Log sheet, settings, program-builder bars, workout/session screens, and toasts. They need deliberate z-index/width/offset rules rather than independent local assumptions.

---

## Findings

### P0 — Responsive geometry is internally inconsistent

**Impact:** High  
**Effort:** Medium  
**Risk:** Medium  
**Evidence:** The app shell and bottom dock can be 960px at desktop, while Quick Log and many fixed overlays/action bars stay at 480px. Wide content with narrow centered overlays feels accidental and gives coordinate/tap testing a chance to target the persistent dock instead of page content.

**Root cause:** Responsive behavior is applied as a CSS override to two shell elements only. Inline fixed-layout components cannot participate in that override.

**Fix direction:** Create a single shared `--ovt-content-width` (or equivalent responsive container contract) used by shell, fixed dock, sheet, settings/overlay interiors, coach surface, and profile/program fixed action bars. Do not widen full-screen task modes unless their internal content is also intentionally constrained.

**Acceptance criteria:**
- At 390px, all current mobile dimensions remain visually unchanged.
- At 768px, app content, dock, sheets, and fixed action bars share the same 720px alignment.
- At 1024px, do **not** automatically use 960px for dense single-column ledger/form screens; cap readable single-column content around 720–760px unless a component explicitly opts into a two-column layout.
- No fixed surface looks narrower or wider than the page surface it controls.

### P0 — Recovery gives contradictory action guidance

**Impact:** High (trust and training safety)  
**Effort:** Low–Medium  
**Risk:** Medium (must preserve the scoring model)  
**Evidence:** “Ready for high-intensity training / PR attempts” appears alongside “sleep debt… cap intensity.”

**Fix direction:** Resolve action guidance in one presentation layer. Preserve raw readiness and sleep-debt details, but render a single conservative recommendation, e.g. “Good readiness, but sleep debt limits the ceiling: complete the planned session; do not add volume or chase a PR.”

**Acceptance criteria:**
- Exactly one top-level “what to do today” instruction.
- Any limiter modifies that instruction before it reaches the screen.
- Existing raw values, sources, and confidence labels remain visible.
- Add a test fixture for high readiness + meaningful sleep debt.

### P1 — Desktop dock is mobile UI enlarged, not desktop navigation

**Impact:** High  
**Effort:** Medium  
**Risk:** Low–Medium  
**Evidence:** At desktop width the persistent bottom navigation and central FAB visually bisect long Today, Recovery, Fuel, and Progress pages. Progress additionally has a sticky subnav, producing two persistent nav systems.

**Fix direction:** Preserve the current dock on mobile. At larger breakpoints, make the dock a quieter, compact bottom utility bar or a header-adjacent navigation strip; do not cover working content with a tall FAB-first dock. Decide this only after the shared responsive-container contract is fixed.

**Acceptance criteria:**
- No persistent navigation layer obscures the primary scroll work area on desktop.
- Progress has one obvious active navigation hierarchy at a time.
- Mobile tab order and Quick Log behavior stay unchanged.

### P1 — Progress default view is still a full report

**Impact:** Medium–High  
**Effort:** Medium  
**Risk:** Low  
**Evidence:** Overview exposes summary, three limiting factors, 30-day trend evidence, wearable context, block guidance, form trends, and detailed metrics control before the user asks for detail.

**Fix direction:** Keep the hero verdict, next-week recommendation, and 2–3 primary limiters visible. Collapse lower-everyday content behind explicit disclosures: “Trend evidence,” “Wearable context,” and “Planning tools.” Preserve the detailed ledger and charts behind the existing control.

**Acceptance criteria:**
- Above first mobile scroll: verdict, next action, supporting metrics, most relevant limiter.
- Technical transparency remains one deliberate expansion away.
- No data, sources, or caveats are deleted.

### P1 — Fuel duplicates the main meal decision

**Impact:** Medium  
**Effort:** Low  
**Risk:** Low  
**Evidence:** “Next fuel action” and first Quick Add both propose Chicken + rice bowl.

**Fix direction:** Make the hero recommendation the one-tap action; move the matching Quick Add option into “Alternatives” or suppress it when it duplicates the recommendation. Keep the other quick-add choices available.

**Acceptance criteria:**
- One obvious next food action.
- Alternatives are visibly framed as alternatives, not duplicated CTAs.
- Logging behavior and macro calculations are unchanged.

### P2 — Profile is a flat management ledger

**Impact:** Medium  
**Effort:** Medium  
**Risk:** Low  
**Evidence:** It places program setup, analysis, settings, data management, beta feedback, notification state, coach preferences, and social at roughly the same hierarchy.

**Fix direction:** Retain all actions but regroup into 3 collapsible management domains: **Training**, **Account & data**, **App preferences**. Keep the most likely next action in each domain visible; move export/import and beta utilities into disclosure. Keep privacy copy near data controls.

### P2 — Fixed-stack governance is missing

**Impact:** Medium  
**Effort:** Medium  
**Risk:** Medium  
**Evidence:** Header, Today jump nav, Progress subnav, fixed dock, sheets, dialogs, settings, toasts, and action bars define independent z-index/width/offset behavior.

**Fix direction:** Establish shared layer tokens (`header`, `subnav`, `dock`, `sheet`, `dialog`, `toast`) and a documented viewport-offset contract. This is a targeted safety refactor, not a full inline-style conversion.

---

## Updated execution plan

### Slice A — Contain the Slice 4 regression first

1. Replace the blanket 960px desktop widening with a responsive content-width contract.
2. Use the contract for `.ovt-app-shell`, BottomNav, Quick Log sheet, Settings interior, Coach surface, and profile/program fixed action bars.
3. Keep dense ledger and form screens at readable single-column width by default.
4. Browser-smoke at 390px, 768px, 1024px, and 1280px.

**Non-goal:** No generic grid selectors and no global forced two-column layout.

### Slice B — Desktop navigation behavior

1. Keep current mobile bottom dock unchanged.
2. At desktop, reduce the dock’s visual dominance and prevent it from covering the working area.
3. Reconcile Progress sticky subnav with desktop primary navigation.
4. Test Today workout log, Fuel quick add, Progress sub-tabs, Profile, Settings, and Quick Log at desktop width.

### Slice C — Recovery decision integrity

1. Implement a presentation-level action resolver for readiness + limiters.
2. Ensure sleep debt, acute load, illness flags, and low confidence constrain recommendations before display.
3. Add focused UI tests for conflicting input combinations.

### Slice D — Compress daily decision surfaces

1. **Progress:** hero + next-week action + top limiter by default; disclose supporting evidence.
2. **Fuel:** one hero action; alternatives below it; keep full ledger disclosed.
3. **Today:** keep the current “Do next” emphasis; reduce visual competition between Coach Detail, After Session, adjustment, and Start Logging.
4. **Recovery:** hero verdict + what changed + one action; data trust/technical ledger remain accessible but quieter.

### Slice E — Management hub and fixed-stack cleanup

1. Regroup Profile without removing any capability.
2. Introduce shared z-index and fixed-surface offsets.
3. Align form/session/settings modal interiors to the responsive container contract.

---

## Priority matrix

| Work | Impact | Effort | Risk | Order |
|---|---:|---:|---:|---:|
| Responsive container contract / regression repair | High | Medium | Medium | 1 |
| Recovery action contradiction | High | Low–Medium | Medium | 2 |
| Desktop dock behavior | High | Medium | Low–Medium | 3 |
| Progress and Fuel compression | Medium–High | Medium | Low | 4 |
| Profile regrouping + fixed-stack tokens | Medium | Medium | Medium | 5 |

---

## Preserve explicitly

- Whitepaper/ledger typography, restrained hairlines, and source-aware data labels.
- Bottom-tab order and mobile Quick Log interaction model.
- Privacy language, “suggest-only” guards, raw wearable values, source labels, and confidence notes.
- Existing error boundaries, styled confirmation dialogs, keyboard focus visibility, touch-target improvements, and reduced-motion support.
- Mobile layout at <=767px unless a regression is demonstrated there.

---

## Verification requirements for future implementation

- `npm run quality:gate`.
- Built-demo browser sweep at 390px, 768px, 1024px, and 1280px.
- Verify fixed sheet/off-screen state by computed bounding rect + `aria-hidden`; do not mistake a full-page screenshot of an off-viewport fixed element for a user-visible overlay.
- Test active tab navigation, Quick Log open/close, Profile → Settings, and Settings close at each supported width.
- Confirm no top-level recovery recommendation conflicts with a visible safety limiter.
