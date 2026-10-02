// src/whoop/normalization.js
// ─────────────────────────────────────────────────────────────────────────────
// Whoop Data Normalization (V2.9 Whoop Foundation)
//
// Defensive, pure helpers that turn raw Whoop v2 records into small internal
// summaries for DISPLAY ONLY. This sprint deliberately does NOT blend Whoop into
// the recovery algorithm, Today Coach, or Progress trends — these helpers exist
// so the UI can show a latest summary and confirm data landed.
//
// Whoop v2 record shapes vary and can be partially scored, so every extractor
// tolerates missing fields and returns null rather than throwing.
// ─────────────────────────────────────────────────────────────────────────────

function finiteNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function milliToMin(v) {
  const n = finiteNum(v);
  return n === null ? null : n / 60000;
}

// A record may be stored as the raw object or wrapped; unwrap to the object.
function asRecord(rec) {
  if (!rec || typeof rec !== "object") return null;
  if (Array.isArray(rec)) return rec[0] || null;
  return rec;
}

/**
 * Normalize a Whoop recovery record → { date, recoveryScore, hrvRmssd, rhr, spo2, skinTempC } | null
 */
export function normalizeRecovery(rec) {
  const r = asRecord(rec);
  if (!r) return null;
  const score = r.score || {};
  return {
    date: dateOf(r),
    recoveryScore: finiteNum(score.recovery_score),
    hrvRmssd: finiteNum(score.hrv_rmssd_milli),
    rhr: finiteNum(score.resting_heart_rate),
    spo2: finiteNum(score.spo2_percentage),
    skinTempC: finiteNum(score.skin_temp_celsius),
    calibrating: score.user_calibrating === true,
  };
}

/**
 * Normalize a Whoop sleep record → nightly summary | null
 */
export function normalizeSleep(rec) {
  const r = asRecord(rec);
  if (!r) return null;
  const score = r.score || {};
  const stages = score.stage_summary || {};
  const inBed = milliToMin(stages.total_in_bed_time_milli);
  const awake = milliToMin(stages.total_awake_time_milli);
  const asleep = inBed !== null && awake !== null ? Math.max(0, inBed - awake) : null;
  return {
    date: dateOf(r),
    inBedMin: inBed,
    asleepMin: asleep,
    lightMin: milliToMin(stages.total_light_sleep_time_milli),
    deepMin: milliToMin(stages.total_slow_wave_sleep_time_milli),
    remMin: milliToMin(stages.total_rem_sleep_time_milli),
    awakeMin: awake,
    efficiencyPct: finiteNum(score.sleep_efficiency_percentage),
    performancePct: finiteNum(score.sleep_performance_percentage),
    respiratoryRate: finiteNum(score.respiratory_rate),
  };
}

/**
 * Normalize a Whoop cycle (day strain) record → { date, strain, avgHr, maxHr, kilojoule } | null
 */
export function normalizeCycle(rec) {
  const r = asRecord(rec);
  if (!r) return null;
  const score = r.score || {};
  return {
    date: dateOf(r),
    strain: finiteNum(score.strain),
    avgHr: finiteNum(score.average_heart_rate),
    maxHr: finiteNum(score.max_heart_rate),
    kilojoule: finiteNum(score.kilojoule),
  };
}

/**
 * Normalize a Whoop workout record → { date, sportId, strain, avgHr, maxHr, distanceM, kilojoule } | null
 */
export function normalizeWorkout(rec) {
  const r = asRecord(rec);
  if (!r) return null;
  const score = r.score || {};
  return {
    date: dateOf(r),
    id: r.id != null ? String(r.id) : null,
    sportId: r.sport_id ?? r.sportId ?? null,
    // V16.7 · Whoop v2 names the sport directly; surfaces can say
    // "weightlifting, 45 min" instead of a bare strain number.
    sportName: typeof r.sport_name === "string" && r.sport_name ? r.sport_name : null,
    strain: finiteNum(score.strain),
    avgHr: finiteNum(score.average_heart_rate),
    maxHr: finiteNum(score.max_heart_rate),
    distanceM: finiteNum(score.distance_meter),
    kilojoule: finiteNum(score.kilojoule),
  };
}

// Best-effort date key for a record (YYYY-MM-DD). Mirrors the server's pick but
// stays defensive for display use.
function dateOf(r) {
  // V15.6 (audit F5) · mirror of the server rule: main sleep keys on wake date.
  if (r && r.nap === false && r.end) {
    const m = String(r.end).match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  const candidates = [r.start, r.end, r.created_at, r.updated_at, r.date];
  for (const c of candidates) {
    if (!c) continue;
    const m = String(c).match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    const d = new Date(c);
    if (!Number.isNaN(d.getTime())) {
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    }
  }
  return null;
}

/** Newest date key present in a grouped whoop_data map. */
export function latestWhoopDate(grouped) {
  return Object.keys(grouped || {}).sort().reverse()[0] || null;
}

/**
 * Build a compact, DISPLAY-ONLY summary of the most recent Whoop day. Does not
 * feed the recovery algorithm — purely for the Settings/Integrations surface.
 * Returns { date, recovery, sleep, cycle, workouts } with normalized sub-objects.
 */
export function buildWhoopSummary(grouped) {
  const date = latestWhoopDate(grouped);
  if (!date) return null;
  const day = grouped[date] || {};
  const workouts = Array.isArray(day.workout) ? day.workout : day.workout ? [day.workout] : [];
  return {
    date,
    recovery: normalizeRecovery(day.recovery),
    sleep: normalizeSleep(day.sleep),
    cycle: normalizeCycle(day.cycle),
    workouts: workouts.map(normalizeWorkout).filter(Boolean),
  };
}
