// src/whoop/dataLoading.js
// Whoop Data Loading
//
// Loads normalized Whoop records from Supabase. Reads ONLY the whoop_data table
// (owner-readable via RLS). It never reads whoop_tokens — tokens are server-held.

import { supabase } from "../supabaseClient";
import { getDemoWhoopData } from "../demoData";
import { isDemoMode } from "../demoData";

/**
 * Load Whoop data for the last N days, grouped by date then data_type.
 * Shape: { "2026-07-01": { recovery: {...}, sleep: {...}, workout: [{...}] }, ... }
 * Workouts (multiple per day) are collected into an array.
 *
 * Deterministic single-per-day selection. The old grouping was
 * last-write-wins over rows ordered by date only — within a date, Postgres row
 * order is UNSPECIFIED, so on a day carrying both a nap and the main sleep
 * (nap=true + nap=false rows share a date key: naps key on start date, main
 * sleep on wake date), whether `day.sleep` held the night or the nap depended
 * on arbitrary storage order. On the reporting user's own export, 2026-07-11
 * resolved to the NAP (sleep performance 12%) in one order and the main sleep
 * (83%) in the other — a coin-flip that fed the sleep fallback rung, the
 * source resolver's conflict detector (a false "major" 473-minute sleep
 * disagreement → "Mixed signal day"), and the Whoop display cards. Selection
 * is now explicit: SCORED beats pending, main sleep beats nap, longer in-bed
 * beats shorter, latest update wins ties. Every sleep row is retained in
 * `day.sleepAll` (main first) so nap-aware surfaces can still read them.
 */
const inFlightByDays = new Map();

export async function loadWhoopData(days = 14) {
  const existing = inFlightByDays.get(days);
  if (existing) return existing;
  const request = fetchWhoopData(days).finally(() => { inFlightByDays.delete(days); });
  inFlightByDays.set(days, request);
  return request;
}

// Compare two Whoop records for single-per-day selection; positive when `a`
// outranks `b`. Field-by-field priority rather than a collapsed numeric rank:
// a single float lost the updated_at tie-break to precision (a few hours of
// timestamp difference sits below Number epsilon once summed onto a 1e12-scale
// score-state term).
function compareWhoopRecords(a, b, dataType) {
  const aObj = a && typeof a === "object" ? a : null;
  const bObj = b && typeof b === "object" ? b : null;
  if (!aObj || !bObj) return (aObj ? 1 : 0) - (bObj ? 1 : 0);
  const scored = (r) => (r.score_state === "SCORED" ? 1 : 0);
  if (scored(aObj) !== scored(bObj)) return scored(aObj) - scored(bObj);
  if (dataType === "sleep") {
    const main = (r) => (r.nap === false ? 1 : 0);
    if (main(aObj) !== main(bObj)) return main(aObj) - main(bObj);
    const inBed = (r) => Number(r.score?.stage_summary?.total_in_bed_time_milli) || 0;
    if (inBed(aObj) !== inBed(bObj)) return inBed(aObj) - inBed(bObj);
  }
  const updated = (r) => Date.parse(r.updated_at || r.created_at || "") || 0;
  return updated(aObj) - updated(bObj);
}

// Pure grouping core, exported for tests. Row order in must NOT matter for the
// resulting day map (beyond workout array order).
//
// Cross-date dedupe by (data_type, external_id) runs FIRST. The server
// keys records to their LOCAL calendar date (timezone_offset-aware); rows
// synced before it did sit at the UTC-derived date. A re-sync after the
// fix upserts the same external_id under the corrected date — the old row
// remains at the wrong one (the upsert conflict key includes date), and an
// evening workout would double-count across two days. Keeping only the
// freshest copy of each record (latest updated_at, then the later-dated row)
// makes one manual re-sync self-healing and guards against any future
// date-keying churn. Rows without an external_id keep their date in the key so
// unrelated records can never merge.
function dedupeAcrossDates(rows) {
  const byId = new Map();
  for (const row of rows || []) {
    if (!row || !row.date || !row.data_type) continue;
    const id = row.external_id === undefined || row.external_id === null ? "" : String(row.external_id);
    const key = id === "" ? `${row.data_type}|@${row.date}` : `${row.data_type}|${id}`;
    const prev = byId.get(key);
    if (!prev) { byId.set(key, row); continue; }
    const ts = (r) => Date.parse(r?.payload?.updated_at || r?.payload?.created_at || "") || 0;
    if (ts(row) > ts(prev) || (ts(row) === ts(prev) && row.date > prev.date)) byId.set(key, row);
  }
  return [...byId.values()];
}

export function groupWhoopRows(rows) {
  const grouped = {};
  for (const row of dedupeAcrossDates(rows)) {
    if (!grouped[row.date]) grouped[row.date] = {};
    const day = grouped[row.date];
    if (row.data_type === "workout") {
      if (!Array.isArray(day.workout)) day.workout = [];
      day.workout.push(row.payload);
      continue;
    }
    if (row.data_type === "sleep") {
      if (!Array.isArray(day.sleepAll)) day.sleepAll = [];
      day.sleepAll.push(row.payload);
      continue;
    }
    // Single-per-day types (recovery, cycle): keep the higher-ranked record.
    const existing = day[row.data_type];
    if (!existing || compareWhoopRecords(row.payload, existing, row.data_type) > 0) {
      day[row.data_type] = row.payload;
    }
  }
  // Resolve the day's sleep from the collected candidates.
  for (const date of Object.keys(grouped)) {
    const day = grouped[date];
    if (Array.isArray(day.sleepAll) && day.sleepAll.length) {
      day.sleepAll.sort((a, b) => compareWhoopRecords(b, a, "sleep"));
      day.sleep = day.sleepAll[0];
    }
  }
  return grouped;
}

async function fetchWhoopData(days) {
  if (isDemoMode()) return getDemoWhoopData();
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return {};

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().split("T")[0];

    const { data, error } = await supabase
      .from("whoop_data")
      .select("date, data_type, external_id, payload")
      .eq("user_id", userId)
      .gte("date", startDateStr)
      .order("date", { ascending: false });

    if (error) throw error;
    return groupWhoopRows(data);
  } catch (e) {
    console.error("loadWhoopData error:", e);
    return {};
  }
}
