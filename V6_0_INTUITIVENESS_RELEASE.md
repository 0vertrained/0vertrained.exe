# 0VERTRAINED V6.0 — Intuitiveness Pass

Implements all five phases of the V6 UI plan (see V6_UI_INTUITIVENESS_PLAN.md).
Display-only throughout: no scoring, recommendation, blending, load-model,
write-path, persistence, or backend changes. All Accept/Keep/feedback
callbacks write to the exact same `updateToday` intelligence paths as before.

## Phase 1 · One decision, one block (Today)

- **Training adjustment merged into the decision block.** New
  `TrainingAdjustmentInline` (IntelligenceSections.jsx) renders the Accept /
  Keep interaction *inside* `DailyCoachHero`, between the coach card and the
  tomorrow outlook — same gating (`mode !== "keep"` unless quality-window),
  same callbacks. The standalone `AdaptiveTrainingBanner` is no longer
  rendered on Today (component kept exported). Button labels clarified:
  "Accept adjustment" / "Keep plan as written".
- **Readiness reduced to one line on Today** — index + summary sentence,
  tapping it deep-links to the Recovery tab where the full detail lives.
  `ReadinessSection` is no longer rendered on Today (the third voice
  repeating the day's call).
- **Duplicate streak block deleted** — the header already shows STREAK · Nd.
  Dead streak-message code removed from TodayTab.
- **Check-in labels spelled out**: Weight lbs · Sleep hrs · Energy 1-10 ·
  Soreness 1-10 (was Wt lbs / Sleep / Engy / Sore). Progress log view cells
  match.

## Phase 2 · Recovery compression

- **Wearable readiness check collapses to one status line** when healthy
  ("Sources · oura + whoop — <title> ▾"); the full explanation renders
  automatically when tone is warning/caution or wearables disagree, and is
  one tap away otherwise. No content removed.
- **"Wearable intelligence" moved inside the Technical details disclosure**
  (it labels itself supplemental).
- **"What changed today" is Tier 1 only when flags surfaced**; on a stable
  day the same rows render inside the disclosure instead.
- **Whoop source summary moved inside the disclosure** next to the Whoop
  context cards.
- Above-the-fold on a normal day is now: alerts (if any) → sources line →
  Readiness hero → Coach interpretation → Technical details disclosure.

## Phase 3 · Fuel Log / Plan split

- Fuel gains Log / Plan underline sub-tabs (same pattern as Progress).
  Log: Still-needed hero → Quick add → Macro ledger + food search →
  Hydration → Fuel↔Recovery insight. Plan: the entire meal-plan block.
  The three logging surfaces are now contiguous.

## Phase 4 · One numbering rule, two nav patterns

- `FigureHeader` renders "Fig. N ·" only when `n` is provided. All Recovery
  sections drop their numbers (the visible sequence skipped and forked:
  0d/0b/0c/1b…). The orphaned hardcoded numbers elsewhere are gone too:
  "Fig. 2 · Lifting" → "Lifting", "Fig. 5 · Check-in" → "Check-in" (Today),
  "Fig. 4 · Hydration" → "Hydration" (Fuel), "Fig. 3 · Nutrition" →
  "Nutrition" (Progress log view). Zero "Fig." strings remain in the app.
- **Progress: pager arrows deleted.** New shared `ProgressSubnav` — the same
  complete 4-tab bar on every subview: Overview · Form · Program · History.
  (Was: 5-tab bar on Summary only, prev/next pagers on each subview.)
- **Timeline + Log merged under History** with an Events / Entries toggle
  (`HistoryModeToggle`). Internal subView values unchanged ("timeline",
  "log") so existing deep-links (Block guidance → Program, Form teaser →
  Form) keep working.
- The form view's functional Refresh button moved into the Form Check
  History block head.

## Phase 5 · Language + affordance sweep

- Interaction verb system documented at the top of `buildStyles()` in
  theme.jsx: filled = primary, ghost = secondary, "▾" = disclosure,
  "→" = navigation, blockStat = data or nothing.
- Decorative blockStat labels removed: "AT A GLANCE" (Quick status),
  "LOW FRICTION" (Quick add), "WHAT'S HOLDING PROGRESS" (Limiting factors).
- "📷 Guided Record" → "Guided Record" (only emoji in the system, gone).

## Verification

- 69/69 test files, 989/989 tests pass, zero test files modified
- Production build, demo build, secret scan, deploy artifact: all pass
  (full quality gate)

## Files touched

src/App.jsx · src/sections/IntelligenceSections.jsx ·
src/RecoveryDashboard.jsx · src/whitepaper.jsx · src/theme.jsx ·
src/FormCheck.jsx

## Device-review checklist before shipping

1. Today: propose-adjustment day — Accept/Keep now sits inside the decision
   block; confirm it reads as one decision.
2. Today: readiness one-liner tap lands on Recovery.
3. Recovery: healthy day shows the single sources line; expand/collapse it.
4. Fuel: Log/Plan tabs; confirm meal plan state survives tab switches
   (component state is preserved — both fragments live in one FuelTab).
5. Progress: all four tabs reachable from every subview; History toggle
   switches Events ↔ Entries.
