# 0VERTRAINED V17.1.0 — Ledger Lines

Second release of the V17 arc. The trust pass: **every number defends itself.** The sleep-debt incident (V16.9) generalized — the app's author couldn't explain a figure his own app showed, so now no figure gets to stand without its method.

## The primitive

`MethodLine` (whitepaper.jsx): one annot-vocabulary line of method directly under a figure, with an optional tap-to-expand detail in the Morning Edition `details/summary` pattern. Three disclosure registers now coexist deliberately, each with a job: **MethodNote** for static footnotes, the **ⓘ toggle** (ReadinessMethodToggle) for section headers, **MethodLine** for the number itself. Jargon is allowed only inside expandables — the visible line stays plain.

## The sweep

- **TDEE** (EnergyIntelligence) — the existing ledger line ("From your own ledger: 2,910 kcal avg intake, trend −0.9 lb over 14 days — not a formula estimate") becomes the method, with new depth one tap down: why measured beats Mifflin/Katch, the energy-balance arithmetic in one sentence, and what it silently absorbs (NEAT, training, metabolism).
- **Training Load** (Recovery) — ACWR stops being unexplained jargon. Method: *"ACWR = this week's load against your own 28-day norm · load counted in effort-minutes across lifting and cardio."* The expandable explains the shared sRPE/zone currency (V16.7's model) and what ~1.0 vs ~1.3 means, in plain words.
- **Muscle volume** (Progress) — the footer's compressed gloss becomes a MethodLine whose expandable defines the three landmarks without acronym-first framing: MEV as "the minimum weekly sets that reliably produce growth," the MAV band as "where most productive training lives," MRV as "the most you can recover from — past it, more sets subtract." Closing stance: *"a map, not a rulebook: your recovery data above is the tiebreaker."*
- **Recovery ledger provenance** — audited and found already covered by the V16.5 transparency work (raw wearable value, scoring source, sample depth, sync freshness). Not duplicated; pinned by test so the coverage can't silently regress.
- **Sleep debt** — unchanged; it was the reference implementation.

## Offline confidence

Session Mode grows a self-contained connectivity listener (no prop threading) and, when signal drops, a header stamp: **`OFFLINE · SETS SAVED ON THIS PHONE · SYNCS WHEN SIGNAL RETURNS`**. The offline retry queue has existed since V8 — but silence reads as risk, and basement-gym logging must *feel* safe, not merely be safe. Clears the moment connectivity returns.

## Two scope decisions, on the record

**Undo toasts: dropped — no wiring target exists.** The plan assumed day-to-day delete affordances (sets, meals, entries). Implementation inventory found none: the app is edit-in-place by design, and the only destructive actions are account-level, correctly guarded by ConfirmDialog. Shipping `showToast({ undo })` infrastructure with zero consumers would be scope theater. A test pins the finding, with a comment noting that undo-toasts are the agreed pattern *if* a future release adds deletion affordances.

**Readiness sweep target: already covered.** The plan listed readiness points for the sweep; the codebase already had `ReadinessMethodToggle` doing exactly that job at the section level. Extended nothing, invented no rival — consistency beats novelty.

## Verification

10-test suite `ledgerLines`: the primitive mounted (method always visible, detail hidden until toggled, no-detail renders a plain line, no-method renders nothing), all three swept surfaces pinned with their copy anchors, the three-register coexistence guard, the offline stamp's markup + a mounted connectivity harness flipping it both ways, and the undo-drop decision pin. **138 test files passing, lint 0 errors (36 pre-existing warnings, baseline held), production + demo builds green, dist secret scan clean.** Static deploy, no migrations, no deploy steps.

## Next in the arc

V17.2 — The Sunday Edition: the weekly overlay (state timeline, load ledger, exceptions-only volume digest, divergence diary, THE ONE CHANGE), built on the MethodLine primitive under every figure. Publish moment: Sunday 5pm covering Mon–Sun, per the plan's recommendation.
