// src/raceBlock.js
// V7 · Race block — point the training block at an actual race. Stores a race
// plan (name, date, type, station benchmarks) in a namespaced localStorage
// key, following the periodizationSettings.js precedent for block-level
// settings that live client-side. Display + countdown + taper flag only —
// it does not modify the program, the decision engine, or any load math.

const STORAGE_KEY = "ovt_race_plan_v1";

// PERSISTENCE NOTE: same convention as periodizationSettings — localStorage,
// versioned key, normalize-on-read so partial/legacy objects never crash the UI.

export const HYROX_STATIONS = [
  { key: "ski_erg",      label: "SkiErg 1000m",        unit: "mm:ss" },
  { key: "sled_push",    label: "Sled push 50m",       unit: "mm:ss" },
  { key: "sled_pull",    label: "Sled pull 50m",       unit: "mm:ss" },
  { key: "burpee_bj",    label: "Burpee broad jumps",  unit: "mm:ss" },
  { key: "row",          label: "Row 1000m",           unit: "mm:ss" },
  { key: "farmers",      label: "Farmers carry 200m",  unit: "mm:ss" },
  { key: "lunges",       label: "Sandbag lunges 100m", unit: "mm:ss" },
  { key: "wall_balls",   label: "Wall balls 75/100",   unit: "mm:ss" },
  { key: "run_1k",       label: "1k run pace",         unit: "mm:ss" },
];

export function normalizeRacePlan(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const benchmarks = r.benchmarks && typeof r.benchmarks === "object" ? r.benchmarks : {};
  return {
    version: 1,
    name: typeof r.name === "string" ? r.name : "",
    date: typeof r.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : "",
    type: r.type === "hyrox" || r.type === "run" ? r.type : "hyrox",
    benchmarks: Object.fromEntries(
      HYROX_STATIONS.map(s => [s.key, typeof benchmarks[s.key] === "string" ? benchmarks[s.key] : ""])
    ),
  };
}

export function readRacePlan() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeRacePlan(JSON.parse(raw));
  } catch { return null; }
}

export function writeRacePlan(plan) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeRacePlan(plan)));
    return true;
  } catch { return false; }
}

export function clearRacePlan() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

// ─── Countdown + taper ────────────────────────────────────────────────────────
// daysOut < 0 means the race has passed. Taper window: final 10 days (a common
// conservative default for a ~70-90 min effort like Hyrox) — presented as
// guidance copy, never enforced on the program.
export const TAPER_DAYS = 10;

export function buildRaceCountdown(plan, todayKey) {
  if (!plan?.date || !todayKey) return null;
  const race = new Date(plan.date + "T12:00:00");
  const today = new Date(todayKey + "T12:00:00");
  const daysOut = Math.round((race - today) / 86400000);
  const weeksOut = Math.floor(daysOut / 7);

  if (daysOut < 0) {
    return { phase: "past", daysOut, weeksOut, headline: `${plan.name || "Race"} was ${Math.abs(daysOut)}d ago`, note: "Log a debrief in notes, set the next target, and start the next block." };
  }
  if (daysOut === 0) {
    return { phase: "race_day", daysOut, weeksOut, headline: "Race day", note: "Nothing left to gain in training. Execute the plan; pace the first half honest." };
  }
  if (daysOut <= TAPER_DAYS) {
    return { phase: "taper", daysOut, weeksOut, headline: `${daysOut}d out — taper window`, note: "Cut volume, hold a little intensity, protect sleep. Deload beats one more quality session from here." };
  }
  return {
    phase: "build",
    daysOut,
    weeksOut,
    headline: `${weeksOut}w ${daysOut % 7}d out`,
    note: weeksOut >= 8
      ? "Base window — build engine volume and station strength."
      : "Sharpening window — race-pace intervals and station transitions earn the most now.",
  };
}
