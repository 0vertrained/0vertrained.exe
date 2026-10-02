# V13.0 — Whitepaper Reform (Typographic + Verdict Release)

**Date:** 2026-07-09 · **Scope:** presentation layer only — no scoring, storage, or write-path changes.
**Gate:** 1,234 tests passing (8 new) · lint clean · production + demo builds green · secret scan clean.

This release makes the Whitepaper System readable at arm's length in a gym, gives
the monochrome palette a real status vocabulary, and turns Today and Recovery
into pages that lead with one verdict instead of a stack of competing summaries.
It complements the IA work in `UI_UX_IMPROVEMENT_PLAN.md` (Slices A–E): that plan
fixed *where things live*; this release fixes *how they read*.

---

## 1 · The reading floor (type scale + contrast)

The census found ~460 of ~840 `fontSize` declarations at or below 9.5px, and the
faint ink `#878479` measuring **3.56:1** on paper — below WCAG AA (4.5:1).

- **789 fontSize declarations raised across 35 files** via a ratio-preserving
  codemod. Mapping: 6/6.5→9 · 7→9.5 · 7.5/8→10 · 8.5→10.5 · 9/9.5→11 ·
  10→11.5 · 10.5→12 · 11/11.5→13 · 12→13.5 · 12.5/13/13.5→14 · ≥14 unchanged.
  Hierarchy is preserved — everything simply moved up one landing.
- **`TOKENS.typeScale`** now: micro 9.5 · caption 11 · body 13 · bodyLarge 14 ·
  title 20 · hero 28.
- **Faint ink recalibrated:** light `#878479→#767368` (4.51:1), dark
  `#827E76→#8A867C` (5.11:1). `navInactiveTxt` matched. Nothing faint fails AA now.
- Inputs stay ≥16px (iOS zoom guard). SVG sparkline labels in `Figure.jsx`
  hand-raised (7→9, 8→9.5) with adjusted offsets.
- `blockTitle` tracking relaxed 0.16em→0.14em at the larger size.

## 2 · Ink-state vocabulary (`src/ui/primitives.jsx`)

Status was previously carried by 8px colored words. It is now carried by print
devices, all ink:

- **`Stamp`** — the day's call, inverted ink. One per screen. `tone="error"` is
  the only red variant.
- **`LimiterRule`** — 3px double rule for constraints that modify the verdict
  (sleep debt, illness, low confidence). Never red.
- **`ProvisionalTag`** — dotted-border tag for estimated/derived values.
- **`NavRow` / `DisclosureBlock`** — the front page's row grammar: quiet
  label + status sub, arrow to navigate or chevron to expand in place.
  `DisclosureBlock` accepts `plain` to render children unfolded (past-day logging).
- **`AlertCard` reclassified:** `warning` = double-rule ink (limiter),
  `caution` = dim hairline, `positive` = ink, and a new **`error`** severity
  owns red. The Oura reconnect banner is now `error` — it's a failure, not coaching.

## 3 · Today as a front page

- **Masthead (AppHeader):** one row — θVERTRAINED wordmark (now the page h1) +
  "No. {day-of-year}" + sync status + Profile. The three-row header (~60px of
  chrome) is gone. **Logout moved to Profile → Account + Data** where a
  once-a-quarter action belongs. Streak already lives on Progress.
- **Hero (`TodayDecisionCard`):** eyebrow `TODAY COACH · date` + ink Stamp
  (PUSH / ON PLAN / MODIFY / RECOVER), 27px serif headline, italic deck, and a
  **single full-width CTA** derived from the next-action ladder — Start/Continue
  launches Session Mode directly, cardio opens the interval runner, rest/done
  scrolls to check-in. Same setters as the in-block buttons; no new write paths.
- **Vitals strip:** Readiness · Workout · Kcal left · Protein left, one ruled row.
- **Folded:** the jump mini-nav, the "Do next" row, and the Today Plan card are
  removed; their jobs moved to the hero CTA and the **Workout disclosure row**
  (plan + completion in the collapsed sub, exact same loggers inside, opens
  automatically once work is logged). **Fuel and Recovery become NavRows** —
  one status line each, tap through for the full story. Check-in unchanged.
- Past-day logging renders everything plain and open, as before.

## 4 · Recovery: one verdict (`src/recovery/verdictResolver.js`)

The audit's P0: readiness could say "PR attempts are allowed" while the
interpretation block said "sleep-limited — cap intensity." Fixed at the
presentation layer:

- **`buildRecoveryVerdict()`** resolves the post-blend recommendation +
  limiters (illness > warnings > acute load > sleep debt ≥2h > low confidence)
  into **exactly one instruction** before anything renders. Limiters only ever
  demote; when they do, the prescription is **replaced**, so the PR line cannot
  survive a cap.
- The verdict hero leads the tab: Stamp (`TRAIN — CAPPED`), headline, deck, and
  the winning limiter as a double rule *inside* the verdict (e.g.
  `CEILING · SLEEP DEBT 2H 11M`).
- Every downstream echo — coach-interpretation guidance, readiness-hero
  caption, readiness row — now reads the **resolved** recommendation. Raw
  values, sources, confidence, and the technical ledger are untouched.
- **8 new tests** (`recoveryVerdict.test.js`) including the audit fixture:
  score 88 + 2.18h debt ⇒ one capped instruction, limiter named, no PR line.

## 5 · Desktop broadsheet (≥1024px)

- Tabs move **into the masthead** (role=tablist preserved, keyboard reachable);
  the bottom dock **unmounts**; the FAB becomes a "+ Log" masthead button
  opening the same Quick Action sheet. Masthead tab changes close any open
  overlay first. Shell bottom padding drops to 32px at the breakpoint.
- Mobile (<1024px) is byte-for-byte the same navigation as V12.
- **Deferred intentionally:** multi-column content zones — per the audit's
  Slice A non-goal, the width contract ships first; columns come only where
  panels are genuinely independent.

## Guardrails

- No algorithm, scoring, storage, or Supabase write-path changes anywhere.
- Session Mode, Cardio runner, plate math, rest timers: untouched (they inherit
  the type floor automatically).
- `useIsDesktop` degrades safely where `matchMedia` is absent (jsdom/SSR → mobile).

## Verify before deploy

1. 390px viewport: Today hero → strip → Workout row → Fuel/Recovery rows → Check-in.
2. Log one set → Workout row auto-opens, CTA flips to "Continue session".
3. Recovery with sleep debt ≥2h on a high score → single `TRAIN — CAPPED` verdict.
4. ≥1024px: dock gone, masthead tabs + "+ Log" present, overlays close on tab change.
5. Profile → Account + Data → Log out present and working.
