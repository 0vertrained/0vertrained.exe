// src/recoveryKdf.js
// V13.6 · Recovery-phrase key derivation (browser side).
//
// The recovery phrase is user-chosen and, before this, was stored as a single
// round of SHA-256(salt + phrase). The per-user salt defeats rainbow tables
// but not offline dictionary attacks: if the profiles table ever leaked, a
// typical human phrase falls in seconds at billions of guesses/sec, and the
// phrase is a full password-reset credential. This module derives the hash
// with PBKDF2-SHA256 at an OWASP-2023 iteration count instead.
//
// CRITICAL — cross-runtime agreement: the recovery Netlify function
// (netlify/functions/account-recovery.js) recomputes this hash server-side in
// Node to verify. Both sides MUST feed the phrase and the salt string as
// UTF-8 bytes to PBKDF2-SHA256 with the SAME iteration count and key length,
// or a phrase set in the browser will never verify on the server. There is a
// test (src/__tests__/recoveryKdf.test.js) that runs both implementations and
// asserts byte-identical output. Do not change the parameters below without
// updating the Node side and that test in lockstep.

// Versioned KDF identifiers stored in profiles.recovery_kdf.
//  · null / "sha256"      → legacy single-round SHA-256 (pre-V13.6 signups)
//  · "pbkdf2-sha256-600k" → this module
export const RECOVERY_KDF_LEGACY = "sha256";
export const RECOVERY_KDF_CURRENT = "pbkdf2-sha256-600k";
export const RECOVERY_KDF_ITERATIONS = 600_000;
const KEY_LENGTH_BYTES = 32;

const toHex = (buffer) =>
  Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

// 16 random bytes → 32 hex chars. Fed to PBKDF2 as its UTF-8 string bytes.
export function generateRecoverySalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

// Legacy verifier — kept so the change-phrase flow and any browser-side check
// can still recognize a pre-V13.6 hash if ever needed. Recovery upgrades these
// to the current KDF on the server; this exists for completeness/symmetry.
export async function deriveLegacyRecoveryHash(phrase, salt) {
  const enc = new TextEncoder().encode(String(salt) + String(phrase).trim());
  const digest = await crypto.subtle.digest("SHA-256", enc);
  return toHex(digest);
}

// Current KDF. Returns { hash, salt, kdf } ready to write to profiles.
export async function deriveRecoveryHash(phrase, salt = generateRecoverySalt()) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(String(phrase).trim()),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(String(salt)), iterations: RECOVERY_KDF_ITERATIONS, hash: "SHA-256" },
    key,
    KEY_LENGTH_BYTES * 8,
  );
  return { hash: toHex(bits), salt, kdf: RECOVERY_KDF_CURRENT };
}
