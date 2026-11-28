import { validDateKey } from "./plans/hybridAlignmentDates";

const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const optionalRecord = value => value == null || isRecord(value);
const optionalRows = value => value == null || (Array.isArray(value) && value.every(isRecord));

export function entryBackupError(value) {
  if (!isRecord(value)) return "Expected a backup keyed by date.";
  const days = Object.entries(value);
  if (!days.length) return "The backup contains no days.";
  if (days.length > 3000) return "Import too large (max 3000 days).";
  for (const [date, day] of days) {
    if (!validDateKey(date) || !isRecord(day)) return "Each backup entry must be a day object with a valid date.";
    const { workout, body, nutrition } = day;
    if (![workout, body, nutrition, day.activity, day.intelligence, day.supplements].every(optionalRecord) ||
        !optionalRecord(workout?.cardio) || !optionalRecord(workout?.exercises) ||
        !Object.values(workout?.exercises || {}).every(ex => isRecord(ex) && (ex.sets == null ||
          (Array.isArray(ex.sets) && ex.sets.every(optionalRecord)))) ||
        !optionalRows(nutrition?.meals)) return `Invalid daily log on ${date}. Check the backup before importing.`;
  }
  const stack = [[value, 0]];
  while (stack.length) {
    const [record, depth] = stack.pop();
    if (depth > 128) return "The backup contains an excessively nested entry.";
    for (const [key, field] of Object.entries(record)) {
      if (key === "__proto__" || key === "prototype" || key === "constructor") return "Unsupported property in the backup.";
      if (field !== null && typeof field === "object") stack.push([field, depth + 1]);
    }
  }
  return null;
}

// JSON represents empty array slots as null. Preserve their set index while
// giving log screens an explicit unfinished set to read.
export function restoreEntryBackup(value) {
  let restored = value;
  for (const [date, day] of Object.entries(value)) {
    const exercises = day.workout?.exercises;
    let updated = exercises;
    for (const [name, exercise] of Object.entries(exercises || {})) {
      if (!Array.isArray(exercise.sets) || !exercise.sets.includes(null)) continue;
      if (updated === exercises) updated = { ...exercises };
      updated[name] = { ...exercise, sets: Array.from(exercise.sets, set => set ?? { done: false }) };
    }
    if (updated !== exercises) {
      if (restored === value) restored = { ...value };
      restored[date] = { ...day, workout: { ...day.workout, exercises: updated } };
    }
  }
  return restored;
}

function csvCell(value) {
  if (value == null || typeof value === "object") return "";
  let text = String(value);
  // Spreadsheet text can begin with an expression even inside CSV quotes.
  if (typeof value === "string" && /^[=+@-]/.test(text.trimStart()) && !/^[+-]?\d+(?:\.\d+)?$/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
}

export function entryStatsCsv(history) {
  const rows = [["Date","Weight","Calories","Protein","Carbs","Fats","Water","Sleep","Energy","Soreness","Miles","Workout Done"]];
  for (const date of Object.keys(history).sort()) {
    const { body, nutrition, workout } = history[date] || {};
    rows.push([date, body?.weight, nutrition?.calories, nutrition?.protein, nutrition?.carbs,
      nutrition?.fats, nutrition?.water, body?.sleep, body?.energy, body?.soreness,
      workout?.cardio?.miles, workout?.completed ? "Yes" : "No"]);
  }
  return rows.map(row => row.map(csvCell).join(",")).join("\r\n");
}
