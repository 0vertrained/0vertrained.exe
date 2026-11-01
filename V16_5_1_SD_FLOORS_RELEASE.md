# 0VERTRAINED V16.5.1 — Hotfix: Physiological SD Floors

Real-data report post-deploy: recovery 37 on an ordinary morning — HRV 8/35, RHR 3/25, sleep 11/25 (+ full temp = exactly 37, 4/4 basis, so renormalization was innocent).

## Root cause

The V15.6 leave-one-out fix removed an **accidental safety net**: the old contaminated pool inflated the SD. Excluding today, a consistent athlete's tight prior pool can carry near-zero sample SD — and `zScore` guarded only `sd === 0` exactly. A routine −6% HRV night or +3 bpm RHR morning divided by a sliver-SD read as |z| > 2.5–3 and cratered the anchors. The correctness fix exposed a missing robustness guard; both were real.

## The fix

Physiological SD floors at all four z sites (Oura HRV/RHR, both Whoop rungs): **lnRMSSD floor 0.05 (~5% CV), RHR floor 1.5 bpm** — normal night-to-night noise, so the floors only engage on unnaturally flat pools. Floored HRV days say `· sd floored` in the detail row, so the math keeps showing its work. Genuine crashes still saturate: the −33% crash repro reads z < −3 through the floor, and every V15.6 sensitivity contract still passes — pinned in both directions in `sdFloors.test.js` (routine dip ≥ 16/35 and ≥ 9/25; real crash ≤ 8 and real spike ≤ 6).

## Honest expectation

Tomorrow's score should read like your wearables again on an ordinary morning. If it's still low, check the detail rows — post-floor, a low number means the deviation is *real* relative to your own baseline, which is precisely what the metric is for.

**485/485 suites · 1,404/1,404 tests · 0 failed**, lint 0, both builds green. Static deploy, no migrations.
