# 0VERTRAINED V15.6 — Intelligence Correctness (audit F1/F2/F5/F6/F8)

Implements the correctness tier of `WEARABLE_INTELLIGENCE_AUDIT.md` with your calls locked in: fixed Oura-first ladder reserved for V16.0, permanent methodology transparency over a one-time banner, flag-only load sentinel for V16.1.

## F1 · Leave-one-out baselines (HRV + RHR)

The z-score pools *included the day being scored* — today dragged the mean toward itself and inflated the SD, systematically muting real deviations. Both pools now use the prior window only, and HRV confidence is graded on prior-sample count. The pinned repro is stark: fourteen stable nights then a crash to 42ms now reads **z ≈ −20** with a 7/35 score — the crash *registers*. (RHR's trimmed mean had softened extremes but not moderate contamination; same fix applied.)

## F2 · Missing ≠ worst-case (renormalized recovery score)

A night with no HRV contributed 0/35 — absence graded as catastrophe, hard-capping the score at 65. The score is now points over the maxima of signals that **actually reported** (same 0–100 scale, same bands), the ledger keeps uncounted rows visible with a `counted` flag so exclusions are inspectable, `reconciles` verifies the normalized identity, and a permanent **"Scoring basis"** row (e.g. `3/4 signals (rhr+sleep+temp) · normalized`) sits in the Recovery detail — your Q2 call, transparency over toast. If *nothing* reported, the honest answer is now `score: null` / `insufficient_data` — never worst-case — with the legacy readiness and recommendation paths guarded to skip rather than grade it.

## F5 · Whoop day-boundary (server + client)

Main-sleep records (nap === false) now key on their **end** — the wake date — matching Oura's convention, in both `whoop-auth.js` (the row writer) and the client normalizer. A 22:30 start was keying the night to the previous calendar day, skewing every cross-source join by one. Naps keep start-date; cycles/recovery untouched. Existing rows keep their old dates until resynced; the V16.0 arbitration layer will read post-fix rows.

## F6/F8 · Legacy retirement + annotation

`estimateTDEE` (endpoint-weight × 3500 — water noise as signal) deleted from module and facade; the V11 adaptive TDEE in Fuel is the only TDEE. F3 turned out **already half-resolved** — the legacy readiness display was previously removed (its state is destructured away); `calcTrainingReadiness` survives solely as the recommendation overlay's input, now fed honest z-scores and honest sleep debt, with full engine unification deferred to V16.0 as planned. The `ouraMapped` zScore-0 path is annotated as by-design.

## Validation

Full gate green. 122 test files (+1: six contracts with both F1 repros pinned — including a deliberately *varied* stable-fixture after the first draft proved that a flat pool making any deviation significant is correct behavior, not a bug). No migrations, no env changes; deploy includes functions (whoop-auth changed).

Next in the arc when you call it: **V16.0 — the arbitration layer** (per-metric ladders, within-source baselines, Whoop entering HRV/RHR/sleep as declared fallback rungs).
