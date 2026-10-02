# 0VERTRAINED V16.6.0 — Main-Sleep Discipline

Reviewed the full algorithm stack against a real 14-day Oura + Whoop export (the reporting user's own). The V16.5.1 "recovery 37 on an ordinary morning" incident reproduced **exactly** on this data — and the SD floors were treating a symptom. The deviation was real; it was measured against the wrong kind of sleep.

## Root cause (F1): naps scored as nights

Oura keys naps to the calendar day they occur on. An afternoon `late_nap` synced before tonight's main sleep becomes the newest day's ONLY sleep doc, and the engine scored it as the recovery day: nap HRV/RHR (physiologically lower HRV, higher RHR — that is what naps are) against a main-sleep baseline. On the export: HRV 39 vs ~71 ms baseline → z −2.54 (8/35), RHR 68 vs 57.9 → z +2.98 (3/25), the 1.9 h nap graded as the night's sleep (11/25) → **37, consider_rest**. The last real night scores **90, ready_to_push**.

**Fix at the source of truth** (`src/oura/normalization.js`): `getSleepDoc` — the anchor for every scoring pool, alert, debt row, and raw-metric display — now returns MAIN sleep only (`type` long/main; untyped docs classified by duration ≥ 3 h; untyped + durationless legacy records get benefit of the doubt). Nap-only days drop out of `recoveryDates` unless readiness reported. `getAnySleepDoc` preserves nap visibility for display surfaces. The server snapshot (`wearable-prefetch.js`) mirrors the rule, so the cold-open card can't show nap numbers either.

## Shipped with it

- **F2 · Split nights count whole.** Oura recorded one night as two `long_sleep` docs (6.5 h + 4.3 h on the export); the primary-segment-only read dropped 4.3 h from the duration subscore and manufactured sleep debt. New `mainSleepDurationSeconds` sums main segments; HRV/RHR/staging still read the primary segment. Debt on the export: **6.2 h "moderate" → 0 h "well-rested"** — matching what the wearables themselves showed.
- **F3 · Whoop day-grouping is now deterministic.** Last-write-wins over unspecified within-date row order meant `day.sleep` was a coin-flip between the nap (perf 12 %) and the main sleep (perf 83 %) on 2026-07-11 — feeding the sleep fallback rung, a false "major" 473-min sleep conflict ("Mixed signal day"), and the Whoop cards. Selection is explicit (SCORED > main > longest in-bed > latest update, field-by-field comparator — a collapsed float rank loses the timestamp tie-break to precision); every sleep row retained in `day.sleepAll`.
- **F4 · RHR 3-day trend was inverted.** The pool is newest-first; `linearRegression` treats index as time. A genuinely rising RHR earned the +1 "falling" bonus and vice versa. Reversed to chronological.
- **F5 · Readiness verdict ran on the wrong inputs.** `calcTrainingReadiness` takes slopes/day (±0.02 ln, ±0.5 bpm bands); the dashboard fed today's HRV z-score and RHR delta, so ordinary single-day noise swung multi-day-drift factors (the nap morning read **Rest, −5**). New `hrvTrendSlopePerDay` / `rhrTrendSlopePerDay` supply real chronological slopes (export now reads **Train, +2**).
- **F6 · Oura activity load fill was dead code** — two independent breaks: `normalizeActivity` required the legacy `{activity:[…]}` wrapper (stored payloads are `{data:[…]}`) and returned snake_case while `ouraLoadForDay` read camelCase. 0 → 13 filled days on the export. `calories` canonically maps to ACTIVE calories (total includes ~2,300 kcal of BMR).
- **F7 · Sparkline scored with a different method than the headline.** Single-day recompute had no leave-one-out pool, silently falling to readiness contributors. Each point now scores a prefix map (all days ≤ that date, matching Whoop window) — the plotted value IS what the app said that morning.
- **F8 · Whoop need-hours lookup** read a state slot set by a different effect (empty on first compute) and only the newest date (workout-only before the morning sync). Reads the freshly loaded window and walks back to a date carrying `sleep_needed`.
- **F9 · Temp fallback + honesty.** `tempDeviation` reads the sleep-embedded `readiness.temperature_deviation` (V2 sleep docs carry no top-level skin-temp field); `calcTempScore` returns `deviationDate` so a prior-night reading is inspectable. Efficiency alert + `calcSleepQualityIndex` accept the V2 field names (`efficiency` already 0–100, `latency`) — the efficiency alert could never fire on stored payloads.

## Verification against the export

Scored day 2026-07-14 → **90 / ready_to_push** (HRV 30/35 · RHR 24/25 · Sleep 21/25 · Temp 15/15). Sleep debt **0 h**. Verdict **Train**. Whoop `day.sleep` identical under forward/reversed row order; no false major sleep conflicts; 13 Oura-filled load days; sparkline newest point equals the headline.

## Notes for future work (flagged, not changed)

- Recovery scoring is gated on the Oura token (`isConn`) — a Whoop-only user gets no score despite the arbitration rungs existing. Product decision needed.
- Server `pickRecordDate` uses UTC date prefixes; a record created after ~7 PM local (UTC−5) keys to the next day. Harmless for morning recoveries; worth revisiting with `timezone_offset`.

**131/131 suites (4 new: mainSleepDiscipline, whoopGroupingDeterminism, trendDirection, ouraActivityLoadFill) · 0 failed**, lint 0 errors, both builds green, secret scan clean. Static deploy, no migrations.
