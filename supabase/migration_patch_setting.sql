--  MIGRATION: patch_user_setting RPC
--  Atomically patches a single key in the settings JSONB column.
--  Used for critical flags like onboarded to avoid race conditions
--  where a full settings overwrite could lose the flag.

create or replace function public.patch_user_setting(p_key text, p_value jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
  set settings = settings || jsonb_build_object(p_key, p_value)
  where id = auth.uid();
$$;

grant execute on function public.patch_user_setting(text, jsonb) to authenticated;

--  Also fix any profiles where onboarded may be missing —
--  seed it as false so loadSettings always gets a clean value.
--  (Only sets it if the key doesn't already exist.)
update public.profiles
set settings = settings || '{"onboarded": false}'::jsonb
where not (settings ? 'onboarded');
