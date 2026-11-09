// src/coachMemory.js
// Coach Memory — pure, local coaching-preference + trend helpers.
//
// Gives the coach a small, privacy-safe "memory": user-approved coaching
// PREFERENCES (tone, focus, intensity, rest bias, a short self-authored note)
// plus an AGGREGATE trend summary derived from existing entries. It produces
// concise, suggest-only memory lines for the coach context builder and a
// privacy-safe export string.
//
// Hard rules:
//   - No raw chat logs, no raw notes, no biometric payloads are ever stored or
//     emitted. Only whitelisted preference enums, a short user-authored note,
//     and derived numeric aggregates.
//   - Pure + null-safe. Callers inject `now`. Nothing here fetches or persists;
//     persistence is the app's job (settings JSONB) and stays opt-in.
//   - Guidance is SUGGEST-ONLY. Nothing here edits programs or scores.

// Allowed preference values. Anything off-list normalizes back to the default —
// so a corrupted or adversarial settings blob can never inject arbitrary text
// into the coach context through the enum fields.
export const COACH_PREFERENCE_OPTIONS = {
  tone: ["balanced", "direct", "encouraging"],
  focus: ["hybrid", "strength", "endurance", "physique"],
  intensity: ["conservative", "moderate", "aggressive"],
  restBias: ["balanced", "more-rest", "more-volume"],
};

export const DEFAULT_COACH_PREFERENCES = {
  enabled: false,
  tone: "balanced",
  focus: "hybrid",
  intensity: "moderate",
  restBias: "balanced",
  note: "",
};

// Short self-authored note cap. Kept small on purpose — it's a preference, not a
// journal, and a hard cap keeps it out of "raw log" territory.
export const COACH_NOTE_MAX = 240;

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function nonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

// Normalize an arbitrary stored/updated preferences blob into a safe object.
// Unknown enum values snap to defaults; the note is trimmed, length-capped, and
// stripped of newlines so it can't smuggle structure into the coach prompt.
export function normalizeCoachPreferences(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const note = nonEmptyString(r.note)
    ? r.note.replace(/\s+/g, " ").trim().slice(0, COACH_NOTE_MAX)
    : "";
  return {
    enabled: r.enabled === true || r.enabled === "true",
    tone: pick(r.tone, COACH_PREFERENCE_OPTIONS.tone, DEFAULT_COACH_PREFERENCES.tone),
    focus: pick(r.focus, COACH_PREFERENCE_OPTIONS.focus, DEFAULT_COACH_PREFERENCES.focus),
    intensity: pick(r.intensity, COACH_PREFERENCE_OPTIONS.intensity, DEFAULT_COACH_PREFERENCES.intensity),
    restBias: pick(r.restBias, COACH_PREFERENCE_OPTIONS.restBias, DEFAULT_COACH_PREFERENCES.restBias),
    note,
  };
}

// Merge a user-approved patch over existing prefs and re-normalize. Only ever
// merges whitelisted keys — arbitrary extra keys are dropped on normalize.
export function mergeCoachPreferences(existing, patch) {
  return normalizeCoachPreferences({ ...normalizeCoachPreferences(existing), ...(patch || {}) });
}

// Recent trend (aggregate-only)
// Selects the most recent `windowDays` of entries and derives counts/averages.
// Never reads notes or copies payloads — only numeric channels the app already
// computes elsewhere. Accepts an entries map keyed by date or an array.
function recentEntries(entries, windowDays) {
  if (!entries || typeof entries !== "object") return [];
  if (Array.isArray(entries)) return entries.slice(-windowDays);
  // Map keyed by YYYY-MM-DD → newest windowDays by key sort.
  return Object.keys(entries)
    .sort()
    .slice(-windowDays)
    .map((k) => entries[k]);
}

export function summarizeRecentTrend(entries, now, { windowDays = 14 } = {}) {
  const win = Math.max(1, Math.floor(num(windowDays) || 14));
  const days = recentEntries(entries, win);

  let loggedDays = 0;
  let trainingDays = 0;
  let proteinDays = 0;
  let sleepSum = 0;
  let sleepN = 0;
  let energySum = 0;
  let energyN = 0;

  for (const d of days) {
    if (!d || typeof d !== "object") continue;
    const w = d.workout || {};
    const nut = d.nutrition || {};
    const body = d.body || {};
    const exercises = w.exercises && typeof w.exercises === "object" ? w.exercises : {};
    const trained =
      Object.keys(exercises).length > 0 ||
      (num(w.cardio?.miles) || 0) > 0 ||
      (num(w.cardio?.minutes) || 0) > 0;
    const ate =
      (num(nut.calories) || 0) > 0 ||
      (num(nut.protein) || 0) > 0 ||
      (num(nut.carbs) || 0) > 0 ||
      (num(nut.fats) || 0) > 0;
    const recovered =
      (num(body.sleep) || 0) > 0 || (num(body.energy) || 0) > 0;

    if (trained || ate || recovered) loggedDays += 1;
    if (trained) trainingDays += 1;
    if ((num(nut.protein) || 0) >= 150) proteinDays += 1;
    const sl = num(body.sleep);
    if (sl !== null && sl > 0) { sleepSum += sl; sleepN += 1; }
    const en = num(body.energy);
    if (en !== null && en > 0) { energySum += en; energyN += 1; }
  }

  const round1 = (v) => Math.round(v * 10) / 10;
  const avgSleep = sleepN ? round1(sleepSum / sleepN) : null;
  const avgEnergy = energyN ? round1(energySum / energyN) : null;

  return {
    windowDays: win,
    loggedDays,
    trainingDays,
    proteinDays,
    avgSleep,
    avgEnergy,
    hasData: loggedDays > 0,
  };
}

