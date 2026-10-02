-- Add per-user salt for recovery phrase hashes.
-- Required by src/auth.js after the security hardening update.

alter table public.profiles
  add column if not exists recovery_salt text;
