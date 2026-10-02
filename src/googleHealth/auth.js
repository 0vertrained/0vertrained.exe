import { supabase } from "../supabaseClient";
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

export async function getGoogleHealthAuthUrl() {
  if (isDemoMode()) return null;
  const data = await authedJson("/api/google-health/auth");
  return typeof data?.url === "string" ? data.url : null;
}

export async function getGoogleHealthTokenStatus() {
  if (isDemoMode()) return { connected: false, syncStatus: "demo" };
  const data = await authedJson("/api/google-health/status");
  return data?.error ? { connected: false, syncStatus: "error" } : data;
}

export async function syncGoogleHealthNow(days = 30) {
  if (isDemoMode()) return { ok: true, synced: 0, demo: true };
  const qs = Number.isFinite(Number(days)) ? `?days=${encodeURIComponent(Math.round(Number(days)))}` : "";
  return await authedJson(`/api/google-health/sync${qs}`, { method: "POST" });
}

export async function disconnectGoogleHealth() {
  if (isDemoMode()) return { ok: true };
  return await authedJson("/api/google-health/disconnect", { method: "POST" });
}

export async function getGoogleHealthSyncCounts() {
  if (isDemoMode()) return { daily: 0, activities: 0, latestDate: null, lastSynced: null };
  const data = await authedJson("/api/google-health/counts");
  return data?.error ? { daily: 0, activities: 0, latestDate: null, lastSynced: null } : data;
}

export async function getGoogleHealthSyncEvents(limit = 20) {
  if (isDemoMode()) return { events: [] };
  const qs = Number.isFinite(Number(limit)) ? `?limit=${encodeURIComponent(Math.min(50, Math.max(1, Math.round(Number(limit)))))}` : "";
  const data = await authedJson(`/api/google-health/events${qs}`);
  return { events: Array.isArray(data?.events) ? data.events : [], error: data?.error };
}
