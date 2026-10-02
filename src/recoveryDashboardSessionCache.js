// src/recoveryDashboardSessionCache.js
// In-memory, per-session cache for the Recovery tab's derived dashboard state.
// This prevents tab switches from dropping back to skeletons while Oura refreshes.

const recoveryDashboardCache = new Map();

export function getRecoveryCacheKey(userId) {
  return typeof userId === "string" && userId.trim() ? `recovery-${userId}` : null;
}

export function readRecoveryDashboardCache(userId) {
  const key = getRecoveryCacheKey(userId);
  if (!key) return null;
  return recoveryDashboardCache.get(key) || null;
}

export function writeRecoveryDashboardCache(userId, snapshot) {
  if (!snapshot || typeof snapshot !== "object") return;
  const key = getRecoveryCacheKey(userId);
  if (!key) return;
  recoveryDashboardCache.set(key, {
    ...snapshot,
    cachedAt: Date.now(),
  });
}

export function clearRecoveryDashboardCache(userId) {
  if (userId) {
    recoveryDashboardCache.delete(getRecoveryCacheKey(userId));
    return;
  }
  recoveryDashboardCache.clear();
}
