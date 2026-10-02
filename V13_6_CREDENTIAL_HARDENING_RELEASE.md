# 0VERTRAINED V13.6 — Credential & OAuth Hardening

The P1/P2 hardening slice from the V13.4.1 security review. Focus: make the recovery-phrase credential resistant to an at-rest leak, close the permanent-lockout gap, revoke sessions on reset, and bring Oura's OAuth in line with the other providers. Plus several P2 defense-in-depth fixes.

## Security

### Recovery phrase now uses PBKDF2-SHA256 (`migration_v30_recovery_kdf.sql`, `src/recoveryKdf.js`)
- The phrase is user-chosen and was stored as a single round of `SHA-256(salt + phrase)`. The per-user salt defeats rainbow tables but not offline dictionary attacks — a `profiles` leak would let a typical human phrase fall in seconds, and the phrase is a full password-reset credential.
- New signups and phrase changes now derive the hash with PBKDF2-SHA256 at 600k iterations (OWASP 2023). A `recovery_kdf` column records the format so both coexist: `null`/`'sha256'` = legacy, `'pbkdf2-sha256-600k'` = current.
- **Legacy rows keep working and are lazily upgraded**: after a successful recovery of a legacy hash, the server re-hashes the same phrase under PBKDF2 with a fresh salt. No bulk migration, no forced reset.
- The browser (`src/recoveryKdf.js`, WebCrypto) and the Node recovery function (`account-recovery.js`) must produce byte-identical output or a phrase set in the app would never verify. `src/__tests__/recoveryKdf.test.js` runs both implementations and asserts they agree — the guard against silent drift.

### Sessions are revoked on password reset (`account-recovery.js`)
- The recovery flow exists for "someone else may have my credentials" moments, but a stolen live session previously survived the reset. After a successful password update the function now calls GoTrue admin logout for the user (best-effort — the password is already changed, so a failed logout can't fail recovery). The success message tells the user other devices were signed out.

### Oura OAuth state is now single-use (`oura-auth.js`)
- Oura used an HMAC-signed, self-verifying state token with a non-constant-time signature compare, and — because it carried its own expiry rather than being consumed — was replayable within its 10-minute TTL. Whoop/Strava/Google already used the DB-backed `provider_oauth_state` pattern (row deleted on consume).
- Oura now uses that same pattern via `storeProviderOAuthState`/`consumeProviderOAuthState`. The HMAC helpers and the `OURA_STATE_SECRET` dependency are gone. `src/__tests__/serverSecurity.test.js` gains a replay test proving a second callback with the same state is rejected before token exchange.

### Timing-oracle normalization (`account-recovery.js`)
- Every verification path now performs exactly one PBKDF2-cost comparison — a missing profile is checked against a dummy PBKDF2 hash, and the legacy SHA-256 path runs one throwaway PBKDF2 — so response timing isn't a username-existence oracle across the mixed-KDF window.

## Fixed (P2 defense-in-depth)

### Coach quota + timeout (`coach.js`)
- The daily-usage bump ran **before** body parsing, so a malformed JSON body or an empty question still burned a quota credit. Validation now runs first; only a well-formed request counts.
- Added a 20s `AbortController` timeout on the Ollama call so a hung provider returns a clean 504 instead of riding the platform function timeout.
- Aligned the `requestTooLarge` default (was 64k) with the 128k call site.

### Error-log flood cap (`log-error.js`)
- The endpoint is JWT-gated but was otherwise uncapped — one authenticated client (crash loop or abuse) could bloat `client_errors` without bound. Added a per-user 24h ceiling (200/day, `LOG_ERROR_DAILY_CAP` override) via a `HEAD` count before insert. Returns 200 when capped so the fire-and-forget client logger doesn't retry. Fails open.

### Service worker notification navigation (`public/sw.js`)
- `notificationclick` opened `data.url` unvalidated. Payloads are VAPID-signed, so this is defense-in-depth: navigation is now constrained to a same-origin path.

## UX

### Change recovery phrase (`SettingsScreen.jsx` → Account)
- Closes the permanent-lockout gap: a phrase set at signup could never be changed, so forgetting both password and phrase meant an unrecoverable account with no email fallback. A new **Account** section lets a signed-in user rotate their phrase (writes a fresh PBKDF2 hash to their own row via RLS — no server function needed).

### Strong-phrase suggestion (`src/recoveryPhraseSuggest.js`)
- Both signup and the change-phrase flow can now fill a generated 4-word phrase from a 256-word list (~32 bits before the KDF stretch). Custom phrases remain allowed — it's a nudge. A "Suggest a strong phrase" button drops one in and mirrors it to the confirm field.

## Deployment requirements

1. Apply `supabase/migration_v30_recovery_kdf.sql` (idempotent — adds `recovery_kdf` + a bounded CHECK).
2. `OURA_STATE_SECRET` is no longer read and can be removed from the environment. Oura now requires `SUPABASE_SERVICE_ROLE_KEY` at authorize time (already set for token storage).
3. Deploy normally. Existing users with legacy recovery hashes are upgraded transparently on their next recovery; no user action required.

## Validation

- Full quality gate: `npm run quality:gate` — 112 test files, lint 0 errors, production + demo builds, secret scan, deploy artifact check. All green.
- New tests: cross-runtime KDF agreement, PBKDF2 primitives, phrase suggestion, Oura one-time-state replay rejection.
