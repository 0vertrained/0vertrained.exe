// Recovery-phrase password reset.
//  · The browser never receives the stored recovery salt/hash or a service-
//    role credential. Mismatch responses are non-disclosive, and attempts are
//    rate-limited in a service-role-only table so limits survive refreshes and
//    different devices.
//  · Verification is KDF-versioned. New phrases use PBKDF2-SHA256 (matches
//    src/recoveryKdf.js byte-for-byte — see the cross-runtime test); legacy
//    single-round SHA-256 rows still verify and are opportunistically upgraded
//    to PBKDF2 after a successful recovery of the phrase they just proved.
//  · After a successful password reset, all of the user's existing sessions
//    are revoked, so a stolen live session cannot outlive the reset that was
//    meant to lock the attacker out.

import { createHash, timingSafeEqual, pbkdf2 as pbkdf2Cb, randomBytes } from "node:crypto";
import { promisify } from "node:util";

const pbkdf2 = promisify(pbkdf2Cb);

// KDF parameters — MUST match src/recoveryKdf.js exactly (phrase + salt string
// as UTF-8 bytes, PBKDF2-SHA256, 600k iterations, 32-byte key). Changing
// either side alone silently breaks verification for phrases set on the other.
const RECOVERY_KDF_CURRENT = "pbkdf2-sha256-600k";
const RECOVERY_KDF_ITERATIONS = 600_000;
const RECOVERY_KEY_BYTES = 32;

const GENERIC_MISMATCH = "The username or recovery phrase didn't match.";
const WINDOW_MS = 10 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
// Second rate-limit dimension: per-IP. Wider than the username cap so
// shared NATs (gyms, offices) aren't punished for one bad neighbor, but tight
// enough to blunt spraying one guess across many usernames from one host.
const IP_MAX_ATTEMPTS = 20;

// Extract and hash the caller IP. Netlify's connection header first, then the
// first (client) hop of x-forwarded-for. Hashed so raw IPs are never stored.
// Returns null when no address is available — the username bucket still applies.
export function resolveClientIpHash(req) {
  const raw =
    req.headers.get("x-nf-client-connection-ip") ||
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  const ip = String(raw || "").trim();
  if (!ip) return null;
  return createHash("sha256").update(ip, "utf8").digest("hex");
}

const json = (body, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });

const sanitizeUsername = (value) =>
  String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");

// Legacy single-round hash. Kept only to verify + upgrade old rows.
export function hashRecoveryPhrase(phrase, salt) {
  return createHash("sha256").update(`${salt}${String(phrase).trim()}`, "utf8").digest("hex");
}

// Current KDF. Returns lowercase hex. Async so it never blocks the event loop.
export async function deriveRecoveryHashPbkdf2(phrase, salt) {
  const derived = await pbkdf2(
    Buffer.from(String(phrase).trim(), "utf8"),
    Buffer.from(String(salt), "utf8"),
    RECOVERY_KDF_ITERATIONS,
    RECOVERY_KEY_BYTES,
    "sha256",
  );
  return derived.toString("hex");
}

