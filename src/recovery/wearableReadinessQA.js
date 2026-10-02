// src/recovery/wearableReadinessQA.js
// ─────────────────────────────────────────────────────────────────────────────
// V4.5 Wearable Readiness QA — pure, display-only status builder.
//
// Turns the wearable connection state + raw sync events + a "scored recovery
// available?" flag into a compact, honest readiness status. It NEVER changes any
// recovery score, re-derives data, or fetches; it only explains what the athlete
// is (or isn't) seeing and why — so a fresh wearable connection or a manual-only
// setup never reads as "broken".
//
// Hard rules:
//   - Manual recovery is first-class. No-wearable is a valid, confident state.
//   - Oura and Whoop are NEVER averaged. When both are active the message is a
//     conservative "mixed signal" reminder, not a blended number.
//   - Pure + null-safe. Callers inject `now` so every branch is unit-testable.
// ─────────────────────────────────────────────────────────────────────────────

import { buildLatestSyncSummary, buildSyncTimeline } from "./wearableSyncEvents";

const SOURCE_LABELS = { oura: "Oura", whoop: "Whoop" };

// A wearable reading older than this (no successful sync) is called out as stale.
export const STALE_HOURS = 36;

function hoursSince(iso, now) {
  if (!iso) return null;
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return null;
  const ref = now instanceof Date ? now.getTime() : new Date(now ?? Date.now()).getTime();
  if (!Number.isFinite(ref)) return null;
  return Math.max(0, ref - ts) / (1000 * 60 * 60);
}

/**
 * Build a per-source readiness status from that source's sync events.
 * @param {object} params
 * @param {"oura"|"whoop"} params.source
 * @param {boolean} params.connected
 * @param {Array<object>} params.events - sync event rows (any source; filtered here)
 * @param {number|Date} [params.now]
 * @returns {{source, sourceLabel, connected, status, tone, title, body, lastSyncAt, stale}}
 */
export function buildSourceReadiness({ source = "oura", connected = false, events = [], now } = {}) {
  const sourceLabel = SOURCE_LABELS[source] || source;

  if (!connected) {
    return {
      source,
      sourceLabel,
      connected: false,
      status: "not-connected",
      tone: "neutral",
      title: `${sourceLabel} not connected`,
      body: `Optional. Connect ${sourceLabel} in Settings → Integrations to add HRV and resting-HR confidence — manual recovery works fully without it.`,
      lastSyncAt: null,
      stale: false,
    };
  }

  const summary = buildLatestSyncSummary(events, source);
  const timeline = buildSyncTimeline(events, { source, limit: 1 });
  const lastSyncAt = timeline.lastEvent?.timestamp || null;
  const ageHours = hoursSince(lastSyncAt, now);
  const stale = summary.hasSynced && ageHours !== null && ageHours > STALE_HOURS;

  if (!summary.hasSynced) {
    return {
      source, sourceLabel, connected: true,
      status: "awaiting-first-sync",
      tone: "neutral",
      title: `${sourceLabel} connected — no sync yet`,
      body: `Tap “Sync now” in Settings → Integrations. Recovery appears after ${sourceLabel} processes your next full sleep — that delay is normal.`,
      lastSyncAt,
      stale: false,
    };
  }

  if (summary.lastStatus === "failed") {
    return {
      source, sourceLabel, connected: true,
      status: "sync-failed",
      tone: "warning",
      title: `${sourceLabel} sync failed`,
      body: summary.lastMessage
        ? `Last ${sourceLabel} sync failed: ${summary.lastMessage}. Try again, or reconnect if the token expired.`
        : `The last ${sourceLabel} sync failed. Try again, or reconnect if the token expired. Manual recovery still covers you meanwhile.`,
      lastSyncAt,
      stale,
    };
  }

  if (summary.partialData || summary.noScoredRecovery) {
    return {
      source, sourceLabel, connected: true,
      status: summary.partialData ? "partial" : "awaiting-first-sleep",
      tone: "caution",
      title: `${sourceLabel} synced — no scored recovery yet`,
      body: `${sourceLabel} is syncing, but no scored recovery is in yet. This is normal for a new connection — expect it after your next full sleep is processed.`,
      lastSyncAt,
      stale,
    };
  }

  if (stale) {
    return {
      source, sourceLabel, connected: true,
      status: "stale",
      tone: "caution",
      title: `${sourceLabel} data may be stale`,
      body: `Last successful ${sourceLabel} sync was ${summary.lastTime || "a while ago"} (>${STALE_HOURS}h). Sync again to refresh; today's read may still lean on manual input.`,
      lastSyncAt,
      stale: true,
    };
  }

  return {
    source, sourceLabel, connected: true,
    status: "ok",
    tone: "good",
    title: `${sourceLabel} up to date`,
    body: `Last sync ${summary.lastTime || "recently"}${summary.lastCounts ? ` · ${summary.lastCounts}` : ""}.`,
    lastSyncAt,
    stale: false,
  };
}

