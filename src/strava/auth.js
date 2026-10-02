import { supabase } from "../supabaseClient";
import { invalidateStravaConnected } from "./dataLoading";
import { isDemoMode } from "../demoData";

async function getAccessToken() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || null;
}

async function authedJson(path, options = {}) {
  const token = await getAccessToken();
  if (!token) return { error: "Not authenticated" };
  const r = await fetch(path, {
    ...options,
    headers: { "accept": "application/json", "authorization": `Bearer ${token}`, ...(options.headers || {}) },
  });
  const data = await r.json().catch(() => ({}));
  return r.ok ? data : { error: data?.error || `Request failed: ${r.status}` };
}

export async function getStravaAuthUrl() {
  if (isDemoMode()) return null;
  const data = await authedJson("/api/strava/auth");
  return typeof data?.url === "string" ? data.url : null;
}

export async function getStravaTokenStatus() {
  if (isDemoMode()) return { connected: false, syncStatus: "demo" };
  const data = await authedJson("/api/strava/status");
  return data?.error ? { connected: false, syncStatus: "error" } : data;
}

export async function syncStravaNow(days = 30) {
  if (isDemoMode()) return { ok: true, synced: 0, demo: true };
  const qs = Number.isFinite(Number(days)) ? `?days=${encodeURIComponent(Math.round(Number(days)))}` : "";
  return await authedJson(`/api/strava/sync${qs}`, { method: "POST" });
}

export async function disconnectStrava() {
  invalidateStravaConnected();
  if (isDemoMode()) return { ok: true };
  return await authedJson("/api/strava/disconnect", { method: "POST" });
}

export async function getStravaSyncCounts() {
  if (isDemoMode()) return { activities: 0, latestDate: null, lastSynced: null };
  const data = await authedJson("/api/strava/counts");
  return data?.error ? { activities: 0, latestDate: null, lastSynced: null } : data;
}

export async function getStravaSyncEvents(limit = 20) {
  if (isDemoMode()) return { events: [] };
  const qs = Number.isFinite(Number(limit)) ? `?limit=${encodeURIComponent(Math.min(50, Math.max(1, Math.round(Number(limit)))))}` : "";
  const data = await authedJson(`/api/strava/events${qs}`);
  return { events: Array.isArray(data?.events) ? data.events : [], error: data?.error };
}
