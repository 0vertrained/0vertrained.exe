-- ============================================================
--  V14.3 (v33) — Performance indexes + cleanup
-- ============================================================
--  Closes the performance plan's P1-2. Two certain changes and one
--  verify-first optional. Idempotent and re-runnable.
--
--  1. wearable_sync_events had NO composite index; its only query shape is
--     "this user's newest events" (user_id = X ORDER BY created_at DESC
--     LIMIT 20) from both the Recovery dashboard and Settings.
--
--  2. idx_entries_user_date (added in v27) duplicates the backing index of
--     the entries UNIQUE(user_id, entry_date) constraint, which already
--     serves every query shape the app issues — including the V14.3 windowed
--     range (entry_date >= cutoff). Dropping it removes a write-amplification
--     tax on every save with zero read-side cost.
--
--  3. activities (Strava): no explicit index exists in the migrations, but
--     the live table may carry a covering unique constraint. VERIFY before
--     acting:
--
--       select indexdef from pg_indexes where tablename = 'activities';
--
--     If nothing covers (user_id, start_date), uncomment the block below.
-- ============================================================

create index if not exists idx_wearable_sync_events_user_created
  on public.wearable_sync_events (user_id, created_at desc);

drop index if exists public.idx_entries_user_date;

-- Uncomment ONLY if the verification query above shows no covering index:
-- create index if not exists idx_activities_user_start
--   on public.activities (user_id, start_date desc);
