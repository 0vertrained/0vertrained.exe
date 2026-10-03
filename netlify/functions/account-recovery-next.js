// netlify/functions/account-recovery-next.js
// v20 · Recovery-phrase password reset for the /next app.
//   · The browser never sees the stored salt/hash or a service-role credential.
//   · Every mismatch (unknown username, wrong phrase, row without a phrase,
//     legacy KDF) returns the same copy AND costs the same one PBKDF2 stretch,
//     so neither the response nor its timing is a username-existence oracle.
//   · Attempts are rate-limited FIRST, per username, through a service-role
//     RPC that holds the bucket in the database, so limits survive refreshes
//     and devices. The limiter fails CLOSED: with no working limiter the
//     endpoint is an offline-guessing oracle, so it answers 503 instead.
//   · Only the current KDF (pbkdf2-sha256-600k) verifies. The v20 profiles
//     table is written fresh under this KDF; legacy single-round rows belong
//     to the v19 endpoint until the cutover migration upgrades them.
//   · The attempt counter is NOT reset on success: the RPC is bump-only in
//     the v20 contract, the window expires on its own in 10 minutes, and an
//     owner who just reset their password has no reason to recover again at
//     once. Five successes per ten minutes is not a flow worth enabling.
//   · The phrase and the new password are never logged, by anything.
//
// Required env: NEXT_SUPABASE_URL, NEXT_SUPABASE_ANON_KEY,
//               NEXT_SUPABASE_SERVICE_ROLE_KEY

import { pbkdf2 as pbkdf2Cb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { json, readNextEnv, serviceHeaders } from "./_next-env.js";

const pbkdf2 = promisify(pbkdf2Cb);

// MUST match the client-side derivation byte for byte (phrase and salt as
// UTF-8, PBKDF2-SHA256, 600k iterations, 32-byte key, lowercase hex).
const RECOVERY_KDF_CURRENT = "pbkdf2-sha256-600k";
const RECOVERY_KDF_ITERATIONS = 600_000;
const RECOVERY_KEY_BYTES = 32;
// A fixed salt for the stretch that runs when there is nothing to compare
// against, so a missing row costs the same as a present one.
const DUMMY_SALT = "00".repeat(16);

const WINDOW_MS = 10 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const GENERIC_MISMATCH = "The username or recovery phrase didn't match.";
const UNAVAILABLE = "Account recovery is unavailable right now.";
// Lowercase only; the app lowercases on sign-up. Rejected rather than
// stripped so a stray character cannot alias one username onto another's
// rate-limit bucket. 64 bounds the REST filter and the RPC argument.
const USERNAME_RE = /^[a-z0-9._-]{1,64}$/;

const sanitizeUsername = (value) => {
  const u = String(value ?? "").trim().toLowerCase();
  return USERNAME_RE.test(u) ? u : "";
};

async function derive(phrase, salt) {
  const key = await pbkdf2(Buffer.from(phrase, "utf8"), Buffer.from(String(salt), "utf8"), RECOVERY_KDF_ITERATIONS, RECOVERY_KEY_BYTES, "sha256");
  return key.toString("hex");
}

function timingSafeHexEqual(actualHex, expectedHex) {
  const actual = Buffer.from(String(actualHex), "hex");
  const expected = Buffer.from(String(expectedHex), "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Atomic bump of the username bucket. Returns { allowed, retryAfterSeconds }
// or null when the RPC did not answer in shape (non-2xx, network, bad JSON).
async function bumpAttempt(env, username) {
  try {
    const r = await fetch(`${env.url}/rest/v1/rpc/bump_recovery_attempt`, {
      method: "POST",
      headers: serviceHeaders(env.serviceRoleKey),
      body: JSON.stringify({ p_username: username, p_window_ms: WINDOW_MS, p_lock_ms: LOCK_MS, p_max_attempts: MAX_ATTEMPTS }),
    });
    if (!r.ok) return null;
    const body = await r.json();
    if (typeof body?.allowed !== "boolean") return null;
    return { allowed: body.allowed, retryAfterSeconds: Math.max(0, Number(body.retry_after_seconds) || 0) };
  } catch {
    return null;
  }
}

// The profile row, null when there is none, or undefined when the lookup
// itself failed (so the caller can fail closed rather than say "didn't match").
async function findProfile(env, username) {
  try {
    const r = await fetch(
      `${env.url}/rest/v1/profiles?username=eq.${encodeURIComponent(username)}&select=id,recovery_hash,recovery_salt,recovery_kdf&limit=1`,
      { headers: serviceHeaders(env.serviceRoleKey) },
    );
    if (!r.ok) return undefined;
    const rows = await r.json();
    return Array.isArray(rows) ? rows[0] ?? null : undefined;
  } catch {
    return undefined;
  }
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const env = readNextEnv();
  if (!env) return json({ error: "Server not configured" }, 500);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid request." }, 400); }

  const username = sanitizeUsername(body?.username);
  const recoveryPhrase = String(body?.recoveryPhrase ?? "").trim();
  const newPassword = String(body?.newPassword ?? "");
  if (!username || recoveryPhrase.length < 8) return json({ error: GENERIC_MISMATCH }, 400);
  if (newPassword.length < 8 || newPassword.length > 72 || !/[^a-zA-Z]/.test(newPassword)) {
    return json({ error: "Use an 8–72 character password with at least one number or symbol." }, 400);
  }

  // Rate limit before any lookup or stretch: a locked caller learns nothing
  // and costs nothing.
  const bucket = await bumpAttempt(env, username);
  if (!bucket) return json({ error: UNAVAILABLE }, 503);
  if (!bucket.allowed) {
    const seconds = Math.max(1, bucket.retryAfterSeconds);
    return json(
      { error: `Too many attempts. Try again in ${Math.ceil(seconds / 60)} minutes.`, retryAfterSeconds: seconds },
      429,
      { "retry-after": String(seconds) },
    );
  }

  const profile = await findProfile(env, username);
  if (profile === undefined) return json({ error: UNAVAILABLE }, 503);

  // Exactly one PBKDF2 stretch on every path. A row that cannot be verified
  // (missing, no phrase set, legacy KDF) stretches against the dummy salt and
  // is then a mismatch by construction.
  const verifiable = Boolean(profile?.id && profile?.recovery_hash && profile?.recovery_salt && profile?.recovery_kdf === RECOVERY_KDF_CURRENT);
  const derived = await derive(recoveryPhrase, verifiable ? profile.recovery_salt : DUMMY_SALT);
  if (!verifiable || !timingSafeHexEqual(derived, profile.recovery_hash)) {
    return json({ error: GENERIC_MISMATCH }, 400);
  }

  try {
    const r = await fetch(`${env.url}/auth/v1/admin/users/${encodeURIComponent(profile.id)}`, {
      method: "PUT",
      headers: serviceHeaders(env.serviceRoleKey),
      body: JSON.stringify({ password: newPassword }),
    });
    if (!r.ok) return json({ error: "Could not update the password. Try again." }, 502);
  } catch {
    return json({ error: "Could not update the password. Try again." }, 502);
  }
  return json({ ok: true });
};

// Without a route, /api/next/account-recovery would fall through netlify.toml's
// SPA rewrite and return index.html.
export const config = { path: "/api/next/account-recovery" };
