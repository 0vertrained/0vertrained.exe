# Bad-UX Audit — maintenance/error states leaking into the product

Scope: wearable/integration surfaces (Oura + Whoop) and adjacent Settings copy.
Context: triggered by the WHOOP "token expired — click to fix" complaint, which is
now fixed (see **FIXED** below). All audited findings have since been resolved —
each item below is marked **FIXED** with the change applied and its tests.

---

## FIXED — Whoop `/api/whoop/status` did not self-heal an expired access token

- **Evidence:** `netlify/functions/whoop-auth.js` `handleStatus` (previously
  selected only `expires_at,updated_at` and returned `isExpired` without a
  refresh); `src/SettingsScreen.jsx:616` (`⚠ Token expired — reconnect.`).
- **User impact:** A normal, expected access-token expiry showed a scary
  "reconnect" prompt requiring a manual click, even though the refresh token on
  file could silently renew it.
- **Fix applied:** `/status` now selects `refresh_token`, and refreshes when the
  access token is expired or within 5 minutes of expiry via the existing
  `refreshAccessToken()` (which persists the rotated token). On success it reports
  `isExpired:false` with the new `expiresAt`; on genuine refresh failure it keeps
  `connected:true`, `isExpired:true`, `syncStatus:"refresh_failed"` (never lies
  "disconnected"). Tokens are never returned to the client. Settings copy softened
  to `⚠ Connection needs reconnect.` (only shows on real refresh failure now).
  Tests: `src/__tests__/whoopStatusSelfHeal.test.js`.

---

## FIXED — Oura `/api/oura/status` had the identical no-self-heal bug — **HIGH**

- **Evidence:** `netlify/functions/oura-auth.js` `handleStatus` (previously
  selected only `expires_at,updated_at` and returned `isExpired` without a
  refresh); `src/SettingsScreen.jsx:432` (`⚠ Token expired — reconnect.`).
- **User impact:** Same bad UX the Whoop complaint was about — Oura users were told
  to reconnect on every normal token expiry despite a valid refresh token.
- **Fix applied:** `/status` now selects `refresh_token`, and refreshes when the
  access token is expired or within 5 minutes of expiry via a factored-out
  `refreshOuraAccessToken()` (which persists the rotated token and logs
  `token_refresh`; `getUsableOuraAccessToken()` now reuses it too). On success it
  reports `isExpired:false` with the new `expiresAt`; on genuine refresh failure it
  keeps `connected:true`, `isExpired:true`, `syncStatus:"refresh_failed"` (never
  lies "disconnected"). Tokens are never returned to the client. Settings copy
  softened to `⚠ Connection needs reconnect.` and the RecoveryDashboard "expired"
  surfaces reworded to a reconnect-needed framing (both only show on real refresh
  failure now). Tests: `src/__tests__/ouraStatusSelfHeal.test.js`.

## FIXED — Scheduled prefetch never actually synced Whoop ("noted-only") — **MEDIUM**

- **Evidence (before):** `netlify/functions/wearable-prefetch.js` — for each
  connected Whoop token it only incremented `noted` and logged an `info` event:
  `"Hourly prefetch saw connected Whoop token; server-side sync helper extraction
  pending."`. Oura was genuinely synced in the same function.
- **User impact (before):** Whoop data went stale between manual syncs; a user who
  "connected Whoop" reasonably expects it to keep itself current like Oura does,
  and instead had to open Settings and press **Sync now**. The logged message was
  also internal engineering jargon that surfaced in the user-visible sync-events
  timeline (`getWhoopSyncEvents` → Settings debug timeline).
- **Fix applied:** The server-side Whoop sync core in `whoop-auth.js`
  (`refreshAccessToken`, `syncUserData`, `logSyncEvent`, the `SYNC_DAYS` /
  `TOKEN_NEAR_EXPIRY_MS` constants) is now `export`ed and reused by the scheduled
  prefetch — the Netlify default handler + `/api/whoop/*` route are unchanged. The
  status/message logic was extracted into a shared, exported `classifyWhoopSync()`
  so the scheduled path and the manual `/api/whoop/sync` never drift. The prefetch
  now, per connected `whoop_tokens` row (service-role selected only; never a
  body/query `user_id`, batch capped at 25): refreshes an expired/near-expired
  access token and persists the rotated refresh token *before* fetching data,
  performs a real 14-day sync into `whoop_data` via the existing mapping/upsert,
  and logs a `wearable_sync_events` row (`event_type:"sync"`, `success`/`partial`/
  `failed`, counts, days) — never faking success on partial/cycle-only/failure and
  never logging tokens or payloads. The engineering-jargon "helper extraction
  pending" message and the `noted` bookkeeping are gone. Oura sync + snapshot
  materialization are preserved unchanged. Tests: `src/__tests__/wearablePrefetchSnapshot.test.js`
  (real-sync, expired-token-refresh-before-fetch, cycle-only→partial,
  store-failure→failed, refresh-failure→failed, no-token-leak, and static
  no-body-user_id / shared-14-day-window assertions).
- **Severity:** MEDIUM (now resolved; "connected = stays current" holds for Whoop).

## FIXED — Finding 3 — Raw server error strings surfaced verbatim in Settings — **LOW**

- **Evidence (before):** `src/SettingsScreen.jsx:112` (`Sync failed: ${res.error}`)
  and `:167` (Oura equivalent). `res.error` was the server's raw error string
  (e.g. `"Token refresh failed"`, `"Sync failed"`).
