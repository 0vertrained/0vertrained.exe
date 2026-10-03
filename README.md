# 0VERTRAINED

A private training log for lifters and hybrid athletes: log workouts, check in on recovery, track progress, and get one answer each morning for how hard to train.

> **Status.** `v19.2.1` is the live app. A redesign (**v20**, a streamlined, gamified workout tracker) is being built on this branch in phases. See [v20 redesign](#v20-redesign-in-progress) below. This README documents how to run and operate the app as it is today; it is rewritten for v20 at launch.

**Stack:** React 18 · Vite 8 · Supabase (Auth + Postgres with row-level security) · Netlify (static hosting + Functions) · Vitest · installable PWA.

---

## Getting started

```bash
nvm use            # Node 22 (see .nvmrc)
npm ci
cp .env.example .env   # fill in at least the Supabase values
npm run dev
```

**No backend?** `VITE_DEMO_MODE=true npm run dev` runs the app against a mock Supabase client with a seeded, deterministic 140-day dataset (`src/demo/demoDataset.js`). No signup, no writes.

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Production build into `dist/` (the `prebuild` hook stamps the version into `public/sw.js`) |
| `npm test` | Every test file once (`vitest run`) |
| `npm run test:watch` | Vitest in watch mode |
| `npm run lint` | ESLint (errors fail, warnings inform) |
| `npm run verify` | lint → test → build |
| `npm run quality:gate` | tests (with the domain coverage floor), lint, typecheck, production build, size budgets, style discipline, generated-file checks, demo build, secret scan of `dist/`, artifact check (what CI runs; the last build is the demo build, so `dist/` ends up as the demo) |
| `npm run test:e2e` | Playwright browser specs against the production build (`npm run build` first); phone and desktop viewports, guest mode only |
| `npm run check:budgets` | Size budgets on the last build: `/next` initial JS ≤ 120 KB gzip, total ≤ 250 KB, fonts ≤ 120 KB |
| `npm run check:styles` | v20 tree only: no hex outside the tokens, no static inline styles, no text under 12px |
| `npm run gen:tokens` | Recompiles `src/design/tokens.css` from `src/design/tokens.json` (tests fail when it is stale) |
| `npm run eval:coach` | Offline routing/safety checks for the AI coach (`-- --live` calls the model; needs `OLLAMA_API_KEY`, writes to `artifacts/`) |

CI (`.github/workflows/ci.yml`) runs the quality gate on every push and pull request. Netlify runs `npm test && npm run build`, so a failing suite never deploys.

---

## Environment variables

`VITE_*` values are compiled into the browser bundle and are **public**. Never put a secret behind a `VITE_` prefix. `.env.example` lists every variable the code reads.

### Client (build-time, public)

| Variable | Needed for | Notes |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Everything except demo builds | The anon key is safe to expose; RLS enforces row ownership |
| `VITE_DEMO_MODE` | Demo build | `true` → mock client + seeded data |
| `VITE_AUTH_EMAIL_DOMAIN` | Optional | Domain for synthetic login emails (default `athlete.app`); see [Auth](#auth) before changing |
| `VITE_USDA_API_KEY` | Food search | Without it, search uses the local food list only |
| `VITE_VAPID_PUBLIC_KEY` | Push | Same value as `VAPID_PUBLIC_KEY` |
| `VITE_COACH_USER_ID` / `VITE_COACH_OPEN` | Coach visibility | Shows the Coach entry to one user id / to everyone (`true`). The server still enforces access |

### Server (Netlify Functions, secret)

| Variable | Needed for |
|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | All functions (JWT verification + service-role writes) |
| `TOKEN_ENCRYPTION_KEY` (alias `CONNECTED_ACCOUNT_ENCRYPTION_KEY`) | Any wearable/Strava connection. AES-256-GCM, `openssl rand -base64 32`. **Set before anyone connects**; integrations fail closed without it, and losing/rotating it forces users to reconnect |
| `OURA_CLIENT_ID`, `OURA_CLIENT_SECRET`, `OURA_REDIRECT_URI` (optional override), `OURA_SYNC_SECRET` | Oura (the secret authorizes the hourly prefetch) |
| `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`, `WHOOP_REDIRECT_URI` (required) | Whoop |
| `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REDIRECT_URI`, `STRAVA_WEBHOOK_VERIFY_TOKEN`, `STRAVA_WEBHOOK_SUBSCRIPTION_ID` (optional) | Strava |
| `GOOGLE_HEALTH_CLIENT_ID`, `_CLIENT_SECRET`, `_REDIRECT_URI`, `_WEBHOOK_SECRET` | Google Health / Fitbit (disabled in the UI; the webhook fails closed without its secret) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push |
| `OLLAMA_API_KEY`, `COACH_ALLOWED_USER_ID`, `COACH_ENABLED`, `COACH_DAILY_LIMIT` (default 60), `COACH_EXPOSE_MODEL`, `COACH_ROUTING_MODE`, `COACH_MODEL`, `COACH_{FAST,MAIN,DEEP,FALLBACK}_MODEL`, `COACH_{FAST,MAIN,DEEP,FALLBACK}_TIMEOUT_MS` | AI coach |
| `FORM_CHECK_API_BASE`, `FORM_CHECK_API_KEY`, `FORM_CHECK_MAX_BYTES` (default 100 MB) | Form check proxy |
| `LOG_ERROR_DAILY_CAP` (default 200), `LOG_EVENT_DAILY_CAP` (default 50) | Per-user telemetry caps |

`SECRETS_SCAN_OMIT_KEYS` lives in `netlify.toml` and **overrides** the dashboard variable of the same name; edit it in the file. List only genuinely public values there, and never mark public config as a secret in the Netlify UI.

---

## Database (Supabase)

Three tables carry the product: `entries` (one row per user per local day, JSONB payload), `program` (one JSONB weekly program per user) and `profiles` (username, recovery-phrase hash, JSONB settings). Everything else supports integrations, the coach, push, telemetry, account recovery and social features. RLS restricts every user to their own rows; privileged writes go through Functions with the service role.

### Fresh database: migration order

The SQL files have no runner. Apply them in this order in the SQL editor (each as one transaction). This order was verified on Postgres 16 with a stub auth schema.

1. `supabase/schema.sql`. Its last statement grants on `public.program` before that table exists: delete that line (or run statement-by-statement); step 2 grants it again.
2. `supabase/migration_add_program.sql`
3. `supabase/migration_add_settings.sql`
4. `supabase/migration_patch_setting.sql`
5. `supabase/migration_add_recovery_salt.sql`
6. `supabase/migration_add_oura.sql` (**not idempotent**, run once)
7. `supabase/migration_patch_oura_data_read_only.sql`
8. `supabase/migration_patch_oura_tokens_server_only.sql`
9. `supabase/migration_v27_beta_hardening.sql`
10. `supabase/migration_add_whoop.sql`
11. `supabase/migration_add_wearable_sync_events.sql`
12. `supabase/migration_add_social.sql`
13. `supabase/migration_patch_social_opt_in.sql`
14. `supabase/migration_add_social_signals.sql`
15. `supabase/migration_add_social_circles.sql`
16. `supabase/migration_add_push_subscriptions.sql`
17. `supabase/migration_add_beta_visibility.sql`
18. `supabase/migration_v28_usage_hardening.sql`
19. `supabase/migration_add_wearable_snapshot.sql`. **Must precede 20–21**: each redefines `delete_my_account_data()` as a superset of the last.
20. `supabase/migration_add_provider_standard.sql`
21. `supabase/migration_add_strava_google_health.sql`. **Required fix:** its `provider_oauth_state` CHECK allows only `('google_health','strava')`, but Oura stores `'oura'`; widen the CHECK or Oura connect fails.
22. `supabase/migration_add_account_recovery.sql`
23. `supabase/migration_v29_signup_hardening.sql` (manual verification block in its footer)
24. `supabase/migration_v30_recovery_kdf.sql`
25. `supabase/migration_v32_recovery_rate_limit.sql`
26. `supabase/migration_v33_perf_indexes.sql`
27. `migrations/V17_0_events.sql` (optional funnel events)
28. `migrations/V17_3_courier.sql` (needs step 16)
29. `migrations/V19_0_coach_model_runs.sql` (coach telemetry/feedback; the coach works without it)
30. *Optional, last:* `supabase/migration_v31_drop_plaintext_tokens.sql`. Run only once `oura_tokens`/`whoop_tokens` are empty, and note that `delete_my_account_data()` still references those tables afterwards.

### Admin levers (SQL)

```sql
-- Signup cap (default 5 users, enforced by a trigger on profiles)
update public.app_state set max_users = 100 where id = 1;

-- Grant AI coach access (alternative to COACH_ALLOWED_USER_ID)
insert into public.coach_access (user_id, enabled, monthly_limit, tier) values ('<uuid>', true, 300, 'standard');
```

Client errors land in `client_errors`: Supabase Table Editor, sort by `created_at`.

---

## Auth

- **Username + password.** Usernames map to a synthetic internal email `username@<VITE_AUTH_EMAIL_DOMAIN>` (default `athlete.app`). It is never contacted.
- **Supabase Auth email confirmations, magic links and SMTP must stay disabled.** `athlete.app` is a registrable domain this project does not own; with email features on, its owner could receive credential mail.
- **Password reset** uses the recovery phrase (PBKDF2, rate-limited) via `/api/account-recovery`, not email.
- **Moving the auth domain** is a coordinated flip: set `VITE_AUTH_EMAIL_DOMAIN` in the Netlify build env *and* run `node scripts/migrate-auth-domain.mjs --domain <yours>` (dry run, then `--apply`) immediately before that deploy. Login derives the exact email string, so both must change together.
- To run invite-only without code changes: Supabase "disable public signups" plus dashboard invites, or lower `app_state.max_users`.

---

## Deploying (Netlify)

- **Routing.** Each function declares its route with `export const config = { path: "/api/..." }` (or a `schedule`). Anything else falls through the `/* → /index.html` SPA rewrite and silently returns HTML; a test enforces this. `netlify.toml` only adds the `/api/account-recovery` redirect.
- **Never put test/spec or dotted filenames in `netlify/functions/`.** Netlify tries to deploy them (also test-enforced).
- **Scheduled functions** (registered from `config.schedule`): `wearable-prefetch` hourly at :00 (needs `OURA_SYNC_SECRET`), `push-reminders` at :30 (local 19:00 window), `edition-courier` at :15.
- **CSP** lives in `netlify.toml` headers (not in `index.html`). Add any new browser-side origin there.
- **Smoke checks after a deploy:** `POST /api/log-error` returns JSON (not HTML); an unauthenticated `POST /api/form-check/analyze` returns 401.

### Integrations

- **OAuth callbacks** must match each provider console exactly: `https://<domain>/api/{oura|whoop|strava|google-health}/callback`.
- **Strava**
  - The webhook subscription is a one-time manual step: register `https://<domain>/api/strava/webhook` with `STRAVA_WEBHOOK_VERIFY_TOKEN`.
  - API Agreement terms: Strava data is for the authenticating athlete only (no leaderboards or social use) and never for AI/ML, so it is excluded from coach payloads (`ai_eligible=false`).
  - Attribution is required ("Powered by Strava" plus a "View on Strava" link to `https://www.strava.com/activities/{id}`).
  - Deauthorization must purge the athlete's data. Forged events are verified against Strava before anything is deleted.
  - Default rate limits are about 100 requests per 15 minutes and 1,000 per day.
- **Google Health / Fitbit** is disabled (`GOOGLE_HEALTH_INTEGRATION_ENABLED=false` in `src/SettingsScreen.jsx`). If it is re-enabled:
  - Keep the `google-site-verification` meta tag in `index.html`; domain ownership depends on it.
  - Keep the Limited Use disclosure in three places: the landing page, the privacy policy and the `<noscript>` block.
  - Complete the consent-screen checklist: support email, homepage at the root URL, privacy URL, Search Console property, scopes, demo video.
- **Form check** proxies `/api/form-check/*` to an **external pose engine that is not in this repo** (`FORM_CHECK_API_BASE`). Never set `VITE_FORM_CHECK_*`.
- **Web Push**
  - Setup: run `npx web-push generate-vapid-keys`, set the three `VAPID_*` vars plus `VITE_VAPID_PUBLIC_KEY`, and apply the push migration.
  - iOS delivers push only to Home-Screen-installed PWAs on 16.4+.
  - Test by triggering `push-reminders` from the Netlify Functions console.
- **AI coach** (Ollama Cloud)
  - Kill switch: `COACH_ENABLED=false` returns 503 instantly with no deploy.
  - Rollback to a single model: `COACH_ROUTING_MODE=single` plus `COACH_MODEL=<model>`.
  - Live eval reports go to `artifacts/` (git-ignored).

---

## Versioning

`package.json` is the single source of truth. `vite.config.js` defines `__APP_VERSION__`, the `prebuild` hook (`scripts/sync-version.mjs`) stamps the service-worker cache name, and `versionSync.test.js` fails on drift. To release, bump `package.json` (`npm version x.y.z --no-git-tag-version`) and build.

## Testing notes

- Tests never see the deploy's configuration. Netlify hands every site variable to the build command (including `npm test`), and a local `.env` reaches Vitest too, so `src/test/hermeticEnv.js` clears every variable the app reads before each test file; a test sets what it needs.
- Vitest runs without globals, so React Testing Library files call `afterEach(cleanup)` themselves.
- Code that reads the current date must be tested with a pinned clock (`vi.useFakeTimers({ toFake: ["Date"] })` + `vi.setSystemTime`). Hard-coded fixture dates otherwise expire.

## Privacy and security invariants

- OAuth tokens never reach the browser; they are stored AES-256-GCM encrypted.
- Server functions derive the user from the verified JWT, never from a `user_id` in the request body.
- Telemetry stores no prompt or response content.
- Strava data never enters AI payloads.
- **Full backup** (Profile → Export Full Backup) reads every entry plus program and settings from the server into one versioned file; Import accepts it.

---

## v20 redesign (in progress)

v20 turns 0VERTRAINED into a streamlined, **gamified workout tracker**: *"Level up. Never overtrain."*

- **One loop.**
  1. Get today's quest, sized by a 5-second check-in.
  2. Log it a set at a time.
  3. Claim XP, records and streaks.
  4. Grow your level, rank (E→S) and stats (STR / END / VIT).
- **Safety built into the rules.**
  - XP is paid for training to plan, not for doing more.
  - Rest days and app-scaled days still count.
  - Missing a day never costs progress.
- **Streamlined.**
  - Three tabs (Quest · Stats · Profile).
  - A guest/demo mode with no signup.
  - Wearables, AI coach, nutrition, form check, social and push are removed. They remain recoverable from the `v19.2.1` history.
- **Seamless for existing users.**
  - The same username/password accounts and the same Supabase project.
  - History is read in place; unused legacy data is preserved, never destroyed.
- **Engineering.**
  - Typed (TypeScript) domain core with property-tested game rules.
  - CSS-module design system.
  - Offline-first sync with conflict merge.
  - CI-gated deploys.

#### Where the new app lives today

The v20 app is served **beside** the live app until cutover: `src/main.jsx` is a ten-line router that loads `src/app/main.tsx` at `/next` and the untouched v19 entry (`src/legacy/boot.jsx`) everywhere else. Each side is its own lazy chunk, so `/next` never loads the legacy fonts, CSS, error reporting or Supabase client. `/next` carries an `X-Robots-Tag: noindex` header, and the service worker precaches every built chunk (`sw-assets.json`) so both apps open offline after one visit.

- **Design system.** "Chalk & Brass": `src/design/tokens.json` (copied verbatim from the design-system artifact) compiles to `tokens.css`; `kit.css` is the reference stylesheet (`ot-` classes); every component in `src/design/` is a typed port of the reference bundle with an RTL + axe test. Dark theme ships; the light theme is defined and contrast-checked (`tokens.test.ts`) but not wired.
- **Guest mode.** `src/data/localSource.ts` keeps everything under the localStorage key `ovt-v20-guest`; nothing leaves the device. "Try the demo" seeds the ten-week character from `src/data/demo/seed.ts`; "Start fresh" runs onboarding. Accounts and sync arrive with the new backend.
- **What works at `/next` now.** Landing with the live tier playground, onboarding, the Quest tab with today's issued quest, the check-in sheet, and the status strip (rank, level, XP, streak, shields). The session runner, Stats and Profile are the next phases.

### Game rules

<!-- game-rules:start -->
_Generated from `src/domain/game/config.ts` (rules v1) by `npm run gen:rules`. Do not edit by hand._

**XP**

| Source | XP |
|---|---|
| Status check (3 of 4 rows answered) | +10 per day |
| Training quest | a weekly pool of 360 split across planned days: 2 days → 180, 3 days → 120, 4 days → 90, 5 days → 72, 6 days → 60 |
| …paid as | 60% pro rata by completion, plus 40% once completion reaches 80% (cleared). A full week is 360 training XP on any plan. |
| Engine-issued REDUCED day | the same share as FULL |
| Engine-issued RECOVER day | the full share for the first 1 in any 7 days, then +20 |
| Scheduled rest day, recovery done | +20 |
| Illness day | +10 check-in only; streak protected |
| Record | +25, at most 1 a day and 2 in any 7 days, after 3 prior exposures; never from extra sets or on a recovery day |
| Weekly quest | +50 per objective, +50 for both |
| Rank Trial passed | +300, once per rank |
| Imported v19 day with work | +100 flat |
| Extra sets, second sessions, training while ill or on a recovery day | 0 (records still saved) |
| Sets logged more than | 48 h after the day ends earn nothing |

**Reduced day**

One set less per lift (never below 1); cardio × 0.7, rounded to 5 min.

**Levels**

XP from level L to L+1 is 60 × L (cumulative 30 × L × (L−1)), capped at 99.

| Level | Total XP |
|---|---|
| 2 | 60 |
| 5 | 600 |
| 10 | 2,700 |
| 22 | 13,860 |
| 35 | 35,700 |
| 50 | 73,500 |
| 99 | 291,060 |

**Streak and shields**

A kept day is a cleared training quest, a scheduled rest day or a cleared recovery day. A shield is earned every 7 kept days in a row (2 at most) and is spent automatically on a missed day. Illness and paused days are protected and share an allowance of 14 days per 90. Missing a day never costs XP, level or rank.

**Ranks**

| Rank | Title | Level | Qualifying weeks | STR or END | VIT | Rank Trial |
|---|---|---|---|---|---|---|
| E | Recruit | 1 | 0 | 0 | 0 | no |
| D | Initiate | 5 | 7 kept days | 0 | 0 | no |
| C | Contender | 12 | 4 | 25 | 0 | yes |
| B | Veteran | 22 | 12 | 40 | 50 | yes |
| A | Elite | 35 | 30 | 55 | 60 | yes |
| S | Paragon | 50 | 60 | 70 | 70 | yes |

A Rank Trial is sub-maximal: 5 reps at 80% of your best estimated max (loaded lifts), reps at 80% of your best set plus a plank capped at 180 s (bodyweight), or 20 continuous minutes (cardio). At most one every 7 days, on a full-condition day. The displayed rank never decreases.

**Stats (0–100)**

- **STR**: best estimated max per strength group over 90 days, as a share of bodyweight, against elite ratios of squat 2.5, hinge 3, push 1.75, pull 1.75; the mean of the four groups.
- **END**: 60% weekly cardio minutes (450/week scores 100) + 40% longest session (180 min scores 100).
- **VIT**: over 28 days, 40 × check-in rate + 35 × sleep score + 25 × honoured rest. Calibrating for the first 7 days.
- A change within ±3 of the value 28 days ago reads as steady; drops are shown neutrally.

**Titles**

18 titles: one per rank above E and one per achievement.

| Achievement | Requirement | XP |
|---|---|---|
| First Quest | Clear your first training quest. | +50 |
| Calibrated | Check in 7 times. | +50 |
| Rest Is Training | Complete 10 rest-day recovery objectives. | +100 |
| Listener | Clear 5 reduced quests as issued, with the training done. | +100 |
| Full Week | Clear both weekly objectives in one week. | +100 |
| Unbroken I | A 7-day streak. | +50 |
| Unbroken II | A 30-day streak. | +150 |
| Unbroken III | A 100-day streak. | +400 |
| Record Breaker I | Set a record. | +50 |
| Record Breaker II | Set 10 records. | +100 |
| Record Breaker III | Set 50 records. | +250 |
| Long Haul | One cardio session of 60 minutes or more. | +100 |
| Century | Clear 100 training quests. | +250 |
<!-- game-rules:end -->

Each phase lands on this branch with the build, lint and full test suite green.
