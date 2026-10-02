# 0VERTRAINED V17.0.0 — Day Zero Edition

First release of the V17 arc. The conversion surface: a cold visitor's first minutes now open onto designed specimens instead of empty panels. Time-to-first-value is the metric; every decision below serves it.

## What a new user sees

Each tab with no real data renders a **specimen** — a hand-curated sample of that surface at its best, unmistakably stamped `SPECIMEN` in the masthead with the caption *"Sample week — yours replaces this the moment real data exists."* Below the plate: **exactly one action**, full-ink (the only full-ink element on the page), followed by an honest what-happens-next line:

- **Today** — a Push day plate with last-time ghosts and two exercises struck through → *Pick your program* — "Takes about two minutes… the first session is ready the moment you choose."
- **Recovery** — a FRESH 88 verdict block with evidence and a sparkline → *Connect Oura* — "Connecting takes about a minute. Your first verdict lands after tonight's sleep — and the trend unlocks after a week of mornings."
- **Fuel** — protein/calorie rows mid-day with a meal timeline → *Set your targets* — "Two numbers to start. The app learns your true burn from intake vs. weight trend within two weeks."
- **Progress** — a weight-trend plate, **no button**: `UNLOCKS AFTER 7 LOGGED DAYS — N TO GO`, in the Morning Edition calibration voice. Trends need a baseline of you first.

**Connected-but-empty Recovery** now frames itself: *"First sync running — your history usually lands in under a minute."* The first minute after OAuth never looks broken.

## The detector (`src/dayZero.js`)

Pure, and strict about what "zero" means: **meaningful content beats key existence.** Opening a day creates a blank `defaultDay()` shell — a shell never defeats the zero state; one logged set, meal, target, or weigh-in always does. Recovery zero requires *both* wearables absent. Demo mode counts as real data everywhere (the demo build's job is a full fake environment; specimens would fight it). Specimens render only when `loaded && isZero` — no boot flash — and the populated layouts are byte-identical (`no feature moves` guards pass untouched).

## One decision reversed, on the record

The plan said "absorb Tutorial.jsx and delete it." Implementation surfaced that **Tutorial is not a tour — it's the setup wizard**: it collects goal, macro preset, and program preset at signup, and its outputs are precisely what clear the Fuel and Today zero states for wizard-completers. Deleting it would have removed goal onboarding to satisfy a plan written on a wrong premise. Reversed: **the wizard stays; specimens are the per-tab activation layer after it.** Complementary, not duplicates — and a test now pins the wizard's survival so the plan's original instruction can't be "helpfully" re-applied later.

## Funnel (first-party, honest)

Four steps, queryable for the beta go/no-go: `dayzero_seen_{tab}` → `dayzero_action_{tab}` → `oura_connected` → `first_verdict_rendered`. Client: `src/funnel.js`, fire-and-forget, once per event per session, silent on every failure, disabled in demo mode. Server: `netlify/functions/log-event.js` on the house sink doctrine (JWT-verified — anonymous sinks are abuse magnets — fields clamped, per-user daily cap, fails open, and **tolerates a missing table with a 200**). The table itself is optional: `migrations/V17_0_events.sql`, run once in the Supabase SQL editor when you want numbers. RLS enabled with zero policies — service-role writes only, no client access. The funnel in one query is included in the migration's comments.

## Deploy notes

Static deploy as always. **Optional, not required:** run `migrations/V17_0_events.sql` to start collecting funnel numbers — the app and the endpoint are fully functional without it. No other steps.

## Verification

15-test suite `dayZeroEdition`: the detector matrix (shell vs. content, per-tab triggers, demo override, the Progress countdown), mounted specimens (stamp, caption, **exactly one button** that fires, curated content rendered, zero buttons on Progress), and App wiring guards (loaded-gating on all four tabs, populated render intact in the false branch, wizard survival, funnel terminus, first-sync line). One rules-of-hooks violation caught by lint during the build — the funnel effect initially sat below App's early returns — relocated above all of them. **137 test files passing, lint 0 errors, production + demo builds green, dist secret scan clean.**

## Next in the arc

V17.1 — Ledger Lines: the `MethodLine` primitive (V16.9's debt row generalized), swept across TDEE, readiness, load zone, and muscle-volume classifications; undo toasts on deletions; the offline stamp in Session Mode.
