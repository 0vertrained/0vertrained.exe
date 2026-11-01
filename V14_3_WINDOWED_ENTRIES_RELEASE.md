# 0VERTRAINED V14.3 — Windowed Entries + Perf Indexes (P1)

Closes the performance plan. The blocking boot transfer is now capped forever instead of growing with account age.

## Windowed boot (`src/data.js`, `src/App.jsx`)

`loadRecentEntries(180)` replaces `loadAllEntries` on the blocking path — one indexed range query. Older history arrives three non-blocking ways: the SWR cache's full map from prior sessions is retained under the fresh window; a background `loadOlderEntries` hydrate pages the remainder (500/batch, newest first) and merges beneath current state so fresher keys always win; and the final cache write persists the fully merged map for the next boot. Merge precedence everywhere: cached history < fresh window < offline queue. All 11 full-map consumers are untouched — same shape, different arrival order. `loadAllEntries` survives for the export path, which legitimately needs everything. New boot perf mark: `entries-hydrated` (visible in Fig. D).

Known edge, accepted per plan: on a **cold** boot (no cache), a >180-day streak or all-time chart renders from the window until the hydrate lands (typically within a second or two).

## `migration_v33_perf_indexes.sql`

Adds `idx_wearable_sync_events_user_created` (the one genuinely missing index); drops v27's `idx_entries_user_date` (duplicates the unique constraint's backing index — pure write-amplification tax); includes the verify-first query for `activities` with a commented index to apply only if nothing covers it.

## Deployment

Run `migration_v33_perf_indexes.sql` with the deploy (either order is safe — the windowed query is served by the unique constraint's index regardless). Check the `activities` verification query while you're in the SQL editor.

## Validation

Full gate: 116 test files (4 new: cutoff filtering, descending pagination + chunk streaming, merge precedence, cancellation), lint 0 errors, both builds, secret scan — green.
