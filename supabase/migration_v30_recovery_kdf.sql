-- ============================================================
--  V13.6 (v30) — Recovery KDF versioning
-- ============================================================
--  P1 hardening from the V13.4.1 security review: the recovery phrase is
--  user-chosen and was stored as a single round of SHA-256(salt + phrase).
--  The per-user salt defeats rainbow tables but not offline dictionary
--  attacks — a profiles leak would let a typical human phrase fall in
--  seconds, and the phrase is a full password-reset credential.
--
--  V13.6 derives the hash with PBKDF2-SHA256 at 600k iterations instead
--  (src/recoveryKdf.js in the browser; netlify/functions/account-recovery.js
--  server-side, byte-identical). This column records which KDF produced the
--  stored hash so both formats can coexist during migration:
--
--    · null / 'sha256'      → legacy single-round hash (pre-V13.6 signups)
--    · 'pbkdf2-sha256-600k' → current KDF
--
--  New signups and recovery-phrase changes write 'pbkdf2-sha256-600k'.
--  Existing legacy rows keep working and are lazily re-hashed to the current
--  KDF the first time their owner completes a recovery — no bulk migration
--  and no forced reset. The default is left NULL so a row's absence of an
--  explicit value is correctly read as "legacy" by the verifier.
--
--  Idempotent and re-runnable, matching the v27/v28/v29 style.
-- ============================================================

alter table public.profiles
  add column if not exists recovery_kdf text;

-- Optional bounded check: only the two known identifiers (or NULL) are valid.
-- Added conditionally so re-runs don't error on the duplicate constraint name.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_recovery_kdf_known'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_recovery_kdf_known
      check (recovery_kdf is null or recovery_kdf in ('sha256', 'pbkdf2-sha256-600k'));
  end if;
end $$;
