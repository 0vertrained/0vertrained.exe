// src/whoop/auth.js
// Whoop Auth & Connection Management
//
// Mirrors src/oura/auth.js. All privileged work happens server-side:
// • getWhoopAuthUrl() asks /api/whoop/auth (with the Supabase JWT) to build the
//   Whoop authorize URL — no client secret, no userId in any query string.
// • Status / disconnect / sync go through /api/whoop/* with a Bearer token.
// • The browser NEVER reads whoop_tokens; ownership is server-derived.

import { supabase } from "../supabaseClient";
import { createCloudProvider } from "../integrations/cloudProvider";
import { invalidateWhoopData } from "./dataLoading";
import { isDemoMode } from "../demoData";

export const whoopCloud = createCloudProvider({
  defaultDays: 14,
  status: "/api/whoop/status",
  sync: "/api/whoop/sync",
  disconnect: "/api/whoop/disconnect",
}, invalidateWhoopData);

async function getAccessToken() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || null;
}

/**
 * Ask the server to build the Whoop OAuth authorize URL after verifying the
 * current Supabase JWT. Ownership + CSRF state are handled server-side.
 * Returns the URL string, or null if not configured / not authenticated.
 */
export async function getWhoopAuthUrl() {
  if (isDemoMode()) return null;
  const token = await getAccessToken();
  if (!token) return null;
  try {
    const r = await fetch("/api/whoop/auth", {
      headers: {
        "accept": "application/json",
        "authorization": `Bearer ${token}`,
      },
    });
    if (!r.ok) return null;
    const data = await r.json();
    return typeof data?.url === "string" ? data.url : null;
  } catch (e) {
    console.error("getWhoopAuthUrl error:", e);
    return null;
  }
}

/**
 * Whoop is opt-in; connection state lives server-side. Token table reads never
 * happen in the browser — we ask /api/whoop/status.
 */
export async function isWhoopConnected() {
  if (isDemoMode()) return true;
  return (await whoopCloud.status(60_000)).connected;
}

/**
 * Whoop token health + last sync timestamp.
 * Returns { connected, expiresAt, isExpired, lastSynced, syncStatus }.
 */
export async function getWhoopTokenStatus() {
  if (isDemoMode()) {
    return {
      connected: true,
      expiresAt: null,
      isExpired: false,
      lastSynced: new Date().toISOString(),
      syncStatus: "ok",
    };
  }
  const data = await whoopCloud.status();
  return {
    connected: !!data.connected,
    expiresAt: data.expiresAt || null,
    isExpired: !!data.isExpired,
    lastSynced: data.lastSynced || null,
    syncStatus: data.syncStatus || "never",
  };
}

/**
 * Trigger a manual sync. Caller-authenticated POST — the server derives
 * ownership from the Bearer token, not any body field. `days` selects the
 * backfill window (14 by default, 30 for the initial backfill button); the
 * server clamps it to a safe range.
 * Returns the server summary, or { error } on failure.
 */
export async function syncWhoopNow(days = 14) {
  if (isDemoMode()) return { ok: true, synced: 0, counts: {}, demo: true };
  return whoopCloud.syncNow(days);
}

/**
 * Per-type Whoop record counts for the Settings/Integrations surface. Reads the
 * server's /api/whoop/counts endpoint (Bearer-authenticated; ownership is
 * server-derived). Returns a stable shape so the UI can render completeness
 * without any raw biometrics leaving the server-derived summary.
 * Shape: { cycle, sleep, recovery, workout, lastSynced, latestDate }.
 */
export async function getWhoopSyncCounts() {
  const zero = { cycle: 0, sleep: 0, recovery: 0, workout: 0, lastSynced: null, latestDate: null };
  if (isDemoMode()) return { ...zero };
  try {
    const token = await getAccessToken();
    if (!token) return { ...zero };
    const r = await fetch("/api/whoop/counts", {
      headers: {
        "accept": "application/json",
        "authorization": `Bearer ${token}`,
      },
    });
    if (!r.ok) return { ...zero };
    const data = await r.json();
    return {
      cycle: Number(data?.cycle) || 0,
      sleep: Number(data?.sleep) || 0,
      recovery: Number(data?.recovery) || 0,
      workout: Number(data?.workout) || 0,
      lastSynced: data?.lastSynced || null,
      latestDate: data?.latestDate || null,
    };
  } catch (e) {
    console.error("getWhoopSyncCounts error:", e);
    return { ...zero };
  }
}

/**
 * Fetch recent Whoop sync events for the debug timeline. Reads the
 * server's /api/whoop/events endpoint (Bearer-authenticated; ownership is
 * server-derived). Returns only metadata — no raw payloads, no tokens.
 * Shape: { events: Array<row>, error?: string }.
 */
export async function getWhoopSyncEvents(limit = 20) {
  if (isDemoMode()) return { events: [] };
  try {
    const token = await getAccessToken();
    if (!token) return { events: [], error: "Not authenticated" };
    const qs = Number.isFinite(Number(limit)) ? `?limit=${encodeURIComponent(Math.min(50, Math.max(1, Math.round(Number(limit)))))}` : "";
    const r = await fetch(`/api/whoop/events${qs}`, {
      headers: {
        "accept": "application/json",
        "authorization": `Bearer ${token}`,
      },
    });
    if (!r.ok) return { events: [], error: "Events unavailable" };
    const data = await r.json().catch(() => ({}));
    return { events: Array.isArray(data?.events) ? data.events : [] };
  } catch (e) {
    console.error("getWhoopSyncEvents error:", e);
    return { events: [], error: e.message };
  }
}

/**
 * Disconnect Whoop — deletes tokens + data + any pending oauth state server-side.
 */
export async function disconnectWhoop() {
  if (isDemoMode()) return { ok: true };
  return whoopCloud.disconnect();
}
