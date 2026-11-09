// src/liftLogPrefs.js
// Lifting quality-of-life persistence: per-exercise sticky notes ("seat
// 4, pin 7, elbows tucked") and superset pairing memory (so Tuesday's
// curls+pushdowns pairing survives to next Tuesday). localStorage, same
// precedent as the race plan and energy goal — device-local, versioned key,
// normalize-on-read. These are conveniences, not training data: losing them
// costs annoyance, not history.

const NOTES_KEY = "ovt_exercise_notes_v1";
const PAIRS_KEY = "ovt_superset_pairs_v1";
const NOTE_MAX = 200;

function readJson(key) {
  try {
    const raw = localStorage.getItem(key);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === "object" ? v : {};
  } catch { return {}; }
}
function writeJson(key, obj) {
  try { localStorage.setItem(key, JSON.stringify(obj)); return true; } catch { return false; }
}

// Sticky notes
export function readExerciseNote(exerciseName) {
  if (!exerciseName) return "";
  const notes = readJson(NOTES_KEY);
  return typeof notes[exerciseName] === "string" ? notes[exerciseName] : "";
}

export function writeExerciseNote(exerciseName, note) {
  if (!exerciseName) return false;
  const notes = readJson(NOTES_KEY);
  const trimmed = String(note || "").slice(0, NOTE_MAX).trim();
  if (trimmed) notes[exerciseName] = trimmed;
  else delete notes[exerciseName];
  return writeJson(NOTES_KEY, notes);
}

// Superset pairing memory
// Keyed by day name + the exercise it pairs FORWARD to (exercise i pairs with
// i+1 in the session order). Stored as { "<dayName>|<exerciseName>": true }.
const pairKey = (dayName, exerciseName) => `${dayName || "any"}|${exerciseName}`;

export function readSupersetPref(dayName, exerciseName) {
  if (!exerciseName) return false;
  return readJson(PAIRS_KEY)[pairKey(dayName, exerciseName)] === true;
}

export function writeSupersetPref(dayName, exerciseName, paired) {
  if (!exerciseName) return false;
  const pairs = readJson(PAIRS_KEY);
  if (paired) pairs[pairKey(dayName, exerciseName)] = true;
  else delete pairs[pairKey(dayName, exerciseName)];
  return writeJson(PAIRS_KEY, pairs);
}

// Preset-declared supersets. A program exercise may carry
// `pairNext: true` — on preset apply, this seeds the sticky pairing pref for
// that weekday+exercise so the Session Mode superset flow works on day one
// with zero taps. Seeding is additive only: it never unpairs anything the
// user set themselves.
export function seedSupersetPrefsFromProgram(program) {
  let seeded = 0;
  try {
    for (const [dayName, day] of Object.entries(program || {})) {
      const lists = Array.isArray(day?.sessions) && day.sessions.length
        ? day.sessions.map((s) => s?.lifting || [])
        : [day?.lifting || []];
      for (const lifting of lists) {
        lifting.forEach((ex, i) => {
          if (ex?.pairNext === true && lifting[i + 1]) {
            writeSupersetPref(dayName, ex.name, true);
            seeded++;
          }
        });
      }
    }
  } catch { /* prefs are localStorage sugar — never let seeding throw */ }
  return seeded;
}
