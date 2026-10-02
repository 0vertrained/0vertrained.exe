// src/oura/auth.js
// ─────────────────────────────────────────────────────────────────────────────
// Oura Auth & Connection Management
//
// Handles OAuth flow, token management, and connection status checks.
// Security: getOuraAuthUrl calls /api/oura/auth with Bearer token, no userId query string.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from "../supabaseClient";
import { memoizeAsync } from "../asyncMemo";
import { isDemoMode } from "../demoData";

/**
 * Build Oura OAuth authorize URL
 */
export async function getOuraAuthUrl() {
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
// V14.2 · Memoized (60s TTL + single-flight): a cold boot fired this probe
// from App, TodayTab, and RecoveryDashboard within the same second — each a
// full /api/oura/status function invocation (bearer verify + summary +
// possible token self-heal server-side). Presence cannot meaningfully flap
// inside a minute; disconnectOura invalidates immediately when it does change.
const isOuraConnectedMemo = memoizeAsync(isOuraConnectedProbe, 60_000);
export async function isOuraConnected() {
  if (isDemoMode()) return true;
  return isOuraConnectedMemo();
}

async function isOuraConnectedProbe() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return false;
    const r = await fetch("/api/oura/status", {
      headers: {
        "accept": "application/json",
        "authorization": `Bearer ${token}`,
      },
    });
    if (!r.ok) return false;
    const data = await r.json();
    return !!data?.connected;
  } catch (e) {
    console.error("isOuraConnected error:", e);
    return false;
  }
}

/**
 * Disconnect Oura — delete tokens and data
 */
export async function disconnectOura() {
  isOuraConnectedMemo.invalidate();
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return { error: "Not authenticated" };
    const r = await fetch("/api/oura/disconnect", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "authorization": `Bearer ${session.access_token}`,
      },
    });
    if (!r.ok) return { error: "Disconnect failed" };
    return { ok: true };
  } catch (e) {
    console.error("Disconnect error:", e);
    return { error: e.message };
  }
}

/**
 * Fetch recent Oura sync events for the debug timeline (V3.4 parity). Reads
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

  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      return {
        connected: false,
        expiresAt: null,
        isExpired: false,
        lastSynced: null,
        syncStatus: "unauthenticated",
      };
    }
    const r = await fetch("/api/oura/status", {
      headers: {
        "accept": "application/json",
        "authorization": `Bearer ${token}`,
      },
    });
    if (!r.ok) throw new Error(`Oura status failed: ${r.status}`);
    const data = await r.json();
    return {
      connected: !!data?.connected,
      expiresAt: data?.expiresAt || null,
      isExpired: !!data?.isExpired,
      lastSynced: data?.lastSynced || null,
      syncStatus: data?.syncStatus || "never",
    };
  } catch (e) {
    console.error("getOuraTokenStatus error:", e);
    return {
      connected: false,
      expiresAt: null,
      isExpired: false,
      lastSynced: null,
      syncStatus: "error",
    };
  }
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
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return { error: "Not authenticated" };
    const qs = Number.isFinite(Number(days)) ? `?days=${encodeURIComponent(Math.round(Number(days)))}` : "";
    const r = await fetch(`/api/oura/sync${qs}`, {
      method: "POST",
      headers: {
        "accept": "application/json",
        "authorization": `Bearer ${token}`,
      },
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { error: data?.error || "Sync failed" };
    return data;
  } catch (e) {
    console.error("syncOuraNow error:", e);
    return { error: e.message };
  }
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