/**
 * Build the overall wearable readiness QA status.
 * @param {object} params
 * @param {boolean} [params.ouraConnected]
 * @param {boolean} [params.whoopConnected]
 * @param {Array<object>} [params.events] - all sync event rows (both sources)
 * @param {Array<object>} [params.conflicts] - resolveRecoveryContext().conflicts (optional)
 * @param {number|Date} [params.now]
 * @returns {{mode, status, tone, title, body, sources, mixedSignal, manual, actionable}}
 */
export function buildWearableReadinessQA({
  ouraConnected = false,
  whoopConnected = false,
  events = [],
  conflicts = [],
  now,
} = {}) {
  // ── Manual-only: a first-class, confident state — never "broken". ──
  if (!ouraConnected && !whoopConnected) {
    return {
      mode: "manual",
      status: "manual",
      tone: "neutral",
      title: "Manual recovery mode",
      body:
        "No wearable connected — that's a complete setup. Logging sleep and energy each day drives a full readiness read. Connect Oura or Whoop later for extra confidence.",
      sources: [],
      mixedSignal: false,
      manual: true,
      actionable: false,
    };
  }

  const sources = [];
  if (ouraConnected) sources.push(buildSourceReadiness({ source: "oura", connected: true, events, now }));
  if (whoopConnected) sources.push(buildSourceReadiness({ source: "whoop", connected: true, events, now }));

  const bothActive = ouraConnected && whoopConnected;
  const conflictList = Array.isArray(conflicts) ? conflicts : [];
  const mixedSignal = bothActive && conflictList.length > 0;
  const mode = bothActive ? "dual" : ouraConnected ? "oura" : "whoop";

  // Overall tone/headline: surface the most urgent per-source state first, then
  // the conservative mixed-signal reminder, then the healthy case.
  const worst =
    sources.find((s) => s.tone === "warning") ||
    sources.find((s) => s.tone === "caution") ||
    null;

  if (worst) {
    return {
      mode,
      status: worst.status,
      tone: worst.tone,
      title: worst.title,
      body: worst.body,
      sources,
      mixedSignal,
      manual: false,
      actionable: worst.tone === "warning",
    };
  }

  if (mixedSignal) {
    const metrics = conflictList.map((c) => c?.metric).filter(Boolean).join(", ");
    return {
      mode,
      status: "mixed",
      tone: "caution",
      title: "Mixed Oura/Whoop signal",
      body: `Oura and Whoop disagree${metrics ? ` on ${metrics}` : ""}. They're never averaged — today's read stays conservative and leans on the safer source.`,
      sources,
      mixedSignal: true,
      manual: false,
      actionable: false,
    };
  }

  if (bothActive) {
    return {
      mode,
      status: "ok",
      tone: "good",
      title: "Oura + Whoop in agreement",
      body: "Both wearables are synced and agree — no averaging needed. Manual notes still add context.",
      sources,
      mixedSignal: false,
      manual: false,
      actionable: false,
    };
  }

  // Single connected wearable, healthy.
  const only = sources[0];
  return {
    mode,
    status: only.status,
    tone: only.tone,
    title: only.title,
    body: only.body,
    sources,
    mixedSignal: false,
    manual: false,
    actionable: only.tone === "warning",
  };
}

export default {
  STALE_HOURS,
  buildSourceReadiness,
  buildWearableReadinessQA,
};