// Coach memory lines (suggest-only)
// Concise, non-judgmental lines to inject into the coach context. Preferences
// come first (they're what the user asked for), then a light aggregate trend.
const TONE_PHRASE = {
  balanced: "balanced tone",
  direct: "direct, no-fluff tone",
  encouraging: "encouraging tone",
};
const INTENSITY_PHRASE = {
  conservative: "prefers conservative progression",
  moderate: "prefers moderate progression",
  aggressive: "open to aggressive progression",
};
const REST_PHRASE = {
  balanced: "balanced rest",
  "more-rest": "leans toward more rest",
  "more-volume": "leans toward more volume",
};

export function buildCoachMemoryLines({ preferences, trend } = {}) {
  const prefs = normalizeCoachPreferences(preferences);
  const lines = [];
  if (!prefs.enabled) return lines;

  const prefBits = [
    TONE_PHRASE[prefs.tone],
    `focus on ${prefs.focus}`,
    INTENSITY_PHRASE[prefs.intensity],
    REST_PHRASE[prefs.restBias],
  ].filter(Boolean);
  lines.push(`Coaching prefs: ${prefBits.join("; ")}.`);

  if (nonEmptyString(prefs.note)) {
    lines.push(`User-approved coaching preference note: ${prefs.note}`);
  }

  if (trend && trend.hasData) {
    const bits = [`${trend.trainingDays}/${trend.windowDays}d trained`];
    if (trend.avgSleep !== null) bits.push(`~${trend.avgSleep}h sleep`);
    if (trend.avgEnergy !== null) bits.push(`energy ~${trend.avgEnergy}/10`);
    lines.push(`Recent trend: ${bits.join(", ")}.`);
  }

  return lines;
}

// A single capped string for prompt injection. Suggest-only framing is explicit
// so downstream never treats it as an instruction to edit the program.
export function buildCoachMemoryContext({ preferences, trend } = {}, { maxLen = 240 } = {}) {
  const lines = buildCoachMemoryLines({ preferences, trend });
  if (!lines.length) return null;
  let out = `Athlete memory (suggest-only) — ${lines.join(" ")}`;
  if (out.length > maxLen) out = `${out.slice(0, maxLen - 1).trimEnd()}…`;
  return out;
}

// Privacy-safe export
// Plain-text export of coach memory. Contains ONLY preference enums, the short
// self-authored note, and derived aggregate counts — never raw notes, chat, or
// biometric payloads.
export function buildCoachMemoryExport({ preferences, trend } = {}) {
  const prefs = normalizeCoachPreferences(preferences);
  const lines = [
    "0vertrained coach memory (local, suggest-only)",
    "----------------------------------------",
    `Enabled: ${prefs.enabled ? "yes" : "no"}`,
    `Tone: ${prefs.tone}`,
    `Focus: ${prefs.focus}`,
    `Intensity: ${prefs.intensity}`,
    `Rest bias: ${prefs.restBias}`,
    `Note: ${nonEmptyString(prefs.note) ? prefs.note : "(none)"}`,
  ];
  if (trend && trend.hasData) {
    lines.push(
      "",
      `Recent window: ${trend.windowDays} days`,
      `Logged days: ${trend.loggedDays}`,
      `Training days: ${trend.trainingDays}`,
      `Protein-target days: ${trend.proteinDays}`,
      `Avg sleep: ${trend.avgSleep === null ? "n/a" : `${trend.avgSleep}h`}`,
      `Avg energy: ${trend.avgEnergy === null ? "n/a" : `${trend.avgEnergy}/10`}`,
    );
  }
  lines.push(
    "----------------------------------------",
    "Contains only your coaching preferences and derived aggregates — no raw logs, notes, or biometrics.",
  );
  return lines.join("\n");
}

export default {
  COACH_PREFERENCE_OPTIONS,
  DEFAULT_COACH_PREFERENCES,
  COACH_NOTE_MAX,
  normalizeCoachPreferences,
  mergeCoachPreferences,
  summarizeRecentTrend,
  buildCoachMemoryLines,
  buildCoachMemoryContext,
  buildCoachMemoryExport,
};
