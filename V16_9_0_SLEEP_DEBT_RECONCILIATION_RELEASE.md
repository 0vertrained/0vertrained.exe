# 0VERTRAINED V16.9.0 — Sleep Debt Reconciliation

Field report, verbatim: *"In Whoop and Oura my sleep debt is minimal; in 0VERTRAINED I have 9+ hrs."* Reproduced on the reference export, root-caused to three compounding input errors, fixed, and pinned. The reconciled number lands where the wearables do.

## The three causes

**1. The need figure was tonight's prescription, not a nightly requirement — and unstable.** The dashboard summed all four components of Whoop's `sleep_needed` (baseline + *their own debt-repayment loop* + strain + nap adjustment) and used whichever day the latest-date walk-back landed on as the bar for **all seven nights**. That full figure is Whoop's tonight-specific target; on the reference export it swings **4.5h → 9.8h day to day**. Every hour of need error multiplies ×7 across the window: identical sleep read **4.4h of debt** when the walk-back landed on a 7.8h-need day and **16.3h ("Significant")** when it landed on a 9.7h-need day. The user's 9+ was this lottery. Including Whoop's debt component also double-counted debt by construction — their number already *is* repayment. Now: `baseline_milli` only (their learned personal need — steady at 7.6h across all 13 export days), taken as the **median across the window**, never a single-day read.

**2. Naps repaid nothing.** Whoop's need explicitly deducts for naps; Oura counts all sleep in daily totals. Our ledger counted main sleep only — a 1.4h nap on the reference export credited zero. New `napSleepDurationSeconds()` (non-main, non-deleted docs) credits the slept side for **debt accounting only**. HRV/RHR baselines keep the V16.6 main-sleep discipline untouched — that rule is about signal comparability, not hours.

**3. The personal-norm floor manufactured debt for sub-7h sleepers.** Fallback baseline clamped at 7.0h; the reference user's median is 6.4h → ~4h/week of phantom deficit whenever the wearable need was absent. Floor lowered to **6.5h** (matching the wearable-need clamp's lower bound). The original pin's intent survives: a genuinely deprived 6.0h stretch still clamps *up*, and the 9h ceiling still refuses to normalize itself.

## What the user sees

Reference week, before → after: **4.4h "Mild" (or 16.3h "Significant" on an unlucky sync) → 1.3h "Well-rested"** — versus Whoop's own debt component of 0.0–2.1h. The debt row now explains its math on the surface: `1.3h · Well-rested · vs 7.6h baseline need (Whoop)/night · naps credited`. The composite score is untouched (debt never was an input); training readiness and the verdict's sleep limiter now key off an honest figure, so the "Ceiling · sleep debt" limiter stops firing on phantom hours.

## Verification

New suite `sleepDebtReconciliation` (7 tests): the 4.4h/16.3h lottery reproduced and forbidden (dashboard source can never again sum `need_from_*` components; median-of-baselines pinned), nap credit including split-night mains and deleted-doc exclusion, the 6.5 floor with the healthy-6.4h-sleeper case, and stability across sync timing. One V16.6 pin updated honestly (floor 7 → 6.5, intent preserved and strengthened). Facade export added (`src/oura.js`) — caught by the build step of the gate. **136 test files passing, lint 0 errors, production + demo builds green, dist secret scan clean.** Static deploy, no migrations.

## Flagged

- The band thresholds (≤2 Well-rested / ≤5 Mild / ≤10 Moderate) were tuned when phantom hours inflated everyone; with honest inputs they may now be *lenient* — worth revisiting once a few weeks of reconciled numbers accumulate.
- Whoop-only users (no Oura) still get no debt figure — the ledger is Oura-sleep-driven. Same product call as the Whoop-only scoring gate, tracked together.
