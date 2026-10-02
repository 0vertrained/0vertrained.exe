-- Oura data least-privilege hardening
-- Browser clients only need to SELECT their own oura_data rows through RLS.
-- All Oura writes/deletes are performed server-side with service_role.

REVOKE INSERT, UPDATE, DELETE ON public.oura_data FROM authenticated;
GRANT SELECT ON public.oura_data TO authenticated;
GRANT ALL ON public.oura_data TO service_role;
