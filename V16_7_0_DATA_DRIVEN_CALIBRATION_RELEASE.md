# 0VERTRAINED V16.7.0 — Data-Driven Calibration

Second pass over the same real 14-day dual-wearable export that drove V16.6.0. Where V16.6 fixed what was *broken* (naps scored as nights, nondeterministic grouping, dead code paths), this release fixes what the data shows is *miscalibrated* — and validates the engine against both devices' own scores while doing it.

## Calibration audit (the numbers)

Running the fixed engine day-by-day (as-of-that-morning prefix maps) against the devices' own composites:

| Comparison | Pearson r |
|---|---|
| Engine ↔ Oura readiness | **0.793** |
| Engine ↔ Whoop recovery | **0.677** |
| Oura readiness ↔ Whoop recovery | 0.765 |

The engine correlates with each device about as well as they correlate with each other — it sits *between* them, which is exactly where a multi-source arbiter should sit. Cross-device HRV agrees to a mean |Δ| of **3.8%** (the 15% conflict threshold is well placed). Cross-device RHR shows a **+5.8 bpm systematic offset** (Whoop above Oura, every single day) — which exposed F3 below.

## Fixes

**F1 · Evening workouts were filed under the wrong day — 9 of 20 in the export.** Server date-keying used UTC prefixes; any timestamp after 7 p.m. CDT crosses UTC midnight. An evening lifter's entire training history shifts a day: the export's 8:33 p.m. Monday lift was stored as Tuesday. `toLocalDateKey` now shifts every candidate timestamp by the record's own `timezone_offset`; main sleeps key on local wake date. Replayed against all 62 export rows: exactly the 9 evening workouts move, nothing else.

**F2 · Cycles get an explicit wake-day rule, and recoveries date via their cycle.** A Whoop cycle starts at *sleep onset* (~23:00 local), so naive local-keying would file every cycle under the night before — and the old UTC keying was only right *by accident at UTC−5* (it inverts at eastern offsets: a 23:00 JST bedtime keys to the bed day). `pickCycleDate` keys local(start)+1 day for evening starts, same day for past-midnight starts — correct at any offset, robust to late bedtimes (local(end) keying was tried and rejected: two export cycles have past-midnight next-bedtimes that would file the waking day one late). Recovery records carry no window and no offset of their own; the sync now runs two passes and dates each recovery through its `cycle_id`.

**F3 · One manual re-sync self-heals the historical mis-dated rows.** The upsert conflict key includes `date`, so corrected re-syncs insert *new* rows while the wrong-dated originals remain — an evening workout would double-count across two days. `groupWhoopRows` now dedupes by `(data_type, external_id)` across all dates first, keeping the freshest copy (latest `updated_at`, then later date). **Deploy note: open the app and run one manual Whoop sync after deploying; the 14-day window rewrites at corrected dates and the client silently drops the stale copies.**

**F4 · Whoop load fill: strain summing → zone-minute sRPE.** Whoop strain is a logarithmic 0–21 scale and is not additive: the export's five-workout day summed to 17.9 strain → **626 load**, on a day whose actual cycle day-strain was 4.1 (two of those "workouts" were the previous evening's, leaking in via F1 — the bugs compounded). Zone minutes ARE additive and present on every synced workout. Load is now Σ zone-minutes × sRPE-equivalent weight (z0–z5 → 1, 2, 4, 6, 8, 9.5), landing on the manual model's exact currency (load = sRPE × minutes; 60 min of Z2 = 240, same as a logged RPE-4 hour). That day now fills at **260**. Strain×35 stays as the fallback for zone-less legacy records; fill notes name the sports ("weightlifting, walking · 74 min") now that `sportName` flows through normalization.

**F5 · Conflict detection is baseline-relative for HRV/RHR.** The V16.0 doctrine — "devices carry systematic offsets; compare against the same device's own history" — stopped at the scoring engine. The conflict detector still compared raw cross-device values, so Whoop's definitional +5.8 bpm RHR offset fired a "minor RHR conflict" on essentially every dual-device morning: a standing false alarm that also dragged metric confidence. HRV and RHR now compare each device's *deviation from its own trimmed baseline* (leave-one-out, ≥4 days, matching the engine); a conflict means the devices disagree about how today differs from normal. Raw values are still carried for display; absolute comparison remains the fallback below 4 baseline days; recovery and sleep-duration conflicts stay absolute (same-scale quantities). On the export: the daily RHR false alarms vanish; the honest disagreements (recovery-composite gaps on 07-05 and 07-13, one real 67-minute sleep gap on 07-11) still surface.

**F6 · Robust spread: one crash night no longer masks the next real dip.** The 07-05 HRV crash (37 ms in a ~72 ms pool) inflated the plain ln-SD from ~0.15 to ~0.24 — so the genuinely low 07-14 morning (−16% HRV, which **both** wearables graded down: Oura 72 with a cratered recovery index, Whoop 43) read as z −0.45 and 30/35 here. `trimmedStdDev` (0.1 trim, mirroring `trimmedMean`) now pairs with the trimmed center at all five baseline sites (Oura HRV, Oura RHR, both Whoop rungs). Simulated across every day of the export before shipping: ordinary mornings move ≤1 point, 07-14 reads z −1.09 → 21/35, the crash day itself still saturates. Headline on the export: **90 → 81 (good_to_train)** — between the devices instead of above both. The V16.5.1 physiological SD floors are untouched and still guard the tight-pool side.

**F7 · Smaller revivals and honesty.**
- `resp_elevated` could never fire: V2 readiness has no `respiratory_rate` — it lives on the sleep doc as `average_breath` (present on every main sleep in the export). Sleep is now the primary source; the readiness field stays as legacy fallback.
- Nap-skip transparency: when a newer calendar day exists whose only record is a nap, the provenance line says so — "Oura's newest record (2026-07-15) is a nap — naps don't grade recovery, so this is last night's verdict. Tonight's sleep will update it."
- Cold-open snapshot grades against *personal* baselines: the prefetch function already holds 30 days of the user's rows but graded HRV against a fixed 70 ms and RHR against 50 bpm — meaningless constants for a 45 ms- or 95 ms-baseline athlete. It now derives trimmed main-sleep baselines from the fetched window (≥4 samples; constants remain the cold-start fallback).

## Verification

Replay of the new date rules against all 62 export rows: 9 workouts re-dated, 0 sleeps/cycles/recoveries moved. Engine headline 81 good_to_train on 2026-07-14 (HRV 21/35 · RHR 24/25 · Sleep 21/25 · Temp 15/15). Zero RHR false conflicts across 12 dual days. Zone loads: five-workout day 626 → 260; 60 min Z2 = 240 exactly.

**132 test files / 1,441 tests passing** (2 new suites: `whoopLocalDateKeying` — evening lift, JST inversion, past-midnight cycles, cross-date dedupe both orders; `dataDrivenCalibration` — zone additivity, the 626-repro, offset-vs-divergence conflicts, crash-masking repro, resp revival, nap provenance). Lint 0 errors, production + demo builds green, dist secret scan clean. Static deploy, no migrations — **but run one manual Whoop sync after deploy** (see F3).

## Flagged, not changed

- Recovery scoring remains gated on the Oura token; a Whoop-only user gets no score despite the arbitration rungs existing. Product decision.
- `calcSleepQualityIndex` has no UI callers; its `timingScore` placeholder (bedtime variance) is unimplemented. Oura's `sleep_regularity` contributor and Whoop's `sleep_consistency_percentage` are both in the stored payloads if it ever ships.
