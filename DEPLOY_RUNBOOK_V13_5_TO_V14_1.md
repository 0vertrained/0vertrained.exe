# 0VERTRAINED · Production Deploy Runbook — V13.5 → V14.1

One ordered checklist covering everything shipped since v13.4.1. Production is still running the pre-hardening build until this executes, which means: the form-check proxy is publicly open with your paid key attached, any beta user can rewrite the signup cap, and OAuth tokens sit in plaintext. Everything below deploys as **one release** (the code zips are cumulative — V14.1 contains all prior work).

---

## Phase 0 — Pre-deploy (do these BEFORE triggering the deploy)

**0.1 · Set `TOKEN_ENCRYPTION_KEY` in the Netlify environment.** ← the one hard prerequisite
The V14 token cutover fails closed without it: wearable connects, refreshes, and syncs will refuse (with clear errors) rather than store plaintext. Any high-entropy string works (32-byte base64 preferred): `openssl rand -base64 32`. If Strava or Google connections already work in prod, the key is already set — verify it exists anyway.

**0.2 · Verify Supabase email features are OFF.**
Dashboard → Authentication → Email: confirmations, magic links, and any SMTP config must be disabled. Synthetic auth emails live on `@athlete.app`, a domain this project does not control; email features would route credential mail there. (The permanent fix — the domain migration — is Phase 4, optional and separately scheduled.)

**0.3 · Confirm the env cleanup list.**
`OURA_STATE_SECRET` is no longer read (V13.6 moved Oura to DB-backed one-time state). Removable now or at leisure.

---

## Phase 1 — Database migrations (run in the Supabase SQL editor, in this order)

Run these **with** (immediately before) the deploy. All are idempotent and re-runnable.

| # | File | What it does |
|---|------|--------------|
| 1 | `supabase/migration_v29_signup_hardening.sql` | Locks `app_state` writes (any user could rewrite the signup cap); adds the server-side `BEFORE INSERT` cap trigger on profiles. |
| 2 | `supabase/migration_v30_recovery_kdf.sql` | Adds `profiles.recovery_kdf` so PBKDF2 and legacy SHA-256 recovery hashes coexist; legacy rows upgrade lazily on successful recovery. |
| 3 | `supabase/migration_v32_recovery_rate_limit.sql` | Replaces the racy recovery rate limiter with the atomic `ovt_bump_recovery_attempt` RPC + generic bucket table (username **and** IP dimensions). Drops the old ephemeral `account_recovery_attempts` table. |

**Do NOT run `migration_v31_drop_plaintext_tokens.sql` yet** — that's Phase 3.

After running v29, execute the manual verification block in its footer (impersonate an authenticated user; confirm `update app_state` is denied and the cap trigger fires).

Deploy-order safety: the code tolerates either order for v32 (it falls back to the legacy limiter until the RPC exists) and v30 (legacy hashes verify until upgraded). v29 should land with the deploy since the client now maps its trigger errors to friendly copy.

---

## Phase 2 — Deploy + smoke test

**2.1 · Deploy the V14.1 build** (zip contents → repo → Netlify deploy as usual).

**2.2 · Smoke checklist (10 minutes):**
- Log in with an existing account. App loads; no console errors.
- Settings → Integrations: Oura/Whoop status renders. If connected, hit "Sync now" — this exercises `resolveProviderTokens` and performs each user's one-shot legacy→encrypted migration.
- Settings → Account: set/rotate a recovery phrase (exercises the PBKDF2 path end-to-end).
- Attempt Form Check while signed in (should work) — then `curl -X POST https://<site>/api/form-check/analyze` with no auth header (should 401).
- Recovery flow: trigger one deliberate bad attempt (should get the generic mismatch), confirm `account_recovery_buckets` gained a `u:` and an `ip:` row.
- Watch `wearable_sync_events` for `token_refresh` failures mentioning `TOKEN_ENCRYPTION_KEY` — that's the Phase 0.1 misconfiguration signal.

**2.3 · Confirm the token drain has started:**
```sql
select 'oura_tokens' as tbl, count(*) from public.oura_tokens
union all
select 'whoop_tokens', count(*) from public.whoop_tokens;
```
Counts fall as users sync (the hourly prefetch touches every connected user, so expect near-zero within a day).

---

## Phase 3 — Deferred: drop the plaintext token tables (≥ 1 healthy cycle later)

When the Phase 2.3 query returns **0 / 0** (or only rows you've confirmed are dead connections via the who-remains query in the migration header):

| # | File | What it does |
|---|------|--------------|
| 4 | `supabase/migration_v31_drop_plaintext_tokens.sql` | Drops `oura_tokens` and `whoop_tokens` for good. |

No code change accompanies it — every V14 path already treats a missing table as "no row". There is deliberately no down-migration; a severed dead connection re-links via the normal OAuth flow in ~30 seconds.

---

## Phase 4 — Optional, separately scheduled: auth domain migration

Retires `@athlete.app` for a domain you control. Brief login outage between script and deploy (minutes at beta scale) — announce it.

1. Pick a domain you own (e.g. `ids.<yourdomain>.com`). It never receives mail; it just must be **yours**.
2. Set `VITE_AUTH_EMAIL_DOMAIN=<domain>` in the Netlify **build** environment (don't deploy yet).
3. Dry-run, then apply:
   ```bash
   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
     node scripts/migrate-auth-domain.mjs --domain <domain>            # dry run
   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
     node scripts/migrate-auth-domain.mjs --domain <domain> --apply
   ```
4. Trigger the deploy immediately after the script reports 0 failures. (Script is idempotent; re-run to retry partial failures.)

Until Phase 4 runs, Phase 0.2 (email features off) is the standing mitigation — re-verify it whenever you touch Supabase auth settings.

---

## Quick reference — migration files

**Run now, in order:** `migration_v29_signup_hardening.sql` → `migration_v30_recovery_kdf.sql` → `migration_v32_recovery_rate_limit.sql`
**Run later (after the drain check):** `migration_v31_drop_plaintext_tokens.sql`
**Never run as-is:** everything older (`schema.sql` and pre-v29 migrations are already applied in prod; all files remain idempotent if re-run by accident).

## Rollback posture

Rolling the code back to v13.4.1 after the migrations is safe for v29/v30/v32 (old code simply doesn't use the new columns/RPC; the one loss is that the old build recreates its legacy rate-limit table usage — which no longer exists post-v32, degrading recovery to 503 until re-deploy — acceptable for a short window). Rolling back after **v31** or after tokens have drained means wearable connections need re-linking on the old build; that's why v31 waits for a healthy cycle.
