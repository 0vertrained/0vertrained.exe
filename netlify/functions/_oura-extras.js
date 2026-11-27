// netlify/functions/_oura-extras.js
// Oura reads beyond the stored sync, shaped for the app: daytime stress,
// resilience and the bedtime window (/api/oura/extras), and tags with the
// mornings after them (/api/oura/tags). Read live with the user's token
// by oura-auth.js; nothing here is stored. Pure, so it is tested directly.

const RESILIENCE_LEVELS = ["limited", "adequate", "solid", "strong", "exceptional"];
const STRESS_SUMMARIES = ["restored", "normal", "stressful"];
const BEDTIME_STATUSES = ["optimal_found", "only_recommended_found"];

const byDay = (a, b) => String(a.day).localeCompare(String(b.day));
const isDay = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const number = (value) => (value === null || value === undefined || value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null);
const minutes = (seconds) => {
  const value = number(seconds);
  return value === null ? null : Math.round(value / 60);
};
const score = (value) => {
  const n = number(value);
  return n === null ? null : Math.round(n);
};

/** Daily stress: [{ day, summary, stressMinutes, recoveryMinutes }], oldest first. */
export function shapeStress(docs) {
  return (Array.isArray(docs) ? docs : [])
    .filter((doc) => isDay(doc?.day))
    .map((doc) => ({
      day: doc.day,
      summary: STRESS_SUMMARIES.includes(doc.day_summary) ? doc.day_summary : null,
      stressMinutes: minutes(doc.stress_high),
      recoveryMinutes: minutes(doc.recovery_high),
    }))
    .sort(byDay);
}

/** Resilience: [{ day, level, sleepRecovery, daytimeRecovery, stress }], oldest first. */
export function shapeResilience(docs) {
  return (Array.isArray(docs) ? docs : [])
    .filter((doc) => isDay(doc?.day) && RESILIENCE_LEVELS.includes(doc?.level))
    .map((doc) => ({
      day: doc.day,
      level: doc.level,
      sleepRecovery: score(doc.contributors?.sleep_recovery),
      daytimeRecovery: score(doc.contributors?.daytime_recovery),
      stress: score(doc.contributors?.stress),
    }))
    .sort(byDay);
}

/**
 * The latest bedtime window Oura has found: { day, startMinutes,
 * endMinutes, recommendation } in minutes from that day's midnight, local
 * to the ring (so -30 is 11:30 pm the evening before). Null without one.
 */
export function shapeBedtime(docs) {
  const found = (Array.isArray(docs) ? docs : [])
    .filter((doc) => isDay(doc?.day) && BEDTIME_STATUSES.includes(doc?.status) && doc?.optimal_bedtime)
    .sort(byDay);
  const latest = found[found.length - 1];
  if (!latest) return null;
  const start = minutes(latest.optimal_bedtime.start_offset);
  const end = minutes(latest.optimal_bedtime.end_offset);
  if (start === null || end === null || end < start) return null;
  return { day: latest.day, startMinutes: start, endMinutes: end, recommendation: latest.recommendation || null };
}

/** A tag's name as the app shows it: the custom name, else the type in words. */
export function tagLabel(doc) {
  if (doc?.tag_type_code === "custom") {
    const custom = String(doc.custom_name || "").trim();
    return custom ? custom.slice(0, 40) : null;
  }
  const code = String(doc?.tag_type_code || "").trim().toLowerCase();
  if (!code) return null;
  const words = code.replace(/^tag_/, "").replace(/^generic_/, "").replace(/_/g, " ").trim();
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}`.slice(0, 40) : null;
}

/** Tags by the day they started: [{ day, label }], one per label a day. */
export function shapeTags(docs) {
  const seen = new Set();
  const tags = [];
  for (const doc of Array.isArray(docs) ? docs : []) {
    const day = doc?.start_day;
    const label = tagLabel(doc);
    if (!isDay(day) || !label) continue;
    const key = `${day}|${label.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push({ day, label });
  }
  return tags.sort(byDay);
}

/**
 * Each morning's numbers: [{ day, readiness, hrv, restingHr }]. A day's
 * night is its long sleep, else its longest; naps don't count.
 */
export function shapeMornings(readinessDocs, sleepDocs) {
  const days = new Map();
  const at = (day) => {
    if (!days.has(day)) days.set(day, { day, readiness: null, hrv: null, restingHr: null });
    return days.get(day);
  };
  for (const doc of Array.isArray(readinessDocs) ? readinessDocs : []) {
    if (isDay(doc?.day) && score(doc.score) !== null) at(doc.day).readiness = score(doc.score);
  }
  const nights = new Map();
  for (const doc of Array.isArray(sleepDocs) ? sleepDocs : []) {
    if (!isDay(doc?.day) || doc.type === "late_nap" || doc.type === "rest" || doc.type === "deleted") continue;
    const current = nights.get(doc.day);
    const better = !current
      || (doc.type === "long_sleep" && current.type !== "long_sleep")
      || (doc.type === current.type && (number(doc.total_sleep_duration) || 0) > (number(current.total_sleep_duration) || 0));
    if (better) nights.set(doc.day, doc);
  }
  for (const [day, doc] of nights) {
    const morning = at(day);
    morning.hrv = score(doc.average_hrv);
    morning.restingHr = score(doc.lowest_heart_rate);
  }
  return [...days.values()].sort(byDay);
}
