# 0VERTRAINED v20 — Supabase schema

The database for the v20 rewrite. It is a **new, separate Supabase project**;
the live v19 project (`supabase/*.sql`, one level up) is untouched and the two
run side by side until cutover.

```
supabase/v20/
├── migrations/0001_init.sql   the whole schema, idempotent (paste or push it)
├── config.toml                local stack settings for the Supabase CLI
├── seed.sql                   empty on purpose
├── tests/
│   ├── 0001…0010_*.sql        pgTAP tests (CI form: `supabase test db`)
│   ├── _local_stub.sql        auth schema / roles stub for plain Postgres
│   └── run-local.sh           throwaway-cluster runner, no Docker needed
└── cli/supabase/              symlink shim so the CLI finds the files above
```

## What the schema holds

| Table | One row per | Written by |
|---|---|---|
| `profiles` | account | the `auth.users` trigger, `patch_settings()`, `set_recovery_phrase()` |
| `program` | account | the client (own row, RLS) |
| `entries` | account × calendar day | `save_day()` |
| `client_errors` | crash report | the Netlify log-error function (service role only) |

RPCs the client calls: `save_day`, `patch_settings`, `set_recovery_phrase`,
`delete_my_account`, `username_taken` (anonymous). RPC the recovery function
calls with the service role: `bump_recovery_attempt`. The header of
`migrations/0001_init.sql` explains the security model; every guard and cap
has a comment saying why it is there.

Accounts are **username + password**. The client signs up with a synthesised
email `<username>@<VITE_NEXT_AUTH_EMAIL_DOMAIN>` and passes
`{ data: { username } }`; `handle_new_user()` turns that into the profile.
No email is ever sent, so the Auth settings below switch every mail off.

### Call shapes (supabase-js)

```ts
// load
supabase.from("profiles").select("id, username, settings, created_at, updated_at").single();
supabase.from("program").select("payload, updated_at").maybeSingle();
supabase.from("entries").select("entry_date, payload, updated_at")
  .order("entry_date", { ascending: false }).range(0, 999);   // page by 1000

// save a day: p_base is the updated_at the client last saw (null = overwrite)
const { data } = await supabase.rpc("save_day", { p_date: "2026-10-03", p_payload: day, p_base });
// data: { status: "ok" | "conflict", payload, updated_at }  → on conflict run mergeDay() and retry with data.updated_at

// settings: send a DeepPartial<SettingsV2>; undefined → null deletes a key
supabase.rpc("patch_settings", { patch: { session: { restSeconds: 120 }, profile: { name: null } } });

supabase.from("program").upsert({ user_id, payload });          // own row (RLS)
supabase.from("entries").delete().eq("entry_date", dateKey);     // own row (RLS)
supabase.rpc("set_recovery_phrase", { p_hash, p_salt, p_kdf: "pbkdf2-sha256-600k" });
supabase.rpc("username_taken", { p_username });                  // works with the anon key
supabase.rpc("delete_my_account");
```

Never `select("*")` on `profiles`: the recovery columns are the user's own
salted hash, harmless to them, but the client has no use for them and the
contract is that it never reads them.

## Apply it to a new hosted project

