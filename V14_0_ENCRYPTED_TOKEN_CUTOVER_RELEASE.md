# 0VERTRAINED V14.0 — Encrypted Token Cutover

The last large item from the V13.4.1 security review: plaintext OAuth tokens at rest are gone. `connected_accounts` (AES-256-GCM, `TOKEN_ENCRYPTION_KEY`) is now the sole runtime token store for every provider. Plus the groundwork for retiring the `athlete.app` synthetic-email domain.

## The cutover, in one paragraph

Before: Oura and Whoop tokens lived in plaintext (`oura_tokens`, `whoop_tokens`) as the runtime source of truth, with `connected_accounts` as an encrypted mirror nobody read. After: every token read goes through `resolveProviderTokens` (encrypted row first), every token write goes through `persistProviderTokens` (ciphertext only), and the legacy tables survive purely as a one-shot read fallback — the first resolve after this deploy encrypts the plaintext row into `connected_accounts` and **deletes it**. Active users drain out of the legacy tables organically within hours (the hourly prefetch alone touches every connected user). Nothing anywhere writes plaintext anymore; a repo-wide sweep confirms zero POST/PATCH calls against the legacy tables.

## New provider-standard helpers (`_provider-standard.js`)

- `resolveProviderTokens` — encrypted-first read with one-shot legacy migration (encrypt → upsert → delete plaintext). Fails **up front** with `encryption_not_configured` when the key is missing, before any provider call — Whoop rotates refresh tokens on every refresh, so rotating a token we can't store would sever the connection permanently. Also self-heals after a key rotation: undecryptable ciphertexts fall through to a surviving legacy row and re-encrypt under the current key.
- `persistProviderTokens` — the only sanctioned write path. Ciphertext upsert + legacy row cleanup. Fail-closed.
- `getProviderConnectionSummary` — presence-only view for `/status` endpoints (connected, expiresAt, hasRefreshToken, tokenEncryptionConfigured). No decryption, so status reports honestly even when the key is absent.
- `listProviderConnectedUserIds` — scheduled-job enumeration: union of encrypted + not-yet-migrated legacy rows, deduped, capped. Tolerates the legacy tables being dropped.
- `tokenEncryptionConfigured`, `readLegacyTokenRow`, `deleteLegacyTokenRow`.

## Converted call sites

- **oura-auth.js** — callback persists encrypted-only (`oura_error=token_storage_unconfigured` when the key is missing); status uses the summary helper and surfaces `tokenEncryptionConfigured`; `refreshOuraAccessToken` / `getUsableOuraAccessToken` resolve internally; disconnect treats a 404 on legacy tables as success (drop-safe).
- **whoop-auth.js** — same five conversions; `refreshAccessToken` signature is now `(supabaseUrl, serviceKey, userId)`.
- **oura-sync.js** — scheduled sync resolves through the encrypted store and persists rotations encrypted-only.
- **wearable-prefetch.js** — enumerates via `listProviderConnectedUserIds`; `syncWhoopUser(userId)` resolves its own tokens; the generic `supabaseSelect` helper (which selected plaintext token columns) is deleted.

## Tests (113 files green)

- New `netlify/tests/token-cutover.test.js` (10 tests) pins the contract: encrypted-first (legacy table never touched), legacy fallback migrates + deletes, fail-closed without the key (zero REST calls), summary works keyless, enumeration unions/dedupes and tolerates a dropped table.
- `ouraStatusSelfHeal` / `whoopStatusSelfHeal` rewritten for the new flow with a **stronger invariant**: zero plaintext writes to the legacy tables, persisted bodies are ciphertext (`v1.…`), and rotated tokens never appear in any stored record or client response.
- `wearablePrefetchSnapshot` mock is now stateful (persists become readable, legacy deletes remove rows), so it validates the ciphertext round-trip end-to-end; ordering assertion upgraded to "the FINAL persist precedes any data fetch".
- `serverSecurity` oura tests updated; the status test now also asserts no ciphertext leaks to the client.

## Deferred: `migration_v31_drop_plaintext_tokens.sql` ⚠

Ships in this release but **must not run with the deploy**. Run it after one healthy release cycle AND after its embedded verification query shows both legacy tables at zero rows (queries included in the file, including a who-remains view). All V14.0 code already tolerates the drop — no code change accompanies it.

## Auth email domain groundwork

`usernameToInternalId` now reads `VITE_AUTH_EMAIL_DOMAIN` (default: legacy `athlete.app` — zero behavior change until you opt in). `scripts/migrate-auth-domain.mjs` migrates every `auth.users` email to a domain you control (dry-run by default, idempotent, `--apply` to execute). The env flip and the script **must land together** — login derives the exact email string. Runbook is in the script header. Until then, keep all Supabase email features (confirmations, magic links, SMTP) disabled — that's the standing mitigation.

## Deployment requirements

1. **Set `TOKEN_ENCRYPTION_KEY` in the Netlify environment BEFORE deploying.** This is the hard prerequisite: V14 fails closed without it — new wearable connects and token refreshes will refuse (with clear errors) rather than store plaintext. If Strava/Google connections work in prod today, the key is already set; verify anyway.
2. Deploy normally. Watch `wearable_sync_events` for `token_refresh` failures mentioning `TOKEN_ENCRYPTION_KEY` — that's the misconfiguration signal.
3. After a healthy cycle: run the v31 verification query, then apply `migration_v31_drop_plaintext_tokens.sql`.
4. Optional, separately scheduled: the auth-domain migration (script header runbook).
5. `OURA_STATE_SECRET` (already unused since V13.6) can be removed from the environment.

## Validation

Full quality gate: 113 test files, lint 0 errors, production + demo builds, secret scan, deploy artifact check — all green. Repo-wide verification: zero plaintext token writes remain in `netlify/functions/`.
