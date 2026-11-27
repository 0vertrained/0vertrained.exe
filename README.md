# 0VERTRAINED

A private training ledger for hybrid athletes. Log or import training, recovery and nutrition, and get one
evidence-based verdict each morning on how hard to train today. It runs as a progressive web app at
[0vertrained.netlify.app](https://0vertrained.netlify.app); a seeded demo with no account is at
[/#/demo](https://0vertrained.netlify.app/#/demo).

## What it does

- **One verdict a day.** Readiness is computed from the athlete's own baselines, with each limiter (sleep debt,
  illness, overreaching load, a rough check-in) able to make the call more cautious and never less. The
  reasoning is shown, with each signal's source.
- **Wearables as evidence, not decoration.** Oura and Whoop are read per metric through a fallback ladder,
  baselined within each device (devices carry systematic offsets, so no cross-device averaging), with
  leave-one-out baselines and physiological floors so a quiet athlete's ordinary night doesn't read as a crash.
  Strava supplies training load.
- **Training that follows the verdict.** Program presets for strength, running and two-a-day athletes; a
  set-by-set workout runner with drop sets and rest-pause; RIR-aware e1RM trends with stall detection; a
  per-muscle weekly volume audit; a race-plan generator with paces.
- **Fuel.** Adaptive energy targets from the intake-versus-weight-trend ledger, a USDA food search and a
  meal-plan preview.
- **A coach that cites its evidence.** Server-routed model calls (Ollama Cloud) over an inspectable evidence
  packet, with deterministic safety rules the model cannot override, daily usage caps and telemetry that
  stores no prompts or responses.
- **Scheduled pushes** ("The Courier") that carry headlines, never numbers, timed to each device's local clock.

## How it's built

React 18 and Vite on the client; Supabase (Postgres, auth, row-level security) for data; Netlify Functions for
everything that needs a secret (OAuth with the wearable providers, token encryption, the coach, pushes, error
and event logging). The client never holds a provider token or a service key.

```
src/                  the app: tabs, the recovery engine (src/wearables, src/recovery), programs, fuel, coach
src/__tests__/        unit and mounted tests (vitest)
netlify/functions/    serverless endpoints and scheduled jobs; netlify/tests/ covers them
supabase/             schema.sql and the migrations, in the order the migration_* names suggest
public/               the PWA shell, service worker, icons and legal pages
scripts/              the quality gate, test runner, icon generation, version sync
docs/                 the provider integration standard and the coach deployment runbook
CHANGELOG.md          one entry per release
```

### Security model

- Every table has row-level security; the client talks to Supabase with the anon key and a user session only.
- Functions verify the caller's Supabase JWT server-side and never trust a user id from the request body.
- Provider OAuth tokens are stored encrypted (AES-256-GCM) with the key held by Netlify; plaintext token
  tables were dropped once the cutover completed.
- Account recovery uses a PBKDF2-derived phrase hash with versioned KDF parameters and atomic rate-limit
  buckets by username and address.
- Scheduled functions are not publicly routable; the one external scheduler endpoint checks a shared secret.
- The CSP allows only the app's own origin and the provider APIs it talks to; the quality gate scans the
  production build for secrets before every deploy.

## Running it

Node 22 (`.nvmrc`).

```bash
npm ci
npm run dev            # Vite dev server
npm test               # the whole vitest suite
npm run quality:gate   # tests, lint, production and demo builds, secret scan: what CI runs
```

The client reads `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY` and
`VITE_USDA_API_KEY` at build time; `VITE_DEMO_MODE=true` builds the seeded demo, which needs none of them.
The functions read their configuration from the Netlify environment (Supabase service role, provider client
ids and secrets, VAPID keys, the token encryption key, the Ollama key, `OURA_SYNC_SECRET`); see the comment
at the top of each function for what it needs. Apply `supabase/schema.sql`, then the migrations, in the
Supabase SQL editor.

## Replay the training algorithms

Run the replay from a Git checkout with a current Node 22 release. It compares the working tree with the
pre-change `ios` commit `b39cdcbf41dc03a1647dd39e345088b15c5169aa`. Both versions run locally on the same
dated entries. If a shallow checkout lacks the baseline, fetch it once with
`git fetch origin b39cdcbf41dc03a1647dd39e345088b15c5169aa`.

```bash
npm run replay:algorithms
npm run replay:algorithms -- --input ~/Downloads/athlete_data_2026-10-18.json
npm run --silent replay:algorithms -- --input ~/Downloads/athlete_data_2026-10-18.json --through 2026-10-11 --json > replay.json
```

The first command uses one fictional athlete over 42 days. The fixture includes 15 comparable lifting sets,
four captured recovery decisions, four weekly reviews and a day with two workouts and overlapping device
records. It exercises specific changes. Evaluating training benefit would require outcomes from athletes
who actually trained under each prescription.

For your own history, open **Profile → Your data → Export full backup (JSON)** and substitute that file's path.
The replay reads the backup locally. The default cutoff is the last dated entry or import. `--through` sets an
inclusive cutoff, including follow-ups after the last logged day. Run in the athlete’s time zone (for example,
`TZ=America/Denver npm run replay:algorithms`) for timestamped sets near midnight. `--json` includes day-by-day and
per-exercise comparisons. The normal backup contains daily entries. For a local dataset with separate device
records, the runner also accepts an object with `entries` and a `wearables` object containing date-keyed
`stravaByDate`, `whoopData` and `ouraData` maps.

| Comparison | How to read it |
| --- | --- |
| Strength | The old engine, current engine and repeating the last session each propose a load for the same set slot. Mean absolute error measures distance in pounds from the load the athlete chose. Rep attainment uses only attempts at the exact suggested load. Effort needs both a recorded target and logged reps in reserve. The comparison covers completed, loaded straight sets. Older backups can lack a saved plan, so the replay then infers the prescription shape from a prior session. |
| Recovery | Both resolvers start with the saved Today call and the same captured morning inputs. This isolates how each version combines the call and the wearable verdict. Older decisions without a usable snapshot have no paired result. |
| Training load | Each pair shows end-of-day load and minutes reconstructed from the sessions available in that input. Session identifiers and start times help distinguish a duplicate import from a second workout. Sparse backups can leave session identity or duration uncertain. |
| Fuel | Each pair shows whether the available intake and weight history supports an expenditure estimate as of that date. The current engine needs enough confirmed whole-day food logs. Partial days and legacy logs awaiting confirmation can therefore yield fewer estimates. |
| Weekly coaching | The following seven calendar days form the outcome window. **Pending** means it has yet to close. **Unknown** means follow-through or enough relevant measurements are missing, or the recommendation cannot be scored. Only assessable outcomes enter the favorable rate. |

A backup preserves the current values of past entries. When an older measurement or import lacks its original
recording timestamp, the replay can place it on its logged date but cannot reconstruct when the app first saw
it or recover its value before a later edit.

## Status

In active development toward a beta, by one person. Copyright © Rami. The source is published to be read;
it is not offered under an open-source license.
