# 0VERTRAINED V15.5.1 — Sleep-Debt Model Fix

Real-data report: the app showed **9h of sleep debt while both Oura and Whoop showed 0** — and because `calcTrainingReadiness` docks the verdict for debt (−1 over 3h, −2 over 5h), the phantom figure was actively suppressing the readiness score, not just mislabeling a row.

## Root cause (`calcSleepDebt`)

Two flaws compounding: a **hardcoded 8h baseline** (the wearables grade against a *personalized* need — a healthy 7.2h sleeper accrued ~5.6h/week of manufactured debt here), and **deficit-only summation** — surpluses never repaid anything, so within any window the number could only ratchet upward.

## The new model

Baseline, in priority order: the **wearable's own need figure** when the synced Whoop sleep payload carries `sleep_needed` (summed components, clamped to a sane 6.5–10h); else the **personal norm** — median of the full recent window, ≥5 samples, clamped 7–9h so a chronically deprived stretch cannot normalize itself; else 8h. Debt is **net**: deficits minus *half* of surpluses (recovery sleep repays, but one long night shouldn't erase a rough week), floored at zero. Bands and the readiness thresholds are unchanged — with an honest baseline they now fire only on real deprivation, which the tests prove still registers loudly.

The Recovery row now shows its work: `Sleep debt · 7d — 0.4h · Well-rested · vs 7.2h need` (or `norm`/`target`), so the number can always be interrogated against what the wearables claim.

One honest limitation: the Whoop-need path reads whatever your synced payloads contain — if your rows predate a sync-schema that captured `sleep_needed`, the model uses your personal norm (which converges on the same answer for a consistent sleeper) until fresher syncs land.

## Validation

Full gate green. 121 test files (+1: seven contracts, the **reproduction case pinned first** — the 7.2h sleeper that produced your 9h now reads Well-rested; real deprivation against any baseline still lands Moderate/Significant; surplus half-credit math; the clamp rules; safe empty shape). No migrations, no env changes.
