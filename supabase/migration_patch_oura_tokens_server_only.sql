--  PATCH: Keep Oura OAuth tokens server-side only
--  Run after migration_add_oura.sql is present.
-- Browser clients should never SELECT access_token/refresh_token from PostgREST.
-- Use Netlify endpoints instead:
--   GET  /api/oura/status
--   POST /api/oura/disconnect

REVOKE ALL ON public.oura_tokens FROM anon, authenticated;
GRANT ALL ON public.oura_tokens TO service_role;

-- Oura data remains user-readable so Recovery can load normalized daily metrics.
-- Tokens stay service-role-only.
