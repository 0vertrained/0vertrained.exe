# 0VERTRAINED V15.4 — Session Desktop (arc complete)

Final slice, sequenced last deliberately: Session Mode is the surface used mid-set at a gym, so the pattern shipped on five lower-stakes surfaces first.

## Session spread (mockup 1q)

At the tier, the full-viewport session composes `380px | 1fr | 420px`. **Queue** (left, new, tier-only): every exercise in the session with live set counts, DONE state, and click-to-jump via the existing `setIdx` — the same navigation the footer arrows drive. **Set ledger** (center): the existing scroll region, byte-for-byte untouched — hero, superset controls, set grid, hints, folds, all of it. **Intelligence rail** (right, tier-only): plate math, the full warm-up ramp, and rack-taken substitutions, always open — re-presenting the *same computed values* (`calcPlateMath`/`buildWarmupRamp`/`getSubstitutions`) the mobile folds show, with zero state coupling. The mobile folds themselves are untouched and guard-asserted. Wake-lock, rest timer, set-type cycling, auto-advance, and every write path: unchanged. One defensive read to note: the rail lists `subs.options || []` — if the substitution engine's list field is named differently, the rail degrades to pattern-only rather than crashing; worth an eyeball on first desktop session.

Session complete (1r) required no work: it's a centered 760px plate by the content-width contract established in V15.0 — the mockup and the shipped contract agree.

## The arc, closed

V15.0 shell → V15.1 Recovery/Fuel → V15.1.1 hotfix → V15.2 Progress → V15.3 surfaces → V15.4 session. Every slice below 1440px byte-identical by construction, every spread guard-tested, both themes free via tokens. Deferred with tracking, not faked: Profile hub (1l), Form workspace (1o), Overview's third column (1h), per-item Fuel ledger, theme miniatures, "Week N of M" chip.

## Validation & debt

Full gate green (7/7): 119 test files, lint 0 errors, both builds, secret scan. **Mounted-smoke debt from V15.3 remains open** — palette, two-pane, and this session spread have static guards only; the mounted pass is the first item of the next engineering session, alongside the gate-script exit-code fix flagged in V15.3. No migrations, no env changes. Deploy 15.3 then 15.4, or 15.4 directly (it contains 15.3).
