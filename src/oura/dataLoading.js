// src/oura/dataLoading.js
// Oura Data Loading & Fetching
//
// Handles loading Oura data from Supabase.

import { supabase } from "../supabaseClient";
import { createWearableDataReads } from "../integrations/wearableDataReads";
import { DEMO_OURA_DATA } from "../demoData";

// Data_types the browser actually consumes. Raw `heartrate` payloads
// are time-series (~288 samples/day) whose ONLY client consumer was an
// array-length debug stat — an estimated 150–500 KB per 14-day fetch to
// display an integer. The server-side snapshot path excludes them for exactly
// this reason (wearable-prefetch.js); now the client does too. spo2 daily
// summaries stay: the source resolver reads them and they are tiny.
const CLIENT_DATA_TYPES = ["sleep", "readiness", "activity", "spo2"];

const reads = createWearableDataReads(fetchOuraData, () => DEMO_OURA_DATA);
export const loadOuraData = reads.load;
export const invalidateOuraData = reads.invalidate;

async function fetchOuraData(days, userId) {
  try {
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
