# 0VERTRAINED V16.8.0 — Morning Edition

The recovery tab learns to say what it means. V16.6/V16.7 made the data honest; this release makes the *interpretation* honest — and legible to someone who has never read a sports-science paper. Everything new feeds one verdict block. Zero new widgets.

## What a user sees now

Opening Recovery in the morning, top plate, in reading order:

1. **Check-in** — four tap rows (SLEPT · SORE · STRESS · ENERGY, three options each). Sits *above* the verdict so you rate how you feel before the number can tell you how to feel. Never required, never blocking.
2. **State × trajectory** — `ABSORBING LOAD 81 →  steady`. The multi-day state is the headline; the daily score keeps its meaning but stops pretending every ±5 wobble is news.
3. **The action** — the resolver's one instruction, unchanged in position and doctrine.
4. **Evidence deck** — why, in plain sentences: "HRV has averaged 6% below your normal range this week. Resting heart rate is holding — one system is coping, one is complaining." Never a z-score.
5. **Context** — "Scheduled: Pull. Recently loaded: Legs (1d)." (program day + muscle recency, exception-based — no body map).
6. **Divergence, when it exists** — feel-vs-metrics disagreement said out loud, both directions, silence otherwise.
7. **"What does this mean? +"** — one tap to WHAT / WHY / NOW in plain language. The only place technical vocabulary is allowed.

## The engine underneath (`src/wearables/recoveryTrend.js`)

**Acute vs chronic, finally split.** The daily composite is a single-morning read; on the reference export it ran 77→88→90→81 across four ordinary days — physiologic noise that teaches users to ignore the number. The trend layer computes the 7-day rolling lnRMSSD against a ~4-week personal baseline with a smallest-worthwhile-change band (0.5 × trimmed SD — Plews & Buchheit's construction). User-facing name: **"your normal range."** You versus you, never a population chart.

**Six named states, multi-day evidence only** (windows are the anti-flap mechanism; no single-morning triggers): *Calibrating · Fresh · Steady · Absorbing load · Accumulating fatigue · Deload advised*. Each carries evidence sentences and a WHAT/WHY/NOW meaning block. One trap is encoded explicitly: **parasympathetic saturation** — HRV *elevated* while RHR climbs under a high-load block is a known overreaching signature that a naive scorer grades as a great morning; it classifies as Deload advised with its own explanation.

**Gated deltas.** The score arrow (↗/→/↘) appears only when today's move clears the user's own noise band (0.5 × trimmed SD of their score history, floor 3). Inside the band the label is "steady" — the number can change without the story changing.

**Calibration is honest and specific.** Below 7 mornings: "4 of 7 mornings recorded — 3 more nights to unlock your trend," never a fake verdict. Days 7–13 classify with a visible "baseline forming" hedge. Devices are never mixed in one series (V16.0 doctrine): Oura main-sleep HRV is primary, Whoop recovery HRV is the fallback series when Oura is thin.

## The check-in (`src/checkinMorning.js`)

**One source of truth.** Taps write 1–10 values to the *existing* entry body fields (`sleepQuality/soreness/stress/energy`) that TodayTab and `manualRecovery` already use; numbers typed on Today snap to the nearest tap here. Cleared inputs (empty strings) read as unanswered — never as "answered with zero" (which would false-flag "slept poorly" on an untouched morning; pinned by test).

**Caution-only, per the V13 resolver doctrine** — and a deliberate revision of the earlier "fifth ledger row worth 10–15 points" sketch. Points-fusion would have changed the composite's meaning mid-history and broken comparability with every past morning and the sparkline. Instead: two independent rough answers (or an illness/injury flag) demote the training call one step with a named limiter — "Limiter · your check-in." A great check-in never raises the call. **The score itself is never modified**: physiology stays physiology, the subjective row keeps you honest rather than handing out passes.

**Divergence transparency** (the Saw & Gastin finding operationalized as copy, not math): score ≥72 with a rough check-in → "You feel rougher than your metrics look… ease into the first sets." Score <55 feeling great → "…suppressed overnight signals usually collect their debt tomorrow." Agreement stays silent.

## Supporting changes

- **Sparkline overlay** (`whitepaper.jsx`): optional second series — the 3-point rolling trend drawn faint and dashed *behind* the daily line, sharing one min/max scale so the two are honestly comparable. Trend lives where the eye already goes; no new chart.
- **35-day Oura window** on the Recovery tab feeds the chronic baseline; scoring pools still slice at 15, so the headline score is byte-identical to V16.7.
- **Typography as confidence**: provisional (pre-check-in) and calibrating states render the state name in dim ink with an explicit tag; "Deload advised" signals through weight, not color (red stays error-only, per the design constitution).
- Resolver signature gains an optional `checkin` param — fully backward compatible; every pre-existing resolver test passes untouched.
- `no feature moves` holds: all additions live inside the existing verdict plate; broadsheet guard tests pass unchanged.

## Verification

On the reference export: state **Steady** (rolling HRV −4.5%, band position −0.70), delta ↗ +6 legitimately clears the gate, a simulated rough check-in demotes Push→Train with the named limiter, and the divergence line reads correctly. **135 test files / 1,470+ tests passing** (3 new suites: `recoveryTrend` — every state's entry conditions, saturation trap, calibration copy, delta gating, device purity; `checkinMorning` — field sharing, snap-to-tap, severity ladder, caution-only resolver behavior, score purity, empty-string guard, divergence matrix; `morningEdition` — reading-order anatomy, prop wiring, provisional ink, mounted overlay-sparkline geometry). Lint 0 errors, production + demo builds green, dist secret scan clean. Static deploy, **no migrations, no deploy steps**.

## Flagged for next

- **Load-response coupling** (the moat): with V16.7's correctly-dated load now accumulating alongside recovery, ~3–4 weeks of data unlocks "expected fatigue vs unexplained suppression." The trend module's evidence array is where it plugs in.
- **Push notifications**: "morning edition ready" at sync-time and state-*transition* pushes ("Absorbing load → Fresh") — server scheduling work, deliberately out of this release.
- **Sunday edition**: weekly broadsheet (trend review, load-response ledger, one change for next week) — the retention ritual the newspaper metaphor was born for.
