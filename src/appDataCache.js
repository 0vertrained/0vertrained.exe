/**
 * appDataCache.js
 *
 * Local-first data cache with stale-while-revalidate pattern for 0vertrained.
 * Stores entries, program, settings, and myUsername in localStorage, namespaced by userId.
 *
 * Design:
 * - Pure functions for read/write/clear/invalidate
 * - Version mismatch invalidates cache automatically
 * - Malformed JSON returns null (graceful degradation)
 * - Tolerates localStorage failures
 * - No secrets cached
 * - Timestamps track freshness (5-minute staleness threshold)
 */

// Current cache format version — bump this when the schema changes to invalidate old caches
const CACHE_VERSION = "1";

// 5 minutes in milliseconds — beyond this, cache is considered stale for stale-while-revalidate
const STALENESS_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Read cache for a user.
 * Returns null if:
 * - No cache exists
 * - Cache version mismatch
 * - JSON parse fails
 * - localStorage is unavailable
 *
 * @param {string} userId - User ID to scope the cache
 * @returns {null | object} - Cache object with {entries, program, settings, myUsername, version, timestamp} or null
 */
export function readCache(userId) {
  if (!userId) return null;

  try {
    const key = `ovt-cache-${userId}`;
    const stored = localStorage.getItem(key);

    if (!stored) return null;

    const parsed = JSON.parse(stored);

    // Version mismatch means the schema changed — invalidate to be safe
    if (parsed.version !== CACHE_VERSION) return null;

    // Return the cached data
    return parsed;
  } catch (err) {
    // Any error (parse, localStorage unavailable, etc.) returns null gracefully
    return null;
  }
}

/**
 * Write cache for a user with entries, program, settings, myUsername.
 * Silently fails if localStorage is unavailable or quota exceeded.
 *
 * @param {string} userId - User ID to scope the cache
 * @param {object} data - {entries, program, settings, myUsername}
 * @returns {void}
 */
export function writeCache(userId, data) {
  if (!userId || !data) return;

  try {
    const key = `ovt-cache-${userId}`;
    const cacheObject = {
      version: CACHE_VERSION,
      timestamp: Date.now(),
      entries: data.entries || {},
      program: data.program || null,
      settings: data.settings || {},
      myUsername: data.myUsername || null,
    };

    localStorage.setItem(key, JSON.stringify(cacheObject));
  } catch (err) {
    // QuotaExceededError, localStorage disabled, etc. — fail silently.
    // The app will still work, just without cached data on next load.
  }
}

/**
 * Clear cache for a user.
 * Safe to call even if no cache exists.
 *
 * @param {string} userId - User ID to scope the cache
 * @returns {void}
 */
export function clearCache(userId) {
  if (!userId) return;

  try {
    const key = `ovt-cache-${userId}`;
    localStorage.removeItem(key);
  } catch (err) {
    // Ignore errors — fail silently
  }
}

/**
 * Invalidate cache for a user (same as clearCache, explicit naming for semantic clarity).
 *
 * @param {string} userId - User ID to scope the cache
 * @returns {void}
 */
export function invalidateCache(userId) {
  clearCache(userId);
}

/**
 * Get cache status for a user (for optional UI display of sync status).
 *
 * @param {string} userId - User ID to scope the cache
 * @returns {object} - {cached: boolean, timestamp?: number, stale?: boolean}
 */
export function getCacheStatus(userId) {
  const cache = readCache(userId);

  if (!cache) {
    return { cached: false };
  }

  const ageMs = Date.now() - cache.timestamp;
  const isStale = ageMs > STALENESS_THRESHOLD_MS;

  return {
    cached: true,
    timestamp: cache.timestamp,
    stale: isStale,
  };
}