function timingSafeHexEqual(actualHex, expectedHex) {
  const actual = Buffer.from(String(actualHex), "hex");
  const expected = Buffer.from(String(expectedHex), "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Legacy verifier retained for tests and the upgrade path.
export function verifyRecoveryHash(phrase, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  return timingSafeHexEqual(hashRecoveryPhrase(phrase, salt), expectedHash);
}

// KDF-aware verification. `kdf` is the profiles.recovery_kdf value (null or
// "sha256" → legacy; "pbkdf2-sha256-600k" → current). Returns a boolean.
async function verifyRecoveryByKdf(phrase, salt, expectedHash, kdf) {
  if (!salt || !expectedHash) return false;
  if (kdf === RECOVERY_KDF_CURRENT) {
    return timingSafeHexEqual(await deriveRecoveryHashPbkdf2(phrase, salt), expectedHash);
  }
  return timingSafeHexEqual(hashRecoveryPhrase(phrase, salt), expectedHash);
}

export function evaluateRecoveryRateLimit(record, now = Date.now()) {
  const lockUntil = record?.lock_until ? Date.parse(record.lock_until) : 0;
  if (Number.isFinite(lockUntil) && lockUntil > now) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((lockUntil - now) / 1000)),
      next: record,
    };
  }

  const started = record?.window_started_at ? Date.parse(record.window_started_at) : 0;
  const inWindow = Number.isFinite(started) && now - started < WINDOW_MS;
  const attempts = inWindow ? Number(record?.attempts || 0) + 1 : 1;
  const next = {
    attempts,
    window_started_at: new Date(inWindow ? started : now).toISOString(),
    lock_until: attempts > MAX_ATTEMPTS ? new Date(now + LOCK_MS).toISOString() : null,
    updated_at: new Date(now).toISOString(),
  };

  if (attempts > MAX_ATTEMPTS) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil(LOCK_MS / 1000),
      next,
    };
  }
  return { allowed: true, retryAfterSeconds: 0, next };
}

