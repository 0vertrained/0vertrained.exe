# 0VERTRAINED V16.1 — Unlogged-Load Sentinel + Engine Relocation (audit closed)

Final item of `WEARABLE_INTELLIGENCE_AUDIT.md`. With this, every finding from the sweep the sleep-debt bug triggered is shipped or deliberately deferred with a name.

## F7 · The sentinel (flag-only, per your Q3 call)

A day with high Whoop strain and zero logged load was invisible to the ACWR — the chronic denominator quietly understated, and the verdict could green-light onto hidden fatigue. `findUnloggedLoadDays` now flags such days as a **data-quality note**: the threshold is *personal* (median Whoop strain of days you actually logged, ≥5 samples, floored at 10 so easy days never flag; absolute-14 fallback on thin history), and the flag carries only `{date, strain, threshold}` — deliberately nothing injectable. Surfaces: the Recovery **Training Load** figure lists the flagged days verbatim ("⚠ 2 unlogged-strain days in 14d … the A:C ratio understates true load. Flag only; nothing is injected."), and the Today load-model plate carries a one-liner at the broadsheet tier. Wearables suggest; you decide whether those days get logged.

## Naming debt · engine relocated

The recovery engine — multi-source since V16.0 — now lives at `src/wearables/recoveryEngine.js` with an honest header. The old `src/oura/algorithms.js` is a **six-line compatibility shim** (`export * from …`), so every existing import, test, and the facade keep working untouched; new code imports the new path. The relocation guard asserts the shim stays a shim.

## Validation

Full gate green (7/7). 124 test files (+1: four sentinel contracts — the strain-16 repro with a rest day correctly *not* flagged, the thin-history absolute bar at exactly 14, the flag-only shape pin, quiet no-whoop behavior — plus the relocation guard). No migrations, no env changes, static deploy.

## The audit ledger, closed

F1 leave-one-out baselines ✓ V15.6 · F2 renormalized scoring ✓ V15.6 · F3 single verdict (found pre-resolved; engine unification noted) ✓ · F4 arbitration layer ✓ V16.0 · F5 wake-date keys, server+client ✓ V15.6 · F6 legacy TDEE deleted ✓ V15.6 · F7 sentinel ✓ V16.1 · F8 annotations ✓ V15.6. Deferred with names: full legacy-readiness unification into the decision engine, and optional strain→sRPE conversion (crosses the suggest/decide line — parked unless you ever want it).
