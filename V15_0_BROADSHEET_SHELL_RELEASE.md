# 0VERTRAINED V15.0 — Broadsheet Shell + Today Spread

First slice of the desktop arc (plan: `DESKTOP_BROADSHEET_PLAN_V15.md`, mockup direction 1a). At ≥1440px the shell widens into the ruled three-column broadsheet; **below 1440px every layout is byte-identical to V14** — the new wrappers are `display:contents`, verified by the shell guard tests.

## The tier (decision D1, as approved)

New `BROADSHEET_QUERY` (≥1440px) alongside the existing 1024px desktop tier. `--ovt-shell-width` widens the app shell to `min(1856px, 100vw − 48px)` at the tier while `--ovt-content-width` deliberately stays 760px — sheets, session overlays, and toasts keep the reading-column contract (mockup 1r is itself a centered 760px plate). The width-contract test grew assertions pinning both facts.

## Masthead (decisions D2/D3)

- **The wordmark θ is now a real glyph.** `S.wordmarkTheta` has asked for Newsreader italic since V13 — but Newsreader ships no Greek, so every browser has been substituting a system serif. `src/ui/WordmarkTheta.jsx` embeds the outlined lowercase theta from STIX Two Text Italic (wght 500, the scientific-publishing serif — extracted with fontTools from the OFL variable font), rendering at 1em in `currentColor` so the existing style token keeps controlling size and ink. Pixel-identical on every platform, both themes.
- **D3 resolved better than proposed:** the shipped masthead already prints `No. {dayOfYear}` — and the mockup's "No. 193" *is* July 12's day-of-year. The designed semantic was the existing one; my "days since first entry" proposal is withdrawn. A date chip (`Sat · Jul 12 2026`) joins it at the broadsheet tier.
- **Context strip** (broadsheet only): today's program day plan · logging target | `Streak N days` via the existing `calcStreak`. The mockup's "Week 3 of 6 · Build" chip needs program-phase metadata that doesn't exist yet — deferred rather than faked, noted for the program-builder work.

## Today spread (mockup 1a)

Three `<section>` wrappers group the existing contiguous blocks into the mockup's columns — decision rail (PR flash · first-week card · decision hero · vitals) · session ledger (Strava suggestion · workout, **expanded by default at the tier**) · telemetry (Fuel/Recovery rows · check-in). Nothing moves in the source, no write path changes; at mobile widths the wrappers vanish (`display:contents`). The mockup's desktop-only telemetry plates (load model, wearable load, tomorrow outlook) are V15.1 scope — they need data wiring this shell slice deliberately excludes. Other tabs render centered at 760px inside the widened shell until their spreads land (V15.1–.2).

## Validation

Full gate: 117 test files (7 new across the shell guard + extended width contract: tier value, contents-fallback count, column recipe, section inventory, outlined-glyph provenance, non-Today centering, shell/content var separation), lint 0 errors, both builds, secret scan — green. No migrations, no env changes.
