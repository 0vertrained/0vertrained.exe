# 0VERTRAINED V15.1 — Recovery + Fuel Spreads, Today Telemetry

Second slice of the desktop arc. Same guarantee as V15.0, now test-pinned per surface: **below 1440px, layout is byte-identical to what shipped** — Recovery's mobile branch renders the exact V13 audit order (technical-details fold included), and Fuel's wrappers are `display:contents`.

## Recovery spread (mockup 1e/1f — closes audit item 6.3)

The 18 figure blocks were lifted verbatim into named consts so the two shells compose the *same blocks* differently. Mobile: the untouched V13 order, with intelligence/ledger/quality/load/alert-history still folded behind "Technical details". Broadsheet: verdict + interpretation + what-changed + context (left, 480px) · readiness hero + wearable intelligence + component ledger + training load + alert history (center) · signals + mixed-signal + wearable QA + data trust + source summary + Oura quality + Whoop context (right, 440px) — and the fold button doesn't exist on the spread, because the spread *is* the unfolded view. That's the "verdict first, audit alongside" reading order 6.3 asked for, in both themes for free. No figure, write path, or calculation changed.

## Fuel dock (mockup 1g, scoped honestly)

At the tier, Log view becomes `1fr | 460px`: the execution column (hero · quick add · next meal) left, and the **manual macro/hydration ledger — FoodSearch inside it — docked permanently right**, open by default with the fold toggle hidden. Plan view is untouched. The mockup's *per-item* meal ledger (individual food rows with macro columns) requires a logged-items data model that doesn't exist — that's a feature, not a layout, so it's tracked in the plan rather than faked here.

## Today telemetry plates (the V15.0 deferral, paid down)

Four display-only plates fill the telemetry rail, broadsheet-only and never on past-day logs: **Fuel still needed** (kcal remaining, protein gap, logged/target), **Load model** (acute 7d · chronic 28d · A:C ratio from the existing `loadModel.js` EWMA pipeline, plus a 14-day load sparkbar; renders an honest "insufficient history" note under ~2 weeks of sessions), **Wearable load** (Whoop strain via `buildWhoopSummary`, Oura activity kcal/steps — defensive reads, rows hide when absent), and **Tomorrow outlook** (next program day + planned lift count, or "Rest day scheduled — recovery is the work"). All pure derivations over data already in scope; deliberately un-memoized after the React Compiler rejected the memo shapes — they're O(days), cheaper than the bookkeeping.

## Validation

Full gate: 117 test files (guard suite +4: Recovery fold-vs-spread semantics including "the broadsheet branch never renders the fold button", Fuel dock + hidden toggle + grid recipe, plate inventory + gating, and the updated three-tab centering rule that correctly *failed* when the wrapper changed — the guard doing its job), lint 0 errors, both builds, secret scan — green. No migrations, no env changes.
