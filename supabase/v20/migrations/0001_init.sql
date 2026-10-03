-- ============================================================
--  0VERTRAINED v20 — baseline schema (migration 0001)
-- ============================================================
--  A NEW Supabase project for the v20 rewrite. Nothing here touches the live
--  v19 project (supabase/*.sql); the two coexist until cutover.
--
--  WHAT THE APP STORES (see src/data/DataSource.ts):
--    · settings  — one JSON document per athlete        → profiles.settings
--    · program   — one JSON document per athlete        → program.payload
--    · days      — one JSON document per calendar day   → entries.payload
--
--  ACCOUNTS are username + password. Supabase Auth needs an email, so the
--  client signs up with a synthesised `<username>@<domain>` and passes
--  `{ data: { username } }` as sign-up metadata; no email is ever sent.
--  `handle_new_user()` turns the auth.users row into a profiles row.
--
--  PASSWORD RESET uses a recovery phrase: the client stores a
--  PBKDF2-SHA256 (600k iterations, 32 bytes, hex) hash + salt on its own
--  profiles row via `set_recovery_phrase()`. A Netlify function holding the
--  service role key verifies the phrase and sets a new password, after
--  asking `bump_recovery_attempt()` whether this username may try again.
--
--  SECURITY MODEL:
--    · RLS is on for every table. profiles/program/entries have own-row
--      policies keyed on auth.uid(). client_errors has NO policies: only the
--      service role (which bypasses RLS) reads or writes it.
--    · Every function that runs with elevated rights is `security definer`
--      with `set search_path = public`, references relations with their
--      schema, and has EXECUTE revoked from the roles that must not call it.
--      (Supabase's default privileges grant EXECUTE on every new function to
--      anon/authenticated/service_role, so the revokes are not optional.)
--    · The client never selects the recovery_* columns. RLS does not hide
--      columns, so this is a contract the client keeps (it only ever reads
--      id, username, settings, created_at, updated_at). The columns hold a
--      salted, stretched hash of the user's OWN phrase, so even a breach of
--      that contract exposes nothing another user could use.
--
--  Idempotent: safe to paste into the SQL editor more than once.
-- ============================================================


-- ── 0 · Schema access ───────────────────────────────────────────────────────
-- Supabase grants these already; repeated so the plain-Postgres test stub
-- (tests/_local_stub.sql) behaves the same.
grant usage on schema public to anon, authenticated, service_role;


-- ── 1 · Tables ──────────────────────────────────────────────────────────────

-- profiles: one row per account, created by the auth.users trigger below.
create table if not exists public.profiles (
  id                         uuid primary key references auth.users(id) on delete cascade,
  username                   text not null,
  -- SettingsV2 (src/data/settings.ts). Patched server-side by patch_settings().
  settings                   jsonb not null default '{}'::jsonb,
  -- Recovery phrase: hex PBKDF2 hash, hex salt, and the KDF identifier that
  -- produced them ('pbkdf2-sha256-600k'); all null until the user sets one.
  recovery_hash              text,
  recovery_salt              text,
  recovery_kdf               text,
  -- Rolling-window rate limit for recovery attempts, maintained only by
  -- bump_recovery_attempt() (service role).
  recovery_attempts          integer not null default 0,
  recovery_window_started_at timestamptz,
  recovery_locked_until      timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  constraint profiles_username_unique unique (username),
  -- Lower-case, URL-safe, 3–32 chars: it is also the local part of the
  -- synthesised sign-in email, so the alphabet must be email-safe.
  constraint profiles_username_format check (username ~ '^[a-z0-9._-]{3,32}$'),
  -- 16 KiB is ~40x a full SettingsV2 document; anything bigger is a bug or abuse.
  constraint profiles_settings_size check (octet_length(settings::text) <= 16384),
  constraint profiles_recovery_attempts_nonneg check (recovery_attempts >= 0),
  -- A 32-byte hash and salt are 64 hex chars each; cap well above that so
  -- a KDF change never needs a schema change, but junk cannot balloon the row.
  constraint profiles_recovery_hash_size check (recovery_hash is null or length(recovery_hash) between 16 and 256),
  constraint profiles_recovery_salt_size check (recovery_salt is null or length(recovery_salt) between 16 and 256),
  constraint profiles_recovery_kdf_size  check (recovery_kdf  is null or length(recovery_kdf)  between 1  and 64)
);

comment on table  public.profiles is 'One row per account: username, settings document, recovery-phrase hash and its rate-limit state.';
comment on column public.profiles.settings is 'SettingsV2 JSON (src/data/settings.ts); patch with patch_settings().';
comment on column public.profiles.recovery_hash is 'Hex PBKDF2-SHA256 hash of the recovery phrase. Never selected by the client.';
comment on column public.profiles.recovery_salt is 'Hex salt for recovery_hash. Never selected by the client.';
comment on column public.profiles.recovery_kdf is 'KDF identifier that produced recovery_hash, e.g. pbkdf2-sha256-600k.';

-- program: the athlete's dated list of weekly plans (ProgramPayloadV2).
create table if not exists public.program (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  payload    jsonb not null,
  updated_at timestamptz not null default now(),
  -- 64 KiB holds the 52-revision maximum (src/domain/program/types.ts) with
  -- room to spare.
  constraint program_payload_size check (octet_length(payload::text) <= 65536)
);

comment on table public.program is 'The athlete''s program (ProgramPayloadV2 JSON), one row per account.';

-- entries: one row per athlete per calendar day (DayV2).
create table if not exists public.entries (
  user_id    uuid not null references auth.users(id) on delete cascade,
  entry_date date not null,
  payload    jsonb not null,
  updated_at timestamptz not null default now(),
  constraint entries_pkey primary key (user_id, entry_date),
  -- 32 KiB is several times the largest real day (a long session with every
  -- set logged plus a quest snapshot and legacy v1 fields).
  constraint entries_payload_size check (octet_length(payload::text) <= 32768)
);

comment on table public.entries is 'One DayV2 JSON per athlete per local calendar day. Write through save_day().';

-- The history loader pages newest-first; this index matches that order
-- directly. (The primary key already covers (user_id, entry_date), so this
-- is a convenience for the planner rather than a correctness requirement.)
create index if not exists entries_user_date_desc_idx
  on public.entries (user_id, entry_date desc);

-- client_errors: the browser's crash reports, written by the Netlify
-- log-error function with the service role. user_id is null for errors that
-- happen before sign-in; ip_hash lets the function throttle those.
create table if not exists public.client_errors (
  id              bigserial primary key,
  user_id         uuid references auth.users(id) on delete cascade,
  ip_hash         text,
  created_at      timestamptz not null default now(),
  message         text,
  stack           text,
  component_stack text,
  url             text,
  version         text,
  ref             text,
  user_agent      text,
  -- The function clamps every field; these caps are the backstop so a bug in
  -- it can never store megabytes per report.
  constraint client_errors_field_sizes check (
    coalesce(length(ip_hash), 0)         <= 128  and
    coalesce(length(message), 0)         <= 2000 and
    coalesce(length(stack), 0)           <= 8000 and
    coalesce(length(component_stack), 0) <= 4000 and
    coalesce(length(url), 0)             <= 2048 and
    coalesce(length(version), 0)         <= 64   and
    coalesce(length(ref), 0)             <= 128  and
    coalesce(length(user_agent), 0)      <= 512
  )
);

comment on table public.client_errors is 'Browser error reports. Service role only (RLS on, no policies). Prune old rows with a scheduled delete.';

-- Both indexes serve the function's "how many reports from this user / IP
-- in the last day" cap query and periodic pruning by age.
create index if not exists client_errors_user_created_idx on public.client_errors (user_id, created_at);
create index if not exists client_errors_ip_created_idx   on public.client_errors (ip_hash, created_at);


-- ── 2 · updated_at maintenance ──────────────────────────────────────────────
-- now() is the transaction start time, so every row touched by one request
-- gets the same stamp; save_day() returns it and the client sends it back
-- as the conflict base.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists program_set_updated_at on public.program;
create trigger program_set_updated_at
  before update on public.program
  for each row execute function public.set_updated_at();

drop trigger if exists entries_set_updated_at on public.entries;
create trigger entries_set_updated_at
  before update on public.entries
  for each row execute function public.set_updated_at();


-- ── 3 · entries guard: sane dates, bounded rows per account ─────────────────
-- Two caps that RLS cannot express:
--   · entry_date must be a real training day: not before 20 years ago and at
--     most one day ahead of the server's UTC date (a client in UTC+14 is at
--     most one calendar day ahead).
--   · at most 4000 days per account (~11 years of daily logging). The count
--     is serialised per user with an advisory lock so two concurrent inserts
--     cannot both read 3999 and both succeed.
-- The date check also runs when entry_date itself is updated (a "move"),
-- so the window cannot be escaped after the fact. The row cap only applies
-- to inserts: editing an existing day at the cap must keep working.
--
-- A BEFORE INSERT trigger also fires for every row of an upsert
-- (INSERT ... ON CONFLICT DO UPDATE, which is what a PostgREST upsert and
-- the client's replaceAll send). A row whose key already exists adds no day
-- and moves none, so the guard steps aside for it: the primary key or the
-- ON CONFLICT clause decides what happens next.
create or replace function public.entries_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_count integer;
begin
  if tg_op = 'INSERT' and exists (
    select 1 from public.entries
     where user_id = new.user_id and entry_date = new.entry_date
  ) then
    return new;
  end if;

  if new.entry_date < (current_date - interval '20 years')::date
     or new.entry_date > current_date + 1 then
    raise exception 'ENTRY_DATE_OUT_OF_RANGE: % is outside the last 20 years / next day window', new.entry_date
      using errcode = 'P0001';
  end if;

  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('entries_cap'), hashtext(new.user_id::text));
    select count(*) into v_count from public.entries where user_id = new.user_id;
    if v_count >= 4000 then
      raise exception 'ENTRY_CAP_REACHED: this account already holds % days; delete old days before adding more', v_count
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists entries_guard on public.entries;
create trigger entries_guard
  before insert or update of entry_date on public.entries
  for each row execute function public.entries_guard();


-- ── 4 · New account → profiles row ──────────────────────────────────────────
-- Fires when Supabase Auth inserts the auth.users row. The username comes
-- from the sign-up metadata; the synthesised email's local part is the
-- fallback so an account created by other means (dashboard, admin API)
-- still gets a profile. security definer: the auth admin role that inserts
-- into auth.users has no rights on public.profiles.
--
-- Errors raised here abort the sign-up. Note that GoTrue reports them to the
-- browser as a generic "Database error saving new user" and logs the real
-- message; that is why the sign-up form checks username_taken() first and
-- these messages carry stable tokens for the server logs.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username   text;
  v_constraint text;
begin
  v_username := lower(trim(coalesce(
    nullif(new.raw_user_meta_data ->> 'username', ''),
    split_part(coalesce(new.email, ''), '@', 1)
  )));

  if v_username is null or v_username = '' then
    raise exception 'USERNAME_REQUIRED: sign-up metadata has no username and the email has no local part'
      using errcode = 'P0001';
  end if;

  if v_username !~ '^[a-z0-9._-]{3,32}$' then
    raise exception 'USERNAME_INVALID: "%" must be 3-32 characters of a-z, 0-9, ".", "_" or "-"', v_username
      using errcode = 'P0001';
  end if;

  if exists (select 1 from public.profiles where username = v_username) then
    raise exception 'USERNAME_TAKEN: "%" is already in use', v_username
      using errcode = 'P0001';
  end if;

  insert into public.profiles (id, username) values (new.id, v_username);
  return new;

exception
  when unique_violation then
    -- Two sign-ups raced for the same name past the check above; the one
    -- that lost the unique index gets the same clear message.
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'profiles_username_unique' then
      raise exception 'USERNAME_TAKEN: "%" is already in use', v_username
        using errcode = 'P0001';
    end if;
    raise;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ── 5 · jsonb_deep_merge ────────────────────────────────────────────────────
-- The server-side twin of patchSettings() in src/data/settings.ts:
--   · objects merge recursively, key by key
--   · arrays and scalars in b replace whatever a had
--   · a JSON null in b deletes that key (the client sends undefined → null)
--   · a non-object b replaces a outright; a SQL-null b leaves a unchanged
create or replace function public.jsonb_deep_merge(a jsonb, b jsonb)
returns jsonb
language plpgsql
immutable
parallel safe
as $$
declare
  r     record;
  v_out jsonb;
begin
  if b is null then
    return a;
  end if;
  if jsonb_typeof(b) <> 'object' then
    return b;
  end if;

  v_out := case when a is not null and jsonb_typeof(a) = 'object' then a else '{}'::jsonb end;

  for r in select key, value from jsonb_each(b) loop
    if jsonb_typeof(r.value) = 'null' then
      v_out := v_out - r.key;
    elsif jsonb_typeof(r.value) = 'object' then
      -- Recurse even when a has no object there: that strips nested nulls
      -- from b the same way the client does.
      v_out := v_out || jsonb_build_object(r.key, public.jsonb_deep_merge(v_out -> r.key, r.value));
    else
      v_out := v_out || jsonb_build_object(r.key, r.value);
    end if;
  end loop;

  return v_out;
end;
$$;


-- ── 6 · patch_settings ──────────────────────────────────────────────────────
-- Applies a partial SettingsV2 document to the caller's own settings and
-- returns the whole new document. Plain (security invoker): RLS and the
-- explicit id = auth.uid() both scope it to the caller. The 16 KiB CHECK on
-- the column fires through the update.
create or replace function public.patch_settings(patch jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_settings jsonb;
begin
  if v_uid is null then
    raise exception 'NO_SESSION: patch_settings requires a signed-in user'
      using errcode = 'P0001';
  end if;
  if patch is null or jsonb_typeof(patch) <> 'object' then
    raise exception 'BAD_PATCH: patch_settings expects a JSON object'
      using errcode = 'P0001';
  end if;

  update public.profiles
     set settings = public.jsonb_deep_merge(settings, patch)
   where id = v_uid
   returning settings into v_settings;

  if not found then
    raise exception 'NO_PROFILE: no profiles row for the signed-in user'
      using errcode = 'P0001';
  end if;

  return v_settings;
end;
$$;


-- ── 7 · save_day ────────────────────────────────────────────────────────────
-- Optimistic-concurrency write of one day for the caller.
--   p_base is the updated_at the client last saw for this day (null when it
--   has never seen the row, or for a deliberate overwrite such as an import).
--   · no row yet                                    → insert,  {status:'ok'}
--   · row exists and p_base is null                 → update,  {status:'ok'}
--   · row exists and updated_at <= p_base + 1 ms     → update,  {status:'ok'}
--   · otherwise someone else wrote since p_base      → NO write, {status:'conflict', payload, updated_at}
--     and the client runs mergeDay() against the returned server copy.
-- The 1 ms slack absorbs JavaScript Date's millisecond truncation of the
-- microsecond timestamp the client was given.
-- Plain (security invoker) so RLS applies; the row is locked (for update) so
-- two devices saving the same day are serialised rather than both passing
-- the check. The 32 KiB CHECK and entries_guard fire through the table.
create or replace function public.save_day(p_date date, p_payload jsonb, p_base timestamptz default null)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_row     public.entries%rowtype;
  v_updated timestamptz;
begin
  if v_uid is null then
    raise exception 'NO_SESSION: save_day requires a signed-in user'
      using errcode = 'P0001';
  end if;
  if p_date is null then
    raise exception 'BAD_DATE: save_day requires a date'
      using errcode = 'P0001';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'BAD_PAYLOAD: save_day expects a JSON object'
      using errcode = 'P0001';
  end if;

  select * into v_row
    from public.entries
   where user_id = v_uid and entry_date = p_date
     for update;

  if not found then
    begin
      insert into public.entries (user_id, entry_date, payload)
      values (v_uid, p_date, p_payload)
      returning updated_at into v_updated;
      return jsonb_build_object('status', 'ok', 'payload', p_payload, 'updated_at', v_updated);
    exception
      when unique_violation then
        -- Another request inserted this day between our select and insert.
        -- Treat it like any other write we did not know about.
        select * into v_row
          from public.entries
         where user_id = v_uid and entry_date = p_date;
        return jsonb_build_object('status', 'conflict', 'payload', v_row.payload, 'updated_at', v_row.updated_at);
    end;
  end if;

  if p_base is null or v_row.updated_at <= p_base + interval '1 millisecond' then
    update public.entries
       set payload = p_payload
     where user_id = v_uid and entry_date = p_date
     returning updated_at into v_updated;
    return jsonb_build_object('status', 'ok', 'payload', p_payload, 'updated_at', v_updated);
  end if;

  return jsonb_build_object('status', 'conflict', 'payload', v_row.payload, 'updated_at', v_row.updated_at);
end;
$$;


-- ── 8 · delete_my_account ───────────────────────────────────────────────────
-- Deletes the caller's auth.users row; every table here references it with
-- on delete cascade, and Supabase's own auth tables (identities, sessions,
-- refresh tokens) cascade too. security definer because `authenticated` has
-- no rights on auth.users.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'NO_SESSION: delete_my_account requires a signed-in user'
      using errcode = 'P0001';
  end if;
  delete from auth.users where id = v_uid;
end;
$$;


-- ── 9 · Recovery phrase ─────────────────────────────────────────────────────

-- set_recovery_phrase: the signed-in user stores (or clears) the hash of a
-- new phrase. Plain (security invoker). Setting a new phrase also clears
-- the attempt counter: the owner is signed in, so the lock that protected
-- the old phrase has nothing left to protect.
create or replace function public.set_recovery_phrase(p_hash text, p_salt text, p_kdf text)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'NO_SESSION: set_recovery_phrase requires a signed-in user'
      using errcode = 'P0001';
  end if;

  if not (
    (p_hash is null and p_salt is null and p_kdf is null)
    or (coalesce(p_hash, '') <> '' and coalesce(p_salt, '') <> '' and coalesce(p_kdf, '') <> '')
  ) then
    raise exception 'BAD_RECOVERY: pass hash, salt and kdf together, or all null to clear the phrase'
      using errcode = 'P0001';
  end if;

  update public.profiles
     set recovery_hash              = p_hash,
         recovery_salt              = p_salt,
         recovery_kdf               = p_kdf,
         recovery_attempts          = 0,
         recovery_window_started_at = null,
         recovery_locked_until      = null
   where id = v_uid;

  if not found then
    raise exception 'NO_PROFILE: no profiles row for the signed-in user'
      using errcode = 'P0001';
  end if;
end;
$$;

-- bump_recovery_attempt: called by the recovery function (service role)
-- BEFORE it verifies a phrase. Rolling window of p_window_ms; more than
-- p_max_attempts inside it locks the username for p_lock_ms. Returns
--   { allowed: bool, retry_after_seconds: int, attempts: int }
-- The row is locked (for update) so parallel requests cannot all read 4 and
-- all write 5. An expired lock starts a fresh window rather than re-counting
-- against the old one, so a lock shorter than the window cannot re-trigger
-- itself on the very next try.
--
-- An unknown username has no row to count on and returns allowed=true with
-- attempts=0. The function MUST answer the browser identically whether or
-- not the username exists (same wording, same status), or lockouts become a
-- username oracle; per-IP throttling is its job as well.
create or replace function public.bump_recovery_attempt(
  p_username     text,
  p_window_ms    bigint default 600000,   -- 10 min rolling window
  p_lock_ms      bigint default 900000,   -- 15 min lockout
  p_max_attempts int    default 5
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now      timestamptz := now();
  v_username text := lower(trim(coalesce(p_username, '')));
  v          public.profiles%rowtype;
  v_attempts integer;
  v_lock     timestamptz;
  v_window   interval := make_interval(secs => greatest(p_window_ms, 0) / 1000.0);
  v_lock_len interval := make_interval(secs => greatest(p_lock_ms, 0) / 1000.0);
begin
  select * into v
    from public.profiles
   where username = v_username
     for update;

  if not found then
    return jsonb_build_object('allowed', true, 'retry_after_seconds', 0, 'attempts', 0);
  end if;

  -- Active lock: report the remaining time, change nothing.
  if v.recovery_locked_until is not null and v.recovery_locked_until > v_now then
    return jsonb_build_object(
      'allowed', false,
      'retry_after_seconds', greatest(1, ceil(extract(epoch from (v.recovery_locked_until - v_now))))::int,
      'attempts', v.recovery_attempts
    );
  end if;

  -- Inside a live window with no lock history: count this attempt.
  if v.recovery_locked_until is null
     and v.recovery_window_started_at is not null
     and v_now - v.recovery_window_started_at < v_window then
    v_attempts := v.recovery_attempts + 1;

    if v_attempts > p_max_attempts then
      v_lock := v_now + v_lock_len;
      update public.profiles
         set recovery_attempts = v_attempts, recovery_locked_until = v_lock
       where id = v.id;
      return jsonb_build_object(
        'allowed', false,
        'retry_after_seconds', greatest(1, ceil(extract(epoch from v_lock_len)))::int,
        'attempts', v_attempts
      );
    end if;

    update public.profiles
       set recovery_attempts = v_attempts
     where id = v.id;
    return jsonb_build_object('allowed', true, 'retry_after_seconds', 0, 'attempts', v_attempts);
  end if;

  -- First attempt, expired window, or a lock that has run out: fresh window.
  update public.profiles
     set recovery_attempts          = 1,
         recovery_window_started_at = v_now,
         recovery_locked_until      = null
   where id = v.id;
  return jsonb_build_object('allowed', true, 'retry_after_seconds', 0, 'attempts', 1);
end;
$$;

-- username_taken: the sign-up form's availability check. security definer
-- because anon has no rights on profiles; it exposes exactly one bit.
create or replace function public.username_taken(p_username text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
     where username = lower(trim(coalesce(p_username, '')))
  );
$$;


-- ── 10 · Row Level Security ─────────────────────────────────────────────────
-- Policies are scoped `to authenticated`: anon has no table grants at all,
-- and the service role bypasses RLS. `(select auth.uid())` is evaluated once
-- per statement instead of once per row.

alter table public.profiles      enable row level security;
alter table public.program       enable row level security;
alter table public.entries       enable row level security;
alter table public.client_errors enable row level security;

-- profiles
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated
  with check ((select auth.uid()) = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "profiles_delete_own" on public.profiles;
create policy "profiles_delete_own" on public.profiles
  for delete to authenticated
  using ((select auth.uid()) = id);

-- program
drop policy if exists "program_select_own" on public.program;
create policy "program_select_own" on public.program
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "program_insert_own" on public.program;
create policy "program_insert_own" on public.program
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "program_update_own" on public.program;
create policy "program_update_own" on public.program
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "program_delete_own" on public.program;
create policy "program_delete_own" on public.program
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- entries
drop policy if exists "entries_select_own" on public.entries;
create policy "entries_select_own" on public.entries
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "entries_insert_own" on public.entries;
create policy "entries_insert_own" on public.entries
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "entries_update_own" on public.entries;
create policy "entries_update_own" on public.entries
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "entries_delete_own" on public.entries;
create policy "entries_delete_own" on public.entries
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- client_errors: RLS enabled, NO policies, on purpose. With no policy every
-- row is invisible to anon/authenticated even if a grant slipped through;
-- the service role bypasses RLS and is the only writer and reader.


-- ── 11 · Grants ─────────────────────────────────────────────────────────────
-- RLS decides which rows; Postgres still needs table-level grants to say
-- which roles may touch a table at all. Supabase's default privileges hand
-- anon/authenticated/service_role ALL on every new table, so the revokes
-- below are what actually keeps anon out and client_errors private.

revoke all on public.profiles, public.program, public.entries from public, anon;
grant select, insert, update, delete on public.profiles, public.program, public.entries to authenticated;
grant all on public.profiles, public.program, public.entries to service_role;

revoke all on public.client_errors from public, anon, authenticated;
revoke all on sequence public.client_errors_id_seq from public, anon, authenticated;
grant all on public.client_errors to service_role;
grant usage, select on sequence public.client_errors_id_seq to service_role;

-- Functions default to EXECUTE for PUBLIC (and Supabase adds the API roles),
-- so each one is revoked and then granted to exactly who may call it.

-- trigger functions: never called directly
revoke all on function public.set_updated_at()   from public, anon, authenticated;
revoke all on function public.entries_guard()    from public, anon, authenticated;
revoke all on function public.handle_new_user()  from public, anon, authenticated;

-- pure helper, used inside patch_settings (invoker) so the caller needs it
revoke all on function public.jsonb_deep_merge(jsonb, jsonb) from public, anon;
grant execute on function public.jsonb_deep_merge(jsonb, jsonb) to authenticated, service_role;

-- signed-in RPCs
revoke all on function public.patch_settings(jsonb) from public, anon;
grant execute on function public.patch_settings(jsonb) to authenticated;

revoke all on function public.save_day(date, jsonb, timestamptz) from public, anon;
grant execute on function public.save_day(date, jsonb, timestamptz) to authenticated;

revoke all on function public.set_recovery_phrase(text, text, text) from public, anon;
grant execute on function public.set_recovery_phrase(text, text, text) to authenticated;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- sign-up form (anonymous)
revoke all on function public.username_taken(text) from public;
grant execute on function public.username_taken(text) to anon, authenticated, service_role;

-- recovery function only (service role)
revoke all on function public.bump_recovery_attempt(text, bigint, bigint, int) from public, anon, authenticated;
grant execute on function public.bump_recovery_attempt(text, bigint, bigint, int) to service_role;

-- ============================================================
--  DONE. Re-running this file is safe.
-- ============================================================