1. Create a project at [supabase.com/dashboard](https://supabase.com/dashboard)
   (any region; note the database password, you need it for the CLI only).
2. Apply the schema, either way:
   - **Dashboard → SQL Editor** → paste the whole of `migrations/0001_init.sql`
     → Run. It is idempotent: running it again is harmless.
   - **CLI**:
     ```sh
     supabase login
     supabase link --workdir supabase/v20/cli --project-ref <project-ref>
     supabase db push --workdir supabase/v20/cli
     ```
     `db push` records `0001` in `supabase_migrations.schema_migrations`, so
     later files `0002_*.sql` … apply in order.
3. **Auth settings** (Dashboard → Authentication):
   - Providers → Email: **enabled**, **Confirm email: OFF**, **Secure email
     change: OFF**, **Secure password change: OFF**. With "Confirm email" on,
     nobody could ever sign in: the address does not exist.
   - Providers → Email → Minimum password length: **8**; no character rules.
   - URL Configuration → Site URL: the production origin
     (`https://0vertrained.app`); Redirect URLs: the same plus any preview
     origin you use.
   - SMTP: **leave the built-in default**, do not configure a custom sender.
     No template is ever sent.
   - Sign-ups: leave enabled. Rate Limits: the defaults are fine; sign-up
     abuse is throttled by Turnstile on the form and `username_taken()`
     exposes only one bit.
4. **Keys** (Dashboard → Settings → API): copy the Project URL, the `anon`
   public key and the `service_role` secret key into Netlify
   (Site settings → Environment variables):

   | Netlify variable | Value | Scope |
   |---|---|---|
   | `VITE_NEXT_SUPABASE_URL` | Project URL | build (public, in the bundle) |
   | `VITE_NEXT_SUPABASE_ANON_KEY` | anon key | build (public, in the bundle) |
   | `VITE_NEXT_AUTH_EMAIL_DOMAIN` | e.g. `users.0vertrained.app` | build (public) |
   | `NEXT_SUPABASE_URL` | Project URL | functions |
   | `NEXT_SUPABASE_ANON_KEY` | anon key | functions |
   | `NEXT_SUPABASE_SERVICE_ROLE_KEY` | service_role key | functions, **secret** |

   The service role key bypasses RLS: it belongs only in Netlify function
   env, never behind a `VITE_` prefix, never in this repo.

### Hosted checklist (what the local tests cannot prove)

The tests run on plain Postgres or the local stack. Check these once on the
real project after applying the migration, with a throwaway account:

- **Sign-up creates a profile.** The trigger on `auth.users` is created by
  the `postgres` role in the SQL editor (the documented Supabase pattern).
  Sign up once and confirm a `profiles` row with the lower-cased username.
- **Trigger errors are generic in the browser.** When `handle_new_user()`
  raises (`USERNAME_TAKEN`, `USERNAME_INVALID`), GoTrue answers the client
  with "Database error saving new user" and keeps the real message in the
  Postgres logs. That is why the sign-up form must call `username_taken()`
  first and validate the format client-side; the trigger is the last line.
- **`delete_my_account()` deletes from `auth.users`.** It runs as `postgres`
  (security definer). Call it from the throwaway account and confirm the
  user, its profile, program, entries and `auth.identities` are gone.
- **RLS under a real JWT.** The tests set `request.jwt.claims` by hand;
  PostgREST does the same from the token. Read `profiles` with the anon key
  and a user token and confirm exactly one row comes back.
- **Default privileges.** Supabase grants anon/authenticated/service_role
  ALL on every new table and EXECUTE on every new function; the migration
  revokes what it must. If a later migration adds a table or function,
  copy the grant block pattern from section 11 of `0001_init.sql`.
- **The service role calls `bump_recovery_attempt`** before verifying a
  phrase, answers the browser identically whether or not the username
  exists, and throttles per IP on its own (the RPC counts per username).

## Running the tests

### With the Supabase CLI (Docker)

```sh
supabase start   --workdir supabase/v20/cli     # applies migrations + seed
supabase test db --workdir supabase/v20/cli     # pg_prove over tests/*.sql
supabase stop    --workdir supabase/v20/cli
```

Why `cli/`: the CLI only ever looks for `<workdir>/supabase/config.toml`.
`supabase/v20/cli/supabase/` is a folder of symlinks (`config.toml`,
`migrations`, `seed.sql`, `tests`) pointing at the real files one level up,
so the project reads naturally in git and still works with `--workdir`. The
CLI's own scratch files (`.temp/`, `.branches/`) land in that folder and are
git-ignored there.

`tests/_local_stub.sql` is in the tests folder (pg_prove sweeps every `.sql`
there) but announces itself as a skipped TAP file and does nothing on a
Supabase database, so `supabase test db` reports it as `skipped`.

### Plain Postgres, no Docker (what was used to verify this schema)

```sh
apt-get install postgresql-16 postgresql-16-pgtap   # or 15 / 17; pgTAP brings pg_prove
supabase/v20/tests/run-local.sh
```

The script starts a throwaway cluster on port 5433 (socket in a temp dir),
loads `tests/_local_stub.sql` (the `auth` schema, `auth.users`, `auth.uid()`
and the `anon` / `authenticated` / `service_role` roles), applies
`0001_init.sql` **twice** to prove idempotency, runs the pgTAP files with
`pg_prove`, then stops and deletes the cluster. `KEEP=1` leaves it running
for a look; `PG_PORT`, `PG_BIN` and `PG_DATA` override the defaults.
Extra arguments go to `pg_prove` (`--verbose` shows every assertion).

What the suite covers:

| File | Proves |
|---|---|
| `0001_schema` | tables, columns, PKs, FKs, CHECKs, indexes, triggers, RLS on, policy sets, function existence/definer/volatility, revokes |
| `0002_rls` | user A cannot select/insert/update/delete user B's rows on profiles/program/entries; anon has nothing; `client_errors` is closed |
| `0003_handle_new_user` | lower-cased username from metadata or email, trimming, `USERNAME_TAKEN` (case-insensitive), `USERNAME_INVALID`, `USERNAME_REQUIRED`, failed sign-ups leave no `auth.users` row |
| `0004_jsonb_deep_merge` | recursive merge, array/scalar replace, null deletes, SQL-null handling, the real SettingsV2 shape |
| `0005_patch_settings` | merges and stores, returns the document, `BAD_PATCH`, `NO_PROFILE`, `NO_SESSION`, anon refused, 16 KiB CHECK, other users untouched |
| `0006_save_day` | insert, update on current base, 1 ms slack, conflict without writing, null-base overwrite, argument errors, guard and 32 KiB CHECK fire, per-user isolation |
| `0007_entries_guard` | the 20-year / +1 day window on insert and on `entry_date` update, the 4000-row cap including a single 4000-row bulk insert, edits at the cap still work |
| `0008_size_checks` | exact byte boundaries for settings (16384), program (65536), entries (32768); username format; recovery column caps; `client_errors` field caps |
| `0009_recovery` | `set_recovery_phrase` set/clear/validation/no-session/anon; `username_taken` as anon; `bump_recovery_attempt` 5-then-lock, lock reporting, lock expiry, window expiry, custom limits, unknown username, anon/authenticated refused |
| `0010_delete_my_account` | cascades through profiles, program, entries, client_errors; other users intact; no-session and anon refused |

## Conventions for the next migration

- New file `migrations/0002_<name>.sql`, idempotent (`if not exists`,
  `create or replace`, `drop policy if exists`), lower-case keywords,
  comments that say why.
- Security definer functions: `set search_path = public`, schema-qualify
  every table, `revoke all ... from public, anon, authenticated` then grant
  to exactly who may call it.
- Add a test file for it; keep the plan count honest (`pg_prove` fails on a
  mismatch).
