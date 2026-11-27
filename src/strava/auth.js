import { supabase } from "../supabaseClient";
import { createCloudProvider } from "../integrations/cloudProvider";
import { isDemoMode } from "../demoData";

export const stravaCloud = createCloudProvider({
  defaultDays: 30,
  status: "/api/strava/status",
  sync: "/api/strava/sync",
  disconnect: "/api/strava/disconnect",
});

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
  return stravaCloud.status();
}

export async function syncStravaNow(days = 30) {
  if (isDemoMode()) return { ok: true, synced: 0, demo: true };
  return stravaCloud.syncNow(days);
}

export async function disconnectStrava() {
  if (isDemoMode()) return { ok: true };
  return stravaCloud.disconnect();
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
