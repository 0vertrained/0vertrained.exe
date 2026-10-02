# 0VERTRAINED V16.3 — Rhythm & Primitives (UX audit U6–U9)

Second slice of the UX consistency plan: pure consistency work, near-zero behavioral risk, now guard-locked so it can't drift back.

**U6 · Rail tokens.** Content rails come in exactly two sizes now — `--ovt-rail-s: 440px`, `--ovt-rail-m: 480px` — swapped across Today, Recovery, Fuel (its lone 460 normalized to `rail-s`), and every Progress spread. Session (380/420) and Settings (300) stay literal, as mockup-mandated. A new guard pins the token set and asserts no rogue rail width can drift in; the V15.0 content-width guard was modernized from a one-line regex to substring pins when the `:root` block went multi-line.

**U7 · One vertical rhythm.** The section-gap primitive (`flex column · gap 12 · minWidth 0` at tier, `contents` below) now applies to **every** spread wrapper — it was on 3 of 23. Recovery, Fuel, Progress, and Session inter-block spacing now matches Today's instead of depending on each block's incidental margins.

**U8 · `AdvisoryNote`.** The advisory style that forked at birth in V16.1 (10.5px vs 9.5px, two hand-rolled ⚠ notes) is now one primitive in `ui/primitives.jsx` — dim ink over a hairline rule, a `compact` variant for plates, never red (red stays reserved for errors). Both sentinel sites migrated; scoring-basis and future data-quality notes have one home.

**U9 · PR flash spans the spread.** The celebration banner escapes the 480px decision rail at the tier (`gridColumn: 1 / -1`) and leads the whole spread. One honest note: on mobile it renders in the identical flow position but one DOM nesting level shallower — visually byte-identical, structurally a hair different, disclosed here because the arc's guarantee has been byte-level.

Full gate green, 125 test files. Static deploy, no migrations. **This closes V16.2 + V16.3 of the plan; V16.4's six items are feature-scoped with named blockers and are deliberately not stubbed here — see the handoff note.**
