// src/oura/dataLoading.js
// Oura Data Loading & Fetching
//
// Handles loading Oura data from Supabase.

import { supabase } from "../supabaseClient";
import { DEMO_OURA_DATA, isDemoMode } from "../demoData";

// Data_types the browser actually consumes. Raw `heartrate` payloads
// are time-series (~288 samples/day) whose ONLY client consumer was an
// array-length debug stat — an estimated 150–500 KB per 14-day fetch to
// display an integer. The server-side snapshot path excludes them for exactly
// this reason (wearable-prefetch.js); now the client does too. spo2 daily
// summaries stay: the source resolver reads them and they are tiny.
const CLIENT_DATA_TYPES = ["sleep", "readiness", "activity", "spo2"];

// Keyed single-flight: a cold boot had App, TodayTab, and (on tab
// open) RecoveryDashboard racing identical 14-day fetches. Concurrent callers
// with the SAME window now share one request; different windows (7/14/30)
// stay independent. No result caching — the next call after settle refetches.
const inFlightByDays = new Map();

/**
 * Load normalized Oura data for the last N days
 */
export async function loadOuraData(days = 14) {
  if (isDemoMode()) return DEMO_OURA_DATA;
  const existing = inFlightByDays.get(days);
  if (existing) return existing;
  const request = fetchOuraData(days).finally(() => { inFlightByDays.delete(days); });
  inFlightByDays.set(days, request);
  return request;
}

async function fetchOuraData(days) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return {};
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().split("T")[0];

    const { data, error } = await supabase
      .from("oura_data")
      .select("date, data_type, payload")
      .eq("user_id", userId)
      .in("data_type", CLIENT_DATA_TYPES)
      .gte("date", startDateStr)
      .order("date", { ascending: false });

    if (error) throw error;

    // Group by date and data_type
    const grouped = {};
    for (const row of data || []) {
      if (!grouped[row.date]) grouped[row.date] = {};
      grouped[row.date][row.data_type] = row.payload;
    }

    return grouped;
  } catch (e) {
    console.error("loadOuraData error:", e);
    return {};
  }
}

/**
 * Load Oura token status
 * DEPRECATED: Use getOuraTokenStatus() from auth module instead
 */
export async function loadOuraTokens() {
  console.warn("loadOuraTokens is deprecated for security. Use getOuraTokenStatus() instead.");
  return null;
}
