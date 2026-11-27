// src/oura/extrasView.js
// How the app reads Oura's daytime stress, resilience, bedtime window and
// tags (fetched by ./extras.js): plain words and small numbers for Today,
// the check-in and Recovery. Pure.

export const RESILIENCE_LEVELS = ["limited", "adequate", "solid", "strong", "exceptional"];
const SUMMARY_WORD = { restored: "restored", normal: "normal", stressful: "stressful" };
// The check-in's stress row: low, some, high (src/checkinMorning.js).
const SUMMARY_CHECKIN = { restored: 2, normal: 5, stressful: 8 };
const MIN_TAGGED = 3;
const MIN_OTHER = 5;

function shiftKey(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** 130 → "2 h 10 min"; 45 → "45 min". */
export function formatMinutes(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${rest}\u00a0min`;
  return rest ? `${hours}\u00a0h ${rest}\u00a0min` : `${hours}\u00a0h`;
}

/** Yesterday's and today's stress so far: { yesterday, today }, each a record or null. */
export function stressDays(stress, todayKey) {
  const list = Array.isArray(stress) ? stress : [];
  const find = (day) => list.find((entry) => entry.day === day) || null;
  return { yesterday: find(shiftKey(todayKey, -1)), today: find(todayKey) };
}

function minutesPart(record) {
  const parts = [];
  if (record.stressMinutes != null) parts.push(`${formatMinutes(record.stressMinutes)} stressed`);
  if (record.recoveryMinutes != null) parts.push(`${formatMinutes(record.recoveryMinutes)} restored`);
  return parts.join(", ");
}

/** The sentence on Today, or "" with nothing to say. */
export function stressSentence(stress, todayKey) {
  const { yesterday, today } = stressDays(stress, todayKey);
  const sentences = [];
  if (yesterday && (yesterday.summary || minutesPart(yesterday))) {
    const word = SUMMARY_WORD[yesterday.summary];
    const minutes = minutesPart(yesterday);
    sentences.push(`Yesterday was ${word || "measured"}${minutes ? `: ${minutes}` : ""}.`);
  }
  if (today && minutesPart(today)) sentences.push(`Today so far: ${minutesPart(today)}.`);
  return sentences.join(" ");
}

/** The check-in stress value for yesterday's summary (2, 5 or 8), or null. */
export function checkinStress(stress, todayKey) {
  const { yesterday } = stressDays(stress, todayKey);
  return SUMMARY_CHECKIN[yesterday?.summary] ?? null;
}

/**
 * Resilience for Recovery: { latest, days, limitedStreak, lighterWeek },
 * days being the last 14 with each level's place (1 limited … 5 exceptional).
 */
export function resilienceView(resilience) {
  const list = (Array.isArray(resilience) ? resilience : []).filter((entry) => RESILIENCE_LEVELS.includes(entry.level));
  if (!list.length) return null;
  const days = list.slice(-14).map((entry) => ({ ...entry, rank: RESILIENCE_LEVELS.indexOf(entry.level) + 1 }));
  let limitedStreak = 0;
  for (let index = list.length - 1; index >= 0 && list[index].level === "limited"; index -= 1) limitedStreak += 1;
  return { latest: list[list.length - 1], days, limitedStreak, lighterWeek: limitedStreak >= 3 };
}

/** Minutes from midnight (negative is the evening before) as "10:45 pm". */
export function clockTime(minutes) {
  const total = ((Math.round(Number(minutes) || 0) % 1440) + 1440) % 1440;
  const hour = Math.floor(total / 60);
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${String(total % 60).padStart(2, "0")}\u00a0${hour < 12 ? "am" : "pm"}`;
}

/** "10:15 pm to 11 pm" for Oura's window, or "" without one. */
export function bedtimeText(bedtime) {
  if (!bedtime || !Number.isFinite(bedtime.startMinutes) || !Number.isFinite(bedtime.endMinutes)) return "";
  const tidy = (text) => text.replace(":00\u00a0", "\u00a0");
  return `${tidy(clockTime(bedtime.startMinutes))} to ${tidy(clockTime(bedtime.endMinutes))}`;
}

const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);

function compare(after, other, key) {
  const a = after.map((morning) => morning[key]).filter(Number.isFinite);
  const o = other.map((morning) => morning[key]).filter(Number.isFinite);
  if (a.length < MIN_TAGGED || o.length < MIN_OTHER) return null;
  return { after: Math.round(mean(a)), others: Math.round(mean(o)), change: Math.round(mean(a) - mean(o)) };
}

/**
 * For each tag, the mornings after a tagged day against the other mornings:
 * { label, nights, hrv, readiness, restingHr } (each { after, others,
 * change } or null), most-tagged first. Tags with too few nights come back
 * in `few` as { label, nights }.
 */
export function tagEffects({ tags = [], mornings = [] } = {}) {
  const byLabel = new Map();
  for (const tag of Array.isArray(tags) ? tags : []) {
    if (!tag?.label || !tag?.day) continue;
    if (!byLabel.has(tag.label)) byLabel.set(tag.label, new Set());
    byLabel.get(tag.label).add(tag.day);
  }
  const list = Array.isArray(mornings) ? mornings : [];
  const effects = [];
  const few = [];
  for (const [label, days] of byLabel) {
    const after = list.filter((morning) => days.has(shiftKey(morning.day, -1)));
    const other = list.filter((morning) => !days.has(shiftKey(morning.day, -1)));
    const result = { label, nights: after.length, hrv: compare(after, other, "hrv"), readiness: compare(after, other, "readiness"), restingHr: compare(after, other, "restingHr") };
    if (result.hrv || result.readiness || result.restingHr) effects.push(result);
    else few.push({ label, nights: after.length });
  }
  effects.sort((a, b) => b.nights - a.nights || a.label.localeCompare(b.label));
  few.sort((a, b) => b.nights - a.nights || a.label.localeCompare(b.label));
  return { effects, few, needed: MIN_TAGGED };
}

const signed = (value) => (value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : "0");

/** "HRV +7 ms, readiness +3, resting heart rate −2 bpm" for one tag. */
export function effectText(effect) {
  const parts = [];
  if (effect.hrv) parts.push(`HRV ${signed(effect.hrv.change)}\u00a0ms`);
  if (effect.readiness) parts.push(`readiness ${signed(effect.readiness.change)}`);
  if (effect.restingHr) parts.push(`resting heart rate ${signed(effect.restingHr.change)}\u00a0bpm`);
  return parts.join(", ");
}
