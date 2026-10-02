# 0VERTRAINED V14.1 — Recovery Rate-Limit Hardening & Signup Self-Heal

Closes the last two open items from the V13.4.1 security review (P1-4 and the signup-orphan path), and ships the consolidated production deploy runbook covering V13.5 → V14.1.

## Security

### Atomic, two-dimensional recovery rate limiting (`migration_v32_recovery_rate_limit.sql`, `account-recovery.js`)
The previous limiter had a read-then-upsert race (parallel attempts could all observe count 4 and all pass), was keyed on username only (spraying one guess across many usernames got a fresh bucket each time), and minted a permanent row per probed username.

- New `account_recovery_buckets` table + `ovt_bump_recovery_attempt` RPC: `SELECT … FOR UPDATE` serializes concurrent bumps (race fixed), the window/lock logic runs in one transaction, and an opportunistic sweep deletes buckets idle for a day (growth bounded).
- Two dimensions per request: `u:<sha256(username)>` at 5/10min and `ip:<sha256(ip)>` at 20/10min — wide enough for shared NATs, tight enough to blunt cross-username spraying. Raw IPs are never stored, only hashes. IP comes from Netlify's connection header, falling back to the first `x-forwarded-for` hop.
- On successful recovery the username bucket clears; the IP bucket decays with its window (one legitimate success shouldn't reopen spray capacity for a shared host).
- Deploy-order safe: when the RPC isn't deployed yet, the function falls back to the legacy single-dimension path (the v28 `ovt_bump_daily_usage` pattern). The old ephemeral `account_recovery_attempts` table is dropped by v32.

## Fixed

### Signup-orphan self-heal (`src/auth.js`, `src/App.jsx`)
If `auth.signUp` succeeded but the profiles insert failed (network blip, cap race), the user held a valid session with no profile row: the app half-worked and re-signup said "already registered" with no way forward.

- `ensureProfileExists()` runs on boot: a signed-in user with no profile gets one inserted, username derived from the synthetic auth email's local part (which *is* the username by the `usernameToInternalId` contract). The insert passes through the v29 cap trigger, so a genuinely full app still refuses — surfaced as a clear toast rather than a broken half-state.
- Recovery fields start null on a healed profile; the toast points to Settings → Account to set a phrase (the V13.6 flow).
- The signup "already registered" error now explains the situation: log in and setup finishes automatically.

## Ops

### `DEPLOY_RUNBOOK_V13_5_TO_V14_1.md`
One ordered checklist for the whole release train: pre-deploy env (TOKEN_ENCRYPTION_KEY, email-features check), the three migrations to run now (v29 → v30 → v32), smoke tests, the token-drain verification, the deferred v31 drop, the optional domain migration, and rollback posture.

## Tests (114 files green)

- `netlify/tests/account-recovery.test.js` +5: IP hash extraction/precedence/stability; handler-level proof that both buckets are consulted, a locked IP bucket 429s (with `retry-after`) before any profile lookup, and raw IPs never appear in bucket keys; the pre-v32 fallback path end-to-end.
- New `src/__tests__/ensureProfileExists.test.js` (6 tests) via an injectable fake client: no-session and profile-exists no-ops, username derivation, v29 cap mapping, insert-failure reporting, and fail-open on lookup errors (the healer can never block boot).

## Deployment

Covered by the runbook. Migration for this release: `migration_v32_recovery_rate_limit.sql` (run with v29 and v30 if not yet applied).

## Validation

Full quality gate: 114 test files, lint 0 errors, production + demo builds, secret scan, deploy artifact check — all green.
