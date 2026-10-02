// src/strava/dataLoading.js
// ─────────────────────────────────────────────────────────────────────────────
// Strava client data loading (V13.3).
//
// Reads the current athlete's normalized rows from the provider-standard
// `activities` table (RLS policy `activities_select_own`) and maps them into
// the light shape the app consumes. Mirrors src/oura/dataLoading.js /
// src/whoop/dataLoading.js: one Supabase query, no Strava API calls (rate
// limits live server-side), demo mode returns empty, errors degrade to [].
//
// Strava data is strain-side only and excluded from AI Coach by policy
// (providerRegistry: STRAVA_API_TERMS). Nothing loaded here may be passed to
// coach payload builders — see src/__tests__/stravaCoachExclusion.test.js.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from "../supabaseClient";
import { isDemoMode, getDemoStravaActivities } from "../demoData";
import { memoizeAsync } from "../asyncMemo";
import { getStravaTokenStatus } from "./auth";

const RUN_SPORTS = new Set(["run", "trailrun", "virtualrun", "walk", "hike", "snowshoe"]);
const RIDE_SPORTS = new Set(["ride", "virtualride", "mountainbikeride", "gravelride", "handcycle", "velomobile"]);

// Local-date key for a timestamp — activities bucket to the athlete's day,
// matching wearableWorkoutLoad's isoDate convention.
export function localDateKey(ts) {
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function kindFor(sportType) {
  const s = String(sportType || "").toLowerCase().replace(/[\s_-]/g, "");
  if (RUN_SPORTS.has(s)) return "run";
  if (RIDE_SPORTS.has(s)) return "ride";
  return "other";
}

function paceSecPerMile(miles, minutes) {
  if (!(miles > 0) || !(minutes > 0)) return null;
  return Math.round((minutes * 60) / miles);
}

// Map one `activities` table row to the app shape. Pure — unit tested.
export function mapActivityRow(row) {
  if (!row) return null;
  const date = localDateKey(row.start_time);
  if (!date) return null;
  const meters = Number(row.distance_m) || 0;
  const miles = meters > 0 ? Math.round((meters / 1609.344) * 100) / 100 : 0;
  const minutes = Number(row.duration_sec) > 0 ? Math.round((Number(row.duration_sec) / 60) * 10) / 10 : 0;
  const elevationFt = Number(row.elevation_m) > 0 ? Math.round(Number(row.elevation_m) * 3.28084) : 0;
  return {
    id: row.id || null,
    stravaId: row.provider_activity_id ? String(row.provider_activity_id) : null,
    date,
    startTime: row.start_time || null,
    sport: row.sport_type || "Workout",
    kind: kindFor(row.sport_type),
    title: row.title || row.sport_type || "Activity",
    miles,
    minutes,
    paceSecPerMile: paceSecPerMile(miles, minutes),
    elevationFt,
    avgHr: Number(row.avg_hr) || null,
  };
}

export function groupStravaByDate(activities) {
  const grouped = {};
  for (const a of activities || []) {
    if (!a || !a.date) continue;
    (grouped[a.date] = grouped[a.date] || []).push(a);
  }
  return grouped;
}


function entryHasManualCardio(entry) {
  const cardio = entry?.workout?.cardio || {};
  if ((parseFloat(cardio.miles) || 0) > 0 || String(cardio.time || "").trim()) return true;
  return Object.values(entry?.workout?.cardioSessions || {}).some(
    (session) => (parseFloat(session?.miles) || 0) > 0 || String(session?.time || "").trim(),
  );
}

function previousDateKey(dateKey) {
  const d = new Date(`${dateKey}T12:00:00`);
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Choose one unlogged Strava activity group for the displayed ledger day.
 * Today falls back to the newest group in the preceding 48 hours, while past
 * days remain pinned to the day the athlete explicitly opened.
 */
export function selectStravaLedgerSuggestion({ stravaByDate, entries, displayedDate, todayKey, now = Date.now() }) {
  const grouped = stravaByDate || {};
  const direct = grouped[displayedDate] || [];
  if (direct.length && !entryHasManualCardio(entries?.[displayedDate])) {
    return {
      dateKey: displayedDate,
      activities: direct,
      dayLabel: displayedDate === todayKey ? "Today" : displayedDate === previousDateKey(todayKey) ? "Yesterday" : displayedDate,
    };
  }
  if (displayedDate !== todayKey) return null;

  const cutoff = now - 48 * 60 * 60 * 1000;
  const candidates = Object.entries(grouped)
    .filter(([dateKey, activities]) => dateKey !== todayKey && Array.isArray(activities) && activities.length && !entryHasManualCardio(entries?.[dateKey]))
    .map(([dateKey, activities]) => ({
      dateKey,
      activities,
      latest: Math.max(...activities.map((activity) => Date.parse(activity?.startTime || `${dateKey}T12:00:00`)).filter(Number.isFinite)),
    }))
    .filter((candidate) => Number.isFinite(candidate.latest) && candidate.latest >= cutoff && candidate.latest <= now)
    .sort((a, b) => b.latest - a.latest);

  const chosen = candidates[0];
  if (!chosen) return null;
  return {
    dateKey: chosen.dateKey,
    activities: chosen.activities,
    dayLabel: chosen.dateKey === previousDateKey(todayKey) ? "Yesterday" : chosen.dateKey,
  };
}

/**
 * Load normalized Strava activities for the last N days, newest first.
 * Returns [] on any failure so callers never branch on null.
 */
export async function loadStravaActivities(days = 28) {
  if (isDemoMode()) return getDemoStravaActivities();
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return [];
    const start = new Date();
    start.setDate(start.getDate() - days);

    const { data, error } = await supabase
      .from("activities")
      .select("id, provider_activity_id, start_time, sport_type, title, duration_sec, distance_m, elevation_m, avg_hr")
      .eq("user_id", userId)
      .eq("source_provider", "strava")
      .gte("start_time", start.toISOString())
      .order("start_time", { ascending: false });

    if (error) throw error;
    return (data || []).map(mapActivityRow).filter(Boolean);
  } catch (e) {
    console.error("loadStravaActivities error:", e);
    return [];
  }
}

/** Server-verified connection check, mirroring isOuraConnected/isWhoopConnected. */
// V14.2 · Memoized (60s TTL + single-flight) — see isOuraConnected rationale.
const isStravaConnectedMemo = memoizeAsync(async () => {
  try {
    const status = await getStravaTokenStatus();
    return Boolean(status?.connected);
  } catch {
    return false;
  }
}, 60_000);
export async function isStravaConnected() {
  if (isDemoMode()) return true; // V15.5 · demo shows the full wearable story
  return isStravaConnectedMemo();
}
export function invalidateStravaConnected() { isStravaConnectedMemo.invalidate(); }

/** Attribution deep link — required by the Strava API Agreement wherever an activity renders. */
export function stravaActivityUrl(activity) {
  const id = activity?.stravaId;
  return id ? `https://www.strava.com/activities/${encodeURIComponent(id)}` : "https://www.strava.com";
}
