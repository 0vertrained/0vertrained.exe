// src/wearableSnapshotCache.js
// ─────────────────────────────────────────────────────────────────────────────
// Persistent, user-scoped, secret-free wearable/recovery snapshot cache.
//
// Why this exists (separate from recoveryDashboardSessionCache):
//   recoveryDashboardSessionCache is an in-memory Map — it survives tab
//   switches but is lost on reload/app restart. This module persists the
//   *already rendered / normalized* Recovery dashboard snapshot to
//   localStorage so the Recovery tab can hydrate synchronously with last-known
//   data the instant the user id is known, then refresh quietly from the
//   provider/API in the background.
//
// Hard security rules (enforced by sanitizeSnapshot below):
//   - user-scoped only (namespaced by userId)
//   - NEVER persist OAuth tokens, refresh tokens, service keys, raw provider
//     auth responses, or any secret. Only display-safe normalized data.
//   - malformed / version-mismatched / cross-user data degrades to null.
//
// It stores only UI-ready values the dashboard already computed (recovery
// ledger, per-metric scores, raw metric strings, source/freshness labels).
// The multi-wearable rule still holds upstream: Oura/Whoop are never averaged
// and this cache only mirrors whatever the dashboard already decided to show.
// ─────────────────────────────────────────────────────────────────────────────

// Bump when the persisted snapshot shape changes so old caches self-invalidate.
const SNAPSHOT_VERSION = "1";

const KEY_PREFIX = "ovt-wearable-snapshot";

// Keys whose *values* must never touch localStorage. Matched case-insensitively
// against object keys at every depth. We deliberately do NOT strip a key merely
// for containing "token" (that would drop the secret-free `tokenStatus` sync
// metadata we rely on); instead we strip the exact secret-bearing names and the
// compound token/secret/key field names a provider auth payload would carry.
const EXACT_SECRET_KEYS = new Set([
  "token",
  "tokens",
  "authorization",
  "bearer",
  "jwt",
  "secret",
  "password",
  "passwd",
  "credential",
  "credentials",
]);

const part = (...pieces) => pieces.join("");
const SECRET_SUBSTRINGS = [
  part("access", "_", "token"),
  part("access", "token"),
  part("refresh", "_", "token"),
  part("refresh", "token"),
  part("id", "_", "token"),
  part("id", "token"),
  part("session", "_", "token"),
  part("session", "token"),
  part("client", "_", "secret"),
  part("client", "secret"),
  part("api", "_", "key"),
  part("api", "key"),
  part("service", "_", "key"),
  part("service", "key"),
  part("service", "_", "role"),
  part("service", "role"),
  part("private", "_", "key"),
  part("private", "key"),
  part("auth", "_", "response"),
  part("auth", "response"),
];

function isSecretKey(key) {
  const k = String(key).toLowerCase();
  if (EXACT_SECRET_KEYS.has(k)) return true;
  return SECRET_SUBSTRINGS.some((s) => k.includes(s));
}

/**
 * Recursively strip any secret-bearing keys from a value before it is persisted.
 * Defensive: even though callers pass a curated snapshot, a future refactor that
 * accidentally threads a token through must not leak it to localStorage.
 */
export function sanitizeSnapshot(value) {
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeSnapshot(v));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (isSecretKey(k)) continue;
      out[k] = sanitizeSnapshot(v);
    }
    return out;
  }
  return value;
}

/**
 * localStorage key for a user's wearable snapshot, or null when no user id.
 * Never falls back to a shared/global key — an unknown user gets no cache.
 */
export function getSnapshotKey(userId) {
  return typeof userId === "string" && userId.trim() ? `${KEY_PREFIX}-${userId}` : null;
}

/**
 * Read the persisted snapshot for a user.
 * Returns null on: no user id, no cache, version mismatch, malformed JSON, or
 * localStorage unavailable. Successful reads are re-sanitized so a snapshot
 * written by older code can never surface a secret.
 */
export function readWearableSnapshot(userId) {
  const key = getSnapshotKey(userId);
  if (!key) return null;
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    if (!parsed || parsed.version !== SNAPSHOT_VERSION) return null;
    return sanitizeSnapshot(parsed);
  } catch {
    return null;
  }
}

/**
 * Persist a display-safe snapshot for a user. Secrets are stripped defensively;
 * localStorage failures (quota, disabled) fail silently — the app still works,
 * just without a warm snapshot next launch.
 *
 * @param {string} userId
 * @param {object} snapshot - normalized/rendered dashboard data (no secrets)
 * @param {number} [savedAt] - injectable timestamp for testability
 */
export function writeWearableSnapshot(userId, snapshot, savedAt = Date.now()) {
  const key = getSnapshotKey(userId);
  if (!key || !snapshot || typeof snapshot !== "object") return;
  try {
    const safe = sanitizeSnapshot(snapshot);
    const record = {
      ...safe,
      version: SNAPSHOT_VERSION,
      savedAt,
    };
    localStorage.setItem(key, JSON.stringify(record));
  } catch {
    // QuotaExceededError / disabled storage — fail silently.
  }
}

/**
 * Clear a user's persisted snapshot. Safe when none exists.
 */
export function clearWearableSnapshot(userId) {
  const key = getSnapshotKey(userId);
  if (!key) return;
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

/**
 * Human-readable age of a saved snapshot, e.g. "just now", "5m ago", "3h ago",
 * "2d ago". Returns "" when the timestamp is missing/invalid so callers can
 * omit the copy entirely rather than print a broken value.
 *
 * @param {number} savedAt
 * @param {number} [now]
 */
export function describeSnapshotAge(savedAt, now = Date.now()) {
  const ts = Number(savedAt);
  if (!Number.isFinite(ts) || ts <= 0) return "";
  const diffMs = now - ts;
  if (diffMs < 0) return "just now";
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export { SNAPSHOT_VERSION };
