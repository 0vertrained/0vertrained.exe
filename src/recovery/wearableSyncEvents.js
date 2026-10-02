// src/recovery/wearableSyncEvents.js
// ─────────────────────────────────────────────────────────────────────────────
// V3.4 Wearable Sync Events — pure display summarizers
//
// Turns raw wearable_sync_events rows (from the server) into a compact debug
// timeline + empty-state explanations. Pure, side-effect-free, null-safe. No
// network, no Supabase, no logging of raw payloads.
//
// The server stores only event metadata (source, event_type, status, counts,
// message, timestamp). These helpers reshape that metadata for display — they
// never re-derive sync state or fabricate data.
// ─────────────────────────────────────────────────────────────────────────────

const SOURCE_LABELS = { whoop: "Whoop", oura: "Oura", google_health: "Google Health", strava: "Strava" };
const EVENT_LABELS = {
  sync: "Sync",
  connect: "Connect",
  disconnect: "Disconnect",
  token_refresh: "Token refresh",
  token_expired: "Token expired",
  oauth_connected: "OAuth connected",
  oauth_disconnected: "OAuth disconnected",
  sync_started: "Sync started",
  sync_succeeded: "Sync succeeded",
  sync_failed: "Sync failed",
  webhook_received: "Webhook received",
  token_refreshed: "Token refreshed",
  token_revoked: "Token revoked",
  rate_limited: "Rate limited",
};
const STATUS_TONE = {
  success: "good",
  partial: "caution",
  failed: "warning",
  info: "neutral",
};

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function timeAgo(iso, now = Date.now()) {
  if (!iso) return null;
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return null;
  const diff = Math.max(0, now - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const days = Math.floor(hr / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * Summarize a single sync event row into a display-friendly timeline entry.
 * @param {object} row - a wearable_sync_events row
 * @returns {{id, source, sourceLabel, eventType, eventLabel, status, tone, counts, message, days, timestamp, timeAgo}}
 */
export function summarizeSyncEvent(row) {
  if (!row || typeof row !== "object") return null;
  const source = String(row.source || "");
  const eventType = String(row.event_type || "");
  const status = String(row.status || "info");
  const counts = row.counts && typeof row.counts === "object" ? row.counts : {};
  return {
    id: row.id || null,
    source,
    sourceLabel: SOURCE_LABELS[source] || source,
    eventType,
    eventLabel: EVENT_LABELS[eventType] || eventType,
    status,
    tone: STATUS_TONE[status] || "neutral",
    counts,
    message: String(row.message || ""),
    days: num(row.days),
    timestamp: row.created_at || null,
    timeAgo: timeAgo(row.created_at),
  };
}

/**
 * Build a debug timeline from raw sync event rows (newest first).
 * @param {Array<object>} rows - wearable_sync_events rows from the server
 * @param {object} [opts]
 * @param {number} [opts.limit=10] - cap the timeline length
 * @param {string} [opts.source] - filter by source ('whoop' | 'oura')
 * @returns {{entries: Array, hasEvents: boolean, lastEvent: object|null, source: string|null}}
 */
export function buildSyncTimeline(rows, opts = {}) {
  const limit = Math.max(1, num(opts.limit) || 10);
  const filterSource = opts.source || null;
  const list = Array.isArray(rows) ? rows : [];
  const filtered = filterSource ? list.filter((r) => r?.source === filterSource) : list;
  // Sort newest-first by created_at so we don't assume server ordering.
  const sorted = [...filtered].sort((a, b) => {
    const ta = a?.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b?.created_at ? new Date(b.created_at).getTime() : 0;
    return tb - ta;
  });
  const entries = sorted
    .map(summarizeSyncEvent)
    .filter(Boolean)
    .slice(0, limit);
  return {
    entries,
    hasEvents: entries.length > 0,
    lastEvent: entries[0] || null,
    source: filterSource || null,
  };
}

/**
 * Build a human-readable counts string from a sync event's counts object.
 * e.g. { cycle: 7, sleep: 0, recovery: 0, workout: 1 } → "7 cycle · 0 sleep · 0 recovery · 1 workout"
 * @param {object} counts
 * @returns {string|null}
 */
export function formatSyncCounts(counts) {
  if (!counts || typeof counts !== "object") return null;
  const parts = [];
  let hasAny = false;
  for (const key of ["cycle", "sleep", "recovery", "workout"]) {
    const v = num(counts[key]);
    parts.push(`${v ?? 0} ${key}`);
    if (v !== null) hasAny = true;
  }
  for (const key of ["daily", "activities", "exercise", "fetched", "failures"]) {
    if (!Object.prototype.hasOwnProperty.call(counts, key)) continue;
    const v = num(counts[key]);
    parts.push(`${v ?? 0} ${key}`);
    if (v !== null) hasAny = true;
  }
  return hasAny ? parts.join(" · ") : null;
}

/**
 * Build a compact "latest sync summary" for a given source.
 * @param {Array<object>} rows - all sync event rows
 * @param {string} source - 'whoop' or 'oura'
 * @returns {{hasSynced: boolean, lastStatus: string|null, lastTime: string|null, lastMessage: string|null, lastCounts: string|null, partialData: boolean, noScoredRecovery: boolean}}
 */
export function buildLatestSyncSummary(rows, source) {
  const timeline = buildSyncTimeline(rows, { source, limit: 10 });
  const last = timeline.lastEvent;
  if (!last) {
    return {
      hasSynced: false,
      lastStatus: null,
      lastTime: null,
      lastMessage: null,
      lastCounts: null,
      partialData: false,
      noScoredRecovery: false,
    };
  }
  const countsObj = last.counts || {};
  const cycle = num(countsObj.cycle) || 0;
  const sleep = num(countsObj.sleep) || 0;
  const recovery = num(countsObj.recovery) || 0;
  return {
    hasSynced: true,
    lastStatus: last.status,
    lastTime: last.timeAgo,
    lastMessage: last.message,
    lastCounts: formatSyncCounts(countsObj),
    partialData: last.status === "partial" || (cycle > 0 && sleep === 0 && recovery === 0),
    noScoredRecovery: recovery === 0,
  };
}

/**
 * Build an empty-state explanation for why wearable cards may be empty.
 * Uses the latest sync summary to give a specific, honest reason.
 * @param {object} params
 * @param {Array<object>} params.events - sync event rows
 * @param {string} params.source - 'whoop' or 'oura'
 * @param {boolean} [params.connected] - is the wearable currently connected?
 * @returns {{title: string, body: string, tone: string, hasExplanation: boolean}}
 */
export function buildEmptyStateExplanation({ events = [], source = "whoop", connected = true } = {}) {
  const summary = buildLatestSyncSummary(events, source);
  const sourceLabel = SOURCE_LABELS[source] || source;

  if (!connected) {
    return {
      title: `${sourceLabel} not connected`,
      body: `Connect ${sourceLabel} in Settings → Integrations to see wearable context here.`,
      tone: "neutral",
      hasExplanation: true,
    };
  }

  if (!summary.hasSynced) {
    return {
      title: `${sourceLabel} connected — not synced yet`,
      body: `Tap “Sync now” in Settings → Integrations to pull your recent ${sourceLabel} data.`,
      tone: "neutral",
      hasExplanation: true,
    };
  }

  if (summary.lastStatus === "failed") {
    return {
      title: `${sourceLabel} sync failed`,
      body: summary.lastMessage || `The last ${sourceLabel} sync failed. Try syncing again, or reconnect if the token has expired.`,
      tone: "warning",
      hasExplanation: true,
    };
  }

  if (summary.partialData) {
    return {
      title: `${sourceLabel} synced — partial data`,
      body: source === "whoop"
        ? "Only cycle data was available. Sleep and recovery may appear after Whoop processes your next sleep."
        : `Only partial ${sourceLabel} data was available. Try syncing again later.`,
      tone: "caution",
      hasExplanation: true,
    };
  }

  if (summary.noScoredRecovery) {
    return {
      title: `${sourceLabel} synced — no scored recovery yet`,
      body: source === "whoop"
        ? "Whoop is connected and syncing, but no scored recovery has been computed yet. This is normal for a new connection — it should appear after your next full sleep."
        : `No scored recovery from ${sourceLabel} yet. This may resolve after the next sync.`,
      tone: "caution",
      hasExplanation: true,
    };
  }

  return {
    title: `${sourceLabel} data is up to date`,
    body: `Last sync ${summary.lastTime || "recently"}${summary.lastCounts ? ` · ${summary.lastCounts}` : ""}.`,
    tone: "good",
    hasExplanation: true,
  };
}

/**
 * Build a compact overall sync health badge for a source.
 * @param {Array<object>} events
 * @param {string} source
 * @returns {{label: string, tone: string}}
 */
export function buildSyncHealthBadge(events, source) {
  const summary = buildLatestSyncSummary(events, source);
  if (!summary.hasSynced) return { label: "never synced", tone: "neutral" };
  if (summary.lastStatus === "failed") return { label: "sync failed", tone: "warning" };
  if (summary.partialData) return { label: "partial data", tone: "caution" };
  if (summary.noScoredRecovery) return { label: "no scored recovery", tone: "caution" };
  return { label: `synced ${summary.lastTime || "recently"}`, tone: "good" };
}

export default {
  summarizeSyncEvent,
  buildSyncTimeline,
  formatSyncCounts,
  buildLatestSyncSummary,
  buildEmptyStateExplanation,
  buildSyncHealthBadge,
};