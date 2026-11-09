/**
 * pendingSavesStore.js
 *
 * Persistent offline save queue, namespaced by userId.
 *
 * Before this module, the pending-save queue lived only in React state
 * (App.jsx `pendingSaves`). Failed saves — dead gym wifi, half-alive LTE —
 * were queued in memory and retried on reconnect, but if iOS suspended the
 * PWA or the user closed it before signal returned, the queued entries
 * evaporated. Because appDataCache is only written on save SUCCESS, the next
 * cold open didn't show them either: a logged workout silently vanished.
 *
 * This store is the durable copy of that queue. App.jsx writes through on
 * every queue change, overlays the stored queue onto loaded data on boot
 * (local edits are canonical over server state — the queue only exists
 * because the server hasn't accepted them yet), and retries each entry.
 *
 * Deliberate asymmetry with the other per-user caches: this store is NOT
 * cleared on logout. appDataCache / recovery caches are re-downloadable
 * copies of server truth; a pending save is the ONLY copy of that workout.
 * Keys are namespaced per user, so another account on the same device never
 * reads them into its own state, and the same user logging back in gets
 * their queue flushed.
 *
 * Conventions match appDataCache.js: pure functions, version-stamped keys,
 * malformed JSON degrades to empty, localStorage failures are swallowed.
 */

const STORE_VERSION = "1";
const keyFor = (userId) => `ovt-pending-saves-v${STORE_VERSION}-${userId}`;

// Total serialized ceiling. A legitimate day's payload is well under 10KB and
// saveEntry rejects anything over 100KB, so this comfortably holds weeks of
// queued days while bounding a pathological localStorage bloat.
const MAX_STORE_BYTES = 400_000;

/**
 * Read the pending queue for a user.
 * @param {string} userId
 * @returns {Record<string, object>} map of entryDate → day payload ({} on any failure)
 */
export function readPendingSaves(userId) {
  if (!userId) return {};
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

/**
 * Persist the pending queue for a user. An empty queue removes the key.
 * When the serialized queue exceeds MAX_STORE_BYTES, the oldest dateKeys are
 * dropped first (YYYY-MM-DD sorts lexicographically) — the most recent
 * workouts are the ones worth protecting.
 * @param {string} userId
 * @param {Record<string, object>} map
 */
export function writePendingSaves(userId, map) {
  if (!userId) return;
  try {
    const entries = Object.entries(map || {}).filter(([, payload]) => payload != null);
    if (!entries.length) {
      localStorage.removeItem(keyFor(userId));
      return;
    }
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    let serialized = JSON.stringify(Object.fromEntries(entries));
    while (serialized.length > MAX_STORE_BYTES && entries.length > 1) {
      entries.shift(); // drop the oldest day first
      serialized = JSON.stringify(Object.fromEntries(entries));
    }
    localStorage.setItem(keyFor(userId), serialized);
  } catch {
    // localStorage unavailable/full — the in-memory queue still retries this
    // session; durability degrades gracefully instead of crashing a save.
  }
}

/**
 * Remove the stored queue for a user. Not called on logout (see header note);
 * exists for explicit account-deletion / data-wipe paths.
 * @param {string} userId
 */
export function clearPendingSaves(userId) {
  if (!userId) return;
  try {
    localStorage.removeItem(keyFor(userId));
  } catch {
    // Ignore — absence of the key is the goal either way.
  }
}