function serviceHeaders(serviceRoleKey, prefer = "") {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "content-type": "application/json",
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

// Atomic bump via the v32 RPC. Returns:
//   { allowed, retryAfterSeconds }  — RPC evaluated the bucket
//   undefined                       — RPC not deployed yet (fall back to legacy)
//   null                            — RPC errored (treat as unavailable)
// Matches the v28 ovt_bump_daily_usage deploy-before-migrate pattern.
async function bumpRecoveryBucketRpc(supabaseUrl, serviceRoleKey, { key, maxAttempts }) {
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/rpc/ovt_bump_recovery_attempt`, {
      method: "POST",
      headers: serviceHeaders(serviceRoleKey),
      body: JSON.stringify({
        p_key: key,
        p_window_ms: WINDOW_MS,
        p_lock_ms: LOCK_MS,
        p_max_attempts: maxAttempts,
      }),
    });
    if (r.status === 404) return undefined; // migration_v32 not applied yet
    if (!r.ok) return null;
    const body = await r.json().catch(() => null);
    if (!body || typeof body.allowed !== "boolean") return null;
    return { allowed: body.allowed, retryAfterSeconds: Number(body.retry_after_seconds) || 0 };
  } catch {
    return null;
  }
}

async function auditEvent({ supabaseUrl, serviceRoleKey, userId, usernameHash, eventType, metadata = {} }) {
  try {
    await fetch(`${supabaseUrl}/rest/v1/account_recovery_events`, {
      method: "POST",
      headers: serviceHeaders(serviceRoleKey, "return=minimal"),
      body: JSON.stringify({
        user_id: userId || null,
        username_hash: usernameHash,
        event_type: eventType,
        metadata,
      }),
    });
  } catch {
    // Recovery should not fail only because the append-only audit write failed.
  }
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Server not configured." }, 500);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid request." }, 400); }

  const username = sanitizeUsername(body?.username);
  const recoveryPhrase = String(body?.recoveryPhrase ?? "").trim();
  const newPassword = String(body?.newPassword ?? "");
  if (!username || recoveryPhrase.length < 8) return json({ error: GENERIC_MISMATCH }, 400);
  if (newPassword.length < 8 || newPassword.length > 72 || !/[^a-zA-Z]/.test(newPassword)) {
    return json({ error: "Use an 8–72 character password with at least one number or symbol." }, 400);
  }

  const usernameHash = createHash("sha256").update(username, "utf8").digest("hex");
  const encodedHash = encodeURIComponent(usernameHash);
  const ipHash = resolveClientIpHash(req);

  // ── Rate limiting: two atomic buckets via the v32 RPC ─────────────
  // Username bucket (5/10min) throttles guessing one account; IP bucket
  // (20/10min) blunts spraying across many usernames from one host. SELECT FOR
  // UPDATE inside the RPC removes the old read-then-upsert race. When the RPC
  // isn't deployed yet, the legacy single-dimension path below takes over.
  let rate;
  const usernameBucket = await bumpRecoveryBucketRpc(supabaseUrl, serviceRoleKey, {
    key: `u:${usernameHash}`, maxAttempts: MAX_ATTEMPTS,
  });
  if (usernameBucket === null) {
    return json({ error: "Recovery is temporarily unavailable. Try again later." }, 503);
  }
  if (usernameBucket !== undefined) {
    let combined = usernameBucket;
    if (ipHash) {
      const ipBucket = await bumpRecoveryBucketRpc(supabaseUrl, serviceRoleKey, {
        key: `ip:${ipHash}`, maxAttempts: IP_MAX_ATTEMPTS,
      });
      if (ipBucket === null) {
        return json({ error: "Recovery is temporarily unavailable. Try again later." }, 503);
      }
      if (ipBucket !== undefined && !ipBucket.allowed) {
        combined = {
          allowed: false,
          retryAfterSeconds: Math.max(combined.retryAfterSeconds, ipBucket.retryAfterSeconds),
        };
      }
    }
    rate = { allowed: combined.allowed, retryAfterSeconds: combined.retryAfterSeconds };
  } else {
    // ── Legacy fallback (pre-v32): single-dimension read-then-upsert ────────
    let limitRecord;
    try {
      const limitResponse = await fetch(
        `${supabaseUrl}/rest/v1/account_recovery_attempts?username_hash=eq.${encodedHash}&select=username_hash,attempts,window_started_at,lock_until`,
        { headers: serviceHeaders(serviceRoleKey) },
      );
      if (!limitResponse.ok) throw new Error("rate-limit lookup failed");
      const rows = await limitResponse.json();
      limitRecord = rows?.[0] || null;
    } catch {
      return json({ error: "Recovery is temporarily unavailable. Try again later." }, 503);
    }

    const legacy = evaluateRecoveryRateLimit(limitRecord);
    try {
      const upsert = await fetch(
        `${supabaseUrl}/rest/v1/account_recovery_attempts?on_conflict=username_hash`,
        {
          method: "POST",
          headers: serviceHeaders(serviceRoleKey, "resolution=merge-duplicates,return=minimal"),
          body: JSON.stringify({ username_hash: usernameHash, ...legacy.next }),
        },
      );
      if (!upsert.ok) throw new Error("rate-limit update failed");
    } catch {
      return json({ error: "Recovery is temporarily unavailable. Try again later." }, 503);
    }
    rate = { allowed: legacy.allowed, retryAfterSeconds: legacy.retryAfterSeconds };
  }

  if (!rate.allowed) {
    await auditEvent({ supabaseUrl, serviceRoleKey, usernameHash, eventType: "rate_limited", metadata: { retry_after_seconds: rate.retryAfterSeconds } });
    return json(
      { error: `Too many recovery attempts. Try again in ${Math.ceil(rate.retryAfterSeconds / 60)} minutes.` },
      429,
      { "retry-after": String(rate.retryAfterSeconds) },
    );
  }

  let profile = null;
  try {
    const profileResponse = await fetch(
      `${supabaseUrl}/rest/v1/profiles?username=eq.${encodeURIComponent(username)}&select=id,recovery_hash,recovery_salt,recovery_kdf&limit=1`,
      { headers: serviceHeaders(serviceRoleKey) },
    );
    if (profileResponse.ok) profile = (await profileResponse.json())?.[0] || null;
  } catch {
    // Continue through the same generic mismatch path.
  }

  // Always perform exactly one PBKDF2-cost comparison, even when no profile
  // was found, so response timing is not a username-existence oracle. A missing
  // profile is verified against a dummy PBKDF2 hash; a legacy (SHA-256) profile
  // additionally runs one throwaway PBKDF2 below so every path costs ~one
  // stretch regardless of KDF. (Legacy rows shrink to zero as recoveries
  // upgrade them, so the fast SHA-256 compare is transient.)
  const dummySalt = "00".repeat(16);
  let hashMatches;
  if (profile?.recovery_hash && profile?.recovery_salt) {
    hashMatches = await verifyRecoveryByKdf(
      recoveryPhrase,
      profile.recovery_salt,
      profile.recovery_hash,
      profile.recovery_kdf,
    );
    // Normalize timing for the legacy path (SHA-256 is far cheaper than PBKDF2).
    if (profile.recovery_kdf !== RECOVERY_KDF_CURRENT) {
      await deriveRecoveryHashPbkdf2("0vertrained-recovery-timing", dummySalt);
    }
  } else {
    const dummyHash = await deriveRecoveryHashPbkdf2("0vertrained-recovery-dummy", dummySalt);
    hashMatches = timingSafeHexEqual(
      await deriveRecoveryHashPbkdf2(recoveryPhrase, dummySalt),
      dummyHash,
    );
  }
  const verified = Boolean(profile?.id) && hashMatches;
  if (!verified) {
    await auditEvent({ supabaseUrl, serviceRoleKey, userId: profile?.id, usernameHash, eventType: "failed" });
    return json({ error: GENERIC_MISMATCH }, 400);
  }

  try {
    const updateResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(profile.id)}`, {
      method: "PUT",
      headers: serviceHeaders(serviceRoleKey),
      body: JSON.stringify({ password: newPassword }),
    });
    if (!updateResponse.ok) throw new Error("password update failed");
  } catch {
    return json({ error: "Password reset failed. Try again later." }, 502);
  }

  // Revoke every existing session for this user. The recovery flow exists for
  // "someone else may have my credentials" moments; without this, an attacker's
  // live session survives the reset that was supposed to end it. Best-effort —
  // the password is already changed, so a failed logout must not fail recovery.
  await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(profile.id)}/logout`, {
    method: "POST",
    headers: serviceHeaders(serviceRoleKey),
  }).catch(() => {});

  // Opportunistically upgrade a legacy SHA-256 recovery hash to PBKDF2 now that
  // the user has proven the phrase. Re-hashes the SAME phrase under the current
  // KDF with a fresh salt. Best-effort — a failed upgrade leaves the working
  // legacy hash untouched and will be retried on the next recovery.
  if (profile.recovery_kdf !== RECOVERY_KDF_CURRENT) {
    try {
      const newSalt = randomBytes(16).toString("hex");
      const newHash = await deriveRecoveryHashPbkdf2(recoveryPhrase, newSalt);
      await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(profile.id)}`, {
        method: "PATCH",
        headers: serviceHeaders(serviceRoleKey, "return=minimal"),
        body: JSON.stringify({ recovery_hash: newHash, recovery_salt: newSalt, recovery_kdf: RECOVERY_KDF_CURRENT }),
      });
    } catch {
      // Non-fatal: the legacy hash still verifies; upgrade retries next time.
    }
  }

  // Clear the username bucket on success (the account owner proved the
  // phrase). The IP bucket is left to decay with its window — success by one
  // user shouldn't reopen spray capacity for a shared host. The legacy-table
  // delete stays for pre-v32 deploys and tolerates the table being dropped.
  await fetch(`${supabaseUrl}/rest/v1/account_recovery_buckets?bucket_key=eq.${encodeURIComponent(`u:${usernameHash}`)}`, {
    method: "DELETE",
    headers: serviceHeaders(serviceRoleKey, "return=minimal"),
  }).catch(() => {});
  await fetch(`${supabaseUrl}/rest/v1/account_recovery_attempts?username_hash=eq.${encodedHash}`, {
    method: "DELETE",
    headers: serviceHeaders(serviceRoleKey, "return=minimal"),
  }).catch(() => {});
  await auditEvent({ supabaseUrl, serviceRoleKey, userId: profile.id, usernameHash, eventType: "succeeded" });

  return json({ ok: true, message: "Password reset. Other devices were signed out. You can sign in now." });
};
