# 0VERTRAINED V16.0 — Multi-Wearable Arbitration Layer (audit F4)

The audit's headline: Whoop was display-only — every computed signal was Oura-exclusive, so an Oura gap was graded as absence even with Whoop's same-unit data sitting in the database. The recovery engine is now multi-source, under the four principles as designed:

**Per-metric ladders, never device preference.** HRV: Oura sleep rmssd → Whoop recovery rmssd → readiness balance. RHR: Oura lowest-HR → Whoop RHR. Sleep: Oura staging → Whoop sleep-performance % (a direct, honest 0–25 map of Whoop's own need-relative grade) → readiness fallback. Every rung declares itself via `source`, which flows straight into the component ledger and detail rows — provenance visible per metric, per day.

**Baselines strictly within-source.** A Whoop fallback value is z-scored against *Whoop's own* leave-one-out history (F1 discipline carried over), never Oura's pool. The pinned test is the proof: Oura history at ~30ms, Whoop history at ~60ms, Whoop today at 60 → z ≈ 0. Pooled, that same reading would have registered as a massive fake spike — the exact device-offset failure the design forbids.

**Fallback fills gaps; it never averages.** Top rung wins outright when both report — pinned with an absurd 999ms Whoop value that must be, and is, ignored while Oura reports.

**Missing ≠ zero, compounding with V15.6.** A missing Oura sleep night that Whoop rescues is now a *counted* signal — `scoringBasis` reads 4/4 instead of excluding the row.

## Wiring, at zero marginal cost

Whoop joins the dashboard's parallel batch and the App-boot fallback via the existing single-flight layer — the calls collapse with the context-panel and TodayTab loads already in flight, so the ladder costs no additional network. Demo mode passes its seeded Whoop set, so the demo inherits the ladder too. The old RHR shim (Oura-missing → score exactly-at-baseline) is superseded by the Whoop rung and only applies when neither device reports.

## Naming debt, acknowledged

The engine still lives in `oura/algorithms.js` — historically named, now multi-source, documented as such in the module header. A `wearables/` relocation is cosmetic churn best batched with V16.1.

## Validation

Full gate green (7/7). 123 test files (+1: five arbitration contracts — the within-source pin, top-rung-wins, RHR whoop baseline, the counted-sleep rescue, and two-argument backward compatibility). No migrations, no env changes, no functions changes — static deploy. Data note: the ladder reads post-V15.6 wake-date Whoop rows; days synced before that fix arbitrate off-by-one until resynced, which V15.6's notes already flagged.

Remaining from the audit: **V16.1** — the flag-only unlogged-load sentinel, plus the `wearables/` relocation.
