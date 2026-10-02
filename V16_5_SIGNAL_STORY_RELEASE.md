# 0VERTRAINED V16.5 — The Signal Story (mixed-device days, made felt)

V16.0 made mixed-device days *correct*; this makes them *legible*. Four improvements from the "what if one wearable has no data" discussion, shipped together.

## 1 · Provenance at the verdict

`src/wearables/signalProvenance.js` builds one sentence rendered as an `AdvisoryNote` inside the verdict block, both shells: *"Oura had no data last night — HRV scored on Whoop. (3/4 signals)"*. Cause attribution is deliberately conservative and contract-tested: **"had no data" only when the day object is wholly absent**; a day with docs but a missing field says "no HRV reading" — inferring behavior from partial data would be overclaiming. Full 4/4 days with both devices present render nothing: silence is the default.

## 2 · Insufficient days bridge, not dead-end

The null-score state now says what the decision engine already believed: *"Log this morning's check-in and the verdict runs on your subjective inputs until a device reports."* Manual-only was always a valid mode; now the UI routes you into it.

## 3 · The sync race, named

When a connected device has prior days but nothing for today, the note says so — *"Whoop hasn't reported today yet — the score may update after its sync"* — so a number that quietly changes at 9am stops looking haunted. Symmetric for Oura when Whoop carried the day.

## 4 · Strava rung for the sentinel

`findUnloggedLoadDays` gains a second evidence source: on days Whoop is silent, a synced run ≥ ~3 miles with zero logged load still flags (`{date, source: "strava", miles}`). One flag per day — Whoop's strain detail wins when both report, contract-pinned. Both advisory sites render either shape and the copy generalizes to "unlogged-load". Recovery's batch adds `loadStravaActivities(14)` (single-flighted, near-free); Today's plate reuses its existing `stravaByDate`.

## Validation

**483/483 suites · 1,400/1,400 tests · 0 failed** (JSON-verified), lint 0, both builds green, hard-pattern secret sweep clean outside test fixtures. Two new files, +7 contracts (five provenance including the conservative-attribution pins, two sentinel). Static deploy, no migrations. The flag shape gained a `source` key — the shape-pin test was updated deliberately, which is that guard doing its job.
