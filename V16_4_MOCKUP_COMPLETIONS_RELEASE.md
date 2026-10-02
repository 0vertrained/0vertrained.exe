# 0VERTRAINED V16.4 — Mockup Completions: Overview 3-Col + Form Workspace

The two highest-value items from the V16.4 backlog, each previously blocked, each unblocked properly rather than worked around. The remaining four (Profile hub 1l, per-item Fuel ledger, theme miniatures, week-chip) stay named in the plan — the ledger in particular is a data-model feature, not a layout.

## Overview third column (mockup 1h, finally complete)

The blocker was the planning-tools `DisclosureBlock` — stateful chrome the V15.2 section boundary couldn't cut. The fix is the **Recovery V15.1 fold pattern**: the disclosure is *mobile chrome*, and at the tier the spread IS the unfolded view. Three groups (`ovTrendsChunk`, `ovPlanningGroup`, `ovFiguresGroup`) were lifted verbatim; mobile composes them in the exact V13 order with the fold intact; the broadsheet distributes them — verdict rail left, **figures center**, **trends + planning right** — under the V16.3 rail tokens (`m / 1fr / s`). Guards pin both facts: the groups exist, and the tier branch contains no `DisclosureBlock`.

## Form workspace (mockup 1o)

The blocker was the "three-return seam" — which dissolved on fresh mapping: the results are a single trailing `<ResultCard>` inside the main return. At the tier the screen splits `1fr | 560px`: capture stage left, findings docked right with an honest hint plate until an analysis lands; below the tier both wrappers are `display:contents` and the flow is byte-identical. The App overlay wrapper widens to `min(1360px, 100%)` for this screen only — the V15.3 content-width centering was correct for a reading column and wrong for a workspace. And because `FormCheck` takes zero props, the mounted smoke was free: it renders split at the tier with the hint present.

## Validation

Tests: **1,393 passed, 0 failed** (JSON-verified after the batch runner outgrew the sandbox's single-command ceiling — the suite itself is fine; the runner's batching is a CI convenience this environment doesn't need). Lint 0 errors; production and demo builds green; secret scan satisfied via direct hard-pattern sweep (`sk-ant`/private-key/AKIA classes — only a test fixture matches), disclosed here because the named scan script wasn't invocable in-sandbox this pass. Static deploy, no migrations.

**This closes the UX consistency plan** — V16.2 correctness, V16.3 rhythm, V16.4's top two completions — and with it, every open engineering thread from this arc. What's left in the backlog is feature work, and the highest-value next move remains the one from before the arc began: beta invites.
