# V12.2 — DB-first Wearable Display Snapshot

Narrow slice: Recovery can hydrate from a server/DB-backed **display-safe** wearable
snapshot before a live provider refresh, then keep refreshing quietly.

## What shipped

**Migration** — `supabase/migration_add_wearable_snapshot.sql`
- New `public.wearable_snapshots` table: one latest, **token-free** display snapshot
  per user (`user_id` PK, `source`, `status` fresh/stale/empty, `snapshot` JSONB,
  `updated_at`).
- RLS: **owner SELECT only**; `service_role` ALL. No self INSERT/UPDATE/DELETE.
- Patches `delete_my_account_data()` (idempotent, only if present) to purge the row.
- Idempotent / safe to re-run. **Run once in Supabase → SQL Editor.**

**Endpoint** — `netlify/functions/wearable-snapshot.js` (`/api/wearable/*`)
- `GET /api/wearable/snapshot` — caller's display-safe snapshot. Ownership derived
  ONLY from the verified Supabase Bearer JWT.
- `GET /api/wearable/status` — lightweight `hasSnapshot` + `fresh|stale` marker.
- `POST /api/wearable/snapshot` — upsert. Ownership is **server-derived from the
  Bearer token**; a `user_id` in the body/query is ignored (same invariant Whoop
  enforces). Body is stripped of token-like fields + size-capped (32 KB) before storage.
- All responses re-sanitized defensively (recursive secret-key strip) and carry the
  standard security headers.

**Client helpers** — `src/wearables/snapshot.js`
- `fetchServerSnapshot()`, `fetchServerSnapshotStatus()`, `postServerSnapshot()`.
- Use the current Supabase session token; never send a `user_id`.
- **Demo mode** returns synthetic empty/safe shapes and makes no network call.
- Responses run back through the shared sanitizer before the UI sees them.

**Pure helpers** — `src/wearables/snapshotSanitize.js`
- `toDisplaySafeSnapshot` (reuses `sanitizeSnapshot`), `deriveSnapshotStatus`,
  `summarizeSnapshotStatus`, `toEpochMs`, `emptySnapshotResult`. No side effects.

**RecoveryDashboard wiring** — load order is now:
`session cache → localStorage snapshot → SERVER snapshot → live provider data`.
- If the server snapshot arrives before live data, it renders and is labelled subtly
  via the existing "Using saved wearable snapshot · refreshing · updated …" strip.
- `liveAppliedRef` guarantees a late server hydrate never clobbers fresher live data.
- On live load success, the display-safe snapshot is written locally (unchanged) AND
  best-effort `POST`ed to the server (fire-and-forget, never blocks the render).

## Security posture (unchanged invariants)
- No OAuth tokens / refresh tokens / service keys / raw auth responses / raw biometric
  payloads in the snapshot — only already-rendered display values.
- Ownership is always Bearer-derived server-side; body/query `user_id` never trusted.
- Browser bundle scan: no `client_secret` / `refresh_token` / `service_role` /
  `private_key` literals introduced. The only `access_token` hit is the Supabase
  **session property accessor** (`session?.access_token`), identical to the existing
  whoop/oura/coach clients.

## Follow-up (intentionally deferred — out of this narrow scope)
- **Server-side provider refresh from the endpoint was NOT wired.** Calling the
  existing Oura/Whoop refresh/sync internally from `/api/wearable/*` was judged too
  risky for this slice (token rotation, pagination, rate limits already live in
  `oura-auth.js` / `whoop-auth.js`). Today the server snapshot is populated by the
  browser's post-live-load `POST`. A future refresh function (or the existing
  sync handlers) can service-role-write `wearable_snapshots` after a sync so the
  DB-first snapshot warms even without a recent browser session — the endpoint and
  table are the foundation for that. No scheduled function added.

## Verification
- `npm test` → 90 files / 1171 tests pass (incl. 3 new: `snapshotSanitize`,
  `wearableSnapshotServer`, `wearableSnapshotClient`). Existing tests unchanged.
- `npm run build` → clean.