- **User impact (before):** Users saw terse internal error text rather than an
  actionable message; some values ("Token refresh failed") implied a manual step
  that the self-healing status now handles automatically.
- **Fix applied:** Added `src/integrationErrors.js` `friendlySyncError(raw, provider)`
  which maps the raw server error to friendly, actionable copy — refresh/not-connected
  failures → "Reconnect needed — re-link … above to resume syncing." (rare now that
  `/status` self-heals), auth → "Please sign in again…", config → soft
  "temporarily unavailable", and everything else (generic "Sync failed", upstream
  5xx/network) → "Sync will retry shortly — your data isn't lost." Both Whoop
  (`handleWhoopSync`) and Oura (`handleOuraSync`) now `console.warn` the raw
  `res.error` for debugging and render only the mapped copy. Tests:
  `src/__tests__/integrationErrors.test.js`.
- **Severity:** LOW (resolved).

## FIXED — Finding 4 — "Connected but no data" dead-ends are guided but manual — **LOW**

- **Evidence (before):** `src/SettingsScreen.jsx:469-472` (Oura: "connected, but no
  scored readiness found yet. Try Sync now…") and `:655-656`/`:661-665` (Whoop
  cycle-only / no-recovery explanations). These correctly explained the state but
  framed a manual **Sync now** click as the remedy.
- **User impact (before):** Minor — honest and helpful copy, but the "Try Sync now"
  framing implied a required manual step that the scheduled server-side sync
  (**FIXED** above) now handles for both providers.
- **Fix applied:** Reworded the empty-state copy to reflect automatic backfill and
  drop the manual-action framing, while keeping the honest explanation of the state:
  Oura → "Oura connected. Scored readiness will fill in automatically after your
  next night — background sync keeps it current, so there's nothing to do here.";
  Whoop cycle-only → "Sleep and recovery will appear automatically after Whoop
  processes your next sleep — background sync keeps this current…"; Whoop
  no-recovery → "Whoop connected. Scored recovery fills in automatically after your
  next sleep." The manual **Sync now** buttons remain available but are no longer
  presented as the required next step.
- **Severity:** LOW (resolved).

## FIXED — Finding 5 — FoodSearch surfaces raw HTTP status + response body to the user — **LOW/MEDIUM**

- **Evidence (before):** `src/FoodSearch.jsx:97-99` — on a failed USDA lookup it
  threw `"USDA rate limit — try again shortly"` (429) and, worse,
  `` `USDA ${res.status}: ${body.slice(0, 80)}` `` for other statuses, embedding the
  raw status and an 80-char slice of the upstream response body in an Error that
  reached the UI status line.
- **User impact (before):** Latent info leak — raw HTTP status codes and an
  upstream response-body slice could reach the user, confusing at best. A 429 is
  transient and should retry rather than surface as an error.
- **Fix applied:** `fetchUsda` now retries a 429 or 5xx with a short backoff
  (`USDA_RETRY_DELAYS_MS = [1000, 2000]` — two retries at 1s/2s) before degrading to
  local-only results. The raw `status` and a 200-char body slice are `console.warn`-ed
  for debugging only; the thrown Error carries jargon-free copy
  ("Couldn't reach the food database — showing local results"), never a status code
  or body slice. A 403 still maps to the key-config message without reading the body.
  The status-line renderer only ever shows pre-mapped, jargon-free copy. Successful
  lookups and caching are unchanged. Tests: `src/__tests__/foodSearchRetry.test.js`.
- **Severity:** LOW/MEDIUM (resolved).

## Additional surfaces (broader sweep — same root causes)

A wider scan found more UI copy sharing the root causes above. These are reported,
not itemized as separate fixes, because they largely resolve when Findings 1–2 land:

- `src/RecoveryDashboard.jsx:732` and `:949` — previously `"Oura connection has
  expired. Data shown may be stale."` and `Token status … "expired — reconnect
  required"`. Resolved with the Oura **FIXED** item above: `/api/oura/status` now
  self-heals, so these surfaces only appear on a genuine refresh failure and were
  reworded to a reconnect-needed framing.
- `src/recovery/wearableSyncEvents.js` and `src/recovery/wearableReadinessQA.js` —
  copy like *"Try syncing again, or reconnect if the token has expired"* and badges
  `"sync failed"` / `"partial data"`. Same class as **Findings 1 & 3** (raw
  status/jargon + manual-intervention framing for recoverable states).
- `src/AppHeader.jsx:35` — offline banner *"…will sync when you reconnect."* Benign
  (network reconnect, changes are queued locally), noted for completeness; low
  priority copy tweak at most.

---

### Summary of severities
- HIGH: Oura status no self-heal — **FIXED** (the exact reported bug on the other provider).
- MEDIUM: Whoop scheduled prefetch noted-only — **FIXED** (now performs a real hourly server-side sync).
- LOW/MEDIUM: Finding 5 (FoodSearch raw HTTP status/body exposed) — **FIXED** (retry/backoff + jargon-free copy; raw detail console-only).
- LOW: Finding 3 (raw error copy) — **FIXED** (`friendlySyncError` mapping); Finding 4 (guided-but-manual empty states) — **FIXED** (auto-backfill copy).
- All audited findings are now resolved; the additional-surfaces copy was already
  reworded under the Oura/Whoop **FIXED** items above.
