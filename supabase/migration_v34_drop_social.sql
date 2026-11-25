--  V19.8 — Drop the social boards
--  Run this in the Supabase SQL Editor with the 19.8.0 deploy.
--
--  19.8.0 removes the leaderboard, PR boards and circles from the app. Their
--  RPCs stay callable by any signed-in account until they are dropped, and
--  they still answer with the aggregates of anyone who opted in, so drop them
--  with the deploy rather than leaving them behind the removed screens.
--
--  This deletes every circle and circle membership. There is no
--  down-migration; the circles had no data of their own beyond names, invite
--  codes and members. Daily entries are untouched: the boards only read them.
--
--  The socialOptIn flag left in profiles.settings is inert once these
--  functions are gone; the app no longer reads or writes it.
--
--  Idempotent: re-running is safe.

-- Tables first: dropping them drops their policies, which call
-- is_circle_member().
drop table if exists public.social_circle_members;
drop table if exists public.social_circles;

drop function if exists public.get_leaderboard(int);
drop function if exists public.get_lifting_prs();
drop function if exists public.get_running_prs();
drop function if exists public.get_social_summary(int);
drop function if exists public.create_circle(text);
drop function if exists public.join_circle(text);
drop function if exists public.list_my_circles();
drop function if exists public.get_circle_summary(uuid, int);
drop function if exists public.is_circle_member(uuid);
