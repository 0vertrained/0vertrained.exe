# 0VERTRAINED V17.3.0 — The Courier

Final release of the V17 arc. Scheduled pushes that carry **headlines, never numbers** — closing the re-engagement loop the Morning and Sunday Editions opened.

## The three sends

All hourly-cron'd (`:15`, offset from the reminders' `:30`), all gated on each **subscription's local clock** via the per-device `tz_offset_minutes` (the V12.1 push-reminders pattern — half-hour zones like India land correctly, legacy null offsets behave as Central):

- **The Morning Edition** — local 07:xx, *only after today's sleep row has landed*: `"The Morning Edition — Steady. Run the plan as written."` Deep-links to Recovery.
- **State change** — same run, only when today's state differs from a state recorded **yesterday**: `"Steady → Fresh."` Consecutive days only — a stale state never manufactures news, and calibrating never transitions in either direction.
- **The Sunday Edition** — local Sunday 17:xx: `"The Sunday Edition is out. Your week, one page — and the one change for the next."`

## Hard rules, all pinned

**No data → silence.** No sleep row for the user's local today means skip, not nag — "no data yet" is never a notification. **Calibrating never pushes** — a countdown is app copy. **No digits anywhere** in any payload (tested character-by-character across every payload and action snippet): a score in a lock-screen banner is exactly the number-first framing the whole arc exists to retire. **Idempotent by construction**: `push_log`'s `UNIQUE(user_id, date, type)` is claimed with `resolution=ignore-duplicates` *before* any send; a missing table fails **closed** (nothing sends blind, nothing double-sends). **`push_state` records today's truth even when nothing is sent**, so tomorrow's transition check always has yesterday.

## The mirror contract

House doctrine (V16.6/16.7): functions **mirror** src logic rather than importing across the bundle boundary. `_recovery-mirror.js` carries verbatim copies of the main-sleep rules, the trimmed statistics *including their small-sample quirks* (the <5-value untrimmed fallback, sample n−1 stdDev — parity lives in these details), and the trend ladder under the courier's operating conditions (`loadZone`/`sleepDebt` = null, Oura only). The drift alarm is `courierMirrorParity.test.js`: eight raw-row fixtures — calibrating, steady, fresh, accumulating, deload, nap-noise, a borderline SWC edge — through both classifiers, states asserted equal. Change the src trend or normalization modules and that test names the fix. Documented consequence: **"Absorbing load" is unreachable server-side** (it needs client-side load context), and the action-snippet map is pinned to exactly the reachable states.

## Client

NotificationsCard grows two per-type switches under the master toggle — *The Morning Edition* and *State changes* — optimistic with honest revert, applied across **all the user's devices** (a preference is a person's, not a phone's) via a new JWT-verified `prefs` action on push-subscribe. Pre-migration, the courier's pref select falls back to all-enabled (the push-reminders fallback pattern) and the card surfaces a soft "not available yet."

## Deploy notes

1. **Run `migrations/V17_3_courier.sql`** (Supabase SQL editor): creates `push_state` + `push_log` (RLS enabled, zero policies — service-role only) and adds `edition_enabled`/`transitions_enabled` to `push_subscriptions`. Until it runs, the courier degrades safely — but no editions send (claims fail closed), so run it with the deploy.
2. Env unchanged — the courier reuses the existing VAPID trio + Supabase service credentials.
3. The scheduled function registers automatically from its exported `config.schedule` on deploy.

## Verification

23 tests across two suites: `edition-courier` (morning/Sunday windows across whole-hour, half-hour, and legacy-null offsets; midnight date rolls; the full transition matrix; the digit-free copy doctrine; claim-before-send order, fail-closed claims, data-ready gate, calibrating skip, state-recorded-regardless, prune-on-410, prefs plumbing) and `courierMirrorParity` (eight-fixture parity + the reachable-states pin). Gate note: partition 1 outgrew the sandbox's 110s window and is now split [a-c]/[d-l]. **141 test files passing, lint 0 errors, both builds green, dist secret scan clean.**

## The V17 arc, closed

Day Zero (conversion) → Ledger Lines (trust) → The Sunday Edition (retention) → The Courier (re-engagement). Every number defends itself, every state explains itself, every push carries a headline, and the funnel is measurable end to end. Flagged for the next arc: load-response coupling (the engine moat — its display surface in the Sunday Edition is already waiting), the Whoop-only scoring gate, and revisiting the sleep-debt bands once reconciled numbers accumulate.
