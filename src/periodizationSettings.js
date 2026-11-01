// src/periodizationSettings.js
// Pure helpers for periodization block settings + lifecycle.
// No React, no network, no writes — except the clearly-marked localStorage
// fallback wrappers at the bottom, which are guarded and side-effect-safe.
//
// SAFETY: nothing in this module touches weekly program data, workout entries,
// nutrition, auth, or tokens. The block planner is suggest-only; saving block
// settings here never rewrites training.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const num = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function isValidDate(value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T12:00:00`);
  return !Number.isNaN(d.getTime());
}

function addOneDay(dateStr) {
  if (!isValidDate(dateStr)) return "";
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── Presets / option sets ───────────────────────────────────────────────────

export const PERIODIZATION_GOAL_PRESETS = {
  hybrid_base: { label: "Hybrid base", goal: "Build aerobic base while maintaining strength" },
  strength_build: { label: "Strength build", goal: "Progress strength while holding conditioning" },
  race_prep: { label: "Race prep", goal: "Sharpen race pace and taper into a running race" },
  endurance: { label: "Endurance", goal: "Extend aerobic capacity and weekly mileage" },
  maintain: { label: "Maintain", goal: "Hold fitness while managing fatigue" },
  custom: { label: "Custom", goal: "" },
};

export const RUN_EMPHASIS_OPTIONS = ["reduce", "maintain", "build"];
export const STRENGTH_EMPHASIS_OPTIONS = ["deload", "maintain", "build"];

export const MIN_BLOCK_WEEKS = 4;
export const MAX_BLOCK_WEEKS = 8;
export const MAX_BLOCK_HISTORY = 6;

export const DEFAULT_PERIODIZATION_SETTINGS = {
  version: 1,
  name: "Current Block",
  goalPreset: "hybrid_base",
  goal: "Build capacity while managing fatigue",
  startDate: "",
  blockLengthWeeks: 4,
  deloadWeek: 4,
  runEmphasis: "maintain",
  strengthEmphasis: "maintain",
  savedAt: null,
};

// Keys that are safe to persist. Anything outside this list is dropped by
// buildPeriodizationStoragePatch so we never write workout/program/secret data.
const STORAGE_KEYS = [
  "version",
  "name",
  "goalPreset",
  "goal",
  "startDate",
  "blockLengthWeeks",
  "deloadWeek",
  "runEmphasis",
  "strengthEmphasis",
  "savedAt",
];

// ── Normalization ───────────────────────────────────────────────────────────

export function normalizePeriodizationSettings(input = {}, fallbackStartDate = "") {
  const src = input && typeof input === "object" ? input : {};

  const blockLengthWeeks = clamp(
    Math.round(num(src.blockLengthWeeks, DEFAULT_PERIODIZATION_SETTINGS.blockLengthWeeks)),
    MIN_BLOCK_WEEKS,
    MAX_BLOCK_WEEKS,
  );
  const deloadWeek = clamp(
    Math.round(num(src.deloadWeek, blockLengthWeeks)),
    1,
    blockLengthWeeks,
  );

  const goalPreset = PERIODIZATION_GOAL_PRESETS[src.goalPreset] ? src.goalPreset : DEFAULT_PERIODIZATION_SETTINGS.goalPreset;

  const rawName = typeof src.name === "string" ? src.name.trim() : "";
  const name = rawName || DEFAULT_PERIODIZATION_SETTINGS.name;

  let goal = typeof src.goal === "string" ? src.goal.trim() : "";
  if (!goal) goal = PERIODIZATION_GOAL_PRESETS[goalPreset]?.goal || DEFAULT_PERIODIZATION_SETTINGS.goal;

  const startDate = isValidDate(src.startDate)
    ? src.startDate
    : (isValidDate(fallbackStartDate) ? fallbackStartDate : "");

  const runEmphasis = RUN_EMPHASIS_OPTIONS.includes(src.runEmphasis) ? src.runEmphasis : DEFAULT_PERIODIZATION_SETTINGS.runEmphasis;
  const strengthEmphasis = STRENGTH_EMPHASIS_OPTIONS.includes(src.strengthEmphasis) ? src.strengthEmphasis : DEFAULT_PERIODIZATION_SETTINGS.strengthEmphasis;

  const savedAt = typeof src.savedAt === "string" && src.savedAt ? src.savedAt : null;

  return {
    version: 1,
    name,
    goalPreset,
    goal,
    startDate,
    blockLengthWeeks,
    deloadWeek,
    runEmphasis,
    strengthEmphasis,
    savedAt,
  };
}

// ── Preview copy ────────────────────────────────────────────────────────────

const SAFETY_LINE = "Planner guidance changes only; weekly program is not rewritten.";

const titleCase = (s) => (typeof s === "string" && s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Returns short, user-facing impact lines describing the diff from `previous`
// to `next`. The safety line is always appended last.
export function describePeriodizationPreview(previous = {}, next = {}) {
  const a = normalizePeriodizationSettings(previous);
  const b = normalizePeriodizationSettings(next);
  const lines = [];

  if (a.name !== b.name) lines.push(`Name changes from "${a.name}" to "${b.name}".`);
  if (a.goalPreset !== b.goalPreset) {
    const al = PERIODIZATION_GOAL_PRESETS[a.goalPreset]?.label || a.goalPreset;
    const bl = PERIODIZATION_GOAL_PRESETS[b.goalPreset]?.label || b.goalPreset;
    lines.push(`Goal preset changes from ${al} to ${bl}.`);
  }
  if (a.goal !== b.goal) lines.push("Goal description updated.");
  if (a.blockLengthWeeks !== b.blockLengthWeeks) lines.push(`Length changes from ${a.blockLengthWeeks} to ${b.blockLengthWeeks} weeks.`);
  if (a.deloadWeek !== b.deloadWeek) lines.push(`Deload moves from Week ${a.deloadWeek} to Week ${b.deloadWeek}.`);
  if (a.startDate !== b.startDate) {
    lines.push(`Start date changes from ${a.startDate || "unset"} to ${b.startDate || "unset"}.`);
  }
  if (a.runEmphasis !== b.runEmphasis) lines.push(`Run emphasis changes from ${titleCase(a.runEmphasis)} to ${titleCase(b.runEmphasis)}.`);
  if (a.strengthEmphasis !== b.strengthEmphasis) lines.push(`Strength emphasis changes from ${titleCase(a.strengthEmphasis)} to ${titleCase(b.strengthEmphasis)}.`);

  if (lines.length === 0) lines.push("No changes yet.");
  lines.push(SAFETY_LINE);
  return lines;
}

// True when two settings objects differ in any persisted field except savedAt.
export function periodizationSettingsChanged(previous = {}, next = {}) {
  const a = normalizePeriodizationSettings(previous);
  const b = normalizePeriodizationSettings(next);
  return STORAGE_KEYS.some((key) => key !== "version" && key !== "savedAt" && a[key] !== b[key]);
}

// ── Safe storage patch ──────────────────────────────────────────────────────

// Returns a JSON-safe object containing ONLY the whitelisted settings keys.
// Any unrelated fields (program, workouts, secrets, functions) are dropped.
export function buildPeriodizationStoragePatch(settings = {}) {
  const normalized = normalizePeriodizationSettings(settings, settings?.startDate || "");
  const patch = {};
  for (const key of STORAGE_KEYS) patch[key] = normalized[key];
  return patch;
}

// ── Lifecycle: next block + history ─────────────────────────────────────────

// Pre-fills settings for the block that follows `currentPlan`:
// starts the day after the current block ends, keeps the same length,
// places deload on the final week, and carries forward emphasis/goal.
export function buildNextBlockSettings(currentPlan = {}) {
  const length = clamp(
    Math.round(num(currentPlan.blockLengthWeeks, DEFAULT_PERIODIZATION_SETTINGS.blockLengthWeeks)),
    MIN_BLOCK_WEEKS,
    MAX_BLOCK_WEEKS,
  );
  const startDate = addOneDay(currentPlan.endDate);
  return normalizePeriodizationSettings({
    name: "Next Block",
    goalPreset: currentPlan.goalPreset || DEFAULT_PERIODIZATION_SETTINGS.goalPreset,
    goal: currentPlan.goal || "",
    startDate,
    blockLengthWeeks: length,
    deloadWeek: length,
    runEmphasis: currentPlan.emphasis?.run,
    strengthEmphasis: currentPlan.emphasis?.strength,
  }, startDate);
}

// Compact, JSON-safe snapshot of a completed/closing block. Contains only block
// metadata — never workout, program, or nutrition data.
export function buildBlockSnapshot(plan = {}, completedAt = null) {
  const name = typeof plan.name === "string" && plan.name.trim() ? plan.name.trim() : DEFAULT_PERIODIZATION_SETTINGS.name;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "block";
  return {
    id: `${plan.startDate || ""}-${slug}`,
    name,
    startDate: plan.startDate || "",
    endDate: plan.endDate || "",
    blockLengthWeeks: clamp(Math.round(num(plan.blockLengthWeeks, DEFAULT_PERIODIZATION_SETTINGS.blockLengthWeeks)), MIN_BLOCK_WEEKS, MAX_BLOCK_WEEKS),
    deloadWeek: Math.max(1, Math.round(num(plan.deloadWeek, DEFAULT_PERIODIZATION_SETTINGS.deloadWeek))),
    completedAt: typeof completedAt === "string" && completedAt ? completedAt : null,
  };
}

// Prepends a snapshot to history, dedupes by id, and caps the list length.
export function appendBlockHistory(history = [], snapshot, limit = MAX_BLOCK_HISTORY) {
  if (!snapshot || !snapshot.id) return Array.isArray(history) ? history.slice(0, limit) : [];
  const list = Array.isArray(history) ? history : [];
  return [snapshot, ...list.filter((h) => h && h.id !== snapshot.id)].slice(0, limit);
}

// ── localStorage fallback ───────────────────────────────────────────────────
// PERSISTENCE NOTE: The app's server settings (profiles.settings JSONB) are
// loaded through a whitelist in data.js loadSettings() that intentionally drops
// unknown keys, so a `settings.periodization` field would not survive reload
// without broader plumbing changes. To keep this feature localized and to honor
// the "no Supabase schema changes" constraint, block settings persist to a
// namespaced localStorage key. The data is small, JSON-safe, and contains no
// secrets. Migrating to server-side settings later only requires swapping these
// read/write wrappers; the shapes already match buildPeriodizationStoragePatch.

export const PERIODIZATION_STORAGE_KEY = "athleteApp.periodization.v1";
export const PERIODIZATION_HISTORY_KEY = "athleteApp.periodizationHistory.v1";

function safeLocalStorage() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readStoredPeriodization() {
  const ls = safeLocalStorage();
  if (!ls) return null;
  try {
    const raw = ls.getItem(PERIODIZATION_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeStoredPeriodization(patch) {
  const ls = safeLocalStorage();
  if (!ls) return;
  try {
    ls.setItem(PERIODIZATION_STORAGE_KEY, JSON.stringify(buildPeriodizationStoragePatch(patch)));
  } catch {
    /* storage full or unavailable — non-fatal */
  }
}

export function readStoredPeriodizationHistory() {
  const ls = safeLocalStorage();
  if (!ls) return [];
  try {
    const raw = ls.getItem(PERIODIZATION_HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeStoredPeriodizationHistory(history) {
  const ls = safeLocalStorage();
  if (!ls) return;
  try {
    const list = Array.isArray(history) ? history.slice(0, MAX_BLOCK_HISTORY) : [];
    ls.setItem(PERIODIZATION_HISTORY_KEY, JSON.stringify(list));
  } catch {
    /* non-fatal */
  }
}

export default {
  DEFAULT_PERIODIZATION_SETTINGS,
  PERIODIZATION_GOAL_PRESETS,
  RUN_EMPHASIS_OPTIONS,
  STRENGTH_EMPHASIS_OPTIONS,
  normalizePeriodizationSettings,
  describePeriodizationPreview,
  periodizationSettingsChanged,
  buildPeriodizationStoragePatch,
  buildNextBlockSettings,
  buildBlockSnapshot,
  appendBlockHistory,
  readStoredPeriodization,
  writeStoredPeriodization,
  readStoredPeriodizationHistory,
  writeStoredPeriodizationHistory,
};
