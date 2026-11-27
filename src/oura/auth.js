// src/oura/auth.js
// Oura Auth & Connection Management
//
// Handles OAuth flow, token management, and connection status checks.
// Security: getOuraAuthUrl calls /api/oura/auth with Bearer token, no userId query string.

import { supabase } from "../supabaseClient";
import { createCloudProvider } from "../integrations/cloudProvider";
import { invalidateOuraData } from "./dataLoading";
import { isDemoMode } from "../demoData";

export const ouraCloud = createCloudProvider({
  defaultDays: 14,
  status: "/api/oura/status",
  sync: "/api/oura/sync",
  disconnect: "/api/oura/disconnect",
}, invalidateOuraData);

/**
 * Build Oura OAuth authorize URL
 */
export async function getOuraAuthUrl() {
  if (isDemoMode()) return null;
  // Ask the server to build the Oura URL after verifying the current Supabase JWT.
  // Do not send userId in the query string; OAuth ownership must be derived server-side.
  // The OAuth client id is not needed in the browser; keeping this server-side
  // avoids a needless public VITE_ env dependency blocking account linking.
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return null;

  const r = await fetch("/api/oura/auth", {
    headers: {
      "accept": "application/json",
      "authorization": `Bearer ${token}`,
    },
  });
  if (!r.ok) return null;
  const data = await r.json();
  return typeof data?.url === "string" ? data.url : null;
}

/**
 * Check if Oura is connected (tokens exist). Token table reads stay server-side.
 */
export async function isOuraConnected() {
  if (isDemoMode()) return true;
  return (await ouraCloud.status(60_000)).connected;
}

/**
 * Disconnect Oura — delete tokens and data
 */
export async function disconnectOura() {
  if (isDemoMode()) return { ok: true };
  return ouraCloud.disconnect();
}

/**
 * Fetch recent Oura sync events for the debug timeline. Reads
 * the server's /api/oura/events endpoint (Bearer-authenticated; ownership is
 * server-derived). Returns only metadata — no raw payloads, no tokens.
 * Shape: { events: Array<row>, error?: string }.
 */
export async function getOuraSyncEvents(limit = 20) {
  if (isDemoMode()) return { events: [] };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return { events: [], error: "Not authenticated" };
    const qs = Number.isFinite(Number(limit)) ? `?limit=${encodeURIComponent(Math.min(50, Math.max(1, Math.round(Number(limit)))))}` : "";
    const r = await fetch(`/api/oura/events${qs}`, {
      headers: {
        "accept": "application/json",
        "authorization": `Bearer ${token}`,
      },
    });
    if (!r.ok) return { events: [], error: "Events unavailable" };
    const data = await r.json().catch(() => ({}));
    return { events: Array.isArray(data?.events) ? data.events : [] };
  } catch (e) {
    console.error("getOuraSyncEvents error:", e);
    return { events: [], error: e.message };
  }
}

/**
 * Check Oura token health and last sync timestamp.
 * Returns { connected, expiresAt, isExpired, lastSynced, syncStatus }
 * Demo mode returns synthetic healthy status.
 */
export async function getOuraTokenStatus() {
  if (isDemoMode()) {
    return {
      connected: true,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      isExpired: false,
      lastSynced: new Date().toISOString(),
      syncStatus: "recent",
    };
  }

  const data = await ouraCloud.status();
  return {
    connected: !!data.connected,
    expiresAt: data.expiresAt || null,
    isExpired: !!data.isExpired,
    lastSynced: data.lastSynced || null,
    syncStatus: data.syncStatus || "never",
  };
}

/**
 * Trigger a manual Oura sync. Caller-authenticated POST — the server derives
 * ownership from the Bearer token, not any body field. `days` selects the
 * backfill window (14 by default, 30 for the initial backfill button); the
 * server clamps it to a safe range.
 * Returns the server summary, or { error } on failure.
 */
export async function syncOuraNow(days = 14) {
  if (isDemoMode()) return { ok: true, synced: 0, counts: {}, demo: true };
  return ouraCloud.syncNow(days);
}

/**
 * Per-type Oura record counts for the Settings/Integrations surface. Reads the
 * server's /api/oura/counts endpoint (Bearer-authenticated; ownership is
 * server-derived). Returns a stable shape so the UI can render completeness
 * without any raw biometrics leaving the server-derived summary.
 * Shape: { sleep, readiness, activity, heartrate, spo2, lastSynced, latestDate }.
 */
export async function getOuraSyncCounts() {
  const zero = { sleep: 0, readiness: 0, activity: 0, heartrate: 0, spo2: 0, lastSynced: null, latestDate: null };
  if (isDemoMode()) return { ...zero };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return { ...zero };
    const r = await fetch("/api/oura/counts", {
      headers: {
        "accept": "application/json",
        "authorization": `Bearer ${token}`,
      },
    });
    if (!r.ok) return { ...zero };
    const data = await r.json();
    return {
      sleep: Number(data?.sleep) || 0,
      readiness: Number(data?.readiness) || 0,
      activity: Number(data?.activity) || 0,
      heartrate: Number(data?.heartrate) || 0,
      spo2: Number(data?.spo2) || 0,
      lastSynced: data?.lastSynced || null,
      latestDate: data?.latestDate || null,
    };
  } catch (e) {
    console.error("getOuraSyncCounts error:", e);
    return { ...zero };
  }
}
